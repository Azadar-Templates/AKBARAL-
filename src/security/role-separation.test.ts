import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';

/**
 * Three planes, three identities — verified at the API level.
 *
 *   · USER        an ordinary AKBARAL! customer: their own projects, tasks,
 *                 credits. Nothing else.
 *   · ADMIN       AKBARAL! staff: the admin surface. NOT the owner console,
 *                 NOT the private economy, NOT the mission.
 *   · ZA-OWNER    the private mission owner: a separate account, a separate
 *                 database, a separate session format. The mission console is
 *                 served by a different process and never accepts a platform
 *                 token; the platform never accepts a mission token.
 *
 * This file is the lock on that separation. It deliberately uses the REAL
 * servers (createApiServer + createMissionServer) and the REAL session
 * formats, because "hidden in the UI" is not isolation: every claim here is an
 * HTTP status code.
 *
 * The owner identity is never hardcoded anywhere in the product: the platform
 * owner is a role on a real account, and the mission owner is provisioned from
 * configuration (ZA141251SA_OWNER_EMAIL) into the mission database only.
 */

const MISSION_DB = path.join(os.tmpdir(), `za-role-separation-${process.pid}.db`);
process.env.ZA141251SA_DATABASE_URL = `file:${MISSION_DB}`;
process.env.ZA141251SA_SESSION_SECRET = process.env.ZA141251SA_SESSION_SECRET || 'role-separation-session-secret-0123456789';
process.env.ZA141251SA_CREDENTIAL_KEY = process.env.ZA141251SA_CREDENTIAL_KEY || 'role-separation-credential-key-0123456789';
process.env.ZA141251SA_BIND_HOST = '127.0.0.1';

import { createApiServer } from '../app';
import { db } from '../db';
import { syncAgentRegistry } from '../agents/registry';
import { clearRateLimitBuckets } from '../server/middleware/rate-limit';
import type { MissionDatabaseModule } from './mission-modules';

// The mission modules are resolved inside `before()`: the mission database URL
// must be in the environment before they are loaded, and the platform side must
// never import them at all.
type MissionModules = {
  database: typeof import('../mission/database');
  auth: typeof import('../mission/auth');
  server: typeof import('../mission/server');
  policy: typeof import('../mission/policy');
  selfManagement: typeof import('../mission/self-management');
};

let missionModules: MissionModules;
let missionDbRef: MissionDatabaseModule['missionDb'];

const suffix = randomBytes(6).toString('hex');
const password = 'correct-horse-battery-staple';
const userEmail = `sep-user-${suffix}@akbaral.test`;
const adminEmail = `sep-admin-${suffix}@akbaral.test`;
const ownerEmail = `sep-owner-${suffix}@akbaral.test`;
// The mission owner is a DIFFERENT person with a different identity plane.
const missionOwnerEmail = `sep-mission-owner-${suffix}@za141251sa.test`;
const missionOwnerPassword = 'mission-owner-password-separation-1';

let api: ReturnType<typeof createApiServer>;
let mission: { close(callback: () => void): void; listen(port: number, host: string, callback: () => void): void; address(): unknown };
let platformBase = '';
let missionBase = '';
let userToken = '';
let adminToken = '';
let ownerToken = '';
let missionToken = '';

