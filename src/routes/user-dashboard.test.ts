import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiServer, type ApiServer } from '../app';
import { db, createTask, consumeTaskCredit, refundTaskCredit } from '../db';
import { executionQueue } from '../orchestrator/queue';
import { syncAgentRegistry } from '../agents/registry';

/**
 * REGRESSION LOCK — GET /api/dashboard must not 500.
 *
 * Takeover audit (2026-09-27) found the entire user dashboard returning
 * HTTP 500 in production:
 *
 *   {"error":{"code":"internal_error","message":"no such column: agent_category"}}
 *
 * Root cause: src/routes/user-dashboard.ts selected `tasks.agent_category` and
 * `tasks.credits_consumed`, neither of which exists in ANY migration (see
 * db/migrations-pg/0001_init.sql — `tasks` has no such columns). 1,972 passing
 * tests never caught it because NO test exercised this route at all.
 *
 * These tests run against the REAL HTTP surface with a REAL database, and they
 * assert more than "200 OK": they assert the two derived values are actually
 * correct, because the bug could just as easily be "fixed" by returning nulls.
 *
 *   · agent_category   must resolve through tasks.agent_id → agents.category_id
 *                      → agent_categories.slug, and be null when there is no agent.
 *   · credits_consumed must equal the real credit ledger: 1 after a consume,
 *                      and 0 again after the refund — never a stored counter
 *                      that can drift away from the balance the user sees.
 *
 * Every dashboard read route is covered so a regression in any one of them
 * fails the suite instead of reaching production again.
 */

const suffix = randomBytes(6).toString('hex');
const password = 'correct-horse-battery-staple';

interface Actor {
  id: string;
  token: string;
  email: string;
}

async function register(baseUrl: string, label: string): Promise<Actor> {
  const email = `dash-${label}-${suffix}@akbaral.test`;
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name: `Dash ${label}` }),
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
  return { id: body.user.id, token: loginBody.accessToken, email };
}

function authed(actor: Actor): Record<string, string> {
  return { authorization: `Bearer ${actor.token}` };
}

