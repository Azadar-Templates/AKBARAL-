process.env.ZA141251SA_DATABASE_URL = `file:${require('node:path').join(require('node:os').tmpdir(), `za141251sa-server-${process.pid}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'test-session-secret-0123456789abcdefghijklmnop';
process.env.ZA141251SA_CREDENTIAL_KEY = 'test-credential-key-0123456789abcdefghijklmn';
process.env.ZA141251SA_CURRENCY = 'USD';
process.env.ZA141251SA_BIND_HOST = '127.0.0.1';

import test from 'node:test';
import assert from 'node:assert/strict';
import net, { type AddressInfo } from 'node:net';

import { applyMissionMigrations, missionDb, resolveMissionDbPath, type Row } from './database';
import { hashPassword, login, provisionOwner } from './auth';
import { createMissionServer } from './server';
import { ensurePolicy } from './policy';
import { seedTools } from './self-management';
import { bountyTermsFetchDeps, stripIpBrackets } from './earning/bounty-terms-fetch';

/**
 * ZA141251SA — `POST /api/bounty/programs/fetch-terms` (owner-only scope terms).
 *
 * The route exists so the owner never has to compute `programTermsHash` by hand:
 * the server fetches the program's own public scope page and returns its SHA-256.
 * These tests pin the parts that matter: owner-only access, the returned digest,
 * fail-closed refusals, and the promise that the route reads and writes no
 * program row.
 *
 * The terms fetch is stubbed through the module's documented injection seam, so
 * no test here touches the network.
 */

const DB_PATH = resolveMissionDbPath();
const OWNER_EMAIL = 'owner@mission.test';
const OWNER_PASSWORD = 'mission-owner-password-1';
const OPERATOR_EMAIL = 'operator@mission.test';
const OPERATOR_PASSWORD = 'mission-operator-password-1';

const FIXTURE_HTML = '<!doctype html><html><head><title>Fixture scope</title></head><body><h1>Scope</h1><p>*.fixture.example is in scope. Do not test third parties.</p></body></html>';
/** SHA-256 of the exact UTF-8 bytes of FIXTURE_HTML (160 bytes). */
const FIXTURE_SHA = '612e48fd81e27d1edac3217d75f9535c0c51b62d5356c8f97d54ca29e5dfcf90';
const SCOPE_URL = 'https://scope.test/security/scope';
const PUBLIC_IP = '93.184.216.34';

const originalDeps = { fetchImpl: bountyTermsFetchDeps.fetchImpl, resolveHost: bountyTermsFetchDeps.resolveHost };

let baseUrl = '';
let ownerToken = '';
let operatorToken = '';
let server: ReturnType<typeof createMissionServer>;
const termsFetchCalls: string[] = [];

function serveTerms(body: string, options: { status?: number; contentType?: string } = {}): void {
  // Mirrors production: literals are classified as themselves, every other host
  // reports a public address.
  bountyTermsFetchDeps.resolveHost = async (hostname) => {
    const bare = stripIpBrackets(hostname);
    return net.isIP(bare) ? [bare] : [PUBLIC_IP];
  };
  bountyTermsFetchDeps.fetchImpl = (async (input: RequestInfo | URL) => {
    termsFetchCalls.push(typeof input === 'string' ? input : String(input));
    return new Response(body, {
      status: options.status ?? 200,
      headers: { 'content-type': options.contentType ?? 'text/html; charset=utf-8' },
    });
  }) as typeof fetch;
}

