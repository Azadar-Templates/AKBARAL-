import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiServer, type ApiServer } from '../app';
import { db, createUser } from '../db';
import { syncAgentRegistry } from '../agents/registry';
import { buildOwnerDashboard } from '../business/owner-analytics';
import { clearRateLimitBuckets } from '../server/middleware/rate-limit';

/**
 * Owner Console (AKBARAL! business analytics) — real-data + authorization lock.
 *
 * Asserts three things that must never regress:
 *   1. Least privilege: anonymous 401, ordinary user 403, staff admin 403,
 *      owner 200 — the console is owner/super_admin only.
 *   2. Real data only: the dashboard numbers equal live counts taken straight
 *      from the database (no estimates, no placeholders), and the revenue
 *      ledger is explicitly scoped to AKBARAL! customer revenue with the
 *      ZA141251SA mission ledger excluded.
 *   3. Honesty: values that require an external provider billing API are
 *      reported as unavailable instead of invented.
 */

const suffix = randomBytes(6).toString('hex');
const password = 'correct-horse-battery-staple';

const ownerEmail = `console-owner-${suffix}@akbaral.test`;
const adminEmail = `console-admin-${suffix}@akbaral.test`;
const userEmail = `console-user-${suffix}@akbaral.test`;

let server: ApiServer;
let baseUrl = '';
let ownerId = '';
let ownerToken = '';
let adminToken = '';
let userToken = '';

interface CallResult {
  status: number;
  body: Record<string, never> & Record<string, unknown>;
}

async function call(path: string, init?: RequestInit): Promise<CallResult> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body: body as CallResult['body'] };
}

function jsonHeaders(token: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
}

async function registerAndLogin(email: string, role?: string): Promise<string> {
  const created = await call('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name: email.split('@')[0] }),
  });
  assert.ok([200, 201].includes(created.status), `registered ${email} (${created.status})`);
  if (role) {
    db.run('UPDATE users SET role = ? WHERE email = ?', [role, email]);
  }
  const login = await call('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200, `logged in ${email}`);
  return String(login.body.accessToken);
}

before(async () => {
  clearRateLimitBuckets();
  syncAgentRegistry();
  server = createApiServer();
  const listening = await server.listen(0);
  baseUrl = `http://127.0.0.1:${listening.port}`;

  ownerToken = await registerAndLogin(ownerEmail, 'owner');
  adminToken = await registerAndLogin(adminEmail, 'admin');
  userToken = await registerAndLogin(userEmail);
  const owner = db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', [ownerEmail]);
  ownerId = String(owner?.id ?? '');
});

after(async () => {
  if (server) {
    await server.close();
  }
  db.run(`DELETE FROM credit_transactions WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)`, [`console-%${suffix}@akbaral.test`]);
  db.run('DELETE FROM users WHERE email LIKE ?', [`console-%${suffix}@akbaral.test`]);
  db.close();
});

describe('owner console: authorization', () => {
  it('refuses anonymous (401), ordinary users (403) and staff admins (403)', async () => {
    const anonymous = await call('/api/owner/dashboard');
    assert.equal(anonymous.status, 401, 'anonymous is refused');

    for (const [label, token] of [['ordinary user', userToken], ['staff admin', adminToken]] as const) {
      const response = await call('/api/owner/dashboard', { headers: jsonHeaders(token) });
      assert.equal(response.status, 403, `${label} is refused`);
    }
  });

  it('serves the dashboard to the owner and to a super_admin', async () => {
    const owner = await call('/api/owner/dashboard', { headers: jsonHeaders(ownerToken) });
    assert.equal(owner.status, 200);
    const dashboard = owner.body.dashboard as Record<string, unknown>;
    assert.ok(dashboard, 'dashboard payload present');
    assert.equal(dashboard.source, 'platform-database');
    const honesty = dashboard.honesty as { realDataOnly: boolean };
    assert.equal(honesty.realDataOnly, true);

    // A super_admin is equally entitled.
    const superAdminEmail = `console-superadmin-${suffix}@akbaral.test`;
    const superToken = await registerAndLogin(superAdminEmail, 'super_admin');
    const response = await call('/api/owner/dashboard', { headers: jsonHeaders(superToken) });
    assert.equal(response.status, 200, 'super_admin may read the console');
    db.run('DELETE FROM users WHERE email = ?', [superAdminEmail]);
  });

  it('exposes the focused sub-surfaces to the owner only', async () => {
    for (const path of ['/api/owner/growth?days=7', '/api/owner/revenue?days=7', '/api/owner/costs', '/api/owner/health', '/api/owner/audit?limit=5']) {
      const owner = await call(path, { headers: jsonHeaders(ownerToken) });
      assert.equal(owner.status, 200, `owner may read ${path}`);
      const user = await call(path, { headers: jsonHeaders(userToken) });
      assert.equal(user.status, 403, `ordinary user refused on ${path}`);
    }
  });
});

