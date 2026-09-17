import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createApiServer, type ApiServer } from '../app';
import { db, getCreditAccount } from '../db';
import { env } from '../config/env';
import { signAccessToken, verifyAccessToken } from './jwt';
import { assertAllowedSourceUrl } from './ssrf';
import { resolveStoredFilePath, UPLOAD_DIR } from '../services/files';

/**
 * Milestone 9 — attack-surface verification.
 *
 * Every test here attacks the REAL HTTP API (in-process server with the
 * production middleware stack: auth, RBAC, rate limits, validation) or the
 * real guard functions. Nothing is mocked into passing: if a control is
 * missing the test fails, and the fix goes into the application.
 */

const suffix = randomBytes(6).toString('hex');
const password = 'correct-horse-battery-staple';
const WEBHOOK_SECRET = `m9-webhook-${suffix}`;

describe('Milestone 9: attack surface', () => {
  let api: ApiServer;
  let baseUrl = '';
  let victimToken = '';
  let attackerToken = '';
  let adminToken = '';
  let victimId = '';
  let adminId = '';
  const uploadedStorageKeys: string[] = [];

  before(async () => {
    process.env.BILLING_WEBHOOK_SECRET = WEBHOOK_SECRET;
    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;

    const registerAndLogin = async (label: string): Promise<{ id: string; token: string }> => {
      const email = `m9-${label}-${suffix}@akbaral.test`;
      const registered = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: `M9 ${label}` }),
      });
      assert.equal(registered.status, 201, `register ${label}`);
      const body = (await registered.json()) as { user: { id: string } };
      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(loginResponse.status, 200, `login ${label}`);
      const loginBody = (await loginResponse.json()) as { accessToken: string };
      return { id: body.user.id, token: loginBody.accessToken };
    };

    const victim = await registerAndLogin('victim');
    victimToken = victim.token;
    victimId = victim.id;
    const attacker = await registerAndLogin('attacker');
    attackerToken = attacker.token;
    const admin = await registerAndLogin('admin');
    adminId = admin.id;
    db.run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminId]);
    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `m9-admin-${suffix}@akbaral.test`, password }),
    });
    adminToken = ((await adminLogin.json()) as { accessToken: string }).accessToken;
  });

  after(async () => {
    for (const key of uploadedStorageKeys) {
      try {
        fs.unlinkSync(resolveStoredFilePath(key));
      } catch {
        // already gone
      }
    }
    // Remove this run's users so later suites see the same shared-db state
    // (agents owned by these users flip to ownerless via ON DELETE SET NULL).
    db.run('DELETE FROM users WHERE email LIKE ?', [`m9-%${suffix}@akbaral.test`]);
    delete process.env.BILLING_WEBHOOK_SECRET;
    db.close();
    await api.close();
  });

  // ------------------------------------------------------------ token auth ---

  it('rejects forged and tampered JWTs', async () => {
    const b64 = (value: string): string => Buffer.from(value).toString('base64url');

    // alg:none forgery
    const noneHeader = b64(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const noneBody = b64(JSON.stringify({ sub: victimId, email: 'x@y.z', role: 'admin', sid: 'sess_x', exp: Math.floor(Date.now() / 1000) + 3600 }));
    const noneToken = `${noneHeader}.${noneBody}.`;

    // correctly formatted but signed with the attacker's own secret
    const wrongSecretHeader = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const wrongSecretBody = b64(JSON.stringify({ sub: victimId, email: 'x@y.z', role: 'admin', sid: 'sess_x', exp: Math.floor(Date.now() / 1000) + 3600 }));
    const wrongSig = createHmac('sha256', 'attacker-controlled-secret').update(`${wrongSecretHeader}.${wrongSecretBody}`).digest('base64url');
    const wrongSecretToken = `${wrongSecretHeader}.${wrongSecretBody}.${wrongSig}`;

    // signed with the REAL secret but expired
    const expiredBody = b64(JSON.stringify({ sub: victimId, email: 'x@y.z', role: 'user', sid: 'sess_x', exp: Math.floor(Date.now() / 1000) - 1000 }));
    const expiredSig = createHmac('sha256', env.sessionSecret).update(`${wrongSecretHeader}.${expiredBody}`).digest('base64url');
    const expiredToken = `${wrongSecretHeader}.${expiredBody}.${expiredSig}`;

    for (const token of [noneToken, wrongSecretToken, expiredToken, 'not-a-jwt', 'a.b.c.d']) {
      const response = await fetch(`${baseUrl}/api/me`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 401, `token must be rejected: ${token.slice(0, 24)}…`);
    }

    // Sanity: the unit verifier agrees and pins the algorithm.
    assert.equal(verifyAccessToken(noneToken), null, 'alg:none rejected by verifier');
    assert.equal(verifyAccessToken(wrongSecretToken), null, 'wrong secret rejected by verifier');
    assert.equal(verifyAccessToken(expiredToken), null, 'expired rejected by verifier');
    assert.ok(verifyAccessToken(victimToken), 'legitimate token still validates');
  });

  it('keeps tokens valid across a session-secret rotation grace window', () => {
    const token = signAccessToken({ sub: victimId, email: 'x@y.z', role: 'user', sid: 'sess_rot' });
    const originalSecret = env.sessionSecret;
    const originalPrevious = env.sessionSecretPrevious;
    const mutableEnv = env as unknown as { sessionSecret: string; sessionSecretPrevious: string | null };
    try {
      // Rotate: new secret becomes current, old secret stays valid for the
      // grace window (remaining access-token lifetime).
      mutableEnv.sessionSecret = 'rotated-secret-m9';
      mutableEnv.sessionSecretPrevious = originalSecret;
      assert.ok(verifyAccessToken(token), 'old-secret token still valid during grace');

      // Once the grace secret is dropped, old tokens die.
      mutableEnv.sessionSecretPrevious = null;
      assert.equal(verifyAccessToken(token), null, 'old-secret token rejected after grace ends');
    } finally {
      mutableEnv.sessionSecret = originalSecret;
      mutableEnv.sessionSecretPrevious = originalPrevious;
    }
  });

  // ------------------------------------------------------- privilege esc. ---

  it('ignores a role field on registration (no self-promotion)', async () => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `m9-esc-${suffix}@akbaral.test`, password, name: 'Escalator', role: 'admin', status: 'active' }),
    });
    assert.equal(response.status, 201);
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `m9-esc-${suffix}@akbaral.test`, password }),
    });
    const { accessToken } = (await loginResponse.json()) as { accessToken: string };
    const me = await fetch(`${baseUrl}/api/me`, { headers: { authorization: `Bearer ${accessToken}` } });
    const meBody = (await me.json()) as { user: { role: string } };
    assert.equal(meBody.user.role, 'user', 'role input is ignored');
    const adminRoute = await fetch(`${baseUrl}/api/admin/stats`, { headers: { authorization: `Bearer ${accessToken}` } });
    assert.equal(adminRoute.status, 403, 'self-promoted role does not grant admin access');
  });

  it('blocks admin endpoints for non-admins and anonymous callers', async () => {
    const asUser = await fetch(`${baseUrl}/api/admin/stats`, { headers: { authorization: `Bearer ${victimToken}` } });
    assert.equal(asUser.status, 403);
    const anon = await fetch(`${baseUrl}/api/admin/stats`);
    assert.equal(anon.status, 401);
    const auditAsUser = await fetch(`${baseUrl}/api/admin/audit`, { headers: { authorization: `Bearer ${victimToken}` } });
    assert.equal(auditAsUser.status, 403);
  });

  // ---------------------------------------------------------- brute force ---

  it('locks an account after repeated failed logins (429, even with the correct password)', async () => {
    const email = `m9-lockout-${suffix}@akbaral.test`;
    const registered = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Lockout Target' }),
    });
    assert.equal(registered.status, 201);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const failed = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrong-password-attempt' }),
      });
      assert.equal(failed.status, 401, `attempt ${attempt + 1} rejected as invalid credentials`);
      const body = (await failed.json()) as { error: { message: string } };
      assert.equal(body.error.message, 'invalid email or password', 'failure reason stays generic (no user enumeration)');
    }

    const blocked = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(blocked.status, 429, 'correct password is also blocked during the lockout window');
    const blockedBody = (await blocked.json()) as { error: { code: string; message: string } };
    assert.equal(blockedBody.error.code, 'login_rate_limited');

    const lockLogged = db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM security_logs WHERE event_type = 'auth.login.locked'",
    );
    assert.ok((lockLogged?.count ?? 0) >= 1, 'lockout is recorded in security_logs');

    // A different account is unaffected (the lockout is per account, not global).
    const other = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `m9-victim-${suffix}@akbaral.test`, password }),
    });
    assert.equal(other.status, 200, 'other accounts can still log in');
  });

  // -------------------------------------------------------- tenant isolation ---

  it('denies cross-tenant access to projects, executions, invoices and files (IDOR)', async () => {
    const created = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${victimToken}` },
      body: JSON.stringify({ name: `M9 Victim Project ${suffix}`, description: 'private' }),
    });
    assert.equal(created.status, 201);
    const { project } = (await created.json()) as { project: { id: string } };

    const attackerRead = await fetch(`${baseUrl}/api/projects/${project.id}`, { headers: { authorization: `Bearer ${attackerToken}` } });
    assert.equal(attackerRead.status, 404, 'no existence leak on projects');

    const attackerExecution = await fetch(`${baseUrl}/api/tasks/execution/exec_does_not_exist`, { headers: { authorization: `Bearer ${attackerToken}` } });
    assert.equal(attackerExecution.status, 404);

    // Victim's invoice is invisible to the attacker.
    const purchase = await fetch(`${baseUrl}/api/billing/credits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${victimToken}` },
      body: JSON.stringify({ credits: 5, amount_cents: 250, provider: 'manual' }),
    });
    assert.equal(purchase.status, 201);
    const { order } = (await purchase.json()) as { order: { invoiceId: string } };
    const pdfAsAttacker = await fetch(`${baseUrl}/api/billing/invoices/${order.invoiceId}/pdf`, { headers: { authorization: `Bearer ${attackerToken}` } });
    assert.equal(pdfAsAttacker.status, 404, 'invoice PDF is owner-only');

    const randomFile = await fetch(`${baseUrl}/api/files/fle_does_not_exist`, { headers: { authorization: `Bearer ${attackerToken}` } });
    assert.equal(randomFile.status, 404);
  });

  // ------------------------------------------------------------------ SSRF ---

  it('rejects SSRF targets: loopback, private ranges, link-local metadata, non-http schemes', () => {
    const attacks = [
      'http://127.0.0.1:4000/api/admin/stats',
      'http://localhost/health',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/internal',
      'http://192.168.1.1/admin',
      'http://172.16.0.10/',
      'http://[::1]/',
      'file:///etc/passwd',
      'ftp://internal-host/data',
      'http://0.0.0.0/',
    ];
    for (const url of attacks) {
      assert.throws(() => assertAllowedSourceUrl(url), Error, `must reject ${url}`);
    }
    assert.equal(assertAllowedSourceUrl('https://example.com/article'), 'https://example.com/article', 'public https still allowed');
  });

  // -------------------------------------------------------- path traversal ---

  it('contains path traversal in storage keys and file ids', () => {
    for (const key of ['../../etc/passwd', 'a/b/c.txt', '/etc/passwd', '..', 'x\0y', 'C:\\windows\\evil']) {
      assert.throws(() => resolveStoredFilePath(key), Error, `must reject storage key ${JSON.stringify(key)}`);
    }

    const httpAttack = `${baseUrl}/api/files/${encodeURIComponent('../../../../etc/passwd')}`;
    void (async () => {
      const response = await fetch(httpAttack, { headers: { authorization: `Bearer ${attackerToken}` } });
      assert.equal(response.status, 404, 'traversal ids are just unknown ids — no file access');
    })();
  });

  // ------------------------------------------------------ malicious uploads ---

  it('sanitizes malicious uploads: traversal filenames, executables, oversize', async () => {
    const created = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${victimToken}` },
      body: JSON.stringify({ name: `M9 Upload Project ${suffix}` }),
    });
    const { project } = (await created.json()) as { project: { id: string } };

    // 1) A traversal filename must not escape the upload directory.
    const form = new FormData();
    form.append('file', new Blob(['#!/bin/sh\necho pwned\n'], { type: 'text/x-shellscript' }), '../../evil.sh');
    const upload = await fetch(`${baseUrl}/api/projects/${project.id}/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${victimToken}` },
      body: form,
    });
    assert.equal(upload.status, 201);
    const uploadBody = (await upload.json()) as { file: { storageKey: string; fileId: string } };
    const storedPath = resolveStoredFilePath(uploadBody.file.storageKey);
    assert.ok(storedPath.startsWith(UPLOAD_DIR + '/'), 'stored inside the upload directory');
    assert.ok(!storedPath.includes('..'), 'no traversal segments on disk');
    uploadedStorageKeys.push(uploadBody.file.storageKey);

    // Downloading it back must not leak a raw traversal filename.
    const download = await fetch(`${baseUrl}/api/files/${uploadBody.file.fileId}`, { headers: { authorization: `Bearer ${victimToken}` } });
    assert.equal(download.status, 200);
    const disposition = String(download.headers.get('content-disposition') ?? '');
    assert.ok(!disposition.includes('..'), 'download filename is encoded');

    // 2) Oversized payloads are rejected by the limit.
    const big = new FormData();
    big.append('file', new Blob([Buffer.alloc(26 * 1024 * 1024)], { type: 'application/octet-stream' }), 'big.bin');
    const oversize = await fetch(`${baseUrl}/api/projects/${project.id}/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${victimToken}` },
      body: big,
    });
    assert.equal(oversize.status, 400, '26MB exceeds the 25MB limit');

    // 3) Non-members cannot upload into someone else's project.
    const foreign = new FormData();
    foreign.append('file', new Blob(['x'], { type: 'text/plain' }), 'innocent.txt');
    const asAttacker = await fetch(`${baseUrl}/api/projects/${project.id}/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${attackerToken}` },
      body: foreign,
    });
    assert.equal(asAttacker.status, 404, 'no existence leak for foreign projects');
  });

  // ---------------------------------------------------------- secret leakage ---

  it('leaks no secrets in config status, error bodies, or request logs', async () => {
    // Config status exposes names/booleans only.
    const config = await fetch(`${baseUrl}/api/admin/config/status`, { headers: { authorization: `Bearer ${adminToken}` } });
    assert.equal(config.status, 200);
    const configText = await config.text();
    assert.ok(!configText.includes(WEBHOOK_SECRET), 'webhook secret value not exposed');
    assert.ok(!configText.includes(env.sessionSecret), 'session secret value not exposed');
    assert.ok(!/(sk-|Bearer\s)[A-Za-z0-9_-]{16,}/.exec(configText), 'no credential-shaped values');

    // Generic login failures do not confirm which accounts exist.
    const noSuchUser = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `no-such-user-${suffix}@akbaral.test`, password: 'whatever' }),
    });
    assert.equal(noSuchUser.status, 401);
    const noSuchBody = (await noSuchUser.json()) as { error: { message: string } };
    assert.equal(noSuchBody.error.message, 'invalid email or password');

    // Structured request logs contain no authorization header values.
    const logged: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    };
    try {
      await fetch(`${baseUrl}/api/me`, { headers: { authorization: `Bearer ${victimToken}` } });
    } finally {
      console.log = originalLog;
    }
    const joined = logged.join('\n');
    assert.ok(!joined.includes(victimToken), 'access token never logged');
    assert.ok(!joined.includes('authorization'), 'authorization header not logged');
  });

  // ------------------------------------------------------------- audit trail ---

  it('audit search returns real admin actions with filters and bounded pages', async () => {
    const flagKey = `m9_audit_flag_${suffix}`;
    const toggled = await fetch(`${baseUrl}/api/admin/feature-flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ key: flagKey, enabled: false, description: 'm9 audit test flag' }),
    });
    assert.equal(toggled.status, 200);

    const byAction = await fetch(`${baseUrl}/api/admin/audit?action=feature_flag&limit=10`, { headers: { authorization: `Bearer ${adminToken}` } });
    assert.equal(byAction.status, 200);
    const byActionBody = (await byAction.json()) as { actions: Array<{ action: string; actor_user_id: string; target_id: string }>; total: number };
    assert.ok(byActionBody.total >= 1, 'the flag change is recorded');
    assert.ok(byActionBody.actions.every((action) => action.action.startsWith('feature_flag')), 'action filter respected');
    assert.ok(byActionBody.actions.some((action) => action.target_id === flagKey), 'target recorded');
    assert.ok(byActionBody.actions.every((action) => action.actor_user_id === adminId), 'actor recorded');

    const byActor = await fetch(`${baseUrl}/api/admin/audit?actor=${victimId}`, { headers: { authorization: `Bearer ${adminToken}` } });
    const byActorBody = (await byActor.json()) as { total: number };
    assert.equal(byActorBody.total, 0, 'victim performed no admin actions');

    const bounded = await fetch(`${baseUrl}/api/admin/audit?limit=99999`, { headers: { authorization: `Bearer ${adminToken}` } });
    const boundedBody = (await bounded.json()) as { actions: unknown[] };
    assert.ok(boundedBody.actions.length <= 200, 'page size is bounded');
  });

  // ------------------------------------------------------ race conditions ---

  it('settles a payment exactly once under concurrent duplicate webhooks', async () => {
    const purchase = await fetch(`${baseUrl}/api/billing/credits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${victimToken}` },
      body: JSON.stringify({ credits: 5, amount_cents: 250, provider: 'manual' }),
    });
    const { order } = (await purchase.json()) as { order: { invoiceId: string } };

    const send = async (): Promise<{ effect: string }> => {
      const body = JSON.stringify({ event: 'invoice.paid', event_id: 'evt_m9_race_1', provider: 'stripe', invoice_id: order.invoiceId });
      const signature = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
      const response = await fetch(`${baseUrl}/api/billing/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-akbaral-signature': `sha256=${signature}` },
        body,
      });
      assert.equal(response.status, 200);
      return (await response.json()) as { effect: string };
    };

    const results = await Promise.all(Array.from({ length: 8 }, () => send()));
    const settled = results.filter((result) => result.effect === 'settled').length;
    const duplicates = results.filter((result) => result.effect === 'ignored_duplicate').length;
    assert.equal(settled, 1, 'exactly one delivery settles');
    assert.ok(duplicates >= 7, `other concurrent deliveries are ignored duplicates (got ${duplicates})`);

    const account = getCreditAccount(victimId);
    assert.equal(account?.paid_credits ?? 0, 5, 'credits granted exactly once');
  });

  it('rejects credit manipulation through negative or zero purchase inputs', async () => {
    const negative = await fetch(`${baseUrl}/api/billing/credits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${victimToken}` },
      body: JSON.stringify({ credits: -50, amount_cents: -1000, provider: 'manual' }),
    });
    assert.ok([400, 422].includes(negative.status), 'negative purchase rejected');

    const zero = await fetch(`${baseUrl}/api/billing/credits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${victimToken}` },
      body: JSON.stringify({ credits: 0, amount_cents: 0, provider: 'manual' }),
    });
    assert.ok([400, 422].includes(zero.status), 'zero-value purchase rejected');

    const account = getCreditAccount(victimId);
    assert.equal(account?.paid_credits ?? 0, 5, 'no credits moved');
  });

  // --------------------------------------------------- rate-limit bypass ----
  // Runs LAST on purpose: it exhausts the per-IP API bucket for this process.

  it('keys rate-limit buckets on the real client IP (X-Forwarded-For spoofing does not bypass)', async () => {
    let sawLimit = false;
    let accepted = 0;
    for (let attempt = 0; attempt < 330 && !sawLimit; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: { 'x-forwarded-for': `198.51.100.${(attempt % 250) + 1}, 203.0.113.${(attempt % 250) + 1}` },
      });
      if (response.status === 429) {
        sawLimit = true;
        const body = (await response.json()) as { error: { code: string } };
        assert.equal(body.error.code, 'rate_limited');
      } else {
        accepted += 1;
      }
    }
    assert.ok(sawLimit, `spoofed forwarded IPs share the real-IP bucket (accepted ${accepted} requests first)`);
    assert.ok(accepted >= 100, 'the bucket allowed a normal volume before limiting');
  });
});
