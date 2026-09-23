import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db, findUserByEmail } from '../db';
import { applyMigrations } from '../db/migrate';
import { syncAgentRegistry } from '../agents/registry';
import { generateAgentDefinitions } from '../agents/catalog';
import {
  insertExecution, insertOpportunity, upsertAgentProfile, updateEconomyPolicy,
} from '../db/economy-repositories';
import { insertDelivery } from '../workforce/repositories';
import { seedPlatforms } from '../workforce/platforms';
import { createApiServer, type ApiServer } from '../app';

let nonce = 0;
function uniq(prefix: string): string {
  nonce += 1;
  return `${prefix}-${Date.now()}-${nonce}`;
}

describe('mission autonomy routes: commands, payments, reinvestment, reports, primaries', () => {
  let api: ApiServer;
  let baseUrl = '';
  let ownerToken = '';
  let userToken = '';
  let agentA = '';
  let agentB = '';
  const ownerEmail = `autor-owner-${Date.now()}@akbaral.test`;
  const userEmail = `autor-user-${Date.now()}@akbaral.test`;

  async function call(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, json };
  }

  before(async () => {
    applyMigrations(db);
    syncAgentRegistry();
    seedPlatforms();
    updateEconomyPolicy({ kill_switch: 0, freeze_spending: 0, freeze_withdrawals: 0 });
    const defs = generateAgentDefinitions();
    agentA = defs[0].slug;
    agentB = defs[1].slug;
    upsertAgentProfile({ agentSlug: agentA, parentAgentSlug: null, objectives: 'routes test A' });
    upsertAgentProfile({ agentSlug: agentB, parentAgentSlug: null, objectives: 'routes test B' });
    api = createApiServer();
    await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
    for (const accountEmail of [ownerEmail, userEmail]) {
      await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: accountEmail, password: 'correct-horse-battery-staple', name: 'Autor' }),
      });
    }
    const ownerRow = findUserByEmail(ownerEmail)!;
    db.run('UPDATE users SET role = ? WHERE id = ?', ['owner', String(ownerRow.id)]);
    const login = async (accountEmail: string): Promise<string> => {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: accountEmail, password: 'correct-horse-battery-staple' }),
      });
      assert.equal(response.status, 200);
      return ((await response.json()) as { accessToken: string }).accessToken;
    };
    ownerToken = await login(ownerEmail);
    userToken = await login(userEmail);
  });

  after(async () => {
    await new Promise<void>((resolve) => api.server.close(() => resolve()));
  });

  it('new owner surfaces reject anonymous (401) and ordinary users (403)', async () => {
    const anon = await fetch(`${baseUrl}/api/economy/commands`);
    assert.equal(anon.status, 401);
    for (const [method, path] of [['GET', '/api/economy/commands'], ['GET', '/api/economy/workforce-overview'], ['GET', `/api/economy/agents/${agentA}/report`], ['GET', '/api/workforce/primaries']] as const) {
      const denied = await call(method, path, userToken);
      assert.equal(denied.status, 403, `${path} must reject ordinary users`);
    }
  });

  it('runs the full command lifecycle over HTTP', async () => {
    const issue = await call('POST', '/api/economy/commands', ownerToken, {
      agent_slug: agentA, instruction: 'routes test order', idempotency_key: uniq('rcmd'),
    });
    assert.equal(issue.status, 201);
    const id = (issue.json.command as { id: string }).id;
    assert.ok(id);
    assert.equal((await call('POST', `/api/economy/commands/${id}/acknowledge`, ownerToken, { actor: agentA })).status, 200);
    const url = `https://autor-test.local/${uniq('opp')}`;
    const opp = insertOpportunity({
      sourceUrlHash: createHash('sha256').update(url).digest('hex'), sourceUrl: url,
      category: 'research', title: 'autor fixture', summary: 'fixture',
      expectedRevenueCents: 1_000, expectedCostCents: 10, timeHours: 1,
      riskLevel: 'low', probability: 0.5, estimateBasis: 'autor_test_fixture',
    });
    const exe = insertExecution({ opportunityId: opp.id, agentSlug: agentA, timeoutMs: 60_000 });
    const link = await call('POST', `/api/economy/commands/${id}/link`, ownerToken, { opportunity_id: opp.id, execution_id: exe.id });
    assert.equal(link.status, 200);
    const delivery = insertDelivery({ executionId: exe.id, opportunityId: opp.id, agentSlug: agentA, title: 'autor proof', evidence: 'fixture', verified: true });
    const done = await call('POST', `/api/economy/commands/${id}/complete`, ownerToken, { result_summary: 'done', delivery_id: delivery.id });
    assert.equal(done.status, 200);
    assert.equal((done.json.command as { verification: string }).verification, 'verified');
    const status = await call('GET', `/api/economy/commands/${id}`, ownerToken);
    assert.equal(status.status, 200);
    assert.equal((status.json.command as { status: string }).status, 'completed');
    assert.equal(status.json.deliveryVerified, true);
  });

  it('records delivery payments over HTTP exactly once', async () => {
    const url = `https://autor-test.local/${uniq('opp')}`;
    const opp = insertOpportunity({
      sourceUrlHash: createHash('sha256').update(url).digest('hex'), sourceUrl: url,
      category: 'research', title: 'autor pay fixture', summary: 'fixture',
      expectedRevenueCents: 1_000, expectedCostCents: 10, timeHours: 1,
      riskLevel: 'low', probability: 0.5, estimateBasis: 'autor_test_fixture',
    });
    const exe = insertExecution({ opportunityId: opp.id, agentSlug: agentB, timeoutMs: 60_000 });
    const delivery = insertDelivery({ executionId: exe.id, opportunityId: opp.id, agentSlug: agentB, title: 'pay proof', evidence: 'bank advice', verified: true });
    const first = await call('POST', '/api/economy/delivery-payments', ownerToken, {
      delivery_id: delivery.id, amount_cents: 7_777, evidence: 'payout advice PO-AUTOR-1', external_ref: uniq('PO'),
    });
    assert.equal(first.status, 201);
    assert.equal(first.json.posted, true);
    const replay = await call('POST', '/api/economy/delivery-payments', ownerToken, {
      delivery_id: delivery.id, amount_cents: 100, evidence: 'second claim',
    });
    assert.equal(replay.status, 400); // already_recorded: exactly-once enforced
  });

  it('proposes and decides reinvestment over HTTP with funded balance', async () => {
    const propose = await call('POST', '/api/economy/reinvestments', ownerToken, {
      agent_slug: agentB, amount_cents: 1_000, purpose: 'autor ad spend', idempotency_key: uniq('rriv'),
    });
    assert.equal(propose.status, 201);
    const id = (propose.json.reinvestment as { id: string }).id;
    const approve = await call('POST', `/api/economy/reinvestments/${id}/approve`, ownerToken);
    assert.equal(approve.status, 200);
    assert.equal((approve.json.reinvestment as { status: string }).status, 'executed');
    const listed = await call('GET', '/api/economy/reinvestments?limit=10', ownerToken);
    assert.equal(listed.status, 200);
    assert.ok(((listed.json.reinvestments as unknown[]) ?? []).length >= 1);
  });

  it('serves the per-agent report, quotas and fleet overview over HTTP', async () => {
    const report = await call('GET', `/api/economy/agents/${agentB}/report`, ownerToken);
    assert.equal(report.status, 200);
    const body = report.json.report as Record<string, unknown>;
    assert.equal((body.agent as { slug: string }).slug, agentB);
    assert.ok(typeof (body.finance as { realizedRevenueCents: number }).realizedRevenueCents === 'number');
    assert.ok(Array.isArray(body.blockers));
    const ghost = await call('GET', '/api/economy/agents/no-such-agent-xyz/report', ownerToken);
    assert.equal(ghost.status, 404);
    const setQuota = await call('PUT', `/api/economy/agents/${agentB}/quotas`, ownerToken, { daily_spend_quota_cents: 5_000, monthly_spend_quota_cents: null });
    assert.equal(setQuota.status, 200);
    assert.equal(((setQuota.json.quotas as { dailyQuotaCents: number }).dailyQuotaCents), 5_000);
    const badQuota = await call('PUT', `/api/economy/agents/${agentB}/quotas`, ownerToken, { daily_spend_quota_cents: -1 });
    assert.equal(badQuota.status, 400);
    const overview = await call('GET', '/api/economy/workforce-overview', ownerToken);
    assert.equal(overview.status, 200);
    assert.ok(((overview.json.overview as { catalogAgents: number }).catalogAgents) >= 4001);
  });

  it('manages 1:1 primaries over HTTP with database-backed refusal', async () => {
    const catalog = await call('GET', '/api/workforce/platforms?limit=5', ownerToken);
    assert.equal(catalog.status, 200);
    const platforms = catalog.json.platforms as Array<{ platform_key: string }>;
    assert.ok(platforms.length > 0);
    const key = platforms[0].platform_key;
    const assign = await call('POST', '/api/workforce/primaries', ownerToken, { agent_slug: agentA, platform_key: key });
    assert.ok(assign.status === 201 || assign.status === 409, `assign answers 201 or 409, got ${assign.status}`);
    if (assign.status === 201) {
      const dupe = await call('POST', '/api/workforce/primaries', ownerToken, { agent_slug: agentB, platform_key: key });
      assert.equal(dupe.status, 409);
      const byAgent = await call('GET', `/api/workforce/primaries/agent/${agentA}`, ownerToken);
      assert.equal(byAgent.status, 200);
      const bind = await call('POST', '/api/workforce/primaries/account', ownerToken, {
        agent_slug: agentA, dedicated_account_property_id: uniq('acct-prop'),
      });
      assert.equal(bind.status, 200);
      assert.equal((bind.json.assignment as { status: string }).status, 'active');
      const release = await call('POST', '/api/workforce/primaries/release', ownerToken, { agent_slug: agentA, reason: 'autor test release' });
      assert.equal(release.status, 200);
    }
    const missing = await call('GET', '/api/workforce/primaries/agent/no-such-agent-xyz', ownerToken);
    assert.equal(missing.status, 404);
  });

  it('validates the upgrade apply actor', async () => {
    const bad = await call('POST', '/api/economy/upgrades/eco_upg_ghost/apply', ownerToken, { actor: 'no-such-agent-xyz' });
    assert.equal(bad.status, 400);
  });
});
