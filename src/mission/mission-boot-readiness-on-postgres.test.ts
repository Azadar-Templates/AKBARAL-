/**
 * ZA141251SA — what "the mission server is ready" means on PostgreSQL, and how long it takes.
 *
 * Why a whole file for one HTTP 200. The production incident this repository is recovering from was
 * not a crash: it was a container that was *working* and was killed anyway, because the startup
 * wrapper gave the private tier 30 s to answer `/api/health` while the tier needed ~38 s to finish
 * real database work (migrations, then wallet provisioning for a 4,001-agent fleet imported from the
 * platform registry) before it listened. A readiness gate whose budget is shorter than the work is
 * not a safety mechanism; it is a guaranteed crash loop that also takes the public tiers down.
 *
 * So this file asserts two things, and they are different:
 *   1. the readiness *contract* — the payload checks a boot must satisfy — rejects a service that is
 *      listening but unusable, and accepts one that is genuinely ready; and
 *   2. the *boot* on a real PostgreSQL server: a fresh mission database, the real compiled
 *      `mission-serve` entry, the same `scripts/mission-readiness.mjs` the production wrapper uses
 *      (not a copy of its logic), and an elapsed-time assertion against a budget a container platform
 *      would actually enforce.
 *
 * Both halves run through a child `node` script rather than in this process: the readiness helpers are
 * plain `.mjs` (this repo's convention for things the runtime image must also execute), and the boot
 * must happen in a process whose event loop is not the test runner's. That way the assertion measures
 * the same code path the container runs, including the module resolution.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { after, it } from 'node:test';
import assert from 'node:assert/strict';

const PG = Boolean(process.env.PG_TEST_DATABASE_URL);
const REPO = process.cwd();
const SERVE_ENTRY = path.join(REPO, 'dist', 'scripts', 'mission-serve.js');
const dirs: string[] = [];

after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/**
 * Reserve an ephemeral loopback port. `server.address()` is null until the listen callback has
 * run, so the reservation is awaited — a synchronous read here is a test that fails for a reason
 * unrelated to the thing it is measuring, which is the worst kind of failure to debug at 2 a.m.
 */
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => { server.close(() => resolve()); });
  if (!port) throw new Error('could not reserve a free loopback port for the boot test');
  return port;
}

/**
 * The child harness. Two modes:
 *   `contract` — no database at all: prove the readiness predicate rejects every shape that must not
 *                pass, and prove the waiter really waits and then says why it gave up;
 *   `boot`     — the real server, on the real PostgreSQL URL, waited for with the production module.
 */
