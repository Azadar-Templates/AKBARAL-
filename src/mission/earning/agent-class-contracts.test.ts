/** Synthetic fixtures on a disposable database. No live platform, no real grants of money. */
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `class-contracts-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'fixture-only-class-contracts-not-live';
import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
const liveness = setInterval(() => {}, 1000);

const { applyMissionMigrations, missionDb: db } = require('../database') as typeof import('../database');
const contracts = require('./agent-class-contracts') as typeof import('./agent-class-contracts');
const money = require('../money') as typeof import('../money');
const { updatePolicy, setKillSwitch } = require('../policy') as typeof import('../policy');
const { readinessFor } = require('./fleet-readiness') as typeof import('./fleet-readiness');

const owner = { kind: 'owner' as const, id: 'class-owner' };
const agent = 'class-agent-research';
const executor = 'class-agent-executor';
const tables = ['mission_agent_contract_proposals', 'mission_agent_contracts', 'mission_money_grants', 'mission_money_opportunities', 'mission_human_action_tasks', 'mission_agent_chat_configs', 'mission_resources'];
const OCI_PIN = 'sha256:' + 'c'.repeat(64);

function withEnv<T>(values: Record<string, string | undefined>, run: () => T | Promise<T>): Promise<T> {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key] as string | undefined]));
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  return (async () => { try { return await run(); } finally { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } } })();
}

before(() => {
  applyMissionMigrations();
  db.run("INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,'class@example.invalid','fixture','owner','active')", [owner.id]);
  for (const [id, role] of [[agent, 'researcher'], [executor, 'executor']] as const) {
    db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES (?,?,'Class agent','specialist',0,'fixture','active',?,'fixture')", [id, id, role]);
    // The registry's production filter excludes fixture origin, so these are fixture agents
    // on purpose: the module must refuse them, and the grant path must still work.
  }
  db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES ('class-live-research','class-live-research','Live research agent','specialist',0,'custom','active','worker','mission')");
  db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES ('class-live-executor','class-live-executor','Live execution agent','specialist',0,'custom','active','worker','mission')");
  db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES ('class-suspended','class-suspended','Suspended agent','specialist',0,'custom','suspended','worker','mission')");
});
beforeEach(() => {
  setKillSwitch(false, owner.id);
  for (const table of tables) { try { db.run(`DELETE FROM ${table}`); } catch { /* table may be absent in a partial build */ } }
  updatePolicy({ killSwitch: false, autonomousEnabled: true, currency: 'USD', maxDailySpendCents: 10000, maxExpenseCents: 5000, requireApprovalAboveCents: 500 }, owner.id);
  money.setMoneyGrant(owner, 'class-live-research', { spendLimitCents: 5000, delegationCents: 0, canCreate: false, expiresAt: new Date(Date.now() + 86400000).toISOString(), status: 'active' });
  money.setMoneyGrant(owner, 'class-live-executor', { spendLimitCents: 5000, delegationCents: 0, canCreate: false, expiresAt: new Date(Date.now() + 86400000).toISOString(), status: 'active' });
  money.setMoneyGrant(owner, agent, { spendLimitCents: 5000, delegationCents: 0, canCreate: false, expiresAt: new Date(Date.now() + 86400000).toISOString(), status: 'active' });
  money.setMoneyGrant(owner, executor, { spendLimitCents: 5000, delegationCents: 0, canCreate: false, expiresAt: new Date(Date.now() + 86400000).toISOString(), status: 'active' });
});
after(() => { try { db.close(); } finally { clearInterval(liveness); } });

it('every class is least-privilege by construction, and the human-only classes grant nothing', () => {
  const seen = contracts.AGENT_CLASS_CONTRACTS.map(definition => definition.agentClass);
  assert.deepEqual(seen.slice().sort(), ['bounty_execution', 'bounty_research', 'evidence_verification', 'owner_submission', 'payout_release']);
  for (const definition of contracts.AGENT_CLASS_CONTRACTS) {
    assert.equal(definition.permissions.filter(permission => !(contracts.GRANTABLE_PERMISSIONS as readonly string[]).includes(permission)).length, 0, definition.agentClass);
    assert.equal(definition.permissions.filter(permission => (definition.denied as readonly string[]).includes(permission)).length, 0, `${definition.agentClass} may not both grant and deny a permission`);
    assert.equal(definition.resourceLimits.maxChildren, 0, 'no earning class may create agents');
    assert.equal(definition.resourceLimits.maxDepth, 1, 'no earning class may deepen the tree');
    assert.ok(definition.validityDays > 0 && definition.validityDays <= 30, `${definition.agentClass} must expire`);
    for (const never of contracts.NEVER_GRANTED_PERMISSIONS) {
      assert.ok((definition.denied as readonly string[]).includes(never) || definition.permissions.length === 0, `${definition.agentClass} omits ${never}`);
      assert.equal(definition.permissions.includes(never as never), false, `${never} is never grantable`);
    }
  }
  for (const sensitive of ['owner_submission', 'payout_release']) {
    const definition = contracts.classContractDefinition(sensitive)!;
    assert.equal(definition.ownerOnly, true, sensitive);
    assert.deepEqual([...definition.permissions], [], `${sensitive} holds no agent permissions at all`);
  }
});

it('eligibility refuses on live facts, one blocker at a time', async () => {
  assert.equal(contracts.classEligibility('class-live-research', 'nope').blockers[0], 'class_unknown');
  assert.equal(contracts.classEligibility('class-live-research', 'owner_submission').blockers[0], 'class_owner_only');
  assert.equal(contracts.classEligibility('class-live-research', 'payout_release').eligible, false);
  assert.equal(contracts.classEligibility('missing-agent', 'bounty_research').blockers[0], 'agent_not_found');
  assert.ok(contracts.classEligibility(agent, 'bounty_research').blockers.includes('agent_is_fixture_origin'), 'a fixture-origin agent is a test subject, not a worker');
  assert.ok(contracts.classEligibility('class-suspended', 'bounty_research').blockers.includes('agent_not_active'));
  // Execution needs a backend that can actually run repository code.
  await withEnv({ ZA141251SA_BOUNTY_SANDBOX_MODE: 'off' }, () => {
    assert.ok(contracts.classEligibility('class-live-executor', 'bounty_execution').blockers.includes('no_execution_backend'));
  });
  await withEnv({ ZA141251SA_BOUNTY_SANDBOX_MODE: undefined, ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST: OCI_PIN, ZA141251SA_BOUNTY_SANDBOX_RUNTIME: 'docker' }, () => {
    assert.equal(contracts.executionBackendConfigured(), true);
    const eligible = contracts.classEligibility('class-live-executor', 'bounty_execution');
    assert.equal(eligible.eligible, true, eligible.blockers.join(','));
    assert.equal(eligible.snapshot.executionBackend, true);
  });
  // A class that may spend needs a grant that covers the class floor.
  db.run("UPDATE mission_money_grants SET spend_limit_cents=100 WHERE agent_id='class-live-executor'");
  await withEnv({ ZA141251SA_BOUNTY_SANDBOX_MODE: undefined, ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST: OCI_PIN }, () => {
    assert.ok(contracts.classEligibility('class-live-executor', 'bounty_execution').blockers.includes('money_grant_below_class_spend_floor'));
  });
});

it('preparation freezes the class permissions into a proposal and grants nothing', async () => {
  await withEnv({ ZA141251SA_BOUNTY_SANDBOX_MODE: undefined, ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST: OCI_PIN }, () => {
    const proposal = contracts.prepareClassContract(owner, { agentId: 'class-live-research', agentClass: 'bounty_research', note: 'reviewed batch 1' });
    assert.equal(proposal.status, 'pending');
    assert.equal(proposal.purpose, String(proposal.purpose));
    assert.match(String(proposal.purpose), /^class:bounty_research:[a-f0-9]{8}$/);
    assert.deepEqual(JSON.parse(String(proposal.permissions_json)), ['report.submit']);
    const limits = JSON.parse(String(proposal.resource_limits_json));
    assert.equal(limits.maxChildren, 0);
    assert.equal(limits.requiresSandbox, false);
    assert.equal(Number(db.get<any>("SELECT COUNT(*) AS c FROM mission_agent_contracts WHERE status='active'").c), 0, 'prepared must not equal granted');
    assert.equal(db.get<any>("SELECT approved_by FROM mission_agent_contracts WHERE agent_id='class-live-research'"), undefined);
    // The whole point of a separate table: a pending proposal must not disable the agent.
    const grant = money.grant('class-live-research');
    assert.equal(String(grant.agent_id), 'class-live-research');
    assert.throws(() => contracts.prepareClassContract(owner, { agentId: 'class-live-research', agentClass: 'bounty_research' }), /proposal_already_pending/);
    assert.throws(() => contracts.prepareClassContract(owner, { agentId: 'class-live-research', agentClass: 'owner_submission' }), /class_owner_only/);
    assert.throws(() => contracts.prepareClassContract({ kind: 'agent', id: 'class-live-research' } as never, { agentId: 'class-live-research', agentClass: 'bounty_research' }), /owner/);
  });
});

it('activation is owner-only, exact, and refuses a widened or expired proposal', async () => {
  await withEnv({ ZA141251SA_BOUNTY_SANDBOX_MODE: undefined, ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST: OCI_PIN }, () => {
    const proposal = contracts.prepareClassContract(owner, { agentId: 'class-live-research', agentClass: 'bounty_research' });
    const id = String(proposal.id);
    const approved = contracts.approveClassContractProposal(owner, id, 'approved in review');
    assert.equal(String(approved.status), 'active');
    assert.equal(String(approved.agent_id), 'class-live-research');
    assert.deepEqual(JSON.parse(String(approved.permissions)), ['report.submit']);
    assert.equal(String(approved.approved_by), owner.id);
    assert.ok(Date.parse(String(approved.expires_at)) > Date.now(), 'an active contract must expire');
    assert.equal(db.get<any>('SELECT status FROM mission_agent_contract_proposals WHERE id=?', [id]).status, 'approved');
    assert.equal(db.get<any>('SELECT contract_id FROM mission_agent_contract_proposals WHERE id=?', [id]).contract_id, String(approved.id));
    assert.equal(contracts.classEligibility('class-live-research', 'bounty_research').blockers[0], 'active_contract_for_class_exists');

    // Fleet readiness must now see a scoped contract for this agent and none for its peers.
    assert.equal(readinessFor('class-live-research').hasScopedContract, true);
    assert.equal(readinessFor('class-live-executor').hasScopedContract, false);

    // A tampered proposal can never activate.
    const other = contracts.prepareClassContract(owner, { agentId: 'class-live-executor', agentClass: 'bounty_execution' });
    db.run("UPDATE mission_agent_contract_proposals SET permissions_json=? WHERE id=?", [JSON.stringify(['report.submit', 'payout.send', 'agent.create']), String(other.id)]);
    assert.throws(() => contracts.approveClassContractProposal(owner, String(other.id)), /proposal_permissions_widened/);
    // Restored to the execution class's own allowlist, so the next refusal is the one under test.
    db.run("UPDATE mission_agent_contract_proposals SET permissions_json=? WHERE id=?", [JSON.stringify([...contracts.classContractDefinition('bounty_execution')!.permissions].sort()), String(other.id)]);
    db.run("UPDATE mission_agent_contract_proposals SET resource_limits_json=? WHERE id=?", [JSON.stringify({ maxChildren: 4, maxDepth: 3, maxSpendCents: 1, maxConcurrentRuns: 1 }), String(other.id)]);
    assert.throws(() => contracts.approveClassContractProposal(owner, String(other.id)), /proposal_allows_child_creation|proposal_allows_deeper_tree/);
    db.run("UPDATE mission_agent_contract_proposals SET resource_limits_json=? WHERE id=?", [JSON.stringify({ maxChildren: 0, maxDepth: 1, maxSpendCents: 9_999_999, maxConcurrentRuns: 1 }), String(other.id)]);
    assert.throws(() => contracts.approveClassContractProposal(owner, String(other.id)), /proposal_spend_above_policy_cap/);
    db.run("UPDATE mission_agent_contract_proposals SET expires_at=? WHERE id=?", [new Date(Date.now() - 1000).toISOString(), String(other.id)]);
    assert.throws(() => contracts.approveClassContractProposal(owner, String(other.id)), /proposal_expired/);
    assert.equal(db.get<any>('SELECT status FROM mission_agent_contract_proposals WHERE id=?', [String(other.id)]).status, 'expired');
  });
});

it('a batch prepares a bounded number, files one owner task, and never self-approves', async () => {
  for (let index = 1; index <= 12; index += 1) {
    const id = `class-batch-${index}`;
    db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES (?,?,'Batch agent','specialist',0,'custom','active','worker','mission')", [id, id]);
    money.setMoneyGrant(owner, id, { spendLimitCents: 5000, delegationCents: 0, canCreate: false, expiresAt: new Date(Date.now() + 86400000).toISOString(), status: 'active' });
  }
  const result = await withEnv({ ZA141251SA_BOUNTY_SANDBOX_MODE: undefined }, () =>
    contracts.prepareClassContractsForClass(owner, { agentClass: 'bounty_research', limit: 5 }));
  assert.equal(result.prepared, 5, `prepared ${result.prepared} of ${result.eligible} eligible`);
  assert.equal(result.preparedIds.length, 5);
  assert.equal(db.get<any>("SELECT COUNT(*) AS c FROM mission_agent_contracts WHERE status='active' AND purpose LIKE 'class:bounty_research%'").c, 0, 'a batch cannot grant itself');
  assert.equal(db.get<any>("SELECT COUNT(*) AS c FROM mission_human_action_tasks WHERE status='pending' AND action_type='manual_approval'").c, 1, 'one review task for the batch, not one per agent');
  assert.match(String(db.get<any>("SELECT reason FROM mission_human_action_tasks WHERE action_type='manual_approval'").reason), /await owner approval/);
  const readiness = contracts.classContractReadiness();
  const research = readiness.find(row => row.agentClass === 'bounty_research')!;
  assert.equal(research.pendingProposals, 5);
  assert.equal(research.active, 0);
  assert.ok(research.eligibleNow >= 5);
  const submission = readiness.find(row => row.agentClass === 'owner_submission')!;
  assert.equal(submission.ownerOnly, true);
  assert.equal(submission.eligibleNow, 0, 'no agent is ever eligible for a human-only class');
  assert.equal(contracts.listClassContractProposals('pending', 3).length, 3);
  assert.equal(contracts.listClassContractProposals('pending', 10_000).length, 5, 'the listing cap is bounded but never silently drops below what exists');
});

it('rejections need a reason, and stale proposals expire out of the queue', () => {
  const first = contracts.prepareClassContract(owner, { agentId: 'class-live-research', agentClass: 'bounty_research' });
  assert.throws(() => contracts.rejectClassContractProposal(owner, String(first.id), '   '), /invalid_input/);
  const rejected = contracts.rejectClassContractProposal(owner, String(first.id), 'same agent already submits PRs by hand');
  assert.equal(String(rejected.status), 'rejected');
  assert.equal(String(rejected.review_note), 'same agent already submits PRs by hand');
  assert.throws(() => contracts.approveClassContractProposal(owner, String(first.id)), /proposal_not_pending/);
  const second = contracts.prepareClassContract(owner, { agentId: 'class-live-research', agentClass: 'bounty_research' });
  assert.equal(contracts.expireStaleProposals().expired, 0, 'a fresh proposal is not stale');
  db.run("UPDATE mission_agent_contract_proposals SET expires_at=? WHERE id=?", [new Date(Date.now() - 1000).toISOString(), String(second.id)]);
  assert.equal(contracts.expireStaleProposals().expired, 1);
  assert.equal(contracts.listClassContractProposals('pending').length, 0);
});
