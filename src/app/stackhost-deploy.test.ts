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
): HarnessResult {
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
const record = { spawns: [], spawnSteps: [], fetches: [], kills: [] };
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
childProcess.spawnSync = (_command, args = []) => {
  record.spawnSteps.push(args.map(String));
  return { status: 0, signal: null };
};

fs.existsSync = (input) => {
  const value = String(input);
  if (value === '/data/mission.db') return scenario !== 'missing-db';
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
      json: async () => ({ status: 'ok', service: 'mission', database: '/data/mission.db', audit: true, ledger: true, ownerAccounts: 0, vaultConfigured: false }),
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
    json: async () => ({ status: 'ok', service: 'mission', database: '/data/mission.db', audit: true, ledger: true, ownerAccounts: 1, vaultConfigured: true }),
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
        AKBARAL_ROLES: 'both',
        AKBARAL_AUTO_BUILD: 'false',
        DISABLE_BACKUP_CRON: 'true',
        PORT: '',
        AKBARAL_WEB_PORT: '',
        AKBARAL_API_PORT: '',
        SESSION_SECRET: 'x'.repeat(40),
        ZA141251SA_MISSION_SERVER_ENABLED: enabled ? 'true' : '',
        // Deliberately hostile inherited values: the mission child must replace
        // every one of them rather than forwarding them.
        ZA141251SA_BIND_HOST: '0.0.0.0',
        ZA141251SA_PORT: '9999',
        ZA141251SA_DATABASE_URL: 'file:/tmp/not-allowed.db',
      },
    });
    const record: HarnessRecord = existsSync(recordPath)
      ? JSON.parse(readFileSync(recordPath, 'utf8'))
      : { spawns: [], spawnSteps: [], fetches: [], kills: [] };
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
    ZA141251SA_DATABASE_URL: 'file:/data/mission.db',
  });
  assert.match(run.stdout, /private mission readiness verified at http:\/\/127\.0\.0\.1:4200\/api\/health/);
});

test('private mission startup refuses a missing /data/mission.db without spawning any tier', () => {
  const run = runMissionStartupHarness('missing-db');
  assert.equal(run.status, 1);
  assert.deepEqual(run.record.spawns, []);
  assert.deepEqual(run.record.fetches, []);
  assert.match(run.stderr, /\/data\/mission\.db does not exist/);
  assert.match(run.stderr, /will not create or select an alternate database/);
});

test('an enabled private mission server requires the compiled production entry', () => {
  const run = runMissionStartupHarness('missing-entry');
  assert.equal(run.status, 1);
  assert.deepEqual(run.record.spawns, []);
  assert.match(`${run.stdout}\n${run.stderr}`, /dist[/\\]scripts[/\\]mission-serve\.js/);
});

test('private readiness failure times out non-zero before public tiers start', () => {
  const run = runMissionStartupHarness('readiness-timeout');
  assert.equal(run.status, 1);
  assert.deepEqual(run.record.spawns.map((spawn) => spawn.kind), ['mission']);
  assert.ok(run.record.fetches.length >= 1);
  assert.ok(run.record.fetches.every((url) => url === 'http://127.0.0.1:4200/api/health'));
  assert.deepEqual(run.record.kills, [{ kind: 'mission', signal: 'SIGTERM' }]);
  assert.match(run.stderr, /private mission readiness timed out/);
});

test('an unexpected required mission exit terminates non-zero and stops public siblings', () => {
  const run = runMissionStartupHarness('unexpected-exit');
  assert.equal(run.status, 1);
  assert.deepEqual(run.record.spawns.map((spawn) => spawn.kind), ['mission', 'web', 'api']);
  assert.deepEqual(run.record.kills, [
    { kind: 'mission', signal: 'SIGTERM' },
    { kind: 'web', signal: 'SIGTERM' },
    { kind: 'api', signal: 'SIGTERM' },
  ]);
  assert.match(run.stderr, /exited unexpectedly with code 0; terminating the container/);
});

test('signal termination of the required mission child is also a non-zero failure', () => {
  const run = runMissionStartupHarness('signal-exit');
  assert.equal(run.status, 1);
  assert.deepEqual(run.record.spawns.map((spawn) => spawn.kind), ['mission', 'web', 'api']);
  assert.match(run.stderr, /terminated by signal SIGTERM; terminating the container/);
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