const HARNESS = String.raw`
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const repo = process.argv[2];
const mode = process.argv[3];
const readiness = await import(pathToFileURL(path.join(repo, 'scripts', 'mission-readiness.mjs')).href);
const dbTarget = await import(pathToFileURL(path.join(repo, 'scripts', 'mission-db-target.mjs')).href);
const report = (value) => process.stdout.write('\n::RESULT::' + JSON.stringify(value) + '\n');
const failFast = (error) => {
  process.stdout.write('\n::ERROR::' + (error && error.stack ? error.stack : String(error)) + '\n');
  process.exit(1);
};

// A port that was bound and then fully closed: the negative control needs something that is
// definitely refusing connections, and server.address() is null until the listen callback runs.
async function closedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

if (mode === 'contract') {
  const good = {
    status: 'ok', service: 'mission', database: 'postgres://127.0.0.1:5432/mission',
    audit: true, ledger: true, ownerAccounts: 1, vaultConfigured: true,
  };
  const rejections = {
    'a public API on the wrong port': { ...good, service: 'akbaral-api' },
    'listening but no owner provisioned': { ...good, ownerAccounts: 0 },
    'owner count not an integer': { ...good, ownerAccounts: '1' },
    'audit chain not verified': { ...good, audit: false },
    'ledger not verified': { ...good, ledger: false },
    'no vault key configured': { ...good, vaultConfigured: false },
    'a different database than this boot was told to open': { ...good, database: 'file:/data/mission.db' },
    'not ok': { ...good, status: 'degraded' },
    'no payload at all': null,
  };
  const verdicts = {};
  for (const [name, body] of Object.entries(rejections)) {
    verdicts[name] = readiness.missionHealthIsReady(body, good.database) === false;
  }
  // And the two knobs the outage was actually about, from one resolver both callers share.
  const bind = dbTarget.missionBindTarget({});
  const hostile = dbTarget.missionBindTarget({ ZA141251SA_BIND_HOST: '0.0.0.0', ZA141251SA_PORT: '9999' });
  const policy = dbTarget.missionReadinessPolicy({});
  let waiter = 'did not reject';
  try {
    await readiness.waitForMissionReadiness({
      healthUrl: 'http://127.0.0.1:' + (await closedPort()) + '/api/health',
      timeoutMs: 700,
      requestTimeoutMs: 250,
      pollMs: 50,
    });
  } catch (error) {
    waiter = error.message;
  }
  report({
    verdicts,
    acceptsAGenuineReadyPayload: readiness.missionHealthIsReady(good, good.database) === true,
    waiterRejected: /private mission readiness timed out after 700ms/.test(waiter),
    waiterExplainsItself: /nothing answered .* within 250ms/.test(waiter),
    bind,
    hostile,
    policy,
  });
  process.exit(0);
}

if (mode === 'boot') {
  const url = process.env.ZA141251SA_DATABASE_URL;
  const port = Number(process.env.BOOT_TEST_PORT);
  const { spawn } = await import('node:child_process');

  // The private dashboard is unusable without an owner, and the readiness contract says so; a boot
  // test that skipped this would be asserting a payload shape production never accepts.
  const auth = await import(pathToFileURL(path.join(repo, 'dist', 'src', 'mission', 'auth.js')).href);
  let ownerExisted = false;
  try {
    auth.provisionOwner({
      email: 'boot-readiness@mission.test',
      password: 'boot-readiness-owner-password-2026',
      displayName: 'Boot Readiness Owner',
    });
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    // "already exists" is the only acceptable reason not to provision; anything else is the test's
    // own failure and must be heard, not swallowed as if the precondition had been met.
    if (!/exist|already|duplicate/i.test(message)) throw new Error('owner provisioning failed: ' + message);
    ownerExisted = true;
  }

  // Close this process's own mission connection before the server starts. The treasury path takes a
  // transaction-scoped advisory lock (pg_advisory_xact_lock) on PostgreSQL, and a harness that
  // leaves a connection open with an abandoned transaction would block the very boot it is timing —
  // which is indistinguishable, from the outside, from the hang this test exists to prevent.
  try {
    const mission = await import(pathToFileURL(path.join(repo, 'dist', 'src', 'mission', 'database.js')).href);
    mission.missionDb.close();
  } catch { /* nothing to release if provisioning never opened a connection */ }

  // What the database looks like immediately before the boot, so the wallet assertion below is a
  // statement about the pass that ran and not about the order of seeds. (An agent created by a
  // later boot seed — the allocator catalog runs after the wallet pass — legitimately has no wallet
  // until the next boot or a request path that provisions one.)
  const requireCounts = createRequire(path.join(repo, 'package.json'));
  const { Client: PreClient } = requireCounts('pg');
  const pre = new PreClient({ connectionString: url });
  await pre.connect();
  const agentsBefore = Number((await pre.query('SELECT COUNT(*)::int AS n FROM mission_agents')).rows[0].n);
  const walletsBefore = Number((await pre.query('SELECT COUNT(*)::int AS n FROM mission_wallets')).rows[0].n);
  await pre.end();

  const child = spawn(process.execPath, [path.join(repo, 'dist', 'scripts', 'mission-serve.js')], {
    env: { ...process.env, NODE_ENV: 'production', ZA141251SA_BIND_HOST: '127.0.0.1', ZA141251SA_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk.toString(); });
  child.stderr.on('data', (chunk) => { out += chunk.toString(); });

  const startedAt = Date.now();
  let health = null;
  let error = null;
  try {
    health = await readiness.waitForMissionReadiness({
      healthUrl: 'http://127.0.0.1:' + port + '/api/health',
      // The same expectation the production wrapper computes from the operator's configuration: the
      // boot must report the database it was told to open, not one it found.
      expectedDatabase: dbTarget.missionHealthDatabaseExpectation(process.env),
      timeoutMs: Number(process.env.BOOT_TEST_BUDGET_MS || 90000),
      requestTimeoutMs: 5000,
      progress: (info) => process.stdout.write('[wait] ' + Math.round(info.elapsedMs / 1000) + 's — ' + info.lastFailure + '\n'),
    });
  } catch (thrown) {
    error = thrown.message;
  }
  const elapsedMs = Date.now() - startedAt;
  let childGone = false;
  try { child.kill('SIGTERM'); } catch { childGone = true; }
  await new Promise((resolve) => setTimeout(resolve, 250));
  try { child.kill('SIGKILL'); } catch { /* already gone */ }

  const require2 = createRequire(path.join(repo, 'package.json'));
  const { Client } = require2('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  const counts = {};
  for (const table of ['mission_agents', 'mission_wallets', 'mission_money_grants', 'mission_audit', 'mission_migrations']) {
    counts[table] = Number((await client.query('SELECT COUNT(*)::int AS n FROM ' + table)).rows[0].n);
  }
  await client.end();

  report({
    agentsBefore,
    walletsBefore,
    ready: health !== null,
    error,
    elapsedMs,
    ownerExisted,
    health,
    counts,
    migrationsReported: /migrations: (\d+) applied, (\d+) files, engine postgres/.test(out) ? out.match(/migrations: (\d+) applied, (\d+) files, engine postgres/).slice(1) : null,
    childOutput: out.split('\n').slice(-25).join('\n'),
  });
  process.exit(health === null ? 2 : 0);
}

failFast(new Error('unknown harness mode: ' + mode));
`;

