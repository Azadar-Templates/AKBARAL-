import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// The REAL private dashboard shell and script, booted in jsdom with a stubbed
// mission server. These tests pin the client side of owner session persistence:
// login renders the dashboard, a reload revalidates WITHOUT a login round-trip,
// and only a genuine 401 destroys the session — a 500 or a network error at
// boot preserves the token and shows an error instead of bouncing to login.
const repoRoot = path.resolve(process.cwd());
const dashboardHtml = fs.readFileSync(path.join(repoRoot, 'mission-dashboard/index.html'), 'utf8');
const dashboardJs = fs.readFileSync(path.join(repoRoot, 'mission-dashboard/app.js'), 'utf8');

// Mirror of the proxy's relay() rewrite (route.ts): the gateway serves the
// dashboard under /mission-gateway with rebased fetch URLs. Booting the suite
// through the same transform keeps the session logic faithful to production.
const GATEWAY_JS = dashboardJs
  .replace("register('/service-worker.js')", "register('/mission-gateway/service-worker.js')")
  .replace('fetch(`/api${path}`', 'fetch(`/mission-gateway/api${path}`');

test('gateway simulation applies the proxy rewrites to the real dashboard script', () => {
  assert.ok(GATEWAY_JS.includes('fetch(`/mission-gateway/api${path}`'));
  assert.ok(GATEWAY_JS.includes("register('/mission-gateway/service-worker.js')"));
});

// Boot the real HTML with the real (rebased) script inlined — verified: app.js
// contains no literal </script>, so inlining is safe. The replacer function
// keeps the script's own $-patterns literal.
const BOOT_HTML = dashboardHtml.replace('<script src="/app.js"></script>', () => `<script>${GATEWAY_JS}</script>`);
assert.ok(!BOOT_HTML.includes('src="/app.js"'));

const TOKEN_KEY = 'za_mission_token';
const DASHBOARD_TOKEN = ['dashboard-', 'session-token'].join('');
const DASHBOARD_EMAIL = 'mission-owner@example.test';
const OWNER = { id: 'own_1', email: DASHBOARD_EMAIL, displayName: null, role: 'owner', status: 'active' };

const LOGIN_ROUTE = { status: 200, body: { token: DASHBOARD_TOKEN, csrfToken: 'csrf-fixture', expiresAt: '2030-01-01T00:00:00.000Z', owner: OWNER } };
const ME_ROUTE = { status: 200, body: { owner: OWNER, expiresAt: null, vaultConfigured: false } };

interface StubRoute { status: number; body: unknown }
interface FetchCall { url: string; init: RequestInit }

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function loadDashboard(options: {
  seedToken?: string;
  routes?: Record<string, StubRoute | 'throw'>;
}): { window: JSDOM['window']; document: Document; calls: FetchCall[]; close: () => void } {
  const calls: FetchCall[] = [];
  const routes = options.routes ?? {};
  const dom = new JSDOM(BOOT_HTML, {
    url: 'https://owner.test/mission-gateway/',
    runScripts: 'dangerously',
    beforeParse(window) {
      (window as unknown as { fetch: typeof fetch }).fetch = (async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init: init ?? {} });
        const pathname = new URL(url, 'https://owner.test').pathname;
        const route = routes[pathname];
        if (route === 'throw') throw new TypeError('network error (stubbed)');
        if (route) return jsonResponse(route.body, route.status);
        return jsonResponse({}, 200);
      }) as typeof fetch;
      if (options.seedToken !== undefined) window.sessionStorage.setItem(TOKEN_KEY, options.seedToken);
    },
  });
  return { window: dom.window, document: dom.window.document, calls, close: () => dom.window.close() };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for dashboard condition');
    await sleep(25);
  }
}

/** Settle past DOMContentLoaded plus boot()'s synchronous wiring. */
async function domSettled(window: JSDOM['window']): Promise<void> {
  const doc = window.document;
  if (doc.readyState === 'loading') {
    await new Promise<void>((resolve) => { doc.addEventListener('DOMContentLoaded', () => resolve(), { once: true }); });
  }
  await sleep(50);
}

function hidden(document: Document, selector: string): boolean {
  return (document.querySelector(selector) as HTMLElement).hidden;
}

