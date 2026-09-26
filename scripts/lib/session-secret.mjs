import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/**
 * Shared SESSION_SECRET resolution for every start path.
 *
 * Historically this lived only in `scripts/start-prod.mjs`. `npm run dev`
 * (scripts/start-dev.mjs) had no equivalent, so `src/config/env.ts`
 * generated a brand-new random secret in-process on every development
 * restart — which silently invalidated every previously issued access and
 * refresh token. That is the exact class of bug that was reported as
 * "fixed" for production while development still reproduced it.
 *
 * Precedence (identical in dev and prod):
 *   1. an explicitly configured SESSION_SECRET wins (authoritative)
 *   2. a previously persisted secret at <DATA_DIR>/.session-secret is reused
 *   3. otherwise a 48-byte random secret is generated and persisted (0600)
 *
 * The secret value is never logged — only its provenance.
 */
export const SESSION_SECRET_PLACEHOLDERS = new Set([
  'change-me-in-production',
  'replace-with-a-long-random-secret',
  'changeme',
  'secret',
]);

export function resolveSessionSecretFilePath() {
  if (process.env.AKBARAL_SESSION_SECRET_FILE) {
    return path.resolve(process.env.AKBARAL_SESSION_SECRET_FILE);
  }
  const dataDir = process.env.DATA_DIR || (process.env.NODE_ENV === 'production' ? '/data' : 'data');
  return path.resolve(dataDir, '.session-secret');
}

/**
 * @param {(message: string) => void} log
 * @returns {{ value: string, source: 'explicit'|'persisted'|'generated'|'generated-unpersisted', secretFile: string }}
 */
export function ensureSessionSecret(log = () => {}) {
  const secretFile = resolveSessionSecretFilePath();
  const explicit = String(process.env.SESSION_SECRET ?? '').trim();
  if (explicit && !SESSION_SECRET_PLACEHOLDERS.has(explicit.toLowerCase())) {
    log('SESSION_SECRET is explicitly configured — using it as-is (authoritative).');
    return { value: explicit, source: 'explicit', secretFile };
  }

  try {
    if (existsSync(secretFile)) {
      const persisted = readFileSync(secretFile, 'utf8').trim();
      if (persisted.length >= 32) {
        log(`SESSION_SECRET not set — reusing the previously generated secret persisted at ${secretFile}.`);
        return { value: persisted, source: 'persisted', secretFile };
      }
      log(`persisted secret at ${secretFile} is invalid (too short) — generating a new one.`);
    }
  } catch (error) {
    log(`could not read the persisted session secret (${error instanceof Error ? error.message : String(error)}); generating a new one.`);
  }

  const generated = randomBytes(48).toString('base64url');
  try {
    mkdirSync(path.dirname(secretFile), { recursive: true });
    writeFileSync(secretFile, `${generated}\n`, { mode: 0o600 });
    chmodSync(secretFile, 0o600);
    log(`SESSION_SECRET not set — generated a new random secret and persisted it to ${secretFile} (mode 0600). The value is never logged.`);
    return { value: generated, source: 'generated', secretFile };
  } catch (error) {
    log(
      `SESSION_SECRET not set — generated a random secret for this process, but could not persist it ` +
        `(${error instanceof Error ? error.message : String(error)}). Sessions will not survive a restart ` +
        'until SESSION_SECRET is configured explicitly or a writable volume is available. The value is never logged.',
    );
    return { value: generated, source: 'generated-unpersisted', secretFile };
  }
}
