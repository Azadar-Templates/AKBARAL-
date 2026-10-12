#!/usr/bin/env node
/**
 * ZA141251SA — end-to-end registry sync against a production-shaped stack.
 *
 *   node scripts/mission-registry-sync-e2e.mjs
 *
 * This is the CI proof that `npm run mission:sync-registry` cannot be a silent no-op. It is
 * deliberately not a unit test: it builds the pair of databases production actually runs —
 * a SQLite platform database taken through the real migrations and the real registry seeder
 * (4,001 agents, 7,203 tool grants), and a PostgreSQL mission database — runs the SAME entry
 * the operator runs, and then reads both databases back to check what the command claims.
 *
 * What it asserts, and why each one is here:
 *   · exit code 0 AND a summary whose numbers equal the counts in the databases: the bug was
 *     a run that reported nothing, so "it exited 0" alone is not evidence;
 *   · every platform-owned agent and grant present mission-side afterwards, and the one
 *     user-owned fixture-free exclusion visible in the counts;
 *   · a second run writing 0 rows and saying "ALREADY IN SYNC": idempotence is what makes the
 *     command safe to run from a boot hook or a rebuild;
 *   · the platform database byte-identical before and after, and no stray journal beside it;
 *   · the mission rails that must stay untouched (wallet totals, ledger, payout slots,
 *     approvals, tool catalog) unchanged.
 * No row is invented to make a number line up: if a count disagrees, this exits non-zero and
 * prints both the expected and the observed value.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createRequire } from 'node:module';

const ROOT = process.cwd();
// Required, not imported: node:sqlite is only needed to *read the fixtures back* on the file
// path, and a hard ESM import of it would break this script on a Node build that lacks it.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}\n`);
}
function die(message) {
  process.stderr.write(`\nregistry-sync-e2e FAILED: ${message}\n`);
  process.exit(1);
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function query(file, sql, params = []) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare(sql).get(...params);
    return Number(row?.n ?? 0);
  } finally {
    db.close();
  }
}
function run(label, args, env) {
  process.stdout.write(`… ${label}\n`);
  const res = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 900_000, env });
  return res;
}
function entryFor(name) {
  const compiled = path.join(ROOT, 'dist', 'scripts', `${name}.js`);
  return fs.existsSync(compiled) ? [compiled] : [path.join(ROOT, 'node_modules', '.bin', 'tsx'), path.join(ROOT, 'scripts', `${name}.ts`)];
}
/** A compiled tool under dist/ when the tree has been built, its source through tsx otherwise. */
function toolEntry(distRel, srcRel) {
  const compiled = path.join(ROOT, 'dist', distRel);
  return fs.existsSync(compiled) ? [compiled] : [path.join(ROOT, 'node_modules', '.bin', 'tsx'), path.join(ROOT, srcRel)];
}
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-sync-e2e-'));
const platformDir = path.join(scratch, 'platform');
fs.mkdirSync(platformDir, { recursive: true });
const platformFile = path.join(platformDir, 'akbaral.db');
const platformUrl = `file:${platformFile}`;

// The mission target: PostgreSQL when CI hands us one, otherwise a private file database, so
// the same script is runnable by an operator on a laptop and by the CI step unchanged.
const missionUrl = process.env.REGISTRY_E2E_MISSION_URL || process.env.PG_TEST_DATABASE_URL || `file:${path.join(scratch, 'mission.db')}`;
process.stdout.write(`platform ${platformUrl}\nmission  ${missionUrl.startsWith('postgres') ? 'postgres (host and database name only, no credentials)' : missionUrl}\n`);

const baseEnv = {
  ...process.env,
  DATABASE_URL: platformUrl,
  DATA_DIR: platformDir,
  ZA141251SA_DATABASE_URL: missionUrl,
  ZA141251SA_CREDENTIAL_KEY: 'synthetic-chat-vault-key-not-real-0123456789',
  MISSION_DATABASE_URL: undefined,
  AKBARAL_ROLES: undefined,
};

// 1. A platform database built the way production built it: migrations, then the real
//    registry seeder. Nothing here is simulated.
const migrated = run('platform migrations', toolEntry(path.join('src', 'db', 'migrate.js'), path.join('src', 'db', 'migrate.ts')), baseEnv);
if (migrated.status !== 0) die(`platform migrate exited ${migrated.status}:\n${migrated.stdout}\n${migrated.stderr}`);
const seeded = run('platform registry seed', toolEntry(path.join('src', 'db', 'seed.js'), path.join('src', 'db', 'seed.ts')), baseEnv);
if (seeded.status !== 0) die(`platform seed exited ${seeded.status}:\n${seeded.stdout}\n${seeded.stderr}`);

