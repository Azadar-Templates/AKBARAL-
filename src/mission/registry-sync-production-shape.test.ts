/**
 * ZA141251SA — the registry sync, against a production-shaped stack.
 *
 * What this file exists to make impossible: `npm run mission:sync-registry` doing nothing
 * and looking fine. Production measured a platform database with 4,001 agents and 7,203
 * tool grants, a mission database with 0 agents, and a sync command that printed nothing,
 * errored nothing and synced nothing. Every case below drives the REAL entry as a child
 * process with the REAL platform migrations behind it, and asserts on both the exit code
 * and the report, because the bug was a missing report as much as a missing write.
 *
 * Fixture, deliberately small and exact so the numbers in the assertions are the numbers a
 * person can check by hand:
 *
 *   sync-<prefix>-01   3 tool grants (one of them carrying a platform `config` payload)
 *   sync-<prefix>-02   2 tool grants
 *   sync-<prefix>-03   1 tool grant
 *   sync-<prefix>-04   1 tool grant
 *   sync-<prefix>-05   0 tool grants          (an agent with no tools is legitimate, not a gap)
 *   sync-<prefix>-u1   1 tool grant, but user-owned ⇒ the export must not touch it
 *
 * So the sync must report 5 identities and 7 grants, and leave 1 grant unexported with the
 * reason visible in the counts, not hidden in a JOIN.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, it } from 'node:test';
import assert from 'node:assert/strict';

const PG = Boolean(process.env.PG_TEST_DATABASE_URL);
const REPO = process.cwd();
const TAG = 'mission:sync-registry';

function makeTemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const dirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = makeTemp(prefix);
  dirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** The compiled platform migrator if the tree has been built, the source otherwise. */
function runPlatformMigrate(databaseUrl: string): void {
  const compiled = path.join(REPO, 'dist', 'src', 'db', 'migrate.js');
  const args = fs.existsSync(compiled)
    ? [compiled]
    : [path.join(REPO, 'node_modules', '.bin', 'tsx'), path.join(REPO, 'src', 'db', 'migrate.ts')];
  const res = spawnSync(process.execPath, args, {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 300_000,
    env: { ...process.env, DATABASE_URL: databaseUrl, DATA_DIR: path.dirname(databaseUrl.replace(/^file:/, '')) },
  });
  assert.equal(res.status, 0, `platform migrations must succeed:\n${res.stdout}\n${res.stderr}`);
}

interface Grant {
  slug: string;
  tool: string;
  permission: string;
  config?: string;
}

/**
 * A platform database with the fixture rows above, created through the platform's own
 * migrations so the shapes are the real ones and not a guess at them.
 */
