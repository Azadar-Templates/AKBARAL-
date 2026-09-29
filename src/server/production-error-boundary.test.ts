import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApiServer, type ApiServer } from '../app';
import {
  db,
  createTask,
  createAgent,
  createAgentExecution,
  updateTaskStatus,
  updateAgentExecutionStatus,
  createUser,
  appendAgentExecutionLog,
} from '../db';
import { hashPassword } from '../security';
import { looksInternal, toPublicFailure, publicErrorMessage, adminSafeErrorSummary, publicLogLine, SAFE_TASK_FAILURE_MESSAGE, SAFE_LOG_REDACTED_MESSAGE } from './safe-errors';

/**
 * PRODUCTION ERROR BOUNDARY
 *
 * A real deployment produces real, honest, INTERNAL failure text. Observed in
 * production: a task failed with "No AI provider configured" — technically
 * true, and exactly the kind of sentence a customer (and the owner console)
 * must never be shown, because it describes how the deployment is wired.
 *
 * Contract locked by these tests:
 *   1. No user-facing or admin-facing API response contains provider
 *      configuration diagnostics, environment variable names, API-key wording,
 *      stack frames, file paths, SQL, internal ids or database/runtime detail.
 *   2. Failures are still reported HONESTLY — never rewritten as success.
 *   3. The raw diagnostic is still there, server-side: the database columns
 *      and the server logs keep the untouched text.
 */

const suffix = randomBytes(6).toString('hex');
const password = 'correct-horse-battery-staple';

/** Real internal failure strings this platform actually produces. */
const RAW_DIAGNOSTICS = [
  'No AI provider configured',
  'GOOGLE_API_KEY is not set; set GEMINI_API_KEY or GOOGLE_API_KEY',
  'provider openai rejected the request (HTTP 401 unauthorized, api key invalid)',
  'SqliteError: no such column: agent_category',
  "TypeError: Cannot read properties of undefined (reading 'run')\n    at runAgent (/home/user/AKBARAL-/src/orchestrator/executor.ts:412:11)",
  'connect ECONNREFUSED 127.0.0.1:5432',
  'workflow wf_9f2a1c7d4e5b step 3 failed on agent slug market-research-analyst',
  'SELECT * FROM model_runs WHERE provider_key = ? failed',
];

/** Substrings that must never appear in a user- or admin-facing payload. */
const FORBIDDEN_IN_UI: Array<[RegExp, string]> = [
  [/\bAPI[_ ]?KEY\b/i, 'API key wording'],
  [/\bGOOGLE_API_KEY\b|\bGEMINI_API_KEY\b|\bOPENAI_API_KEY\b|\bDATABASE_URL\b|\bSTRIPE_SECRET_KEY\b/, 'environment variable name'],
  [/No AI provider configured/i, 'provider configuration diagnostic'],
  [/\bnot configured\b/i, 'configuration diagnostic'],
  [/\bSqliteError\b|\bno such column\b|\bno such table\b/i, 'database internals'],
  [/\s+at\s+[\w$.<>]+\s+\(/, 'stack frame'],
  [/\/home\/|\/src\/|node_modules/, 'filesystem path'],
  [/\bECONNREFUSED\b|\bETIMEDOUT\b/, 'runtime network error code'],
  [/\bSELECT\b[\s\S]*\bFROM\b/i, 'SQL'],
  [/\bTypeError\b|\bReferenceError\b/, 'runtime exception class'],
  [/\bHTTP\s*401\b|\bHTTP\s*429\b|\bHTTP\s*5\d\d\b/i, 'provider HTTP status'],
];

function assertNoInternalDetail(payload: unknown, where: string): void {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const [pattern, label] of FORBIDDEN_IN_UI) {
    assert.ok(!pattern.test(serialized), `${where} leaked ${label}: ${serialized.slice(0, 300)}`);
  }
}

