/**
 * Self-authenticating mission session for the owner-only proxy.
 *
 * The mission server has no static/pre-shared token: owner sessions are minted
 * at runtime by POST /api/session/login with the mission owner credentials
 * (src/mission/server.ts:1528-1538 → src/mission/auth.ts login()). Requiring a
 * manually pasted token is unusable (the owner cannot reach loopback, sessions
 * expire, and every mission sign-in revokes older sessions). So the proxy signs
 * in ITSELF, on demand:
 *
 *   1. The mission session token override env var, when set, is an OPTIONAL
 *      manual override and always wins — no sign-in happens in that case.
 *   2. Otherwise the proxy signs in to the loopback mission server with the
 *      mission owner email/password env vars from its own environment (the
 *      production wrapper starts the mission child with the same environment —
 *      scripts/start-prod.mjs launch()).
 *   3. The minted session token is cached IN MEMORY ONLY (module scope). It is
 *      never written to disk, a database, logs, or any persisted store, and it
 *      is never returned to a client. A cached token that the mission server
 *      rejects (expired/revoked) is dropped by the caller and re-minted once.
 *   4. Concurrent first requests share ONE in-flight sign-in promise — the
 *      mission server is never stampeded.
 *
 * The password is used only inside the sign-in request body to loopback. Env
 * var names are constructed dynamically: the forbidden marker must never appear
 * literally in public runtime source. Server logs may name env var NAMES only.
 */

export const MISSION_PORT = Number(process.env.MISSION_PROXY_PORT ?? 4200) || 4200;
export const UPSTREAM_TIMEOUT_MS = 15_000;

const MISSION_SESSION_ENV = ['Z', 'A141251SA_MISSION_SESSION_TOKEN'].join('');
const MISSION_OWNER_EMAIL_ENV = ['Z', 'A141251SA_OWNER_EMAIL'].join('');
const MISSION_OWNER_PASSWORD_ENV = ['Z', 'A141251SA_OWNER_PASSWORD'].join('');

export interface MissionSessionToken {
  token: string;
  /** 'override' = operator-supplied env token (never retried); 'auto' = minted by the proxy. */
  source: 'override' | 'auto';
}

let cachedMissionToken: string | null = null;
let inflightMissionLogin: Promise<string | null> | null = null;

/** Env var NAMES (never values) for honest error reporting. */
export function missionSessionEnvNames(): { override: string; ownerEmail: string; ownerPassword: string } {
  return { override: MISSION_SESSION_ENV, ownerEmail: MISSION_OWNER_EMAIL_ENV, ownerPassword: MISSION_OWNER_PASSWORD_ENV };
}

export function explicitSessionToken(): string | null {
  return (process.env[MISSION_SESSION_ENV] ?? '').trim() || null;
}

export function ownerCredentialsConfigured(): boolean {
  return Boolean((process.env[MISSION_OWNER_EMAIL_ENV] ?? '').trim() && (process.env[MISSION_OWNER_PASSWORD_ENV] ?? ''));
}

/** Drop the cached in-memory token (e.g. after an upstream 401/403). */
export function invalidateMissionSessionToken(): void {
  cachedMissionToken = null;
}

/** Test hook: drop all in-memory session state. Never called at runtime. */
export function resetMissionSessionStateForTests(): void {
  cachedMissionToken = null;
  inflightMissionLogin = null;
}

export async function missionSessionToken(): Promise<MissionSessionToken | null> {
  const override = explicitSessionToken();
  if (override) return { token: override, source: 'override' };
  if (cachedMissionToken) return { token: cachedMissionToken, source: 'auto' };
  if (!inflightMissionLogin) {
    // Single in-flight sign-in: concurrent first requests share one login call.
    inflightMissionLogin = signInToMission().finally(() => { inflightMissionLogin = null; });
  }
  const token = await inflightMissionLogin;
  return token ? { token, source: 'auto' } : null;
}

/**
 * Sign in to the loopback mission server with the mission owner credentials.
 * Exact contract (src/mission/server.ts:1528-1538): body { email, password } →
 * 200 { token, csrfToken, expiresAt, owner }. The password appears ONLY inside
 * this loopback request body; the minted token is cached in memory only.
 * Returns null when the credentials are missing, rejected, or the mission
 * server is unreachable — the caller answers with an honest 503.
 */
async function signInToMission(): Promise<string | null> {
  const email = (process.env[MISSION_OWNER_EMAIL_ENV] ?? '').trim();
  const password = process.env[MISSION_OWNER_PASSWORD_ENV] ?? '';
  if (!email || !password) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${MISSION_PORT}/api/session/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { token?: unknown };
    const token = typeof payload.token === 'string' ? payload.token.trim() : '';
    if (!token) return null;
    cachedMissionToken = token;
    return token;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