function platformFixture(prefix: string): { dir: string; url: string; file: string } {
  const dir = tempDir('registry-sync-platform-');
  const file = path.join(dir, 'akbaral.db');
  const url = `file:${file}`;
  runPlatformMigrate(url);
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(file);
  const now = '2026-10-12T00:00:00.000Z';
  db.exec("PRAGMA foreign_keys=OFF"); // fixture rows only; the sync never writes here at all
  db.prepare(`INSERT INTO agent_categories (id,name,slug,description,created_at,updated_at) VALUES (?,?,?,?,?,?)`).run(
    `cat-${prefix}`, 'Synthetic fixture class', `synthetic-fixture-${prefix}`, 'fixture', now, now,
  );
  for (const tool of ['web', 'browser', 'code']) {
    db.prepare(`INSERT INTO tools (id,key,name,kind,created_at) VALUES (?,?,?,?,?)`).run(`tool-${prefix}-${tool}`, `tool-${prefix}-${tool}`, `Fixture tool ${tool}`, tool, now);
  }
  const agents: Array<{ slug: string; owner: string | null }> = [
    { slug: `sync-${prefix}-01`, owner: null },
    { slug: `sync-${prefix}-02`, owner: null },
    { slug: `sync-${prefix}-03`, owner: null },
    { slug: `sync-${prefix}-04`, owner: null },
    { slug: `sync-${prefix}-05`, owner: null },
    { slug: `sync-${prefix}-u1`, owner: null },
  ];
  for (const agent of agents) {
    db.prepare(
      `INSERT INTO agents (id,name,slug,description,version,category_id,runtime,status,owner_id,created_at,updated_at)
       VALUES (?,?,?,?,'1.0.0',?,'node','active',?,?,?)`,
    ).run(
      `agent-${agent.slug}`,
      `Fixture agent ${agent.slug}`,
      agent.slug,
      'synthetic fixture row, not a real specialist',
      `cat-${prefix}`,
      agent.slug.endsWith('-u1') ? 'usr-synthetic-owner' : null,
      now,
      now,
    );
  }
  const grants: Grant[] = [
    { slug: `sync-${prefix}-01`, tool: 'web', permission: 'read' },
    { slug: `sync-${prefix}-01`, tool: 'browser', permission: 'read' },
    { slug: `sync-${prefix}-01`, tool: 'code', permission: 'read', config: JSON.stringify({ endpoint: 'https://fixture.invalid', note: 'a payload the bridge must not copy' }) },
    { slug: `sync-${prefix}-02`, tool: 'web', permission: 'read' },
    { slug: `sync-${prefix}-02`, tool: 'code', permission: 'write' },
    { slug: `sync-${prefix}-03`, tool: 'browser', permission: 'read' },
    { slug: `sync-${prefix}-04`, tool: 'code', permission: 'read' },
    { slug: `sync-${prefix}-u1`, tool: 'web', permission: 'read' },
  ];
  for (const grant of grants) {
    db.prepare(`INSERT INTO agent_tools (agent_id,tool_id,permission,config,created_at) VALUES (?,?,?,?,?)`).run(
      `agent-${grant.slug}`,
      `tool-${prefix}-${grant.tool}`,
      grant.permission,
      grant.config ?? null,
      now,
    );
  }
  db.close();
  return { dir, url, file };
}

