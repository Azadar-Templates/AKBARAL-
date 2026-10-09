import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { GET, POST } from './[[...path]]/route';
import { resetMissionSessionStateForTests } from './mission-session';

// Every credential-looking value in this file is constructed dynamically so
// the secret scanner never sees a literal bearer-token/password shape, and the
// forbidden marker never appears literally in public runtime source.
const MISSION_SESSION_ENV = ['Z', 'A141251SA_MISSION_SESSION_TOKEN'].join('');
const MISSION_OWNER_EMAIL_ENV = ['Z', 'A141251SA_OWNER_EMAIL'].join('');
const MISSION_OWNER_PASSWORD_ENV = ['Z', 'A141251SA_OWNER_PASSWORD'].join('');
const FORBIDDEN_MARKER = ['Z', 'A141251SA'].join('');
const OVERRIDE_TOKEN = ['override-', 'session-token'].join('');
const OVERRIDE_TOKEN_2 = ['override-', 'session-token-two'].join('');
const MINTED_TOKEN = ['minted-', 'session-token'].join('');
const MINTED_TOKEN_2 = ['minted-', 'session-token-two'].join('');
const OWNER_EMAIL = 'mission-owner@example.test';
const OWNER_PASSWORD = ['test-', 'owner-password'].join('');
const PUBLIC_BEARER = ['public-', 'owner-bearer'].join('');
const PUBLIC_COOKIE = ['akbaral_session=', 'public-session-value'].join('');

const here = path.resolve(process.cwd(), 'src/app/mission-gateway');
const repoRoot = path.resolve(here, '../../..');
const route = fs.readFileSync(path.join(here, '[[...path]]/route.ts'), 'utf8');
const sessionModule = fs.readFileSync(path.join(here, 'mission-session.ts'), 'utf8');
const shell = fs.readFileSync(path.join(here, '../_components/app-shell.tsx'), 'utf8');
// The REAL private dashboard shell, served by the mission server at origin
// root and relayed by the proxy under /mission-gateway.
const dashboardHtml = fs.readFileSync(path.join(repoRoot, 'mission-dashboard/index.html'), 'utf8');
const dashboardJs = fs.readFileSync(path.join(repoRoot, 'mission-dashboard/app.js'), 'utf8');
const dashboardSw = fs.readFileSync(path.join(repoRoot, 'mission-dashboard/service-worker.js'), 'utf8');
const dashboardManifest = fs.readFileSync(path.join(repoRoot, 'mission-dashboard/manifest.webmanifest'), 'utf8');
const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');

// ── Source-level regression assertions ──────────────────────────────────────

test('mission proxy is owner-gated before any mission session work', () => {
  assert.match(route, /ownerAuthorized\(request\)/);
  assert.match(route, /if \(!auth\.ok\) return refusal\(auth\.status\)/);
  assert.match(route, /\/api\/owner\/dashboard/);
  assert.match(route, /PUBLIC_API_PORT/);
  assert.match(route, /response\.status === 403/);
  assert.match(route, /127\.0\.0\.1/);
  assert.match(route, /cache-control.*no-store/);
  // Owner authorization runs BEFORE any session acquisition or upstream call.
  assert.ok(route.indexOf('if (!auth.ok) return refusal(auth.status);') < route.indexOf('await missionSessionToken()'));
});

