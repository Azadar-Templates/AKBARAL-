import { NextRequest } from 'next/server';
import {
  MISSION_PORT,
  UPSTREAM_TIMEOUT_MS,
  invalidateMissionSessionToken,
  missionSessionEnvNames,
  missionSessionToken,
  missionSessionTokenAuto,
  noteOverrideRejected,
  ownerCredentialsConfigured,
} from '../mission-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PUBLIC_API_PORT = Number(process.env.AKBARAL_API_PORT ?? 4000) || 4000;

/**
 * Mission session tokens are 43-character base64url values
 * (src/mission/auth.ts:141 `randomBytes(32).toString('base64url')`). Anything
 * longer than this generous cap is not a mission session, so it is treated as
 * absent rather than relayed to the mission server as a credential.
 */
const MAX_RELAYED_TOKEN_LENGTH = 512;

// ─────────────────────────────────────────────────────────────────────────────
// Which credential a request is answered with.
//
// A caller that already holds a mission session (the private dashboard keeps
// one in sessionStorage and resends it on every call —
// mission-dashboard/app.js:109) is RELAYED, never substituted. That is the
// whole point of this file: every mission sign-in rotates — and therefore
// revokes — the account's previous sessions
// (src/mission/auth.ts:144-146, inside login()'s transaction), and
// resolveSession only accepts `revoked_at IS NULL`
// (src/mission/auth.ts:177-181). So a proxy-minted token and the dashboard's
// own token revoke EACH OTHER: dashboard login kills the cached mint, the
// gateway's re-mint kills the dashboard, and the dashboard's next 401 calls
// signOut() (app.js:120) — a loop the owner cannot escape.
//
// Precedence for a path that needs a mission session, decided ONCE per request:
//   1. the caller's own usable `Authorization: Bearer <token>` — used verbatim;
//   2. the operator override (the mission session token env var — its name is
//      built dynamically in ../mission-session and is never spelled
//      literally in public runtime source), tried first and exactly once,
//      and never substituted for 1;
//   3. automatic sign-in with the mission owner credentials (the fallback for a
//      sessionless caller, e.g. a scripted owner on a cookie-only request).
// A path the mission server answers without a session (shell, assets, sign-in,
// sign-out) gets NO credential at all and never reaches 2 or 3, so an ordinary
// page load cannot mint — and therefore cannot revoke — anything.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The caller's own mission bearer token, or null when the request carries no
 * credential this gateway can faithfully relay.
 *
 * Deliberately syntactic and strict: `Basic …`, a bare `Bearer`, a repeated /
 * multi-value `authorization` header (Headers.get joins those with ", ", which
 * would otherwise smuggle a second credential upstream), and implausibly long
 * values all read as "no caller session" and fall back to the documented
 * precedence. The mission server's own parser is the exact contract mirrored
 * here (src/mission/server.ts:359-363: `startsWith('Bearer ')` then trim).
 */
function callerBearerToken(headers: Headers): string | null {
  const header = headers.get('authorization');
  if (!header) return null;
  const value = header.trim();
  if (value.includes(',')) return null;
  if (!value.startsWith('Bearer ')) return null;
  const token = value.slice('Bearer '.length).trim();
  if (!token) return null;
  if (/\s/.test(token)) return null;
  if (token.length > MAX_RELAYED_TOKEN_LENGTH) return null;
  return token;
}

/**
 * Paths the mission process answers for itself, with no session consulted:
 * everything outside /api/ is read straight off disk by serveStatic
 * (src/mission/server.ts:3152, 470-489 — the dashboard shell at `/` and its
 * assets), and `POST /api/session/login` / `POST /api/session/logout` are
 * handled before any session is required (src/mission/server.ts:1528-1544).
 * `/api/session/me` is NOT in this set: it calls requireOwner
 * (src/mission/server.ts:1545-1546) and needs the caller's session.
 *
 * These paths must be forwarded CREDENTIAL-FREE. Answering them with a minted
 * session would mean signing in on every page load, and each sign-in revokes
 * the owner's previously issued sessions — including the one the dashboard is
 * signing with.
 */
function isSessionlessMissionPath(path: string[]): boolean {
  if (path.length === 0) return true;
  if (path.every((part) => part === '')) return true;
  if (path[0] !== 'api') return true;
  return path.length === 3 && path[1] === 'session' && (path[2] === 'login' || path[2] === 'logout');
}

/**
 * The existing public API is the authentication authority; its owner router
 * already runs requireAuth + requireRole('owner','super_admin'). The proxy only
 * asks that internal API whether this request is allowed, then strips the public
 * credentials before calling the mission process.
 *
 * The check is presented the PUBLIC SESSION COOKIE AND NOTHING ELSE. That is
 * load-bearing, not an oversight: the public middleware reads the bearer BEFORE
 * the cookie (src/server/middleware/auth.ts:22-25), so presenting a mission
 * session token here — which is not a public JWT — made the owner check answer
 * 401 even for an owner with a perfectly valid public cookie, and the dashboard
 * reacted to that 401 by signing out (mission-dashboard/app.js:120). A caller
 * with a bearer but no public cookie is therefore unauthenticated *for the
 * public check* and is refused before anything is forwarded — so an
 * un-verifiable bearer can never be replayed upstream either.
 */
