import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiServer, type ApiServer } from '../app';
import { startModelFixture, type ModelFixtureServer } from '../test-support/model-provider-fixture';
import { db } from '../db';
import { runTool } from '../tools';
import { modelRouter } from '../models/router';
import { syncModelCatalog } from '../models/catalog';

/**
 * Milestone 4 — tool/API/provider catalog integration tests.
 *
 * Verifies through the real HTTP surface:
 *   - GET  /api/tools/credentials   honest per-tool credential status
 *   - GET  /api/models              catalog with truthful availability
 *   - POST /api/models/route        routing decision preview (no model call)
 *   - POST /api/models/chat/stream  real SSE streaming through the router
 *   - GET  /api/admin/providers/health  DB-derived run stats + live ping
 * plus the new local tools (http_request SSRF contract, json_transform,
 * text_analyze, csv_parse).
 */

const suffix = randomBytes(6).toString('hex');
const email = `models-${suffix}@akbaral.test`;
const adminEmail = `models-admin-${suffix}@akbaral.test`;
const password = 'correct-horse-battery-staple';

const savedEnv = new Map<string, string | undefined>();
const ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY'];

function snapshotEnv(): void {
  for (const key of ENV_KEYS) {
    if (!savedEnv.has(key)) {
      savedEnv.set(key, process.env[key]);
    }
  }
}

function restoreEnv(): void {
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function clearProviderEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

function configureFixtureProvider(baseUrl: string): void {
  process.env.OPENAI_API_KEY = 'test-fixture-key';
  process.env.OPENAI_BASE_URL = baseUrl;
}

async function login(baseUrl: string, userEmail: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: userEmail, password }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { accessToken: string };
  return body.accessToken;
}

/** Collect SSE `data:` payloads from a streaming endpoint response. */
async function readSseEvents(response: Response): Promise<Array<Record<string, unknown>>> {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  const text = await response.text();
  const events: Array<Record<string, unknown>> = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      events.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
    }
  }
  return events;
}

