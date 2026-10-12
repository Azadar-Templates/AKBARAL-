import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Deployment/startup contract lock — StackHost startup fix (2026-09-17).
 *
 * StackHost deployments were dying 2-3 seconds after start with NO
 * application logs at all. Root cause, reproduced locally:
 *   1. `scripts/entrypoint.sh` ran under `set -eu` and could abort before
 *      Node ever printed a line (e.g. a missing build artifact from a build
 *      step whose output was not carried into the start step).
 *   2. A container that never had `SESSION_SECRET` configured hit the
 *      mandatory-config guard with no actionable diagnostic.
 *
 * These tests exercise the REAL scripts (`scripts/start-prod.mjs`,
 * `scripts/entrypoint.sh`, `stackhost.yaml`) — by running them as child
 * processes wherever practical, and by asserting on their source only for
 * properties that would otherwise require actually provisioning a container
 * — so a regression here fails the suite instead of silently reappearing in
 * production.
 */

const START_PROD = path.resolve('scripts/start-prod.mjs');
const ENTRYPOINT = path.resolve('scripts/entrypoint.sh');
const STACKHOST_YAML = path.resolve('stackhost.yaml');

const startProdSource = readFileSync(START_PROD, 'utf8');
const entrypointSource = readFileSync(ENTRYPOINT, 'utf8');
const stackhostSource = readFileSync(STACKHOST_YAML, 'utf8');

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

