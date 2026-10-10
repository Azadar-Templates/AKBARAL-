/**
 * The owner-facing activation verdict: what the fleet is waiting on, the exact action that clears
 * each item, and the source mark that decides whether any of it may be read as production state.
 *
 * Synthetic fixtures only: a disposable database in the temp directory (which is itself the case this
 * suite is about), no network, no live platform, no money. Nothing here mutates a production surface
 * — a test asserts exactly that.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `activation-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'synthetic-activation-path-tests-not-live';
import { before, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyMissionMigrations, missionDb as db, type Row } from '../database';
import { classifyMissionDataSource, claimMarkFor, FIXTURE_CLAIM_MARK } from '../data-source';
import { GITHUB_TOKEN_AUTHORITATIVE_ENV, GITHUB_TOKEN_ENV_NAMES, githubCredentialStatus, resolveGithubToken } from '../github-credential';
import { configuredGithubBountyClient } from './github-bounty-client';
import { listProviderReadiness } from './provider-capability-registry';
import { spawnSync } from 'node:child_process';
import { fleetSummary, ownerActivationPath, type OwnerActivationAction, type OwnerActivationPath } from './fleet-readiness';
import { buildMissionOverview } from '../reporting';

const keepAlive = setInterval(() => {}, 1000);
const ROOT = path.resolve(__dirname, '../../..');
const read = (relative: string): string => fs.readFileSync(path.join(ROOT, relative), 'utf8');
let summary!: ReturnType<typeof fleetSummary>;
let activation!: OwnerActivationPath;
const byCode = new Map<string, OwnerActivationAction>();

before(() => {
  applyMissionMigrations();
  summary = fleetSummary();
  activation = ownerActivationPath();
  for (const entry of activation.all) byCode.set(entry.code, entry);
});

after(() => {
  try { db.close(); } finally { clearInterval(keepAlive); }
});

it('a verdict read from the temp-directory database is marked FIXTURE / NOT PRODUCTION everywhere it matters', () => {
  assert.equal(summary.dataSource.kind, 'fixture');
  assert.match(summary.dataSource.source, /\.db$/, 'it names the file it read');
  assert.equal(summary.claimStatus, FIXTURE_CLAIM_MARK);
  assert.equal(summary.dataSource.claimsAllowed, false);
  assert.match(String(summary.claimRefusal), /cannot be stated as production state/);
  // Every production-shaped field carries the mark — not just a banner someone can crop out.
  const keys = Object.keys(summary.productionClaims);
  assert.deepEqual(keys.sort(), ['agentCounts', 'ownerAutonomy', 'payoutSlots', 'platformCredential']);
  for (const key of keys) {
    assert.equal(summary.productionClaims[key].status, FIXTURE_CLAIM_MARK, `${key} must be marked`);
    assert.ok(typeof summary.productionClaims[key].claim === 'string' && summary.productionClaims[key].claim.length > 0);
  }
  const slotsClaim = summary.productionClaims.payoutSlots.value as { total: number; verified: number };
  assert.ok(Number.isInteger(slotsClaim.verified) && slotsClaim.verified >= 0, 'the number stays visible and labelled, not hidden');
  assert.equal(activation.claimStatus, FIXTURE_CLAIM_MARK);
  assert.equal(activation.claimsAllowed, false);
  assert.match(String(activation.note), new RegExp(FIXTURE_CLAIM_MARK));
});

it('the mark is the classifier decision, not a second opinion', () => {
  const direct = classifyMissionDataSource();
  assert.equal(summary.claimStatus, claimMarkFor(direct.kind));
  assert.equal(summary.dataSource.source, direct.source);
  assert.equal(summary.dataSource.engine, direct.engine);
  assert.deepEqual([...summary.dataSource.reasons], [...direct.reasons], 'and it reports the same reasons');
});

it('each of the three named blockers names a real, existing control or variable that clears it', () => {
  const expected: Array<{ code: string; how: string; anchor: [string, string] }> = [
    { code: 'no_platform_credential', how: 'env var', anchor: ['.env.example', GITHUB_TOKEN_AUTHORITATIVE_ENV] },
    { code: 'no_payout_slot_verified', how: 'dashboard control', anchor: ['mission-dashboard/index.html', 'id="slot-form"'] },
    { code: 'autonomy_disabled', how: 'dashboard control', anchor: ['mission-dashboard/index.html', 'id="policy-autonomous"'] },
    // The scoped-contract gate: it used to name a CLI command as its remedy, which for an owner with no
    // shell on the host was a dead end written in confident prose. It now names a control, so the control
    // has to exist — the same check the other two dashboard blockers are held to.
    { code: 'no_scoped_contract', how: 'dashboard control', anchor: ['mission-dashboard/index.html', 'id="contracts-block"'] },
  ];
  for (const { code, how, anchor } of expected) {
    const entry = byCode.get(code);
    assert.ok(entry, `${code} is listed in the activation path`);
    assert.equal(entry.how, how);
    assert.ok(entry.target.length > 3, `${code} names a concrete target`);
    assert.match(entry.action, /\S/, `${code} states what the owner does`);
    assert.match(entry.verify, /npm run fleet:readiness|fleet:readiness/, `${code} says how to see it cleared`);
    const [file, needle] = anchor;
    assert.ok(read(file).includes(needle), `the ${code} action points at ${file} which really contains ${needle}`);
    assert.ok(entry.evidence.includes(file), `and its evidence cites ${file}`);
  }
  // The two other controls the list leans on exist too.
  assert.ok(read('mission-dashboard/index.html').includes('id="slot-verification"'), 'the payout verification checks are a real panel');
  assert.ok(read('mission-dashboard/index.html').includes('id="credential-form"'), 'the vault form is a real form');
  assert.ok(read('mission-dashboard/index.html').includes('id="kill-off"'), 'the kill switch release is a real button');
  assert.ok(read('mission-dashboard/index.html').includes('id="contracts-prepare-submit"'), 'preparing a scoped contract is a real button');
  assert.ok(read('src/mission/server.ts').includes("case 'agent-contracts'"), 'and a real route stands behind it');
  assert.match(read('package.json'), /"fleet:readiness":\s*"tsx scripts\/mission-fleet-readiness\.ts"/);
  assert.match(read('package.json'), /"mission:sync-registry":\s*"tsx scripts\/mission-sync-registry\.ts"/);
  assert.match(read('src/mission/server.ts'), /body\.autonomousEnabled !== undefined/, 'the dashboard control has a server-side handler');
});

it('every file:line an entry cites resolves to a real, non-blank line', () => {
  const cited = activation.all.map(entry => `${entry.evidence} ${entry.verify}`).join(' ');
  const refs = [...cited.matchAll(/([\w./-]+\.(?:ts|json|example|md)):(\d+)/g)].map(match => ({ file: match[1], line: Number(match[2]) }));
  assert.ok(refs.length >= 8, `the entries cite enough anchors to check, saw ${refs.length}`);
  for (const { file, line } of refs) {
    const resolved = path.join(ROOT, file);
    assert.ok(fs.existsSync(resolved), `${file} exists`);
    const lines = fs.readFileSync(resolved, 'utf8').split('\n');
    assert.ok(line >= 1 && line <= lines.length, `${file}:${line} is inside the file (${lines.length} lines)`);
    assert.ok(lines[line - 1].trim().length > 0, `${file}:${line} is not a blank line`);
  }
});

it('the remaining list is exactly the gates still closed, and clearing one clears its blocker', () => {
  assert.equal(activation.remaining.length, activation.all.filter(entry => !entry.cleared).length);
  assert.equal(activation.allClear, activation.remaining.length === 0);
  for (const entry of activation.remaining) assert.equal(entry.cleared, false);
  const codes = activation.remaining.map(entry => entry.code);
  assert.ok(new Set(codes).size === codes.length, 'no duplicated gate');
  // The payout judgement must agree with the row count it claims.
  const slots = db.get<Row>("SELECT COUNT(*) AS c FROM mission_payout_slots WHERE status='active' AND verified_at IS NOT NULL")!;
  const verified = Number(slots.c ?? 0);
  assert.equal(byCode.get('no_payout_slot_verified')?.cleared, verified > 0);
  const policy = db.get<Row>("SELECT autonomous_enabled, kill_switch FROM mission_policy WHERE id='global'") as Row | undefined;
  assert.ok(policy, 'the policy row the activation path reads exists');
  assert.equal(byCode.get('autonomy_disabled')?.cleared, Number(policy!.autonomous_enabled) === 1 && Number(policy!.kill_switch) === 0);
});

it('the verdict and the client agree about the credential, and neither can expose it', () => {
  // Long, hex-shaped and unique to this run: a fragment of it cannot collide with a legitimate
  // word in the verdict (an early version used the word "credential" and tripped on the field names).
  const value = `synthetic-${randomUUID().replace(/-/g, '')}${'abcdefghijklmnopqrstuvwxyz'}`;
  const previous = process.env[GITHUB_TOKEN_AUTHORITATIVE_ENV];
  process.env[GITHUB_TOKEN_AUTHORITATIVE_ENV] = value;
  try {
    const fresh = fleetSummary();
    assert.equal(fresh.execution.githubCredentialPresent, true, 'a token the owner sets is seen by the verdict');
    assert.equal(fresh.execution.githubCredentialSource, GITHUB_TOKEN_AUTHORITATIVE_ENV, 'as the name, resolved through the one source');
    assert.equal(resolveGithubToken(process.env, { scope: 'write' }), value, 'and by the client');
    assert.equal(configuredGithubBountyClient(process.env).authenticated, true, 'the worker and the report cannot disagree');
    const serialized = JSON.stringify(fresh);
    for (const fragment of [value, value.slice(0, 12), value.slice(-8)]) {
      assert.ok(!serialized.includes(fragment), 'the verdict must not carry the credential, a prefix of it, or a tail of it');
    }
    assert.ok(!/"(?:length|size|chars|bytes|fingerprint|hash_of_token)"\s*:/.test(serialized), 'nor anything sized about it');
    assert.ok(!serialized.includes('Bearer'), 'nor a composed authorization header');
    const statusNumbers = Object.values(githubCredentialStatus(process.env, { scope: 'write' })).filter(entry => typeof entry === 'number');
    assert.deepEqual(statusNumbers, [], 'the presence report has no numeric field at all, so it cannot carry a length');
    assert.equal(fresh.productionClaims.platformCredential.status, FIXTURE_CLAIM_MARK, 'and that claim is still marked');
  } finally {
    if (previous === undefined) delete process.env[GITHUB_TOKEN_AUTHORITATIVE_ENV];
    else process.env[GITHUB_TOKEN_AUTHORITATIVE_ENV] = previous;
  }
  assert.equal(resolveGithubToken(process.env, { scope: 'write' }), null, 'the synthetic credential is not left in the environment');
});

it('the Overview payload the console renders carries the activation path, not just the numbers', () => {
  const overview = buildMissionOverview();
  const fleet = overview.fleet as unknown as { claimStatus: string; activation: OwnerActivationPath | null; nextAction: string };
  assert.equal(fleet.claimStatus, FIXTURE_CLAIM_MARK, 'the console states the authority of what it shows');
  assert.ok(fleet.activation, 'the activation path reaches the payload the client reads');
  const remaining = fleet.activation!.remaining;
  assert.ok(remaining.length > 0, 'a scratch database always has something the owner must do');
  for (const entry of remaining) {
    assert.ok(['env var', 'dashboard control', 'CLI command'].includes(entry.how), `${entry.code} names a kind of action that exists`);
    assert.match(entry.target, /\S/, `${entry.code} names the control, variable or command itself`);
    assert.ok(entry.action.trim().split(/\s+/).length >= 5, `${entry.code} tells the owner what to do in a sentence, not a label`);
    assert.match(entry.evidence, /:\d+/, `${entry.code} cites where that control is defined`);
  }
  // The headline "Next action" must not stay a platitude when the fleet cannot move yet.
  assert.match(fleet.nextAction, /ZA141251SA_GITHUB_TOKEN|#slot-form|#policy-autonomous|assign|discovery/, 'the card line is an action, not a status');
  const serialized = JSON.stringify(overview);
  assert.ok(!/Bearer\s|ghp_|github_pat_|-----BEGIN/.test(serialized), 'the overview cannot carry a credential');
});

it('the --json report the owner is told to run actually emits the activation path', () => {
  const scratch = path.join(os.tmpdir(), `activation-cli-${randomUUID().slice(0, 8)}.db`);
  const tsx = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
  assert.ok(fs.existsSync(tsx), 'the repo-local tsx runner is available to spawn the real CLI');
  const run = spawnSync(tsx, [path.join(ROOT, 'scripts', 'mission-fleet-readiness.ts'), '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, ZA141251SA_DATABASE_URL: `file:${scratch}`, DATA_DIR: path.dirname(scratch), ZA141251SA_SESSION_SECRET: 'synthetic-cli-json-check' },
  });
  assert.equal(run.status, 0, `the readiness command exits cleanly: ${String(run.stderr).slice(0, 200)}`);
  const payload = JSON.parse(run.stdout) as { claimStatus: string; dataSource: { kind: string; source: string }; claimRefusal: string | null; activation: OwnerActivationPath };
  assert.equal(payload.dataSource.kind, 'fixture', 'a scratch run reports itself as scratch');
  assert.equal(payload.claimStatus, FIXTURE_CLAIM_MARK);
  assert.match(String(payload.claimRefusal), /cannot be stated as production state/);
  assert.ok(Array.isArray(payload.activation.remaining), 'the JSON carries the owner list');
  const codes = payload.activation.remaining.map(entry => entry.code);
  for (const required of ['no_payout_slot_verified', 'autonomy_disabled'] as const) {
    assert.ok(codes.includes(required), `${required} is listed for the owner, saw ${codes.join(',')}`);
  }
  for (const entry of payload.activation.remaining) {
    assert.ok(entry.target.length > 3 && entry.evidence.includes(':'), `${entry.code} carries its target and evidence`);
  }
  assert.ok(!run.stdout.includes('Bearer'), 'and no credential material is in the payload');
  fs.rmSync(scratch, { force: true });
});

it('a connector that declares a GitHub token answers from the same single source', () => {
  const saved = GITHUB_TOKEN_ENV_NAMES.map(name => [name, process.env[name]] as const);
  for (const name of GITHUB_TOKEN_ENV_NAMES) delete process.env[name];
  try {
    const find = () => listProviderReadiness().find(entry => entry.providerId === 'github_sponsors');
    const bare = find();
    assert.ok(bare, 'github_sponsors is in the connector registry');
    assert.equal(bare!.credentialEnv, 'GITHUB_TOKEN', 'the registry declares the compatibility name');
    assert.equal(bare!.status, 'not_configured', 'with nothing set anywhere, it honestly says unconfigured');
    // Setting ONLY a compatibility name must move the connector, because the read path honours it.
    // Bracket form on purpose: the credential suite pins that no other file touches these names in
    // dotted form, and a test that sets them must not become the exception to its own rule.
    process.env['GITHUB_TOKEN'] = `synthetic-${randomUUID().replace(/-/g, '')}`;
    const withFallback = find();
    assert.notEqual(withFallback!.status, 'not_configured', 'a fallback name is not reported as missing');
    // …while the write-capable gate keeps demanding the authoritative one.
    assert.equal(fleetSummary().execution.githubCredentialPresent, false, 'the worker gate stays closed on a fallback name');
    delete process.env['GITHUB_TOKEN'];
    process.env[GITHUB_TOKEN_AUTHORITATIVE_ENV] = `synthetic-${randomUUID().replace(/-/g, '')}`;
    assert.equal(fleetSummary().execution.githubCredentialPresent, true, 'and opens on the authoritative name');
    assert.notEqual(find()!.status, 'not_configured', 'the connector sees that one too');
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

it('the human report the owner runs prints the marks and never the credential', () => {
  const scratch = path.join(os.tmpdir(), `activation-human-${randomUUID().slice(0, 8)}.db`);
  const tsx = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
  const marker = `synthetic-cli-${randomUUID().replace(/-/g, '')}`;
  const run = spawnSync(tsx, [path.join(ROOT, 'scripts', 'mission-fleet-readiness.ts')], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    env: {
      ...process.env,
      ZA141251SA_DATABASE_URL: `file:${scratch}`,
      DATA_DIR: path.dirname(scratch),
      ZA141251SA_SESSION_SECRET: 'synthetic-cli-human-check',
      [GITHUB_TOKEN_AUTHORITATIVE_ENV]: marker,
    },
  });
  assert.equal(run.status, 0, `the readiness command exits cleanly: ${String(run.stderr).slice(0, 200)}`);
  assert.match(run.stdout, new RegExp(FIXTURE_CLAIM_MARK), 'the scratch run marks itself');
  assert.match(run.stdout, /owner activation path/, 'the owner list is printed, not only present in --json');
  assert.match(run.stdout, /#slot-form|#policy-autonomous|ZA141251SA_GITHUB_TOKEN/, 'with the exact control or variable named');
  assert.ok(!run.stdout.includes(marker), 'the credential value is never in the report');
  assert.ok(!run.stdout.includes(marker.slice(0, 10)), 'nor a prefix of it');
  // Sized claims are checked on the line that is *about* the credential: the report is full of
  // legitimate numbers elsewhere, so scanning the whole output for a small integer proves nothing.
  const credentialLine = (run.stdout.split('\n').find(line => line.includes('github credential')) ?? '').trim();
  assert.match(credentialLine, /present via ZA141251SA_GITHUB_TOKEN/);
  assert.ok(!credentialLine.includes(String(marker.length)), 'and the credential line carries no size of it');
  fs.rmSync(scratch, { force: true });
});

it('reading the verdict and the activation path writes nothing to the mission', () => {
  const tables = ['mission_policy', 'mission_payout_slots', 'mission_credentials', 'mission_agents', 'mission_audit', 'mission_human_action_tasks', 'bounty_programs', 'scope_allowlist', 'mission_revenue', 'mission_payouts'];
  const counts = () => tables.map(table => {
    const row = db.get<Row>(`SELECT COUNT(*) AS c FROM ${table}`) as Row | undefined;
    assert.ok(row, `the ${table} table is present, so this assertion is not vacuous`);
    return Number(row!.c);
  });
  const beforeCounts = counts();
  fleetSummary();
  ownerActivationPath();
  assert.deepEqual(counts(), beforeCounts);
  assert.equal(activation.remaining.length > 0 || activation.allClear, true, 'the path still reported a verdict after the read-only pass');
});
