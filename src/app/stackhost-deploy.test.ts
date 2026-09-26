import { readFileSync, existsSync, rmSync, mkdtempSync, statSync } from 'node:fs';
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
      ...env,
    },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function lastJsonLine(output: string): Record<string, unknown> {
  return JSON.parse(output.trim().split('\n').at(-1) ?? '{}');
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
  // The image may be the GHCR original OR its Docker Hub mirror
  // (.github/workflows/mirror-ghcr-to-dockerhub.yml republishes the very same
  // digest as docker.io/mrzain555/akbaral, which is what the deployed
  // stackhost.yaml currently pins). What matters for the 512MB ceiling is that
  // a PREBUILT image is pulled and no source build runs on the platform.
  // Before 2026-09-26 this assertion accepted only the ghcr.io spelling, so the
  // merged Docker Hub pin left `npm test` failing on a clean checkout.
  assert.match(
    stackhostSource,
    /image:\s*"?(?:ghcr\.io\/azadar-templates\/akbaral|(?:docker\.io\/)?mrzain555\/akbaral):[\w.-]+/,
    'stackhost.yaml must run a prebuilt image (GHCR or its Docker Hub mirror) — a source build needs ~1GB and the free tier has 512MB',
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