interface SyncRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Run the real entry as a child, with exactly the environment an operator's shell has. */
function runSync(options: {
  missionUrl: string;
  platformUrl?: string;
  args?: string[];
  /** 'source' runs the TypeScript the way a checkout does; 'image' runs the resolver in a
   * tree that looks like the runtime image: dist/, db/, scripts/, no src/. */
  mode?: 'source' | 'image';
  cwd?: string;
  /** Extra variables, for tests that exercise a documented knob rather than the default path. */
  extraEnv?: Record<string, string | undefined>;
}): SyncRun {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ZA141251SA_DATABASE_URL: options.missionUrl,
    ZA141251SA_CREDENTIAL_KEY: 'synthetic-chat-vault-key-not-real-0123456789',
    DATABASE_URL: options.platformUrl ?? 'file::memory:',
    DATA_DIR: options.missionUrl.startsWith('file:')
      ? path.dirname(options.missionUrl.slice('file:'.length))
      : tempDir('registry-sync-data-'),
    // Never let a developer's or a CI job's overrides leak into the child: the point of
    // these tests is which target the command resolves on its own.
    MISSION_DATABASE_URL: undefined,
    AKBARAL_ROLES: undefined,
    ...options.extraEnv,
  };
  if (options.mode === 'image') {
    // The runtime image shape: the compiled output, the migration directory, the plain-JS
    // scripts and node_modules — and no `src/` for an import to fall back to.
    const root = options.cwd ?? tempDir('registry-sync-image-');
    for (const entry of ['dist', 'db', 'scripts', 'node_modules']) {
      const target = path.join(root, entry);
      if (!fs.existsSync(target)) fs.symlinkSync(path.join(REPO, entry), target, 'dir');
    }
    if (!fs.existsSync(path.join(root, 'package.json'))) {
      fs.copyFileSync(path.join(REPO, 'package.json'), path.join(root, 'package.json'));
    }
    assert.ok(!fs.existsSync(path.join(root, 'src')), 'the image-shaped root must not have src/');
    const res = spawnSync(
      process.execPath,
      [path.join(REPO, 'scripts', 'mission-run.mjs'), '--root', root, 'mission-sync-registry', ...(options.args ?? [])],
      { cwd: root, encoding: 'utf8', timeout: 300_000, env },
    );
    return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
  }
  const compiled = path.join(REPO, 'dist', 'scripts', 'mission-sync-registry.js');
  const entry = fs.existsSync(compiled)
    ? [compiled]
    : [path.join(REPO, 'node_modules', '.bin', 'tsx'), path.join(REPO, 'scripts', 'mission-sync-registry.ts')];
  const args = [...entry, ...(options.args ?? [])];
  const res = spawnSync(process.execPath, args, {
    cwd: options.cwd ?? REPO,
    encoding: 'utf8',
    timeout: 300_000,
    env,
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function missionFile(prefix: string): { dir: string; url: string } {
  if (PG) {
    // The PostgreSQL run of this file shares one database with the rest of the chain, so it
    // asserts on rows carrying its own slug prefix instead of absolute table counts.
    return { dir: tempDir('registry-sync-pg-'), url: String(process.env.PG_TEST_DATABASE_URL) };
  }
  const dir = tempDir(`registry-sync-mission-${prefix}-`);
  return { dir, url: `file:${path.join(dir, 'mission.db')}` };
}

function valueInFile(file: string, sql: string, params: Array<string | number> = []): number {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  // Read-only, deliberately: a test that mutates the database it is auditing proves
  // nothing about whether the command under test did.
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare(sql).get(...(params as never[])) as { n: number | bigint } | undefined;
    return Number(row?.n ?? 0);
  } finally {
    db.close();
  }
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

before(() => {
  assert.ok(fs.existsSync(path.join(REPO, 'db', 'migrations-mission', '0050_registry_tool_grants.sql')), 'the grants table has to ship as a migration, not as a runtime CREATE');
});

it('syncs every platform-owned agent and tool grant into an empty mission database, and says so exactly', () => {
  const prefix = `t1${Date.now().toString(36).slice(-5)}`;
  const platform = platformFixture(prefix);
  const mission = missionFile(prefix);
  const run = runSync({ missionUrl: mission.url, platformUrl: platform.url });

  assert.equal(run.status, 0, `a healthy sync must exit 0:\n${run.stdout}\n${run.stderr}`);
  // Engine and both targets, before any write: the three lines that used to be absent.
  assert.match(run.stdout, new RegExp(`${TAG} — mission (postgres|sqlite)`), run.stdout);
  assert.match(run.stdout, /platform sqlite /, `the platform target must be named:\n${run.stdout}`);
  assert.match(
    run.stdout,
    /platform counts: agents 6, platform-owned 5, agent_tools 8, attached to platform-owned agents 7/,
    `the counts have to be the counts a person can verify by hand:\n${run.stdout}`,
  );
  assert.match(
    run.stdout,
    /written 12 \(agents 5 created, 0 updated, 0 unchanged; grants 7 created, 0 updated, 0 unchanged\)/,
    run.stdout,
  );
  assert.match(run.stdout, /skipped 1: agent_tools\.config payload not copied/, `the skipped payload must come with its reason:\n${run.stdout}`);
  assert.match(run.stdout, /wrote nothing to the platform database/, run.stdout);

  if (!PG) {
    const file = mission.url.slice('file:'.length);
    assert.equal(valueInFile(file, `SELECT COUNT(*) AS n FROM mission_agents WHERE slug LIKE 'sync-${prefix}-%'`), 5, 'every platform-owned agent, and only they');
    assert.equal(valueInFile(file, `SELECT COUNT(*) AS n FROM mission_agent_tools`), 7, 'every grant attached to a platform-owned agent');
    assert.equal(valueInFile(file, `SELECT COUNT(*) AS n FROM mission_agents WHERE slug = ?`, [`sync-${prefix}-u1`]), 0, 'a user-owned agent is not the platform registry');
    assert.equal(valueInFile(file, `SELECT COUNT(*) AS n FROM mission_audit WHERE action = 'registry.synced'`), 1, 'the run is on the audit chain');
  }
});

it('is idempotent: a second run writes nothing and reports already in sync', () => {
  const prefix = `t2${Date.now().toString(36).slice(-5)}`;
  const platform = platformFixture(prefix);
  const mission = missionFile(prefix);

  const first = runSync({ missionUrl: mission.url, platformUrl: platform.url });
  assert.equal(first.status, 0, first.stdout + first.stderr);

  const second = runSync({ missionUrl: mission.url, platformUrl: platform.url });
  assert.equal(second.status, 0, `a re-run must exit 0:\n${second.stdout}\n${second.stderr}`);
  assert.match(second.stdout, /ALREADY IN SYNC/, `the second run must say it had nothing to write:\n${second.stdout}`);
  assert.match(second.stdout, /written 0 \(agents 0 created, 0 updated, 5 unchanged; grants 0 created, 0 updated, 7 unchanged\)/, second.stdout);

  if (!PG) {
    const file = mission.url.slice('file:'.length);
    assert.equal(valueInFile(file, `SELECT COUNT(*) AS n FROM mission_agents WHERE slug LIKE 'sync-${prefix}-%'`), 5, 'no duplicate identity rows');
    assert.equal(valueInFile(file, `SELECT COUNT(*) AS n FROM mission_agent_tools`), 7, 'no duplicate grant rows');
  }
});

it('the sync reports its bounds, its per-batch cost and the fleet rails it provisioned', () => {
  // Measured reason for this test: a full-fleet run used to take 66.8 s with no output between the
  // first line and the last, so when the container restarted it, nobody could tell how far it had
  // got, whether the database was slow or the code was, or whether any of the money-control rows
  // had been written. Every clause below is something an operator needed and did not have.
  const prefix = `t9${Date.now().toString(36).slice(-5)}`;
  const platform = platformFixture(prefix);
  const mission = missionFile(prefix);

  const run = runSync({ missionUrl: mission.url, platformUrl: platform.url });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /probing it before any write/, 'the run must prove the database answered before it opened a transaction');
  assert.match(run.stdout, /batch 500 agents per transaction/, 'the batch size is part of the report, not an implementation detail');
  assert.match(run.stdout, /batch 1\/1 in \d+ ms: 5 created/, `each batch must be timed and counted:\n${run.stdout}`);
  assert.match(run.stdout, /5 fleet rails provisioned \(0 already present\)/, 'cash account + grant provisioning for the imported identities is reported, per batch');
  assert.match(run.stdout, /fleet rails 5 provisioned\/0 already present/, 'and totalled in the summary, so a zero can be seen as a zero');
});

it('ZA141251SA_SYNC_BATCH really changes the batches, and a nonsense value is a refusal rather than a clamp', () => {
  const prefix = `ta${Date.now().toString(36).slice(-5)}`;
  const platform = platformFixture(prefix);
  const mission = missionFile(prefix);

  const small = runSync({ missionUrl: mission.url, platformUrl: platform.url, extraEnv: { ZA141251SA_SYNC_BATCH: '2' } });
  assert.equal(small.status, 0, small.stdout + small.stderr);
  // 5 platform-owned identities in batches of 2 is three batches, and the last one is the remainder.
  assert.match(small.stdout, /batch 2 agents per transaction/, small.stdout);
  assert.match(small.stdout, /batch 1\/3 in \d+ ms: 2 created/, small.stdout);
  assert.match(small.stdout, /batch 3\/3 in \d+ ms: 1 created/, small.stdout);

  // Negative control, in the same run: an idempotent second pass must report the same rows as
  // "unchanged" and provision no new rails, so a "0 created" line means "already synced" here and
  // can never be read as a silent failure.
  const again = runSync({ missionUrl: mission.url, platformUrl: platform.url, extraEnv: { ZA141251SA_SYNC_BATCH: '2' } });
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /ALREADY IN SYNC/, again.stdout);
  assert.match(again.stdout, /batch 1\/3 in \d+ ms: 0 created, 0 updated, 2 already matching/, again.stdout);
  assert.match(again.stdout, /fleet rails 0 provisioned\/0 already present/, 'a re-run must say it provisioned nothing, out loud');

  // And the guard: 0 is not clamped to 1 and 5000 is not clamped to 1000. A typo in a knob that
  // decides how many rows go into one transaction has to stop the run, not reshape it.
  const zero = runSync({ missionUrl: mission.url, platformUrl: platform.url, extraEnv: { ZA141251SA_SYNC_BATCH: '0' } });
  assert.equal(zero.status, 1, `ZA141251SA_SYNC_BATCH=0 must refuse to run:\n${zero.stdout}\n${zero.stderr}`);
  assert.match(`${zero.stdout}\n${zero.stderr}`, /ZA141251SA_SYNC_BATCH must be a whole number of agents per transaction between 1 and 1000/);
  assert.match(`${zero.stdout}\n${zero.stderr}`, /got "0"/, 'the refusal must quote the value that was set');
  const huge = runSync({ missionUrl: mission.url, platformUrl: platform.url, extraEnv: { ZA141251SA_SYNC_BATCH: '5000' } });
  assert.equal(huge.status, 1, huge.stdout + huge.stderr);
  assert.match(`${huge.stdout}\n${huge.stderr}`, /got "5000"/);
});

