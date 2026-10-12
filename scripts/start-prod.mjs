import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { missionBindTarget, missionDatabaseFile, missionDatabaseUrl, missionHealthDatabaseExpectation, missionReadinessPolicy } from './mission-db-target.mjs';
import { waitForMissionReadiness } from './mission-readiness.mjs';

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
function runStep(label, command, args, env = process.env) {
  log(`${label}…`);
  const result = spawnSync(command, args, { stdio: 'inherit', env });
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

// The private mission server is an independent process with its own database,
// authentication and secrets. Production startup must remain fail-closed: it
// is never launched implicitly, by a truthy value, or by an AKBARAL_ROLES
// selection. Only this exact operator opt-in starts it. The mission workers
// remain separate and retain their own independent enablement gates.
const MISSION_SERVER_ENABLED = process.env.ZA141251SA_MISSION_SERVER_ENABLED === 'true';
// The address the private tier will bind and the address its readiness is probed at are the same
// value, from one resolver (scripts/mission-db-target.mjs) that mirrors `missionEnv()` in
// src/mission/database.ts. They used to be two literals here that were also forced onto the
// child, so an operator-configured ZA141251SA_PORT was silently replaced and probe and service
// agreed only by accident. Defaults unchanged: loopback, 4200.
const MISSION_BIND = missionBindTarget(process.env);
const MISSION_POLICY = missionReadinessPolicy(process.env);
// The mission database is wherever the mission code says it is, not wherever this
// wrapper once assumed it would be. It used to be hardcoded to file:/data/mission.db,
// which meant that on a deployment whose ZA141251SA_DATABASE_URL is a PostgreSQL
// database — the managed production shape — this wrapper could only ever migrate and
// health-check a SQLite file nobody was using. That is how production's mission schema
// sat unmigrated while every boot logged a clean start. Same resolution order as
// missionEnv() in src/mission/database.ts, in one shared file (scripts/mission-db-target.mjs).
const MISSION_DATABASE_URL = missionDatabaseUrl(process.env);
const MISSION_DATABASE_FILE = missionDatabaseFile(MISSION_DATABASE_URL);
/** The database path the child's /api/health must report for this configuration. */
const MISSION_HEALTH_DATABASE = missionHealthDatabaseExpectation(process.env);
/**
 * A file target only exists if the operator mounted it; a server target is configured,
 * not mounted, so its existence is the configuration itself.
 */
const MISSION_DATABASE_PRESENT = MISSION_DATABASE_FILE === null ? existsEnv('ZA141251SA_DATABASE_URL') : existsSync(MISSION_DATABASE_FILE);
function existsEnv(name) {
  return String(process.env[name] ?? '').trim().length > 0;
}
const MISSION_HEALTH_URL = MISSION_BIND.healthUrl;
/** The resolver this wrapper uses to run a mission entry in whichever shape the tree has. */
const MISSION_ENTRY_RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mission-run.mjs');
const MISSION_READINESS_POLL_MS = 250;
/**
 * The one condition under which a private-tier problem is allowed to end this container. It is an
 * explicit owner choice, not a default: measured production had a 30 s readiness window, a mission
 * child that needed ~38 s to open its listener on a PostgreSQL database holding 4,001 imported
 * agents, and `await`ed readiness before either public tier was launched — so every boot took the
 * public product down with the private tier, in a loop. The public tiers are no longer that
 * trade's collateral; `ZA141251SA_MISSION_REQUIRED=true` restores fail-closed for a deployment
 * that wants a container to die rather than serve without its private half.
 */
const MISSION_PRECONDITION_FAILURE =
  MISSION_SERVER_ENABLED && MISSION_DATABASE_FILE !== null && !existsSync(MISSION_DATABASE_FILE)
    ? `private mission startup refused: ${MISSION_DATABASE_FILE} does not exist. ` +
      'Mount the existing private mission database at that exact path (or point ZA141251SA_DATABASE_URL at the ' +
      'PostgreSQL database the mission owns); startup will not create or select an alternate database.'
    : null;

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

// The mission process is allowed to open exactly one pre-provisioned database, and the
// mission bootstrap must never create an alternate relative database as an accidental
// fallback. That is still refused — but the refusal is *decided* here and *acted on* where the
// private tier is supervised, because ending the public product is not this condition's job
// unless the owner asked for it with ZA141251SA_MISSION_REQUIRED=true (see MISSION_POLICY).
if (MISSION_PRECONDITION_FAILURE) {
  console.error(`[akbaral] ${MISSION_PRECONDITION_FAILURE}`);
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
  if (process.env.AKBARAL_SESSION_SECRET_FILE) {
    return path.resolve(process.env.AKBARAL_SESSION_SECRET_FILE);
  }
  // Use DATA_DIR (defaults to /data in production, ./data in dev)
  const dataDir = process.env.DATA_DIR || (process.env.NODE_ENV === 'production' ? '/data' : 'data');
  return path.resolve(dataDir, '.session-secret');
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
const DIST_MISSION_ENTRY = path.resolve(process.cwd(), 'dist', 'scripts', 'mission-serve.js');
const NEXT_BUILD_MARKER = path.resolve(process.cwd(), '.next', 'BUILD_ID');

function missingBuildArtifacts() {
  const missing = [];
  if (ROLES !== 'web' && !existsSync(DIST_API_ENTRY)) {
    missing.push(`${DIST_API_ENTRY} (API build output)`);
  }
  if (ROLES !== 'api' && !existsSync(NEXT_BUILD_MARKER)) {
    missing.push(`${NEXT_BUILD_MARKER} (Next.js build output)`);
  }
  if (MISSION_SERVER_ENABLED && !existsSync(DIST_MISSION_ENTRY)) {
    missing.push(`${DIST_MISSION_ENTRY} (private mission server build output)`);
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

/**
 * Wait for the private tier using the ONE readiness contract the platform has
 * (`scripts/mission-readiness.mjs`, imported by the boot tests and any operator probe as well).
 *
 * `fetch failed` used to be ambiguous here, and the ambiguity cost a production outage: it is what
 * a healthy-but-busy service returns when the per-request timeout is 1000 ms, just as much as what
 * a dead one returns. The message therefore now says which of the two it looked like, and the
 * progress line below means a slow boot is visible as a slow boot while it is happening rather than
 * only in the post-mortem.
 */
async function waitForMissionReady() {
  return waitForMissionReadiness({
    healthUrl: MISSION_HEALTH_URL,
    expectedDatabase: MISSION_HEALTH_DATABASE,
    timeoutMs: MISSION_POLICY.timeoutMs,
    requestTimeoutMs: MISSION_POLICY.requestTimeoutMs,
    pollMs: MISSION_READINESS_POLL_MS,
    progress: (info) =>
      log(
        `private mission tier still starting: ${Math.round(info.elapsedMs / 1000)} s of ` +
          `${Math.round(info.timeoutMs / 1000)} s used (last probe: ${info.lastFailure}).`,
      ),
  });
}

function spawnMissionChild() {
  // These child values deliberately override inherited environment values. The
  // production wrapper supports one private listener and one existing database only;
  // callers cannot widen or redirect either one. The database value is the one this
  // wrapper just migrated above (resolved from the operator's ZA141251SA_DATABASE_URL,
  // defaulting to the mounted volume file), so "what was migrated" and "what the server
  // opens" cannot drift apart — which is precisely what they did while this line pointed
  // at a hardcoded SQLite path. The bind host and port are the values the readiness probe
  // uses, from the same resolver, so the two can never disagree.
  return launch('mission', 'node', [DIST_MISSION_ENTRY], {
    NODE_ENV: 'production',
    ZA141251SA_BIND_HOST: MISSION_BIND.host,
    ZA141251SA_PORT: String(MISSION_BIND.port),
    ZA141251SA_DATABASE_URL: MISSION_DATABASE_URL,
  });
}

/** One launch of the private tier plus the two things worth knowing about it: when it is ready, and when it is gone. */
function startMissionAttempt(attempt) {
  if (attempt === 1 && MISSION_PRECONDITION_FAILURE) {
    return { attempt, preflightFailure: MISSION_PRECONDITION_FAILURE };
  }
  const child = spawnMissionChild();
  const death = new Promise((resolve) => {
    child.once('error', (error) => resolve(`failed to run (${error instanceof Error ? error.message : String(error)})`));
    child.once('exit', (code, signal) => {
      resolve(signal ? `was terminated by signal ${signal}` : `exited unexpectedly with code ${code ?? 'unknown'}`);
    });
  });
  const readiness = waitForMissionReady().then(
    () => null,
    (error) => (error instanceof Error ? error.message : String(error)),
  );
  return { attempt, child, death, outcome: Promise.race([death, readiness]) };
}

function stopMissionChild(child) {
  if (child && !child.killed) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
}

/**
 * The loud end of the line for the private tier. Never a silent restart loop and never an
 * unlabelled exit: the reason, what was probed, how many tries it took, and the owner-facing
 * switches that change this decision are printed together every time.
 */
function giveUpMissionTier(reason) {
  const lines = [
    'MISSION TIER UNAVAILABLE — the private mission server never became ready, and it is not being launched again by this container.',
    `  reason: ${reason}`,
    `  probed: ${MISSION_HEALTH_URL} — ${MISSION_POLICY.attempts} attempt(s), ${MISSION_POLICY.timeoutMs} ms each, ${MISSION_POLICY.restartDelayMs} ms apart`,
    `  database the child was given: ${MISSION_HEALTH_DATABASE}`,
    MISSION_POLICY.required
      ? '  ZA141251SA_MISSION_REQUIRED=true is set, so this container exits now rather than serve without its private tier.'
      : '  the public tiers stay up: a private-tier failure is not allowed to take the public product down. The mission dashboard stays unavailable until this is fixed.',
    '  to change this decision: ZA141251SA_MISSION_REQUIRED=true (exit the container instead of continuing),',
    '    ZA141251SA_MISSION_READINESS_TIMEOUT_MS / _ATTEMPTS / _RESTART_DELAY_MS / ZA141251SA_MISSION_HEALTH_TIMEOUT_MS (budget),',
    '    plus the mission server log lines above, which name the migration or seed that did not finish.',
  ];
  console.error(`[akbaral] ${lines.join('\n[akbaral] ')}`);
  if (MISSION_POLICY.required) {
    log('terminating the container: the private mission tier is required by ZA141251SA_MISSION_REQUIRED=true.');
    shutdown();
    process.exit(1);
  }
}

/**
 * Supervise the private tier after the public tiers are already coming up. The child is launched
 * before them (so it gets its head start on database work), but nothing here delays a public
 * listener by a millisecond: readiness, restart and giving up all happen on this side.
 */
async function superviseMissionTier(first) {
  let current = first;
  for (;;) {
    const failure = await current.outcome;
    if (failure === null) {
      log(`private mission readiness verified at ${MISSION_HEALTH_URL}.`);
      const reason = await current.death;
      console.error(`[akbaral] MISSION TIER RESTART — the ready private mission child ${reason}; relaunching it (the public tiers are unaffected).`);
      if (current.attempt >= MISSION_POLICY.attempts) {
        return giveUpMissionTier(`the mission child ${reason}, and the ${MISSION_POLICY.attempts}-launch budget is used up`);
      }
    } else {
      stopMissionChild(current.child);
      console.error(`[akbaral] MISSION TIER NOT READY — attempt ${current.attempt}/${MISSION_POLICY.attempts}: ${failure}`);
      if (current.attempt >= MISSION_POLICY.attempts) {
        return giveUpMissionTier(failure);
      }
    }
    if (MISSION_POLICY.restartDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, MISSION_POLICY.restartDelayMs));
    }
    log(`relaunching the private mission child (attempt ${current.attempt + 1} of ${MISSION_POLICY.attempts}).`);
    current = startMissionAttempt(current.attempt + 1);
  }
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

/* ------------------------------------------------- mission database migrations
 * The mission schema is applied here, on every start, before the mission server can
 * listen and before either public tier binds. It used to be a side effect of
 * `startMissionServer()` only — so on any deployment where the mission child is not
 * launched by this wrapper (the flag is off, or the mission runs as its own service),
 * nothing ever applied a mission migration, and nothing said so: the container logged a
 * clean boot with 4 of 49 mission migration files unapplied behind it.
 *
 * It runs in the tier that owns database writes (the same gate as the platform step), and a
 * web-only container says so rather than racing its sibling.
 *
 * Fatal by construction: runStep exits the container on a non-zero child, and
 * `scripts/mission-migrate.ts` exits non-zero on any migration that throws, after
 * rolling that one file back. A mission database that could not be migrated is never
 * reported as migrated. The only skip is a deployment that has no mission database at
 * all, and it says so out loud.
 */
// The tier that owns database writes migrates; a web-only container (the small-host
// AKBARAL_ROLES=web split) must not race its api sibling for the same schema.
if (ROLES !== 'web' && MISSION_DATABASE_PRESENT) {
  runStep(
    'applying mission database migrations',
    'node',
    // Absolute, and told which tree to resolve against: the deployment root this wrapper is
    // running from, which is where dist/ and db/ live. Same rule DIST_MIGRATE_ENTRY follows.
    [MISSION_ENTRY_RUNNER, 'mission-migrate', '--root', process.cwd()],
    // The child gets the same explicit target, so what is migrated here is exactly what
    // the mission server will open — no inherited value can point the two at different
    // databases.
    { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'production', ZA141251SA_DATABASE_URL: MISSION_DATABASE_URL },
  );
} else {
  log(
    `no mission database at ${MISSION_DATABASE_FILE ?? MISSION_DATABASE_URL} — mission migrations skipped ` +
      '(this deployment has no mission database; nothing was reported as migrated).',
  );
}

// The private child is launched here — before the public tiers, so its database work and their
// startup overlap — but it is not awaited. Readiness, restart and giving up are handled by
// `superviseMissionTier` at the end of this file, after the public tiers have been launched, so
// a private tier that is slow, sick or entirely absent cannot take the public product down.
const MISSION_ATTEMPT = MISSION_SERVER_ENABLED ? startMissionAttempt(1) : null;

// Backup scheduler must be started before the public tiers so StackHost's
// direct `node scripts/start-prod.mjs` still gets nightly backups without the
// shell entrypoint. It is backgrounded (unref'd timer) and never blocks startup.
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
if (MISSION_ATTEMPT) {
  // Deliberately not awaited. The supervisor never resolves while the private tier stays
  // healthy — it is the thing that notices a death and relaunches — and an unsettled top-level
  // await is a hard exit 13 in ESM, which would itself become a boot failure. Every outcome this
  // function can end in (ready, or given up on loudly) is logged from inside it; the only way it
  // ends the container is the explicit ZA141251SA_MISSION_REQUIRED=true path in giveUpMissionTier.
  const supervision = MISSION_ATTEMPT.preflightFailure
    ? Promise.resolve(giveUpMissionTier(MISSION_ATTEMPT.preflightFailure))
    : superviseMissionTier(MISSION_ATTEMPT);
  supervision.catch((error) => {
    console.error(
      `[akbaral] MISSION TIER SUPERVISION FAILED — ${error instanceof Error ? error.message : String(error)}; ` +
        'the public tiers are unaffected.',
    );
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
