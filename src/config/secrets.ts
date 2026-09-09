/**
 * Secret redaction/safe-error helpers.
 *
 * Every value considered sensitive is loaded here so a single mask can be
 * applied to error messages, logs and any future diagnostic output. The mask
 * only substitutes literal values; it never reveals the configured value.
 */

import { env } from './env';

export const SECRET_MASK = '[REDACTED]';

const SENSITIVE_KEY_PATTERN =
  /(_?SECRET(_KEY)?$|_?PASSWORD$|_?PRIVATE_KEY$|_?ACCESS_TOKEN$|_?AUTH_TOKEN$|_?BEARER_TOKEN$|_?API_KEY$|_?KEY_ID$|_?ACCOUNT_SID$|_?CLIENT_SECRET$|_?WEBHOOK_SECRET$|RSA_PRIVATE_KEY)/i;

export interface SecretEnvReference {
  key: string;
  value: string;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key) || key === 'SESSION_SECRET' || key === 'BILLING_WEBHOOK_SECRET';
}

function collectSensitiveValues(): SecretEnvReference[] {
  const values: SecretEnvReference[] = [];
  for (const key of Object.keys(process.env)) {
    if (!isSensitiveKey(key)) {
      continue;
    }
    const value = (process.env[key] ?? '').trim();
    if (value.length >= 4) {
      values.push({ key, value });
    }
  }
  // Always include the runtime session secret even if it was auto-generated in
  // development so a stray log/error cannot expose it.
  if (env.sessionSecret && env.sessionSecret.length >= 4) {
    values.push({ key: 'SESSION_SECRET', value: env.sessionSecret });
  }
  return values;
}

const sensitiveValues = collectSensitiveValues();

export function redactSecrets(input: unknown): string {
  const original = typeof input === 'string' ? input : `${String(input)}`;
  let output = original;
  for (const item of sensitiveValues) {
    if (item.value.length >= 4 && output.includes(item.value)) {
      // Replace most-specific (longest) values first to avoid partial masks.
      output = output.split(item.value).join(SECRET_MASK);
    }
  }
  // Also mask common credential transport spellings defensively.
  output = output.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${SECRET_MASK}`);
  output = output.replace(/([?&](?:key|token|access_token|auth|api_key)=)[^&\s]+/gi, `$1${SECRET_MASK}`);
  output = output.replace(/(sk-[A-Za-z0-9]{8,})/g, SECRET_MASK);
  output = output.replace(/(xox[baprs]-[A-Za-z0-9-]{8,})/g, SECRET_MASK);
  output = output.replace(/(gh[pousr]_[A-Za-z0-9]{8,})/g, SECRET_MASK);
  output = output.replace(/(AIza[0-9A-Za-z_-]{20,})/g, SECRET_MASK);
  return output;
}

export function isSensitiveEnvKey(key: string): boolean {
  return isSensitiveKey(key);
}

/**
 * Build a safe user-visible error message. Never include raw HTTP bodies from
 * third-party providers; they can echo request/session data and are not needed
 * for an honest failure.
 */
export function safeProviderErrorMessage(
  providerKey: string,
  status: number,
  _body: string,
): string {
  // Never echo raw provider bodies: they can contain error/request echoes and
  // are not needed for an honest failure diagnostic.
  return `${providerKey} returned HTTP ${status}; provider did not authorize the request`;
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return redactSecrets(error.message);
  }
  return redactSecrets(String(error));
}

export function logSafe(scope: string, payload: unknown): void {
  console.log(JSON.stringify({ level: 'info', ts: new Date().toISOString(), scope, detail: redactSecrets(payload) }));
}

export function logErrorSafe(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), scope, error: redactSecrets(message) }));
}
