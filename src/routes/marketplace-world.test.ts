import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiServer, type ApiServer } from '../app';
import { db } from '../db';
import { syncAgentRegistry } from '../agents/registry';

/**
 * Milestone 7 — Agent World + Marketplace integration tests.
 *
 * Verifies through the real HTTP surface:
 *   - install increments the marketplace install counter exactly once per user
 *   - reviews: rate upsert (1-5 validation), honest aggregate recompute
 *     (AVG + count from real reviews), review listing with myReview
 *   - featured/trending discovery ranked by REAL usage signals (empty stays
 *     empty; activity moves agents up)
 *   - Agent World: my agents with real usage counts, favorite toggle, removal
 *   - visibility enforcement (unpublished agents cannot be installed)
 */

const suffix = randomBytes(6).toString('hex');
const password = 'correct-horse-battery-staple';

describe('Milestone 7: Agent World + Marketplace', () => {
  let api: ApiServer;
  let baseUrl = '';
  let aliceToken = '';
  let bobToken = '';
  let publisherToken = '';
  let agentSlug = '';
  let agentId = '';

  before(async () => {
    syncAgentRegistry();
    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;

    async function register(label: string): Promise<{ id: string; token: string }> {
      const email = `m7-${label}-${suffix}@akbaral.test`;
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: `M7 ${label}` }),
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

    const alice = await register('alice');
    aliceToken = alice.token;
    const bob = await register('bob');
    bobToken = bob.token;
    const publisher = await register('publisher');
    publisherToken = publisher.token;
  });

  after(async () => {
    if (agentId) {
      db.run('DELETE FROM agent_reviews WHERE agent_id = ?', [agentId]);
      db.run('DELETE FROM user_agents WHERE agent_id = ?', [agentId]);
      db.run('DELETE FROM agent_orders WHERE agent_id = ?', [agentId]);
      db.run('DELETE FROM agent_marketplace WHERE agent_id = ?', [agentId]);
      db.run('DELETE FROM agents WHERE id = ?', [agentId]);
    }
    db.close();
    await api.close();
  });

  it('publishes a custom agent to the marketplace', async () => {
    // Factory-create (starts as draft), then publish.
    const template = await fetch(`${baseUrl}/api/factory/templates?q=research&limit=1`, {
      headers: { authorization: `Bearer ${publisherToken}` },
    });
    const templateBody = (await template.json()) as { templates: Array<{ slug: string }> };
    const created = await fetch(`${baseUrl}/api/factory/agents/from-template`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${publisherToken}` },
      body: JSON.stringify({ template_slug: templateBody.templates[0].slug, name: 'M7 Published Specialist' }),
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as { agent: { slug: string } };
    agentSlug = createdBody.agent.slug;
    const row = db.get<{ id: string }>('SELECT id FROM agents WHERE slug = ?', [agentSlug]);
    agentId = String(row?.id);

    const publish = await fetch(`${baseUrl}/api/marketplace/${agentSlug}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${publisherToken}` },
      body: JSON.stringify({ price_cents: 0 }),
    });
    assert.equal(publish.status, 200);
  });

  it('increments install_count exactly once per user', async () => {
    const installOnce = async (token: string) =>
      fetch(`${baseUrl}/api/marketplace/${agentSlug}/install`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });

    assert.equal((await installOnce(aliceToken)).status, 201);
    assert.equal((await installOnce(aliceToken)).status, 201, 'repeat install still succeeds');
    const afterAlice = marketplaceInstallCount();
    assert.equal(afterAlice, 1, 'one user = one install');

    assert.equal((await installOnce(bobToken)).status, 201);
    assert.equal(marketplaceInstallCount(), 2, 'second user increments');
  });

  it('rates agents with honest aggregate recompute', async () => {
    const invalid = await fetch(`${baseUrl}/api/marketplace/${agentSlug}/rate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ rating: 6 }),
    });
    assert.equal(invalid.status, 400);

    const rate = await fetch(`${baseUrl}/api/marketplace/${agentSlug}/rate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ rating: 5, comment: 'excellent specialist' }),
    });
    assert.equal(rate.status, 201);
    let body = (await rate.json()) as { aggregate: { rating: number; reviewCount: number } };
    assert.equal(body.aggregate.rating, 5);
    assert.equal(body.aggregate.reviewCount, 1);

    const rateBob = await fetch(`${baseUrl}/api/marketplace/${agentSlug}/rate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bobToken}` },
      body: JSON.stringify({ rating: 3 }),
    });
    assert.equal(rateBob.status, 201);
    body = (await rateBob.json()) as typeof body;
    assert.equal(body.aggregate.rating, 4, 'AVG(5,3) = 4 from real reviews');
    assert.equal(body.aggregate.reviewCount, 2);

    // The comment is really stored and listed.
    const reviewsStored = await fetch(`${baseUrl}/api/marketplace/${agentSlug}/reviews`, {
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    const storedBody = (await reviewsStored.json()) as { reviews: Array<{ comment: string | null }> };
    assert.ok(storedBody.reviews.some((review) => review.comment === 'excellent specialist'));

    // Upsert: Alice changes her rating — count stays 2, AVG recomputes, and
    // the omitted comment is replaced (no stale text).
    const rateUpdate = await fetch(`${baseUrl}/api/marketplace/${agentSlug}/rate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ rating: 1 }),
    });
    assert.equal(rateUpdate.status, 201);
    body = (await rateUpdate.json()) as typeof body;
    assert.equal(body.aggregate.reviewCount, 2, 'upsert does not duplicate reviews');
    assert.equal(body.aggregate.rating, 2, 'AVG(1,3) = 2');

    const reviews = await fetch(`${baseUrl}/api/marketplace/${agentSlug}/reviews`, {
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(reviews.status, 200);
    const reviewsBody = (await reviews.json()) as {
      reviews: Array<{ rating: number; comment: string | null; reviewer_name: string }>;
      myReview: { rating: number; comment: string | null } | null;
    };
    assert.equal(reviewsBody.reviews.length, 2);
    assert.equal(reviewsBody.myReview?.rating, 1);
    assert.equal(reviewsBody.myReview?.comment, null, 'update replaced the comment');
  });

  it('lists featured agents ranked by real signals', async () => {
    const response = await fetch(`${baseUrl}/api/marketplace/featured?limit=5`, {
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { featured: Array<{ slug: string; install_count: number; rating: number; review_count: number; featured_score: number }> };
    const mine = body.featured.find((agent) => agent.slug === agentSlug);
    assert.ok(mine, 'published agent with real activity is featured');
    assert.equal(mine.install_count, 2);
    assert.equal(mine.review_count, 2);
    assert.ok(mine.featured_score > 0);
    // Ranking is non-increasing by score.
    const scores = body.featured.map((agent) => agent.featured_score);
    for (let index = 1; index < scores.length; index += 1) {
      assert.ok(scores[index - 1] >= scores[index], 'featured ranking is ordered');
    }
  });

  it('lists trending agents from real recent activity', async () => {
    const response = await fetch(`${baseUrl}/api/marketplace/trending?days=7`, {
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { trending: Array<{ slug: string; recent_installs: number; trending_score: number }>; windowDays: number };
    assert.equal(body.windowDays, 7);
    const mine = body.trending.find((agent) => agent.slug === agentSlug);
    assert.ok(mine, 'agent with installs in the window is trending');
    // Install EVENTS in the window: alice installed twice (repeat install
    // still records an order) and bob once.
    assert.equal(mine.recent_installs, 3, 'real install events in window counted');
  });

  it('shows my Agent World with real usage signals', async () => {
    const response = await fetch(`${baseUrl}/api/world`, { headers: { authorization: `Bearer ${aliceToken}` } });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      agents: Array<{ slug: string; favorite: number; task_count: number; installed_at: string }>;
      summary: { total: number; favorites: number };
    };
    assert.ok(body.agents.some((agent) => agent.slug === agentSlug));
    assert.ok(body.summary.total >= 1);

    // Favorite toggle
    const favorite = await fetch(`${baseUrl}/api/world/${agentSlug}/favorite`, {
      method: 'POST',
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(favorite.status, 200);
    const favoriteBody = (await favorite.json()) as { favorite: boolean };
    assert.equal(favoriteBody.favorite, true);
    const worldAfter = (await (
      await fetch(`${baseUrl}/api/world`, { headers: { authorization: `Bearer ${aliceToken}` } })
    ).json()) as { agents: Array<{ slug: string; favorite: number }>; summary: { favorites: number } };
    assert.equal(worldAfter.agents.find((agent) => agent.slug === agentSlug)?.favorite, 1);
    assert.ok(worldAfter.summary.favorites >= 1);

    // Bob never added the agent to favorites; removing works
    const remove = await fetch(`${baseUrl}/api/world/${agentSlug}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${bobToken}` },
    });
    assert.equal(remove.status, 200);
    const bobWorld = (await (
      await fetch(`${baseUrl}/api/world`, { headers: { authorization: `Bearer ${bobToken}` } })
    ).json()) as { agents: Array<{ slug: string }> };
    assert.ok(!bobWorld.agents.some((agent) => agent.slug === agentSlug), 'removed from Bob world');
  });

  it('blocks installing unpublished agents', async () => {
    // Unpublish, then installs must fail honestly. A non-owner no longer sees
    // the agent at all (404, no existence leak); the owner still sees it and
    // receives the explicit agent_not_published conflict.
    const unpublish = await fetch(`${baseUrl}/api/marketplace/${agentSlug}/unpublish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${publisherToken}` },
    });
    assert.equal(unpublish.status, 200);
    const install = await fetch(`${baseUrl}/api/marketplace/${agentSlug}/install`, {
      method: 'POST',
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(install.status, 404, 'unpublished agent is invisible to non-owners');
    const ownerInstall = await fetch(`${baseUrl}/api/marketplace/${agentSlug}/install`, {
      method: 'POST',
      headers: { authorization: `Bearer ${publisherToken}` },
    });
    assert.equal(ownerInstall.status, 403, 'owner sees the explicit not-published conflict');
    const ownerBody = (await ownerInstall.json()) as { error: { code: string } };
    assert.equal(ownerBody.error.code, 'agent_not_published');
    // Re-publish for a clean state.
    const republish = await fetch(`${baseUrl}/api/marketplace/${agentSlug}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${publisherToken}` },
      body: JSON.stringify({ price_cents: 0 }),
    });
    assert.equal(republish.status, 200);
  });

  it('requires authentication for world and marketplace APIs', async () => {
    for (const path of ['/api/world', '/api/marketplace/featured', '/api/marketplace/trending']) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 401, `${path} requires auth`);
    }
  });

  function marketplaceInstallCount(): number {
    const row = db.get<{ install_count: number }>('SELECT install_count FROM agent_marketplace WHERE agent_id = ?', [agentId]);
    return row?.install_count ?? -1;
  }
});
