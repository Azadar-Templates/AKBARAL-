// ─────────────────────────────────────────────────────────────────────────────
// ZA141251SA — provider reachability preflight
//
// Storing a valid API key is not the same as being able to use it. If the
// runtime cannot open a TLS connection to the provider, every chat call fails
// at dispatch and the owner is left guessing whether the key was wrong.
//
// This probe answers that one question honestly, before a key is ever entered:
//   can THIS process reach the Gemini endpoint at all?
//
// It is unauthenticated by construction — no credential is loaded, decrypted or
// sent. Any HTTP status (including 401/403) proves the network path works; a
// transport error means the path is blocked and chat cannot work here no matter
// what key is supplied.
// ─────────────────────────────────────────────────────────────────────────────

import { CHAT_MODEL } from './chat-state';

export const GEMINI_HOST = 'generativelanguage.googleapis.com';
/** Model listing: the cheapest endpoint that proves the path, and it needs no body. */
export const GEMINI_PROBE_URL = `https://${GEMINI_HOST}/v1beta/models`;

export type ReachabilityStatus = 'REACHABLE' | 'RUNTIME BLOCKED' | 'UNKNOWN';

export interface ProviderReachability {
  provider: 'google';
  endpoint: string;
  model: string;
  reachable: boolean;
  status: ReachabilityStatus;
  /** Exact, owner-readable reason — the transport error code when blocked. */
  detail: string;
  httpStatus: number | null;
  latencyMs: number | null;
  checkedAt: string;
  /** True when the answer came from the short-lived cache rather than a new probe. */
  cached: boolean;
}

interface CacheEntry {
  value: ProviderReachability;
  expiresAt: number;
}

let cache: CacheEntry | null = null;
const CACHE_MS = 60_000;

function errorDetail(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  // A timeout/abort is its own story and must not be mislabelled as a reset.
  // (DOMException carries a numeric legacy `code`, so check this first.)
  if (/abort|timeout/i.test(`${name} ${message}`)) return `timed out reaching ${GEMINI_HOST}; the network path is blocked or extremely slow.`;
  const cause = (error as { cause?: { code?: unknown } } | undefined)?.cause;
  const raw = cause?.code ?? (error as { code?: unknown } | undefined)?.code;
  const code = typeof raw === 'string' && /^[A-Z][A-Z0-9_]{2,}$/.test(raw) ? raw : null;
  if (code) return `${code} — the connection to ${GEMINI_HOST} was refused or reset by the network, not by Google.`;
  return `${message} — no HTTP response was received from ${GEMINI_HOST}.`;
}

/**
 * Probe the provider endpoint without any credential.
 *
 * @param options.transport injectable for tests; defaults to global fetch.
 * @param options.force skip the cache.
 */
export async function checkProviderReachability(
  options: { transport?: typeof fetch; timeoutMs?: number; force?: boolean } = {},
): Promise<ProviderReachability> {
  const now = Date.now();
  if (!options.force && cache && cache.expiresAt > now) return { ...cache.value, cached: true };

  const transport = options.transport ?? fetch;
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 8000, 1000), 20000);
  const started = Date.now();
  let value: ProviderReachability;
  try {
    const response = await transport(GEMINI_PROBE_URL, {
      method: 'GET',
      redirect: 'error',
      // No credential of any kind: this proves the path, never the key.
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    value = {
      provider: 'google',
      endpoint: GEMINI_PROBE_URL,
      model: CHAT_MODEL,
      reachable: true,
      status: 'REACHABLE',
      detail: `${GEMINI_HOST} answered with HTTP ${response.status} to an unauthenticated request, so the network path is open.`,
      httpStatus: response.status,
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
      cached: false,
    };
  } catch (error) {
    value = {
      provider: 'google',
      endpoint: GEMINI_PROBE_URL,
      model: CHAT_MODEL,
      reachable: false,
      status: 'RUNTIME BLOCKED',
      detail: errorDetail(error),
      httpStatus: null,
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
      cached: false,
    };
  }
  cache = { value, expiresAt: Date.now() + CACHE_MS };
  return value;
}

/** Test seam: drop the cached verdict. */
export function resetProviderReachabilityCache(): void {
  cache = null;
}

/**
 * One sentence for the dashboard, stating what a stored key can and cannot do
 * in this runtime. Never claims chat works.
 */
export function reachabilityNote(reachability: ProviderReachability): string {
  return reachability.reachable
    ? `This server can reach ${GEMINI_HOST}. A stored free-tier key can be used for a real reply.`
    : `RUNTIME BLOCKED: this server cannot reach ${GEMINI_HOST} (${reachability.detail}) A key entered here is still stored encrypted, but no reply can be generated until outbound network access to the provider exists. This is an infrastructure limit, not a wrong key.`;
}