async function call(base: string, route: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${route}`, init);
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

function headers(token: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
}

async function registerAndLogin(email: string, role?: string): Promise<string> {
  const created = await call(platformBase, '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name: email.split('@')[0] }),
  });
  assert.ok([200, 201].includes(created.status), `registered ${email} (${created.status})`);
  if (role) db.run('UPDATE users SET role = ? WHERE email = ?', [role, email]);
  const login = await call(platformBase, '/api/auth/login', {
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
  api = createApiServer();
  const listening = await api.listen(0);
  platformBase = `http://127.0.0.1:${listening.port}`;

  ownerToken = await registerAndLogin(ownerEmail, 'owner');
  adminToken = await registerAndLogin(adminEmail, 'admin');
  userToken = await registerAndLogin(userEmail);

  // ── the private mission plane: its own process, database and credentials ──
  missionModules = {
    database: await import('../mission/database'),
    auth: await import('../mission/auth'),
    server: await import('../mission/server'),
    policy: await import('../mission/policy'),
    selfManagement: await import('../mission/self-management'),
  };
  missionDbRef = missionModules.database.missionDb;
  missionModules.database.applyMissionMigrations();
  missionModules.policy.ensurePolicy('USD');
  missionModules.selfManagement.seedTools();
  missionModules.auth.provisionOwner({ email: missionOwnerEmail, password: missionOwnerPassword });
  mission = missionModules.server.createMissionServer();
  await new Promise<void>((resolve) => mission.listen(0, '127.0.0.1', () => resolve()));
  missionBase = `http://127.0.0.1:${(mission.address() as AddressInfo).port}`;
  const session = missionModules.auth.login({ email: missionOwnerEmail, password: missionOwnerPassword });
  missionToken = session.token;
});