describe('GET /api/dashboard — schema-accurate user dashboard', () => {
  let api: ApiServer;
  let baseUrl = '';
  let user: Actor;
  let other: Actor;
  let categorisedTaskId = '';
  let agentlessTaskId = '';
  let refundedTaskId = '';
  /** The category slug of the agent we attach, read from the real registry. */
  let expectedCategorySlug = '';

  before(async () => {
    syncAgentRegistry();

    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;

    user = await register(baseUrl, 'user');
    other = await register(baseUrl, 'other');

    // A real registry agent that genuinely has a category, resolved from the DB
    // rather than assumed — this is the join the route has to perform.
    const agent = db.get<{ id: string; category_slug: string }>(
      `SELECT a.id AS id, ac.slug AS category_slug
         FROM agents a JOIN agent_categories ac ON ac.id = a.category_id
        WHERE a.owner_id IS NULL LIMIT 1`,
    );
    assert.ok(agent, 'the seeded registry must expose at least one categorised platform agent');
    expectedCategorySlug = agent.category_slug;

    // 1) a task WITH an agent, whose credit is consumed and kept
    const categorised = createTask({ userId: user.id, title: 'categorised task', agentId: agent.id, type: 'free' });
    categorisedTaskId = categorised.id;
    assert.ok(consumeTaskCredit({ userId: user.id, taskId: categorisedTaskId, reason: 'test consume' }));

    // 2) a task WITHOUT an agent and without any credit movement
    agentlessTaskId = createTask({ userId: user.id, title: 'agentless task', type: 'free' }).id;

    // 3) a task whose credit was consumed and then refunded (net zero)
    const refunded = createTask({ userId: user.id, title: 'refunded task', agentId: agent.id, type: 'free' });
    refundedTaskId = refunded.id;
    assert.ok(consumeTaskCredit({ userId: user.id, taskId: refundedTaskId, reason: 'test consume' }));
    assert.ok(refundTaskCredit({ userId: user.id, taskId: refundedTaskId, reason: 'test refund' }));
  });

  after(async () => {
    try {
      executionQueue.stop();
    } catch {
      // queue may already be stopped
    }
    db.run('DELETE FROM users WHERE id IN (?, ?)', [user.id, other.id]);
    db.close();
    await api.close();
  });

  it('answers 200 with the real payload instead of 500 "no such column"', async () => {
    const response = await fetch(`${baseUrl}/api/dashboard`, { headers: authed(user) });
    assert.equal(response.status, 200, 'the dashboard must not 500 — this is the exact production regression');

    const body = (await response.json()) as Record<string, any>;
    assert.equal(body.user.id, user.id);
    assert.ok(body.credits, 'credits block present');
    assert.ok(Array.isArray(body.tasks.recent), 'tasks.recent present');
    assert.ok(body.tasks.counts && typeof body.tasks.counts === 'object', 'task counts present');
    assert.ok(Array.isArray(body.billing.invoices), 'invoices present');
    assert.ok(Array.isArray(body.billing.payments), 'payments present');
    assert.ok(Array.isArray(body.sessions), 'sessions present');
  });

  it('derives agentCategory from the agent join, and honestly reports null without an agent', async () => {
    const response = await fetch(`${baseUrl}/api/dashboard`, { headers: authed(user) });
    const body = (await response.json()) as { tasks: { recent: Array<Record<string, any>> } };

    const categorised = body.tasks.recent.find((t) => t.id === categorisedTaskId);
    assert.ok(categorised, 'the categorised task is listed');
    assert.equal(
      categorised.agentCategory,
      expectedCategorySlug,
      'agentCategory must resolve through agents.category_id → agent_categories.slug',
    );

    const agentless = body.tasks.recent.find((t) => t.id === agentlessTaskId);
    assert.ok(agentless, 'the agentless task is listed');
    assert.equal(agentless.agentCategory, null, 'a task with no agent reports null, never an invented category');
  });

  it('derives creditsConsumed from the credit ledger, so a refund shows 0', async () => {
    const response = await fetch(`${baseUrl}/api/dashboard`, { headers: authed(user) });
    const body = (await response.json()) as { tasks: { recent: Array<Record<string, any>> } };

    const consumed = body.tasks.recent.find((t) => t.id === categorisedTaskId);
    assert.equal(consumed?.creditsConsumed, 1, 'a consumed task reports exactly the 1 credit it really spent');

    const refunded = body.tasks.recent.find((t) => t.id === refundedTaskId);
    assert.equal(
      refunded?.creditsConsumed,
      0,
      'a refunded task must report 0 — the ledger is the single source of truth for money',
    );

    const untouched = body.tasks.recent.find((t) => t.id === agentlessTaskId);
    assert.equal(untouched?.creditsConsumed, 0, 'a task that never moved a credit reports 0');
  });

  it('never leaks another user\'s tasks into the dashboard', async () => {
    const response = await fetch(`${baseUrl}/api/dashboard`, { headers: authed(other) });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { tasks: { recent: Array<Record<string, any>> } };
    assert.equal(body.tasks.recent.length, 0, 'a different user sees none of the first user\'s tasks');
  });

  it('requires authentication', async () => {
    const response = await fetch(`${baseUrl}/api/dashboard`);
    assert.equal(response.status, 401);
  });

  it('serves the same derived fields from /api/dashboard/tasks', async () => {
    const response = await fetch(`${baseUrl}/api/dashboard/tasks`, { headers: authed(user) });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { tasks: Array<Record<string, any>> };
    const categorised = body.tasks.find((t) => t.id === categorisedTaskId);
    assert.ok(categorised, 'the task list includes the categorised task');
    assert.equal(categorised.agentCategory, expectedCategorySlug, 'the list must not silently return undefined');
    assert.equal(categorised.creditsConsumed, 1, 'the list must not silently return 0 for a real charge');
  });

  it('serves the same derived fields from /api/dashboard/tasks/:id', async () => {
    const response = await fetch(`${baseUrl}/api/dashboard/tasks/${categorisedTaskId}`, { headers: authed(user) });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { task: Record<string, any> };
    assert.equal(body.task.id, categorisedTaskId);
    assert.equal(body.task.agentCategory, expectedCategorySlug);
    assert.equal(body.task.creditsConsumed, 1);
    assert.ok('description' in body.task, 'the detail view still exposes the description');
  });

  it('does not expose another user\'s task by id', async () => {
    const response = await fetch(`${baseUrl}/api/dashboard/tasks/${categorisedTaskId}`, { headers: authed(other) });
    assert.equal(response.status, 404, 'no existence leak across users');
  });

  it('keeps the remaining dashboard read routes healthy', async () => {
    for (const path of ['/api/dashboard/profile', '/api/dashboard/credits', '/api/dashboard/billing', '/api/dashboard/security']) {
      const response = await fetch(`${baseUrl}${path}`, { headers: authed(user) });
      assert.equal(response.status, 200, `${path} must answer 200`);
    }
  });
});