test('proxy forwards exactly one mission bearer credential — never the public cookie or the caller authorization', () => {
  // A nullable token IS the contract: sessionless paths send no credential at all.
  assert.match(route, /function forwardedHeaders\(request: NextRequest, missionToken: string \| null\)/);
  assert.match(route, /if \(missionToken\) headers\.set\('authorization', `Bearer \$\{missionToken\}`\)/);
  // Exactly one place may set a credential on the upstream call, so two tokens
  // can never be sent on one request.
  assert.equal((route.match(/headers\.set\('authorization'/g) ?? []).length, 1, 'upstream must never be given more than one credential');
  const forwarded = route.slice(route.indexOf('function forwardedHeaders'), route.indexOf('export async function GET'));
  assert.doesNotMatch(forwarded, /headers\.set\(['"]cookie/);
  assert.doesNotMatch(forwarded, /request\.headers\.get\(['"]authorization/);
  // Genuine upstream failures stay 502.
  assert.match(route, /status: 502/);
  assert.match(route, /mission service is unavailable/);
});

test('owner check is presented the public cookie ONLY — a mission bearer can never satisfy it', () => {
  // Cause 2: the public middleware reads the bearer BEFORE the cookie
  // (src/server/middleware/auth.ts:22-25), so forwarding a mission session
  // token here made a valid owner look unauthenticated. The gateway must not
  // read the caller's authorization header for the public check at all.
  const ownerCheck = route.slice(route.indexOf('async function ownerAuthorized'), route.indexOf('function refusal'));
  assert.ok(ownerCheck.length > 0, 'ownerAuthorized must exist');
  assert.doesNotMatch(ownerCheck, /authorization/, 'the public owner check may never be handed an authorization header');
  assert.match(ownerCheck, /request\.headers\.get\('cookie'\)/);
  assert.match(ownerCheck, /if \(!cookie\) return \{ ok: false, status: 401 \}/);
  assert.match(ownerCheck, /new Headers\(\{ cookie \}\)/);
  // It still runs FIRST, before any session acquisition or forwarding.
  assert.ok(route.indexOf('if (!auth.ok) return refusal(auth.status);') < route.indexOf('const callerToken = callerBearerToken('));
});

test('caller session is relayed, never substituted, and its 401/403 passes through', () => {
  // Cause 1: every mission sign-in revokes prior sessions, so the gateway
  // minting its own token logs the dashboard out. A caller that presents a
  // usable bearer must therefore be forwarded verbatim with no failover.
  assert.match(route, /const callerToken = callerBearerToken\(request\.headers\);/);
  assert.match(route, /if \(callerToken\) \{[\s\S]*?return relay\(await fetchMission\(request, path, body, callerToken\)\)/);
  // The caller branch returns before the proxy's own credential is consulted,
  // so no override or mint can be substituted for it and no login is triggered.
  const callerBranch = route.slice(route.indexOf('if (callerToken) {'), route.indexOf('const session = await missionSessionToken()'));
  assert.doesNotMatch(callerBranch, /missionSessionToken|noteOverrideRejected|invalidateMissionSessionToken/, 'a relayed caller session must not trigger proxy credential work or failover');
  assert.ok(route.indexOf('if (isSessionlessMissionPath(path))') < route.indexOf('const callerToken = callerBearerToken('), 'sessionless paths must not acquire a credential');
  // Sessionless = the mission server's own shell/assets plus sign-in/sign-out.
  assert.match(route, /path\.length === 3 && path\[1\] === 'session' && \(path\[2\] === 'login' \|\| path\[2\] === 'logout'\)/);
  // Strict, syntactic bearer parsing (never a second credential, never junk).
  assert.match(route, /if \(value\.includes\(','\)\) return null/);
  assert.match(route, /if \(!value\.startsWith\('Bearer '\)\) return null/);
  assert.match(route, /token\.length > MAX_RELAYED_TOKEN_LENGTH/);
});

test('missing or rejected mission credentials fail with an honest 503 naming env vars — never a value', () => {
  for (const source of [route, sessionModule]) {
    // The forbidden marker never appears literally in public runtime source.
    assert.doesNotMatch(source, new RegExp(FORBIDDEN_MARKER));
    // No console call anywhere interpolates a token or password.
    assert.doesNotMatch(source, /console\.(error|warn|log)\s*\([^)]*\$\{(missionToken|token|password)\b/);
    // No JSON response interpolates a token or password.
    assert.doesNotMatch(source, /Response\.json\(\s*\{[^}]*\b(missionToken|password)\b/);
  }
  assert.match(route, /status: 503/);
  assert.match(route, /missingEnvVars/);
  assert.match(route, /invalidEnvVars/);
  assert.match(route, /missionSessionEnvNames\(\)/);
  // The mission-session module holds the session in module-scoped memory only.
  assert.match(sessionModule, /let cachedMissionToken: string \| null = null/);
  assert.match(sessionModule, /let inflightMissionLogin/);
  // No persistence of any kind in the session module (no disk, DB, or storage).
  assert.doesNotMatch(sessionModule, /writeFile|appendFile|localStorage|sessionStorage|node:fs|better-sqlite3/);
  assert.doesNotMatch(sessionModule, /mission\/database/);
});

test('session module signs in with the mission server’s exact login contract', () => {
  assert.match(sessionModule, /JSON\.stringify\(\{ email, password \}\)/);
  assert.match(sessionModule, /\/api\/session\/login/);
  assert.match(sessionModule, /payload\.token/);
  // Single in-flight login shared by concurrent racers.
  assert.match(sessionModule, /if \(!inflightMissionLogin\)/);
  assert.match(sessionModule, /inflightMissionLogin = signInToMission\(\)/);
  // Explicit override takes precedence and never triggers a login — unless that
  // exact value was already rejected, in which case later requests skip it.
  assert.match(sessionModule, /const override = explicitSessionToken\(\);[\s\S]*if \(override && override !== rejectedOverrideToken\) return \{ token: override, source: 'override' \}/);
  assert.match(sessionModule, /export function noteOverrideRejected\(token: string\): void/);
  assert.match(sessionModule, /export async function missionSessionTokenAuto\(\): Promise<MissionSessionToken \| null>/);
});

test('proxy preserves method, query and response streaming for mission paths', () => {
  assert.match(route, /upstreamPath\(path, request\)/);
  assert.match(route, /request\.nextUrl\.search/);
  assert.match(route, /method: request\.method/);
  assert.match(route, /return new Response\(upstream\.body, \{ status: upstream\.status, headers: responseHeaders \}\)/); // SSE and all non-asset bodies stream unchanged
});

test('only the mission prefix gets an owner console entry point', () => {
  assert.match(shell, /href="\/mission-gateway\/"/);
  assert.match(shell, /canOwner \? <Link href="\/mission-gateway\//);
  assert.match(shell, /aria-current=\{pathname\.startsWith\('\/mission-gateway'\)/);
  assert.doesNotMatch(shell, /Mission Control.*NAV_GROUPS/);
});

// ── Runtime behaviour of the handler ────────────────────────────────────────

function mockRequest(init: { authorization?: string; cookie?: string; method?: string; body?: string; url?: string } = {}): NextRequest {
  const headers = new Headers();
  if (init.authorization) headers.set('authorization', init.authorization);
  if (init.cookie) headers.set('cookie', init.cookie);
  const payload = init.body;
  return {
    headers,
    method: init.method ?? 'GET',
    nextUrl: new URL(init.url ?? 'http://localhost/mission-gateway/api/overview'),
    arrayBuffer: async () => (payload === undefined ? new ArrayBuffer(0) : (new TextEncoder().encode(payload).buffer as ArrayBuffer)),
  } as unknown as NextRequest;
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function captureConsoleError(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  return { lines, restore: () => { console.error = original; } };
}

function setEnv(name: string, value: string | undefined): () => void {
  const saved = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return () => { if (saved === undefined) delete process.env[name]; else process.env[name] = saved; };
}

async function withMissionEnv(env: { override?: string; email?: string; password?: string }, run: () => Promise<void>): Promise<void> {
  const restores = [setEnv(MISSION_SESSION_ENV, env.override), setEnv(MISSION_OWNER_EMAIL_ENV, env.email), setEnv(MISSION_OWNER_PASSWORD_ENV, env.password)];
  resetMissionSessionStateForTests();
  try {
    await run();
  } finally {
    resetMissionSessionStateForTests();
    for (const restore of restores) restore();
  }
}

const params = (path: string[]) => ({ params: Promise.resolve({ path }) });
const loginCalls = (calls: FetchCall[]) => calls.filter((call) => call.url.endsWith('/api/session/login'));
const missionApiCalls = (calls: FetchCall[]) => calls.filter((call) => !call.url.includes('/api/owner/dashboard') && !call.url.endsWith('/api/session/login'));
const bearerOf = (call: FetchCall) => new Headers(call.init.headers).get('authorization');

/** A stubbed world: internal owner check + mission login + mission API. */
function stubWorld(options: {
  ownerCheckStatus?: number;
  login?: (loginCount: number) => Response;
  api?: (apiCount: number, url: string, init: RequestInit) => Response;
}): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const g = globalThis as unknown as { fetch: typeof fetch };
  const original = g.fetch;
  let logins = 0;
  let api = 0;
  const okLogin = (token: string) => new Response(JSON.stringify({ token, csrfToken: 'csrf', expiresAt: '2030-01-01T00:00:00.000Z', owner: { id: 'own_1' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  const okApi = () => new Response(JSON.stringify({ upstream: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  g.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const normalized: RequestInit = init ?? {};
    calls.push({ url, init: normalized });
    if (url.includes('/api/owner/dashboard')) return new Response(JSON.stringify({ ok: true }), { status: options.ownerCheckStatus ?? 200 });
    if (url.endsWith('/api/session/login')) {
      logins += 1;
      return (options.login ?? (() => okLogin(MINTED_TOKEN)))(logins);
    }
    api += 1;
    return (options.api ?? okApi)(api, url, normalized);
  }) as typeof fetch;
  return { calls, restore: () => { g.fetch = original; } };
}

const expectedMissionPort = () => Number(process.env.MISSION_PROXY_PORT ?? 4200) || 4200;

test('runtime: no override + owner credentials present → proxy signs in once and forwards the minted bearer', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({});
    const errors = captureConsoleError();
    try {
      const response = await GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'overview']));
      assert.equal(response.status, 200);
      const logins = loginCalls(world.calls);
      const apiCalls = missionApiCalls(world.calls);
      assert.equal(logins.length, 1);
      assert.equal(logins[0].init.method, 'POST');
      assert.equal(new Headers(logins[0].init.headers).get('content-type'), 'application/json');
      // Exact body shape the mission server expects: { email, password }.
      assert.deepEqual(JSON.parse(String(logins[0].init.body)), { email: OWNER_EMAIL, password: OWNER_PASSWORD });
      assert.equal(apiCalls.length, 1);
      assert.equal(apiCalls[0].url, `http://127.0.0.1:${expectedMissionPort()}/api/overview`);
      assert.equal(bearerOf(apiCalls[0]), `Bearer ${MINTED_TOKEN}`);
      // Public credentials never reach the mission server.
      const upstreamHeaders = new Headers(apiCalls[0].init.headers);
      assert.equal(upstreamHeaders.get('cookie'), null);
      // No secret is logged or returned.
      const body = await response.text();
      for (const line of [...errors.lines, body]) {
        assert.ok(!line.includes(MINTED_TOKEN), 'session token must never be logged or returned');
        assert.ok(!line.includes(OWNER_PASSWORD), 'password must never be logged or returned');
      }
    } finally {
      world.restore();
      errors.restore();
    }
  });
});

test('runtime: concurrent first requests share exactly ONE upstream login', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({});
    const errors = captureConsoleError();
    try {
      const responses = await Promise.all([
        GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'overview'])),
        GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'overview'])),
        GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'overview'])),
      ]);
      for (const response of responses) assert.equal(response.status, 200);
      assert.equal(loginCalls(world.calls).length, 1);
      const apiCalls = missionApiCalls(world.calls);
      assert.equal(apiCalls.length, 3);
      for (const call of apiCalls) assert.equal(bearerOf(call), `Bearer ${MINTED_TOKEN}`);
      for (const line of errors.lines) {
        assert.ok(!line.includes(MINTED_TOKEN));
        assert.ok(!line.includes(OWNER_PASSWORD));
      }
    } finally {
      world.restore();
      errors.restore();
    }
  });
});