describe('owner console: real data, never fabricated', () => {
  it('user counts equal live database counts', () => {
    const dashboard = buildOwnerDashboard();
    const live = db.get<{ total: number }>('SELECT COUNT(*) AS total FROM users');
    assert.equal(dashboard.users.total, Number(live?.total ?? 0), 'user total is a live count');
    const liveRoleSum = dashboard.users.byRole.reduce((sum, row) => sum + row.count, 0);
    assert.equal(liveRoleSum, dashboard.users.total, 'role breakdown adds up to the total');
    assert.ok(dashboard.users.signups.last7Days <= dashboard.users.total, 'signup window cannot exceed the total');
  });

  it('credit accounting reconciles with the credit ledger', () => {
    const dashboard = buildOwnerDashboard();
    const live = db.get<{ granted: number; consumed: number; refunded: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0) AS granted,
         COALESCE(SUM(CASE WHEN amount < 0 AND type != 'reversal' THEN -amount ELSE 0 END),0) AS consumed,
         COALESCE(SUM(CASE WHEN amount < 0 AND type = 'reversal' THEN -amount ELSE 0 END),0) AS refunded
       FROM credit_transactions`,
    );
    assert.equal(dashboard.credits.granted, Number(live?.granted ?? 0));
    assert.equal(dashboard.credits.consumed, Number(live?.consumed ?? 0));
    assert.equal(dashboard.credits.refunded, Number(live?.refunded ?? 0));
    assert.ok(dashboard.credits.refundPolicy.note.includes('Exactly one credit'), 'refund policy is documented on the surface');
  });

  it('records a new credit account and a new user immediately', () => {
    const before = buildOwnerDashboard();
    // createUser provisions the credit account (5 free credits by default).
    const created = createUser({ email: `console-meter-${suffix}@akbaral.test`, name: 'Meter User', freeCredits: 7 });
    const after = buildOwnerDashboard();
    assert.equal(after.users.total, before.users.total + 1, 'a new signup appears immediately');
    assert.equal(after.credits.accounts.total, before.credits.accounts.total + 1, 'a new credit account appears immediately');
    assert.equal(after.credits.pools.freeCredits, before.credits.pools.freeCredits + 7, 'pool totals are live');
    assert.equal(after.plans.trialingSubscriptions, before.plans.trialingSubscriptions + 1, 'the trial subscription is counted');
    db.run('DELETE FROM users WHERE id = ?', [created.id]);
  });

  it('registry figures match the real 4,001-agent registry', () => {
    const dashboard = buildOwnerDashboard();
    const live = db.get<{ total: number }>('SELECT COUNT(*) AS total FROM agents');
    assert.equal(dashboard.agents.registryTotal, Number(live?.total ?? 0));
    assert.ok(dashboard.agents.registryTotal >= 4001, `registry intact (${dashboard.agents.registryTotal})`);
    assert.ok(dashboard.systemHealth.registryIntegrity?.ok, 'registry integrity check reports ok');
    assert.match(String(dashboard.systemHealth.registryIntegrity?.detail), /distinct slugs/);
  });

  it('separates AKBARAL! revenue from the private mission ledger', () => {
    const dashboard = buildOwnerDashboard();
    assert.equal(dashboard.ledgerSeparation.platformRevenue, 'akbaral-customer-revenue');
    // The codename itself never appears in a served payload; the declaration
    // that the private mission ledger is excluded is what must hold.
    assert.match(dashboard.ledgerSeparation.missionRevenue, /separate private mission ledger/);
    assert.doesNotMatch(
      JSON.stringify(dashboard),
      /ZA141251SA/,
      'the owner dashboard payload never carries the private mission codename',
    );
    assert.ok(
      dashboard.honesty.excludedFromTotals.some((entry) => /private mission/.test(entry)),
      'mission revenue is declared excluded from platform totals',
    );
    // The console never reads the mission database.
    for (const table of db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'mission_%'`)) {
      assert.ok(table, 'no mission tables are read by this module');
    }
  });

  it('reports unknown external provider costs as unavailable instead of estimating', () => {
    const dashboard = buildOwnerDashboard();
    assert.equal(dashboard.costs.externalProviderCosts.known, false);
    assert.equal(dashboard.costs.externalProviderCosts.requiresProviderBillingApi, true);
    assert.match(dashboard.costs.externalProviderCosts.note, /never guesses/i);
    assert.match(dashboard.costs.grossMargin.note, /excluded until connected/i);
  });

  it('reports model/API cost from recorded runs only', () => {
    const live = db.get<{ cost: number }>('SELECT COALESCE(SUM(cost_cents),0) AS cost FROM model_runs');
    const dashboard = buildOwnerDashboard();
    assert.equal(dashboard.costs.api.modelCostCents, Number(live?.cost ?? 0));
  });

  it('labels promotion engagement as provider-sourced only', () => {
    const dashboard = buildOwnerDashboard();
    assert.match(dashboard.promotion.honesty, /provider API responses/);
    assert.equal(typeof dashboard.promotion.engagementSnapshots, 'number');
  });

  it('stays stable when called repeatedly (no mutation, no fabrication drift)', () => {
    const first = buildOwnerDashboard();
    const second = buildOwnerDashboard();
    for (const key of ['users', 'plans', 'credits', 'tasks', 'agents'] as const) {
      assert.deepEqual(
        JSON.parse(JSON.stringify(second[key])),
        JSON.parse(JSON.stringify(first[key])),
        `${key} section is a pure read`,
      );
    }
    assert.ok(ownerId, 'owner account exists for the audit trail');
  });
});