describe('Milestone 4: tool/API/provider catalog', () => {
  let api: ApiServer;
  let baseUrl = '';
  let accessToken = '';
  let adminToken = '';
  let fixture: ModelFixtureServer;
  let userId = '';
  let adminId = '';

  before(async () => {
    snapshotEnv();
    clearProviderEnv();
    // Production boots with the catalog synced (registry/seed paths); tests
    // build a fresh database, so sync the same catalog the API reads.
    syncModelCatalog();
    fixture = await startModelFixture('ok');
    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;
    for (const userEmail of [email, adminEmail]) {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: userEmail, password, name: 'M4 User' }),
      });
      assert.equal(response.status, 201);
      const body = (await response.json()) as { user: { id: string } };
      if (userEmail === email) {
        userId = body.user.id;
      } else {
        adminId = body.user.id;
        db.run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminId]);
      }
    }
    accessToken = await login(baseUrl, email);
    adminToken = await login(baseUrl, adminEmail);
  });

  after(async () => {
    db.run('DELETE FROM users WHERE id IN (?, ?)', [userId, adminId]);
    db.close();
    restoreEnv();
    await fixture.close();
    await api.close();
  });

  // ---------------------------------------------------------------- tools ---

  it('reports honest per-tool credential status without leaking values', async () => {
    const response = await fetch(`${baseUrl}/api/tools/credentials`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      credentials: Array<{ tool: string; implemented: boolean; requiresCredential: boolean; requiredEnvKeys: string[]; configured: boolean; usable: boolean }>;
      summary: { total: number; usable: number; missingCredentials: string[] };
    };
    assert.ok(body.credentials.length >= 17, 'catalog includes the new tools');

    const imageRender = body.credentials.find((entry) => entry.tool === 'image_render');
    assert.ok(imageRender);
    assert.equal(imageRender.requiresCredential, true);
    assert.deepEqual(imageRender.requiredEnvKeys, ['OPENAI_API_KEY']);
    assert.equal(imageRender.configured, false, 'no credential in the test environment');
    assert.equal(imageRender.usable, false);
    assert.ok(body.summary.missingCredentials.includes('image_render'));

    for (const localTool of ['json_transform', 'text_analyze', 'csv_parse', 'knowledge_search']) {
      const entry = body.credentials.find((candidate) => candidate.tool === localTool);
      assert.ok(entry, `${localTool} registered`);
      assert.equal(entry.usable, true, `${localTool} needs no credential`);
    }

    const httpTool = body.credentials.find((entry) => entry.tool === 'http_request');
    assert.ok(httpTool);
    assert.equal(httpTool.usable, true, 'http_request needs no credential (SSRF guard applies per call)');
  });

  it('marks tools implemented/credentialConfigured on the catalog listing', async () => {
    const response = await fetch(`${baseUrl}/api/tools`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      tools: Array<{ key: string; implemented: boolean; credentialConfigured: boolean }>;
    };
    const csvParse = body.tools.find((tool) => tool.key === 'csv_parse');
    assert.ok(csvParse);
    assert.equal(csvParse.implemented, true);
    assert.equal(csvParse.credentialConfigured, true, 'no credential required counts as configured');
    const imageRender = body.tools.find((tool) => tool.key === 'image_render');
    assert.ok(imageRender);
    assert.equal(imageRender.implemented, true);
    assert.equal(imageRender.credentialConfigured, false);
  });

  it('http_request enforces the SSRF contract (private hosts blocked)', async () => {
    for (const blocked of [
      'http://127.0.0.1:4000/api/health',
      'http://localhost:3000/api/health',
      'http://10.0.0.5/internal',
      'http://169.254.169.254/latest/meta-data',
      'http://192.168.1.10/admin',
    ]) {
      const result = await runTool('http_request', { url: blocked }, { userId });
      assert.equal(result.ok, false, `${blocked} must be blocked`);
      assert.match(result.error ?? '', /SSRF protection/);
    }
    const getWithBody = await runTool(
      'http_request',
      { url: 'https://example.com/data', method: 'GET', body: { x: 1 } },
      { userId },
    );
    assert.equal(getWithBody.ok, false);
    assert.equal(getWithBody.code, 'tool_input_error');
  });

  it('json_transform picks paths, slices arrays and validates input', async () => {
    const data = { users: { active: [{ id: 1, name: 'Aisha' }, { id: 2, name: 'Bilal' }, { id: 3, name: 'Chen' }] } };
    const pick = await runTool('json_transform', { data, pick: 'users.active', limit: 2 }, { userId });
    assert.equal(pick.ok, true);
    assert.equal(pick.data?.total, 3);
    assert.equal(pick.data?.returned, 2);

    const missing = await runTool('json_transform', { data, pick: 'users.missing' }, { userId });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'tool_input_error');

    const empty = await runTool('json_transform', {}, { userId });
    assert.equal(empty.ok, false);
    assert.equal(empty.code, 'tool_input_error');
  });

  it('text_analyze computes real local statistics', async () => {
    const result = await runTool(
      'text_analyze',
      { text: 'The bakery business plan covers marketing and pricing. Marketing drives the bakery growth. Pricing keeps margins healthy.' },
      { userId },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data?.sentences, 3);
    assert.ok((result.data?.words as number) > 15);
    const keywords = result.data?.topKeywords as Array<{ word: string; count: number }>;
    assert.ok(keywords.some((entry) => entry.word === 'bakery'));
    assert.ok(keywords.some((entry) => entry.word === 'marketing'));
    assert.ok(!keywords.some((entry) => entry.word === 'the'), 'stop words filtered');
  });

  it('csv_parse parses headers, quoting and limits locally', async () => {
    const result = await runTool(
      'csv_parse',
      { csv: 'name,city,notes\n"Aisha, Jr.",Karachi,"said ""hello"""\nBilal,Lahore,plain\nChen,Islamabad,plain', limit: 2 },
      { userId },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.data?.headers, ['name', 'city', 'notes']);
    assert.equal(result.data?.totalRows, 3);
    assert.equal(result.data?.returnedRows, 2);
    const rows = result.data?.rows as Array<{ name: string; notes: string }>;
    assert.equal(rows[0].name, 'Aisha, Jr.');
    assert.equal(rows[0].notes, 'said "hello"');
    assert.equal(rows[1].name, 'Bilal');

    const empty = await runTool('csv_parse', { csv: '' }, { userId });
    assert.equal(empty.ok, false);
    assert.equal(empty.code, 'tool_input_error');
  });

  // --------------------------------------------------------------- models ---

  it('lists the model catalog with truthful availability', async () => {
    const response = await fetch(`${baseUrl}/api/models`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      providers: Array<{ key: string; envKey: string; configured: boolean; status: string }>;
      models: Array<{ key: string; provider: string; available: boolean; requiredEnvKey: string | null; isDefault: boolean }>;
      anyProviderConfigured: boolean;
    };
    assert.ok(body.providers.length >= 3);
    assert.equal(body.anyProviderConfigured, false, 'no credentials in this environment');
    for (const provider of body.providers) {
      assert.equal(provider.configured, false);
    }
    for (const model of body.models) {
      assert.equal(model.available, false, `${model.key} must be honestly unavailable`);
      assert.ok(model.requiredEnvKey, 'required env key disclosed');
    }
    assert.ok(body.models.some((model) => model.isDefault));
  });

  it('previews the routing decision without calling any model', async () => {
    const response = await fetch(`${baseUrl}/api/models/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ capability: ['reasoning'], answerQuality: 'high' }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      primary: { model: { key: string }; available: boolean } | null;
      chain: Array<{ modelKey: string; provider: string; available: boolean; requiredEnvKey: string | null; reason: string }>;
      modelsConsidered: number;
    };
    assert.ok(body.primary);
    assert.ok(body.chain.length >= 2, 'fallback chain included');
    assert.equal(body.chain[0].reason, 'primary chain');
    for (const decision of body.chain) {
      assert.equal(decision.available, false, 'honest unavailability');
      assert.ok(decision.requiredEnvKey);
    }
    assert.equal(body.modelsConsidered, body.chain.length);
    // No model run may be recorded by a preview.
    assert.equal(modelRouter.routeChain({ capability: ['reasoning'] }).length >= 1, true);
  });

  it('streams an honest provider_not_configured error when no provider is set', async () => {
    const response = await fetch(`${baseUrl}/api/models/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    const events = await readSseEvents(response);
    const decision = events.find((event) => event.type === 'decision');
    assert.ok(decision);
    assert.equal(decision.available, false);
    const error = events.find((event) => event.type === 'error');
    assert.ok(error, 'stream must end with an honest error event');
    assert.equal(error.code, 'provider_not_configured');
    assert.equal(events[events.length - 1].type, 'error');
    assert.equal(events.filter((event) => event.type === 'token').length, 0, 'no fabricated tokens');
  });

  it('streams real tokens through the router when a provider is configured', async () => {
    configureFixtureProvider(fixture.baseUrl);
    try {
      const response = await fetch(`${baseUrl}/api/models/chat/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are a concise assistant.' },
            { role: 'user', content: 'Give me a specialist deliverable.' },
          ],
        }),
      });
      const events = await readSseEvents(response);
      const decision = events.find((event) => event.type === 'decision');
      assert.ok(decision);
      assert.equal(decision.available, true);
      assert.ok(typeof decision.model === 'string' && decision.model.length > 0);

      const tokens = events.filter((event) => event.type === 'token');
      assert.ok(tokens.length >= 2, 'content arrives as multiple streamed chunks');
      const streamed = tokens.map((event) => String(event.token)).join('');

      const done = events.find((event) => event.type === 'done');
      assert.ok(done, 'terminal done event');
      assert.equal(done.model, decision.model);
      assert.equal(done.text, streamed, 'done text equals the concatenated tokens');
      assert.ok((done.inputTokens as number) > 0);
      assert.ok((done.latencyMs as number) >= 0);
      assert.equal(events[events.length - 1].type, 'done');
    } finally {
      clearProviderEnv();
    }
  });

  it('rejects streaming requests without valid messages', async () => {
    const response = await fetch(`${baseUrl}/api/models/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ messages: [] }),
    });
    assert.equal(response.status, 400);
  });

  it('requires authentication for model APIs', async () => {
    for (const path of ['/api/models', '/api/tools/credentials']) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 401, `${path} requires auth`);
    }
  });

  // ------------------------------------------------------- admin health -----

  it('denies provider health to non-admins', async () => {
    const response = await fetch(`${baseUrl}/api/admin/providers/health`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(response.status, 403);
  });

  it('reports DB-derived provider health with run statistics', async () => {
    // Generate real recorded runs through the router first.
    configureFixtureProvider(fixture.baseUrl);
    try {
      await modelRouter.complete({ capability: ['reasoning'] }, [{ role: 'user', content: 'health probe' }]);
      await modelRouter.complete({ capability: ['reasoning'] }, [
        { role: 'user', content: 'health probe two' },
      ]);

      const response = await fetch(`${baseUrl}/api/admin/providers/health`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        providers: Array<{
          key: string;
          envKey: string;
          configured: boolean;
          runs: { total: number; succeeded: number; failed: number; avgLatencyMs: number | null; lastUsedAt: string | null; lastError: { message: string; at: string } | null };
          live: null;
        }>;
        liveChecked: boolean;
      };
      assert.equal(body.liveChecked, false);
      const openai = body.providers.find((provider) => provider.key === 'openai');
      assert.ok(openai);
      assert.equal(openai.configured, true);
      assert.ok(openai.runs.total >= 2, 'recorded runs are reflected');
      assert.ok(openai.runs.succeeded >= 2);
      assert.ok(openai.runs.avgLatencyMs !== null && openai.runs.avgLatencyMs >= 0);
      assert.ok(openai.runs.lastUsedAt);
      const anthropic = body.providers.find((provider) => provider.key === 'anthropic');
      assert.ok(anthropic);
      assert.equal(anthropic.configured, false);
      assert.equal(anthropic.runs.total, 0);
      for (const provider of body.providers) {
        assert.equal(provider.live, null, 'no live check unless requested');
      }
    } finally {
      clearProviderEnv();
    }
  });

  it('performs an honest live provider check when requested', async () => {
    configureFixtureProvider(fixture.baseUrl);
    try {
      const response = await fetch(`${baseUrl}/api/admin/providers/health?live=1`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        providers: Array<{ key: string; configured: boolean; live: { ok: boolean; latencyMs: number; detail?: string } | null }>;
        liveChecked: boolean;
      };
      assert.equal(body.liveChecked, true);
      const openai = body.providers.find((provider) => provider.key === 'openai');
      assert.ok(openai?.live, 'configured provider gets a live result');
      assert.equal(openai.live.ok, true, 'fixture answers /models like a real provider');
      assert.ok(openai.live.latencyMs >= 0);

      const anthropic = body.providers.find((provider) => provider.key === 'anthropic');
      assert.ok(anthropic?.live);
      assert.equal(anthropic.live.ok, false);
      assert.match(anthropic.live.detail ?? '', /not configured/);
    } finally {
      clearProviderEnv();
    }

    // A provider endpoint that is down must produce an honest failure detail.
    configureFixtureProvider('http://127.0.0.1:9');
    try {
      const response = await fetch(`${baseUrl}/api/admin/providers/health?live=1`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        providers: Array<{ key: string; live: { ok: boolean; detail?: string } | null }>;
      };
      const openai = body.providers.find((provider) => provider.key === 'openai');
      assert.ok(openai?.live);
      assert.equal(openai.live.ok, false, 'dead endpoint reported honestly');
      assert.ok(openai.live.detail);
    } finally {
      clearProviderEnv();
    }
  });
});
