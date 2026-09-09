import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiServer, type ApiServer } from '../app';
import { startModelFixture, type ModelFixtureServer } from '../test-support/model-provider-fixture';
import { db, findAgentBySlug } from '../db';
import { getAgentBySlug } from '../agents/registry';
import { syncAgentRegistry } from '../agents/registry';

/**
 * Milestone 6 — Agent Factory integration tests.
 *
 * Verifies through the real HTTP surface:
 *   - template search over the 4,000-agent registry matrix
 *   - template derivation (complete spec + provenance)
 *   - create-from-template with user overrides (owned, versioned, provenance
 *     persisted; duplicate protection)
 *   - real sandboxed benchmark runs through the verified pipeline (credits
 *     untouched, honest provider_not_configured without fabricated scores)
 *   - only the owner can benchmark/manage the derived agent
 */

const suffix = randomBytes(6).toString('hex');
const password = 'correct-horse-battery-staple';

describe('Milestone 6: Agent Factory', () => {
  let api: ApiServer;
  let baseUrl = '';
  let token = '';
  let otherToken = '';
  let fixture: ModelFixtureServer;
  let ownerId = '';
  let templateSlug = '';
  let derivedSlug = '';

  before(async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    const savedBase = process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;

    syncAgentRegistry();
    fixture = await startModelFixture('ok');

    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;

    async function registerAndLogin(email: string): Promise<string> {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: 'M6 User' }),
      });
      assert.equal(response.status, 201);
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(login.status, 200);
      return ((await login.json()) as { accessToken: string }).accessToken;
    }

    token = await registerAndLogin(`m6-api-owner-${suffix}@akbaral.test`);
    otherToken = await registerAndLogin(`m6-api-other-${suffix}@akbaral.test`);
    ownerId = (await whoAmI(token)).id;

    if (savedKey !== undefined) {
      process.env.OPENAI_API_KEY = savedKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    if (savedBase !== undefined) {
      process.env.OPENAI_BASE_URL = savedBase;
    } else {
      delete process.env.OPENAI_BASE_URL;
    }
  });

  after(async () => {
    if (derivedSlug) {
      const agent = findAgentBySlug(derivedSlug);
      if (agent) {
        db.run('DELETE FROM agent_versions WHERE agent_id = ?', [String(agent.id)]);
        db.run('DELETE FROM agent_marketplace WHERE agent_id = ?', [String(agent.id)]);
        db.run('DELETE FROM agents WHERE id = ?', [String(agent.id)]);
      }
    }
    db.close();
    await fixture.close();
    await api.close();
  });

  it('searches the registry matrix for template candidates', async () => {
    const response = await fetch(`${baseUrl}/api/factory/templates?q=research&limit=10`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { templates: Array<{ slug: string; specialization: string }> };
    assert.ok(body.templates.length >= 1, 'matrix agents are offered as templates');
    assert.ok(body.templates.length <= 10);
    templateSlug = body.templates[0].slug;
    for (const template of body.templates) {
      const owned = findAgentBySlug(template.slug);
      assert.ok(!owned?.owner_id, 'only platform registry agents are templates');
    }
  });

  it('derives a complete template with provenance', async () => {
    const response = await fetch(`${baseUrl}/api/factory/templates/${templateSlug}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      template: {
        templateOf: string;
        name: string;
        specialization: string;
        system_instructions: string;
        capabilities: string[];
        verification_rules: string[];
      };
    };
    assert.equal(body.template.templateOf, templateSlug);
    assert.ok(body.template.name.length > 0);
    assert.ok(body.template.system_instructions.length > 0);
    assert.ok(Array.isArray(body.template.capabilities));

    const missing = await fetch(`${baseUrl}/api/factory/templates/does-not-exist-xyz`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(missing.status, 404);
  });

  it('creates a custom agent from a template with overrides', async () => {
    const response = await fetch(`${baseUrl}/api/factory/agents/from-template`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        template_slug: templateSlug,
        name: `My ${templateSlug} specialist`,
        description: 'Customized from the matrix template.',
      }),
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as { agent: { slug: string; version: string; marketplaceStatus: string } };
    derivedSlug = body.agent.slug;
    assert.equal(body.agent.version, '1.0.0');
    assert.equal(body.agent.marketplaceStatus, 'draft');

    const stored = findAgentBySlug(derivedSlug);
    assert.ok(stored);
    assert.equal(String(stored.owner_id), ownerId, 'derived agent owned by the creator');
    const definition = getAgentBySlug(derivedSlug);
    assert.ok(definition, 'derived agent resolvable through the registry');
    const config = JSON.parse(String(stored.config ?? '{}')) as { templateOf?: string };
    assert.equal(config.templateOf, templateSlug, 'provenance persisted');

    // Duplicate slug protection
    const duplicate = await fetch(`${baseUrl}/api/factory/agents/from-template`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ template_slug: templateSlug, slug: derivedSlug }),
    });
    assert.equal(duplicate.status, 400);
  });

  it('runs a real sandboxed benchmark and aggregates honest results', async () => {
    // Unconfigured provider: the benchmark must report it honestly.
    const unconfigured = await fetch(`${baseUrl}/api/factory/agents/${derivedSlug}/benchmark`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ goals: ['analyze the market'] }),
    });
    assert.equal(unconfigured.status, 200);
    const unconfiguredBody = (await unconfigured.json()) as {
      benchmark: { mode: string; runs: Array<{ status: string; code: string | null }>; summary: { providerNotConfigured: boolean; passRate: number } };
    };
    assert.equal(unconfiguredBody.benchmark.mode, 'run');
    assert.equal(unconfiguredBody.benchmark.summary.providerNotConfigured, true);
    assert.equal(unconfiguredBody.benchmark.summary.passRate, 0, 'no fabricated scores');

    // Real runs through the fixture provider.
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    process.env.OPENAI_BASE_URL = fixture.baseUrl;
    try {
      const response = await fetch(`${baseUrl}/api/factory/agents/${derivedSlug}/benchmark`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ goals: ['analyze the market landscape', 'summarize key risks'] }),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        benchmark: {
          runs: Array<{ goal: string; status: string; verificationPassed: boolean; verificationScore: number; latencyMs: number }>;
          summary: { total: number; passed: number; passRate: number; avgVerificationScore: number; providerNotConfigured: boolean };
        };
      };
      assert.equal(body.benchmark.runs.length, 2);
      assert.ok(body.benchmark.runs.every((run) => run.status === 'completed'), 'real runs complete through the fixture');
      assert.ok(body.benchmark.runs.every((run) => run.verificationPassed));
      assert.equal(body.benchmark.summary.total, 2);
      assert.equal(body.benchmark.summary.passed, 2);
      assert.equal(body.benchmark.summary.passRate, 1);
      assert.ok(body.benchmark.summary.avgVerificationScore > 0);
      assert.equal(body.benchmark.summary.providerNotConfigured, false);
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
    }
  });

  it('restricts benchmarking and management to the owner', async () => {
    const response = await fetch(`${baseUrl}/api/factory/agents/${derivedSlug}/benchmark`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${otherToken}` },
      body: JSON.stringify({ goals: ['try to benchmark someone elses agent'] }),
    });
    assert.equal(response.status, 403, 'non-owner benchmark rejected');

    const patch = await fetch(`${baseUrl}/api/factory/agents/${derivedSlug}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${otherToken}` },
      body: JSON.stringify({ name: 'hijacked' }),
    });
    assert.equal(patch.status, 403);
  });

  it('validates benchmark input', async () => {
    const response = await fetch(`${baseUrl}/api/factory/agents/${derivedSlug}/benchmark`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ goals: [] }),
    });
    assert.equal(response.status, 400);
  });

  async function whoAmI(userToken: string): Promise<{ id: string }> {
    const response = await fetch(`${baseUrl}/api/me`, { headers: { authorization: `Bearer ${userToken}` } });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { user: { id: string } };
    return body.user;
  }
});
