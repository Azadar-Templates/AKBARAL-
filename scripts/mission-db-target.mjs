/**
 * The mission database target, in the form it may be printed or compared.
 *
 * The mission server reports the database it opened as `missionDb.path()`
 * (src/mission/database.ts), which for PostgreSQL is `displayDatabaseTarget()`
 * (src/db/display-target.ts): scheme, host/port and path only, never credentials, and
 * never a query parameter — a managed Postgres URL can carry its password in the query
 * string too. `scripts/start-prod.mjs` has to recognise that string to prove the child it
 * started is the service configured against the database it configured, and it is a plain
 * .mjs wrapper that cannot import TypeScript. So the rule lives here, in one file both
 * the wrapper and the tests can load; `src/mission/mission-migrations-at-boot.test.ts`
 * asserts this copy agrees with the TypeScript authority for a set of URLs, which is what
 * stops the two from drifting.
 */

/** Same resolution order as missionEnv() in src/mission/database.ts. */
export function missionDatabaseUrl(env = process.env) {
  const dataDir = (env.DATA_DIR ?? (env.NODE_ENV === 'production' ? '/data' : './data')).trim();
  const raw = (env.ZA141251SA_DATABASE_URL ?? env.MISSION_DATABASE_URL ?? `file:${dataDir}/mission.db`).trim();
  return raw.length > 0 ? raw : `file:${dataDir}/mission.db`;
}

import path from 'node:path';

/**
 * The SQLite file path behind a `file:` URL, or null for a server URL. Relative paths are
 * resolved against the cwd because that is what resolveMissionDbPath() in
 * src/mission/database.ts does, and the child reports the resolved form.
 */
export function missionDatabaseFile(url = missionDatabaseUrl()) {
  const value = url.startsWith('file:') ? url.slice('file:'.length) : url;
  if (/^[a-z]+:\/\//i.test(value)) return null;
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

/** Credential-free display form; mirrors displayDatabaseTarget() for PostgreSQL. */
export function displayMissionDatabaseTarget(url = missionDatabaseUrl()) {
  const input = String(url ?? '').trim();
  if (!/^postgres(?:ql)?:/i.test(input)) return input;
  try {
    const parsed = new URL(input);
    if (!parsed.host) return '[redacted PostgreSQL target]';
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return '[redacted PostgreSQL target]';
  }
}

/**
 * The string the mission server's health payload reports as `database` for this target:
 * the resolved file path for SQLite (what the readiness contract compared before
 * PostgreSQL existed), the display form for PostgreSQL. Presence only — never a secret.
 */
export function missionHealthDatabaseExpectation(env = process.env) {
  const url = missionDatabaseUrl(env);
  const file = missionDatabaseFile(url);
  return file === null ? displayMissionDatabaseTarget(url) : file;
}

/**
 * Where the mission server will listen, and where its readiness must therefore be probed.
 *
 * This is the single source of truth for both halves of that pair. It used to be two hardcoded
 * literals in `scripts/start-prod.mjs` (`127.0.0.1` and `4200`) that were also *forced* onto the
 * child, which meant a deployment that configured `ZA141251SA_PORT` had its value silently
 * replaced and the prober and the probed could only agree by accident. The defaults and the
 * parsing are the ones the mission server itself uses (`missionEnv()` in
 * src/mission/database.ts); a test pins that agreement, because a probe pointed at an address
 * the service never binds is indistinguishable from a service that failed to start.
 *
 * Nothing here widens a bind: an unset `ZA141251SA_BIND_HOST` stays loopback, and a wildcard bind
 * is probed over loopback (which is where a wildcard listener also answers).
 */
export function missionBindTarget(env = process.env) {
  // Loopback, always, for anything this wrapper launches. An inherited
  // ZA141251SA_BIND_HOST=0.0.0.0 must not become a public owner dashboard, and an injected
  // ZA141251SA_PORT must not collide with the platform's public tier — that pin is deliberate
  // and predates this file. What this resolver adds is that the readiness probe now uses the
  // SAME value the wrapper passes to the child, so the two can never disagree: a deployment that
  // genuinely needs another port sets ZA141251SA_MISSION_PORT, and the probe follows. To bind
  // the private listener somewhere else, run `npm run mission:serve` yourself — this wrapper will
  // not do it.
  const host = '127.0.0.1';
  const requested = String(env.ZA141251SA_MISSION_PORT ?? '').trim();
  if (requested.length > 0 && !/^\d+$/.test(requested)) {
    throw new Error(`ZA141251SA_MISSION_PORT must be a port number, got "${requested}"`);
  }
  const port = requested.length > 0 ? Number.parseInt(requested, 10) : 4200;
  if (port < 1 || port > 65_535) {
    throw new Error(`ZA141251SA_MISSION_PORT must be between 1 and 65535, got ${port}`);
  }
  return { host, port, healthUrl: `http://${host}:${port}/api/health` };
}

/**
 * How long the private tier is given, and what happens when it does not answer.
 *
 * The measured production shape of this decision: the mission child needed ~38 s to reach its own
 * readiness on a PostgreSQL database holding the imported 4,001-agent fleet, and the wrapper's
 * window was 30 s — so every boot declared the private tier dead, exited the container, and the
 * public web tier went down with it, forever. The budget is now large and configurable, and the
 * choice to terminate the container is an explicit owner opt-in (`ZA141251SA_MISSION_REQUIRED`)
 * rather than the default. A slow private tier must never be a public outage.
 */
export function missionReadinessPolicy(env = process.env) {
  const positiveInt = (value, fallback) => {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const nonNegativeInt = (value, fallback) => {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    timeoutMs: positiveInt(env.ZA141251SA_MISSION_READINESS_TIMEOUT_MS, 180_000),
    requestTimeoutMs: positiveInt(env.ZA141251SA_MISSION_HEALTH_TIMEOUT_MS, 5_000),
    attempts: positiveInt(env.ZA141251SA_MISSION_START_ATTEMPTS, 5),
    restartDelayMs: nonNegativeInt(env.ZA141251SA_MISSION_RESTART_DELAY_MS, 15_000),
    required: String(env.ZA141251SA_MISSION_REQUIRED ?? '').trim().toLowerCase() === 'true',
  };
}