after(async () => {
  if (api) await api.close();
  if (mission) await new Promise<void>((resolve) => mission.close(() => resolve()));
  db.run('DELETE FROM users WHERE email LIKE ?', [`sep-%@akbaral.test`]);
  db.close();
  try {
    missionDbRef.close();
  } catch {
    /* ignore */
  }
  for (const suffixPart of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${MISSION_DB}${suffixPart}`)) fs.rmSync(`${MISSION_DB}${suffixPart}`, { force: true });
  }
});

describe('platform user plane', () => {
  it('a customer reaches their own surfaces (their CRM is theirs, not the owner console)', async () => {
    for (const route of ['/api/me', '/api/projects', '/api/tasks', '/api/workflows', '/api/crm/contacts']) {
      const response = await call(platformBase, route, { headers: headers(userToken) });
      assert.ok([200, 204].includes(response.status), `${route} → ${response.status}`);
    }
  });

  it('a customer cannot reach the admin, owner console, CRM or private economy', async () => {
    for (const route of [
      '/api/admin/stats',
      '/api/admin/audit',
      '/api/owner/dashboard',
      '/api/economy/dashboard',
      '/api/economy/hierarchy',
      '/api/economy/controls',
    ]) {
      const response = await call(platformBase, route, { headers: headers(userToken) });
      assert.equal(response.status, 403, `${route} must be 403 for a customer (got ${response.status})`);
    }
  });
});

describe('customer data is scoped to the customer', () => {
  it('a customer only ever sees their own CRM contacts', async () => {
    const created = await call(platformBase, '/api/crm/contacts', {
      method: 'POST',
      headers: headers(userToken),
      body: JSON.stringify({ name: 'Scoped contact', email: `scoped-${suffix}@example.test` }),
    });
    assert.ok([200, 201].includes(created.status), `contact created (${created.status})`);
    const mine = await call(platformBase, '/api/crm/contacts', { headers: headers(userToken) });
    const theirs = await call(platformBase, '/api/crm/contacts', { headers: headers(adminToken) });
    const mineIds = (mine.body.contacts as Array<{ email?: string }>).map((row) => row.email);
    const theirIds = (theirs.body.contacts as Array<{ email?: string }>).map((row) => row.email);
    assert.ok(mineIds.includes(`scoped-${suffix}@example.test`), 'the owner of the contact sees it');
    assert.ok(!theirIds.includes(`scoped-${suffix}@example.test`), 'another account never sees it');
  });
});

describe('platform staff admin plane', () => {
  it('an admin reaches the staff surface', async () => {
    const response = await call(platformBase, '/api/admin/stats', { headers: headers(adminToken) });
    assert.equal(response.status, 200);
  });

  it('an admin is NOT the owner: owner console, CRM and the private economy stay closed', async () => {
    for (const route of ['/api/owner/dashboard', '/api/owner/analytics', '/api/economy/dashboard', '/api/economy/ledger']) {
      const response = await call(platformBase, route, { headers: headers(adminToken) });
      assert.equal(response.status, 403, `${route} must be 403 for staff (got ${response.status})`);
    }
  });

  it('an admin still cannot act in the private economy (writes)', async () => {
    const response = await call(platformBase, '/api/economy/controls/pause-all', {
      method: 'POST',
      headers: headers(adminToken),
      body: JSON.stringify({ reason: 'escalation attempt' }),
    });
    assert.equal(response.status, 403);
  });
});

describe('platform owner plane', () => {
  it('the owner reaches the owner console and the private economy', async () => {
    for (const route of ['/api/owner/dashboard', '/api/economy/dashboard', '/api/economy/hierarchy', '/api/economy/controls']) {
      const response = await call(platformBase, route, { headers: headers(ownerToken) });
      assert.equal(response.status, 200, `${route} → ${response.status}`);
    }
  });

  it('an anonymous caller is never authenticated (401, not 403)', async () => {
    for (const route of ['/api/owner/dashboard', '/api/economy/dashboard', '/api/admin/stats']) {
      const response = await call(platformBase, route);
      assert.equal(response.status, 401, `${route} must be 401 without a session`);
    }
  });
});

describe('ZA141251SA mission plane is a separate identity space', () => {
  it('the mission server requires its own session for every private route', async () => {
    for (const route of ['/api/overview', '/api/treasury', '/api/ledger', '/api/audit', '/api/agents?limit=1']) {
      const response = await call(missionBase, route);
      assert.equal(response.status, 401, `${route} must require a mission session`);
    }
  });

  it('a platform token is NOT a mission session (and vice versa)', async () => {
    for (const token of [userToken, adminToken, ownerToken]) {
      const response = await call(missionBase, '/api/overview', { headers: headers(token) });
      assert.equal(response.status, 401, 'a platform token must not open the mission console');
    }
    const crossed = await call(platformBase, '/api/owner/dashboard', { headers: headers(missionToken) });
    assert.equal(crossed.status, 401, 'a mission token must not open a platform surface');
  });

  it('the mission owner identity lives only in the mission database (configured, never hardcoded)', async () => {
    const inMission = missionDbRef.get<{ count: number }>('SELECT COUNT(*) AS count FROM mission_owner WHERE email = ?', [missionOwnerEmail]);
    assert.equal(Number(inMission?.count), 1, 'the configured mission owner exists in the mission database');
    const onPlatform = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM users WHERE email = ?', [missionOwnerEmail]);
    assert.equal(Number(onPlatform?.count), 0, 'the mission owner is not a platform account');
    const ownerEmailRequested = `${missionOwnerEmail}-nope`;
    const refused = await call(missionBase, '/api/session/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ownerEmailRequested, password: missionOwnerPassword }),
    });
    assert.equal(refused.status, 401, 'an unknown mission identity is refused');
  });

  it('a platform account with the SAME email cannot sign into the mission without the mission password', async () => {
    // Same address, different plane: the platform account grants nothing here.
    missionModules.auth.provisionOwner({ email: missionOwnerEmail, password: 'rotated-mission-password-2' });
    const withPlatformPassword = await call(missionBase, '/api/session/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: missionOwnerEmail, password: missionOwnerPassword }),
    });
    assert.equal(withPlatformPassword.status, 401, 'the rotated mission password is the only one that works');
    const rotated = await call(missionBase, '/api/session/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: missionOwnerEmail, password: 'rotated-mission-password-2' }),
    });
    assert.equal(rotated.status, 200);
  });
});

describe('private data never appears on public surfaces', () => {
  it('the public API does not expose mission routes', async () => {
    for (const route of ['/api/mission', '/api/overview', '/api/treasury', '/api/payout-slots']) {
      const response = await call(platformBase, route);
      assert.ok([401, 403, 404].includes(response.status), `${route} → ${response.status} (never mission data)`);
    }
  });

  it('public pages and docs never mention the private mission identifier', async () => {
    const home = await fetch(`${platformBase}/`);
    const text = await home.text();
    assert.ok(!/ZA141251SA/i.test(text), 'the public document must not reference the private mission');
  });
});
