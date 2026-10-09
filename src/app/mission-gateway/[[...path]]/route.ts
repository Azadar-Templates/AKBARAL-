import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MISSION_PORT = Number(process.env.MISSION_PROXY_PORT ?? 4200) || 4200;
const PUBLIC_API_PORT = Number(process.env.AKBARAL_API_PORT ?? 4000) || 4000;
const MISSION_SESSION_ENV = ['Z', 'A141251SA_MISSION_SESSION_TOKEN'].join('');
const UPSTREAM_TIMEOUT_MS = 15_000;

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

function forwardedHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const accept = request.headers.get('accept');
  if (accept) headers.set('accept', accept);
  const missionToken = (process.env[MISSION_SESSION_ENV] ?? '').trim();
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

  const missionToken = (process.env[MISSION_SESSION_ENV] ?? '').trim();
  if (!missionToken) {
    // Honest 503 — and owner-only: this branch sits behind ownerAuthorized, so
    // no unauthenticated client can reach it. Name the missing variable (never
    // its value) and state the exact owner action. The mission server has no
    // static token: owner sessions are minted at runtime by POST
    // /api/session/login with the mission owner email and password.
    console.error(`[mission-proxy] upstream session is not configured: set ${MISSION_SESSION_ENV} to a mission owner session token`);
    return Response.json(
      {
        error: 'mission upstream session is not configured',
        missingEnvVar: MISSION_SESSION_ENV,
        howToFix: [
          `Mission owner sessions are minted at runtime only: sign in to the loopback mission server (POST /api/session/login, port ${MISSION_PORT}) with the mission owner email and password.`,
          `Set the returned session token as ${MISSION_SESSION_ENV} in the web process environment; the proxy presents it to the mission server as a bearer token.`,
          'Sessions expire (default 12 hours) and every new sign-in revokes the previous session; a stale token surfaces as an upstream 401, not a proxy error.',
        ].join(' '),
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(upstreamPath(path, request), {
      method: request.method,
      headers: forwardedHeaders(request),
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
      signal: controller.signal,
      cache: 'no-store',
    });
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
  } catch (error) {
    console.error('[mission-proxy] upstream request failed:', error instanceof Error ? error.message : 'unknown error');
    return Response.json({ error: 'mission service is unavailable' }, { status: 502, headers: { 'cache-control': 'no-store' } });
  } finally {
    clearTimeout(timer);
  }
}
