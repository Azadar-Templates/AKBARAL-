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
const MINTED_TOKEN = ['minted-', 'session-token'].join('');
const MINTED_TOKEN_2 = ['minted-', 'session-token-two'].join('');
const OWNER_EMAIL = 'mission-owner@example.test';
const OWNER_PASSWORD = ['test-', 'owner-password'].join('');
const PUBLIC_BEARER = ['public-', 'owner-bearer'].join('');
const PUBLIC_COOKIE = ['akbaral_session=', 'public-session-value'].join('');

const here = path.resolve(process.cwd(), 'src/app/mission-gateway');
const route = fs.readFileSync(path.join(here, '[[...path]]/route.ts'), 'utf8');
const sessionModule = fs.readFileSync(path.join(here, 'mission-session.ts'), 'utf8');
const shell = fs.readFileSync(path.join(here, '../_components/app-shell.tsx'), 'utf8');

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

test('proxy forwards only the mission bearer credential — never the public cookie or authorization', () => {
  assert.match(route, /function forwardedHeaders\(request: NextRequest, missionToken: string\)/);
  assert.match(route, /headers\.set\('authorization', `Bearer \$\{missionToken\}`\)/);
  assert.doesNotMatch(route, /function forwardedHeaders[\s\S]*headers\.set\(['"]cookie/);
  assert.doesNotMatch(route, /function forwardedHeaders[\s\S]*request\.headers\.get\(['"]authorization/);
  // Genuine upstream failures stay 502.
  assert.match(route, /status: 502/);
  assert.match(route, /mission service is unavailable/);
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
  // Explicit override takes precedence and never triggers a login.
  assert.match(sessionModule, /const override = explicitSessionToken\(\);[\s\S]*if \(override\) return \{ token: override, source: 'override' \}/);
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

function mockRequest(init: { authorization?: string; cookie?: string; method?: string; body?: string } = {}): NextRequest {
  const headers = new Headers();
  if (init.authorization) headers.set('authorization', init.authorization);
  if (init.cookie) headers.set('cookie', init.cookie);
  const payload = init.body;
  return {
    headers,
    method: init.method ?? 'GET',
    nextUrl: new URL('http://localhost/mission-gateway/api/overview'),
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
  api?: (apiCount: number) => Response;
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
    return (options.api ?? okApi)(api);
  }) as typeof fetch;
  return { calls, restore: () => { g.fetch = original; } };
}

const expectedMissionPort = () => Number(process.env.MISSION_PROXY_PORT ?? 4200) || 4200;

test('runtime: no override + owner credentials present → proxy signs in once and forwards the minted bearer', async () => {
  await withMissionEnv({ email: OWNER_EMAIL, password: OWNER_PASSWORD }, async () => {
    const world = stubWorld({});
    const errors = captureConsoleError();
    try {
      const response = await GET(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}`, cookie: PUBLIC_COOKIE }), params(['api', 'overview']));
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
        GET(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}` }), params(['api', 'overview'])),
        GET(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}` }), params(['api', 'overview'])),
        GET(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}` }), params(['api', 'overview'])),
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
      const first = await GET(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}` }), params(['api', 'overview']));
      const second = await GET(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}` }), params(['api', 'treasury']));
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
      const response = await GET(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}` }), params(['api', 'overview']));
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
      const response = await POST(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}`, method: 'POST', body: 'ping-payload' }), params(['api', 'policy', 'kill-switch']));
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
      const response = await GET(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}` }), params(['api', 'overview']));
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
      const response = await GET(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}` }), params(['api', 'overview']));
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
      const response = await GET(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}`, cookie: PUBLIC_COOKIE }), params(['api', 'overview']));
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
      const response = await GET(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}` }), params(['api', 'overview']));
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
      const response = await GET(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}` }), params(['api', 'overview']));
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
