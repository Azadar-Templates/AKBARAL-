/**
 * Bounded retry with truncated exponential backoff + jitter.
 *
 * Google's Gemini API guidance for transient failures (HTTP 429 RESOURCE
 * EXHAUSTED, 500 INTERNAL, 502, 503 UNAVAILABLE, 504 DEADLINE_EXCEEDED) is to
 * retry the request with *truncated exponential backoff*: wait
 * `base * 2^(attempt-1)`, capped at a maximum delay, with random jitter so a
 * fleet of clients does not retransmit in lockstep and re-overload a
 * recovering backend.
 *
 * Deliberate properties:
 *   - BOUNDED. A hard attempt cap and a hard per-delay cap: a provider outage
 *     can never turn into an unbounded retry storm, and the caller's overall
 *     latency stays predictable (worst case ≈ maxAttempts × timeout + delays).
 *   - HONEST. When the budget is exhausted the ORIGINAL provider error is
 *     rethrown unchanged, so the failure surfaces as the real upstream status
 *     (e.g. "google returned HTTP 503") and the router can fall through to the
 *     next model/provider in the chain. Nothing is ever swallowed or faked.
 *   - NARROW. Only errors the caller classifies as retryable are retried;
 *     permanent failures (400/401/403/404, safety blocks) fail on attempt 1
 *     and never burn the budget.
 */

export interface RetryPolicy {
  /** Total attempts including the first one (>= 1). */
  maxAttempts: number;
  /** First backoff delay in ms; doubles each attempt. */
  baseDelayMs: number;
  /** Upper bound for a single backoff delay in ms (the "truncated" part). */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
};

function positiveInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return Math.min(parsed, max);
}

/**
 * Operator-tunable policy. Defaults are production-safe; the env overrides
 * exist so an operator can widen/narrow the budget (and so tests can run with
 * ~0ms delays) without a code change.
 */
export function resolveRetryPolicy(
  env: NodeJS.ProcessEnv = process.env,
): RetryPolicy {
  return {
    maxAttempts: positiveInt(
      env.AKBARAL_PROVIDER_MAX_ATTEMPTS,
      DEFAULT_RETRY_POLICY.maxAttempts,
      1,
      6,
    ),
    baseDelayMs: positiveInt(
      env.AKBARAL_PROVIDER_RETRY_BASE_MS,
      DEFAULT_RETRY_POLICY.baseDelayMs,
      0,
      30_000,
    ),
    maxDelayMs: positiveInt(
      env.AKBARAL_PROVIDER_RETRY_MAX_DELAY_MS,
      DEFAULT_RETRY_POLICY.maxDelayMs,
      0,
      60_000,
    ),
  };
}

/**
 * Delay before `attempt` (1 = the delay after the first failure).
 * Truncated exponential growth with jitter in [50%, 100%] of the window, so a
 * retry is never instantaneous (which would just hammer the provider) and
 * never longer than maxDelayMs.
 */
export function backoffDelayMs(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const window = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** Math.max(0, attempt - 1),
  );
  if (window <= 0) {
    return 0;
  }
  return Math.round(window * (0.5 + 0.5 * random()));
}

export interface RetryAttemptInfo {
  attempt: number;
  delayMs: number;
  error: unknown;
}

export interface WithRetriesOptions {
  /** Only errors this returns true for are retried. */
  isRetryable: (error: unknown) => boolean;
  policy?: RetryPolicy;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Server-side observability hook. Never used to surface anything to users. */
  onRetry?: (info: RetryAttemptInfo) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  ms <= 0
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `operation`, retrying transient failures with bounded backoff.
 * Rethrows the last real error once the budget is exhausted.
 */
export async function withRetries<T>(
  operation: (attempt: number) => Promise<T>,
  options: WithRetriesOptions,
): Promise<T> {
  const policy = options.policy ?? resolveRetryPolicy();
  const sleep = options.sleep ?? defaultSleep;
  const attempts = Math.max(1, policy.maxAttempts);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const canRetry = attempt < attempts && options.isRetryable(error);
      if (!canRetry) {
        throw error;
      }
      const delayMs = backoffDelayMs(attempt, policy, options.random);
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }

  throw lastError;
}
