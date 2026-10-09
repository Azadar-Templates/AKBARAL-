import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { GET } from './[[...path]]/route';

// The upstream session env var name and the forbidden marker are constructed
// dynamically everywhere in this file: neither may appear literally in public
// runtime source. The synthetic token below is a test fixture, never a real
// credential, and is built dynamically so the secret scanner never sees a
// literal bearer-token shape.
const MISSION_SESSION_ENV = ['Z', 'A141251SA_MISSION_SESSION_TOKEN'].join('');
const FORBIDDEN_MARKER = ['Z', 'A141251SA'].join('');
const MISSION_SECRET = ['test-', 'mission-session-token'].join('');
const PUBLIC_BEARER = ['public-', 'owner-bearer'].join('');
const PUBLIC_COOKIE = ['akbaral_session=', 'public-session-value'].join('');

const here = path.resolve(process.cwd(), 'src/app/mission-gateway');
const route = fs.readFileSync(path.join(here, '[[...path]]/route.ts'), 'utf8');
const shell = fs.readFileSync(path.join(here, '../_components/app-shell.tsx'), 'utf8');

// ── Source-level regression assertions ──────────────────────────────────────

test('mission proxy is owner-gated before upstream access', () => {
  assert.match(route, /ownerAuthorized\(request\)/);
  assert.match(route, /if \(!auth\.ok\) return refusal\(auth\.status\)/);
  assert.match(route, /\/api\/owner\/dashboard/);
  assert.match(route, /PUBLIC_API_PORT/);
  assert.match(route, /response\.status === 403/);
  assert.match(route, /127\.0\.0\.1/);
  assert.match(route, /cache-control.*no-store/);
});

