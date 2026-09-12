import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { db, createTask, createUser } from '../db';
import { modelRouter } from './router';
import { ProviderCallError } from './client';
import { classifyExecutionError } from '../orchestrator/errors';
import { safeProviderErrorMessage, logErrorSafe } from '../config/secrets';
import { startModelFixture, type ModelFixtureServer } from '../test-support/model-provider-fixture';

/**
 * Phase 4 provider hardening regression suite.
 *
 * Executes the REAL provider adapter + router code paths against local
 * fixture servers (no external egress, no real credentials):
 *
 *   1. Google adapter sends the API key in the x-goog-api-key HEADER —
 *      never in the URL (URLs can leak into logs).
 *   2. Provider usage metadata flows into model_runs (input/output tokens,
 *      cost cents) — accounting happens on the real execution path.
 *   3. AKBARAL_PROVIDER_TIMEOUT_MS is honored; a hung provider fails fast
 *      with an honest message and a failed model_runs row.
 *   4. Provider errors never echo credentials, even when a hostile provider
 *      echoes the Authorization header back in its error body; error
 *      messages stay status-honest (a 500 is a server error, not an auth
 *      problem).
 *   5. ProviderCallError.retryable + classifyExecutionError: permanent 4xx
 *      provider failures are not retried; transient ones are.
 *   6. Client bundles served to the browser never contain provider env key
 *      names or key-shaped literals.
 */

const PROVIDER_ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_BASE_URL',
  'AKBARAL_PROVIDER_TIMEOUT_MS',
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

interface CapturedRequest {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface RawFixtureServer {
  baseUrl: string;
  requests: CapturedRequest[];
  close(): Promise<void>;
}

/** Minimal raw HTTP fixture so tests can assert on headers and URLs. */
async function startRawFixture(
  handler: (req: CapturedRequest, res: http.ServerResponse) => void,
): Promise<RawFixtureServer> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      const captured: CapturedRequest = {
        url: req.url ?? '/',
        headers: { ...req.headers },
        body: raw,
      };
      requests.push(captured);
      handler(captured, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

const suffix = randomBytes(6).toString('hex');
const email = `provider-hardening-${suffix}@akbaral.test`;
let userId = '';
let openaiFixture: ModelFixtureServer;
let createdTaskIds: string[] = [];

function freshTaskId(): string {
  const task = createTask({
    userId,
    title: 'provider hardening probe',
    description: 'test task for model_runs accounting assertions',
    type: 'free',
    projectId: null,
    agentId: null,
    inputData: { goal: 'provider hardening probe' },
  });
  createdTaskIds.push(task.id);
  return task.id;
}

function modelRunsForTask(taskId: string): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM model_runs WHERE task_id = ? ORDER BY created_at', [taskId]) as Array<
    Record<string, unknown>
  >;
}

function assertNoCredentialMaterial(text: string, label: string): void {
  assert.ok(!text.includes('test-google-key'), `${label} must not contain the Google API key`);
  assert.ok(!text.includes('test-fixture-key'), `${label} must not contain the OpenAI API key`);
  assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(text), `${label} must not contain key-shaped literals`);
  assert.ok(!/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/.test(text), `${label} must not contain bearer tokens`);
  assert.ok(!/[?&]key=/.test(text), `${label} must not contain a key query parameter`);
}