async function ownerAuthorized(request: NextRequest): Promise<{ ok: true } | { ok: false; status: 401 | 403 }> {
  const cookie = request.headers.get('cookie');
  if (!cookie) return { ok: false, status: 401 };
  try {
    const response = await fetch(`http://127.0.0.1:${PUBLIC_API_PORT}/api/owner/dashboard`, {
      headers: new Headers({ cookie }),
      cache: 'no-store',
    });
    if (response.status === 401) return { ok: false, status: 401 };
    if (response.status === 403) return { ok: false, status: 403 };
    return response.ok ? { ok: true } : { ok: false, status: 401 };
  } catch {
    return { ok: false, status: 401 };
  }
}

function refusal(status: 401 | 403) {
  return Response.json({ error: status === 401 ? 'authentication required' : 'insufficient permissions' }, { status, headers: { 'cache-control': 'no-store' } });
}

function upstreamPath(path: string[], request: NextRequest): string {
  const suffix = path.map((part) => encodeURIComponent(part)).join('/');
  const query = request.nextUrl.search;
  return `http://127.0.0.1:${MISSION_PORT}/${suffix}${query}`;
}

/**
 * The single credential-bearing header set for the loopback mission call.
 * Only content-type, accept and (optionally) one bearer leave this process —
 * never the public cookie, and never the caller's raw authorization header
 * passed through untouched. `missionToken === null` means "send no
 * credential", which is what sessionless paths require.
 */
function forwardedHeaders(request: NextRequest, missionToken: string | null): Headers {
  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const accept = request.headers.get('accept');
  if (accept) headers.set('accept', accept);
  if (missionToken) headers.set('authorization', `Bearer ${missionToken}`);
  return headers;
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, (await context.params).path ?? []);
}
export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, (await context.params).path ?? []);
}
export async function PUT(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, (await context.params).path ?? []);
}
export async function PATCH(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, (await context.params).path ?? []);
}
export async function DELETE(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, (await context.params).path ?? []);
}

async function proxy(request: NextRequest, path: string[]): Promise<Response> {
  const auth = await ownerAuthorized(request);
  if (!auth.ok) return refusal(auth.status);

  // Read the request body once so a single authenticated retry can replay it.
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();

  // The caller's session is decided here, once, and only for paths that need a
  // session at all.
  if (isSessionlessMissionPath(path)) {
    // No credential, no override, no mint: the mission server answers this
    // itself, and any sign-in here would revoke the owner's live dashboard
    // session. The response is relayed unchanged.
    return relay(await fetchMission(request, path, body, null));
  }

  const callerToken = callerBearerToken(request.headers);
  if (callerToken) {
    // Relay, never substitute. The caller's own session answers for the
    // caller: a 401/403 from the mission server passes through EXACTLY as-is,
    // with no failover and no second attempt. Failing over to a proxy-minted
    // token here is what caused the loop — the failover login would revoke the
    // caller's session while the caller watched its own request bounce, and a
    // 403 (authenticated-but-forbidden) must never be answered with a
    // different credential at all.
    return relay(await fetchMission(request, path, body, callerToken));
  }

  const session = await missionSessionToken();
  if (!session) return missionSessionUnavailable();

  let upstream = await fetchMission(request, path, body, session.token);
  if (upstream.status === 401 && session.source === 'override') {
    // The override was rejected (expired, revoked, or never valid — every
    // mission sign-in, including the dashboard's own login, revokes older
    // sessions). Latch that value as dead so later requests skip it, drop any
    // cached automatic token (the same revocation event would have killed it
    // too), and fail over to a freshly minted automatic session — exactly
    // once, never looping. Passing the 401 through would bounce the owner to
    // a login screen that can never stick. A 403 is NOT failed over: 403 means
    // "authenticated but forbidden", and answering it with a different
    // credential of the same owner identity could silently escalate past an
    // intentionally read-only override.
    noteOverrideRejected(session.token);
    invalidateMissionSessionToken();
    const fresh = await missionSessionTokenAuto();
    if (!fresh) return ownerCredentialsConfigured() ? missionSessionUnavailable() : overrideDead();
    if (fresh.token !== session.token) upstream = await fetchMission(request, path, body, fresh.token);
  } else if ((upstream.status === 401 || upstream.status === 403) && session.source === 'auto') {
    // The cached session was rejected (expired or revoked): drop it, sign in
    // once more and retry the request exactly once. Never loop.
    invalidateMissionSessionToken();
    const fresh = await missionSessionToken();
    if (!fresh) return missionSessionUnavailable();
    if (fresh.token !== session.token) upstream = await fetchMission(request, path, body, fresh.token);
  }
  return relay(upstream);
}