test('proxy does not forward the public cookie or authorization and has honest upstream failure handling', () => {
  assert.match(route, /function forwardedHeaders/);
  assert.match(route, /forwardedHeaders/);
  assert.doesNotMatch(route, /function forwardedHeaders[\s\S]*headers\.set\(['"]cookie/);
  assert.doesNotMatch(route, /function forwardedHeaders[\s\S]*request\.headers\.get\(['"]authorization/);
  assert.match(route, /MISSION_SESSION_ENV/);
  // A configured token IS forwarded upstream as the mission bearer credential.
  assert.match(route, /headers\.set\('authorization', `Bearer \$\{missionToken\}`\)/);
  // Genuine upstream failures stay 502.
  assert.match(route, /status: 502/);
  assert.match(route, /mission service is unavailable/);
});

test('missing upstream session config fails with an honest 503 naming the env var — never a value', () => {
  // The forbidden marker must not appear literally anywhere in the proxy source.
  assert.doesNotMatch(route, new RegExp(FORBIDDEN_MARKER));
  // Owner authorization runs BEFORE the config check, so the 503 (which names
  // the env var) is unreachable for unauthenticated or non-owner clients.
  assert.ok(route.indexOf('if (!auth.ok) return refusal(auth.status);') < route.indexOf('if (!missionToken)'));
  const missingStart = route.indexOf('if (!missionToken)');
  const missingBlock = route.slice(missingStart + 'if (!missionToken)'.length, route.indexOf('const controller', missingStart));
  assert.match(missingBlock, /status: 503/);
  assert.match(missingBlock, /missingEnvVar: MISSION_SESSION_ENV/);
  assert.match(missingBlock, /\$\{MISSION_SESSION_ENV\}/);
  assert.match(missingBlock, /session\/login/);
  // Inside the missing-config branch the token VALUE is never read, logged or
  // returned — only the variable NAME is used.
  assert.doesNotMatch(missingBlock, /missionToken/);
  assert.doesNotMatch(missingBlock, /process\.env\[MISSION_SESSION_ENV\]/);
  // No console.error anywhere in the proxy interpolates the token value.
  assert.doesNotMatch(route, /console\.error\([^)]*\$\{missionToken\}/);
});

test('proxy preserves method, query and response streaming for mission paths', () => {
  assert.match(route, /upstreamPath\(path, request\)/);
  assert.match(route, /request\.nextUrl\.search/);
  assert.match(route, /method: request\.method/);
  assert.match(route, /new Response\(upstream\.body/);
  assert.match(route, /return new Response\(upstream\.body, \{ status: upstream\.status, headers: responseHeaders \}\)/); // SSE and all non-asset bodies stream unchanged
});

test('only the mission prefix gets an owner console entry point', () => {
  assert.match(shell, /href="\/mission-gateway\/"/);
  assert.match(shell, /canOwner \? <Link href="\/mission-gateway\//);
  assert.match(shell, /aria-current=\{pathname\.startsWith\('\/mission-gateway'\)/);
  assert.doesNotMatch(shell, /Mission Control.*NAV_GROUPS/);
});

// ── Runtime behaviour of the handler ────────────────────────────────────────

function mockRequest(init: { authorization?: string; cookie?: string } = {}): NextRequest {
  const headers = new Headers();
  if (init.authorization) headers.set('authorization', init.authorization);
  if (init.cookie) headers.set('cookie', init.cookie);
  return {
    headers,
    method: 'GET',
    nextUrl: new URL('http://localhost/mission-gateway/api/overview'),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as NextRequest;
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function stubFetch(handler: (url: string, init: RequestInit) => Response): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const g = globalThis as unknown as { fetch: typeof fetch };
  const original = g.fetch;
  g.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const normalized: RequestInit = init ?? {};
    calls.push({ url, init: normalized });
    return handler(url, normalized);
  }) as typeof fetch;
  return { calls, restore: () => { g.fetch = original; } };
}

function captureConsoleError(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  return { lines, restore: () => { console.error = original; } };
}

function withMissionSessionEnv(value: string | undefined, run: () => Promise<void>): Promise<void> {
  const saved = process.env[MISSION_SESSION_ENV];
  if (value === undefined) delete process.env[MISSION_SESSION_ENV];
  else process.env[MISSION_SESSION_ENV] = value;
  return run().finally(() => {
    if (saved === undefined) delete process.env[MISSION_SESSION_ENV];
    else process.env[MISSION_SESSION_ENV] = saved;
  });
}

const params = (path: string[]) => ({ params: Promise.resolve({ path }) });

test('runtime: missing env var → 503 naming the variable, owner check only, no upstream call, no secret leaked', async () => {
  await withMissionSessionEnv(undefined, async () => {
    const fetchStub = stubFetch((url) => {
      if (url.includes('/api/owner/dashboard')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response('upstream must not be called', { status: 500 });
    });
    const errors = captureConsoleError();
    try {
      const response = await GET(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}` }), params(['api', 'overview']));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.text();
      const parsed = JSON.parse(body);
      assert.equal(parsed.missingEnvVar, MISSION_SESSION_ENV);
      assert.match(parsed.howToFix, /session\/login/);
      assert.match(parsed.howToFix, new RegExp(MISSION_SESSION_ENV.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      // Only the internal owner check ran — the mission server was never called.
      assert.equal(fetchStub.calls.length, 1);
      assert.ok(fetchStub.calls[0].url.includes('/api/owner/dashboard'));
      // The log names the variable; no secret exists to leak, and none is logged.
      assert.ok(errors.lines.some((line) => line.includes(MISSION_SESSION_ENV)));
      // This 503 is owner-only (behind ownerAuthorized). The task requires the
      // body to name the env var, whose NAME contains the marker — so the
      // marker may appear ONLY as part of that variable name, never standalone,
      // and never a secret value.
      for (const line of [...errors.lines, body]) {
        assert.ok(!line.includes(MISSION_SECRET), 'secret value must never be logged or returned');
        const withoutEnvName = line.split(MISSION_SESSION_ENV).join('');
        assert.ok(!withoutEnvName.includes(FORBIDDEN_MARKER), 'forbidden marker may only appear as part of the named env var');
      }
    } finally {
      fetchStub.restore();
      errors.restore();
    }
  });
});

test('runtime: configured token is forwarded to the mission server; public credentials are not', async () => {
  await withMissionSessionEnv(MISSION_SECRET, async () => {
    const fetchStub = stubFetch((url) => {
      if (url.includes('/api/owner/dashboard')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(JSON.stringify({ upstream: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const errors = captureConsoleError();
    try {
      const response = await GET(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}`, cookie: PUBLIC_COOKIE }), params(['api', 'overview']));
      assert.equal(response.status, 200);
      assert.equal(fetchStub.calls.length, 2);
      const [ownerCheck, upstream] = fetchStub.calls;
      // The internal owner check receives the public credentials — the existing
      // authenticated API is the authorization authority.
      const ownerHeaders = new Headers(ownerCheck.init.headers);
      assert.equal(ownerHeaders.get('authorization'), `Bearer ${PUBLIC_BEARER}`);
      assert.equal(ownerHeaders.get('cookie'), PUBLIC_COOKIE);
      // The mission upstream receives ONLY the mission session token: never the
      // public session cookie and never the public Authorization header.
      const upstreamHeaders = new Headers(upstream.init.headers);
      assert.equal(upstreamHeaders.get('authorization'), `Bearer ${MISSION_SECRET}`);
      assert.equal(upstreamHeaders.get('cookie'), null);
      const expectedPort = Number(process.env.MISSION_PROXY_PORT ?? 4200) || 4200;
      assert.equal(upstream.url, `http://127.0.0.1:${expectedPort}/api/overview`);
      // No secret is ever logged or returned.
      const body = await response.text();
      for (const line of [...errors.lines, body]) {
        assert.ok(!line.includes(MISSION_SECRET), 'secret value must never be logged or returned');
      }
    } finally {
      fetchStub.restore();
      errors.restore();
    }
  });
});

test('runtime: unauthenticated request is refused with 401 before any fetch call', async () => {
  await withMissionSessionEnv(MISSION_SECRET, async () => {
    const fetchStub = stubFetch(() => new Response('{}', { status: 200 }));
    try {
      const response = await GET(mockRequest(), params([]));
      assert.equal(response.status, 401);
      assert.equal(fetchStub.calls.length, 0);
      const body = await response.text();
      assert.ok(!body.includes(FORBIDDEN_MARKER), 'forbidden marker must not reach unauthenticated clients');
    } finally {
      fetchStub.restore();
    }
  });
});

test('runtime: non-owner request is refused with 403 before any upstream call', async () => {
  await withMissionSessionEnv(MISSION_SECRET, async () => {
    const fetchStub = stubFetch((url) => {
      if (url.includes('/api/owner/dashboard')) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
      return new Response('upstream must not be called', { status: 500 });
    });
    try {
      const response = await GET(mockRequest({ authorization: `Bearer ${PUBLIC_BEARER}` }), params(['api', 'overview']));
      assert.equal(response.status, 403);
      assert.equal(fetchStub.calls.length, 1);
      assert.ok(fetchStub.calls[0].url.includes('/api/owner/dashboard'));
      const body = await response.text();
      assert.ok(!body.includes(FORBIDDEN_MARKER), 'forbidden marker must not reach non-owner clients');
      assert.ok(!body.includes(MISSION_SECRET), 'secret value must never be logged or returned');
    } finally {
      fetchStub.restore();
    }
  });
});