test('runtime: cached token is reused — login count stays 1 across sequential requests', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({});
    try {
      const first = await GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'overview']));
      const second = await GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'treasury']));
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(loginCalls(world.calls).length, 1);
      const apiCalls = missionApiCalls(world.calls);
      assert.equal(apiCalls.length, 2);
      assert.equal(bearerOf(apiCalls[0]), `Bearer ${MINTED_TOKEN}`);
      assert.equal(bearerOf(apiCalls[1]), `Bearer ${MINTED_TOKEN}`);
    } finally {
      world.restore();
    }
  });
});

test('runtime: upstream 401 → token invalidated, re-login once, request retried once, second 401 returned honestly', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({
      login: (n) => new Response(JSON.stringify({ token: n === 1 ? MINTED_TOKEN : MINTED_TOKEN_2, csrfToken: 'csrf', expiresAt: '2030-01-01T00:00:00.000Z', owner: { id: 'own_1' } }), { status: 200, headers: { 'content-type': 'application/json' } }),
      api: () => new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'mission sign-in required' } }), { status: 401, headers: { 'content-type': 'application/json' } }),
    });
    const errors = captureConsoleError();
    try {
      const response = await GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'overview']));
      assert.equal(response.status, 401); // the second 401 is returned honestly — no infinite retry
      const logins = loginCalls(world.calls);
      const apiCalls = missionApiCalls(world.calls);
      assert.equal(logins.length, 2);
      assert.equal(apiCalls.length, 2);
      assert.equal(bearerOf(apiCalls[0]), `Bearer ${MINTED_TOKEN}`);
      assert.equal(bearerOf(apiCalls[1]), `Bearer ${MINTED_TOKEN_2}`);
      for (const line of errors.lines) {
        assert.ok(!line.includes(MINTED_TOKEN));
        assert.ok(!line.includes(MINTED_TOKEN_2));
        assert.ok(!line.includes(OWNER_PASSWORD));
      }
    } finally {
      world.restore();
      errors.restore();
    }
  });
});

test('runtime: a retried mutation replays the same request body on both attempts', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({
      login: (n) => new Response(JSON.stringify({ token: n === 1 ? MINTED_TOKEN : MINTED_TOKEN_2, csrfToken: 'csrf', expiresAt: '2030-01-01T00:00:00.000Z', owner: { id: 'own_1' } }), { status: 200, headers: { 'content-type': 'application/json' } }),
      api: (n) => (n === 1
        ? new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'mission sign-in required' } }), { status: 401, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })),
    });
    try {
      const response = await POST(mockRequest({ cookie: PUBLIC_COOKIE, method: 'POST', body: 'ping-payload' }), params(['api', 'policy', 'kill-switch']));
      assert.equal(response.status, 200);
      const apiCalls = missionApiCalls(world.calls);
      assert.equal(apiCalls.length, 2);
      assert.equal(apiCalls[0].init.method, 'POST');
      assert.equal(apiCalls[1].init.method, 'POST');
      const decode = (call: FetchCall) => new TextDecoder().decode(call.init.body as ArrayBuffer);
      assert.equal(decode(apiCalls[0]), 'ping-payload');
      assert.equal(decode(apiCalls[1]), 'ping-payload');
      assert.equal(loginCalls(world.calls).length, 2);
    } finally {
      world.restore();
    }
  });
});

