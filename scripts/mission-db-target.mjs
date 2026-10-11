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
