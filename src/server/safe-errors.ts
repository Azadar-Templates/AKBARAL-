import { redactSecrets } from '../config/secrets';

/**
 * Production error boundary for everything a human can read in the product.
 *
 * AKBARAL! runs real infrastructure, and real infrastructure produces honest
 * but *internal* failure text: "No AI provider configured",
 * "GOOGLE_API_KEY is not set", SQLite/Postgres errors, stack frames, queue job
 * ids, agent slugs. Those are true and they belong in the server logs and the
 * audit trail — they must never reach a customer screen or the owner/admin
 * screens, because they describe how the deployment is wired.
 *
 * Rules enforced here:
 *   1. Nothing leaves this module except copy we wrote on purpose.
 *   2. No raw provider/runtime/database text is ever echoed, not even redacted.
 *   3. The failure is never dressed up as a success — the copy stays honest
 *      ("we couldn't complete this"), it just stops being a diagnostic.
 *
 * Raw detail keeps flowing to the places that are already server-side only:
 * the `*.error_message` columns, `logErrorSafe`, and the audit tables.
 */

/** The single generic, honest, non-technical failure line. */
export const SAFE_TASK_FAILURE_MESSAGE = "We couldn't complete this task right now. Please try again.";

/** The generic code reported when the real code is internal-only. */
export const SAFE_TASK_FAILURE_CODE = 'task_failed';

export interface PublicFailure {
  code: string;
  message: string;
}

/**
 * Customer-facing copy per failure class.
 *
 * Every provider failure mode collapses to the same neutral line on purpose:
 * telling a user (or an admin) *which* provider is unconfigured, rate limited
 * or rejecting credentials is a configuration diagnostic.
 */
const PUBLIC_COPY: Record<string, string> = {
  timed_out: 'This task took too long and was stopped. Your task credit was refunded — please try again.',
  cancelled: 'This task was cancelled. Your task credit was refunded.',
  verification_failed:
    "The result didn't pass our quality check, so it was not returned. Your task credit was refunded — please try again.",
  requires_pro: 'Your free tasks are used up. Upgrade your plan to keep running tasks.',
  emergency_stop: 'Task execution is paused right now. Please try again shortly.',
  rate_limited: 'Too many requests. Please slow down and try again.',
  paid_resource_required:
    'This task needs a paid resource that is not enabled on your account. Your task credit was refunded.',
};

/**
 * Internal failure codes that are real and useful in the logs but describe the
 * deployment's wiring. They collapse to the generic public code + copy: a user
 * — and an admin — learns that the task did not complete, never which provider
 * is unconfigured, rate limited or rejecting credentials.
 */
const INTERNAL_ONLY_CODES = new Set([
  'provider_not_configured',
  'provider_auth',
  'provider_rate_limited',
  'provider_outage',
  'provider_error',
  'provider_blocked',
  'internal_error',
  'execution_failed',
  'task_creation_failed',
  'parsing_failed',
  'tool_input_error',
  'tool_failed',
  'agent_not_found',
]);

/**
 * Codes whose message text is written by us for the person reading it
 * (input validation, permissions, missing records). Their text is still
 * screened by `looksInternal` before it is shown.
 */
const CALLER_SAFE_CODES = new Set([
  'validation_error',
  'forbidden',
  'unauthorized',
  'not_found',
  'conflict',
  'requires_pro',
  'insufficient_credits',
]);

/**
 * Signatures of text that describes the deployment rather than the outcome.
 * Matching text is never rendered, in the user UI or the admin UI.
 */
const INTERNAL_SIGNATURES: RegExp[] = [
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/, // ENV_VAR_STYLE names (GOOGLE_API_KEY, DATABASE_URL)
  /\bapi[_ -]?key\b/i,
  /\bsecret\b/i,
  /\btoken\b/i,
  /\bcredential/i,
  /\benv(?:ironment)?\s+variable\b/i,
  /\bprovider\b/i,
  /\bnot configured\b/i,
  /\bunconfigured\b/i,
  /\bstack\b/i,
  /\s+at\s+[\w$.<>]+\s+\(/, // stack frame
  /(?:^|\s)(?:\/[\w.-]+){2,}/, // absolute filesystem path
  /\b[\w-]+\.(?:ts|js|mjs|cjs|tsx|sql):\d+/, // source location
  /\b(?:sqlite|postgres|postgresql|psql|database|sql)\b/i,
  /\b(?:SELECT|INSERT|UPDATE|DELETE)\s+.*\b(?:FROM|INTO|SET)\b/i,
  /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|EPIPE)\b/,
  /\bHTTP\s*[45]\d\d\b/i,
  /\bstatus\s*(?:code)?\s*[:=]?\s*[45]\d\d\b/i,
  /\b(?:workflow|job|execution|run|agent|exe|task)_[A-Za-z0-9_-]{6,}\b/, // internal ids
  /\b(?:wf|exe|job|run|tsk|usr|log|mr)_[A-Za-z0-9-]{6,}\b/, // short internal id prefixes
  /\bslug\b/i, // internal agent slugs
  /\bnode_modules\b/,
  /\blocalhost\b|\b127\.0\.0\.1\b|\b0\.0\.0\.0\b/,
  /\bhttps?:\/\//i,
  /\bport\s+\d{2,5}\b/i,
  /\bundefined is not\b|\bcannot read propert/i,
  /\bTypeError\b|\bReferenceError\b|\bSyntaxError\b|\bError:\s/,
];

