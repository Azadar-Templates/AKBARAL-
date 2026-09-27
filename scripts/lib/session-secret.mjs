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
  return resolveSessionSecretFileCandidates()[0];
}

/**
 * Every location the secret may live in, most authoritative first.
 *
 * Production defaults to `/data/.session-secret` because that is the mounted
 * volume in the Docker/compose deployment. Free container hosts (no attachable
 * volume) have no writable `/data`, and the previous single-path behaviour
 * silently degraded to "generated, not persisted" — meaning every container
 * restart invalidated every issued session. Falling back to the configured
 * DATA_DIR (and then to the application directory) keeps sessions alive across
 * restarts on those hosts whenever ANY writable location exists, and the caller
 * still logs exactly which one was used.
 *
 * @returns {string[]}
 */
export function resolveSessionSecretFileCandidates() {
  const candidates = [];
  const add = (dir) => {
    if (!dir) return;
    const resolved = path.resolve(dir, '.session-secret');
    if (!candidates.includes(resolved)) candidates.push(resolved);
  };
  if (process.env.AKBARAL_SESSION_SECRET_FILE) {
    const explicit = path.resolve(process.env.AKBARAL_SESSION_SECRET_FILE);
    candidates.push(explicit);
    return candidates;
  }
  if (process.env.DATA_DIR) add(process.env.DATA_DIR);
  else if (process.env.NODE_ENV === 'production') add('/data');
  add(process.env.NODE_ENV === 'production' ? '/data' : 'data');
  add('data');
  return candidates;
}

/**
 * @param {(message: string) => void} log
 * @returns {{ value: string, source: 'explicit'|'persisted'|'generated'|'generated-unpersisted', secretFile: string }}
 */
export function ensureSessionSecret(log = () => {}) {
  const candidates = resolveSessionSecretFileCandidates();
  const secretFile = candidates[0];
  const explicit = String(process.env.SESSION_SECRET ?? '').trim();
  if (explicit && !SESSION_SECRET_PLACEHOLDERS.has(explicit.toLowerCase())) {
    log('SESSION_SECRET is explicitly configured — using it as-is (authoritative).');
    return { value: explicit, source: 'explicit', secretFile };
  }

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        const persisted = readFileSync(candidate, 'utf8').trim();
        if (persisted.length >= 32) {
          log(`SESSION_SECRET not set — reusing the previously generated secret persisted at ${candidate}.`);
          return { value: persisted, source: 'persisted', secretFile: candidate };
        }
        log(`persisted secret at ${candidate} is invalid (too short) — generating a new one.`);
      }
    } catch (error) {
      log(`could not read the persisted session secret at ${candidate} (${error instanceof Error ? error.message : String(error)}).`);
    }
  }

  const generated = randomBytes(48).toString('base64url');
  const failures = [];
  for (const candidate of candidates) {
    try {
      mkdirSync(path.dirname(candidate), { recursive: true });
      writeFileSync(candidate, `${generated}\n`, { mode: 0o600 });
      chmodSync(candidate, 0o600);
      log(`SESSION_SECRET not set — generated a new random secret and persisted it to ${candidate} (mode 0600). The value is never logged.`);
      return { value: generated, source: 'generated', secretFile: candidate };
    } catch (error) {
      failures.push(`${candidate} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  log(
    `SESSION_SECRET not set — generated a random secret for this process, but no location was writable: ` +
      `${failures.join('; ')}. Sessions will not survive a restart ` +
      'until SESSION_SECRET is configured explicitly or a writable volume is available. The value is never logged.',
  );
  return { value: generated, source: 'generated-unpersisted', secretFile };
}