it('a platform database that cannot be opened exits non-zero with the reason — never silent', () => {
  const prefix = `t3${Date.now().toString(36).slice(-5)}`;
  const dir = tempDir('registry-sync-noplatform-');
  const missing = path.join(dir, 'nope', 'akbaral.db');
  const mission = missionFile(prefix);

  const run = runSync({ missionUrl: mission.url, platformUrl: `file:${missing}` });
  assert.equal(run.status, 1, `a missing platform database must fail the run:\n${run.stdout}`);
  assert.match(run.stderr, /the platform database is not there/, run.stderr);
  assert.match(run.stderr, new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `the path it looked for must be named:\n${run.stderr}`);
  assert.match(run.stderr, /never creates or selects an alternate platform database/, run.stderr);

  if (!PG) {
    const file = mission.url.slice('file:'.length);
    assert.equal(valueInFile(file, `SELECT COUNT(*) AS n FROM mission_agents WHERE slug LIKE 'sync-%'`), 0, 'a failed pre-flight must not leave identities behind');
  }
});

it('a mission database that cannot be reached exits non-zero with the reason — never silent', () => {
  const prefix = `t4${Date.now().toString(36).slice(-5)}`;
  const platform = platformFixture(prefix);
  // A missing *directory* is not unreachable here: the mission driver creates the parent of
  // a `file:` target on first boot, so the case has to be a path that genuinely cannot be
  // opened — a name that is already a directory.
  const dir = tempDir('registry-sync-nomission-');
  const blocked = path.join(dir, 'mission.db');
  fs.mkdirSync(blocked);
  const run = runSync({ missionUrl: `file:${blocked}`, platformUrl: platform.url });
  assert.equal(run.status, 1, `an unreachable mission database must fail the run:\n${run.stdout}`);
  assert.match(run.stderr, /FAILED — /, `the reason has to be printed, not implied:\n${run.stderr}`);
  // The exact engine wording differs; what is pinned is that it is the mission side that
  // could not be opened, and that the failure is not reported as a sync.
  assert.doesNotMatch(run.stdout, /written \d+/, `a dead mission database must not report rows written:\n${run.stdout}`);
});

