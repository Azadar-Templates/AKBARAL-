import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/**
 * Production start for the AKBARAL platform.
 *
 * - Express API + SQLite + execution stream run on :4000.
 * - Next.js 16 App Router serves the premium AKBARAL homepage and SPA on :3000.
 * - `next.config.mjs` rewrites `/api/*` and `/uploads/*` to the API server, so
 *   the existing authentication, MASTER AI, agents, factory, marketplace,
 *   workspace, CRM, billing, feedback, admin and security routes stay real.
 *
 * StackHost startup fix (2026-09-17): a platform that builds and starts the
 * container in two separate steps can hand this script a runtime image that
 * never got a `SESSION_SECRET`, or — if the build step's output was not
 * carried over — no `dist/` or `.next/` at all. Both used to fail within a
 * couple of seconds with no useful diagnostics (a bare `MODULE_NOT_FOUND`
 * from `dist/src/db/migrate.js`, or the API refusing to boot with no
 * explanation visible before the container was killed). This script is now
 * the single place that: generates/persists a session secret when one is not
 * explicitly configured, runs migrations, verifies the build artifacts exist
 * (with a clear, actionable message and an optional self-heal), and only
 * then starts the tiers — so a failure always produces a log line that says
 * exactly what is missing and how to fix it.
 */
const children = [];

function log(message) {
  console.log(`[akbaral] ${message}`);
}

function fail(message) {
  console.error(`[akbaral] ${message}`);
  process.exit(1);
}

function launch(name, command, args, env) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: 'inherit' });
  child.name = name;
  children.push(child);
  return child;
}

/** Run a command to completion before continuing startup; exits on failure. */
function runStep(label, command, args) {
  log(`${label}…`);
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error) {
    fail(`${label} failed to start (${result.error.message}).`);
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    fail(`${label} exited with code ${result.status}. Check the log lines above for the cause.`);
  }
  if (result.signal) {
    fail(`${label} was terminated by signal ${result.signal}.`);
  }
}

