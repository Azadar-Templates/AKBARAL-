import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createId } from '../db/id';
import { db } from '../db';
import { createApiServer, type ApiServer } from '../app';
import { syncAgentRegistry } from '../agents/registry';

/**
 * Public catalog (Phase 1b) — real HTTP-surface tests.
 *
 * Verifies the /agents directory's backend:
 *   - unauthenticated read access to the platform registry
 *   - search, category filter and bounded pagination
 *   - public detail by slug + 404 for unknown slugs
 *   - the public DTO leaks no internal fields (system instructions, ids)
 *   - user-owned agents are NEVER exposed (platform-only enforcement)
 */
describe('Public agent catalog', () => {
  let api: ApiServer;
  let baseUrl = '';
  const ownedAgentId = createId('agt');
  const ownedSlug = 'private-owned-agent-test';
  const ownerId = createId('usr');
  const NOW = (): string => new Date().toISOString();

  before(async () => {
    syncAgentRegistry();
    // A real user + their agent: must never appear in the public catalog.
    db.run(
      `INSERT INTO users (id, email, name, password_hash, status, created_at, updated_at)
       VALUES (?, 'public-catalog-owner@akbaral.test', 'Catalog Owner', 'x', 'active', ?, ?)`,
      [ownerId, NOW(), NOW()],
    );
    const category = db.get<{ id: string }>('SELECT id FROM agent_categories LIMIT 1');
    db.run(
      `INSERT INTO agents (id, slug, name, description, config, status, owner_id, category_id, created_at, updated_at)
       VALUES (?, ?, 'Private Owned Agent', 'user-created', '{}', 'active', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      [ownedAgentId, ownedSlug, ownerId, category?.id ?? null],
    );
    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    db.run('DELETE FROM agents WHERE id = ?', [ownedAgentId]);
    db.run('DELETE FROM users WHERE id = ?', [ownerId]);
    await api.close();
  });

  it('lists platform agents without authentication', async () => {
    const response = await fetch(`${baseUrl}/api/public/agents?limit=10`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { agents: Array<Record<string, unknown>>; total: number; limit: number };
    assert.ok(Array.isArray(body.agents));
    assert.equal(body.agents.length, 10);
    assert.ok(body.total >= 4000, `expected the full registry, got ${body.total}`);
    assert.equal(body.limit, 10);
  });

  it('searches the registry by term', async () => {
    const all = (await (await fetch(`${baseUrl}/api/public/agents?limit=1`)).json()) as { total: number };
    const response = await fetch(`${baseUrl}/api/public/agents?q=seo&limit=60`);
    const body = (await response.json()) as { agents: Array<{ name: string; description: string; category: string }>; total: number };
    assert.ok(body.total > 0, 'seo should match registry agents');
    assert.ok(body.total < all.total, 'search must narrow the result set');
    const joined = body.agents.map((a) => `${a.name} ${a.description} ${a.category}`).join(' ').toLowerCase();
    assert.ok(joined.includes('seo'));
  });

  it('filters by category and paginates with a clamped limit', async () => {
    const categories = (await (await fetch(`${baseUrl}/api/public/agent-categories`)).json()) as {
      categories: Array<{ slug: string; count: number }>;
    };
    assert.ok(categories.categories.length > 0);
    const first = categories.categories[0];
    const response = await fetch(`${baseUrl}/api/public/agents?category=${first.slug}&limit=500`);
    const body = (await response.json()) as { agents: unknown[]; total: number; limit: number };
    assert.equal(body.total, first.count, 'category count must match the category listing');
    assert.ok(body.limit <= 60, 'limit must be clamped to 60');
    assert.ok(body.agents.length <= 60);
  });

  it('returns one public agent by slug and 404s unknown slugs', async () => {
    const list = (await (await fetch(`${baseUrl}/api/public/agents?limit=1`)).json()) as { agents: Array<{ slug: string }> };
    const slug = list.agents[0].slug;
    const found = await fetch(`${baseUrl}/api/public/agents/${slug}`);
    assert.equal(found.status, 200);
    const body = (await found.json()) as { agent: Record<string, unknown> };
    assert.equal(body.agent.slug, slug);

    const missing = await fetch(`${baseUrl}/api/public/agents/this-slug-does-not-exist`);
    assert.equal(missing.status, 404);
  });

  it('never leaks internal fields or user-owned agents', async () => {
    // Note: search is OR-term based, so a slug-like query legitimately
    // matches other agents (e.g. descriptions containing "test"). The
    // guarantee under test is that the OWNED slug itself never appears.
    const response = await fetch(`${baseUrl}/api/public/agents?q=${ownedSlug}&limit=60`);
    const body = (await response.json()) as { agents: Array<{ slug: string }>; total: number };
    assert.ok(!body.agents.some((a) => a.slug === ownedSlug), 'user-owned agents must not be publicly listed');

    const list = (await (await fetch(`${baseUrl}/api/public/agents?limit=5`)).json()) as { agents: Array<Record<string, unknown>> };
    const serialized = JSON.stringify(list.agents);
    assert.ok(!serialized.includes('systemInstructions'), 'system instructions must not be public');
    assert.ok(!serialized.includes('ownerId'), 'owner ids must not be public');
    assert.ok(!serialized.includes('evaluationConfig'), 'evaluation config must not be public');

    const detail = await fetch(`${baseUrl}/api/public/agents/${ownedSlug}`);
    assert.equal(detail.status, 404, 'user-owned agent detail must 404 publicly');
  });

  it('exposes honest registry stats', async () => {
    const response = await fetch(`${baseUrl}/api/public/registry-stats`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { agents: number; categories: number };
    assert.ok(body.agents >= 4000);
    assert.ok(body.categories > 0);
  });
});