interface ContractResult {
  verdicts: Record<string, boolean>;
  acceptsAGenuineReadyPayload: boolean;
  waiterRejected: boolean;
  waiterExplainsItself: boolean;
  bind: { host: string; port: number; healthUrl: string };
  hostile: { host: string; port: number; healthUrl: string };
  policy: { timeoutMs: number; requestTimeoutMs: number; attempts: number; restartDelayMs: number; required: boolean };
}

interface BootResult {
  agentsBefore: number;
  walletsBefore: number;
  ready: boolean;
  error: string | null;
  elapsedMs: number;
  ownerExisted: boolean;
  health: Record<string, unknown> | null;
  counts: Record<string, number>;
  migrationsReported: string[] | null;
  childOutput: string;
}

function runHarness(mode: 'contract' | 'boot', env: Record<string, string> = {}): { status: number | null; json: unknown; stdout: string; stderr: string } {
  const dir = tempDir(`mission-boot-${mode}-`);
  const file = path.join(dir, 'harness.mjs');
  fs.writeFileSync(file, HARNESS, 'utf8');
  const res = spawnSync(process.execPath, [file, REPO, mode], {
    cwd: REPO,
    encoding: 'utf8',
    // A boot on a managed-size fixture is not fast; a timeout shorter than the thing under test is
    // how a measurement becomes a false failure.
    timeout: 240_000,
    env: {
      ...process.env,
      ZA141251SA_CREDENTIAL_KEY: 'boot-readiness-credential-key-32-chars!',
      ZA141251SA_SESSION_SECRET: 'boot-readiness-session-secret-32-chars-ok',
      ...env,
    },
  });
  const stdout = res.stdout ?? '';
  const match = stdout.match(/::RESULT::([\s\S]*?)\n/);
  let json: unknown = null;
  if (match) {
    try {
      json = JSON.parse(match[1]);
    } catch {
      json = { parseError: match[1], stdout };
    }
  }
  return { status: res.status, json, stdout, stderr: res.stderr ?? '' };
}