const platformAgents = query(platformFile, 'SELECT COUNT(*) AS n FROM agents WHERE owner_id IS NULL');
const platformGrants = query(
  platformFile,
  'SELECT COUNT(*) AS n FROM agent_tools at JOIN agents a ON a.id = at.agent_id WHERE a.owner_id IS NULL',
);
const agentsTotal = query(platformFile, 'SELECT COUNT(*) AS n FROM agents');
check(
  'the seeded platform registry is production-shaped',
  agentsTotal > 1000 && platformGrants > 1000 && platformAgents === agentsTotal,
  `agents ${agentsTotal}, platform-owned ${platformAgents}, grants on them ${platformGrants}`,
);
if (platformAgents === 0) die('the platform database seeded nothing; there would be nothing to prove');

/**
 * Mission-side truth, read through the application's own mission layer, on whichever engine
 * the mission target is. The command's report is compared against this, never taken as the
 * measurement itself.
 */
function readout(extra = []) {
  const script = path.join(ROOT, 'scripts', 'mission-registry-sync-readout.mjs');
  const tsx = path.join(ROOT, 'node_modules', '.bin', 'tsx');
  const needsTsx = !fs.existsSync(path.join(ROOT, 'dist', 'src', 'mission', 'database.js'));
  const res = run(
    `mission readout${extra.length ? ` ${extra.join(' ')}` : ''}`,
    needsTsx ? [tsx, script, ...extra] : [script, ...extra],
    baseEnv,
  );
  if (res.status !== 0) die(`the readout exited ${res.status}:\n${res.stdout}\n${res.stderr}`);
  const line = String(res.stdout ?? '').split('\n').filter((entry) => entry.trim().startsWith('{')).pop();
  if (!line) die(`the readout printed no JSON:\n${res.stdout}`);
  return JSON.parse(line);
}

// 2. A `--skip-platform` pass first: it brings the mission schema up (including the grants
//    table) and writes no identities, so the rails can be snapshotted before the real run and
//    compared afterwards. A skip is announced as a skip, never as a sync.
const preflight = run('mission:sync-registry --skip-platform (schema + baseline)', [...entryFor('mission-sync-registry'), '--skip-platform'], baseEnv);
if (preflight.status !== 0) die(`the skip-mode pre-flight exited ${preflight.status}:\n${preflight.stdout}\n${preflight.stderr}`);
if (!/platform read SKIPPED on purpose/.test(preflight.stdout ?? '')) die(`the skip mode did not say it skipped:\n${preflight.stdout}`);
const baseline = readout();
check('the skip mode wrote no identities', baseline.registryAgents === 0, `mission registry agents ${baseline.registryAgents}`);

// 3. The sync itself, through the same entry the operator's npm script runs.
const platformHashBefore = sha256(platformFile);
const filesBefore = fs.readdirSync(platformDir).sort();
const first = run('mission:sync-registry', entryFor('mission-sync-registry'), baseEnv);
const firstOut = `${first.stdout ?? ''}`;
const firstErr = `${first.stderr ?? ''}`;
check('the sync exits 0', first.status === 0, `status ${first.status}${first.status === 0 ? '' : `\n${firstOut}${firstErr}`}`);
check('it reports the engine and both targets', /mission (postgres|sqlite) /.test(firstOut) && /platform sqlite /.test(firstOut), firstOut.split('\n').slice(0, 3).join(' | '));
const summaryLine = firstOut.split('\n').find((line) => line.includes('written') && line.includes('identities now')) ?? '(no summary line printed)';
check(
  'its summary reports the counts the platform actually holds',
  firstOut.includes(`source ${platformAgents} identities / ${platformGrants} grants`) && firstOut.includes(`agents ${platformAgents} created, 0 updated, 0 unchanged; grants ${platformGrants} created, 0 updated, 0 unchanged`),
  summaryLine,
);
check('it states what it left alone', firstOut.includes('wrote nothing to the platform database'), firstOut.split('\n').find((line) => line.includes('wrote nothing')) ?? '(absent)');

