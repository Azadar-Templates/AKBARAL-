/**
 * FINAL OWNER/USER IDENTITY MODEL — regression suite.
 *
 * Locks the rule set:
 *   - zanaveed555@gmail.com is the ONE fixed AKBARAL! owner identity; any
 *     other email is a normal user.
 *   - Ordinary public registration/login can NEVER grant the 'owner' role —
 *     not even to an account that uses the exact literal fixed owner email
 *     string. The ONLY way to become owner is the operator-invoked
 *     `bootstrapOwnerAccount` (`npm run owner:bootstrap`), which requires
 *     direct server/database access — a fundamentally different, much
 *     higher trust bar than a public HTML form. This closes the
 *     email-squatting hole in the previous design, where whoever registered
 *     the owner's email address FIRST silently became owner on their next
 *     login, with zero verification.
 *   - A pre-existing account that is NOT already trusted (owner/super_admin)
 *     is never silently taken over by the bootstrap either — it requires an
 *     explicit, separate takeover confirmation.
 *   - Owner gets the owner dashboard/APIs and unlimited task credits once
 *     legitimately established; a normal user gets the normal dashboard and
 *     the standard 5-free-task / plan-limited accounting.
 *   - Nothing supplied by the client (a `role` field on register, a header,
 *     a request body field, a tampered JWT) can change which role an
 *     account ends up with.
 *   - AKBARAL! customer authentication — including the owner's own customer
 *     session — can never authorize the private ZA141251SA mission
 *     dashboard/API, which remains gated purely by its own out-of-band
 *     bearer token (the P0 fail-closed fix in boss-dashboard.ts).
 *
 * All mission-dashboard checks here run against a disposable, temp-file
 * mission database created just for this test file — never production, and
 * the real mission is never initialized.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyMigrations } from '../db/migrate';
import { db, findUserByEmail } from '../db';
import {
  FIXED_OWNER_EMAIL,
  normalizeEmail,
  isFixedOwnerEmail,
  bootstrapOwnerAccount,
  OwnerBootstrapConfirmationRequiredError,
} from './owner-identity';
import { hasUnlimitedTaskCredits } from './entitlements';
import { createApiServer, type ApiServer } from '../app';

const BOOTSTRAP_PASSWORD = 'owner-bootstrap-password-1';

async function call(baseUrl: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body: Record<string, any> = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { status: response.status, body };
}
const json = { 'content-type': 'application/json' };

// ── Section 1: identity resolution + the bootstrap primitive (unit) ───────

describe('owner identity: fixed email, bootstrap-only promotion (no HTTP)', () => {
  before(() => {
    applyMigrations(db);
  });

  it('the fixed owner email is a hardcoded constant', () => {
    assert.equal(FIXED_OWNER_EMAIL, 'zanaveed555@gmail.com');
  });

  it('normalizes case and surrounding whitespace before comparing', () => {
    assert.equal(normalizeEmail('  ZaNaveed555@Gmail.com  '), FIXED_OWNER_EMAIL);
    assert.ok(isFixedOwnerEmail('ZANAVEED555@GMAIL.COM'));
    assert.ok(isFixedOwnerEmail('  zanaveed555@gmail.com  '));
    assert.ok(!isFixedOwnerEmail('zanaveed5555@gmail.com'), 'lookalike email is not the owner');
    assert.ok(!isFixedOwnerEmail('zanaveed555@gmail.co'), 'lookalike domain is not the owner');
  });

  it('bootstrapOwnerAccount creates a fresh, scoped, audited owner account when none exists', async () => {
    const email = `owner-battery-fresh-${randomBytes(6).toString('hex')}@akbaral.test`;
    const result = await bootstrapOwnerAccount({ password: BOOTSTRAP_PASSWORD, overrideEmail: email });
    assert.equal(result.action, 'created');
    assert.equal(findUserByEmail(email)!.role, 'owner');

    const audits = db.all(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'owner_bootstrap_created' AND resource_id = ?",
      [result.userId],
    ) as Array<{ n: number }>;
    assert.equal(Number(audits[0]?.n ?? 0), 1, 'bootstrap creation is audited exactly once');
  });

  it('bootstrapOwnerAccount rejects a weak/missing password (real credential, not a UI toy)', async () => {
    await assert.rejects(
      () => bootstrapOwnerAccount({ password: 'short', overrideEmail: `owner-weak-${randomBytes(6).toString('hex')}@akbaral.test` }),
      /at least 12 characters/,
    );
  });

  it('bootstrapOwnerAccount REFUSES to take over a pre-existing non-owner account without explicit confirmation — the anti-squatting gate', async () => {
    const email = `owner-battery-squat-${randomBytes(6).toString('hex')}@akbaral.test`;
    // Simulate a stranger who registered this exact email through the
    // ordinary public path BEFORE the operator ever runs the bootstrap.
    db.run(
      "INSERT INTO users (id, email, password_hash, name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)",
      [`usr_sq_${randomBytes(4).toString('hex')}`, email, 'irrelevant-hash', 'Squatter', new Date().toISOString(), new Date().toISOString()],
    );
    assert.equal(findUserByEmail(email)!.role, 'user');

    await assert.rejects(
      () => bootstrapOwnerAccount({ password: BOOTSTRAP_PASSWORD, overrideEmail: email }),
      (error: unknown) => error instanceof OwnerBootstrapConfirmationRequiredError,
    );
    // The refusal must not have touched anything.
    assert.equal(findUserByEmail(email)!.role, 'user', 'a refused bootstrap attempt never promotes the squatted account');

    // Only with EXPLICIT, separate confirmation does the operator's bootstrap
    // proceed — this is a deliberate human decision, never an automatic one.
    const confirmed = await bootstrapOwnerAccount({ password: BOOTSTRAP_PASSWORD, overrideEmail: email, confirmTakeover: true });
    assert.equal(confirmed.action, 'rotated');
    assert.equal(findUserByEmail(email)!.role, 'owner');

    const audits = db.all(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'owner_bootstrap_takeover_confirmed' AND resource_id = ?",
      [confirmed.userId],
    ) as Array<{ n: number }>;
    assert.equal(Number(audits[0]?.n ?? 0), 1, 'a confirmed takeover is audited distinctly');
  });

  it('bootstrapOwnerAccount is idempotent for an already-trusted account: rotates the credential, never demotes, never duplicates', async () => {
    const email = `owner-battery-rotate-${randomBytes(6).toString('hex')}@akbaral.test`;
    const first = await bootstrapOwnerAccount({ password: BOOTSTRAP_PASSWORD, overrideEmail: email });
    assert.equal(first.action, 'created');

    // Re-running (e.g. to change the password) requires no confirmation —
    // the account is already trusted, so this is just a credential rotation.
    const second = await bootstrapOwnerAccount({ password: 'owner-bootstrap-password-2', overrideEmail: email });
    assert.equal(second.action, 'rotated');
    assert.equal(second.userId, first.userId, 'the exact same account, never a duplicate');
    assert.equal(findUserByEmail(email)!.role, 'owner', 'still owner, never demoted by a rotation');
  });
});

// ── Section 2: the squatting scenario end-to-end, over real HTTP ──────────

describe('owner identity: registering the fixed owner email over HTTP claims nothing', () => {
  let api: ApiServer;
  let baseUrl = '';
  const password = 'correct-horse-battery-staple-1';

  before(async () => {
    applyMigrations(db);
    // The fixed owner email is a single, literal, shared identifier, and the
    // dev/test database (./data/akbaral.db) persists across separate test
    // runs — so start from a clean slate for it rather than assuming no
    // prior row exists.
    db.run('DELETE FROM users WHERE email = ?', [FIXED_OWNER_EMAIL]);
    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await api.close();
    db.run('DELETE FROM users WHERE email = ?', [FIXED_OWNER_EMAIL]);
  });

  it('a random person who registers zanaveed555@gmail.com through public sign-up gets an ORDINARY user account, nothing more', async () => {
    const register = await call(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: FIXED_OWNER_EMAIL, password, name: 'Whoever Got Here First' }),
    });
    assert.equal(register.status, 201);

    const login = await call(baseUrl, '/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ email: FIXED_OWNER_EMAIL, password }) });
    assert.equal(login.status, 200);
    const token = login.body.accessToken;

    const me = await call(baseUrl, '/api/me', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(me.body.user.role, 'user', 'registering/logging in with the literal owner email grants no role change');

    const ownerDash = await call(baseUrl, '/api/owner/dashboard', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(ownerDash.status, 403, 'the squatted account cannot reach the owner console');

    const userId = findUserByEmail(FIXED_OWNER_EMAIL)!.id;
    assert.equal(hasUnlimitedTaskCredits(userId), false, 'no unlimited entitlement from registering the email alone');

    // Logging in again — repeatedly — never changes this outcome. The old
    // design promoted on every login; this one never does.
    for (let i = 0; i < 3; i += 1) {
      await call(baseUrl, '/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ email: FIXED_OWNER_EMAIL, password }) });
    }
    assert.equal(findUserByEmail(FIXED_OWNER_EMAIL)!.role, 'user', 'repeated logins still never promote');
  });
});

// ── Section 3: dashboard routing, entitlement, anti-escalation (HTTP) ─────
// The owner account here is established the ONLY legitimate way: the
// bootstrap primitive, called exactly as the CLI (scripts/owner-init.ts)
// would call it — never through registration.

describe('owner/user identity model: HTTP surface (legitimately bootstrapped owner)', () => {
  let api: ApiServer;
  let baseUrl = '';
  const password = 'correct-horse-battery-staple-1';
  const suffix = randomBytes(6).toString('hex');
  const normalEmail = `identity-normal-${suffix}@akbaral.test`;
  let normalToken = '';
  let ownerToken = '';

  before(async () => {
    applyMigrations(db);
    db.run('DELETE FROM users WHERE email = ?', [FIXED_OWNER_EMAIL]);

    // The ONLY legitimate path: an operator-invoked bootstrap, exactly what
    // `npm run owner:bootstrap` does. Not a public registration.
    await bootstrapOwnerAccount({ password: BOOTSTRAP_PASSWORD });

    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;

    // A public registration attempt for the now-bootstrapped email must fail
    // as "already registered" — it can never be claimed via sign-up once the
    // operator has bootstrapped it.
    const lateRegister = await call(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: FIXED_OWNER_EMAIL, password: 'irrelevant-password-1', name: 'Too Late' }),
    });
    assert.equal(lateRegister.status, 409, 'the bootstrapped owner email can no longer be registered by anyone else');

    // Normal user: plain registration, nothing special.
    await call(baseUrl, '/api/auth/register', { method: 'POST', headers: json, body: JSON.stringify({ email: normalEmail, password, name: 'Normal' }) });
    const normalLogin = await call(baseUrl, '/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ email: normalEmail, password }) });
    normalToken = normalLogin.body.accessToken;

    // The owner logs in using the credential set by the bootstrap.
    const ownerLogin = await call(baseUrl, '/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ email: FIXED_OWNER_EMAIL, password: BOOTSTRAP_PASSWORD }) });
    ownerToken = ownerLogin.body.accessToken;
    assert.ok(ownerToken, 'the bootstrapped owner identity logs in normally, like any other customer');
  });

  after(async () => {
    await api.close();
    db.run('DELETE FROM users WHERE email = ?', [FIXED_OWNER_EMAIL]);
  });

  it('normal email logs in as role "user" with the standard 5-task free allowance', async () => {
    const me = await call(baseUrl, '/api/me', { headers: { authorization: `Bearer ${normalToken}` } });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.role, 'user');
    assert.equal(me.body.user.freeCredits, 5, 'standard free-trial allowance, unchanged');
  });

  it('the legitimately-bootstrapped owner logs in as role "owner"', async () => {
    const me = await call(baseUrl, '/api/me', { headers: { authorization: `Bearer ${ownerToken}` } });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, FIXED_OWNER_EMAIL);
    assert.equal(me.body.user.role, 'owner');
  });

  it('owner has the unlimited-task-credit entitlement server-side; a normal user does not', () => {
    const owner = findUserByEmail(FIXED_OWNER_EMAIL)!;
    const normal = findUserByEmail(normalEmail)!;
    assert.equal(hasUnlimitedTaskCredits(owner.id), true, 'owner: unlimited, never needs Pro');
    assert.equal(hasUnlimitedTaskCredits(normal.id), false, 'normal user: standard plan/credit limits apply');
  });

  it('owner reaches the owner dashboard API; a normal user is refused', async () => {
    const ownerDash = await call(baseUrl, '/api/owner/dashboard', { headers: { authorization: `Bearer ${ownerToken}` } });
    assert.equal(ownerDash.status, 200);
    assert.ok(ownerDash.body.dashboard, 'owner receives real dashboard data');

    const normalDash = await call(baseUrl, '/api/owner/dashboard', { headers: { authorization: `Bearer ${normalToken}` } });
    assert.equal(normalDash.status, 403, 'a normal user cannot reach the owner API');
  });

  it('a client-supplied "role" on registration cannot self-promote to owner', async () => {
    const escalatorEmail = `identity-escalator-${suffix}@akbaral.test`;
    await call(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: escalatorEmail, password, name: 'Escalator', role: 'owner', status: 'active' }),
    });
    const login = await call(baseUrl, '/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ email: escalatorEmail, password }) });
    const me = await call(baseUrl, '/api/me', { headers: { authorization: `Bearer ${login.body.accessToken}` } });
    assert.equal(me.body.user.role, 'user', 'the submitted role field is ignored server-side');

    const ownerRoute = await call(baseUrl, '/api/owner/dashboard', { headers: { authorization: `Bearer ${login.body.accessToken}` } });
    assert.equal(ownerRoute.status, 403, 'self-declared role grants nothing');
  });

  it('a normal request cannot escalate via spoofed headers claiming an owner role', async () => {
    const spoofed = await call(baseUrl, '/api/owner/dashboard', {
      headers: { authorization: `Bearer ${normalToken}`, 'x-role': 'owner', 'x-user-role': 'owner' },
    });
    assert.equal(spoofed.status, 403, 'headers are not a source of authorization; only the verified session is');

    const spoofedGrowth = await call(baseUrl, '/api/owner/growth', {
      headers: { authorization: `Bearer ${normalToken}`, 'x-role': 'owner' },
    });
    assert.equal(spoofedGrowth.status, 403);
  });

  it('a tampered/forged JWT role claim is rejected outright (signature verification, not trust)', async () => {
    const [h] = normalToken.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'forged', email: FIXED_OWNER_EMAIL, role: 'owner', sid: 'forged', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const forged = `${h}.${forgedPayload}.forged-signature`;
    const res = await call(baseUrl, '/api/owner/dashboard', { headers: { authorization: `Bearer ${forged}` } });
    assert.equal(res.status, 401, 'signature verification rejects the forged token outright');
  });
});

// ── Section 4: the owner's OWN customer session still cannot reach Mission ─

describe('owner/user identity model: customer auth never authorizes the private mission', () => {
  let api: ApiServer;
  let baseUrl = '';
  const suffix = randomBytes(6).toString('hex');
  const TEST_MISSION_DB = resolve(process.cwd(), `test-owner-identity-mission-${suffix}.db`);
  const MISSION_DB_FILES = [TEST_MISSION_DB, `${TEST_MISSION_DB}-shm`, `${TEST_MISSION_DB}-wal`];
  const MISSION_TOKEN = `owner-identity-mission-token-${suffix}`;
  const savedEnv = new Map<string, string | undefined>();
  let ownerToken = '';

  function cleanupMissionDbFiles(): void {
    for (const f of MISSION_DB_FILES) {
      try { if (existsSync(f)) rmSync(f); } catch { /* best-effort */ }
    }
  }

  before(async () => {
    for (const key of ['ZA141251SA_DASHBOARD_TOKEN', 'MISSION_DASHBOARD_TOKEN', 'ZA141251SA_DATABASE_URL']) {
      savedEnv.set(key, process.env[key]);
    }
    // A REAL mission token IS configured here (unlike the boss-dashboard.ts
    // battery, which also covers the unconfigured case) so this section can
    // prove the *positive* boundary: even with a working mission token
    // system, the owner's ordinary customer session is not a substitute for
    // it, and the real token still works on its own.
    process.env.ZA141251SA_DATABASE_URL = `file:${TEST_MISSION_DB}`;
    process.env.ZA141251SA_DASHBOARD_TOKEN = MISSION_TOKEN;
    delete process.env.MISSION_DASHBOARD_TOKEN;
    cleanupMissionDbFiles();

    applyMigrations(db);
    // Same rationale as Section 3: start the shared, literal fixed-owner-
    // email row from a clean slate for this run.
    db.run('DELETE FROM users WHERE email = ?', [FIXED_OWNER_EMAIL]);
    await bootstrapOwnerAccount({ password: BOOTSTRAP_PASSWORD });

    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;

    const login = await call(baseUrl, '/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ email: FIXED_OWNER_EMAIL, password: BOOTSTRAP_PASSWORD }) });
    ownerToken = login.body.accessToken;
    assert.ok(ownerToken, 'the bootstrapped owner identity can log in as an ordinary AKBARAL! customer');
  });

  after(async () => {
    await api.close();
    const { missionDb } = await import('../mission/database');
    try { missionDb.close(); } catch { /* already closed or never opened */ }
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    cleanupMissionDbFiles();
    db.run('DELETE FROM users WHERE email = ?', [FIXED_OWNER_EMAIL]);
  });

  it("the owner's own AKBARAL! customer JWT is refused by the mission dashboard (401), not treated as mission authorization", async () => {
    const res = await call(baseUrl, '/api/boss/overview', { headers: { authorization: `Bearer ${ownerToken}` } });
    assert.equal(res.status, 401);
    assert.equal(res.body.error?.code, 'unauthorized');
  });

  it('the mission dashboard is not exposed anywhere under the public customer API surface', async () => {
    // The owner's own dashboard API never mentions or proxies mission data —
    // ledger separation is structural (see business/owner-analytics.ts),
    // not just something the UI hides.
    const dash = await call(baseUrl, '/api/owner/dashboard', { headers: { authorization: `Bearer ${ownerToken}` } });
    assert.equal(dash.status, 200);
    const serialized = JSON.stringify(dash.body);
    assert.ok(!/za141251sa/i.test(serialized), 'owner dashboard payload never leaks mission identifiers');
  });

  it('the real, correct out-of-band mission token — and only that — passes the mission authorization boundary', async () => {
    const noAuth = await call(baseUrl, '/api/boss/overview');
    assert.equal(noAuth.status, 401);

    const wrongToken = await call(baseUrl, '/api/boss/overview', { headers: { authorization: 'Bearer not-the-real-token' } });
    assert.equal(wrongToken.status, 401);

    // The disposable mission DB has no schema yet; apply mission migrations
    // (idempotent, disposable file only) so the legitimate path returns real
    // data instead of failing on a missing table.
    const { applyMissionMigrations } = await import('../mission/database');
    applyMissionMigrations();

    const correct = await call(baseUrl, '/api/boss/overview', { headers: { authorization: `Bearer ${MISSION_TOKEN}` } });
    assert.equal(correct.status, 200, 'the intended, separate mission credential still works on its own');
  });
});