async function api(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

function owner(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  return api(path, { ...init, headers: { authorization: `Bearer ${ownerToken}`, ...(init.headers ?? {}) } });
}

function operator(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  return api(path, { ...init, headers: { authorization: `Bearer ${operatorToken}`, ...(init.headers ?? {}) } });
}

const FETCH_TERMS = '/api/bounty/programs/fetch-terms';

function fetchTerms(init: RequestInit = {}): Promise<{ status: number; body: any }> {
  return owner(FETCH_TERMS, { method: 'POST', body: JSON.stringify({ scopeUrl: SCOPE_URL }), ...init });
}

/** The full contents of the two tables the route must never touch. */
function tableState(): string {
  return JSON.stringify({
    programs: missionDb.all<Row>('SELECT * FROM bounty_programs ORDER BY id'),
    allowlist: missionDb.all<Row>('SELECT * FROM scope_allowlist ORDER BY id'),
    gateEvents: missionDb.all<Row>('SELECT * FROM scope_gate_events ORDER BY id'),
  });
}

test.before(async () => {
  applyMissionMigrations();
  ensurePolicy('USD');
  seedTools();
  provisionOwner({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
  // A read-only operator exists to prove the route is owner-only. It is inserted
  // directly because provisioning deliberately only ever creates 'owner' rows.
  missionDb.run(
    `INSERT OR IGNORE INTO mission_owner (id, email, display_name, password_hash, role, status)
     VALUES ('own_operator_test', ?, 'Read-only operator', ?, 'operator', 'active')`,
    [OPERATOR_EMAIL, hashPassword(OPERATOR_PASSWORD)],
  );
  server = createMissionServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ownerToken = login({ email: OWNER_EMAIL, password: OWNER_PASSWORD }).token;
  operatorToken = login({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD }).token;
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  bountyTermsFetchDeps.fetchImpl = originalDeps.fetchImpl;
  bountyTermsFetchDeps.resolveHost = originalDeps.resolveHost;
  missionDb.close();
});

test('anonymous callers and non-owner sessions cannot fetch scope terms', async () => {
  serveTerms(FIXTURE_HTML);
  const anonymous = await api(FETCH_TERMS, { method: 'POST', body: JSON.stringify({ scopeUrl: SCOPE_URL }) });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error.code, 'unauthorized');
  assert.equal(anonymous.body.sha256, undefined, 'no hash for an anonymous caller');

  const nonOwner = await operator(FETCH_TERMS, { method: 'POST', body: JSON.stringify({ scopeUrl: SCOPE_URL }) });
  assert.equal(nonOwner.status, 403);
  assert.equal(nonOwner.body.error.code, 'forbidden');
  assert.equal(nonOwner.body.sha256, undefined, 'no hash for a non-owner session');
  assert.equal(termsFetchCalls.length, 0, 'an unauthorised caller never triggers a fetch');
});

test('the literal path is never parsed as a program id', async () => {
  serveTerms(FIXTURE_HTML);
  const wrongMethod = await owner(FETCH_TERMS);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.error.code, 'method_not_allowed');
  const programLookup = await owner('/api/bounty/programs/fetch-terms-not-a-route');
  assert.equal(programLookup.status, 404);
  assert.equal(programLookup.body.error.code, 'not_found');
});

test('the owner receives the digest of the fetched scope page', async () => {
  termsFetchCalls.length = 0;
  serveTerms(FIXTURE_HTML);
  const { status, body } = await fetchTerms();
  assert.equal(status, 200);
  assert.equal(body.sha256, FIXTURE_SHA);
  assert.match(body.sha256, /^[a-f0-9]{64}$/, 'the digest satisfies programTermsHash validation');
  assert.equal(body.byteLength, Buffer.byteLength(FIXTURE_HTML, 'utf8'));
  assert.equal(body.contentPreview, FIXTURE_HTML);
  assert.equal(body.scopeUrl, SCOPE_URL);
  assert.ok(!Number.isNaN(Date.parse(body.fetchedAt)), 'fetchedAt is an ISO timestamp');
  assert.equal(new Date(body.fetchedAt).toISOString(), body.fetchedAt);
  assert.deepEqual(termsFetchCalls, [SCOPE_URL], 'the server fetched the submitted URL once');
});

test('a refused fetch returns the typed code, an honest message and no hash', async () => {
  const blocked = await fetchTerms({ body: JSON.stringify({ scopeUrl: 'https://127.0.0.1/scope' }) });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'blocked_address');
  assert.equal(blocked.body.sha256, undefined);
  assert.equal(blocked.body.contentPreview, undefined);
  assert.ok(!String(blocked.body.error.message).includes('127.0.0.1'), 'the refusal never echoes an internal address');

  const scheme = await fetchTerms({ body: JSON.stringify({ scopeUrl: 'http://scope.test/scope' }) });
  assert.equal(scheme.status, 400);
  assert.equal(scheme.body.error.code, 'unsupported_scheme');
  assert.equal(scheme.body.sha256, undefined);

  const port = await fetchTerms({ body: JSON.stringify({ scopeUrl: 'https://scope.test:8443/scope' }) });
  assert.equal(port.status, 400);
  assert.equal(port.body.error.code, 'unsupported_port');

  const missing = await fetchTerms({ body: JSON.stringify({}) });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'invalid_url');
});

test('the route neither creates nor mutates bounty_programs or scope_allowlist', async () => {
  const before = tableState();
  assert.equal(missionDb.get<Row>('SELECT COUNT(*) AS n FROM bounty_programs')!.n, 0);

  serveTerms(FIXTURE_HTML);
  const success = await fetchTerms();
  assert.equal(success.status, 200, 'the successful path is the one most likely to write a row');
  await fetchTerms({ body: JSON.stringify({ scopeUrl: 'https://10.0.0.5/scope' }) });
  await fetchTerms({ body: JSON.stringify({ scopeUrl: 'https://scope.test:8443/scope' }) });
  await api(FETCH_TERMS, { method: 'POST', body: JSON.stringify({ scopeUrl: SCOPE_URL }) });

  assert.equal(tableState(), before, 'no bounty_programs, scope_allowlist or scope_gate_events row changed');
  assert.equal(missionDb.get<Row>('SELECT COUNT(*) AS n FROM bounty_programs')!.n, 0, 'no program row was created');
  assert.equal(missionDb.get<Row>('SELECT COUNT(*) AS n FROM scope_allowlist')!.n, 0, 'no allowlist row was created');
});

test('the route leaves an existing program and its allowlist byte-identical', async () => {
  missionDb.run(
    `INSERT INTO bounty_programs (id, platform, program_handle, scope_url, in_scope_assets_json, out_of_scope_json, rate_limit_policy_json, auth_required, bounty_range_json, program_terms_hash, active, created_at, updated_at)
     VALUES ('bp_fetch_terms_fixture', 'FixturePlatform', 'fixture-handle', ?, '[]', '[]', '{}', 1, '{}', ?, 1, ?, ?)`,
    [SCOPE_URL, FIXTURE_SHA, new Date().toISOString(), new Date().toISOString()],
  );
  const before = tableState();

  serveTerms(FIXTURE_HTML);
  const { status } = await fetchTerms();
  assert.equal(status, 200);
  assert.equal(tableState(), before, 'an existing program row and its allowlist are untouched');

  missionDb.run(`DELETE FROM bounty_programs WHERE id = 'bp_fetch_terms_fixture'`);
  assert.equal(missionDb.get<Row>('SELECT COUNT(*) AS n FROM bounty_programs')!.n, 0);
  assert.equal(resolveMissionDbPath(), DB_PATH);
});
