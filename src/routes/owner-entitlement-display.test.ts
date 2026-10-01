import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiServer, type ApiServer } from '../app';
import { db, createUser } from '../db';
import { hashPassword } from '../security/password';
import { hasUnlimitedTaskCredits } from '../auth/entitlements';
import { executionQueue } from '../orchestrator/queue';
import { syncAgentRegistry } from '../agents/registry';

/**
 * REGRESSION LOCK — owner/super_admin display entitlement (2026-09-30).
 *
 * Audit found the owner account's header correctly says "owner workspace ·
 * unlimited execution" while a separate credit pill on the same screen shows
 * "Trial · 1 free" — real, un-role-aware billing bookkeeping data that is
 * never consulted for this account's actual task execution
 * (src/orchestrator/executor.ts already ignores it entirely for
 * owner/super_admin — that part was already correct and tested by
 * src/orchestrator/owner-entitlement.test.ts, untouched by this fix).
 *
 * The bug lived in the DISPLAY surfaces: `/api/me`, `/api/dashboard`,
 * `/api/dashboard/credits` and `/api/billing/account` all returned the raw
 * `credit_accounts`/`profiles` rows with no `role` check at all, so the
 * frontend had no way to know the number it was showing was irrelevant for
 * this account.
 *
 * The fix reuses the SAME `hasUnlimitedTaskCredits` helper the orchestrator
 * already uses for the real entitlement, so this suite doubles as a parity
 * check: the display flag can never disagree with the real thing because
 * both read the same function. It must never be reimplemented from `role`
 * a second time anywhere.
 *
 * These tests run against the real HTTP surface with a real database.
 */

const suffix = randomBytes(6).toString('hex');
const password = 'correct-horse-battery-staple';

interface Actor {
  id: string;
  token: string;
  email: string;
}

async function register(baseUrl: string, label: string): Promise<Actor> {
  const email = `disp-${label}-${suffix}@akbaral.test`;
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name: `Display ${label}` }),
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

async function loginDirect(baseUrl: string, email: string): Promise<string> {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200, `login must succeed for ${email}`);
  const body = (await login.json()) as { accessToken: string };
  return body.accessToken;
}

