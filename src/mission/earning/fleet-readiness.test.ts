import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `fleetready-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'synthetic-fleet-readiness-tests-not-live';
import { before, beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { missionDb as db, applyMissionMigrations, missionId, nowIso, type Row } from '../database';
import { provisionOwner } from '../auth';
import { updatePolicy, setKillSwitch } from '../policy';
import { ensurePayoutSlots } from '../treasury';
import { createHumanActionTask, HUMAN_ACTION_TYPES } from '../human-action-gate';
import * as Engine from './earning-engine';
import { fleetSummary, readinessFor, reconcileOwnerActions } from './fleet-readiness';

const keepAlive = setInterval(() => {}, 1000);
let ownerId = '';
const slugSeed = randomUUID().slice(0, 8);

function makeAgent(kind: 'production' | 'fixture', tag: string): string {
  const id = `agt-fr-${tag}-${randomUUID().slice(0, 8)}`;
  db.run(
    "INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,?,0,'registry','active','worker',?,?)",
    [id, `${slugSeed}-${tag}`, `Fleet ${tag}`, 'specialist', kind === 'production' ? 'akbaral-registry' : 'fixture', JSON.stringify(['coding'])],
  );
  return id;
}

let agentOne = '';
let agentTwo = '';

/** Open every gate the report checks. Used by the "the ladder is real" test only. */
function satisfyGates(agentIds: string[]): void {
  for (const id of agentIds) {
    db.run('INSERT INTO mission_money_grants (agent_id, status, spend_limit_cents, delegation_cents, can_create, expires_at, granted_by) VALUES (?,\'active\',0,0,0,?,\'test\')',
      [id, new Date(Date.now() + 3600_000).toISOString()]);
    db.run('INSERT INTO mission_agent_contracts (id, agent_id, purpose, permissions, resource_limits, budget_cents, status, approved_by, approved_at) VALUES (?,?,?,\'["tool.request"]\',\'{}\',0,\'active\',?,?)',
      [missionId('ctr'), id, 'bounded test scope', ownerId, nowIso()]);
  }
  // vault columns are NOT NULL; these are placeholders for a row that only has to
  // prove the report reads the vault's *presence* of an authorized credential.
  db.run(`INSERT INTO mission_credentials (id, provider, label, kind, scope, env_var, masked_hint, ciphertext, iv, tag, status, created_by)
       VALUES (?,?,'owner github token','oauth_token','["repo"]','ZA141251SA_GITHUB_TOKEN','…t','not-real-ciphertext','not-real-iv','not-real-tag','active','test')`,
    [missionId('cred'), 'github']);
  db.run("UPDATE mission_payout_slots SET status='active', verified_at=?, verified_by=? WHERE slot=1", [nowIso(), 'test']);
}

function pendingOpportunities(count: number): void {
  for (let i = 0; i < count; i += 1) {
    Engine.discoverOpportunity({
      registryKey: 'software_development', provider: `OSS Program ${slugSeed}-${i}`, platform: 'GitHub',
      grossCents: 20000 + i, expectedFeesCents: 0, expectedCostsCents: 0,
      paymentMethod: 'bounty payout', settlementEvidence: 'awaiting merge',
      opportunityExpiry: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      evidenceJson: { brief: `issue ${i}` },
    });
  }
}

before(() => {
  applyMissionMigrations();
  const owner = provisionOwner({ email: 'fr-owner@example.test', password: 'StrongPass!123', displayName: 'FR Owner' }) as { id?: string; owner?: { id: string } };
  ownerId = String(owner.id ?? owner.owner?.id ?? 'fr-owner');
  ensurePayoutSlots();
  agentOne = makeAgent('production', 'one');
  agentTwo = makeAgent('production', 'two');
  makeAgent('fixture', 'synthetic');
});

beforeEach(() => {
  setKillSwitch(false, ownerId);
  updatePolicy({
    currency: 'USD', killSwitch: false, autonomousEnabled: true, maxAgents: 5000, maxDailySpendCents: 100000, maxExpenseCents: 10000, requireApprovalAboveCents: 5000,
  } as never, ownerId);
  for (const table of ['mission_human_action_tasks', 'mission_agent_contracts', 'mission_money_grants', 'mission_credentials', 'mission_earning_engine_opportunities', 'mission_result_verifications', 'mission_execution_evidence', 'mission_revenue', 'mission_payouts', 'mission_bounty_assignments', 'mission_bounty_opportunities', 'mission_money_opportunities']) {
    try { db.run(`DELETE FROM ${table}`); } catch { /* nothing yet */ }
  }
  db.run("UPDATE mission_payout_slots SET status='unconfigured', verified_at=NULL, verified_by=NULL");
});

after(() => { try { db.close(); } finally { clearInterval(keepAlive); } });

it('counts registered fleet from live rows and never from fixture-origin agents', () => {
  const summary = fleetSummary();
  assert.ok(summary.counts.registeredAgents >= 2, 'the two registry-origin agents are counted');
  assert.equal(summary.counts.fixtureOriginAgents, 1, 'the fixture agent is tracked separately, not silently mixed in');
  assert.ok(!summary.counts.registeredAgents || summary.counts.registeredAgents === db.get<Row>("SELECT COUNT(*) AS c FROM mission_agents WHERE origin_platform NOT IN ('fixture','test','test_fixture')")!.c);
  assert.equal(summary.measuredFrom, 'live mission database rows only');
});

it('separates active from paused agents without the AND/OR precedence trap', () => {
  const pausedId = `agt-fr-paused-${randomUUID().slice(0, 8)}`;
  db.run(
    "INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,?,0,'registry','paused','worker','akbaral-registry',?)",
    [pausedId, `${slugSeed}-paused`, 'Fleet paused', 'specialist', JSON.stringify(['coding'])],
  );
  const summary = fleetSummary();
  assert.equal(summary.counts.registeredAgents, 3, 'a retired specialist is still registered');
  assert.equal(summary.counts.pausedOrRetiredAgents, 1, 'and is counted as paused, not as active');
  assert.equal(summary.counts.activeAgents, summary.counts.registeredAgents - 1);
  assert.equal(summary.counts.executionReadyAgents, 0, 'a paused agent is not admissible either');
  db.run('DELETE FROM mission_agents WHERE id=?', [pausedId]);
});

it('counts work on the GitHub-bounty path, not only the engine queue', () => {
  const repo = 'tenstorrent/tt-metal';
  db.run(
    `INSERT INTO mission_bounty_opportunities (id, repo_full_name, issue_number, issue_url, title, labels_json, hinted_amount_cents, state, observed_at, risk_state, issue_body)
     VALUES ('bty_test_1', ?, 59732, 'https://github.com/tenstorrent/tt-metal/issues/59732', 'Fix distribution bias', '["bounty"]', 300000, 'discovered', ?, 'accepted', 'live-shaped fixture')`,
    [repo, nowIso()],
  );
  db.run(
    `INSERT INTO mission_money_opportunities (id, title, evidence_url, activity, provider, approved_by, status, created_at)
     VALUES ('opp_test_1', 'Bounty: fix distribution bias', 'https://github.com/tenstorrent/tt-metal/issues/59732', 'software_development', 'github', ?, 'approved', ?)`,
    [ownerId, nowIso()],
  );
  db.run(
    `INSERT INTO mission_bounty_assignments (id, agent_id, opportunity_id, money_opportunity_id, state, approved_by, created_at)
     VALUES ('bta_test_1', ?, 'bty_test_1', 'opp_test_1', 'eligible', ?, ?)`,
    [agentOne, ownerId, nowIso()],
  );
  const summary = fleetSummary();
  assert.equal(summary.counts.bountyLeadsAccepted, 1);
  assert.equal(summary.counts.bountyAssignments, 1);
  assert.equal(summary.counts.eligibleTasksAssignable, 1, 'the bounty lead is real eligible work');
  assert.equal(summary.counts.assignedEligibleTasks, 1);
});

it('a registered agent is NOT execution-ready: zero grants, zero credentials, zero contracts', () => {
  const summary = fleetSummary();
  assert.equal(summary.counts.executionReadyAgents, 0);
  assert.equal(summary.counts.agentsWithVerifiedPlatformAccess, 0);
  assert.equal(summary.counts.agentsWithScopedContract, 0);
  const verdict = readinessFor(agentOne);
  assert.equal(verdict.registered, true);
  assert.equal(verdict.canStartNow, false);
  assert.ok(verdict.blockers.includes('no_active_money_grant'));
  assert.ok(verdict.blockers.includes('no_scoped_contract'));
  assert.ok(verdict.blockers.includes('no_platform_credential'));
  assert.ok(verdict.blockers.includes('no_payout_slot_verified'));
  assert.ok(verdict.blockers.includes('autonomy_disabled') === false, 'autonomy is on in this fixture');
});

it('satisfying every gate really does admit the fleet, and eligible work sets the concurrency', () => {
  satisfyGates([agentOne, agentTwo]);
  const before = fleetSummary();
  assert.equal(before.counts.executionReadyAgents, 2, 'both registry agents are admissible');
  assert.equal(before.counts.startingConcurrently, 0, 'no verified work exists yet — 0 agents start, not 4,001');
  assert.ok(before.blockers.length === 0, `no blockers expected, saw ${before.blockers.map(b => b.code).join(',')}`);

  pendingOpportunities(3);
  const after = fleetSummary();
  assert.equal(after.counts.eligibleTasksAssignable, 3);
  // Two admissible agents, three items of verified-eligible work: two start. Admitting
  // more work cannot raise it and a bigger registry cannot raise it either.
  assert.equal(after.counts.startingConcurrently, 2);
  const oneItem = db.get<Row>("SELECT id FROM mission_earning_engine_opportunities LIMIT 1")!;
  db.run("DELETE FROM mission_earning_engine_opportunities WHERE id<>?", [String(oneItem.id)]);
  assert.equal(fleetSummary().counts.startingConcurrently, 1, 'now work is the binding constraint');
});

it('an agent with an open owner task is held back without holding the rest of the fleet', () => {
  satisfyGates([agentOne, agentTwo]);
  createHumanActionTask({
    agentId: agentOne, opportunityId: null, actionType: HUMAN_ACTION_TYPES.KYC_VERIFICATION,
    reason: 'platform requires identity check by a human', platformUrl: 'https://example.test/kyc',
  });
  const one = readinessFor(agentOne);
  assert.equal(one.canStartNow, false);
  assert.ok(one.blockers.includes('owner_action_pending'));
  assert.equal(readinessFor(agentTwo).canStartNow, true, 'the neighbour is untouched');
  assert.equal(fleetSummary().counts.executionReadyAgents, 1);
});

it('kill switch engagement blocks the whole fleet, not the reports', () => {
  satisfyGates([agentOne, agentTwo]);
  setKillSwitch(true, ownerId);
  const summary = fleetSummary();
  assert.equal(summary.gates.policy.killSwitch, true);
  assert.equal(summary.counts.executionReadyAgents, 0);
  assert.equal(summary.counts.blockedAgents, summary.counts.registeredAgents);
  assert.ok(summary.blockers.some(b => b.code === 'kill_switch_engaged'));
});

it('owner-action reconciliation is idempotent and names a free path per blocker', () => {
  const first = reconcileOwnerActions();
  assert.ok(first.created.length >= 1, 'at least the credential/payout blockers queue owner actions');
  const rows = db.all<Row>("SELECT id, action_type, reason, notes FROM mission_human_action_tasks WHERE status='pending'");
  assert.equal(rows.length, first.created.length);
  for (const row of rows) {
    assert.match(String(row.notes), /^fleet-readiness:/);
    assert.match(String(row.reason), /^\[[a-z_]+\] .+ Affects \d+ agent/, 'each task names its blocker and its blast radius');
  }
  const second = reconcileOwnerActions();
  assert.equal(second.created.length, 0, 'a re-run opens nothing new while the same blockers stay open');
  assert.equal(second.openTotal, first.openTotal);
});

it('revenue and payout counts only count verified, settled facts', () => {
  db.run("INSERT INTO mission_revenue (id, amount_cents, currency, source, status, external_ref, idempotency_key, verifier, received_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [missionId('rev'), 50000, 'USD', 'platform', 'received', 'gh-bounty-1', 'rev-verified-1', 'owner', nowIso()]);
  db.run("INSERT INTO mission_revenue (id, amount_cents, currency, source, status, idempotency_key) VALUES (?,?,?,?,?,?)",
    [missionId('rev2'), 25000, 'USD', 'platform', 'expected', 'rev-expected-1']);
  const summary = fleetSummary();
  assert.equal(summary.counts.independentlyVerifiedRevenueCents, 50000, 'an unverified/expected row is never revenue');
  assert.equal(summary.counts.settledPayoutCents, 0);
  pendingOpportunities(1);
  assert.equal(fleetSummary().counts.completedWithEvidence, 0, 'no evidence, so no completed work — whatever the ledger says');
});