// Every invocation gets its own throwaway secret file by default so a test
// that does not care about persistence can never write into the real repo's
// data/ directory as a side effect.
function runStartProd(args: string[], env: Record<string, string>): RunResult {
  const defaultSecretDir = mkdtempSync(path.join(os.tmpdir(), 'akbaral-startprod-'));
  const result = spawnSync(process.execPath, [START_PROD, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PORT: '',
      AKBARAL_WEB_PORT: '',
      AKBARAL_API_PORT: '',
      SESSION_SECRET: '',
      AKBARAL_SESSION_SECRET_FILE: path.join(defaultSecretDir, '.session-secret'),
      ZA141251SA_MISSION_SERVER_ENABLED: '',
      ...env,
    },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function lastJsonLine(output: string): Record<string, unknown> {
  return JSON.parse(output.trim().split('\n').at(-1) ?? '{}');
}

interface HarnessSpawn {
  kind: 'mission' | 'web' | 'api' | 'other';
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
}

interface HarnessRecord {
  spawns: HarnessSpawn[];
  spawnSteps: string[][];
  /** The environment each blocking step ran with, so a step can be pinned to a database. */
  stepEnvs: Array<Record<string, string | undefined>>;
  /** Every process boundary in the order the wrapper crossed it. */
  order: string[];
  fetches: string[];
  kills: Array<{ kind: HarnessSpawn['kind']; signal: string }>;
}

interface HarnessResult extends RunResult {
  record: HarnessRecord;
}

/**
 * Run the real production wrapper while replacing only process/FS/network
 * boundaries in a Node preload. This exercises startup ordering, child env,
 * readiness and supervision without opening a socket, touching /data, or
 * starting any real public/mission process.
 */
function runMissionStartupHarness(
  scenario: 'ready' | 'missing-db' | 'missing-entry' | 'readiness-timeout' | 'unexpected-exit' | 'signal-exit',
  enabled = true,
  databaseUrl: string | null = 'file:/tmp/not-allowed.db',
  roles = 'both',
  extraEnv: Record<string, string> = {},
): HarnessResult {
  // `null` means "the operator configured nothing": the wrapper must then fall back to the
  // DATA_DIR default the mission code itself uses, which is what the file assertions below
  // pin. A string is the hostile inherited value — it must be HONOURED, not replaced.
  const databaseFile = databaseUrl === null ? '/data/mission.db' : databaseUrl.replace(/^file:/, '');
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'akbaral-mission-startup-'));
  const preloadPath = path.join(tmpDir, 'preload.mjs');
  const recordPath = path.join(tmpDir, 'record.json');

  writeFileSync(
    preloadPath,
    `
import { createRequire, syncBuiltinESMExports } from 'node:module';
const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');

const scenario = process.env.AKBARAL_TEST_MISSION_SCENARIO;
const recordPath = process.env.AKBARAL_TEST_MISSION_RECORD;
// The file the wrapper resolves as the mission database for this run: the configured URL's
// file when an operator set one, the DATA_DIR default otherwise. The fake filesystem answers
// for exactly that path, so a scenario cannot pass by checking a file nobody uses.
const missionDbFile = process.env.AKBARAL_TEST_MISSION_DB_FILE;
const record = { spawns: [], spawnSteps: [], stepEnvs: [], order: [], fetches: [], kills: [] };
const originalExistsSync = fs.existsSync.bind(fs);
const originalWriteFileSync = fs.writeFileSync.bind(fs);
const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
let missionChild;

function childKind(command, args) {
  if (args.some((arg) => String(arg).endsWith('/dist/scripts/mission-serve.js'))) return 'mission';
  if (String(command).includes('node_modules/.bin/next')) return 'web';
  if (args.some((arg) => String(arg).endsWith('dist/src/index.js'))) return 'api';
  return 'other';
}

class FakeChild extends EventEmitter {
  constructor(kind) {
    super();
    this.kind = kind;
    this.killed = false;
  }
  kill(signal = 'SIGTERM') {
    this.killed = true;
    record.kills.push({ kind: this.kind, signal });
    return true;
  }
}

childProcess.spawn = (command, args = [], options = {}) => {
  const kind = childKind(command, args);
  const env = options.env ?? {};
  record.order.push('spawn:' + kind);
  record.spawns.push({
    kind,
    command: String(command),
    args: args.map(String),
    env: {
      NODE_ENV: env.NODE_ENV,
      PORT: env.PORT,
      ZA141251SA_BIND_HOST: env.ZA141251SA_BIND_HOST,
      ZA141251SA_PORT: env.ZA141251SA_PORT,
      ZA141251SA_DATABASE_URL: env.ZA141251SA_DATABASE_URL,
    },
  });
  const child = new FakeChild(kind);
  if (kind === 'mission') missionChild = child;
  return child;
};
childProcess.spawnSync = (_command, args = [], options = {}) => {
  const list = args.map(String);
  record.spawnSteps.push(list);
  record.stepEnvs.push({
    ZA141251SA_DATABASE_URL: (options.env ?? {}).ZA141251SA_DATABASE_URL,
    ZA141251SA_MISSION_SERVER_ENABLED: (options.env ?? {}).ZA141251SA_MISSION_SERVER_ENABLED,
  });
  record.order.push('step:' + list.join(' '));
  return { status: 0, signal: null };
};

fs.existsSync = (input) => {
  const value = String(input);
  if (value === missionDbFile) return scenario !== 'missing-db';
  if (value.endsWith('/dist/scripts/mission-serve.js')) return scenario !== 'missing-entry';
  if (value.endsWith('/dist/src/index.js') || value.endsWith('/.next/BUILD_ID')) return true;
  return originalExistsSync(input);
};
syncBuiltinESMExports();

if (scenario === 'readiness-timeout') {
  let now = 0;
  Date.now = () => (now += 10_000);
  globalThis.setTimeout = (callback, _delay, ...args) => originalSetTimeout(callback, 0, ...args);
}

globalThis.fetch = async (url) => {
  record.fetches.push(String(url));
  if (scenario === 'readiness-timeout') {
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', service: 'mission', database: missionDbFile, audit: true, ledger: true, ownerAccounts: 0, vaultConfigured: false }),
    };
  }
  if (scenario === 'unexpected-exit') {
    originalSetTimeout(() => missionChild.emit('exit', 0, null), 5);
  }
  if (scenario === 'signal-exit') {
    originalSetTimeout(() => missionChild.emit('exit', null, 'SIGTERM'), 5);
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ status: 'ok', service: 'mission', database: missionDbFile, audit: true, ledger: true, ownerAccounts: 1, vaultConfigured: true }),
  };
};

process.on('exit', () => {
  originalWriteFileSync(recordPath, JSON.stringify(record));
});
`,
    'utf8',
  );

  try {
    const result = spawnSync(process.execPath, [START_PROD], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${preloadPath}`.trim(),
        AKBARAL_TEST_MISSION_SCENARIO: scenario,
        AKBARAL_TEST_MISSION_RECORD: recordPath,
        AKBARAL_ROLES: roles,
        AKBARAL_AUTO_BUILD: 'false',
        DISABLE_BACKUP_CRON: 'true',
        PORT: '',
        AKBARAL_WEB_PORT: '',
        AKBARAL_API_PORT: '',
        SESSION_SECRET: 'x'.repeat(40),
        // Deterministic, so the fallback below never depends on what this checkout has.
        DATA_DIR: '/data',
        AKBARAL_TEST_MISSION_DB_FILE: databaseFile,
        ZA141251SA_MISSION_SERVER_ENABLED: enabled ? 'true' : '',
        // Deliberately hostile inherited values: the bind host and port must be replaced by
        // the wrapper's pins. The mission database URL is the operator's own configuration
        // channel (src/mission/database.ts resolves it the same way) and must be HONOURED —
        // overriding it here is what left a production Postgres mission database unmigrated.
        // The private listener is pinned to loopback:4200 unless the operator names the
        // mission-specific variable, so an injected platform PORT or a wildcard bind inherited
        // from a compose file can neither expose nor relocate the owner dashboard by accident.
        ZA141251SA_BIND_HOST: '0.0.0.0',
        ZA141251SA_PORT: '9999',
        ...(databaseUrl === null ? {} : { ZA141251SA_DATABASE_URL: databaseUrl }),
        ...extraEnv,
      },
    });
    const record: HarnessRecord = existsSync(recordPath)
      ? JSON.parse(readFileSync(recordPath, 'utf8'))
      : { spawns: [], spawnSteps: [], stepEnvs: [], order: [], fetches: [], kills: [] };
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', record };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// scripts/entrypoint.sh must never silently exit
// --------------------------------------------------------------------------

test('entrypoint execs the startup wrapper as its final statement (no silent exit)', () => {
  assert.match(
    entrypointSource,
    /^exec node scripts\/start-prod\.mjs\s*$/m,
    'the last statement must `exec` (replace the shell), not spawn-and-return — otherwise a crash inside the ' +
      'wrapper can be swallowed by the parent shell instead of becoming the container exit code',
  );
  const execIndex = entrypointSource.indexOf('exec node scripts/start-prod.mjs');
  assert.ok(execIndex > -1);
  const afterExec = entrypointSource.slice(execIndex + 'exec node scripts/start-prod.mjs'.length).trim();
  assert.equal(afterExec, '', 'nothing may follow the exec — it must be the last statement in the script');
});

test('entrypoint keeps the optional nightly backup loop from ever aborting startup', () => {
  assert.match(entrypointSource, /set -eu/, 'the script should still fail fast on its own unexpected errors');
  // Backup scheduling now lives in scripts/start-prod.mjs (StackHost disallows `sh`
  // in stackhost.yaml), so entrypoint.sh must be a minimal exec wrapper.
  // The Node wrapper must own the backup loop and remain opt-out via DISABLE_BACKUP_CRON.
  assert.match(startProdSource, /DISABLE_BACKUP_CRON/, 'the backup loop must remain opt-out via DISABLE_BACKUP_CRON');
  assert.match(startProdSource, /scheduleBackup/, 'start-prod.mjs must own the backup scheduler');
  // The backup loop is backgrounded (unref'd timer) so a bug in it cannot block or
  // kill the foreground startup path.
  assert.match(startProdSource, /timer\.unref/, 'the backup loop must run in the background, never inline');
  // Entrypoint must NOT duplicate the backup loop — it delegates to start-prod.mjs.
  assert.doesNotMatch(entrypointSource, /BACKUP_KEEP/, 'entrypoint.sh must delegate backup scheduling to scripts/start-prod.mjs');
  assert.doesNotMatch(entrypointSource, /\)\s*&\s*\n\s*fi/, 'entrypoint backup loop must not remain in shell (now in Node)');
});

test('entrypoint no longer duplicates startup preconditions that start-prod.mjs now owns', () => {
  // Migrations and seeding are asserted (and executed) exactly once, inside
  // scripts/start-prod.mjs — see the tests below. entrypoint.sh must not
  // re-implement them (that duplication is exactly how the two could drift).
  assert.doesNotMatch(
    entrypointSource,
    /node dist\/src\/db\/migrate\.js/,
    'entrypoint.sh must delegate migrations to scripts/start-prod.mjs, not run them itself',
  );
});

// --------------------------------------------------------------------------
// stackhost.yaml
// --------------------------------------------------------------------------

test('stackhost.yaml uses the documented build/start commands and preserves the injected PORT', () => {
  // StackHost Free memory ceiling fix (2026-09-22): a source build
  // (`npm ci` + `next build`) needs roughly 1GB of RAM and fails on the 512MB
  // free tier at "Creating build environment → Failed to create container".
  // The deployed configuration therefore pulls the prebuilt image published by
  // the docker-publish workflow and runs NO build step on the platform.
  // Accepts either a tag (`:latest`, `:<sha>`) or — preferred — an immutable
  // digest (`@sha256:...`). The requirement being enforced is "pull a prebuilt
  // image, run no build step here"; a digest satisfies that strictly better
  // than a tag, because a digest cannot be repointed at a different build.
  assert.match(
    stackhostSource,
    /image:\s*"?ghcr\.io\/azadar-templates\/akbaral(?::[\w.-]+|@sha256:[a-f0-9]{64})/,
    'stackhost.yaml must run the prebuilt GHCR image — a source build needs ~1GB and the free tier has 512MB',
  );
  assert.match(
    stackhostSource,
    /build:\s*\[\]/,
    'commands.build must stay an empty list: the image is prebuilt, so the platform must not rebuild it',
  );
  assert.doesNotMatch(
    stackhostSource,
    /build:\s*\n\s*-\s*"?npm (ci|run build)/,
    'do not reintroduce a platform-side source build — it exceeds the StackHost Free 512MB ceiling',
  );
  // StackHost requires `commands.build` to be a YAML list (array) when it is
  // non-empty — a single string with `&&` is a schema violation that causes the
  // platform's build step to be skipped or to fail with no application logs
  // (2-5s silent exit). This guard stays live in case a build step ever returns.
  assert.doesNotMatch(
    stackhostSource,
    /build:\s*"npm ci --include=dev && npm run build"/,
    'build must be a YAML list, not a single string with `&&` — StackHost treats a string as a schema error and the build never produces dist/.next/',
  );
  // StackHost explicitly rejects `sh` in start (Disallowed start command: sh) — must be direct Node.
  assert.match(stackhostSource, /start:\s*"node scripts\/start-prod\.mjs"/);
  assert.doesNotMatch(
    stackhostSource,
    /start:\s*"sh /,
    'StackHost disallows `sh` in commands.start — must be `node scripts/start-prod.mjs` directly',
  );
  // The start command itself must not reference entrypoint.sh (comments may still mention it for Docker parity).
  const startLine = stackhostSource.split('\n').find((l) => l.trim().startsWith('start:')) ?? '';
  assert.doesNotMatch(
    startLine,
    /entrypoint\.sh/,
    'stackhost.yaml start must not reference scripts/entrypoint.sh — StackHost start must be `node scripts/start-prod.mjs`',
  );
  assert.match(
    stackhostSource,
    /StackHost injects the public port it routes traffic to as PORT/,
    'the documented PORT contract must stay intact',
  );
});

// --------------------------------------------------------------------------
// SESSION_SECRET handling in scripts/start-prod.mjs
// --------------------------------------------------------------------------

test('an explicitly configured SESSION_SECRET remains authoritative', () => {
  const explicit = 'x'.repeat(40);
  const run = runStartProd(['--print-session-secret-status'], { SESSION_SECRET: explicit });
  assert.equal(run.status, 0, run.stderr);
  const body = lastJsonLine(run.stdout);
  assert.equal(body.source, 'explicit');
  assert.equal(body.length, explicit.length);
  assert.ok(!run.stdout.includes(explicit), 'the secret value itself must never be printed');
});

test('a missing SESSION_SECRET is generated (>=32 chars), persisted 0600, and reused on the next start', () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'akbaral-secret-'));
  const secretFile = path.join(tmpDir, '.session-secret');
  try {
    const first = runStartProd(['--print-session-secret-status'], { AKBARAL_SESSION_SECRET_FILE: secretFile });
    assert.equal(first.status, 0, first.stderr);
    const firstBody = lastJsonLine(first.stdout);
    assert.equal(firstBody.source, 'generated');
    assert.ok(
      typeof firstBody.length === 'number' && firstBody.length >= 32,
      'the generated secret must satisfy the production >=32 char guard',
    );
    assert.ok(existsSync(secretFile), 'the generated secret must be persisted to disk');

    const mode = statSync(secretFile).mode & 0o777;
    assert.equal(mode, 0o600, 'the persisted secret file must be restricted to owner read/write (0600)');

    const persistedValue = readFileSync(secretFile, 'utf8').trim();
    assert.ok(persistedValue.length >= 32);
    assert.ok(!first.stdout.includes(persistedValue), 'the secret value itself must never be printed');

    const second = runStartProd(['--print-session-secret-status'], { AKBARAL_SESSION_SECRET_FILE: secretFile });
    assert.equal(second.status, 0, second.stderr);
    const secondBody = lastJsonLine(second.stdout);
    assert.equal(
      secondBody.source,
      'persisted',
      'restarting the same volume must reuse the generated secret, not silently rotate it (which would log every ' +
        'existing session out on every deploy)',
    );
    assert.equal(secondBody.length, firstBody.length);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('known placeholder SESSION_SECRET values are treated as unset', () => {
  const run = runStartProd(['--print-session-secret-status'], { SESSION_SECRET: 'changeme' });
  assert.equal(run.status, 0, run.stderr);
  const body = lastJsonLine(run.stdout);
  assert.notEqual(body.source, 'explicit', 'a known placeholder must not be accepted as a real secret');
});

test('the session secret value is never interpolated into a log call', () => {
  const logCalls = [...startProdSource.matchAll(/\blog\(`[^`]*`\)/g)].map((match) => match[0]);
  assert.ok(logCalls.length > 0, 'sanity check: the script must have log(...) calls to scan');
  for (const call of logCalls) {
    assert.doesNotMatch(
      call,
      /\$\{(explicit|generated|persisted|SESSION_SECRET)\}/,
      `a log() call must never interpolate the secret value itself: ${call}`,
    );
  }
});