function authed(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function drainCredits(userId: string): void {
  db.run(
    `UPDATE credit_accounts SET free_credits = 0, paid_credits = 0, bonus_credits = 0 WHERE user_id = ?`,
    [userId],
  );
}

describe('owner/super_admin display entitlement — /api/me, /api/dashboard, /api/dashboard/credits, /api/billing/account', () => {
  let api: ApiServer;
  let baseUrl = '';
  let owner: Actor;
  let superAdmin: Actor;
  let normalUser: Actor;

  before(async () => {
    syncAgentRegistry();

    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;

    // Owner/super_admin accounts can ONLY ever be created by the operator
    // bootstrap (src/auth/owner-identity.ts), never by public registration —
    // that boundary is untouched here. This test creates the role directly,
    // exactly as src/orchestrator/owner-entitlement.test.ts already does,
    // to exercise the HTTP display surfaces for that role.
    const passwordHash = await hashPassword(password);
    const ownerEmail = `disp-owner-${suffix}@akbaral.test`;
    const superAdminEmail = `disp-super-${suffix}@akbaral.test`;

    // freeCredits: 1 reproduces the exact production scenario reported
    // ("Trial · 1 free" on an owner account) instead of an already-drained
    // account, so this suite fails if the fix only worked at zero balance.
    const ownerId = createUser({ email: ownerEmail, name: 'Owner Display', role: 'owner', passwordHash, freeCredits: 1 }).id;
    const superAdminId = createUser({ email: superAdminEmail, name: 'Super Admin Display', role: 'super_admin', passwordHash, freeCredits: 1 }).id;

    owner = { id: ownerId, email: ownerEmail, token: await loginDirect(baseUrl, ownerEmail) };
    superAdmin = { id: superAdminId, email: superAdminEmail, token: await loginDirect(baseUrl, superAdminEmail) };
    normalUser = await register(baseUrl, 'normal');
  });

  after(async () => {
    try {
      executionQueue.stop();
    } catch {
      // queue may already be stopped
    }
    db.run('DELETE FROM users WHERE id IN (?, ?, ?)', [owner.id, superAdmin.id, normalUser.id]);
    db.close();
    await api.close();
  });

  describe('GET /api/me', () => {
    it('reports unlimited:true for the owner and never disagrees with the real entitlement helper', async () => {
      const response = await fetch(`${baseUrl}/api/me`, { headers: authed(owner.token) });
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, any>;
      assert.equal(body.user.role, 'owner');
      assert.equal(body.unlimited, true, 'owner must be reported unlimited');
      assert.equal(body.unlimited, hasUnlimitedTaskCredits(owner.id), 'display flag must match the real orchestrator entitlement exactly');
    });

    it('reports unlimited:true for super_admin', async () => {
      const response = await fetch(`${baseUrl}/api/me`, { headers: authed(superAdmin.token) });
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, any>;
      assert.equal(body.user.role, 'super_admin');
      assert.equal(body.unlimited, true);
      assert.equal(body.unlimited, hasUnlimitedTaskCredits(superAdmin.id));
    });

    it('leaves normal-user trial/credit reporting completely unchanged (unlimited:false, real numbers present)', async () => {
      const response = await fetch(`${baseUrl}/api/me`, { headers: authed(normalUser.token) });
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, any>;
      assert.equal(body.user.role, 'user');
      assert.equal(body.unlimited, false, 'a normal user must never be reported unlimited');
      assert.equal(body.unlimited, hasUnlimitedTaskCredits(normalUser.id));
      assert.equal(typeof body.user.freeCredits, 'number', 'freeCredits field is unchanged in shape');
      assert.ok(body.trial && typeof body.trial.active === 'boolean', 'trial object is unchanged in shape');
      assert.equal(body.trial.active, true, 'a freshly registered user is still on an active trial, exactly as before');
    });
  });

  describe('GET /api/dashboard', () => {
    it('exposes credits.unlimited:true for the owner', async () => {
      const response = await fetch(`${baseUrl}/api/dashboard`, { headers: authed(owner.token) });
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, any>;
      assert.equal(body.credits.unlimited, true);
    });

    it('exposes credits.unlimited:false for a normal user, other credit fields unchanged', async () => {
      const response = await fetch(`${baseUrl}/api/dashboard`, { headers: authed(normalUser.token) });
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, any>;
      assert.equal(body.credits.unlimited, false);
      assert.equal(typeof body.credits.available, 'number');
      assert.ok(body.credits.account, 'account breakdown is still present, unchanged');
    });
  });

  describe('GET /api/dashboard/credits', () => {
    it('exposes unlimited:true for super_admin', async () => {
      const response = await fetch(`${baseUrl}/api/dashboard/credits`, { headers: authed(superAdmin.token) });
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, any>;
      assert.equal(body.unlimited, true);
    });

    it('exposes unlimited:false for a normal user', async () => {
      const response = await fetch(`${baseUrl}/api/dashboard/credits`, { headers: authed(normalUser.token) });
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, any>;
      assert.equal(body.unlimited, false);
    });
  });

  describe('GET /api/billing/account', () => {
    it('exposes unlimited:true for the owner, trial object unchanged in shape', async () => {
      const response = await fetch(`${baseUrl}/api/billing/account`, { headers: authed(owner.token) });
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, any>;
      assert.equal(body.unlimited, true);
      assert.ok(body.trial, 'trial object is still returned unchanged for every role');
    });

    it('exposes unlimited:false for a normal user', async () => {
      const response = await fetch(`${baseUrl}/api/billing/account`, { headers: authed(normalUser.token) });
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, any>;
      assert.equal(body.unlimited, false);
    });
  });

  describe('owner execution remains unlimited end-to-end (unchanged behaviour, exercised over real HTTP)', () => {
    it('dispatches a real task for a zero-credit owner without requires_pro, exactly as before this fix', async () => {
      drainCredits(owner.id);
      const response = await fetch(`${baseUrl}/api/tasks/research`, {
        method: 'POST',
        headers: { ...authed(owner.token), 'content-type': 'application/json' },
        body: JSON.stringify({ goal: 'Owner display-fix regression: unlimited execution over HTTP' }),
      });
      assert.equal(response.status, 202, 'a zero-credit owner must still be able to dispatch a task');
      const body = (await response.json()) as Record<string, any>;
      assert.equal(body.freeCredits, 0, 'owner balance is reported unchanged, never consumed');

      const account = db.get<{ free_credits: number; paid_credits: number; bonus_credits: number }>(
        'SELECT free_credits, paid_credits, bonus_credits FROM credit_accounts WHERE user_id = ?',
        [owner.id],
      );
      const total = Number(account?.free_credits ?? 0) + Number(account?.paid_credits ?? 0) + Number(account?.bonus_credits ?? 0);
      assert.equal(total, 0, 'no credit was consumed by the owner execution');
    });

    it('still refuses a zero-credit normal user with requires_pro, exactly as before this fix', async () => {
      drainCredits(normalUser.id);
      const response = await fetch(`${baseUrl}/api/tasks/research`, {
        method: 'POST',
        headers: { ...authed(normalUser.token), 'content-type': 'application/json' },
        body: JSON.stringify({ goal: 'Normal user with no credits' }),
      });
      assert.equal(response.status, 402, 'a zero-credit normal user must still be refused (requires_pro -> 402)');
      const body = (await response.json()) as Record<string, any>;
      assert.equal(body.error?.code, 'requires_pro');
    });
  });
});