describe('production error boundary — the sanitizer itself', () => {
  it('flags every real internal diagnostic this platform emits', () => {
    for (const raw of RAW_DIAGNOSTICS) {
      assert.ok(looksInternal(raw), `must be recognised as internal: ${raw.slice(0, 60)}`);
    }
  });

  it('does not flag ordinary outcome copy', () => {
    for (const safe of [
      SAFE_TASK_FAILURE_MESSAGE,
      'title is required',
      'This task was cancelled. Your task credit was refunded.',
      'Your free tasks are used up. Upgrade your plan to keep running tasks.',
    ]) {
      assert.ok(!looksInternal(safe), `must be treated as safe copy: ${safe}`);
    }
  });

  it('collapses every provider/runtime failure class to one neutral, honest line', () => {
    for (const code of ['provider_not_configured', 'provider_auth', 'provider_outage', 'execution_failed', 'internal_error']) {
      const failure = toPublicFailure({ code, message: 'No AI provider configured' });
      assert.equal(failure.message, SAFE_TASK_FAILURE_MESSAGE, `${code} must use the generic line`);
      assert.equal(failure.code, 'task_failed', `${code} must not be exposed as a public code`);
      assertNoInternalDetail(failure, `toPublicFailure(${code})`);
    }
  });

  it('keeps honest, specific copy for outcome-level states (never a fake success)', () => {
    const cases: Array<[string, RegExp]> = [
      ['timed_out', /too long/i],
      ['cancelled', /cancelled/i],
      ['verification_failed', /quality check/i],
      ['requires_pro', /free tasks are used up/i],
    ];
    for (const [code, expected] of cases) {
      const failure = toPublicFailure({ code, message: 'internal detail here' });
      assert.match(failure.message, expected, `${code} keeps its specific copy`);
      assert.doesNotMatch(failure.message, /success|completed|done/i, `${code} must never read as success`);
    }
  });

  it('never echoes an unrecognised raw message, even with a caller-safe code', () => {
    const failure = toPublicFailure({ code: 'validation_error', message: 'SqliteError: no such column: agent_category' });
    assertNoInternalDetail(failure, 'validation_error with an internal message');
    assert.equal(failure.message, SAFE_TASK_FAILURE_MESSAGE);
    // …but genuine validation copy still reaches the user.
    assert.equal(toPublicFailure({ code: 'validation_error', message: 'title is required' }).message, 'title is required');
  });

  it('gives the owner/admin console a marker instead of the diagnostic', () => {
    const summary = adminSafeErrorSummary('GOOGLE_API_KEY is not set');
    assert.ok(summary);
    assert.equal(summary.hasTechnicalDetail, true, 'the console is told a technical detail exists');
    assertNoInternalDetail(summary, 'adminSafeErrorSummary');
    assert.equal(adminSafeErrorSummary(''), null);
  });

  it('execution log lines are display-safe but keep their honest shape', () => {
    // The console renders these verbatim, so they are a UI surface.
    const failure = publicLogLine({
      message: 'Execution failed: search endpoint html.duckduckgo.com unreachable (fetch failed); configure SEARCH_API_KEY',
      level: 'error',
      data: { code: 'provider_not_configured', requiredCredential: 'SEARCH_API_KEY', step: 3 },
    });
    assert.equal(failure.message, SAFE_TASK_FAILURE_MESSAGE);
    assertNoInternalDetail(failure, 'publicLogLine (error)');
    assert.deepEqual(failure.data, { code: 'task_failed', step: 3 }, 'credential hints are dropped, harmless fields survive');

    const warn = publicLogLine({ message: 'Tool unavailable: GOOGLE_API_KEY missing', level: 'warn' });
    assert.equal(warn.message, SAFE_LOG_REDACTED_MESSAGE);

    // Ordinary progress logs are untouched — the console stays useful.
    const info = publicLogLine({ message: 'Planning research across web sources', level: 'info', data: { step: 1 } });
    assert.equal(info.message, 'Planning research across web sources');
  });

  it('publicErrorMessage returns null when there is nothing to say', () => {
    assert.equal(publicErrorMessage(null), null);
    assert.equal(publicErrorMessage('   '), null);
    assert.equal(publicErrorMessage('No AI provider configured'), SAFE_TASK_FAILURE_MESSAGE);
  });
});