// --------------------------------------------------------------------------
// Build artifact preflight
// --------------------------------------------------------------------------

test('a missing production build fails fast with an actionable message instead of a silent exit', () => {
  const tmpCwd = mkdtempSync(path.join(os.tmpdir(), 'akbaral-preflight-'));
  try {
    const run = spawnSync(process.execPath, [START_PROD], {
      cwd: tmpCwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        PORT: '',
        AKBARAL_WEB_PORT: '',
        AKBARAL_API_PORT: '',
        SESSION_SECRET: 'x'.repeat(40),
        AKBARAL_AUTO_BUILD: 'false',
      },
    });
    assert.equal(run.status, 1, 'must exit non-zero — never hang or exit 0 with no build output');
    assert.match(run.stderr ?? '', /cannot start: the production build has not run/i);
    assert.match(run.stderr ?? '', /npm ci --include=dev && npm run build/);
    assert.match(run.stderr ?? '', /AKBARAL_AUTO_BUILD=true/);
  } finally {
    rmSync(tmpCwd, { recursive: true, force: true });
  }
});

test('AKBARAL_AUTO_BUILD is wired to self-heal a missing build via "npm run build"', () => {
  assert.match(startProdSource, /AKBARAL_AUTO_BUILD/);
  assert.match(
    startProdSource,
    /runStep\('production build \(npm run build\)', 'npm', \['run', 'build'\]\)/,
    'AKBARAL_AUTO_BUILD=true must invoke the real "npm run build"',
  );
});