describe('provider hardening (Phase 4)', () => {
  before(async () => {
    clearProviderEnv();
    // Fixtures are private local hosts: private providers must be allowed.
    process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = '1';
    const user = createUser({ email, name: 'Provider Hardening Test' });
    userId = user.id;
    openaiFixture = await startModelFixture('ok');
  });

  after(async () => {
    for (const taskId of createdTaskIds) {
      db.run('DELETE FROM model_runs WHERE task_id = ?', [taskId]);
      db.run('DELETE FROM task_events WHERE task_id = ?', [taskId]);
      db.run('DELETE FROM tasks WHERE id = ?', [taskId]);
    }
    db.run('DELETE FROM users WHERE id = ?', [userId]);
    db.close();
    restoreProviderEnv();
    if (openaiFixture) {
      await openaiFixture.close();
    }
  });

  it('google adapter: key travels in the x-goog-api-key header, never in the URL', async () => {
    process.env.GOOGLE_API_KEY = 'test-google-key';
    const fixture = await startRawFixture((req, res) => {
      assert.ok(!req.url.includes('key='), `Google URL must not carry the key as a query parameter: ${req.url}`);
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: '## Gemini fixture deliverable\n\nStructured analysis for the requested goal.' }] } },
          ],
          usageMetadata: { promptTokenCount: 321, candidatesTokenCount: 123, totalTokenCount: 444 },
        }),
      );
    });
    try {
      process.env.GOOGLE_BASE_URL = fixture.baseUrl;
      const taskId = freshTaskId();
      const result = await modelRouter.complete(
        { capability: ['research'], preferredModelKey: 'gemini-2.0-flash', taskId },
        [{ role: 'user', content: 'Analyze this goal with the real Google adapter path.' }],
      );

      assert.equal(result.text.includes('Gemini fixture deliverable'), true);
      assert.equal(fixture.requests.length, 1, 'exactly one provider request');
      assert.equal(
        fixture.requests[0].headers['x-goog-api-key'],
        'test-google-key',
        'API key must be sent in the x-goog-api-key header',
      );
      assert.ok(!fixture.requests[0].url.includes('key='), 'URL must not contain the key');
      assertNoCredentialMaterial(fixture.requests[0].url, 'request URL');

      // Accounting: usageMetadata -> model_runs.
      const runs = modelRunsForTask(taskId);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].provider_key, 'google');
      assert.equal(runs[0].status, 'succeeded');
      assert.equal(runs[0].input_tokens, 321);
      assert.equal(runs[0].output_tokens, 123);
      assert.ok(typeof runs[0].cost_cents === 'number' && runs[0].cost_cents >= 0);
      assert.ok(typeof runs[0].latency_ms === 'number' && (runs[0].latency_ms as number) >= 0);
    } finally {
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_BASE_URL;
      await fixture.close();
    }
  });

  it('openai adapter: usage metadata is recorded to model_runs on the real router path', async () => {
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    process.env.OPENAI_BASE_URL = openaiFixture.baseUrl;
    try {
      const taskId = freshTaskId();
      const result = await modelRouter.complete(
        { capability: ['research'], preferredModelKey: 'gpt-4o-mini', taskId },
        [{ role: 'user', content: 'Produce a substantive specialist deliverable.' }],
      );
      assert.ok(result.text.length > 0);

      const runs = modelRunsForTask(taskId);
      assert.equal(runs.length, 1, 'exactly one model run recorded');
      assert.equal(runs[0].provider_key, 'openai');
      assert.equal(runs[0].status, 'succeeded');
      // The fixture reports usage: prompt_tokens 100, completion_tokens 200.
      assert.equal(runs[0].input_tokens, 100);
      assert.equal(runs[0].output_tokens, 200);
      assert.ok(typeof runs[0].cost_cents === 'number' && runs[0].cost_cents >= 0);
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
    }
  });

  it('AKBARAL_PROVIDER_TIMEOUT_MS: a hung provider fails fast and honestly', async () => {
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    const fixture = await startRawFixture((_req, res) => {
      // Never respond: simulates a hung provider.
      setTimeout(() => res.end(), 60_000);
    });
    try {
      process.env.OPENAI_BASE_URL = fixture.baseUrl;
      process.env.AKBARAL_PROVIDER_TIMEOUT_MS = '2000';
      const taskId = freshTaskId();
      const started = Date.now();

      await assert.rejects(
        modelRouter.complete(
          { capability: ['research'], preferredModelKey: 'gpt-4o-mini', taskId },
          [{ role: 'user', content: 'This request must time out.' }],
        ),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assertNoCredentialMaterial(error.message, 'timeout error message');
          return true;
        },
      );

      const elapsed = Date.now() - started;
      assert.ok(elapsed < 15_000, `provider timeout must fire near AKBARAL_PROVIDER_TIMEOUT_MS (took ${elapsed}ms)`);

      // The router's model-level fallback chain may try the next model too —
      // every attempt must be recorded as failed, none may succeed.
      const runs = modelRunsForTask(taskId);
      assert.ok(runs.length >= 1, 'at least one model run recorded');
      assert.ok(runs.every((run) => run.status === 'failed'), 'no run may succeed against a hung provider');
      for (const run of runs) {
        assertNoCredentialMaterial(String(run.error_message ?? ''), 'model_runs.error_message');
      }
    } finally {
      delete process.env.AKBARAL_PROVIDER_TIMEOUT_MS;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
      await fixture.close();
    }
  });

  it('hostile provider error bodies never surface credentials; messages stay status-honest', async () => {
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    process.env.OPENAI_BASE_URL = openaiFixture.baseUrl;
    openaiFixture.setMode('unauthorized');
    try {
      const taskId = freshTaskId();
      await assert.rejects(
        modelRouter.complete(
          { capability: ['research'], preferredModelKey: 'gpt-4o-mini', taskId },
          [{ role: 'user', content: 'This request is rejected with 401.' }],
        ),
        (error: unknown) => {
          assert.ok(error instanceof ProviderCallError, 'provider HTTP failure maps to ProviderCallError');
          assert.equal(error.status, 401);
          // Honest status class: 401 is a credentials problem, not a server error.
          assert.ok(error.message.includes('HTTP 401'), `message must name the status: ${error.message}`);
          assert.ok(!error.message.includes('HTTP 500'), 'a 401 must not be described as a server error');
          // The fixture echoes the Authorization header in its body — that
          // body must never reach the error message.
          assertNoCredentialMaterial(error.message, 'provider error message');
          return true;
        },
      );

      // The fallback chain may attempt further models; every recorded run
      // must be failed and credential-free.
      const runs = modelRunsForTask(taskId);
      assert.ok(runs.length >= 1, 'at least one model run recorded');
      assert.ok(runs.every((run) => run.status === 'failed'), 'no run may succeed against a 401 provider');
      for (const run of runs) {
        assertNoCredentialMaterial(String(run.error_message ?? ''), 'model_runs.error_message');
      }

      // The safe logger redacts the same material defensively.
      const error = new Error('provider failed with Bearer test-fixture-key and AIzaAbCdEfGh123456789012345678');
      let logged = '';
      const originalStderr = console.error;
      console.error = (line: string) => {
        logged += line;
      };
      try {
        logErrorSafe('provider-hardening-test', error);
      } finally {
        console.error = originalStderr;
      }
      assert.ok(logged.includes('[REDACTED]'), 'redaction mask applied');
      assertNoCredentialMaterial(logged, 'logErrorSafe output');
    } finally {
      openaiFixture.setMode('ok');
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
    }
  });

  it('safeProviderErrorMessage reports the honest status class for each bucket', () => {
    const cases: Array<{ status: number; mustInclude: string; mustNotInclude: string }> = [
      { status: 401, mustInclude: 'credentials', mustNotInclude: 'server error' },
      { status: 403, mustInclude: 'credentials', mustNotInclude: 'server error' },
      { status: 429, mustInclude: 'rate limited', mustNotInclude: 'credentials' },
      { status: 500, mustInclude: 'server error', mustNotInclude: 'credentials' },
      { status: 503, mustInclude: 'server error', mustNotInclude: 'credentials' },
      { status: 400, mustInclude: 'rejected the request', mustNotInclude: 'credentials' },
    ];
    for (const { status, mustInclude, mustNotInclude } of cases) {
      const message = safeProviderErrorMessage('google', status, '{"echoed":"AIzaAbCdEfGh123456789012345678"}');
      assert.ok(message.includes(`HTTP ${status}`), `message must name HTTP ${status}: ${message}`);
      assert.ok(message.includes(mustInclude), `HTTP ${status} message must mention "${mustInclude}": ${message}`);
      assert.ok(!message.includes(mustNotInclude), `HTTP ${status} message must not say "${mustNotInclude}": ${message}`);
      assert.ok(!message.includes('echoed'), 'raw provider body must never be included');
    }
  });

  it('ProviderCallError.retryable: 4xx is permanent, 429/5xx/network are transient', () => {
    assert.equal(new ProviderCallError('openai', 'm', 400).retryable, false);
    assert.equal(new ProviderCallError('openai', 'm', 401).retryable, false);
    assert.equal(new ProviderCallError('openai', 'm', 403).retryable, false);
    assert.equal(new ProviderCallError('openai', 'm', 404).retryable, false);
    assert.equal(new ProviderCallError('openai', 'm', 408).retryable, true);
    assert.equal(new ProviderCallError('openai', 'm', 429).retryable, true);
    assert.equal(new ProviderCallError('openai', 'm', 500).retryable, true);
    assert.equal(new ProviderCallError('openai', 'm', 503).retryable, true);
    assert.equal(new ProviderCallError('openai', 'network dropped').retryable, true);
  });

  it('classifyExecutionError honors the typed retryable signal over inference', () => {
    // Permanent provider 4xx must not burn the retry budget.
    assert.equal(
      classifyExecutionError({ code: 'provider_call_failed', message: 'openai rejected credentials', retryable: false })
        .retryable,
      false,
    );
    // Transient provider 5xx stays retryable even under a generic code.
    assert.equal(
      classifyExecutionError({ code: 'execution_failed', message: 'openai server error', retryable: true }).retryable,
      true,
    );
    // Untyped errors keep the existing inference behavior.
    assert.equal(classifyExecutionError({ code: 'provider_not_configured', message: 'no provider' }).retryable, false);
    assert.equal(classifyExecutionError({ code: 'execution_failed', message: 'boom' }).retryable, true);
  });

  it('client bundles never contain provider credential key names or key-shaped literals', () => {
    const publicDir = join(process.cwd(), 'public');
    const bundles = readdirSync(publicDir).filter((file) => file.endsWith('.js'));
    assert.ok(bundles.length >= 1, 'expected at least one client bundle');
    for (const bundle of bundles) {
      const source = readFileSync(join(publicDir, bundle), 'utf8');
      assert.ok(!source.includes('GOOGLE_API_KEY'), `${bundle} must not reference GOOGLE_API_KEY`);
      assert.ok(!source.includes('OPENAI_API_KEY'), `${bundle} must not reference OPENAI_API_KEY`);
      assert.ok(!source.includes('ANTHROPIC_API_KEY'), `${bundle} must not reference ANTHROPIC_API_KEY`);
      assert.ok(!source.includes('AIza') && !/AIza[0-9A-Za-z_-]{20,}/.test(source), `${bundle} must not contain Google key literals`);
      assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(source), `${bundle} must not contain OpenAI key literals`);
      // A hardcoded bearer token literal would be a leaked credential. (The
      // template `Bearer ${accessToken}` is the user's own session token for
      // the AKBARAL API and is legitimate client code.)
      assert.ok(!/Bearer\s+[A-Za-z0-9._-]{20,}/.test(source), `${bundle} must not contain hardcoded bearer tokens`);
      assert.ok(!/[?&]key=/.test(source), `${bundle} must not carry key query parameters`);
    }
  });
});
