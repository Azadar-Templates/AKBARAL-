/**
 * ZA141251SA — session transport regression tests.
 *
 * Background: behind the preview proxy the dashboard opened on sign-in and
 * then closed a moment later. Login worked (it needs no credentials of its
 * own) but every authenticated request that followed was answered 401,
 * because the proxy consumed the `Authorization` header before it reached the
 * mission server — and the dashboard treated any 401 as "your session ended".
 *
 * These tests pin the fix:
 *   · a session is accepted from `x-mission-auth` (proxy-safe custom header);
 *   · `Authorization: Bearer` still works for scripts and API clients;
 *   · the login response sets an HttpOnly session cookie that is cleared on
 *     logout;
 *   · the cookie is ONLY honoured together with `x-mission-client`, so it
 *     cannot be used for cross-site request forgery;
 *   · no cookie is issued for a failed sign-in.
 */
process.env.ZA141251SA_DATABASE_URL = `file:${require('node:path').join(require('node:os').tmpdir(), `za141251sa-transport-${process.pid}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'test-session-secret-0123456789abcdefghijklmnop';
process.env.ZA141251SA_CREDENTIAL_KEY = 'test-credential-key-0123456789abcdefghijklmn';
process.env.ZA141251SA_BIND_HOST = '127.0.0.1';
delete process.env.ZA141251SA_OWNER_EMAIL;

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import { applyMissionMigrations } from './database';
import { provisionOwner } from './auth';
import { createMissionServer } from './server';
import { ensurePolicy } from './policy';

const OWNER_EMAIL = 'transport-owner@mission.test';
const OWNER_PASSWORD = 'mission-owner-password-1';

let baseUrl = '';
let server: ReturnType<typeof createMissionServer>;
let token = '';
let cookie = '';

before(async () => {
  applyMissionMigrations();
  ensurePolicy('USD');
  provisionOwner({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
  server = createMissionServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const response = await fetch(`${baseUrl}/api/session/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  assert.equal(response.status, 200);
  token = (await response.json()).token;
  cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const get = (headers: Record<string, string>) => fetch(`${baseUrl}/api/overview`, { headers });

test('login issues an HttpOnly session cookie', () => {
  assert.ok(cookie.startsWith('za_mission_session='));
  assert.ok(cookie.length > 'za_mission_session='.length + 20);
});

test('the proxy-safe custom header authenticates', async () => {
  const response = await get({ 'x-mission-auth': token });
  assert.equal(response.status, 200);
});

test('Authorization: Bearer still authenticates', async () => {
  const response = await get({ authorization: `Bearer ${token}` });
  assert.equal(response.status, 200);
});

test('a request with no credentials is refused', async () => {
  const response = await get({});
  assert.equal(response.status, 401);
});

test('the cookie alone is NOT accepted (no CSRF surface)', async () => {
  const response = await get({ cookie });
  assert.equal(response.status, 401);
});

test('the cookie is accepted for same-origin dashboard calls', async () => {
  const response = await get({ cookie, 'x-mission-client': 'dashboard' });
  assert.equal(response.status, 200);
});

test('a failed sign-in issues no session cookie', async () => {
  const response = await fetch(`${baseUrl}/api/session/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: 'not-the-password' }),
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('logout clears the cookie and kills the session on every carrier', async () => {
  const response = await fetch(`${baseUrl}/api/session/logout`, {
    method: 'POST',
    headers: { 'x-mission-auth': token },
  });
  assert.equal(response.status, 200);
  const cleared = response.headers.get('set-cookie') ?? '';
  assert.match(cleared, /za_mission_session=;/);
  assert.match(cleared, /Max-Age=0/);

  assert.equal((await get({ 'x-mission-auth': token })).status, 401);
  assert.equal((await get({ authorization: `Bearer ${token}` })).status, 401);
  assert.equal((await get({ cookie, 'x-mission-client': 'dashboard' })).status, 401);
});

test('a secure request marks the cookie Secure and SameSite=None for embedded previews', async () => {
  const response = await fetch(`${baseUrl}/api/session/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  assert.equal(response.status, 200);
  const header = response.headers.get('set-cookie') ?? '';
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=None/);
});