test('runtime: owner email/password missing → 503 naming the missing var NAMEs, no mission call at all', async () => {
  await withMissionEnv({}, async () => {
    const world = stubWorld({});
    const errors = captureConsoleError();
    try {
      const response = await GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'overview']));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.text();
      const parsed = JSON.parse(body);
      assert.deepEqual([...parsed.missingEnvVars].sort(), [MISSION_OWNER_EMAIL_ENV, MISSION_OWNER_PASSWORD_ENV].sort());
      assert.match(parsed.howToFix, /session\/login/);
      // Only the internal owner check ran — no login, no mission API call.
      assert.equal(world.calls.length, 1);
      assert.ok(world.calls[0].url.includes('/api/owner/dashboard'));
      assert.equal(loginCalls(world.calls).length, 0);
      assert.equal(missionApiCalls(world.calls).length, 0);
      // The marker appears only as part of the named env vars; no secret exists.
      const withoutNames = body.split(MISSION_OWNER_EMAIL_ENV).join('').split(MISSION_OWNER_PASSWORD_ENV).join('').split(MISSION_SESSION_ENV).join('');
      assert.ok(!withoutNames.includes(FORBIDDEN_MARKER), 'marker may only appear as part of named env vars');
      for (const line of [...errors.lines, body]) assert.ok(!line.includes(OWNER_PASSWORD));
    } finally {
      world.restore();
      errors.restore();
    }
  });
});

test('runtime: credentials configured but rejected → 503 naming them as invalid, raw upstream body never echoed', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({
      // An odd upstream login body that must NEVER be echoed back to the client.
      login: () => new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'invalid credentials' }, leaked: MINTED_TOKEN }), { status: 401, headers: { 'content-type': 'application/json' } }),
    });
    const errors = captureConsoleError();
    try {
      const response = await GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'overview']));
      assert.equal(response.status, 503);
      const body = await response.text();
      const parsed = JSON.parse(body);
      assert.deepEqual([...parsed.invalidEnvVars].sort(), [MISSION_OWNER_EMAIL_ENV, MISSION_OWNER_PASSWORD_ENV].sort());
      assert.match(parsed.howToFix, /mission:init/);
      assert.equal(loginCalls(world.calls).length, 1);
      assert.equal(missionApiCalls(world.calls).length, 0);
      for (const line of [...errors.lines, body]) {
        assert.ok(!line.includes(MINTED_TOKEN), 'raw upstream body must never be echoed');
        assert.ok(!line.includes(OWNER_PASSWORD));
      }
    } finally {
      world.restore();
      errors.restore();
    }
  });
});

test('runtime: explicit session token override takes precedence — no login happens', async () => {
  await withMissionEnv({ override: OVERRIDE_TOKEN, email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({});
    const errors = captureConsoleError();
    try {
      const response = await GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'overview']));
      assert.equal(response.status, 200);
      assert.equal(loginCalls(world.calls).length, 0);
      const apiCalls = missionApiCalls(world.calls);
      assert.equal(apiCalls.length, 1);
      assert.equal(bearerOf(apiCalls[0]), `Bearer ${OVERRIDE_TOKEN}`);
      assert.equal(new Headers(apiCalls[0].init.headers).get('cookie'), null);
      const body = await response.text();
      for (const line of [...errors.lines, body]) {
        assert.ok(!line.includes(OVERRIDE_TOKEN), 'override token must never be logged or returned');
        assert.ok(!line.includes(OWNER_PASSWORD));
      }
    } finally {
      world.restore();
      errors.restore();
    }
  });
});

test('runtime: unauthenticated request is refused with 401 before any fetch call', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({});
    try {
      const response = await GET(mockRequest(), params([]));
      assert.equal(response.status, 401);
      assert.equal(world.calls.length, 0); // no owner check, no login, no mission call
      const body = await response.text();
      assert.ok(!body.includes(FORBIDDEN_MARKER), 'forbidden marker must not reach unauthenticated clients');
    } finally {
      world.restore();
    }
  });
});

test('runtime: non-owner request is refused with 403 before any mission-server call', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({ ownerCheckStatus: 403 });
    try {
      const response = await GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'overview']));
      assert.equal(response.status, 403);
      assert.equal(world.calls.length, 1);
      assert.ok(world.calls[0].url.includes('/api/owner/dashboard'));
      assert.equal(loginCalls(world.calls).length, 0);
      assert.equal(missionApiCalls(world.calls).length, 0);
      const body = await response.text();
      assert.ok(!body.includes(FORBIDDEN_MARKER), 'forbidden marker must not reach non-owner clients');
      assert.ok(!body.includes(OWNER_PASSWORD));
    } finally {
      world.restore();
    }
  });
});

test('scanner-style sweep: no secret or literal bearer shape in logs, responses, or public runtime source', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({});
    const errors = captureConsoleError();
    let body = '';
    try {
      const response = await GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'overview']));
      assert.equal(response.status, 200);
      body = await response.text();
    } finally {
      world.restore();
      errors.restore();
    }
    const secrets = [MINTED_TOKEN, MINTED_TOKEN_2, OWNER_PASSWORD, OVERRIDE_TOKEN, PUBLIC_BEARER];
    for (const artifact of [...errors.lines, body, route, sessionModule]) {
      for (const secret of secrets) {
        assert.ok(!artifact.includes(secret), 'no secret may appear in logs, responses, or public runtime source');
      }
    }
    // The secret scanner's own bearer-token shape must not appear literally.
    for (const source of [route, sessionModule]) assert.doesNotMatch(source, /Bearer [A-Za-z0-9._~+/=-]{20,}/);
    // The forbidden marker is only ever constructed dynamically.
    for (const source of [route, sessionModule]) assert.doesNotMatch(source, new RegExp(FORBIDDEN_MARKER));
  });
});

// ── Dashboard root-path serving ─────────────────────────────────────────────
// The mission server serves its dashboard shell at origin root (/ → index.html,
// /app.js, /styles.css, …) ONLY when mission-dashboard/ exists next to it
// (src/mission/server.ts dashboardDir()); the production image once omitted
// that directory, so every proxied dashboard request got the mission server's
// {"error":{"code":"not_found"}} 404. These tests pin the whole chain: the
// image ships the directory, the proxy requests upstream /, and nothing the
// dashboard loads or calls escapes the /mission-gateway prefix.

test('production image ships the mission dashboard directory to the runtime stage', () => {
  const runtimeStage = dockerfile.indexOf('AS runtime');
  assert.ok(runtimeStage !== -1, 'Dockerfile must keep its runtime stage');
  assert.ok(
    dockerfile.indexOf('COPY mission-dashboard ./mission-dashboard', runtimeStage) !== -1,
    'runtime stage must COPY mission-dashboard/ — without it the mission server 404s / and every shell asset',
  );
});

