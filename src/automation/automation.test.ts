import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { createApiServer, type ApiServer } from '../app';
import { startModelFixture, type ModelFixtureServer } from '../test-support/model-provider-fixture';
import {
  db,
  getAutomationRow,
  getJob,
  listNotifications,
  insertAutomationRun,
} from '../db';
import { listAutomationRunRows } from '../db/automation-repositories';
import { syncAgentRegistry } from '../agents/registry';
import { executionQueue } from '../orchestrator/queue';
import { clearRateLimitBuckets } from '../server/middleware/rate-limit';

/**
 * Automation & scheduled workflows — end-to-end integration tests.
 *
 * Covers the full lifecycle against the real stack (API server + automation
 * scheduler + execution queue + workflow runner + agent dispatcher + model
 * fixture + push fixture):
 *   create -> schedule -> automatic trigger -> agent execution -> verified
 *   result -> notification (in-app + Expo push with deep link), plus failure,
 *   retry, timeout, cancellation, duplicate-occurrence protection, timezone
 *   scheduling, crash recovery, auto-pause on exhausted credits, tenant
 *   isolation, auth, validation, audit logging and legacy CRM cohort
 *   isolation.
 */

const suffix = randomBytes(6).toString('hex');
const password = 'correct-horse-battery-staple';
const AGENT = 'research-researcher-002';

interface PushFixture {
  baseUrl: string;
  requests: Array<Record<string, unknown>>;
  close(): Promise<void>;
}

async function startPushFixture(): Promise<PushFixture> {
  const requests: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      let body: unknown = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
      requests.push({ body });
      const messages = Array.isArray(body) ? body : [body];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: 'fixture-ticket' })) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`waitFor timed out waiting for ${label}`);
}