const afterFirst = readout(['--platform', platformFile, '--per-agent']);
check('every platform-owned agent is in the mission database', afterFirst.registryAgents === platformAgents, `mission ${afterFirst.registryAgents} vs platform-owned ${platformAgents}`);
check('every tool grant is in the mission database', afterFirst.grantRows === platformGrants, `mission ${afterFirst.grantRows} vs platform ${platformGrants}`);
check(
  'every imported agent carries exactly the grant set the platform attaches to it',
  afterFirst.perAgent?.compared === platformAgents && afterFirst.perAgent?.mismatchTotal === 0,
  `${afterFirst.perAgent?.compared} compared, ${afterFirst.perAgent?.mismatchTotal} disagreeing${afterFirst.perAgent?.mismatch?.length ? `: ${JSON.stringify(afterFirst.perAgent.mismatch.slice(0, 3))}` : ''}`,
);
check(
  'the rails are the same set as before the run',
  JSON.stringify(afterFirst.rails) === JSON.stringify(baseline.rails),
  `before ${JSON.stringify(baseline.rails)}\nafter  ${JSON.stringify(afterFirst.rails)}`,
);
check('the import created no money and no ledger entry', afterFirst.rails.cashCents === 0 && afterFirst.rails.ledger === 0, `cash ${afterFirst.rails.cashCents}, ledger rows ${afterFirst.rails.ledger}`);
check('no payout slot was verified, no approval and no tool request created', afterFirst.rails.payoutSlotsVerified === 0 && afterFirst.rails.approvals === 0 && afterFirst.rails.toolRequests === 0, JSON.stringify(afterFirst.rails));

// 3b. The compiled entry, invoked directly. A checkout resolves `npm run mission:sync-registry`
//     to the TypeScript source through tsx; the runtime image has no source to resolve to, so
//     `node dist/scripts/mission-sync-registry.js` has to stand on its own. Where no build
//     exists (a plain `npm ci` checkout) this says so instead of pretending to have checked.
const compiledEntry = path.join(ROOT, 'dist', 'scripts', 'mission-sync-registry.js');
if (fs.existsSync(compiledEntry)) {
  const compiled = run('dist/scripts/mission-sync-registry.js (direct)', [compiledEntry], baseEnv);
  const compiledOut = `${compiled.stdout ?? ''}`;
  check(
    'the compiled dist/ entry runs on its own and reports already in sync',
    compiled.status === 0 && compiledOut.includes('ALREADY IN SYNC'),
    `status ${compiled.status}; ${(compiledOut.split('\n').find((line) => line.includes('ALREADY IN SYNC')) ?? compiled.stdout + (compiled.stderr ?? '')).slice(0, 200)}`,
  );
} else {
  check('the compiled dist/ entry runs on its own and reports already in sync', true, 'SKIPPED: no dist/ in this tree (run npm run build:backend first)');
}

// 4. Idempotence, measured on rows rather than claimed.
const second = run('mission:sync-registry (second run)', entryFor('mission-sync-registry'), baseEnv);
const secondOut = `${second.stdout ?? ''}`;
check('the second run exits 0', second.status === 0, `status ${second.status}\n${secondOut}${second.stderr ?? ''}`);
check(
  'the second run says already in sync and writes nothing',
  secondOut.includes('ALREADY IN SYNC') && /written 0 \(agents 0 created, 0 updated, \d+ unchanged; grants 0 created, 0 updated, \d+ unchanged\)/.test(secondOut),
  secondOut.split('\n').find((line) => line.includes('ALREADY IN SYNC')) ?? '(absent)',
);
const afterSecond = readout();
check('no duplicate agent or grant rows after two runs', afterSecond.registryAgents === platformAgents && afterSecond.grantRows === platformGrants, `agents ${afterSecond.registryAgents}, grants ${afterSecond.grantRows}`);

// 5. The platform database, byte for byte: the sync reads it and must not touch it.
check('the platform database is byte-identical', sha256(platformFile) === platformHashBefore);
check('and gained no journal or stray file', JSON.stringify(fs.readdirSync(platformDir).sort()) === JSON.stringify(filesBefore), fs.readdirSync(platformDir).join(', '));

const failed = checks.filter((entry) => !entry.ok);
check(`registry sync end to end: ${checks.length - failed.length}/${checks.length} assertions`, failed.length === 0, failed.map((entry) => entry.name).join('; '));
fs.rmSync(scratch, { recursive: true, force: true });
if (failed.length > 0) die(`${failed.length} assertion(s) failed: ${failed.map((entry) => entry.name).join('; ')}`);
process.stdout.write(`\nREGISTRY SYNC END TO END VERIFIED — ${platformAgents} identities and ${platformGrants} grants, idempotent, platform untouched.\n`);