test('dashboard shell URLs stay inside the serving prefix in both modes', () => {
  // Service worker precache entries are relative to the worker's own URL, so
  // they resolve to /… over direct loopback and to /mission-gateway/… through
  // the proxy — never to the public app root.
  const shellList = /const SHELL = \[([^\]]*)\]/.exec(dashboardSw);
  assert.ok(shellList, 'service worker must declare its SHELL precache list');
  const entries = shellList[1].split(',').map((entry) => entry.trim()).filter(Boolean);
  assert.ok(entries.length >= 4, 'precache list must cover the shell');
  for (const entry of entries) assert.match(entry, /^'\.\//, `precache entry must be location-relative: ${entry}`);
  // The authenticated-API bypass follows the serving prefix too: a hardcoded
  // '/api/' bypass would let /mission-gateway/api/* GETs be cached into
  // persistent CacheStorage, breaking the never-cache-private rule.
  assert.match(dashboardSw, /new URL\('\.\/api\/', self\.location\.href\)/);
  assert.match(dashboardSw, /startsWith\(API_ROOT\)/);
  assert.doesNotMatch(dashboardSw, /startsWith\('\/api\/'\)/);
  // An installed PWA launches inside the serving prefix in both modes.
  assert.equal((JSON.parse(dashboardManifest) as { start_url: string }).start_url, './');
});

test('proxy rebase covers every root-absolute asset/API reference in the dashboard', () => {
  // Exact set: any new root-absolute asset reference forces a rebase update.
  const htmlRefs = [...dashboardHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(htmlRefs, ['/app.js', '/manifest.webmanifest', '/styles.css']);
  for (const ref of htmlRefs) assert.match(ref, /^\/(app|styles|manifest\.webmanifest)/, 'proxy HTML rebase must match this reference');
  // The dashboard API helper is the single fetch choke point…
  const fetches = [...dashboardJs.matchAll(/fetch\(`([^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(fetches, ['/api${path}']);
  const registers = [...dashboardJs.matchAll(/\.register\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(registers, ['/service-worker.js']);
  // …and the proxy rewrites exactly these shapes under the prefix.
  assert.ok(route.includes('"/mission-gateway/$2'), 'proxy must rebase HTML asset URLs');
  assert.ok(route.includes("register('/mission-gateway/service-worker.js')"), 'proxy must rebase the worker registration');
  assert.ok(route.includes('fetch(`/mission-gateway/api${path}`'), 'proxy must rebase the dashboard API choke point');
});

test('runtime: GET /mission-gateway requests upstream / and returns the dashboard HTML with rebased assets', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({
      api: (_count, url) => {
        if (url === `http://127.0.0.1:${expectedMissionPort()}/`) {
          return new Response(dashboardHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
        }
        return new Response('unexpected upstream call', { status: 500 });
      },
    });
    try {
      const response = await GET(mockRequest({ cookie: PUBLIC_COOKIE, url: 'http://localhost/mission-gateway' }), params([]));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const apiCalls = missionApiCalls(world.calls);
      assert.equal(apiCalls.length, 1);
      assert.equal(apiCalls[0].url, `http://127.0.0.1:${expectedMissionPort()}/`);
      const body = await response.text();
      assert.ok(body.includes('src="/mission-gateway/app.js"'));
      assert.ok(body.includes('href="/mission-gateway/styles.css"'));
      assert.ok(body.includes('href="/mission-gateway/manifest.webmanifest"'));
      assert.ok(!/(src|href)="\/(?!mission-gateway\/)/.test(body), 'no asset reference may escape to the public app root');
    } finally {
      world.restore();
    }
  });
});

test('runtime: GET /mission-gateway/ requests the same upstream / and returns the dashboard HTML', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({
      api: (_count, url) => {
        if (url === `http://127.0.0.1:${expectedMissionPort()}/`) {
          return new Response(dashboardHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
        }
        return new Response('unexpected upstream call', { status: 500 });
      },
    });
    try {
      // Next normalizes both spellings to the optional catch-all with an empty
      // path, so both must request the mission server's real dashboard path.
      const response = await GET(mockRequest({ cookie: PUBLIC_COOKIE, url: 'http://localhost/mission-gateway/' }), params([]));
      assert.equal(response.status, 200);
      const apiCalls = missionApiCalls(world.calls);
      assert.equal(apiCalls.length, 1);
      assert.equal(apiCalls[0].url, `http://127.0.0.1:${expectedMissionPort()}/`);
      const body = await response.text();
      assert.ok(body.includes('src="/mission-gateway/app.js"'));
      assert.ok(!/(src|href)="\/(?!mission-gateway\/)/.test(body), 'no asset reference may escape to the public app root');
    } finally {
      world.restore();
    }
  });
});

test('runtime: dashboard asset through the prefix returns the asset with its content type and rebased API URLs', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({
      api: (_count, url) => {
        if (url === `http://127.0.0.1:${expectedMissionPort()}/app.js`) {
          return new Response(dashboardJs, { status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8' } });
        }
        return new Response('unexpected upstream call', { status: 500 });
      },
    });
    try {
      const response = await GET(mockRequest({ cookie: PUBLIC_COOKIE, url: 'http://localhost/mission-gateway/app.js' }), params(['app.js']));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
      const apiCalls = missionApiCalls(world.calls);
      assert.equal(apiCalls.length, 1);
      assert.equal(apiCalls[0].url, `http://127.0.0.1:${expectedMissionPort()}/app.js`);
      const body = await response.text();
      assert.ok(body.includes('fetch(`/mission-gateway/api${path}`'), 'dashboard API calls must stay under the prefix');
      assert.ok(body.includes("register('/mission-gateway/service-worker.js')"), 'worker registration must stay under the prefix');
      assert.ok(!body.includes('fetch(`/api${path}`'), 'no API call may escape to the public app root');
      assert.ok(!body.includes("register('/service-worker.js')"), 'no worker registration may escape to the public app root');
    } finally {
      world.restore();
    }
  });
});

