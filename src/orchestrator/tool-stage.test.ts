import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  db,
  createUser,
  findTaskById,
  getCreditAccount,
  getAgentExecution,
  listExecutionLogs,
  grantCredit,
  indexKnowledgeItem,
} from '../db';
import { syncAgentRegistry } from '../agents/registry';
import { createAgentTask, runGenericAgentExecution } from './executor';
import { startModelFixture, type ModelFixtureServer } from '../test-support/model-provider-fixture';

/**
 * Regression suite for the "No knowledge results" production defect.
 *
 * Root cause (fixed): the bounded tool stage treated a SUCCESSFUL
 * knowledge_search with ZERO results as real verified tool context and
 * injected `[]` into the model prompt under a "cite only these sources"
 * header — so the model correctly answered that no knowledge/sources
 * existed, producing empty "No knowledge results" output on otherwise
 * healthy model-only tasks.
 *
 * These tests pin the corrected behavior:
 *   1. Empty knowledge base  -> no context injected, honest log, the task
 *      still completes model-only with real provider output.
 *   2. Unreachable web search -> honest, actionable failure log naming the
 *      operator knob; the task still completes model-only.
 *   3. Indexed knowledge     -> real context IS injected (fix must not
 *      break the genuine knowledge path).
 *   4. Full Google/Gemini wire-protocol execution path (generateContent
 *      with the x-goog-api-key header) -> verified completion with usage
 *      accounting — the exact production provider path.
 */

const PROVIDER_ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'GOOGLE_API_KEY',
  'GOOGLE_BASE_URL',
  'AKBARAL_SEARCH_ENDPOINT',
  'AKBARAL_PAGE_FETCH_ENDPOINT',
  'AKBARAL_ALLOW_PRIVATE_PROVIDER',
] as const;

const savedEnv = new Map<string, string | undefined>();

function clearProviderEnv(): void {
  for (const key of PROVIDER_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
}

function restoreProviderEnv(): void {
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

const AGENT = 'research-researcher-002'; // permissions: web_search, page_fetch, knowledge_search

const suffix = randomBytes(6).toString('hex');
const email = `tool-stage-${suffix}@akbaral.test`;
let userId = '';
let fixture: ModelFixtureServer;
let baselineCredits = 0;
const taskIds: string[] = [];

interface GeminiFixture {
  baseUrl: string;
  requests: Array<{ url: string; headers: Record<string, string | string[] | undefined>; body: string }>;
  close(): Promise<void>;
}

/** Real Gemini generateContent wire protocol fixture (success shape). */
async function startGeminiFixture(answer: string): Promise<GeminiFixture> {
  const requests: GeminiFixture['requests'] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      requests.push({ url: req.url ?? '/', headers: { ...req.headers }, body: raw });
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: answer }], role: 'model' }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 350, candidatesTokenCount: 240, totalTokenCount: 590 },
          modelVersion: 'gemini-2.0-flash',
        }),
      );
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

const GEMINI_ANSWER = `## Specialist deliverable

This analysis addresses the requested goal directly and completely with
structured, substantive content produced by the model router.

### Findings
- The request has been analyzed against the declared specialist contract.
- Key considerations, tradeoffs and risks are documented in this section.
- Every claim here is derived from the agent instructions, not invented.

### Recommendation
Proceed with the structured plan. The deliverable includes the analysis,
the recommended approach and concrete next steps for the operator.

### Next steps
1. Review the findings section.
2. Approve or adjust the recommended approach.
3. Schedule the follow-up work.`;

function logMessages(executionId: string): string[] {
  return listExecutionLogs(executionId).map((log) => String((log as { message: string }).message));
}

function outputOf(executionId: string): Record<string, unknown> {
  const execution = getAgentExecution(executionId) as { output_data?: string } | undefined;
  assert.ok(execution?.output_data, 'execution must have output data');
  return JSON.parse(String(execution.output_data)) as Record<string, unknown>;
}

async function dispatchAndRun(goal: string): Promise<{ taskId: string; executionId: string }> {
  const dispatched = createAgentTask({ userId, agentSlug: AGENT, goal });
  taskIds.push(dispatched.taskId);
  const result = await runGenericAgentExecution(dispatched.executionId, AGENT);
  assert.equal(result.status, 'completed', `expected completion, got ${JSON.stringify(result)}`);
  return { taskId: dispatched.taskId, executionId: dispatched.executionId };
}