test('the private mission server is disabled by default and requires the exact true opt-in', () => {
  const disabled = runMissionStartupHarness('missing-db', false);
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.deepEqual(disabled.record.spawns.map((spawn) => spawn.kind), ['web', 'api']);
  assert.deepEqual(disabled.record.fetches, []);
  assert.doesNotMatch(`${disabled.stdout}\n${disabled.stderr}`, /private mission/i);

  for (const value of ['1', 'yes', 'TRUE', ' true ']) {
    const notExact = runStartProd(['--print-ports'], { ZA141251SA_MISSION_SERVER_ENABLED: value });
    assert.equal(notExact.status, 0, notExact.stderr);
    assert.deepEqual(lastJsonLine(notExact.stdout), {
      roles: 'both',
      publicPort: 3000,
      webPort: 3000,
      apiPort: 4000,
    });
  }
});

test('private mission startup hard-pins loopback, port and the existing database before public tiers', () => {
  const run = runMissionStartupHarness('ready');
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.record.spawns.map((spawn) => spawn.kind), ['mission', 'web', 'api']);
  assert.deepEqual(run.record.fetches, ['http://127.0.0.1:4200/api/health']);

  const mission = run.record.spawns[0];
  assert.equal(mission.command, 'node');
  assert.match(mission.args[0] ?? '', /[/\\]dist[/\\]scripts[/\\]mission-serve\.js$/);
  assert.deepEqual(mission.env, {
    NODE_ENV: 'production',
    PORT: '',
    ZA141251SA_BIND_HOST: '127.0.0.1',
    ZA141251SA_PORT: '4200',
    // The operator's configured mission database is honoured, not swapped for a path this
    // file happens to prefer: the wrapper and the child must point at the same database.
    ZA141251SA_DATABASE_URL: 'file:/tmp/not-allowed.db',
  });
  assert.match(run.stdout, /private mission readiness verified at http:\/\/127\.0\.0\.1:4200\/api\/health/);
});