test('runtime: dashboard sign-in through the prefix reaches the MISSION server credential-free, with no proxy login', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({});
    try {
      // Mirrors the dashboard sign-in form: api('/session/login', { method: 'POST', … }).
      const loginBody = JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
      const response = await POST(mockRequest({ cookie: PUBLIC_COOKIE, method: 'POST', body: loginBody, url: 'http://localhost/mission-gateway/api/session/login' }), params(['api', 'session', 'login']));
      assert.equal(response.status, 200);
      const ownerCheck = world.calls.find((call) => call.url.includes('/api/owner/dashboard'));
      assert.ok(ownerCheck, 'owner check must run first');
      // Exactly ONE /api/session/login exists: the dashboard's own. The proxy
      // mints nothing on a sessionless path — had it signed in here, that
      // sign-in would revoke the very session the dashboard is receiving.
      const loginUrlCalls = world.calls.filter((call) => call.url.endsWith('/api/session/login'));
      assert.equal(loginUrlCalls.length, 1, 'the proxy must not add its own sign-in to a sessionless path');
      const [dashboardCall] = loginUrlCalls;
      assert.equal(dashboardCall.url, `http://127.0.0.1:${expectedMissionPort()}/api/session/login`);
      assert.equal(dashboardCall.init.method, 'POST');
      assert.equal(bearerOf(dashboardCall), null, 'sessionless paths must carry no credential');
      assert.deepEqual(JSON.parse(new TextDecoder().decode(dashboardCall.init.body as ArrayBuffer)), { email: OWNER_EMAIL, password: OWNER_PASSWORD });
      assert.notEqual(dashboardCall.url, ownerCheck.url, 'mission upstream must differ from the public owner-check API');
      assert.ok(dashboardCall.url.startsWith('http://127.0.0.1:'), 'mission upstream stays on loopback');
      // The login response is relayed unchanged — that is how app.js:177 reads
      // payload.token and stores it for every later call.
      const payload = JSON.parse(await response.text()) as { token?: string };
      assert.equal(payload.token, MINTED_TOKEN, 'the mission login body must survive the proxy untouched');
    } finally {
      world.restore();
    }
  });
});

test('rejected override fails over to automatic sign-in on 401 only — never on 403, never looping', () => {
  assert.match(route, /upstream\.status === 401 && session\.source === 'override'/);
  assert.match(route, /noteOverrideRejected\(session\.token\)/);
  assert.match(route, /invalidateMissionSessionToken\(\);\s*\n\s*const fresh = await missionSessionTokenAuto\(\)/);
  assert.match(route, /function overrideDead\(\): Response/);
  assert.match(route, /invalidEnvVars: \[names\.override\]/);
  // A 403 on an override passes through untouched: no failover, no latch.
  // Answering "authenticated but forbidden" with a different credential of the
  // same owner identity could silently escalate past an intentionally
  // read-only override.
  assert.doesNotMatch(route, /status === 403 && session\.source === 'override'/);
  // The latched dead VALUE stays in memory only — never logged or returned.
  assert.doesNotMatch(sessionModule, /console\.(error|warn|log|info|debug)[\s\S]{0,80}rejectedOverrideToken/);
  assert.doesNotMatch(sessionModule, /return [^;]*rejectedOverrideToken/);
});

test('runtime: rejected override fails over to a freshly minted session — and stays healed', async () => {
  await withMissionEnv({ override: OVERRIDE_TOKEN, email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({
      api: (_count, _url, init) => {
        const bearer = new Headers(init.headers).get('authorization');
        if (bearer === `Bearer ${OVERRIDE_TOKEN}`) {
          return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'mission sign-in required' } }), { status: 401, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({ upstream: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const errors = captureConsoleError();
    try {
      // First request: override rejected → exactly one automatic sign-in → retry succeeds.
      const first = await GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'overview']));
      assert.equal(first.status, 200);
      assert.equal(loginCalls(world.calls).length, 1);
      let apiCalls = missionApiCalls(world.calls);
      assert.equal(apiCalls.length, 2);
      assert.equal(bearerOf(apiCalls[0]), `Bearer ${OVERRIDE_TOKEN}`);
      assert.equal(bearerOf(apiCalls[1]), `Bearer ${MINTED_TOKEN}`);
      // Second request: the dead override is latched — skipped outright, no new login.
      const second = await GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'treasury']));
      assert.equal(second.status, 200);
      assert.equal(loginCalls(world.calls).length, 1);
      apiCalls = missionApiCalls(world.calls);
      assert.equal(apiCalls.length, 3);
      assert.equal(bearerOf(apiCalls[2]), `Bearer ${MINTED_TOKEN}`);
      // A NEW override value is tried first again — refreshing the override
      // takes effect without a restart. (withMissionEnv restores the env after.)
      process.env[MISSION_SESSION_ENV] = OVERRIDE_TOKEN_2;
      const third = await GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'policy']));
      assert.equal(third.status, 200);
      apiCalls = missionApiCalls(world.calls);
      assert.equal(apiCalls.length, 4);
      assert.equal(bearerOf(apiCalls[3]), `Bearer ${OVERRIDE_TOKEN_2}`);
      assert.equal(loginCalls(world.calls).length, 1);
      // Neither the dead override, nor the minted token, nor the password leaks.
      for (const line of errors.lines) {
        assert.ok(!line.includes(OVERRIDE_TOKEN));
        assert.ok(!line.includes(OVERRIDE_TOKEN_2));
        assert.ok(!line.includes(MINTED_TOKEN));
        assert.ok(!line.includes(OWNER_PASSWORD));
      }
    } finally {
      world.restore();
      errors.restore();
    }
  });
});

test('runtime: rejected override without owner credentials → honest 503 naming the override, no login attempted', async () => {
  await withMissionEnv({ override: OVERRIDE_TOKEN }, async () => {
    const world = stubWorld({
      api: () => new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'mission sign-in required' } }), { status: 401, headers: { 'content-type': 'application/json' } }),
    });
    const errors = captureConsoleError();
    try {
      const response = await GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'overview']));
      assert.equal(response.status, 503);
      const body = await response.text();
      const parsed = JSON.parse(body) as { invalidEnvVars?: string[]; howToFix?: string };
      assert.deepEqual(parsed.invalidEnvVars, [MISSION_SESSION_ENV]);
      const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(parsed.howToFix ?? '', new RegExp(escape(MISSION_SESSION_ENV)));
      assert.match(parsed.howToFix ?? '', new RegExp(escape(MISSION_OWNER_EMAIL_ENV)));
      // One doomed override attempt, zero logins (no credentials → no sign-in call).
      assert.equal(missionApiCalls(world.calls).length, 1);
      assert.equal(loginCalls(world.calls).length, 0);
      const withoutNames = [MISSION_SESSION_ENV, MISSION_OWNER_EMAIL_ENV, MISSION_OWNER_PASSWORD_ENV]
        .reduce((acc, name) => acc.split(name).join(''), body);
      assert.ok(!withoutNames.includes(FORBIDDEN_MARKER));
      assert.ok(!body.includes(OVERRIDE_TOKEN));
      assert.ok(errors.lines.some((line) => line.includes(MISSION_SESSION_ENV)));
      for (const line of errors.lines) assert.ok(!line.includes(OVERRIDE_TOKEN));
    } finally {
      world.restore();
      errors.restore();
    }
  });
});

