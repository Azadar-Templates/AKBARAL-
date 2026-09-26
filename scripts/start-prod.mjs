import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ensureSessionSecret, resolveSessionSecretFilePath } from './lib/session-secret.mjs';

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
 * Platform hosts (StackHost, Render, Fly, Blitz…) inject the port they route
 * traffic to as PORT. Precedence (Blitz fix 2026-09-22):
 *   web — AKBARAL_WEB_PORT, else PORT, else 3000  (always honors PORT)
 *   api — AKBARAL_API_PORT, else 4000, but if it collides with the public
 *         web port, it moves to 4001 (or +1) so the public PORT is always
 *         served by the web tier. This prevents Blitz “Starting up” when it
 *         injects PORT=4000 and previously the web stayed on 3000.
 */
const portOf = (value) => {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return parsed >= 1 && parsed <= 65535 ? parsed : null;
};
const apiPortRaw = portOf(process.env.AKBARAL_API_PORT) ?? 4000;
const explicitWebPort = portOf(process.env.AKBARAL_WEB_PORT);
const platformPort = portOf(process.env.PORT);
let webPort = explicitWebPort ?? platformPort ?? 3000;
let apiPort = apiPortRaw;
// If web and api would collide (e.g. Blitz injects PORT=4000), keep web on
// the public PORT and move api to the next available port.
if (webPort === apiPort) {
  apiPort = apiPort === 4000 ? 4001 : apiPort + 1;
  // Avoid secondary collision with explicit web port
  if (explicitWebPort !== null && apiPort === explicitWebPort) {
    apiPort += 1;
  }
}
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
// Implementation lives in scripts/lib/session-secret.mjs so the development
// wrapper (scripts/start-dev.mjs) applies the IDENTICAL contract — it used to
// have none, which reintroduced the "new secret on every restart" session bug
// in development while production was fixed.
const sessionSecretResult = ensureSessionSecret(log);
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

/* ----------------------------------------------------- backup scheduler
 * Nightly verified database backup inside the volume (01:17 UTC). The shell
 * entrypoint used to own this loop; StackHost now disallows `sh` in
 * stackhost.yaml (`Disallowed start command: sh`), so the Node wrapper must
 * own it directly. This is intentionally backgrounded and never allowed to
 * fail the container: a backup-cron bug must not take production down.
 * Disable with DISABLE_BACKUP_CRON=1 when the host or an external scheduler
 * owns backups. Docker/Modal still use scripts/entrypoint.sh which simply
 * execs this wrapper, so they also get the scheduler via this path.
 */
function scheduleBackup() {
  if (String(process.env.DISABLE_BACKUP_CRON ?? 'false').toLowerCase() === 'true') {
    log('backup scheduler disabled via DISABLE_BACKUP_CRON=1');
    return;
  }
  const backupDir = process.env.BACKUP_DIR ?? '/data/backups';
  const keepRaw = String(process.env.BACKUP_KEEP ?? '30').trim();
  const keep = /^\d+$/.test(keepRaw) ? Number(keepRaw) : 30;
  log(`backup scheduler enabled — daily 01:17 UTC to ${backupDir} (keep ${keep})`);
  const scheduleNext = () => {
    const now = new Date();
    const nowSec = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
    const targetSec = 1 * 3600 + 17 * 60;
    let waitSec;
    if (nowSec >= targetSec) {
      waitSec = 86400 - nowSec + targetSec;
    } else {
      waitSec = targetSec - nowSec;
    }
    const waitMs = waitSec * 1000 - now.getUTCMilliseconds();
    const timer = setTimeout(() => {
      log('scheduled backup starting');
      try {
        const result = spawnSync('node', ['dist/src/scripts/backup-db.js', backupDir, String(keep)], {
          stdio: 'inherit',
          env: process.env,
          timeout: 10 * 60 * 1000,
        });
        if (result.error) {
          console.error(`[akbaral] scheduled backup FAILED (${result.error.message})`);
        } else if (typeof result.status === 'number' && result.status !== 0) {
          console.error(`[akbaral] scheduled backup FAILED (exit ${result.status})`);
        } else if (result.signal) {
          console.error(`[akbaral] scheduled backup FAILED (signal ${result.signal})`);
        } else {
          log('scheduled backup OK');
        }
      } catch (error) {
        console.error(`[akbaral] scheduled backup FAILED (${error instanceof Error ? error.message : String(error)})`);
      }
      scheduleNext();
    }, Math.max(0, waitMs));
    if (typeof timer.unref === 'function') timer.unref();
  };
  scheduleNext();
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

// Backup scheduler must be started before the tiers so StackHost's direct
// `node scripts/start-prod.mjs` still gets nightly backups without the shell
// entrypoint. It is backgrounded (unref'd timer) and never blocks startup.
scheduleBackup();

if (ROLES !== 'api') {
  const web = launch('web', 'node_modules/.bin/next', ['start', '-p', String(webPort), '-H', '0.0.0.0'], {
    NODE_ENV: 'production',
    NEXT_BACKEND_URL: `http://127.0.0.1:${apiPort}`,
  });
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