test('mission migrations run as a blocking boot step, on the database the mission child then opens', () => {
  const run = runMissionStartupHarness('ready');
  assert.equal(run.status, 0, run.stderr);
  // One order log across both process boundaries, so the sequence is pinned rather than
  // inferred: platform migrations, then mission migrations, then the mission child, then
  // the public tiers.
  const order = run.record.order.join('\n');
  assert.match(
    order,
    /step:.*dist\/src\/db\/migrate\.js[\s\S]*mission-migrate[\s\S]*spawn:mission[\s\S]*spawn:web/,
    `boot must migrate the mission database after the platform step and before any tier: ${order}`,
  );
  const missionStep = run.record.spawnSteps.find((args) => args.some((arg) => arg.includes('mission-migrate')));
  assert.ok(missionStep, 'the mission migration step must be a real, blocking runStep');
  assert.match(missionStep.join(' '), /mission-run\.mjs mission-migrate --root /, 'the step resolves through the runtime-safe entry');
  const index = run.record.spawnSteps.indexOf(missionStep);
  assert.equal(
    run.record.stepEnvs[index]?.ZA141251SA_DATABASE_URL,
    run.record.spawns[0]?.env.ZA141251SA_DATABASE_URL,
    'migrating one database and serving another is the failure this step exists to prevent',
  );
});

test('a web-only tier does not migrate the mission database', () => {
  const run = runMissionStartupHarness('ready', true, 'file:/tmp/not-allowed.db', 'web');
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    run.record.spawnSteps,
    [],
    'the web tier owns no database writes: not the platform migrations, not the mission migrations',
  );
  assert.match(run.record.order.join('\n'), /spawn:mission/, 'the mission child is still supervised where it is enabled');
});