it('a partial failure mid-copy rolls the batch back whole and exits non-zero', () => {
  const prefix = `t5${Date.now().toString(36).slice(-5)}`;
  const platform = platformFixture(prefix);
  const mission = missionFile(prefix);
  if (PG) {
    // The ceiling is a policy row in a shared database, and the other files in the
    // PostgreSQL chain have their own fleet in there: tightening it to make this case
    // meaningful would change somebody else's fixture. The file case below is the exact one.
    return;
  }

  // First make the policy row exist (the way any real mission database has it) and then set
  // the ceiling below the fixture: `registry_agent_ceiling` is an existing gate, and this
  // case proves the gate fires *and* that firing cannot leave a half-written agent.
  const preflight = runSync({ missionUrl: mission.url, platformUrl: platform.url, args: ['--skip-platform'] });
  assert.equal(preflight.status, 0, preflight.stdout + preflight.stderr);

  const file = mission.url.slice('file:'.length);
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const setup = new DatabaseSync(file);
  setup.exec('UPDATE mission_policy SET max_agents = 2');
  setup.close();

  const run = runSync({ missionUrl: mission.url, platformUrl: platform.url });
  assert.equal(run.status, 1, `a ceiling breach must fail the run:\n${run.stdout}`);
  assert.match(run.stderr, /registry_agent_ceiling/, run.stderr);
  assert.match(run.stderr, /failed and was rolled back whole/, run.stderr);

  assert.equal(valueInFile(file, `SELECT COUNT(*) AS n FROM mission_agents WHERE slug LIKE 'sync-${prefix}-%'`), 0, 'no agent may survive a batch that was refused');
  assert.equal(valueInFile(file, 'SELECT COUNT(*) AS n FROM mission_agent_tools'), 0, 'and no grant may outlive its agent');
});

