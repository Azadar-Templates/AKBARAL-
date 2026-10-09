import { NextRequest } from 'next/server';
import {
  MISSION_PORT,
  UPSTREAM_TIMEOUT_MS,
  invalidateMissionSessionToken,
  missionSessionEnvNames,
  missionSessionToken,
  ownerCredentialsConfigured,
} from '../mission-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PUBLIC_API_PORT = Number(process.env.AKBARAL_API_PORT ?? 4000) || 4000;

/** The existing public API is the authentication authority; its owner router
 * already runs requireAuth + requireRole('owner','super_admin'). The proxy only
 * asks that internal API whether this request is allowed, then strips the public
 * credentials before calling the mission process. */
async function ownerAuthorized(request: NextRequest): Promise<{ ok: true } | { ok: false; status: 401 | 403 }> {
  const headers = new Headers();
  const authorization = request.headers.get('authorization');
  const cookie = request.headers.get('cookie');
  if (authorization) headers.set('authorization', authorization);
  if (cookie) headers.set('cookie', cookie);
  if (!authorization && !cookie) return { ok: false, status: 401 };
  try {
    const response = await fetch(`http://127.0.0.1:${PUBLIC_API_PORT}/api/owner/dashboard`, { headers, cache: 'no-store' });
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

function forwardedHeaders(request: NextRequest, missionToken: string): Headers {
  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const accept = request.headers.get('accept');
  if (accept) headers.set('accept', accept);
  headers.set('authorization', `Bearer ${missionToken}`);
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

  const session = await missionSessionToken();
  if (!session) return missionSessionUnavailable();

  let upstream = await fetchMission(request, path, body, session.token);
  if ((upstream.status === 401 || upstream.status === 403) && session.source === 'auto') {
    // The cached session was rejected (expired or revoked): drop it, sign in
    // once more and retry the request exactly once. Never loop. An explicit
    // operator override is never silently replaced by an automatic sign-in.
    invalidateMissionSessionToken();
    const fresh = await missionSessionToken();
    if (!fresh) return missionSessionUnavailable();
    if (fresh.token !== session.token) upstream = await fetchMission(request, path, body, fresh.token);
  }
  return relay(upstream);
}

async function fetchMission(request: NextRequest, path: string[], body: ArrayBuffer | undefined, missionToken: string): Promise<Response> {
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

/** Honest, owner-only 503 — reachable only behind ownerAuthorized. Names env
 * var NAMES only: never a password, a session token, or a raw upstream body
 * that could contain one. */
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