test('the mission migration step is skipped out loud, never as a success, when there is no mission database', () => {
  const run = runMissionStartupHarness('missing-db', false);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(
    !run.record.spawnSteps.some((args) => args.some((arg) => arg.includes('mission-migrate'))),
    'no mission database must mean no migration step, not a step that silently passes',
  );
  assert.match(
    `${run.stdout}\n${run.stderr}`,
    /no mission database at [^ ]+ — mission migrations skipped \(this deployment has no mission database; nothing was reported as migrated\)/,
    'the skip must name the target it looked for and say nothing was reported as migrated',
  );
});

test('private mission startup refuses a missing /data/mission.db without inventing one', () => {
  // No configured URL at all: the wrapper falls back to the DATA_DIR default it shares with
  // src/mission/database.ts, and refuses to invent a database. The refusal is loud and named,
  // no mission child is spawned and nothing is probed — but the public tiers are not held
  // hostage by a private tier that was never configured correctly.
  const run = runMissionStartupHarness('missing-db', true, null);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.record.spawns.map((spawn) => spawn.kind), ['web', 'api'], 'a refused private tier must not stop the public tiers');
  assert.ok(
    !run.record.spawns.some((spawn) => spawn.kind === 'mission'),
    'the mission child must not be launched against a database the wrapper refused',
  );
  assert.deepEqual(run.record.fetches, [], 'no readiness probe may be sent to a tier that was refused');
  assert.match(run.stderr, /\/data\/mission\.db does not exist/);
  assert.match(run.stderr, /will not create or select an alternate database/);
  assert.match(
    `${run.stdout}\n${run.stderr}`,
    /MISSION TIER UNAVAILABLE — the private mission server never became ready/,
    'the refusal must be reported as a decision the container made, not as a line in a log nobody reads',
  );
});

test('a configured mission database that does not exist is refused by name, not replaced', () => {
  const run = runMissionStartupHarness('missing-db');
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /\/tmp\/not-allowed\.db does not exist/, 'the refusal must name the database the operator configured');
  assert.match(run.stderr, /will not create or select an alternate database/);
  // The platform migrations still run, because the public tiers need their own database; the
  // mission migrations are skipped out loud, and the mission child is never started.
  assert.ok(
    !run.record.spawnSteps.some((args) => args.some((arg) => arg.includes('mission-migrate'))),
    'a refused mission database must never be migrated, created, or selected as an alternate',
  );
  assert.ok(
    run.record.spawnSteps.some((args) => args.some((arg) => arg.includes('db/migrate'))),
    'the public tiers still get their own migration step even when the private tier is refused',
  );
});

test('ZA141251SA_MISSION_REQUIRED=true restores the fail-closed container for a refused private tier', () => {
  // The explicit opt-in keeps its original meaning: a deployment that refuses to serve without
  // its private half exits non-zero. It is simply no longer the default.
  const run = runMissionStartupHarness('missing-db', true, 'file:/tmp/not-allowed.db', 'both', {
    ZA141251SA_MISSION_REQUIRED: 'true',
  });
  assert.equal(run.status, 1, 'the required variant must still terminate the container');
  assert.match(run.stderr, /will not create or select an alternate database/);
  assert.match(
    run.stderr,
    /ZA141251SA_MISSION_REQUIRED=true is set, so this container exits now/,
    'the exit must say that the owner asked for it, not look like an unexplained crash',
  );
});

test('an enabled private mission server requires the compiled production entry', () => {
  const run = runMissionStartupHarness('missing-entry');
  assert.equal(run.status, 1);
  assert.deepEqual(run.record.spawns, []);
  assert.match(`${run.stdout}\n${run.stderr}`, /dist[/\\]scripts[/\\]mission-serve\.js/);
});