describe('bounded tool stage — "No knowledge results" regression', () => {
  before(async () => {
    clearProviderEnv();
    // Private local fixture hosts must be allowed (test-only override).
    process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = '1';
    // Web search pointed at a dead local port: deterministic, instant
    // refusal, no external egress dependency.
    process.env.AKBARAL_SEARCH_ENDPOINT = 'http://127.0.0.1:9/search';
    syncAgentRegistry();
    const user = createUser({ email, name: 'Tool Stage Test' });
    userId = user.id;
    grantCredit({ userId, amount: 10, reason: 'tool-stage test top-up' });
    baselineCredits = getCreditAccount(userId)?.free_credits ?? 0;
    fixture = await startModelFixture('ok');
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    process.env.OPENAI_BASE_URL = fixture.baseUrl;
  });

  after(async () => {
    for (const taskId of taskIds) {
      db.run('DELETE FROM model_runs WHERE task_id = ?', [taskId]);
      db.run('DELETE FROM agent_execution_logs WHERE execution_id IN (SELECT id FROM agent_executions WHERE task_id = ?)', [taskId]);
      db.run('DELETE FROM agent_executions WHERE task_id = ?', [taskId]);
      db.run('DELETE FROM task_events WHERE task_id = ?', [taskId]);
      db.run('DELETE FROM tasks WHERE id = ?', [taskId]);
    }
    db.run('DELETE FROM knowledge_items WHERE user_id = ?', [userId]);
    db.run('DELETE FROM users WHERE id = ?', [userId]);
    db.close();
    restoreProviderEnv();
    if (fixture) {
      await fixture.close();
    }
  });

  it('empty knowledge base: no [] injected as context, task completes model-only', async () => {
    const { taskId, executionId } = await dispatchAndRun('Analyse the artisan bakery subscription market');

    // The honest skip log, not a fake "real context" log.
    const logs = logMessages(executionId);
    assert.ok(
      logs.some((message) => message.includes('knowledge_search matched nothing')),
      'must log that knowledge_search matched nothing',
    );
    assert.ok(
      !logs.some((message) => /knowledge_search returned real context/.test(message)),
      'an empty knowledge result must never be logged or injected as real context',
    );

    // The model still ran and produced verified output (model-only task).
    const output = outputOf(executionId);
    assert.equal(output.type, 'agent_result');
    const content = String(output.content ?? '');
    assert.ok(content.length > 200, 'model output is substantive');
    const verification = output.verification as { passed: boolean };
    assert.equal(verification.passed, true);

    // Tool summary records the honest zero-result skip.
    const tools = output.tools as { ran?: Array<{ tool: string; ok: boolean; results?: number }> };
    const knowledgeRun = tools?.ran?.find((entry) => entry.tool === 'knowledge_search');
    assert.ok(knowledgeRun, 'knowledge_search ran');
    assert.equal(knowledgeRun.ok, true);
    assert.equal(knowledgeRun.results, 0);

    // Credit consumed exactly once for the successful task.
    assert.equal(findTaskById(taskId)?.status, 'completed');
    assert.equal(getCreditAccount(userId)?.free_credits, baselineCredits - taskIds.length);
  });

  it('unreachable web search: honest actionable log, task still completes', async () => {
    const { executionId } = await dispatchAndRun('Summarise adoption trends without web context');

    const logs = logMessages(executionId);
    const webLog = logs.find((message) => message.includes('web_search unavailable'));
    assert.ok(webLog, 'web_search failure is logged');
    assert.ok(
      webLog.includes('AKBARAL_SEARCH_ENDPOINT'),
      `the failure must name the operator knob: ${webLog}`,
    );

    const output = outputOf(executionId);
    assert.equal(output.type, 'agent_result');
    const tools = output.tools as { ran?: Array<{ tool: string; ok: boolean }> };
    assert.equal(tools?.ran?.find((entry) => entry.tool === 'web_search')?.ok, false);
  });

  it('indexed knowledge: real context IS injected and cited by the pipeline', async () => {
    indexKnowledgeItem({
      userId,
      projectId: null,
      fileId: null,
      sourceType: 'document',
      title: 'Bakery subscription playbook',
      content: 'The Karachi artisan bakery subscription pilot retained 68% of customers after three months.',
      mimeType: 'text/plain',
    });

    const { executionId } = await dispatchAndRun('Analyse bakery subscription retention using my notes');

    const logs = logMessages(executionId);
    assert.ok(
      logs.some((message) => /knowledge_search returned real context/.test(message)),
      'real knowledge must be injected as verified context',
    );

    const output = outputOf(executionId);
    const tools = output.tools as { ran?: Array<{ tool: string; ok: boolean; results?: number }> };
    const knowledgeRun = tools?.ran?.find((entry) => entry.tool === 'knowledge_search');
    assert.equal(knowledgeRun?.ok, true);
    assert.equal(knowledgeRun?.results, 1);
  });

  it('full Google/Gemini wire path: header auth, verified completion, usage accounting', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    process.env.GOOGLE_API_KEY = 'test-google-key';

    const gemini = await startGeminiFixture(GEMINI_ANSWER);
    try {
      process.env.GOOGLE_BASE_URL = gemini.baseUrl;
      const { taskId, executionId } = await dispatchAndRun('Produce a Gemini-sourced market brief');

      // The request spoke the real Gemini protocol with header auth.
      assert.equal(gemini.requests.length, 1, 'exactly one generateContent request');
      const request = gemini.requests[0];
      assert.match(request.url, /\/models\/[^:]+:generateContent$/, 'generateContent endpoint');
      assert.ok(!request.url.includes('key='), 'the API key must never travel in the URL');
      assert.equal(request.headers['x-goog-api-key'], 'test-google-key', 'header auth used');

      // Task completed through verification with the Gemini output.
      const output = outputOf(executionId);
      assert.equal(output.provider, 'google');
      assert.equal(output.model, 'gemini-2.0-flash');
      assert.ok(String(output.content).includes('Specialist deliverable'));

      // Usage accounting recorded on the model_runs table.
      const runs = db.all(
        'SELECT * FROM model_runs WHERE task_id = ? ORDER BY created_at',
        [taskId],
      ) as Array<Record<string, unknown>>;
      assert.equal(runs.length, 1);
      assert.equal(runs[0].provider_key, 'google');
      assert.equal(runs[0].status, 'succeeded');
      assert.equal(runs[0].input_tokens, 350);
      assert.equal(runs[0].output_tokens, 240);
    } finally {
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_BASE_URL;
      await gemini.close();
      process.env.OPENAI_API_KEY = 'test-fixture-key';
      process.env.OPENAI_BASE_URL = fixture.baseUrl;
    }
  });
});