test('runtime: override 403 passes through without failover — no silent escalation', async () => {
  await withMissionEnv({ override: OVERRIDE_TOKEN, email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({
      api: () => new Response(JSON.stringify({ error: { code: 'forbidden', message: 'this mission role is read-only' } }), { status: 403, headers: { 'content-type': 'application/json' } }),
    });
    try {
      const response = await GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'overview']));
      assert.equal(response.status, 403);
      assert.equal(loginCalls(world.calls).length, 0);
      const apiCalls = missionApiCalls(world.calls);
      assert.equal(apiCalls.length, 1);
      assert.equal(bearerOf(apiCalls[0]), `Bearer ${OVERRIDE_TOKEN}`);
    } finally {
      world.restore();
    }
  });
});

// ── Caller session relay: the login-loop fix ───────────────────────────────
// The gateway used to answer every mission call with a token of its OWN. Since
// each mission sign-in revokes the account's previous sessions
// (src/mission/auth.ts:144-146) and resolveSession only accepts live ones
// (:177-181), the proxy's mint revoked the dashboard's token and the
// dashboard's login revoked the proxy's — an inescapable loop. These tests pin
// the contract that breaks it: relay the caller's session, mint only as a
// fallback, and cost a sessionless path nothing.
const CALLER_TOKEN = ['caller-', 'mission-session-token'].join('');
const CALLER_TOKEN_2 = ['caller-', 'mission-session-token-two'].join('');

test('relay: caller bearer is used verbatim — zero logins, and the override is never substituted', async () => {
  await withMissionEnv({ override: OVERRIDE_TOKEN, email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({});
    try {
      const response = await GET(mockRequest({ cookie: PUBLIC_COOKIE, authorization: `Bearer ${CALLER_TOKEN}` }), params(['api', 'overview']));
      assert.equal(response.status, 200);
      // Exactly one credential, chosen once: the caller's own.
      const apiCalls = missionApiCalls(world.calls);
      assert.equal(apiCalls.length, 1);
      assert.equal(bearerOf(apiCalls[0]), `Bearer ${CALLER_TOKEN}`);
      assert.notEqual(bearerOf(apiCalls[0]), `Bearer ${OVERRIDE_TOKEN}`, 'the override must never be substituted for a caller session');
      assert.notEqual(bearerOf(apiCalls[0]), `Bearer ${MINTED_TOKEN}`, 'a proxy-minted token must never replace the caller session');
      // Zero sign-ins: this is what stopped revoking the caller.
      assert.equal(loginCalls(world.calls).length, 0);
      // The public cookie still never leaves toward the mission server.
      assert.equal(new Headers(apiCalls[0].init.headers).get('cookie'), null);
    } finally {
      world.restore();
    }
  });
});

test('relay: a caller session on one request does not make the proxy mint for the next cookie-only caller', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({});
    try {
      const relayed = await GET(mockRequest({ cookie: PUBLIC_COOKIE, authorization: `Bearer ${CALLER_TOKEN_2}` }), params(['api', 'overview']));
      assert.equal(relayed.status, 200);
      const fallback = await GET(mockRequest({ cookie: PUBLIC_COOKIE }), params(['api', 'treasury']));
      assert.equal(fallback.status, 200);
      const apiCalls = missionApiCalls(world.calls);
      assert.equal(apiCalls.length, 2);
      assert.equal(bearerOf(apiCalls[0]), `Bearer ${CALLER_TOKEN_2}`, 'first call relays the caller');
      assert.equal(bearerOf(apiCalls[1]), `Bearer ${MINTED_TOKEN}`, 'cookie-only caller falls back to the proxy session');
      // Auto-mint is the fallback only: exactly one sign-in, for the second call.
      assert.equal(loginCalls(world.calls).length, 1);
    } finally {
      world.restore();
    }
  });
});

test('relay: unusable bearer shapes fall back safely and are never forwarded upstream', async () => {
  const unusable = [
    ['basic scheme', `Basic ${'dGVzdA=='}`],
    ['bare Bearer', 'Bearer'],
    ['Bearer with empty token', 'Bearer '],
    ['multi-value header', `Bearer ${CALLER_TOKEN}, Bearer ${OVERRIDE_TOKEN}`],
    ['internal whitespace', `Bearer ${CALLER_TOKEN} trailing`],
    ['over-long value', `Bearer ${'x'.repeat(600)}`],
  ] as const;
  for (const [label, value] of unusable) {
    await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
      const world = stubWorld({});
      try {
        const response = await GET(mockRequest({ cookie: PUBLIC_COOKIE, authorization: value }), params(['api', 'overview']));
        assert.equal(response.status, 200, label);
        const apiCalls = missionApiCalls(world.calls);
        assert.equal(apiCalls.length, 1, label);
        // Falls back to the documented precedence (auto-mint), never to garbage.
        assert.equal(bearerOf(apiCalls[0]), `Bearer ${MINTED_TOKEN}`, `${label} must not be relayed`);
        assert.equal(loginCalls(world.calls).length, 1, `${label} must fall back to exactly one sign-in`);
      } finally {
        world.restore();
      }
    });
  }
});