function registerDevicePush(baseUrl: string, token: string, pushToken: string): Promise<Response> {
  return fetch(`${baseUrl}/api/notifications/device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ token: pushToken, platform: 'android' }),
  });
}

function jsonHeaders(token: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
}

describe('Automation & scheduled workflows', () => {
  let api: ApiServer;
  let baseUrl = '';
  let modelFixture: ModelFixtureServer;
  let pushFixture: PushFixture;
  let tokenA = '';
  let userIdA = '';
  let tokenB = '';
  let userIdB = '';
  let tokenC = '';
  let userIdC = '';
  const savedEnv = new Map<string, string | undefined>();

  async function registerUser(label: string): Promise<{ id: string; token: string }> {
    const email = `ma-${label}-${suffix}@akbaral.test`;
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: `MA ${label}` }),
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as { user: { id: string } };
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.status, 200);
    const loginBody = (await login.json()) as { accessToken: string };
    return { id: body.user.id, token: loginBody.accessToken };
  }

  async function createAutomation(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${baseUrl}/api/automations`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({
        name: 'Daily research',
        schedule: { kind: 'interval', seconds: 3600 },
        steps: [{ agent_slug: AGENT, goal: 'Summarize today AI news' }],
        ...overrides,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { id: String((body.automation as Record<string, unknown> | undefined)?.id ?? ''), status: response.status, body };
  }

  function runsOf(automationId: string): Array<Record<string, unknown>> {
    return listAutomationRunRows(automationId, 50) as unknown as Array<Record<string, unknown>>;
  }

  before(async () => {
    for (const key of [
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'AKBARAL_SEARCH_ENDPOINT',
      'AKBARAL_PAGE_FETCH_ENDPOINT',
      'AKBARAL_ALLOW_PRIVATE_PROVIDER',
      'AKBARAL_EXPO_PUSH_URL',
    ]) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    clearRateLimitBuckets();

    pushFixture = await startPushFixture();
    process.env.AKBARAL_EXPO_PUSH_URL = pushFixture.baseUrl;

    syncAgentRegistry();
    modelFixture = await startModelFixture('ok');

    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;

    const userA = await registerUser('a');
    userIdA = userA.id;
    tokenA = userA.token;
    const userB = await registerUser('b');
    userIdB = userB.id;
    tokenB = userB.token;
    const userC = await registerUser('c');
    userIdC = userC.id;
    tokenC = userC.token;

    // Both users have a registered push device so notifications really dispatch.
    await registerDevicePush(baseUrl, tokenA, `ExpoPushToken[ma-a-${suffix}]`);
    await registerDevicePush(baseUrl, tokenC, `ExpoPushToken[ma-c-${suffix}]`);

    // User A drives many consuming runs in this suite; top up the trial
    // balance so later tests are not starved. Credit-behavior assertions use
    // before/after deltas, not absolute balances.
    db.run(`UPDATE credit_accounts SET free_credits = 50 WHERE user_id = ?`, [userIdA]);
  });

  after(async () => {
    try {
      executionQueue.stop();
    } catch {
      // already stopped
    }
    await api?.close();
    await modelFixture?.close();
    await pushFixture?.close();
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // -------------------------------------------------------------------
  // Validation, auth, isolation
  // -------------------------------------------------------------------

  it('rejects invalid input server-side', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ name: '', schedule: { kind: 'interval', seconds: 3600 }, steps: [{ agent_slug: AGENT, goal: 'x' }] }, 'empty name'],
      [{ name: 'x', schedule: { kind: 'cron', expr: '1-5 * * * *', tz: 'UTC' }, steps: [{ agent_slug: AGENT, goal: 'x' }] }, 'range cron'],
      [{ name: 'x', schedule: { kind: 'interval', seconds: 30 }, steps: [{ agent_slug: AGENT, goal: 'x' }] }, 'interval too small'],
      [{ name: 'x', schedule: { kind: 'once', run_at: '2000-01-01T00:00:00Z' }, steps: [{ agent_slug: AGENT, goal: 'x' }] }, 'run_at in the past'],
      [{ name: 'x', schedule: { kind: 'interval', seconds: 3600 }, steps: [{ agent_slug: 'does-not-exist', goal: 'x' }] }, 'unknown agent'],
      [{ name: 'x', schedule: { kind: 'interval', seconds: 3600 }, steps: [] }, 'no steps'],
      [
        {
          name: 'x',
          schedule: { kind: 'interval', seconds: 3600 },
          steps: Array.from({ length: 9 }, (_, i) => ({ agent_slug: AGENT, goal: `goal ${i}` })),
        },
        'too many steps',
      ],
      [{ name: 'x', schedule: { kind: 'cron', expr: '* * * * *', tz: 'Not/AZone' }, steps: [{ agent_slug: AGENT, goal: 'x' }] }, 'bad timezone'],
      [{ name: 'x', schedule: { kind: 'interval', seconds: 3600 }, steps: [{ agent_slug: AGENT, goal: 'x', tool_key: 'not_a_tool' }] }, 'unknown tool'],
      [
        { name: 'x', schedule: { kind: 'interval', seconds: 3600 }, steps: [{ agent_slug: AGENT, goal: 'x' }], condition: { all: [{ type: 'nonsense' }] } },
        'unknown condition',
      ],
    ];
    for (const [payload, label] of cases) {
      const response = await fetch(`${baseUrl}/api/automations`, { method: 'POST', headers: jsonHeaders(tokenA), body: JSON.stringify(payload) });
      assert.equal(response.status, 400, `${label} must be rejected with 400`);
    }
  });

  it('requires authentication on every route', async () => {
    for (const [method, path] of [
      ['GET', '/api/automations'],
      ['POST', '/api/automations'],
      ['GET', '/api/automations/atm_x'],
      ['PATCH', '/api/automations/atm_x'],
      ['DELETE', '/api/automations/atm_x'],
      ['POST', '/api/automations/atm_x/run'],
      ['POST', '/api/automations/atm_x/pause'],
      ['POST', '/api/automations/atm_x/resume'],
      ['GET', '/api/automations/atm_x/runs'],
      ['POST', '/api/automations/atm_x/runs/arn_y/cancel'],
    ] as Array<[string, string]>) {
      const response = await fetch(`${baseUrl}${path}`, { method });
      assert.equal(response.status, 401, `${method} ${path} must require auth`);
    }
  });

  it('isolates tenants: cross-user access is a 404 (no existence oracle)', async () => {
    const created = await createAutomation(tokenA, { name: 'private-a' });
    assert.equal(created.status, 201);

    const read = await fetch(`${baseUrl}/api/automations/${created.id}`, { headers: jsonHeaders(tokenB) });
    assert.equal(read.status, 404, 'other user cannot read');
    const patch = await fetch(`${baseUrl}/api/automations/${created.id}`, { method: 'PATCH', headers: jsonHeaders(tokenB), body: JSON.stringify({ name: 'hijack', schedule: { kind: 'interval', seconds: 3600 }, steps: [{ agent_slug: AGENT, goal: 'hijack' }] }) });
    assert.equal(patch.status, 404, 'other user cannot edit');
    const run = await fetch(`${baseUrl}/api/automations/${created.id}/run`, { method: 'POST', headers: jsonHeaders(tokenB) });
    assert.equal(run.status, 404, 'other user cannot trigger');
    const pause = await fetch(`${baseUrl}/api/automations/${created.id}/pause`, { method: 'POST', headers: jsonHeaders(tokenB) });
    assert.equal(pause.status, 404, 'other user cannot pause');
    const del = await fetch(`${baseUrl}/api/automations/${created.id}`, { method: 'DELETE', headers: jsonHeaders(tokenB) });
    assert.equal(del.status, 404, 'other user cannot delete');
    const cancel = await fetch(`${baseUrl}/api/automations/${created.id}/runs/arn_x/cancel`, { method: 'POST', headers: jsonHeaders(tokenB) });
    assert.equal(cancel.status, 404, 'other user cannot cancel runs');

    // Owner still sees exactly their own automations.
    const mine = (await (await fetch(`${baseUrl}/api/automations`, { headers: jsonHeaders(tokenA) })).json()) as { automations: Array<{ id: string }> };
    assert.ok(mine.automations.some((row) => row.id === created.id), 'owner sees own automation');
    const theirs = (await (await fetch(`${baseUrl}/api/automations`, { headers: jsonHeaders(tokenB) })).json()) as { automations: Array<{ id: string }> };
    assert.ok(!theirs.automations.some((row) => row.id === created.id), 'other user list excludes it');

    // cleanup
    await fetch(`${baseUrl}/api/automations/${created.id}`, { method: 'DELETE', headers: jsonHeaders(tokenA) });
  });

  it('keeps legacy CRM automations in a separate cohort', async () => {
    const crm = await fetch(`${baseUrl}/api/crm/automations`, {
      method: 'POST',
      headers: jsonHeaders(tokenB),
      body: JSON.stringify({ name: 'legacy crm follow-up', trigger_key: 'deal.won' }),
    });
    assert.equal(crm.status, 201);
    const list = (await (await fetch(`${baseUrl}/api/automations`, { headers: jsonHeaders(tokenB) })).json()) as { automations: Array<{ id: string; name: string }> };
    assert.ok(!list.automations.some((row) => row.name === 'legacy crm follow-up'), 'CRM rows are invisible to the scheduler API');
    const rows = db.all('SELECT * FROM automations WHERE user_id = ? AND schedule_json IS NULL', [userIdB]);
    assert.equal(rows.length, 1, 'legacy row still stored untouched');
  });

  // -------------------------------------------------------------------
  // Core lifecycle: create -> schedule -> trigger -> execute -> result -> notify
  // -------------------------------------------------------------------

  it('schedules and fires automatically: full path to notification', async () => {
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    process.env.OPENAI_BASE_URL = modelFixture.baseUrl;
    try {
      const runAt = new Date(Date.now() + 1500).toISOString();
      const created = await createAutomation(tokenA, {
        name: 'Scheduled research',
        schedule: { kind: 'once', run_at: runAt },
        steps: [{ agent_slug: AGENT, goal: 'Produce a verified research brief on scheduling systems' }],
      });
      assert.equal(created.status, 201);
      const automationId = created.id;
      const automation = getAutomationRow(automationId);
      assert.ok(automation, 'persisted');
      assert.equal(automation!.status, 'active');
      assert.ok(Math.abs(Date.parse(String(automation!.next_run_at)) - Date.parse(runAt)) < 5, 'next_run_at seeded from run_at');

      // The scheduler (started by the API server, 1s tick) fires on its own.
      await waitFor(() => runsOf(automationId).some((run) => run.status === 'completed'), 45_000, 'scheduled run to complete');

      const runs = await runsOf(automationId);
      assert.equal(runs.length, 1, 'exactly one run for the occurrence');
      const run = runs[0] as { status: string; trigger_reason: string; workflow_id: string; job_id: string };
      assert.equal(run.trigger_reason, 'schedule');
      assert.equal(run.status, 'completed');
      assert.ok(run.workflow_id, 'run linked to workflow');
      assert.ok(run.job_id, 'run linked to job');

      const workflow = db.get<{ status: string; result_json: string }>('SELECT status, result_json FROM workflows WHERE id = ?', [run.workflow_id]);
      assert.equal(workflow?.status, 'completed', 'workflow completed');
      assert.ok(workflow?.result_json, 'workflow carries a synthesized result');

      const task = db.get<{ status: string }>('SELECT t.status FROM tasks t JOIN workflow_steps s ON s.task_id = t.id WHERE s.workflow_id = ?', [run.workflow_id]);
      assert.equal(task?.status, 'completed', 'step task completed through the real agent dispatcher');

      // One-shot schedule never fires again.
      const after = getAutomationRow(automationId);
      assert.equal(after!.next_run_at, null, 'one-time schedule exhausted');
      assert.equal(after!.run_count, 1);

      // Notification: in-app + push with deep link.
      await waitFor(
        () => listNotifications(userIdA).some((row) => String(row.title) === 'Automation completed' && String(row.data ?? '').includes(automationId)),
        10_000,
        'completion notification',
      );
      await waitFor(
        () => pushFixture.requests.some((entry) => JSON.stringify(entry.body).includes(automationId) && JSON.stringify(entry.body).includes('Automation completed')),
        10_000,
        'push dispatch',
      );
      const pushEntry = pushFixture.requests.find((entry) => JSON.stringify(entry.body).includes(automationId));
      const message = (pushEntry!.body as Array<Record<string, unknown>>)[0];
      assert.equal((message.data as { deepLink?: string }).deepLink, `akbaral://automations/${automationId}`);

      // Audit trail.
      const audit = db.get(`SELECT id FROM audit_logs WHERE actor_id = ? AND action = 'automation.created' AND resource_id = ?`, [userIdA, automationId]);
      assert.ok(audit, 'creation audited');
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
    }
  });

  it('computes timezone-correct schedules (Karachi)', async () => {
    // 09:30 daily in Asia/Karachi = 04:30Z. Expected value computed with
    // plain Date math (not the cron engine) to keep this an independent check.
    const now = new Date();
    let expected = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4, 30, 0);
    if (expected <= Date.now() + 1000) {
      expected += 86_400_000;
    }
    const created = await createAutomation(tokenA, {
      name: 'Karachi morning',
      schedule: { kind: 'cron', expr: '30 9 * * *', tz: 'Asia/Karachi' },
    });
    assert.equal(created.status, 201);
    const automation = getAutomationRow(created.id);
    assert.equal(
      Date.parse(String(automation!.next_run_at)),
      expected,
      `next run must be ${new Date(expected).toISOString()} (9:30 Karachi)`,
    );
    await fetch(`${baseUrl}/api/automations/${created.id}`, { method: 'DELETE', headers: jsonHeaders(tokenA) });
  });

  it('protects against duplicate occurrence firing (idempotency key)', async () => {
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    process.env.OPENAI_BASE_URL = modelFixture.baseUrl;
    try {
      const created = await createAutomation(tokenA, {
        name: 'dup-guard',
        schedule: { kind: 'interval', seconds: 3600 },
      });
      assert.equal(created.status, 201);
      const id = created.id;

      // Force the automation due, then run the scheduler pass twice in a row.
      db.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [new Date(Date.now() - 1000).toISOString(), id]);
      const { automationScheduler } = await import('./scheduler');
      automationScheduler.tick();
      automationScheduler.tick();
      automationScheduler.tick();

      const runs = await runsOf(id);
      assert.equal(runs.length, 1, 'only one run despite three scheduler passes over the same due occurrence');
      assert.equal(getAutomationRow(id)!.next_run_at !== null, true, 'schedule advanced after firing');

      // Reverting next_run_at to the SAME past occurrence must not re-fire.
      const originalScheduledFor = String((runs[0] as { scheduled_for: string }).scheduled_for);
      db.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [originalScheduledFor, id]);
      automationScheduler.tick();
      const still = await runsOf(id);
      assert.equal(still.length, 1, 'duplicate occurrence rejected via idempotency key');

      await waitFor(() => runsOf(id).some((run) => run.status === 'completed'), 45_000, 'dup-guard run completes');
      await fetch(`${baseUrl}/api/automations/${id}`, { method: 'DELETE', headers: jsonHeaders(tokenA) });
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
    }
  });

  it('runs multi-step automations with per-step goals and dependencies', async () => {
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    process.env.OPENAI_BASE_URL = modelFixture.baseUrl;
    try {
      const created = await createAutomation(tokenA, {
        name: 'multi-step',
        schedule: { kind: 'interval', seconds: 3600 },
        steps: [
          { agent_slug: AGENT, goal: 'First: gather sources on renewable energy' },
          { agent_slug: AGENT, goal: 'Second: verify the gathered claims independently' },
        ],
      });
      assert.equal(created.status, 201);
      const runResponse = await fetch(`${baseUrl}/api/automations/${created.id}/run`, { method: 'POST', headers: jsonHeaders(tokenA) });
      assert.equal(runResponse.status, 202);

      await waitFor(() => runsOf(created.id).some((run) => run.status === 'completed' || run.status === 'failed'), 60_000, 'multi-step run settles');
      const run = (await runsOf(created.id))[0] as { status: string; workflow_id: string };
      assert.equal(run.status, 'completed', 'multi-step workflow completed');
      const steps = db.all<{ step_order: number; status: string; goal: string; task_id: string | null }>(
        'SELECT step_order, status, goal, task_id FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order',
        [run.workflow_id],
      );
      assert.equal(steps.length, 2);
      assert.equal(steps[0].goal, 'First: gather sources on renewable energy', 'per-step goal persisted and used');
      assert.equal(steps[1].goal, 'Second: verify the gathered claims independently');
      assert.ok(steps.every((step) => step.status === 'completed'), 'both steps completed');
      assert.ok(steps.every((step) => step.task_id), 'each step ran through a real task');
      await fetch(`${baseUrl}/api/automations/${created.id}`, { method: 'DELETE', headers: jsonHeaders(tokenA) });
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
    }
  });

  // -------------------------------------------------------------------
  // Failure, retry, timeout, refund
  // -------------------------------------------------------------------

  it('fails honestly without retries for permanent errors and refunds the credit', async () => {
    // No model provider configured -> provider_not_configured (permanent).
    const before = db.get<{ free_credits: number }>(`SELECT free_credits FROM credit_accounts WHERE user_id = ?`, [userIdA])!.free_credits;

    const created = await createAutomation(tokenA, { name: 'perm-fail', max_retries: 4 });
    assert.equal(created.status, 201);
    const runResponse = await fetch(`${baseUrl}/api/automations/${created.id}/run`, { method: 'POST', headers: jsonHeaders(tokenA) });
    assert.equal(runResponse.status, 202);

    await waitFor(() => runsOf(created.id).some((run) => run.status === 'failed'), 30_000, 'permanent failure settles');
    const run = (await runsOf(created.id))[0] as { status: string; job_id: string; error_message: string };
    assert.equal(run.status, 'failed');
    assert.ok(String(run.error_message).includes('workflow failed') || run.error_message === null);
    const job = getJob(run.job_id);
    assert.equal(job?.attempts, 1, 'permanent errors must not be retried');

    const after = db.get<{ free_credits: number }>(`SELECT free_credits FROM credit_accounts WHERE user_id = ?`, [userIdA])!.free_credits;
    assert.equal(after, before, 'failed step refunded the reserved credit (trust policy)');

    await waitFor(
      () => listNotifications(userIdA).some((row) => String(row.title) === 'Automation failed' && String(row.data ?? '').includes(created.id)),
      10_000,
      'failure notification',
    );
    assert.equal(getAutomationRow(created.id)!.fail_count, 1);
    await fetch(`${baseUrl}/api/automations/${created.id}`, { method: 'DELETE', headers: jsonHeaders(tokenA) });
  });

  it('retries transient failures and recovers (attempt 2 succeeds)', async () => {
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    process.env.OPENAI_BASE_URL = modelFixture.baseUrl;
    try {
      const created = await createAutomation(tokenA, { name: 'retry-case', max_retries: 1 });
      assert.equal(created.status, 201);

      modelFixture.setMode('down'); // every model call -> HTTP 500 (transient)
      const runResponse = await fetch(`${baseUrl}/api/automations/${created.id}/run`, { method: 'POST', headers: jsonHeaders(tokenA) });
      assert.equal(runResponse.status, 202);
      const runRow = (await runsOf(created.id))[0] as { job_id: string };
      // Attempt 1 must fail and the job must land in 'retrying' (backoff
      // window) — flip the provider healthy BEFORE attempt 2 is claimed.
      await waitFor(() => getJob(runRow.job_id)?.status === 'retrying', 30_000, 'job to schedule its retry');
      modelFixture.setMode('ok'); // provider recovers inside the backoff window
      await waitFor(() => (getJob(runRow.job_id)?.attempts ?? 0) >= 2, 60_000, 'retry attempt to start');
      await waitFor(() => runsOf(created.id).some((run) => run.status === 'completed'), 60_000, 'retried run to complete');
      const run = (await runsOf(created.id))[0] as { status: string; job_id: string };
      assert.equal(run.status, 'completed');
      assert.equal(getJob(run.job_id)?.attempts, 2, 'succeeded on the retry attempt');
      await fetch(`${baseUrl}/api/automations/${created.id}`, { method: 'DELETE', headers: jsonHeaders(tokenA) });
    } finally {
      modelFixture.setMode('ok');
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
    }
  });

  it('enforces the per-automation timeout', async () => {
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    process.env.OPENAI_BASE_URL = modelFixture.baseUrl;
    try {
      modelFixture.setDelay(9000); // each model call takes 9s
      const created = await createAutomation(tokenA, { name: 'timeout-case', timeout_ms: 5000, max_retries: 0 });
      assert.equal(created.status, 201);
      const runResponse = await fetch(`${baseUrl}/api/automations/${created.id}/run`, { method: 'POST', headers: jsonHeaders(tokenA) });
      assert.equal(runResponse.status, 202);

      await waitFor(() => runsOf(created.id).some((run) => run.status === 'failed'), 45_000, 'timeout to settle the run');
      const run = (await runsOf(created.id))[0] as { status: string; job_id: string; error_message: string };
      assert.equal(run.status, 'failed');
      assert.equal(String(run.error_message), 'workflow timed out');
      assert.equal(getJob(run.job_id)?.status, 'timed_out');
      await fetch(`${baseUrl}/api/automations/${created.id}`, { method: 'DELETE', headers: jsonHeaders(tokenA) });
    } finally {
      modelFixture.setDelay(0);
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
    }
  });

  it('supports safe cancellation of an in-flight run', async () => {
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    process.env.OPENAI_BASE_URL = modelFixture.baseUrl;
    try {
      modelFixture.setDelay(6000);
      const before = db.get<{ free_credits: number }>(`SELECT free_credits FROM credit_accounts WHERE user_id = ?`, [userIdA])!.free_credits;
      const created = await createAutomation(tokenA, { name: 'cancel-case', max_retries: 0 });
      assert.equal(created.status, 201);
      const runResponse = await fetch(`${baseUrl}/api/automations/${created.id}/run`, { method: 'POST', headers: jsonHeaders(tokenA) });
      assert.equal(runResponse.status, 202);
      const runBody = (await runResponse.json()) as { run: { id: string } };

      await waitFor(() => {
        const row = db.get<{ status: string }>('SELECT status FROM automation_runs WHERE id = ?', [runBody.run.id]);
        return row?.status === 'running' || row?.status === 'queued';
      }, 10_000, 'run to be in flight');

      const cancel = await fetch(`${baseUrl}/api/automations/${created.id}/runs/${runBody.run.id}/cancel`, { method: 'POST', headers: jsonHeaders(tokenA) });
      assert.equal(cancel.status, 200);

      await waitFor(() => getJob((db.get('SELECT job_id FROM automation_runs WHERE id = ?', [runBody.run.id]) as { job_id: string }).job_id)?.status === 'cancelled', 30_000, 'job cancelled');
      const run = db.get<{ status: string }>('SELECT status FROM automation_runs WHERE id = ?', [runBody.run.id]);
      assert.equal(run?.status, 'cancelled');

      // The in-flight step's reserved credit is refunded (trust policy).
      await waitFor(() => {
        const after = db.get<{ free_credits: number }>(`SELECT free_credits FROM credit_accounts WHERE user_id = ?`, [userIdA])!.free_credits;
        return after === before;
      }, 30_000, 'cancelled step refund');

      // Cancelling a terminal run is a 409, not a mutation.
      const again = await fetch(`${baseUrl}/api/automations/${created.id}/runs/${runBody.run.id}/cancel`, { method: 'POST', headers: jsonHeaders(tokenA) });
      assert.equal(again.status, 409);
      await fetch(`${baseUrl}/api/automations/${created.id}`, { method: 'DELETE', headers: jsonHeaders(tokenA) });
    } finally {
      modelFixture.setDelay(0);
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
    }
  });

  // -------------------------------------------------------------------
  // Conditions, credits, pause/resume, recovery
  // -------------------------------------------------------------------

  it('gates scheduled firing on conditions (skip, do not fail)', async () => {
    const created = await createAutomation(tokenA, {
      name: 'cond-gate',
      schedule: { kind: 'once', run_at: new Date(Date.now() + 1500).toISOString() },
      condition: { all: [{ type: 'last_run_outcome', equals: 'completed' }] },
    });
    assert.equal(created.status, 201);
    await waitFor(() => runsOf(created.id).length > 0, 15_000, 'condition evaluation to happen');
    const run = (await runsOf(created.id))[0] as { status: string; error_message: string };
    assert.equal(run.status, 'skipped', 'no previous run -> occurrence skipped');
    assert.ok(String(run.error_message).includes('no previous run'), `skip reason recorded (got: ${run.error_message})`);
    assert.equal(getAutomationRow(created.id)!.next_run_at, null, 'once schedule consumed by the skip');
    await fetch(`${baseUrl}/api/automations/${created.id}`, { method: 'DELETE', headers: jsonHeaders(tokenA) });
  });

  it('auto-pauses when the owner has no task credits (no useless looping)', async () => {
    const restoreCredits = () => db.run(`UPDATE credit_accounts SET free_credits = 50, free_credits_used = 0 WHERE user_id = ?`, [userIdA]);
    try {
    db.run(`UPDATE credit_accounts SET free_credits = 0, paid_credits = 0, bonus_credits = 0 WHERE user_id = ?`, [userIdA]);
    const created = await createAutomation(tokenA, {
      name: 'no-credits',
      schedule: { kind: 'once', run_at: new Date(Date.now() + 1500).toISOString() },
    });
    assert.equal(created.status, 201);
    await waitFor(() => getAutomationRow(created.id)!.status === 'paused', 15_000, 'auto-pause');
    const runs = await runsOf(created.id);
    assert.equal(runs.length, 1);
    assert.equal(String((runs[0] as { status: string }).status), 'skipped');
    assert.ok(String((runs[0] as { error_message: string }).error_message).includes('credits'));
    await waitFor(
      () => listNotifications(userIdA).some((row) => String(row.title) === 'Automation paused' && String(row.data ?? '').includes(created.id)),
      10_000,
      'attention notification',
    );
    const audit = db.get(`SELECT id FROM audit_logs WHERE action = 'automation.auto_paused' AND resource_id = ?`, [created.id]);
    assert.ok(audit, 'auto-pause audited');

    // Manual runs also refuse honestly (402 requires-pro).
    const manual = await fetch(`${baseUrl}/api/automations/${created.id}/run`, { method: 'POST', headers: jsonHeaders(tokenA) });
    assert.equal(manual.status, 402);

    await fetch(`${baseUrl}/api/automations/${created.id}`, { method: 'DELETE', headers: jsonHeaders(tokenA) });
    } finally {
      // Restore credits for later tests (register grants 5) — must happen even
      // if an assertion above throws, or subsequent tests starve.
      restoreCredits();
    }
  });

  it('pauses, resumes and edits safely', async () => {
    const created = await createAutomation(tokenA, { name: 'lifecycle' });
    assert.equal(created.status, 201);
    const id = created.id;

    const pause = await fetch(`${baseUrl}/api/automations/${id}/pause`, { method: 'POST', headers: jsonHeaders(tokenA) });
    assert.equal(pause.status, 200);
    assert.equal(getAutomationRow(id)!.status, 'paused');
    assert.equal(getAutomationRow(id)!.next_run_at, null, 'paused => no pending occurrence');

    const pauseAgain = await fetch(`${baseUrl}/api/automations/${id}/pause`, { method: 'POST', headers: jsonHeaders(tokenA) });
    assert.equal(pauseAgain.status, 409);

    const resume = await fetch(`${baseUrl}/api/automations/${id}/resume`, { method: 'POST', headers: jsonHeaders(tokenA) });
    assert.equal(resume.status, 200);
    const resumed = getAutomationRow(id)!;
    assert.equal(resumed.status, 'active');
    assert.ok(Date.parse(String(resumed.next_run_at)) > Date.now(), 'resume recomputes next occurrence from now');

    const edit = await fetch(`${baseUrl}/api/automations/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders(tokenA),
      body: JSON.stringify({ name: 'lifecycle-2', schedule: { kind: 'cron', expr: '0 6 * * *', tz: 'Asia/Karachi' }, steps: [{ agent_slug: AGENT, goal: 'edited goal' }] }),
    });
    assert.equal(edit.status, 200);
    const edited = getAutomationRow(id)!;
    assert.equal(edited.name, 'lifecycle-2');
    assert.equal(JSON.parse(edited.schedule_json).tz, 'Asia/Karachi');
    assert.equal(new Date(Date.parse(String(edited.next_run_at))).toISOString(), new Date(Date.parse(String(edited.next_run_at))).toISOString());

    const del = await fetch(`${baseUrl}/api/automations/${id}`, { method: 'DELETE', headers: jsonHeaders(tokenA) });
    assert.equal(del.status, 204);
    assert.equal(getAutomationRow(id), undefined, 'deleted');
  });

  it('rate-limits manual triggers (cooldown)', async () => {
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    process.env.OPENAI_BASE_URL = modelFixture.baseUrl;
    try {
      const created = await createAutomation(tokenA, { name: 'cooldown' });
      const first = await fetch(`${baseUrl}/api/automations/${created.id}/run`, { method: 'POST', headers: jsonHeaders(tokenA) });
      assert.equal(first.status, 202);
      const second = await fetch(`${baseUrl}/api/automations/${created.id}/run`, { method: 'POST', headers: jsonHeaders(tokenA) });
      assert.equal(second.status, 409, 'second immediate manual trigger rejected');
      await fetch(`${baseUrl}/api/automations/${created.id}`, { method: 'DELETE', headers: jsonHeaders(tokenA) });
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
    }
  });

  it('recovers runs orphaned by a crash (no job attached)', async () => {
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    process.env.OPENAI_BASE_URL = modelFixture.baseUrl;
    try {
      const created = await createAutomation(tokenA, { name: 'crash-recovery', max_retries: 0 });
      assert.equal(created.status, 201);

      // Simulate a crash between run insertion and enqueue: a queued run with
      // no job, created two minutes in the past.
      const orphan = insertAutomationRun({
        automationId: created.id,
        userId: userIdA,
        triggerReason: 'schedule',
        idempotencyKey: `occ:${created.id}:orphan-${suffix}`,
        scheduledFor: new Date(Date.now() - 120_000).toISOString(),
      });
      assert.ok(orphan, 'orphan inserted');
      db.run(`UPDATE automation_runs SET created_at = ? WHERE id = ?`, [new Date(Date.now() - 120_000).toISOString(), orphan!.id]);

      const { automationScheduler } = await import('./scheduler');
      automationScheduler.tick();

      const attached = db.get<{ job_id: string; workflow_id: string }>('SELECT job_id, workflow_id FROM automation_runs WHERE id = ?', [orphan!.id]);
      assert.ok(attached?.job_id, 'recovery re-launched the run through the queue');
      assert.ok(attached?.workflow_id, 'recovery created the workflow');

      await waitFor(() => {
        const row = db.get<{ status: string }>('SELECT status FROM automation_runs WHERE id = ?', [orphan!.id]);
        return row?.status === 'completed';
      }, 45_000, 'recovered run completes');
      assert.equal((db.get<{ attempt: number }>('SELECT attempt FROM automation_runs WHERE id = ?', [orphan!.id]) as { attempt: number }).attempt, 2, 'attempt budget used');
      await fetch(`${baseUrl}/api/automations/${created.id}`, { method: 'DELETE', headers: jsonHeaders(tokenA) });
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
    }
  });

  it('caps active automations per account (abuse protection)', async () => {
    // User C: create the max (25), then expect 409.
    for (let i = 0; i < 25; i += 1) {
      const created = await createAutomation(tokenC, { name: `bulk-${i}` });
      assert.equal(created.status, 201, `automation ${i + 1} of 25 must be accepted`);
    }
    const twentySixth = await createAutomation(tokenC, { name: 'bulk-overflow' });
    assert.equal(twentySixth.status, 409, '26th active automation must be rejected');
    const rows = db.all('SELECT id FROM automations WHERE user_id = ? AND schedule_json IS NOT NULL', [userIdC]);
    assert.equal(rows.length, 25, 'exactly 25 stored');
    // cleanup
    db.run(`DELETE FROM automations WHERE user_id = ?`, [userIdC]);
  });
});
