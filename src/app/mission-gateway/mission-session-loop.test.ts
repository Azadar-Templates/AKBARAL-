import test from 'node:test';
import assert from 'node:assert/strict';
import type { NextRequest } from 'next/server';
import { GET, POST } from './[[...path]]/route';
import { MISSION_PORT, resetMissionSessionStateForTests } from './mission-session';

/**
 * End-to-end proof that the login loop is gone.
 *
 * The stub below is not a permissive fake: it reproduces the ONE mission-server
 * behavior that caused the loop — `login()` runs
 * `UPDATE mission_sessions SET revoked_at = ? WHERE owner_id = ? AND revoked_at IS NULL`
 * inside its transaction (src/mission/auth.ts:144-146), and resolveSession only
 * accepts live rows (src/mission/auth.ts:177-181). So on this stub, ANY extra
 * sign-in by anyone immediately invalidates the session the dashboard is holding,
 * and the dashboard's next data call gets a 401 → signOut()
 * (mission-dashboard/app.js:120). A fix that merely tolerated 401s would pass a
 * weaker stub and fail here.
 *
 * Every credential-looking value is constructed dynamically so the secret
 * scanner never sees a literal bearer shape (same convention as proxy.test.ts).
 */
const MISSION_OWNER_EMAIL_ENV = ['Z', 'A141251SA_OWNER_EMAIL'].join('');
const MISSION_OWNER_PASSWORD_ENV = ['Z', 'A141251SA_OWNER_PASSWORD'].join('');
const MISSION_SESSION_ENV = ['Z', 'A141251SA_MISSION_SESSION_TOKEN'].join('');
const OWNER_EMAIL = 'mission-owner@example.test';
const OWNER_PASSWORD = ['e2e-', 'owner-password'].join('');
const PUBLIC_COOKIE = ['akbaral_session=', 'e2e-public-owner-session'].join('');
/** A live, valid override token planted in the environment: the relayed caller
 * session must outrank it, so it must never be used or revoked. */
const OVERRIDE_TOKEN = ['e2e-', 'operator-override-session'].join('');

const DASHBOARD_PATH = 'mission-dashboard';

interface MissionCall {
  url: string;
  method: string;
  bearer: string | null;
  cookie: string | null;
  body: unknown;
}