async function fetchMission(request: NextRequest, path: string[], body: ArrayBuffer | undefined, missionToken: string | null): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(upstreamPath(path, request), {
      method: request.method,
      headers: forwardedHeaders(request, missionToken),
      body,
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (error) {
    console.error('[mission-proxy] upstream request failed:', error instanceof Error ? error.message : 'unknown error');
    return Response.json({ error: 'mission service is unavailable' }, { status: 502, headers: { 'cache-control': 'no-store' } });
  } finally {
    clearTimeout(timer);
  }
}

async function relay(upstream: Response): Promise<Response> {
  const responseHeaders = new Headers();
  const contentType = upstream.headers.get('content-type') ?? '';
  if (contentType) responseHeaders.set('content-type', contentType);
  responseHeaders.set('cache-control', 'no-store');
  // The private dashboard was authored at origin root. Rebase only its own
  // absolute asset/API URLs so browser requests stay inside /mission-gateway/*;
  // ordinary mission API/stream responses remain streamed unchanged.
  if (upstream.ok && (contentType.includes('text/html') || contentType.includes('javascript'))) {
    let text = await upstream.text();
    if (contentType.includes('text/html')) text = text.replace(/(src|href)="\/(app|styles|manifest\.webmanifest)/g, '$1="/mission-gateway/$2');
    if (contentType.includes('javascript')) text = text.replace("register('/service-worker.js')", "register('/mission-gateway/service-worker.js')").replace('fetch(`/api${path}`', 'fetch(`/mission-gateway/api${path}`');
    return new Response(text, { status: upstream.status, headers: responseHeaders });
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

/** Honest, owner-only 503 for a dead override with no credentials to fail
 * over with. Names the env var NAME only. A bare 401 here would trap the owner
 * in a dashboard login loop that cannot succeed (the mission login itself
 * would pass, then every data call would 401 again), so the misconfiguration
 * is named directly instead. Only reachable for a caller with no session of
 * its own — a caller that presented a bearer is never substituted. */
function overrideDead(): Response {
  const names = missionSessionEnvNames();
  console.error(`[mission-proxy] mission session override rejected: ${names.override} is expired or revoked, and no owner credentials are configured to fail over with`);
  return Response.json(
    {
      error: 'mission upstream session override is no longer valid',
      invalidEnvVars: [names.override],
      howToFix: [
        `The ${names.override} token was rejected by the mission server (sessions expire, and every mission sign-in — including the dashboard's own login — revokes older sessions).`,
        `Preferred: unset it and set ${names.ownerEmail} and ${names.ownerPassword} (the mission owner credentials) so the proxy signs in to the loopback mission server on demand.`,
        `Alternative: set ${names.override} to a freshly minted mission owner session token; the proxy tries a new override value first without a restart.`,
      ].join(' '),
    },
    { status: 503, headers: { 'cache-control': 'no-store' } },
  );
}

/** Honest, owner-only 503 — reachable only behind ownerAuthorized, and only
 * when the caller presented no mission session of its own. Names env var
 * NAMES only: never a password, a session token, or a raw upstream body that
 * could contain one. */
function missionSessionUnavailable(): Response {
  const names = missionSessionEnvNames();
  const howToFix = [
    `Preferred: set ${names.ownerEmail} and ${names.ownerPassword} (the mission owner credentials) in the web process environment — the proxy then signs in to the loopback mission server (POST /api/session/login on 127.0.0.1:${MISSION_PORT}) on demand and keeps the session in memory only.`,
    `Alternative: set ${names.override} to a mission owner session token as a manual override (sessions expire, and every mission sign-in revokes older sessions).`,
    'Verify the mission owner account exists (npm run mission:init) and that the mission server is listening on the loopback port.',
  ].join(' ');
  if (!ownerCredentialsConfigured()) {
    const missingEnvVars: string[] = [];
    if (!(process.env[names.ownerEmail] ?? '').trim()) missingEnvVars.push(names.ownerEmail);
    if (!(process.env[names.ownerPassword] ?? '')) missingEnvVars.push(names.ownerPassword);
    console.error(`[mission-proxy] mission session is not configured: set ${names.ownerEmail} and ${names.ownerPassword}, or ${names.override}`);
    return Response.json({ error: 'mission upstream session is not configured', missingEnvVars, howToFix }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  console.error(`[mission-proxy] mission sign-in failed: the configured ${names.ownerEmail} / ${names.ownerPassword} credentials were rejected, or the mission server is unreachable`);
  return Response.json(
    { error: 'mission upstream sign-in failed', invalidEnvVars: [names.ownerEmail, names.ownerPassword], howToFix },
    { status: 503, headers: { 'cache-control': 'no-store' } },
  );
}