/** True when the text describes internals rather than the user's outcome. */
export function looksInternal(text: unknown): boolean {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return false;
  return INTERNAL_SIGNATURES.some((pattern) => pattern.test(value));
}

/**
 * Convert any failure into the pair that is safe to render in ANY UI
 * (customer workspace, user dashboard, owner/admin console).
 */
export function toPublicFailure(input: { code?: string | null; message?: string | null } | null | undefined): PublicFailure {
  const rawCode = typeof input?.code === 'string' ? input.code.trim() : '';
  const rawMessage = typeof input?.message === 'string' ? input.message.trim() : '';

  if (rawCode && INTERNAL_ONLY_CODES.has(rawCode)) {
    return { code: SAFE_TASK_FAILURE_CODE, message: SAFE_TASK_FAILURE_MESSAGE };
  }

  const copy = rawCode ? PUBLIC_COPY[rawCode] : undefined;
  if (copy) {
    return { code: rawCode, message: copy };
  }

  if (rawCode && CALLER_SAFE_CODES.has(rawCode) && rawMessage && !looksInternal(rawMessage)) {
    // Caller-authored, outcome-level text (e.g. "title is required").
    return { code: rawCode, message: redactSecrets(rawMessage) };
  }

  // Unknown code, or any message that smells like a diagnostic: fall back to
  // the single neutral line. The real text stays in the logs/audit trail.
  return { code: rawCode && !looksInternal(rawCode) ? rawCode : SAFE_TASK_FAILURE_CODE, message: SAFE_TASK_FAILURE_MESSAGE };
}

/**
 * Sanitize a stored `error_message` for display. Returns `null` when there is
 * nothing safe to say, so callers can omit the field entirely rather than
 * render an empty diagnostic.
 */
export function publicErrorMessage(message: unknown, code?: string | null): string | null {
  const value = typeof message === 'string' ? message.trim() : '';
  if (!value) return null;
  return toPublicFailure({ code: code ?? null, message: value }).message;
}

/**
 * Admin/owner variant. The owner console gets the same safe copy plus a
 * non-identifying marker that a technical detail exists and where to read it
 * (server-side diagnostics), never the detail itself.
 */
export function adminSafeErrorSummary(message: unknown): { message: string; hasTechnicalDetail: boolean } | null {
  const value = typeof message === 'string' ? message.trim() : '';
  if (!value) return null;
  const technical = looksInternal(value);
  return {
    message: technical ? SAFE_TASK_FAILURE_MESSAGE : redactSecrets(value),
    // Signals the console to show "details in server diagnostics" — the raw
    // text is only readable from the server (logs / audit tables).
    hasTechnicalDetail: technical,
  };
}

/**
 * Replace the raw `error_message` of a database row with the public copy.
 *
 * Used at every HTTP boundary that serializes rows carrying an operator
 * diagnostic (tasks, executions, workflows, workflow steps, automation runs).
 * The stored value is left untouched — only the serialized view is sanitized.
 */
export function withPublicErrorMessage<T>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  const record = row as Record<string, unknown>;
  if (!('error_message' in record)) return row;
  const code = typeof record.error_code === 'string' ? record.error_code : null;
  return { ...record, error_message: publicErrorMessage(record.error_message, code) } as T;
}

/** Shown in place of a log line that carries a technical detail. */
export const SAFE_LOG_REDACTED_MESSAGE = 'A technical detail was recorded in the server diagnostics.';

export interface PublicLogLine {
  message: string;
  data: unknown;
}

/** Keys whose value is deployment configuration, never shown in any UI. */
const INTERNAL_DATA_KEYS = new Set([
  'requiredcredential',
  'requiredenv',
  'env',
  'envkey',
  'provider',
  'providerkey',
  'apikey',
  'endpoint',
  'url',
  'stack',
  'cause',
  'raw',
  'error',
  'detail',
  'details',
  'sql',
  'query',
]);

function sanitizeLogData(value: unknown, depth = 0): unknown {
  if (depth > 4) return null;
  if (typeof value === 'string') return looksInternal(value) ? '[hidden]' : value;
  if (Array.isArray(value)) return value.map((item) => sanitizeLogData(item, depth + 1));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (INTERNAL_DATA_KEYS.has(key.toLowerCase())) continue;
      if (key.toLowerCase() === 'code') {
        output.code = toPublicFailure({ code: typeof item === 'string' ? item : null }).code;
        continue;
      }
      output[key] = sanitizeLogData(item, depth + 1);
    }
    return output;
  }
  return value ?? null;
}

/**
 * Sanitize one execution log line for display.
 *
 * Execution logs are the live console the workspace renders verbatim, so they
 * are a UI surface like any other. Agents and tools write honest but internal
 * text into them ("search endpoint … unreachable (fetch failed); configure …").
 * The stored row keeps that text for operators; the rendered line does not.
 */
export function publicLogLine(input: { message?: unknown; data?: unknown; level?: unknown }): PublicLogLine {
  const message = typeof input.message === 'string' ? input.message : '';
  const level = typeof input.level === 'string' ? input.level : 'info';
  let safeMessage = message;
  if (looksInternal(message)) {
    safeMessage = level === 'error' ? SAFE_TASK_FAILURE_MESSAGE : SAFE_LOG_REDACTED_MESSAGE;
  }
  return { message: safeMessage, data: sanitizeLogData(input.data ?? null) };
}