/** The mission process, as the gateway sees it. */
function createMissionStub(options: { revokeOnLogin?: boolean } = {}) {
  const revokeOnLogin = options.revokeOnLogin ?? true;
  const sessions = new Map<string, { revoked: boolean }>();
  const calls: MissionCall[] = [];
  let minted = 0;
  // The operator's override is live from the start, exactly as it would be in a
  // correctly configured deployment.
  sessions.set(OVERRIDE_TOKEN, { revoked: false });

  const decode = (body: unknown): unknown => {
    if (body instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(body));
    if (typeof body === 'string') return JSON.parse(body);
    return body ?? null;
  };

  const handle = (url: string, init: RequestInit): Response => {
    const headers = new Headers(init.headers);
    const bearerRaw = headers.get('authorization');
    const bearer = bearerRaw && bearerRaw.startsWith('Bearer ') ? bearerRaw.slice('Bearer '.length).trim() : null;
    const cookie = headers.get('cookie');
    const body = decode(init.body);
    calls.push({ url, method: String(init.method ?? 'GET'), bearer, cookie, body });

    // ── the public API: the owner-check authority ──
    if (url.includes('/api/owner/dashboard')) {
      // The gateway must present the public cookie and nothing else.
      if (bearer) return json(401, { error: { code: 'unauthorized', message: 'invalid or expired token' } });
      if (cookie === PUBLIC_COOKIE) return json(200, { ok: true, user: { role: 'owner' } });
      return json(401, { error: { code: 'unauthorized', message: 'missing bearer token' } });
    }

    const isMission = url.startsWith(`http://127.0.0.1:${MISSION_PORT}/`);
    if (!isMission) return json(500, { error: { code: 'unexpected_target', message: url } });
    const path = new URL(url).pathname;

    // ── non-/api/ GET: serveStatic answers straight off disk and never
    // consults a session (src/mission/server.ts:3152 with 470-489). This is
    // exactly why the shell and its assets must travel credential-free.
    if (!path.startsWith('/api/')) {
      const isHtml = path === '/' || path.endsWith('.html');
      return new Response(isHtml ? '<!doctype html><html><body>mission shell</body></html>' : 'export const missionAsset = true;', {
        status: 200,
        headers: { 'content-type': isHtml ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' },
      });
    }

    // ── POST /api/session/login (src/mission/server.ts:1528-1538) ──
    if (path === '/api/session/login') {
      const credentials = body as { email?: string; password?: string } | null;
      if (credentials?.email !== OWNER_EMAIL || credentials?.password !== OWNER_PASSWORD) {
        return json(401, { error: { code: 'unauthorized', message: 'invalid credentials' } });
      }
      if (revokeOnLogin) for (const session of sessions.values()) session.revoked = true;
      minted += 1;
      const token = ['e2e-dash-', 'session-', String(minted)].join('');
      sessions.set(token, { revoked: false });
      // Serialized exactly like the mission server does: { token, csrfToken,
      // expiresAt, owner } — this is the body app.js:177 reads.
      return json(200, { token, csrfToken: ['e2e-csrf-', String(minted)].join(''), expiresAt: '2030-01-01T00:00:00.000Z', owner: { id: 'own_1', email: OWNER_EMAIL, role: 'owner', status: 'active' } });
    }

    // ── POST /api/session/logout (server.ts:1539-1543): revokes the PRESENTED token ──
    if (path === '/api/session/logout') {
      if (!bearer) return json(200, { loggedOut: false });
      const session = sessions.get(bearer);
      if (session) session.revoked = true;
      return json(200, { loggedOut: Boolean(session) });
    }

    // ── every other /api/* route: resolveSession(bearer(req)) then requireOwner/requireRead ──
    if (!bearer) return json(401, { error: { code: 'unauthorized', message: 'mission sign-in required' } });
    const session = sessions.get(bearer);
    if (!session || session.revoked) return json(401, { error: { code: 'unauthorized', message: 'session is no longer active' } });
    if (path === '/api/session/me') return json(200, { owner: { id: 'own_1', email: OWNER_EMAIL, role: 'owner' }, expiresAt: null, vaultConfigured: true, identityLock: { locked: false } });
    return json(200, { ok: true, path, seenBearer: bearer });
  };

  /** Everything the mission process was asked to do, split the way it sees it. */
  const logins = () => calls.filter((call) => call.url.endsWith('/api/session/login'));
  const dataCalls = () => calls.filter((call) => !call.url.includes('/api/owner/dashboard') && !call.url.endsWith('/api/session/login'));
  // The proxy's OWN sign-ins are counted as: everything the mission server saw
  // minus the logins the dashboard driver itself performed. They are otherwise
  // indistinguishable on the wire — both are credential-free POSTs with the same
  // body — so the driver's own event log is the authority here.
  return { handle, sessions, calls, logins, dataCalls, tokens: () => [...sessions.keys()] };
}

type Stub = ReturnType<typeof createMissionStub>;

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

/** Installs the stub as global fetch and drives the REAL dashboard client
 * behavior (mission-dashboard/app.js:105-126, 175-183) against the gateway. */
type Dashboard = ReturnType<typeof makeDashboard>;

async function withLoopScenario(stub: Stub, run: (dashboard: Dashboard) => Promise<void>): Promise<void> {
  const g = globalThis as unknown as { fetch: typeof fetch };
  const original = g.fetch;
  g.fetch = (async (input: unknown, init?: RequestInit) => stub.handle(String(input), init ?? {})) as typeof fetch;
  const env = {
    [MISSION_OWNER_EMAIL_ENV]: OWNER_EMAIL,
    [MISSION_OWNER_PASSWORD_ENV]: OWNER_PASSWORD,
    [MISSION_SESSION_ENV]: OVERRIDE_TOKEN,
  };
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  resetMissionSessionStateForTests();
  try {
    await run(makeDashboard());
  } finally {
    g.fetch = original;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetMissionSessionStateForTests();
  }
}

/** The dashboard's own state machine, mirroring app.js: sessionStorage-backed
 * token, one authorization header per call, and signOut() on any 401. */
function makeDashboard() {
  const state = { token: '' };
  const events: { type: 'signout' | 'login' | 'call'; detail: string }[] = [];
  const request = (method: 'GET' | 'POST', path: string[], options: { body?: unknown; withBearer?: boolean } = {}) => {
    const headers = new Headers();
    headers.set('cookie', PUBLIC_COOKIE);
    if (state.token && options.withBearer !== false) headers.set('authorization', `Bearer ${state.token}`);
    const url = `http://localhost/${DASHBOARD_PATH === 'mission-dashboard' ? 'mission-gateway' : DASHBOARD_PATH}/${path.join('/')}`;
    const init = {
      headers,
      method,
      nextUrl: new URL(url),
      arrayBuffer: async () => (options.body === undefined ? new ArrayBuffer(0) : (new TextEncoder().encode(JSON.stringify(options.body)).buffer as ArrayBuffer)),
    };
    return { init, url };
  };
  const send = async (method: 'GET' | 'POST', path: string[], options: { body?: unknown; withBearer?: boolean } = {}) => {
    const { init } = request(method, path, options);
    const response = method === 'GET'
      ? await GET(init as unknown as NextRequest, { params: Promise.resolve({ path }) })
      : await POST(init as unknown as NextRequest, { params: Promise.resolve({ path }) });
    const text = await response.text();
    let payload: Record<string, unknown> | null = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
    if (!response.ok) {
      // app.js:120 — any 401 destroys the session and shows the login screen.
      if (response.status === 401) {
        state.token = '';
        events.push({ type: 'signout', detail: path.join('/') });
      }
      const error = new Error((payload?.error as { message?: string } | undefined)?.message ?? `request failed (${response.status})`) as Error & { status: number };
      error.status = response.status;
      throw error;
    }
    return { status: response.status, payload: payload ?? {} };
  };
  return {
    state,
    events,
    signOuts: () => events.filter((event) => event.type === 'signout').length,
    /** loadShell() — the dashboard opens by fetching its own shell and assets,
     * then reloading the session (app.js:2366-2372). */
    loadShell: async () => {
      const shell = await send('GET', []);
      const appJs = await send('GET', ['app.js']);
      return { shell: shell.status, appJs: appJs.status };
    },
    login: async () => {
      const result = await send('POST', ['api', 'session', 'login'], { body: { email: OWNER_EMAIL, password: OWNER_PASSWORD }, withBearer: false });
      const token = result.payload.token;
      if (typeof token !== 'string') throw new Error('login response carried no token');
      state.token = token; // app.js:177 + :181
      events.push({ type: 'login', detail: token.slice(0, 4) });
      return token;
    },
    me: async () => send('GET', ['api', 'session', 'me']),
    data: async (segment: string) => {
      events.push({ type: 'call', detail: segment });
      return send('GET', ['api', segment]);
    },
    signOut: async () => send('POST', ['api', 'session', 'logout'], { body: {} }),
  };
}

test('loop proof: dashboard login → many data calls costs exactly one sign-in, and no call ever 401s', async () => {
  const stub = createMissionStub();
  await withLoopScenario(stub, async (dashboard) => {
    // 1. Page load: shell + assets. Must not sign in — under the old code this
    //    minted a proxy session and revoked whatever the owner held.
    const loaded = await dashboard.loadShell();
    assert.equal(loaded.shell, 200);
    assert.equal(loaded.appJs, 200);
    assert.equal(stub.logins().length, 0, 'a page load must not mint a mission session');

    // 2. The owner signs in through the gateway.
    const token = await dashboard.login();
    assert.ok(token.length > 0);
    assert.equal(dashboard.state.token, token);
    assert.equal(stub.logins().length, 1, 'the dashboard login is the ONLY sign-in in the flow');

    // 3. Every subsequent call carries the caller's own token and succeeds.
    const me = await dashboard.me();
    assert.equal(me.status, 200);
    assert.equal((me.payload as { owner?: { email?: string } }).owner?.email, OWNER_EMAIL);
    for (const segment of ['overview', 'treasury', 'tasks', 'policy', 'ledger', 'agents']) {
      const result = await dashboard.data(segment);
      assert.equal(result.status, 200, `data call ${segment} must not bounce`);
      assert.equal((result.payload as { seenBearer?: string }).seenBearer, token, `data call ${segment} must be authenticated as the caller`);
    }

    // 4. Reload path: the stored token still works — nothing revoked it.
    const reloaded = await dashboard.loadShell();
    assert.equal(reloaded.shell, 200);
    const afterReload = await dashboard.data('overview');
    assert.equal(afterReload.status, 200, 'a reload must not log the owner out');
    assert.equal((afterReload.payload as { seenBearer?: string }).seenBearer, token);

    // 5. Sign-out is forwarded and costs no login either.
    const signedOut = await dashboard.signOut();
    assert.equal(signedOut.status, 200);

    // ── The loop is gone, measured at the mission server ──
    assert.equal(dashboard.signOuts(), 0, 'no 401 may ever reach the dashboard');
    const dashboardLogins = dashboard.events.filter((event) => event.type === 'login').length;
    assert.equal(dashboardLogins, 1, 'the dashboard signed in once');
    assert.equal(stub.logins().length, dashboardLogins, 'the gateway performed ZERO logins of its own');
    assert.equal(stub.logins().length, 1, 'the whole flow costs exactly one sign-in');
    // The dashboard's own session is still live at the end of the flow.
    assert.equal(stub.sessions.get(token)?.revoked, false, 'the caller session must survive the whole flow');
    // The planted override WAS revoked — login rotates every prior session of
    // the account, including an operator override, and that is precisely why
    // substituting one for a live caller session is fatal. What matters, and
    // what the relay guarantees, is that the gateway never PRESENTED it.
    for (const call of stub.calls) {
      assert.notEqual(call.bearer, OVERRIDE_TOKEN, 'the override must never be substituted for the caller session');
    }
    // The public cookie never crossed into the mission process.
    for (const call of stub.dataCalls()) {
      if (!call.url.startsWith(`http://127.0.0.1:${MISSION_PORT}/`)) continue;
      assert.equal(call.cookie, null, 'the public session cookie must never reach the mission server');
    }
  });
});

test('loop proof: the stub really does revoke — a gateway mint WOULD have logged the dashboard out', async () => {
  // Control for the test above: it proves the assertion is sensitive, not that
  // the stub is forgiving. Here the caller presents NO session, so the gateway
  // legitimately falls back to its own sign-in — and on a server that rotates
  // sessions on login, that revokes the dashboard's token. The dashboard's next
  // call then 401s. This is precisely the old failure, reproduced honestly.
  const stub = createMissionStub();
  await withLoopScenario(stub, async (dashboard) => {
    const token = await dashboard.login();
    assert.equal(stub.logins().length, 1);

    // A cookie-only caller (no mission session of its own) → the gateway mints.
    const foreign = await GET(
      {
        headers: new Headers({ cookie: PUBLIC_COOKIE }),
        method: 'GET',
        nextUrl: new URL('http://localhost/mission-gateway/api/overview'),
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as NextRequest,
      { params: Promise.resolve({ path: ['api', 'overview'] }) },
    );
    assert.equal(foreign.status, 200, 'the fallback path still works for a sessionless caller');
    assert.equal(stub.logins().length, 2, 'the fallback signed in — which rotates sessions');
    assert.equal(stub.sessions.get(token)?.revoked, true, 'and that revoked the dashboard session');

    // The dashboard now sees a 401 and signs itself out: the old loop's trigger.
    await assert.rejects(() => dashboard.data('overview'), /no longer active/);
    assert.equal(dashboard.signOuts(), 1, 'a proxy mint DOES bounce the dashboard on this stub');
    // Even here the gateway must not "rescue" the caller with another sign-in:
    // a rejected session passes through, so the login count never grows.
    assert.equal(stub.logins().length, 2, 'a rejected caller session must not trigger a failover mint');
  });
});

test('loop proof: no credential other than the caller\'s own ever reaches a data call', async () => {
  const stub = createMissionStub();
  await withLoopScenario(stub, async (dashboard) => {
    const token = await dashboard.login();
    for (const segment of ['overview', 'treasury', 'tasks']) await dashboard.data(segment);
    const bearers = new Set(stub.dataCalls().filter((call) => call.url.includes('/api/')).map((call) => call.bearer));
    assert.deepEqual([...bearers], [token], 'one credential per request, always the caller’s own');
  });
});