it('the compiled dist/ entry alone is sufficient: no src/ in the tree', (t) => {
  // An `npm ci` checkout with no build has nothing to run: say it skipped rather than report a
  // pass this tree did not earn or a failure the tree caused. CI builds the backend first.
  if (!fs.existsSync(path.join(REPO, 'dist', 'scripts', 'mission-sync-registry.js'))) {
    t.skip('no dist/scripts/mission-sync-registry.js in this tree — run npm run build:backend');
    return;
  }
  const prefix = `t6${Date.now().toString(36).slice(-5)}`;
  const platform = platformFixture(prefix);
  const mission = missionFile(prefix);
  const run = runSync({ missionUrl: mission.url, platformUrl: platform.url, mode: 'image' });

  assert.equal(run.status, 0, `the runtime image ships no src/; the sync has to run from dist/:\n${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /compiled entry dist\/scripts\/mission-sync-registry\.js \(no src\/ in this tree — runtime-image shape\)/, run.stdout);
  // The resolver is what production uses; if it ever preferred a source file in an image-shaped
  // tree, the run would die on MODULE_NOT_FOUND for '../src/...' and this line names why.
  assert.doesNotMatch(run.stdout, /source entry via tsx/, `an image-shaped tree must not resolve to the TypeScript source:\n${run.stdout}`);
  assert.match(run.stdout, /written 12 \(agents 5 created/, run.stdout);
});

it('leaves the platform database byte-identical', () => {
  const prefix = `t7${Date.now().toString(36).slice(-5)}`;
  const platform = platformFixture(prefix);
  const mission = missionFile(prefix);

  const beforeHash = sha256(platform.file);
  const filesBefore = fs.readdirSync(platform.dir).sort();
  const run = runSync({ missionUrl: mission.url, platformUrl: platform.url });
  assert.equal(run.status, 0, run.stdout + run.stderr);

  assert.equal(sha256(platform.file), beforeHash, 'the sync reads the platform database and must not write a byte to it');
  assert.deepEqual(fs.readdirSync(platform.dir).sort(), filesBefore, 'and must not leave a journal, a wal or a stray file beside it');
});

it('creates no money, no ledger entry, no payout change and no tool approval', () => {
  if (PG) return; // the same shape as the ceiling case: exact table deltas need a private database
  const prefix = `t8${Date.now().toString(36).slice(-5)}`;
  const platform = platformFixture(prefix);
  const mission = missionFile(prefix);
  const file = mission.url.slice('file:'.length);

  // Bring the schema up and record what the rails look like before the sync, then run it and
  // compare. "It did not touch them" has to be a measurement, not a sentence in a comment.
  const preflight = runSync({ missionUrl: mission.url, platformUrl: platform.url, args: ['--skip-platform'] });
  assert.equal(preflight.status, 0, preflight.stdout + preflight.stderr);
  const rails = (): Record<string, number> => ({
    tools: valueInFile(file, 'SELECT COUNT(*) AS n FROM mission_tools'),
    toolRequests: valueInFile(file, 'SELECT COUNT(*) AS n FROM mission_tool_requests'),
    ledger: valueInFile(file, 'SELECT COUNT(*) AS n FROM mission_ledger'),
    cashCents: valueInFile(file, 'SELECT COALESCE(SUM(available_cents + held_cents), 0) AS n FROM mission_cash_accounts'),
    payoutSlotsVerified: valueInFile(file, 'SELECT COUNT(*) AS n FROM mission_payout_slots WHERE verified_at IS NOT NULL'),
    grantLimits: valueInFile(file, 'SELECT COALESCE(SUM(spend_limit_cents + delegation_cents), 0) AS n FROM mission_money_grants'),
    contracts: valueInFile(file, 'SELECT COUNT(*) AS n FROM mission_agent_contracts'),
    proposals: valueInFile(file, 'SELECT COUNT(*) AS n FROM mission_agent_contract_proposals'),
    approvals: valueInFile(file, 'SELECT COUNT(*) AS n FROM mission_approvals'),
  });
  const railsBefore = rails();
  assert.deepEqual(
    Object.values(railsBefore),
    [railsBefore.tools, railsBefore.toolRequests, 0, 0, 0, 0, 0, 0, 0],
    `a fresh mission database holds the tool catalog and nothing else: ${JSON.stringify(railsBefore)}`,
  );

  const run = runSync({ missionUrl: mission.url, platformUrl: platform.url });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const railsAfter = rails();
  assert.deepEqual(railsAfter, railsBefore, `the sync must move identities and grants only:\n${JSON.stringify({ railsBefore, railsAfter })}`);
  assert.equal(valueInFile(file, `SELECT COUNT(*) AS n FROM mission_agents WHERE slug LIKE 'sync-${prefix}-%'`), 5, 'identities did arrive, so the comparison above is not two zeroes');
});

it('--skip-platform says it skipped and is never mistaken for a sync', () => {
  const prefix = `t9${Date.now().toString(36).slice(-5)}`;
  const platform = platformFixture(prefix);
  const mission = missionFile(prefix);
  const run = runSync({ missionUrl: mission.url, platformUrl: platform.url, args: ['--skip-platform'] });

  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /platform read SKIPPED on purpose/, run.stdout);
  assert.match(run.stdout, /This is not a sync and is not reported as one/, run.stdout);
  assert.doesNotMatch(run.stdout, /ALREADY IN SYNC/, 'a skip must not read like a completed comparison');
  assert.doesNotMatch(run.stdout, /written \d+/, 'and must not report rows');
});

it('refuses to report success when the platform filter excludes every agent', () => {
  const prefix = `t10${Date.now().toString(36).slice(-5)}`;
  const platform = platformFixture(prefix);
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const mutate = new DatabaseSync(platform.file);
  mutate.exec('PRAGMA foreign_keys=OFF');
  mutate.exec("UPDATE agents SET owner_id = 'usr-synthetic-owner'"); // every agent becomes user-owned
  mutate.close();

  const mission = missionFile(prefix);
  const run = runSync({ missionUrl: mission.url, platformUrl: platform.url });
  assert.equal(run.status, 1, `an export that matched nothing must not exit 0:\n${run.stdout}`);
  assert.match(run.stdout, /platform counts: agents 6, platform-owned 0/, `the counts must be printed before the failure:\n${run.stdout}`);
  assert.match(run.stderr, /This is the filter, not the data/, run.stderr);
});