function shutdown(signal = 'SIGTERM') {
  console.log(`[akbaral] start wrapper received ${signal}`);
  for (const child of children) {
    if (!child.killed) {
      try { child.kill(signal); } catch {}
    }
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// NODE_ENV=production on the API too: the development flag would relax the
// mandatory-SESSION_SECRET startup guard (production hardening, Milestone 10).
//
// AKBARAL_ROLES selects which tiers run in this container (deployment
// plumbing for hosts with small per-container memory limits, e.g. the
// Zeabur free plan):
//   both (default) — the normal single-container production stack (Modal etc.)
//   web            — only the Next.js tier (:3000); proxy /api,/uploads,/ws to
//                    another container via NEXT_BACKEND_URL (next.config.mjs)
//   api            — only the API/Express tier (:4000)
const ROLES = (process.env.AKBARAL_ROLES ?? 'both').toLowerCase();
if (!['both', 'web', 'api'].includes(ROLES)) {
  console.error(`[akbaral] invalid AKBARAL_ROLES "${ROLES}" (expected both|web|api)`);
  process.exit(1);
}

/* ------------------------------------------------------------------ ports
 * The PUBLIC entry point is the Next.js tier: it serves the app and rewrites
 * /api, /uploads and /ws to the API tier (next.config.mjs). So the public port
 * belongs to the web tier, and the API keeps an internal port.
 *
 * Platform hosts (StackHost, Render, Fly, …) inject the port they route
 * traffic to as PORT. Precedence, chosen so no existing deployment changes
 * behaviour:
 *   web — AKBARAL_WEB_PORT, else PORT when it does not collide with the API
 *         port, else 3000
 *   api — AKBARAL_API_PORT, else 4000
 * A PORT that equals the API port therefore keeps its historical meaning
 * (preview/panel scripts export PORT=<api port>) and the web tier stays on
 * 3000, while a platform-injected PORT on any other value moves the public
 * tier as the platform expects.
 */
const portOf = (value) => {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return parsed >= 1 && parsed <= 65535 ? parsed : null;
};
const apiPort = portOf(process.env.AKBARAL_API_PORT) ?? 4000;
const explicitWebPort = portOf(process.env.AKBARAL_WEB_PORT);
const platformPort = portOf(process.env.PORT);
const webPort = explicitWebPort ?? (platformPort !== null && platformPort !== apiPort ? platformPort : 3000);
for (const [name, value] of [['AKBARAL_WEB_PORT', process.env.AKBARAL_WEB_PORT], ['AKBARAL_API_PORT', process.env.AKBARAL_API_PORT], ['PORT', process.env.PORT]]) {
  if (String(value ?? '').trim() !== '' && portOf(value) === null) {
    console.error(`[akbaral] invalid ${name} "${value}" (expected an integer between 1 and 65535)`);
    process.exit(1);
  }
}

// Diagnostics (no side effects): report exactly which ports this process would
// bind, so hosts and operators can verify the contract instead of guessing.
// Exits non-zero for an invalid port, like the real start does.
if (process.argv.includes('--print-ports')) {
  console.log(JSON.stringify({ roles: ROLES, publicPort: webPort, webPort, apiPort }));
  process.exit(0);
}

/* ----------------------------------------------------- session secret
 * A platform that separates "build" from "start" (StackHost included) can
 * boot a container that never had SESSION_SECRET configured. Historically
 * that meant the API's mandatory-config guard rejected startup with no
 * further explanation. Now: an explicitly configured SESSION_SECRET always
 * wins (authoritative); otherwise a cryptographically random 48-byte secret
 * is generated once and persisted to disk (0600) so restarts of the same
 * volume keep the same signing key instead of invalidating every session on
 * every deploy. The value itself is never logged — only its provenance.
 */
const SESSION_SECRET_PLACEHOLDERS = new Set([
  'change-me-in-production',
  'replace-with-a-long-random-secret',
  'changeme',
  'secret',
]);

function resolveSessionSecretFilePath() {
  return process.env.AKBARAL_SESSION_SECRET_FILE
    ? path.resolve(process.env.AKBARAL_SESSION_SECRET_FILE)
    : path.resolve(process.cwd(), 'data', '.session-secret');
}

function ensureSessionSecret() {
  const explicit = String(process.env.SESSION_SECRET ?? '').trim();
  if (explicit && !SESSION_SECRET_PLACEHOLDERS.has(explicit.toLowerCase())) {
    log('SESSION_SECRET is explicitly configured — using it as-is (authoritative).');
    return { value: explicit, source: 'explicit' };
  }

  const secretFile = resolveSessionSecretFilePath();

  try {
    if (existsSync(secretFile)) {
      const persisted = readFileSync(secretFile, 'utf8').trim();
      if (persisted.length >= 32) {
        log(`SESSION_SECRET not set — reusing the previously generated secret persisted at ${secretFile}.`);
        return { value: persisted, source: 'persisted' };
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
    return { value: generated, source: 'generated' };
  } catch (error) {
    log(
      `SESSION_SECRET not set — generated a random secret for this process, but could not persist it ` +
        `(${error instanceof Error ? error.message : String(error)}). Sessions will not survive a restart ` +
        'until SESSION_SECRET is configured explicitly or a writable volume is available. The value is never logged.',
    );
    return { value: generated, source: 'generated-unpersisted' };
  }
}

const sessionSecretResult = ensureSessionSecret();
const SESSION_SECRET = sessionSecretResult.value;
process.env.SESSION_SECRET = SESSION_SECRET;

// Diagnostics (no side effects beyond persisting the secret file itself, same
// as a real start would): reports where the session secret came from and its
// length WITHOUT ever printing the secret value, so this is safe to run
// against a real deployment target to confirm the contract.
if (process.argv.includes('--print-session-secret-status')) {
  console.log(JSON.stringify({ source: sessionSecretResult.source, length: SESSION_SECRET.length, secretFile: resolveSessionSecretFilePath() }));
  process.exit(0);
}

/* ----------------------------------------------------- build preflight
 * Diagnose a missing production build BEFORE anything tries to require a
 * file that does not exist. On a host where "build" and "start" run in
 * different containers/steps, the artifacts produced by `npm run build`
 * (`dist/` and `.next/`) can fail to carry over — the previous behaviour was
 * a bare MODULE_NOT_FOUND a couple of seconds into boot, indistinguishable
 * from a silent crash. AKBARAL_AUTO_BUILD=true makes the container self-heal
 * by running the build in place when the dependency tree (node_modules) is
 * present but the compiled output is not.
 */
const DIST_API_ENTRY = path.resolve(process.cwd(), 'dist', 'src', 'index.js');
const DIST_MIGRATE_ENTRY = path.resolve(process.cwd(), 'dist', 'src', 'db', 'migrate.js');
const DIST_SEED_ENTRY = path.resolve(process.cwd(), 'dist', 'src', 'db', 'seed.js');
const NEXT_BUILD_MARKER = path.resolve(process.cwd(), '.next', 'BUILD_ID');

function missingBuildArtifacts() {
  const missing = [];
  if (ROLES !== 'web' && !existsSync(DIST_API_ENTRY)) {
    missing.push(`${DIST_API_ENTRY} (API build output)`);
  }
  if (ROLES !== 'api' && !existsSync(NEXT_BUILD_MARKER)) {
    missing.push(`${NEXT_BUILD_MARKER} (Next.js build output)`);
  }
  return missing;
}

let missing = missingBuildArtifacts();
if (missing.length > 0) {
  log(`startup preflight: ${missing.length} required build artifact(s) missing:`);
  for (const item of missing) log(`  - ${item}`);

  if (String(process.env.AKBARAL_AUTO_BUILD ?? '').toLowerCase() === 'true') {
    log('AKBARAL_AUTO_BUILD=true — running "npm run build" to produce the missing artifact(s)…');
    runStep('production build (npm run build)', 'npm', ['run', 'build']);
    missing = missingBuildArtifacts();
    if (missing.length > 0) {
      fail(
        `"npm run build" completed but the required artifact(s) are still missing: ${missing.join(', ')}. ` +
          'Check the build log above for the real failure.',
      );
    }
    log('AKBARAL_AUTO_BUILD produced the missing artifact(s) — continuing startup.');
  } else {
    fail(
      `cannot start: the production build has not run (or its output was not carried over from the build step). ` +
        'Run "npm ci --include=dev && npm run build" before starting, or set AKBARAL_AUTO_BUILD=true to build ' +
        'automatically on boot (requires node_modules to already be installed).',
    );
  }
} else {
  log('startup preflight: all required build artifacts are present.');
}

/* ----------------------------------------------------- database migrations
 * Applied here — not only in scripts/entrypoint.sh — so this script is a
 * complete, self-sufficient startup contract on its own (the same guarantee
 * the Modal wrapper and any host that invokes this script directly rely on).
 * Migrations are idempotent (db/migrate.ts checksums applied migrations), so
 * running them again from entrypoint.sh first is harmless.
 */
if (ROLES !== 'web') {
  runStep('applying database migrations', 'node', [DIST_MIGRATE_ENTRY]);

  if (String(process.env.SEED_DATABASE ?? 'false').toLowerCase() === 'true') {
    runStep('seeding registry + plans (SEED_DATABASE=true)', 'node', [DIST_SEED_ENTRY]);
  }
}

if (ROLES !== 'api') {
  const web = launch('web', 'node_modules/.bin/next', ['start', '-p', String(webPort), '-H', '0.0.0.0'], { NODE_ENV: 'production' });
  web.on('exit', (code) => {
    console.log(`[akbaral] web exited with code ${code}`);
    shutdown();
    process.exit(code ?? 0);
  });
}
if (ROLES !== 'web') {
  const api = launch('api', 'node', ['dist/src/index.js'], { PORT: String(apiPort), NODE_ENV: 'production' });
  api.on('exit', (code) => {
    console.log(`[akbaral] api exited with code ${code}`);
    shutdown();
    process.exit(code ?? 0);
  });
}
console.log(
  `[akbaral] AKBARAL_ROLES=${ROLES} — ` +
    (ROLES === 'both'
      ? `web :${webPort} (public) + api :${apiPort} (internal)`
      : ROLES === 'web'
        ? `web :${webPort} only (public; backend via NEXT_BACKEND_URL)`
        : `api :${apiPort} only`),
);