test('a mission tier that never becomes ready is retried loudly and never costs the public tiers', () => {
  // The outage this pins: readiness used to be awaited BEFORE the public tiers were launched,
  // with a 30 s budget, so a private tier that needed longer meant the container died before the
  // web tier ever bound — and it died again on every restart. Now the public tiers are up, the
  // probe is reported while it runs, a non-ready child is stopped and relaunched within a bounded
  // budget, and giving up is an explicit, loud decision.
  const run = runMissionStartupHarness('readiness-timeout', true, 'file:/tmp/not-allowed.db', 'both', {
    ZA141251SA_MISSION_START_ATTEMPTS: '2',
    ZA141251SA_MISSION_RESTART_DELAY_MS: '0',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    run.record.spawns.map((spawn) => spawn.kind),
    ['mission', 'web', 'api', 'mission'],
    'the public tiers must launch anyway, and the private tier must be retried within its budget',
  );
  assert.ok(run.record.fetches.length >= 1, 'the readiness probe must actually have been attempted');
  assert.ok(
    run.record.fetches.every((url) => url === 'http://127.0.0.1:4200/api/health'),
    `every probe must go to the address the child was launched on: ${run.record.fetches.join(', ')}`,
  );
  assert.deepEqual(
    run.record.kills,
    [
      { kind: 'mission', signal: 'SIGTERM' },
      { kind: 'mission', signal: 'SIGTERM' },
    ],
    'a non-ready child is stopped before the next attempt — never a silent restart loop, and never the public tiers',
  );
  const out = `${run.stdout}\n${run.stderr}`;
  assert.match(out, /private mission readiness timed out/);
  assert.match(out, /health payload did not satisfy the private readiness contract/, 'the log must say WHY the probe was rejected, not just that it failed');
  assert.match(out, /ownerAccounts=0/, 'the rejected payload must be quoted back verbatim');
  assert.match(out, /MISSION TIER NOT READY — attempt 1\/2/);
  assert.match(out, /MISSION TIER UNAVAILABLE/);
  assert.match(out, /the public tiers stay up/, 'the report must say what is still serving');
  assert.match(out, /ZA141251SA_MISSION_READINESS_TIMEOUT_MS/, 'the escape hatches must be named in the failure itself');
});

test('ZA141251SA_MISSION_REQUIRED=true makes a never-ready private tier a non-zero container exit', () => {
  const run = runMissionStartupHarness('readiness-timeout', true, 'file:/tmp/not-allowed.db', 'both', {
    ZA141251SA_MISSION_REQUIRED: 'true',
    ZA141251SA_MISSION_START_ATTEMPTS: '1',
    ZA141251SA_MISSION_RESTART_DELAY_MS: '0',
  });
  assert.equal(run.status, 1, 'the explicit fail-closed opt-in must still exit non-zero');
  assert.match(run.stderr, /ZA141251SA_MISSION_REQUIRED=true is set, so this container exits now/);
  assert.ok(
    run.record.kills.some((kill) => kill.kind === 'web'),
    'an operator-requested exit still stops the siblings it launched — no orphaned tiers',
  );
});

test('an unexpected mission exit is retried without stopping the public tiers', () => {
  const run = runMissionStartupHarness('unexpected-exit', true, 'file:/tmp/not-allowed.db', 'both', {
    ZA141251SA_MISSION_START_ATTEMPTS: '2',
    ZA141251SA_MISSION_RESTART_DELAY_MS: '0',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.record.spawns.map((spawn) => spawn.kind), ['mission', 'web', 'api', 'mission']);
  assert.deepEqual(
    run.record.kills,
    [],
    'a private child that exited on its own is not killed again, and the public tiers are never killed for it — that sibling kill is exactly what took the product down',
  );
  const out = `${run.stdout}\n${run.stderr}`;
  assert.match(out, /MISSION TIER RESTART — the ready private mission child exited unexpectedly with code 0/);
  assert.match(out, /relaunching it \(the public tiers are unaffected\)/);
  assert.match(out, /MISSION TIER UNAVAILABLE/);
});

test('signal termination of the mission child is reported and retried, not swallowed', () => {
  const run = runMissionStartupHarness('signal-exit', true, 'file:/tmp/not-allowed.db', 'both', {
    ZA141251SA_MISSION_START_ATTEMPTS: '1',
    ZA141251SA_MISSION_RESTART_DELAY_MS: '0',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.record.spawns.map((spawn) => spawn.kind), ['mission', 'web', 'api']);
  assert.ok(run.record.kills.every((kill) => kill.kind === 'mission'), 'the public tiers are never killed for the private tier');
  assert.match(
    run.stderr,
    /MISSION TIER RESTART — the ready private mission child was terminated by signal SIGTERM/,
    'the signal must be named in the report, not swallowed as an anonymous restart',
  );
  assert.match(
    run.stderr,
    /the 1-launch budget is used up/,
    'the report must state how much supervision it attempted before giving up',
  );
});

test('the wrapper probes exactly the address it launched the child on, and never a wider one', () => {
  // The drift this pins was the second half of the outage: the readiness probe used literals that
  // were also *forced* onto the child, so "what is bound" and "what is probed" agreed only by
  // accident. Both now come from missionBindTarget(), and this asserts the agreement on the real
  // spawn env and the real probe URL — not on a re-derived copy of either.
  const moved = runMissionStartupHarness('ready', true, 'file:/tmp/not-allowed.db', 'both', {
    ZA141251SA_MISSION_PORT: '4321',
  });
  assert.equal(moved.status, 0, moved.stderr);
  const child = moved.record.spawns.find((spawn) => spawn.kind === 'mission');
  assert.ok(child, 'the mission child must have been launched');
  assert.equal(child.env.ZA141251SA_PORT, '4321', 'an explicit ZA141251SA_MISSION_PORT moves the child');
  assert.deepEqual(
    moved.record.fetches,
    ['http://127.0.0.1:4321/api/health'],
    '…and the probe follows it to the same address; a probe pointed elsewhere is indistinguishable from a dead service',
  );
});

test('an inherited wildcard bind or injected platform port cannot move the private listener', () => {
  // Deliberately hostile inherited values are part of the harness for exactly this reason: the
  // private tier must stay loopback:4200 unless the operator names the mission-specific variable.
  const run = runMissionStartupHarness('ready');
  assert.equal(run.status, 0, run.stderr);
  const child = run.record.spawns.find((spawn) => spawn.kind === 'mission');
  assert.ok(child, 'the mission child must have been launched in this scenario too');
  assert.equal(child.env.ZA141251SA_BIND_HOST, '127.0.0.1', 'ZA141251SA_BIND_HOST=0.0.0.0 must not expose the owner dashboard');
  assert.equal(child.env.ZA141251SA_PORT, '4200', 'an injected platform PORT/Z141251SA_PORT must not move the private listener');
  assert.deepEqual(run.record.fetches, ['http://127.0.0.1:4200/api/health']);
});

test('the readiness budget is sized for a real boot, not for a fast laptop', () => {
  // Measured on the production shape (PostgreSQL, 4,001 imported agents, no network latency): the
  // mission child needed ~38 s to reach its own listener. The old 30 s window with a 1 s per-request
  // timeout therefore could never be satisfied — every boot was a timeout. These floors encode that
  // lesson so the numbers cannot be "tidied" back down.
  const missionSource = readFileSync('src/mission/database.ts', 'utf8');
  assert.match(missionSource, /ZA141251SA_BIND_HOST[\s\S]{0,160}?'127\.0\.0\.1'/, "the mission server's own default bind must stay loopback");
  assert.match(missionSource, /ZA141251SA_PORT[\s\S]{0,120}?4200/, 'the mission server must keep defaulting to port 4200');
  const resolver = readFileSync('scripts/mission-db-target.mjs', 'utf8');
  assert.match(resolver, /ZA141251SA_MISSION_READINESS_TIMEOUT_MS, 180_000/, 'the default readiness budget must stay generous');
  assert.match(resolver, /ZA141251SA_MISSION_HEALTH_TIMEOUT_MS, 5_000/, 'the per-request timeout must survive a busy event loop');
  assert.match(resolver, /ZA141251SA_MISSION_START_ATTEMPTS, 5/);
  assert.match(resolver, /ZA141251SA_MISSION_REQUIRED[\s\S]{0,120}=== 'true'|required: [\s\S]{0,80}=== 'true'/, 'terminating the container must remain an explicit opt-in');
});

test('mission startup never wires workers, a public route, or a proxy', () => {
  assert.match(
    startProdSource,
    /const MISSION_SERVER_ENABLED = process\.env\.ZA141251SA_MISSION_SERVER_ENABLED === 'true';/,
  );
  assert.doesNotMatch(startProdSource, /mission-(?:money|chat|bounty)-worker/);
  assert.doesNotMatch(startProdSource, /ZA141251SA_(?:MONEY|CHAT|BOUNTY)_WORKER_ENABLED/);
  assert.doesNotMatch(startProdSource, /mission:init|ZA141251SA_SESSION_SECRET/);
  assert.doesNotMatch(startProdSource, /NEXT_MISSION|mission.*rewrite|mission.*proxy/i);
});

test('startup preflight checks run before any tier is launched', () => {
  const preflightIndex = startProdSource.indexOf('missingBuildArtifacts()');
  const webLaunchIndex = startProdSource.indexOf("launch('web'");
  const apiLaunchIndex = startProdSource.indexOf("launch('api'");
  assert.ok(preflightIndex > -1 && webLaunchIndex > -1 && apiLaunchIndex > -1);
  assert.ok(preflightIndex < webLaunchIndex, 'the build preflight must run before the web tier launches');
  assert.ok(preflightIndex < apiLaunchIndex, 'the build preflight must run before the api tier launches');
});

// --------------------------------------------------------------------------
// Database migrations run before the application accepts traffic
// --------------------------------------------------------------------------

test('database migrations run before the tiers start', () => {
  const migrateIndex = startProdSource.indexOf('applying database migrations');
  const webLaunchIndex = startProdSource.indexOf("launch('web'");
  const apiLaunchIndex = startProdSource.indexOf("launch('api'");
  assert.ok(migrateIndex > -1, 'the script must run migrations');
  assert.ok(migrateIndex < webLaunchIndex, 'migrations must run before the web tier launches');
  assert.ok(migrateIndex < apiLaunchIndex, 'migrations must run before the api tier launches');
});

// --------------------------------------------------------------------------
// PORT handling regression guard (StackHost injects PORT)
// --------------------------------------------------------------------------

test('a platform-injected PORT is still honored after the startup fix', () => {
  const run = runStartProd(['--print-ports'], { PORT: '8080', SESSION_SECRET: 'x'.repeat(40) });
  assert.equal(run.status, 0, run.stderr);
  const body = lastJsonLine(run.stdout);
  assert.equal(body.publicPort, 8080, 'the public (web) tier must still bind the platform-injected PORT');
  assert.equal(body.apiPort, 4000, 'the API tier must still stay internal by default');
});