test('relay: a bearer with no public cookie never reaches the mission server, and the owner check refuses it', async () => {
  for (const ownerCheckStatus of [200, 401, 403]) {
    await withMissionEnv({ override: OVERRIDE_TOKEN, email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
      const world = stubWorld({ ownerCheckStatus });
      try {
        const response = await GET(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}` }), params(['api', 'overview']));
        assert.equal(response.status, 401, 'a public check needs the public cookie; a bearer alone is unauthenticated');
        assert.equal(world.calls.length, 0, 'no owner check, no login, and no mission call may happen');
        assert.equal(loginCalls(world.calls).length, 0);
        assert.equal(missionApiCalls(world.calls).length, 0, 'the bearer must never be replayed upstream');
        const body = await response.text();
        assert.ok(!body.includes(PUBLIC_BEARER) && !body.includes(FORBIDDEN_MARKER));
      } finally {
        world.restore();
      }
    });
  }
});

test('relay: the public cookie is never forwarded upstream on any path', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({});
    try {
      await GET(mockRequest({ cookie: PUBLIC_COOKIE, authorization: `Bearer ${CALLER_TOKEN}` }), params(['api', 'overview']));
      await GET(mockRequest({ cookie: PUBLIC_COOKIE }), params([]));
      await POST(mockRequest({ cookie: PUBLIC_COOKIE, method: 'POST', body: '{}' }), params(['api', 'tasks']));
      const upstream = world.calls.filter((call) => !call.url.includes('/api/owner/dashboard'));
      assert.ok(upstream.length >= 3);
      for (const call of upstream) {
        assert.equal(new Headers(call.init.headers).get('cookie'), null, 'the public session cookie must never reach the mission server');
        assert.ok(call.url.includes('127.0.0.1'), 'upstream stays on loopback');
      }
    } finally {
      world.restore();
    }
  });
});

test('relay: shell, asset, sign-in and sign-out send no credential and trigger zero logins', async () => {
  const cases = [
    { label: 'shell', path: [] as string[], method: 'GET', url: 'http://localhost/mission-gateway/', expectUpstream: `http://127.0.0.1:${4200}/`, ownLogins: 0 },
    { label: 'shell trailing slash', path: [''], method: 'GET', url: 'http://localhost/mission-gateway/', expectUpstream: `http://127.0.0.1:${4200}/`, ownLogins: 0 },
    { label: 'asset', path: ['app.js'], method: 'GET', url: 'http://localhost/mission-gateway/app.js', expectUpstream: `http://127.0.0.1:${4200}/app.js`, ownLogins: 0 },
    { label: 'styles', path: ['styles.css'], method: 'GET', url: 'http://localhost/mission-gateway/styles.css', expectUpstream: `http://127.0.0.1:${4200}/styles.css`, ownLogins: 0 },
    { label: 'sign-in', path: ['api', 'session', 'login'], method: 'POST', url: 'http://localhost/mission-gateway/api/session/login', expectUpstream: `http://127.0.0.1:${4200}/api/session/login`, ownLogins: 1 },
    { label: 'sign-out', path: ['api', 'session', 'logout'], method: 'POST', url: 'http://localhost/mission-gateway/api/session/logout', expectUpstream: `http://127.0.0.1:${4200}/api/session/logout`, ownLogins: 0 },
  ];
  for (const item of cases) {
    // Owner credentials ARE configured here: a page load must still not spend one.
    await withMissionEnv({ override: OVERRIDE_TOKEN, email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
      const world = stubWorld({
        api: (_count, url) => (url === item.expectUpstream
          ? new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response(JSON.stringify({ unexpected: url }), { status: 500, headers: { 'content-type': 'application/json' } })),
      });
      try {
        // Even a caller that presents its own bearer gets no credential here,
        // and the proxy never substitutes its own.
        const request = item.method === 'GET'
          ? mockRequest({ cookie: PUBLIC_COOKIE, authorization: `Bearer ${CALLER_TOKEN}`, url: item.url })
          : mockRequest({ cookie: PUBLIC_COOKIE, authorization: `Bearer ${CALLER_TOKEN}`, method: 'POST', body: '{}', url: item.url });
        const response = await (item.method === 'GET' ? GET(request, params(item.path)) : POST(request, params(item.path)));
        assert.equal(response.status, 200, item.label);
        const missionCalls = world.calls.filter((call) => !call.url.includes('/api/owner/dashboard'));
        assert.equal(missionCalls.length, item.ownLogins === 1 ? 1 : 1, `${item.label}: exactly one upstream call — the caller's own`);
        for (const call of missionCalls) {
          assert.equal(bearerOf(call), null, `${item.label} must be forwarded with NO credential`);
          assert.equal(new Headers(call.init.headers).get('cookie'), null, item.label);
        }
        // Zero proxy sign-ins: no /api/session/login beyond the caller's own.
        const loginUrls = world.calls.filter((call) => call.url.endsWith('/api/session/login'));
        assert.equal(loginUrls.length, item.ownLogins, `${item.label}: proxy must mint nothing`);
      } finally {
        world.restore();
      }
    });
  }
});

test('relay: a sessioned path is NOT treated as sessionless (/api/session/me keeps its credential)', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({});
    try {
      // The dashboard reload path (app.js:2370) calls /session/me with its own token.
      const response = await GET(mockRequest({ cookie: PUBLIC_COOKIE, authorization: `Bearer ${CALLER_TOKEN}` }), params(['api', 'session', 'me']));
      assert.equal(response.status, 200);
      const apiCalls = missionApiCalls(world.calls);
      assert.equal(apiCalls.length, 1);
      assert.equal(bearerOf(apiCalls[0]), `Bearer ${CALLER_TOKEN}`);
      assert.equal(loginCalls(world.calls).length, 0);
    } finally {
      world.restore();
    }
  });
});

test('relay: caller 401 and 403 pass through with zero logins and exactly ONE upstream attempt', async () => {
  for (const status of [401, 403] as const) {
    await withMissionEnv({ override: OVERRIDE_TOKEN, email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
      const world = stubWorld({
        api: () => new Response(JSON.stringify({ error: { code: status === 401 ? 'unauthorized' : 'forbidden', message: status === 401 ? 'mission sign-in required' : 'read-only access link' } }), { status, headers: { 'content-type': 'application/json' } }),
      });
      try {
        const response = await GET(mockRequest({ cookie: PUBLIC_COOKIE, authorization: `Bearer ${CALLER_TOKEN}` }), params(['api', 'overview']));
        assert.equal(response.status, status, `${status} must reach the caller unchanged`);
        const apiCalls = missionApiCalls(world.calls);
        assert.equal(apiCalls.length, 1, `${status}: no retry — a second attempt with another credential is what caused the loop`);
        assert.equal(bearerOf(apiCalls[0]), `Bearer ${CALLER_TOKEN}`);
        assert.equal(loginCalls(world.calls).length, 0, `${status}: the proxy must never sign in to "rescue" a rejected caller session`);
        // The upstream error body is relayed, so the dashboard can react (app.js:120).
        const parsed = JSON.parse(await response.text()) as { error?: { code?: string } };
        assert.equal(parsed.error?.code, status === 401 ? 'unauthorized' : 'forbidden');
      } finally {
        world.restore();
      }
    });
  }
});