describe('production error boundary — HTTP surfaces', () => {
  let api: ApiServer;
  let baseUrl = '';
  let userToken = '';
  let adminToken = '';
  const tempUserIds: string[] = [];
  const failedTaskIds: string[] = [];
  let executionId = '';

  async function login(email: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 200, `login for ${email}`);
    return ((await response.json()) as { accessToken: string }).accessToken;
  }

  before(async () => {
    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;

    const userEmail = `boundary-user-${suffix}@akbaral.test`;
    const adminEmail = `boundary-admin-${suffix}@akbaral.test`;
    const passwordHash = await hashPassword(password);
    const user = createUser({ email: userEmail, name: 'Boundary User', passwordHash });
    const admin = createUser({ email: adminEmail, name: 'Boundary Admin', role: 'admin', passwordHash });
    tempUserIds.push(user.id, admin.id);
    userToken = await login(userEmail);
    adminToken = await login(adminEmail);

    const agent = createAgent({ name: 'Boundary agent', slug: `boundary-agent-${suffix}` });

    // One failed task per real diagnostic, exactly as the executor stores them.
    for (const [index, raw] of RAW_DIAGNOSTICS.entries()) {
      const task = createTask({ userId: user.id, title: `boundary task ${index}`, type: 'test', agentId: agent.id });
      failedTaskIds.push(task.id);
      updateTaskStatus({ id: task.id, status: 'failed', errorMessage: raw, completedAt: new Date().toISOString() });
      const execution = createAgentExecution({ agentId: agent.id, taskId: task.id, id: `exe_boundary_${suffix}_${index}` });
      updateAgentExecutionStatus({ id: execution.id, status: 'failed', errorMessage: raw, completedAt: new Date().toISOString() });
      if (!executionId) executionId = execution.id;
    }

    // A failed provider run, which is what the admin provider console reads.
    db.run(
      `INSERT INTO model_runs (id, provider_key, model_key, status, error_message, created_at)
       VALUES (?, ?, ?, 'failed', ?, ?)`,
      [
        `mr_boundary_${suffix}`,
        'google',
        'gemini-2.0-flash',
        'GOOGLE_API_KEY is not set — provider not configured',
        new Date().toISOString(),
      ],
    );
  });

  after(async () => {
    await api.close();
    db.run(`DELETE FROM model_runs WHERE id = ?`, [`mr_boundary_${suffix}`]);
    for (const id of tempUserIds) db.run('DELETE FROM users WHERE id = ?', [id]);
  });

  it('the user task list never exposes a stored diagnostic', async () => {
    const response = await fetch(`${baseUrl}/api/tasks?limit=200`, { headers: { authorization: `Bearer ${userToken}` } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assertNoInternalDetail(body, 'GET /api/tasks');
  });

  it('the user task detail reports the failure honestly, without the diagnostic', async () => {
    for (const taskId of failedTaskIds) {
      const response = await fetch(`${baseUrl}/api/tasks/${taskId}`, { headers: { authorization: `Bearer ${userToken}` } });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { task: { status: string; error_message: string | null } };
      assertNoInternalDetail(body, `GET /api/tasks/${taskId}`);
      // Honest: still reported as failed, with a real (non-empty) explanation.
      assert.equal(body.task.status, 'failed', 'the failure must not be hidden or rewritten as success');
      assert.equal(body.task.error_message, SAFE_TASK_FAILURE_MESSAGE);
    }
  });

  it('the execution detail endpoint is sanitized too', async () => {
    const response = await fetch(`${baseUrl}/api/tasks/execution/${executionId}`, {
      headers: { authorization: `Bearer ${userToken}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { execution: { status: string; error_message: string | null } };
    assertNoInternalDetail(body, 'GET /api/tasks/execution/:id');
    assert.equal(body.execution.status, 'failed');
    assert.equal(body.execution.error_message, SAFE_TASK_FAILURE_MESSAGE);
  });

  it('the execution console log never renders a raw diagnostic', async () => {
    // Exactly the production line observed live: written by the agent, stored
    // raw, and previously rendered verbatim in the user's console.
    const raw = 'Execution failed: search endpoint html.duckduckgo.com unreachable (fetch failed); configure SEARCH_API_KEY';
    appendAgentExecutionLog({ executionId, message: raw, level: 'error', type: 'log' });
    const response = await fetch(`${baseUrl}/api/tasks/execution/${executionId}`, {
      headers: { authorization: `Bearer ${userToken}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { logs: Array<{ message: string }> };
    assertNoInternalDetail(body, 'execution console logs');
    assert.ok(body.logs.some((line) => line.message === SAFE_TASK_FAILURE_MESSAGE), 'the failure is still reported, just safely');
    // …and the raw line is still in the database for operators.
    const stored = db.get<{ message: string }>(
      'SELECT message FROM agent_execution_logs WHERE execution_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
      [executionId],
    );
    assert.equal(stored?.message, raw, 'the raw console line stays server-side');
  });

  it('the user dashboard never exposes a stored diagnostic', async () => {
    for (const route of ['/api/dashboard', '/api/dashboard/tasks', '/api/dashboard/activity']) {
      const response = await fetch(`${baseUrl}${route}`, { headers: { authorization: `Bearer ${userToken}` } });
      if (response.status === 404) continue; // route not part of this build
      assert.equal(response.status, 200, `${route} must answer`);
      assertNoInternalDetail(await response.json(), `GET ${route}`);
    }
  });

  it('the owner/admin provider console shows the failure, never the provider diagnostic', async () => {
    const response = await fetch(`${baseUrl}/api/admin/providers/health`, { headers: { authorization: `Bearer ${adminToken}` } });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      providers?: Array<{ key: string; runs: { failed: number; lastError: { message: string; hasTechnicalDetail: boolean } | null } }>;
    };
    const raw = JSON.stringify(body);
    // The admin console legitimately lists WHICH credential slots exist
    // (that is its configuration job); what it must not do is render the raw
    // runtime/provider failure text. Assert on the lastError surface itself.
    const google = (body.providers ?? []).find((provider) => provider.key === 'google');
    assert.ok(google, 'the provider console must list the google provider');
    assert.ok(google.runs.lastError, 'the failed run must still be reported to the owner');
    assertNoInternalDetail(google.runs.lastError, 'admin provider lastError');
    assert.equal(google.runs.lastError.hasTechnicalDetail, true, 'the owner is told a server-side diagnostic exists');
    assert.ok(!raw.includes('GOOGLE_API_KEY is not set'), 'the raw provider error must not reach the admin console');
  });

  it('an unhandled server error answers generically in production mode', async () => {
    const env = process.env as Record<string, string | undefined>;
    const savedEnv = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      const response = await fetch(`${baseUrl}/api/definitely-not-a-route-${suffix}`, {
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(response.status, 404);
      assertNoInternalDetail(await response.json(), 'unknown route');
    } finally {
      if (savedEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = savedEnv;
    }
  });

  it('the RAW diagnostic is still preserved server-side for operators', () => {
    // The boundary hides the detail from screens; it must not destroy it.
    for (const [index, raw] of RAW_DIAGNOSTICS.entries()) {
      const stored = db.get<{ error_message: string }>('SELECT error_message FROM tasks WHERE id = ?', [failedTaskIds[index]]);
      assert.equal(stored?.error_message, raw, 'the untouched diagnostic must remain in the database');
    }
    const run = db.get<{ error_message: string }>('SELECT error_message FROM model_runs WHERE id = ?', [`mr_boundary_${suffix}`]);
    assert.match(String(run?.error_message), /GOOGLE_API_KEY/, 'provider diagnostics stay in model_runs');
  });
});

describe('production error boundary — browser bundle', () => {
  const appJs = fs.readFileSync(path.resolve(process.cwd(), 'public/app.js'), 'utf8');

  it('the client never renders a raw failure message', () => {
    assert.ok(
      !/esc\(String\(input\.message\)\.slice/.test(appJs),
      'the terminal result card must not echo the raw error message',
    );
    assert.ok(!/toast\(`\$\{friendly\.title\}: \$\{e\.message\}`/.test(appJs), 'toasts must not echo the raw error message');
  });

  it('the client copy contains no configuration diagnostics', () => {
    for (const forbidden of ['No AI provider configured', 'model provider key', 'API key is invalid', 'The operator must']) {
      assert.ok(!appJs.includes(forbidden), `client copy must not mention: ${forbidden}`);
    }
    assert.ok(appJs.includes("We couldn't complete this task right now."), 'the neutral failure line must exist');
  });
});
