import { readFileSync, existsSync, rmSync, mkdtempSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
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
const packageJsonSource = readFileSync(path.resolve('package.json'), 'utf8');

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
  // StackHost requires `commands.build` to be a YAML list (array) — a single
  // string with `&&` is a schema violation that causes the platform's build
  // step to be skipped or to fail with no application logs (2-5s silent exit).
  //
  // Memory fix 2026-09-19 (after the free plan's 512 MB container kept failing
  // at its "Installing dependencies" step): every build phase is now the
  // measured, heap-capped form. Untuned peaks on a clean tree were npm ci
  // ~325 MB, `npx tsc` ~475 MB, `next build --webpack` ~668 MB and the
  // Turbopack default ~1284 MB — each of which overshoots 512 MB alone. The
  // tuned equivalents (direct binaries, no npx wrapper; heap caps; no in-build
  // type check) measure ~325/404/464 MB. The running stack is ~336 MB, so the
  // free plan can RUN the app — it was only ever too small to BUILD it untuned.
  // npm's peak during `npm ci` depends on its cache: ~313-344 MB with an empty
  // cache (fresh container) vs ~719-743 MB with a warm one (reused container),
  // on the same tree. Both reproduced repeatedly; `--prefer-online` does not
  // avoid the warm path. Clearing the cache first is what makes this step fit
  // 512 MB deterministically, so the two lines must stay together and in order.
  assert.match(
    stackhostSource,
    /build:\s*\n\s*- "npm cache clean --force"\n\s*- "npm ci --no-audit --no-fund"/,
    'the install must clear npm\'s cache first — with a warm ~/.npm/_cacache, npm ci peaks at ~740 MB and the 512 MB container kills it',
  );
  assert.doesNotMatch(
    stackhostSource,
    /- "npm run build"/,
    'stackhost.yaml must NOT use "npm run build" — it pulls the Turbopack default (~1284 MB peak), which overshoots the 512 MB free-plan ceiling. Use the measured heap-capped steps instead.',
  );
  assert.doesNotMatch(
    stackhostSource,
    /- "npx /,
    'build steps must call ./node_modules/.bin/<tool> directly — npx adds an npm wrapper process (~80 MB) to every step, which matters on a 512 MB container',
  );
  // The API compile must stay present and heap-capped (tsc alone peaked at
  // ~475 MB uncapped; the cap is what keeps it inside the container).
  assert.match(
    stackhostSource,
    /- "NODE_OPTIONS=--max-old-space-size=384 \.\/node_modules\/\.bin\/tsc -p tsconfig\.backend\.json"/,
  );
  // The Next.js build must stay on the low-memory, Webpack path — the plain
  // `next build` (Turbopack) is the single biggest overshoot.
  assert.match(
    stackhostSource,
    /- "AKBARAL_LOW_MEMORY_BUILD=1 NODE_OPTIONS=--max-old-space-size=320 \.\/node_modules\/\.bin\/next build --webpack"/,
  );
  // tsc does not emit .mjs: dist/ is only complete once the runtime assets are
  // copied. Both build paths (package.json and stackhost.yaml) must call the
  // SAME script, so the two cannot drift.
  assert.match(
    stackhostSource,
    /- "node scripts\/copy-backend-runtime-assets\.mjs"/,
    'stackhost.yaml must copy src/db/*.mjs into dist/ — pg-worker.mjs is spawned by path at runtime and tsc never emits it',
  );
  assert.match(
    packageJsonSource,
    /"build": "tsc -p tsconfig\.backend\.json && node scripts\/copy-backend-runtime-assets\.mjs && next build"/,
    'package.json build must call the shared copy script (not an inline node -e), so stackhost.yaml and the Docker/CI build stay identical',
  );
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

test('the low-memory build flag exists in next.config.mjs and only relaxes the in-build type check', () => {
  const nextConfigSource = readFileSync(path.resolve('next.config.mjs'), 'utf8');
  assert.match(
    nextConfigSource,
    /AKBARAL_LOW_MEMORY_BUILD/,
    'next.config.mjs must honour AKBARAL_LOW_MEMORY_BUILD=1 (set by stackhost.yaml)',
  );
  assert.match(
    nextConfigSource,
    /lowMemoryBuild \? \{ typescript: \{ ignoreBuildErrors: true \} \}/,
    'the flag may ONLY drop the in-build type check (the ~475 MB phase) — it must not relax anything else',
  );
  // The type check must still exist as an explicit, enforced command.
  assert.match(
    packageJsonSource,
    /"typecheck": "tsc --noEmit -p tsconfig\.json"/,
    'skipping the in-build type check is only acceptable because `npm run typecheck` enforces the same types',
  );
});

test('the backend runtime asset copy is real: dist/src/db/pg-worker.mjs after tsc + copy', () => {
  // The script must be the single source of truth for what gets copied, and it
  // must fail loudly rather than silently produce a dist/ that breaks at the
  // first PostgreSQL worker spawn.
  const scriptSource = readFileSync(path.resolve('scripts/copy-backend-runtime-assets.mjs'), 'utf8');
  for (const asset of ['pg-worker.mjs', 'pg-connection.mjs']) {
    assert.match(scriptSource, new RegExp(asset.replace('.', '\\.')), `the copy script must handle ${asset}`);
    assert.ok(
      existsSync(path.resolve('src', 'db', asset)),
      `${asset} must exist in src/db — it is spawned by path from __dirname at runtime`,
    );
  }
  assert.match(scriptSource, /process\.exit\(1\)/, 'a missing asset must fail the build, not warn');

  // Prove the copy actually works on a throwaway tree: lay out a fake dist/src,
  // run the script with cwd pointed at a temp fixture, and read the result back.
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'akbaral-copy-assets-'));
  try {
    mkdirSync(path.join(fixture, 'dist', 'src'), { recursive: true });
    mkdirSync(path.join(fixture, 'src', 'db'), { recursive: true });
    mkdirSync(path.join(fixture, 'scripts'), { recursive: true });
    for (const asset of ['pg-worker.mjs', 'pg-connection.mjs']) {
      copyFileSync(path.resolve('src', 'db', asset), path.join(fixture, 'src', 'db', asset));
    }
    copyFileSync(
      path.resolve('scripts', 'copy-backend-runtime-assets.mjs'),
      path.join(fixture, 'scripts', 'copy-backend-runtime-assets.mjs'),
    );
    const run = spawnSync(process.execPath, ['scripts/copy-backend-runtime-assets.mjs'], {
      cwd: fixture,
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, `copy script must exit 0 on a valid tree (stderr: ${run.stderr})`);
    for (const asset of ['pg-worker.mjs', 'pg-connection.mjs']) {
      const copied = path.join(fixture, 'dist', 'src', 'db', asset);
      assert.ok(existsSync(copied), `${asset} must exist in dist/src/db after the copy`);
      assert.equal(
        readFileSync(copied, 'utf8'),
        readFileSync(path.resolve('src', 'db', asset), 'utf8'),
        `${asset} must be copied byte-for-byte`,
      );
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
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