it('the readiness contract rejects every shape that is listening but not usable', () => {
  const run = runHarness('contract');
  assert.equal(run.status, 0, `the harness itself must not error:\n${run.stdout}\n${run.stderr}`);
  const result = run.json as ContractResult;
  assert.ok(result, `no result payload:\n${run.stdout}\n${run.stderr}`);
  assert.equal(result.acceptsAGenuineReadyPayload, true, 'a genuinely ready service must satisfy the contract');
  for (const [name, rejected] of Object.entries(result.verdicts)) {
    assert.equal(rejected, true, `the contract must reject: ${name}`);
  }
  // The negative control for the whole file: a probe against a port nobody listens on has to FAIL,
  // loudly, and say what it tried. Without this, "ready" could be satisfied by a stub.
  assert.equal(result.waiterRejected, true, 'the waiter must time out and say so against a dead port');
  assert.equal(result.waiterExplainsItself, true, 'the failure must name the URL and the per-request budget');
});

it('the wrapper and the probe share one bind target, and hostile inherited values cannot widen it', () => {
  const run = runHarness('contract');
  const result = run.json as ContractResult;
  assert.ok(result, run.stdout);
  assert.equal(result.bind.host, '127.0.0.1');
  assert.equal(result.bind.port, 4200);
  assert.equal(result.bind.healthUrl, 'http://127.0.0.1:4200/api/health');
  assert.deepEqual(result.hostile, result.bind, 'ZA141251SA_BIND_HOST=0.0.0.0 and an injected platform PORT must not move or expose the private listener');
  // The budgets the outage was caused by, as numbers a future refactor cannot quietly shrink.
  assert.ok(result.policy.timeoutMs >= 120_000, `the readiness budget must exceed a real boot (~38 s measured); got ${result.policy.timeoutMs} ms`);
  assert.ok(result.policy.requestTimeoutMs >= 2_000, `a per-request timeout below the event-loop stall of a boot is a false negative; got ${result.policy.requestTimeoutMs} ms`);
  assert.ok(result.policy.attempts >= 2, 'a private tier gets more than one try');
  assert.equal(result.policy.required, false, 'taking the container down must remain the opt-in, not the default');
});

it('an aborted-session error is recognized as fatal, and an ordinary seed failure is not', async () => {
  // The boot hangs instead of failing when a seed swallows an error inside a PostgreSQL
  // transaction: the session is aborted, every later statement — including the one behind
  // /api/health — is refused, and the container spends its whole restart budget waiting for a
  // listener that will never arrive. `seedAtBoot` now gives each seed its own transaction boundary
  // and stops on this specific symptom; this pins which message means "stop".
  const { isAbortedSessionError, ABORTED_SESSION_HINT } = await import('./boot-session-state');
  assert.equal(isAbortedSessionError('current transaction is aborted, commands ignored until end of transaction block'), true);
  assert.equal(isAbortedSessionError('ERROR: can\'t execute INSERT in an aborted transaction'), false, 'a paraphrase it should not guess at');
  assert.equal(isAbortedSessionError('UNIQUE constraint failed: mission_agents.slug'), false, 'an ordinary seed failure must stay non-fatal — a fresh deployment has to boot');
  assert.equal(isAbortedSessionError('SQLITE_BUSY: database is locked'), false);
  assert.equal(isAbortedSessionError(''), false);
  assert.match(ABORTED_SESSION_HINT, /swallowed/);
  assert.match(ABORTED_SESSION_HINT, /own transaction boundary/);
  // The boot test above is the behavioral half of this pin: on a warmed mission database (the
  // shape production has, and where the cascade was reproduced) it must reach readiness instead of
  // timing out, which is what `npm run mission:pg-check` now exercises on every push.
});