test('login shows the dashboard and the session survives a simulated reload (boot path)', async () => {
  const routes = { '/mission-gateway/api/session/login': LOGIN_ROUTE, '/mission-gateway/api/session/me': ME_ROUTE };
  // Window 1: boot with no token → login form → submit → dashboard.
  const first = loadDashboard({ routes });
  try {
    await domSettled(first.window);
    (first.document.querySelector('#email') as HTMLInputElement).value = DASHBOARD_EMAIL;
    (first.document.querySelector('#password') as HTMLInputElement).value = 'dummy-fixture-password';
    const SubmitEvent = (first.window as unknown as { Event: typeof Event }).Event;
    first.document.querySelector('#login-form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => !hidden(first.document, '#app'));
    assert.equal(hidden(first.document, '#login-panel'), true);
    assert.equal(first.window.sessionStorage.getItem(TOKEN_KEY), DASHBOARD_TOKEN);
    assert.equal(first.calls.filter((call) => call.url.endsWith('/api/session/login')).length, 1);
  } finally {
    first.close();
  }
  // Window 2 (simulated reload): token seeded, boot revalidates via /session/me
  // — the dashboard renders with no login form and no login round-trip.
  const second = loadDashboard({ seedToken: DASHBOARD_TOKEN, routes });
  try {
    await waitFor(() => !hidden(second.document, '#app'), 8000);
    assert.equal(hidden(second.document, '#login-panel'), true);
    assert.equal(second.window.sessionStorage.getItem(TOKEN_KEY), DASHBOARD_TOKEN);
    assert.ok(second.calls.some((call) => call.url.endsWith('/api/session/me')));
    assert.equal(second.calls.filter((call) => call.url.endsWith('/api/session/login')).length, 0);
  } finally {
    second.close();
  }
});

test('a boot-time 500 does NOT bounce to login: the token is preserved and an error is shown', async () => {
  const world = loadDashboard({
    seedToken: DASHBOARD_TOKEN,
    routes: { '/mission-gateway/api/session/me': { status: 500, body: { error: { code: 'internal_error', message: 'boom (stubbed)' } } } },
  });
  try {
    await waitFor(() => world.calls.some((call) => call.url.endsWith('/api/session/me')));
    await sleep(300); // let boot()'s catch run
    assert.equal(world.window.sessionStorage.getItem(TOKEN_KEY), DASHBOARD_TOKEN);
    assert.equal(hidden(world.document, '#banner'), false);
    assert.match(world.document.querySelector('#banner')!.textContent ?? '', /boom/);
    assert.equal(hidden(world.document, '#app'), true);
    assert.equal(world.calls.filter((call) => call.url.endsWith('/api/session/login')).length, 0);
  } finally {
    world.close();
  }
});

test('a boot-time network error does NOT bounce to login either', async () => {
  const world = loadDashboard({
    seedToken: DASHBOARD_TOKEN,
    routes: { '/mission-gateway/api/session/me': 'throw' },
  });
  try {
    await waitFor(() => world.calls.some((call) => call.url.endsWith('/api/session/me')));
    await sleep(300); // let boot()'s catch run
    assert.equal(world.window.sessionStorage.getItem(TOKEN_KEY), DASHBOARD_TOKEN);
    assert.equal(hidden(world.document, '#banner'), false);
    assert.match(world.document.querySelector('#banner')!.textContent ?? '', /network error/);
    assert.equal(hidden(world.document, '#app'), true);
  } finally {
    world.close();
  }
});

test('a genuine boot-time 401 clears the session and returns to login', async () => {
  const world = loadDashboard({
    seedToken: DASHBOARD_TOKEN,
    routes: { '/mission-gateway/api/session/me': { status: 401, body: { error: { code: 'unauthorized', message: 'mission sign-in required' } } } },
  });
  try {
    await waitFor(() => world.window.sessionStorage.getItem(TOKEN_KEY) === null);
    assert.equal(hidden(world.document, '#login-panel'), false);
    assert.equal(hidden(world.document, '#app'), true);
  } finally {
    world.close();
  }
});

test('dashboard signs out ONLY on 401 — never from a catch block', () => {
  assert.match(dashboardJs, /if \(response\.status === 401\) signOut\(false\);/);
  assert.match(dashboardJs, /if \(error\.status === 401\)/);
  assert.doesNotMatch(dashboardJs, /catch\s*(\([^)]*\))?\s*\{[^}]*signOut\(/);
  assert.equal(dashboardJs.match(/signOut\(/g)?.length, 3);
});