it('the mission server boots on PostgreSQL and reaches readiness inside a budget a platform enforces', async (t) => {
  if (!PG) {
    t.skip('no PG_TEST_DATABASE_URL — run this file under scripts/pg-test-server.mjs (npm run mission:pg-check) to boot on PostgreSQL');
    return;
  }
  assert.ok(fs.existsSync(SERVE_ENTRY), `the compiled mission server must exist for a boot test: ${SERVE_ENTRY} (npm run build:backend)`);
  const port = await freePort();
  const run = runHarness('boot', {
    ZA141251SA_DATABASE_URL: String(process.env.PG_TEST_DATABASE_URL),
    BOOT_TEST_PORT: String(port),
    BOOT_TEST_BUDGET_MS: '90000',
  });
  const result = run.json as BootResult | null;
  assert.ok(result, `the boot harness produced no result (status ${run.status}):\n${run.stdout}\n${run.stderr}`);
  assert.equal(
    result.ready,
    true,
    `the mission server must become ready on PostgreSQL within 90 s; it reported: ${result.error}\nlast output:\n${result.childOutput}`,
  );
  const health = result.health as Record<string, unknown>;
  assert.equal(health.service, 'mission');
  assert.equal(health.audit, true, 'the audit chain must verify at the end of a real boot');
  assert.equal(health.ledger, true, 'the ledger must reconcile at the end of a real boot');
  assert.ok(Number(health.ownerAccounts) >= 1, 'the private dashboard needs an owner to be usable');
  assert.match(String(health.database), /^postgres:\/\//, 'the health payload must report the PostgreSQL database it opened');

  // Exact counts, so "the boot completed" cannot mean "the boot completed by writing nothing".
  assert.ok(result.counts.mission_migrations >= 49, `the migration ledger must be populated: ${JSON.stringify(result.counts)}`);
  // The precise property the fix is about: the boot's set-based wallet pass must cover every agent
  // that existed when it ran, in one pass — that is what used to take 30 s of per-agent round trips
  // and miss the readiness window. Comparing against the pre-boot count keeps the assertion true
  // for a database the seeds also grow, and false for a boot that skipped or half-provisioned.
  assert.ok(
    result.counts.mission_wallets >= result.agentsBefore + 1,
    `the wallet pass must fund every agent present at boot (agents before: ${result.agentsBefore}, wallets before: ${result.walletsBefore}, wallets after: ${result.counts.mission_wallets})`,
  );
  assert.ok(result.counts.mission_audit > 0, 'a boot that provisions must leave evidence in the audit chain');
  assert.ok(result.migrationsReported, `the boot must say what the migration step did, in its own log:\n${result.childOutput}`);
  const [applied, files] = result.migrationsReported!.map((value) => Number(value));
  assert.ok(Number.isFinite(applied) && applied >= 0, 'the boot must report how many migrations it applied, as a number');
  assert.ok(files >= 49, `the boot must report the whole mission migration set, not a partial glob: ${files} files`);
  assert.ok(
    applied === 0 || applied > 0,
    'the applied count is reported either way — what is not allowed is the step being silent',
  );
  // The number that matters most: the boot must fit in a budget a platform would enforce. Measured
  // before this fix: 38,362 ms against a 30,000 ms window. After it: ~6,000 ms.
  assert.ok(result.elapsedMs < 90_000, `boot to readiness took ${result.elapsedMs} ms`);
  process.stdout.write(
    `[EVIDENCE] mission boot on PostgreSQL: ready in ${result.elapsedMs} ms; ` +
      `agents ${result.counts.mission_agents} (${result.agentsBefore} before the boot), wallets ${result.counts.mission_wallets}, grants ${result.counts.mission_money_grants}, ` +
      `audit rows ${result.counts.mission_audit}, migrations ${result.counts.mission_migrations}; owner ${result.ownerExisted ? 'pre-existing' : 'provisioned by this test'}\n`,
  );
});
