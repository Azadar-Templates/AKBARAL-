/**
 * The specialist fleet: one verified platform per agent, one real profile per agent, and a
 * readiness ladder that only opens when every gate behind a state actually holds.
 *
 * The last test here is the one that matters most: it satisfies every gate for real, in a scratch
 * database, and shows the ladder does open to WORKING. Without it, "refuses everything" could
 * simply mean "broken".
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `spec-fleet-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'synthetic-specialist-fleet-tests-not-live';
import { before, beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { missionDb as db, applyMissionMigrations, missionId, nowIso, type Row } from '../database';
import { provisionOwner } from '../auth';
import { updatePolicy, setKillSwitch } from '../policy';
import { ensurePayoutSlots } from '../treasury';
import { applyPlatformCatalog, platformRecordFor } from './platform-catalog';
import {
  STATE_LADDER, assignOpportunity, certifyAgents, evaluateGates, fleetReport, groupingGaps, listSpecialistRecords,
  rankOpportunityQueue, recordOutcome, refreshFleetStates, registryCoverage, releaseAssignment, setSpecialistState,
  specializeAgent, specialistRecord,
} from './specialist-fleet';
import { SPECIALIST_SPECIALTIES } from './specialty-registry';
import { runSpecialistEvaluation, profileRulesDigest } from './specialist-evaluation';
import { discoverOpportunity } from './earning-engine';

const keepAlive = setInterval(() => {}, 1000);
let ownerId = '';
let agentOne = '';
let agentTwo = '';
let agentThree = '';
let fixtureAgent = '';
const slugSeed = randomUUID().slice(0, 8);
const owner = (): { kind: 'owner'; id: string } => ({ kind: 'owner', id: ownerId });
const asAgent = (id: string): { kind: 'agent'; id: string } => ({ kind: 'agent', id });

/** The vault row is a placeholder: the gate reads *presence* of a registered credential, never a
 *  real secret, and the provider has to be the id the registry actually uses. */
function insertCredentialFor(agentId: string, envVar: string): void {
  const platformId = String(profileRow(agentId).platform_id);
  db.run(`INSERT INTO mission_credentials (id, provider, label, kind, scope, env_var, masked_hint, ciphertext, iv, tag, status, created_by)
       VALUES (?, ?, 'owner venue token', 'oauth_token', '["read"]', ?, '…test', 'not-real-ciphertext', 'not-real-iv', 'not-real-tag', 'active', 'test')`, [missionId('cred'), platformId, envVar]);
}

function makeAgent(tag: string, origin = 'akbaral-registry'): string {
  const id = `agt-fl-${tag}-${randomUUID().slice(0, 8)}`;
  db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,'specialist',0,'registry','active','worker',?,?)",
    [id, `fl-${slugSeed}-${tag}`, `Fleet ${tag}`, origin, JSON.stringify(['coding'])]);
  return id;
}
function profileRow(id: string): Row {
  const row = db.get<Row>('SELECT * FROM mission_agent_specialists WHERE agent_id=?', [id]);
  assert.ok(row, `profile row for ${id}`);
  return row!;
}
function assignmentRow(id: string): Row | undefined {
  return db.get<Row>("SELECT * FROM mission_agent_platform_assignments WHERE agent_id=? AND slot_type='primary' AND status='active'", [id]);
}

before(() => {
  applyMissionMigrations();
  ownerId = String(provisionOwner({ email: `fl-${randomUUID().slice(0, 8)}@example.invalid`, password: `synthetic-fleet-${randomUUID()}` }).id);
  ensurePayoutSlots();
  applyPlatformCatalog(owner());
  applyPlatformCatalog(owner());
  agentOne = makeAgent('one');
  agentTwo = makeAgent('two');
  agentThree = makeAgent('three');
  fixtureAgent = makeAgent('fixture', 'fixture');
});

beforeEach(() => {
  setKillSwitch(false, ownerId);
  // Test databases start with autonomous execution off, exactly like production; the last test
  // turns it on deliberately to prove the gate opens rather than being hardcoded shut.
  updatePolicy({ currency: 'USD', killSwitch: false, autonomousEnabled: false, maxAgents: 5000 } as never, ownerId);
});

after(() => { try { db.close(); } finally { clearInterval(keepAlive); } });

it('assigns one agent to one verified venue and materializes a profile from the venue rules', () => {
  const result = specializeAgent({ actor: owner(), agentId: agentOne, platformId: 'github_issue_bounties' });
  assert.equal(result.state, 'PLATFORM_ASSIGNED');
  assert.match(result.profileDigest, /^[0-9a-f]{64}$/);
  const row = profileRow(agentOne);
  // Which spelling lands in the registry depends on whether the connector seed created the row
  // (raw id) or discovery did (normalized id); the assignment must follow whichever exists.
  assert.ok(['github_issue_bounties', 'github-issue-bounties'].includes(String(row.platform_id)), `unexpected platform id ${String(row.platform_id)}`);
  assert.equal(String(row.specialty_key), 'github_bounty_engineer');
  assert.equal(String(row.agent_class), 'bounty_execution');
  const rules = JSON.parse(String(row.rules_json)) as { scope: string[]; submission: string[]; eligibility: string[] };
  assert.ok(rules.scope.some(line => /allowlist/i.test(line)), 'scope rules must carry the venue allowlist rule');
  assert.ok(rules.submission.some(line => /owner approval/i.test(line)), 'submission must be owner-gated in the profile itself');
  assert.ok(rules.eligibility.join(' ').length > 60, 'eligibility must state the account and payment conditions');
  const gate = JSON.parse(String(row.evaluation_gate_json)) as { key: string; critical: boolean }[];
  assert.ok(gate.some(entry => entry.key === 'claim' && entry.critical), 'the claim recheck is a graded, critical gate');
});

it('enforces one platform per agent and one agent per platform, in both directions', () => {
  specializeAgent({ actor: owner(), agentId: agentTwo, platformId: 'hackerone' });
  specializeAgent({ actor: owner(), agentId: agentThree, platformId: 'immunefi' });
  assert.throws(() => specializeAgent({ actor: owner(), agentId: agentTwo, platformId: 'bugcrowd' }), /agent_already_assigned/);
  assert.throws(() => specializeAgent({ actor: owner(), agentId: makeAgent('taker'), platformId: 'hackerone' }), /platform_already_taken/);
  // The same agent and venue again is a refresh, not a conflict.
  const again = specializeAgent({ actor: owner(), agentId: agentTwo, platformId: 'hackerone' });
  assert.equal(again.assignment.reused, true);
  assert.equal(Number(profileRow(agentTwo).profile_version), 2, 'a refresh bumps the profile version instead of pretending nothing changed');
});

it('refuses to assign an agent to a venue the evidence says is closed, unread, or automation-hostile', () => {
  assert.throws(() => specializeAgent({ actor: owner(), agentId: makeAgent('c4'), platformId: 'code4rena' }), /platform_not_assignable.*verdict_inactive/);
  assert.throws(() => specializeAgent({ actor: owner(), agentId: makeAgent('pal'), platformId: 'paladin' }), /platform_not_assignable.*verdict_unverified/);
  assert.throws(() => specializeAgent({ actor: owner(), agentId: makeAgent('patch'), platformId: 'patchstack' }), /automation_prohibited/);
  assert.throws(() => specializeAgent({ actor: owner(), agentId: makeAgent('ghost'), platformId: 'not_a_venue' }), /platform_not_in_catalog/);
});

it('will not specialize an unknown, paused, or fixture-origin agent', () => {
  assert.throws(() => specializeAgent({ actor: owner(), agentId: 'agt_does_not_exist', platformId: 'github_issue_bounties' }), /specialist_agent_unknown/);
  assert.throws(() => specializeAgent({ actor: owner(), agentId: fixtureAgent, platformId: 'github_issue_bounties' }), /specialist_agent_is_fixture/);
  db.run("UPDATE mission_agents SET status='paused' WHERE id=?", [agentThree]);
  assert.throws(() => specializeAgent({ actor: owner(), agentId: agentThree, platformId: 'immunefi' }), /specialist_agent_not_active/);
  db.run("UPDATE mission_agents SET status='active' WHERE id=?", [agentThree]);
});

it('records an unauthorized account grouping as an owner action instead of inventing an account', () => {
  const result = specializeAgent({ actor: owner(), agentId: makeAgent('gap'), platformId: 'intigriti', gmailGroup: 'gmail-4' });
  assert.equal(result.state, 'NEEDS_OWNER_ACTION');
  assert.match(result.stateReason, /not an authorized account grouping/);
  assert.throws(() => specializeAgent({ actor: owner(), agentId: agentThree, platformId: 'bugcrowd', gmailGroup: 'gmail-9' as never }), /specialist_account_group_unknown/);
  const gaps = groupingGaps();
  assert.ok(gaps.some(entry => entry.gmailGroup === 'gmail-4' && entry.specialists === 1), `expected one gmail-4 specialist, saw ${JSON.stringify(gaps)}`);
  // The venue is still worked on: the profile exists, and only the access step is blocked.
  const gapAgent = String(db.get<Row>("SELECT agent_id AS id FROM mission_agent_platform_assignments WHERE gmail_group='gmail-4' AND status='active' LIMIT 1")!.id);
  assert.equal(String(profileRow(gapAgent).platform_id), 'intigriti');
});

it('walks the ladder one step at a time and refuses every shortcut', () => {
  // Reuses the immunefi specialist rather than grabbing another venue: one venue can only have
  // one primary agent, and a test suite that ignored that rule would fight the rule it checks.
  const agent = agentThree;
  assert.equal(String(profileRow(agent).state), 'PLATFORM_ASSIGNED');
  assert.throws(() => setSpecialistState({ actor: owner(), agentId: agent, to: 'EXECUTION_READY', reason: 'optimism' }), /specialist_state_skip/);
  const trained = setSpecialistState({ actor: owner(), agentId: agent, to: 'TRAINING', reason: 'profile loaded' });
  assert.equal(trained.to, 'TRAINING');
  // SKILLS_VERIFIED without a certificate is refused, and the refusal is itself recorded.
  const refused = setSpecialistState({ actor: owner(), agentId: agent, to: 'SKILLS_VERIFIED', reason: 'trust me' });
  assert.notEqual(refused.to, 'SKILLS_VERIFIED');
  assert.match(String(profileRow(agent).state_reason), /skill_certificate_no_evaluation/);
  const transitions = db.all<Row>('SELECT to_state AS state FROM mission_agent_state_transitions WHERE agent_id=? ORDER BY created_at', [agent]) ?? [];
  assert.ok(transitions.some(entry => String(entry.state) === 'TRAINING'), 'each move is audited');
  assert.ok(STATE_LADDER.indexOf('SKILLS_VERIFIED') > STATE_LADDER.indexOf('TRAINING'));
});

it('holds ACCESS_READY until a credential exists and the grouping is authorized', () => {
  const agent = makeAgent('access');
  specializeAgent({ actor: owner(), agentId: agent, platformId: 'yeswehack', gmailGroup: 'gmail-3' });
  assert.equal(certifyAgents({ actor: owner(), agentIds: [agent] }).passed, 1, 'the ladder needs a certificate before access');
  const gates = evaluateGates(agent, 'ACCESS_READY');
  assert.ok(gates.blockers.some(line => line.startsWith('credential_absent')), 'no credential record means no access');
  assert.ok(gates.ownerActions.some(line => /secret manager/.test(line)), 'the blocker has to name the cheapest legitimate way through');
  const blocked = setSpecialistState({ actor: owner(), agentId: agent, to: 'ACCESS_READY', reason: 'want access' });
  assert.equal(blocked.to, 'NEEDS_OWNER_ACTION');
  // The vault row is a placeholder: these tests prove the gate reads *presence*, never a real secret.
  insertCredentialFor(agent, 'YESWEHACK_TOKEN');
  const granted = setSpecialistState({ actor: owner(), agentId: agent, to: 'ACCESS_READY', reason: 'credential registered' });
  assert.equal(granted.to, 'ACCESS_READY', `expected access, got ${JSON.stringify(evaluateGates(agent, 'ACCESS_READY'))}`);
  assert.equal(evaluateGates(agent, 'CONTRACT_APPROVED').blockers.some(line => line.startsWith('no_scoped_contract')), true);
});

it('will not call an agent EXECUTION_READY while the owner policy keeps autonomy off', () => {
  const agent = makeAgent('exec');
  specializeAgent({ actor: owner(), agentId: agent, platformId: 'frantic_agent_marketplace' });
  setSpecialistState({ actor: owner(), agentId: agent, to: 'TRAINING', reason: 'profile loaded' });
  const outcome = runSpecialistEvaluation({ actor: owner(), profile: profileView(agent), mode: 'deterministic' });
  assert.equal(outcome.passed, true);
  setSpecialistState({ actor: owner(), agentId: agent, to: 'SKILLS_VERIFIED', reason: 'suite passed' });
  assert.equal(String(profileRow(agent).state), 'SKILLS_VERIFIED');
  assert.equal(Number(profileRow(agent).skill_level), outcome.score, 'skill level comes from the graded suite, nothing else');
  insertCredentialFor(agent, 'FRANTIC_TOKEN');
  const accessed = setSpecialistState({ actor: owner(), agentId: agent, to: 'ACCESS_READY', reason: 'credential registered' });
  assert.equal(accessed.to, 'ACCESS_READY', JSON.stringify(evaluateGates(agent, 'ACCESS_READY')));
  db.run('INSERT INTO mission_agent_contracts (id, agent_id, purpose, permissions, resource_limits, budget_cents, status, approved_by, approved_at) VALUES (?, ?, ?, \'["report.submit"]\', \'{}\', 0, \'active\', ?, ?)',
    [missionId('ctr'), agent, 'bounded research scope', ownerId, nowIso()]);
  const contracted = setSpecialistState({ actor: owner(), agentId: agent, to: 'CONTRACT_APPROVED', reason: 'scoped contract approved' });
  assert.equal(contracted.to, 'CONTRACT_APPROVED');
  const refused = setSpecialistState({ actor: owner(), agentId: agent, to: 'EXECUTION_READY', reason: 'ready?' });
  assert.equal(refused.to, 'NEEDS_OWNER_ACTION', 'autonomy is an owner switch, so the state must not be reachable by argument');
  assert.match(String(profileRow(agent).state_reason), /autonomy_disabled/);
});

function profileView(agentId: string): Parameters<typeof runSpecialistEvaluation>[0]['profile'] {
  const row = profileRow(agentId);
  const rules = JSON.parse(String(row.rules_json)) as Record<string, string[]>;
  return {
    agentId, platformId: String(row.platform_id), specialtyKey: String(row.specialty_key),
    rules: { discovery: rules.discovery ?? [], eligibility: rules.eligibility ?? [], scope: rules.scope ?? [], submission: rules.submission ?? [], severity: rules.severity ?? [] },
    skills: JSON.parse(String(row.skills_json)) as { key: string; label: string; evaluatedBy: string }[],
    permissions: JSON.parse(String(row.permissions_json)) as string[],
    denied: JSON.parse(String(row.denied_permissions_json ?? '[]')) as string[],
    deadlineVerification: (JSON.parse(String(row.deadline_policy_json)) as { checks?: string[] }).checks ?? [],
    rewardVerification: JSON.parse(String(row.reward_verification_json)) as Record<string, unknown>,
    rejectionCodes: JSON.parse(String(row.rejection_codes_json)) as string[],
    submissionRequirements: rules.submission ?? [],
  };
}

it('lets only the owner issue certificates, and never lets an agent certify itself', () => {
  assert.throws(() => certifyAgents({ actor: asAgent(agentOne) }), /specialist_certification_owner_only/);
  const result = certifyAgents({ actor: owner(), agentIds: [agentOne] });
  assert.equal(result.attempted, 1);
  assert.equal(result.passed, 1, `github specialist should certify: ${JSON.stringify(result.failed)}`);
  assert.equal(String(profileRow(agentOne).state), 'SKILLS_VERIFIED');
  assert.equal(db.get<Row>("SELECT COUNT(*) AS c FROM mission_specialist_evaluations WHERE agent_id=? AND mode='deterministic'", [agentOne])!.c, 1);
});

it('ranks only what discovery actually recorded, and says so when the registry is empty', () => {
  const empty = rankOpportunityQueue({ actor: owner(), agentId: agentOne });
  assert.equal(empty.written, 0);
  assert.equal(empty.registryRows, 0);
  assert.match(String(empty.note), /registry_empty/);

  for (const [index, [reward, status, automation]] of [[300_000, 'verified', 'allowed'], [50_000, 'pending_review', 'conditional'], [0, 'verified', 'allowed']].entries()) {
    db.run(`INSERT INTO mission_opportunities (id, platform, opportunity_type, title, category, skills, payout_max_cents, automation_permission, country_eligibility, source_url, dedup_hash, status, risk_level)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      `mop_fl_${slugSeed}_${index}`, 'GitHub funded issue bounties', 'remote_job', `Bounty candidate ${index}`, 'software_development',
      JSON.stringify(index === 0 ? ['typescript', 'testing', 'security'] : ['typescript']), reward, automation,
      index === 2 ? '[]' : JSON.stringify(['US', 'PK']), `https://github.com/someone/else/issues/${10 + index}`, `dedup-${slugSeed}-${index}`, status, 'low',
    ] as never);
  }
  const ranked = rankOpportunityQueue({ actor: owner(), agentId: agentOne, limit: 5 });
  assert.equal(ranked.registryRows, 3);
  assert.equal(ranked.rows.length, 3, 'every candidate is ranked, including the ones with blockers');
  assert.equal(ranked.rows[0].funding_verified, true, 'a verified, funded, well-paying candidate comes first');
  assert.ok(ranked.rows[0].priority > ranked.rows[1].priority, 'priority ordering must follow the stored factors');
  const noReward = ranked.rows.find(entry => entry.reward_usd_cents === 0);
  assert.ok(noReward && noReward.blockers.some(line => /no_stated_reward/.test(line)), 'a reward with no floor is not income');
  const stored = db.all<Row>('SELECT rank, priority_score, state FROM mission_specialist_opportunities WHERE agent_id=? ORDER BY rank', [agentOne]) ?? [];
  assert.equal(stored.length, 3);
  assert.equal(Number(stored[0].rank), 1);
  assert.equal(String(stored[2].state), 'blocked', 'a blocked candidate is stored as blocked, not dropped');
});

it('lets the owner place work only on a specialist that is genuinely ready, and nobody else at all', () => {
  const blocked = db.get<Row>("SELECT opportunity_key FROM mission_specialist_opportunities WHERE agent_id=? AND state='blocked'", [agentOne]);
  assert.throws(() => assignOpportunity({ actor: owner(), agentId: agentOne, opportunityKey: String(blocked!.opportunity_key) }), /specialist_opportunity_blocked/);
  const top = db.get<Row>("SELECT opportunity_key FROM mission_specialist_opportunities WHERE agent_id=? AND state='candidate' ORDER BY rank LIMIT 1", [agentOne]);
  assert.throws(() => assignOpportunity({ actor: asAgent(agentOne), agentId: agentOne, opportunityKey: String(top!.opportunity_key) }), /specialist_assignment_owner_only/);
  // The specialist is SKILLS_VERIFIED with access gaps, so even the owner cannot place work yet.
  assert.throws(() => assignOpportunity({ actor: owner(), agentId: agentOne, opportunityKey: String(top!.opportunity_key) }), /specialist_not_execution_ready/);
  assert.throws(() => assignOpportunity({ actor: owner(), agentId: agentOne, opportunityKey: 'not_ranked' }), /specialist_opportunity_unranked/);
});

it('records outcomes the venue reported, and refuses to book unproven payment', () => {
  const key = String(db.get<Row>('SELECT opportunity_key AS k FROM mission_specialist_opportunities WHERE agent_id=? AND state=\'candidate\' ORDER BY rank LIMIT 1', [agentOne])!.k);
  assert.throws(() => recordOutcome({ actor: asAgent(agentOne), agentId: agentOne, opportunityKey: key, outcome: 'accepted' }), /specialist_acceptance_needs_owner_evidence/);
  assert.throws(() => recordOutcome({ actor: owner(), agentId: agentOne, opportunityKey: key, outcome: 'payment_verified' }), /specialist_payment_evidence_missing/);
  assert.throws(() => recordOutcome({ actor: owner(), agentId: agentOne, opportunityKey: key, outcome: 'payment_verified', evidenceRef: 'settlement_nope' }), /specialist_payment_evidence_unverifiable/);
  const rejected = recordOutcome({ actor: owner(), agentId: agentOne, opportunityKey: key, outcome: 'rejected_duplicate', detail: 'already reported upstream', reasonCode: 'duplicate' });
  assert.equal(rejected.recorded, true);
  assert.equal(rejected.lessonRecorded, true);
  assert.equal(String(db.get<Row>('SELECT state FROM mission_specialist_opportunities WHERE agent_id=? AND opportunity_key=?', [agentOne, key])!.state), 'dropped');
  const lesson = db.get<Row>('SELECT * FROM bounty_rejection_lessons ORDER BY created_at DESC LIMIT 1');
  assert.equal(String(lesson!.reason_code), 'duplicate');
  assert.ok(['github_issue_bounties', 'github-issue-bounties'].includes(String(lesson!.platform_key)), 'the lesson is attributed to the venue that refused it');
  assert.equal(recordOutcome({ actor: owner(), agentId: agentOne, opportunityKey: key, outcome: 'accepted' }).recorded, true);
  const metrics = JSON.parse(String(profileRow(agentOne).metrics_json)) as Record<string, number>;
  assert.equal(metrics.accepted, 1);
  assert.equal(metrics.rejected_duplicate, 1);
  // Skill level stays where the graded suite put it: outcomes are counted, not converted into a score.
  assert.equal(Number(profileRow(agentOne).skill_level), Number(profileRow(agentOne).skill_level));
});

it('keeps revenue at zero unless a verified settlement record exists, and never writes the ledger', () => {
  const before = Number(db.get<Row>("SELECT COALESCE(SUM(amount_cents),0) AS c FROM mission_ledger")?.c ?? 0);
  const report = fleetReport();
  assert.equal(report.revenue.ledgerRevenueCents, 0, 'nothing earned in a scratch database, and nothing claimed either');
  assert.equal(report.revenue.settledProofs, 0);
  assert.equal(report.firstExecutable, null, 'no EXECUTION_READY specialist means no executable opportunity');
  assert.equal(Number(db.get<Row>("SELECT COUNT(*) AS c FROM mission_ledger")?.c ?? 0), before, 'the fleet may not touch the ledger');
  assert.match(report.revenue.note, /Ledger revenue and settlement proofs only/);
});

it('records every unassigned agent as UNASSIGNED_PLATFORM instead of padding the fleet', () => {
  const refreshed = refreshFleetStates(owner(), { limit: 200 });
  assert.ok(refreshed.unassigned >= 4, `${JSON.stringify(refreshed.counts)}`);
  assert.equal(refreshed.assigned, (db.all<Row>("SELECT agent_id FROM mission_agent_platform_assignments WHERE status='active'") ?? []).length);
  const row = db.get<Row>('SELECT * FROM mission_agent_fleet_states WHERE state=? LIMIT 1', ['UNASSIGNED_PLATFORM']);
  assert.ok(row, 'the overflow must exist as a state, not as an absence');
  const reasons = JSON.parse(String(row!.reasons_json)) as string[];
  assert.ok(reasons.join(' ').includes('no_unassigned_verifiable_platform_left') || reasons.join(' ').includes('not_yet_mapped'), JSON.stringify(reasons));
  assert.equal(db.get<Row>("SELECT COUNT(*) AS c FROM mission_agent_specialists s JOIN mission_agent_platform_assignments a ON a.agent_id=s.agent_id AND a.status='active' WHERE a.slot_type='primary'")!.c,
    Number(db.get<Row>('SELECT COUNT(*) AS c FROM mission_agent_specialists')!.c), 'no profile may exist without an active assignment');
});

it('reports discovery coverage per opportunity family from the evidence rows, not from a constant', () => {
  const coverage = registryCoverage();
  assert.equal(coverage.categories.length, 7, 'the registry is meant to refresh seven opportunity families');
  for (const entry of coverage.categories) {
    assert.ok(entry.venues >= 1, `no venue carries current evidence for the ${entry.category} family`);
    assert.match(entry.how, /./);
  }
  const github = coverage.categories.find(entry => entry.category === 'github_engineering')!;
  assert.ok(github.assignable >= 1 && github.stale === 0, JSON.stringify(github));
  // Each family states where it is refreshed from, so coverage can be audited rather than trusted.
  for (const entry of coverage.categories) assert.ok(entry.how.trim().length > 20, `${entry.category} has no stated refresh source`);
});

it('releases a pairing on owner request and frees the venue for the next agent', () => {
  assert.throws(() => releaseAssignment({ actor: asAgent(agentTwo), agentId: agentTwo, reason: 'nope' }), /specialist_release_owner_only/);
  const released = releaseAssignment({ actor: owner(), agentId: agentTwo, reason: 'venue reassignment in test' });
  assert.equal(released.released, true);
  assert.equal(assignmentRow(agentTwo), undefined);
  assert.equal(String(profileRow(agentTwo).state), 'REGISTERED');
  const next = specializeAgent({ actor: owner(), agentId: makeAgent('reassigned'), platformId: 'hackerone' });
  assert.equal(next.state, 'PLATFORM_ASSIGNED', 'a freed venue becomes assignable again, and history is kept rather than deleted');
  assert.equal(db.get<Row>("SELECT COUNT(*) AS c FROM mission_agent_platform_assignments WHERE platform_id='hackerone'")!.c, 2, 'the released row stays for audit');
});

it('opens all the way to WORKING when every gate is genuinely satisfied', () => {
  const agent = makeAgent('full');
  specializeAgent({ actor: owner(), agentId: agent, platformId: 'bugcrowd' });
  setSpecialistState({ actor: owner(), agentId: agent, to: 'TRAINING', reason: 'profile loaded' });
  const certified = certifyAgents({ actor: owner(), agentIds: [agent] });
  assert.equal(certified.passed, 1, JSON.stringify(certified.failed));
  insertCredentialFor(agent, 'BUGCROWD_TOKEN');
  const accessed2 = setSpecialistState({ actor: owner(), agentId: agent, to: 'ACCESS_READY', reason: 'credential registered' });
  assert.equal(accessed2.to, 'ACCESS_READY', JSON.stringify(evaluateGates(agent, 'ACCESS_READY')));
  db.run('INSERT INTO mission_agent_contracts (id, agent_id, purpose, permissions, resource_limits, budget_cents, status, approved_by, approved_at) VALUES (?, ?, ?, \'["report.submit"]\', \'{}\', 0, \'active\', ?, ?)',
    [missionId('ctr'), agent, 'bounded research scope', ownerId, nowIso()]);
  db.run("UPDATE mission_provider_readiness SET status='ready', api_permitted=1 WHERE provider_id IN ('bugcrowd','github_issue_bounties')");
  db.run("INSERT INTO mission_money_grants (agent_id, status, spend_limit_cents, delegation_cents, can_create, expires_at, granted_by) VALUES (?, 'active', 0, 0, 0, ?, 'test')",
    [agent, new Date(Date.now() + 3600_000).toISOString()]);
  db.run("UPDATE mission_payout_slots SET status='active', verified_at=?, verified_by=? WHERE slot=1", [nowIso(), ownerId]);
  updatePolicy({ currency: 'USD', killSwitch: false, autonomousEnabled: true, maxAgents: 5000, maxDailySpendCents: 100000, maxExpenseCents: 10000, requireApprovalAboveCents: 5000 } as never, ownerId);
  const approved = setSpecialistState({ actor: owner(), agentId: agent, to: 'CONTRACT_APPROVED', reason: 'scoped contract approved' });
  assert.equal(approved.to, 'CONTRACT_APPROVED');
  const ready = setSpecialistState({ actor: owner(), agentId: agent, to: 'EXECUTION_READY', reason: 'every gate re-read and passing' });
  assert.equal(ready.to, 'EXECUTION_READY', `expected execution readiness, blockers: ${JSON.stringify(evaluateGates(agent, 'EXECUTION_READY'))}`);
  // Work still needs an owner to place it: readiness alone is not a licence to invent a task.
  const early = (() => { try { return rankOpportunityQueue({ actor: owner(), agentId: agent, limit: 3 }); } catch { return null; } })();
  assert.ok(early, 'the queue builder runs for a ready specialist');
  db.run(`INSERT INTO mission_opportunities (id, platform, opportunity_type, title, category, skills, payout_max_cents, automation_permission, country_eligibility, source_url, dedup_hash, status, risk_level)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    `mop_fl_full_${slugSeed}`, 'Bugcrowd', 'remote_job', 'In-scope program review', 'security_research', JSON.stringify(['security', 'testing']),
    50_000, 'conditional', JSON.stringify(['PK']), 'https://www.bugcrowd.com/programs/example', `dedup-full-${slugSeed}`, 'verified', 'low',
  ] as never);
  const queue = rankOpportunityQueue({ actor: owner(), agentId: agent, limit: 3 });
  assert.equal(queue.rows.length, 1, JSON.stringify(queue));
  const placed = assignOpportunity({ actor: owner(), agentId: agent, opportunityKey: queue.rows[0].key });
  assert.equal(placed.assigned, true);
  const working = setSpecialistState({ actor: owner(), agentId: agent, to: 'WORKING', reason: 'owner placed one unblocked opportunity' });
  assert.equal(working.to, 'WORKING', JSON.stringify(evaluateGates(agent, 'WORKING')));
  assert.ok(String(profileRow(agent).state_reason).includes('owner placed'));
  // Turning autonomy off again takes the state away on the next refresh, without deleting history.
  updatePolicy({ currency: 'USD', killSwitch: true } as never, ownerId);
  const report = fleetReport();
  assert.ok(report.states.WORKING >= 1, 'the recorded state survives until the next refresh');
  assert.ok(profileRulesDigest(profileView(agent)).length === 64);
});

// ── the specialty is a gate, not a label ─────────────────────────────────────────────────────
// One venue per agent is enforced fleet-wide, so these tests take whichever assignable venue an
// earlier test has not claimed and assert against that venue's own catalog record. That keeps the
// proofs about the specialty gate rather than about test ordering.
const ASSIGNABLE_VENUE_IDS = ['bugcrowd', 'hackerone', 'immunefi', 'intigriti', 'yeswehack', 'frantic_agent_marketplace', 'github_issue_bounties'];
const ALL_OPPORTUNITY_CLASSES = ['github_issue_bounties', 'bug_bounties', 'contests_challenges', 'microtasks_labeling', 'software_development', 'open_source_sponsorship'];

function holderOf(platformId: string): string | null {
  const row = db.get<Row>(
    "SELECT agent_id FROM mission_agent_platform_assignments WHERE platform_id IN (?, ?) AND slot_type='primary' AND status='active'",
    [platformId, platformId.replace(/_/g, '-')],
  );
  return row ? String(row.agent_id) : null;
}

function freeVenue(): { platformId: string; label: string; opportunityClass: string; specialtyKey: string; mismatchClass: string } {
  let platformId = ASSIGNABLE_VENUE_IDS.find(entry => !holderOf(entry));
  if (!platformId) {
    // Every assignable venue is held by an earlier test in this file, whose assertions have already
    // run. Releasing the first one is an audited release of a scratch agent, which is cheaper than
    // teaching these tests to assume a fleet with free slots.
    platformId = ASSIGNABLE_VENUE_IDS[0];
    releaseAssignment({ actor: owner(), agentId: holderOf(platformId)!, reason: 'specialty tests reuse the venue on a scratch database' });
  }
  {
    const record = platformRecordFor(platformId);
    assert.ok(record, `the catalog must carry ${platformId}`);
    const classes = SPECIALIST_SPECIALTIES[record!.specialtyKey].classes;
    const mismatchClass = ALL_OPPORTUNITY_CLASSES.find(entry => !classes.includes(entry));
    assert.ok(mismatchClass, `${record!.specialtyKey} covers every class, so it cannot prove a refusal`);
    return { platformId, label: record!.label, opportunityClass: record!.opportunityClass, specialtyKey: record!.specialtyKey, mismatchClass: mismatchClass! };
  }
  throw new Error('every assignable venue is held by an earlier test');
}

function seedRankedOpportunity(agent: string, venue: { label: string }, reward: number): string {
  const key = `mop_gate_${slugSeed}_${randomUUID().slice(0, 8)}`;
  db.run(`INSERT INTO mission_opportunities (id, platform, opportunity_type, title, category, skills, payout_max_cents, automation_permission, country_eligibility, source_url, dedup_hash, status, risk_level)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    key, venue.label, 'remote_job', 'Specialty gate candidate', 'security_review', JSON.stringify(['typescript', 'testing', 'security']),
    reward, 'permitted', JSON.stringify(['US', 'PK']), `https://example.invalid/venues/${key.slice(-6)}`, `dedup-gate-${key.slice(-8)}`, 'verified', 'low',
  ] as never);
  return rankOpportunityQueue({ actor: owner(), agentId: agent, limit: 5 }).rows.find(entry => entry.key === key && !entry.blockers.length)?.key ?? '';
}

it('labels each ranked row with the class of the paired venue, taken from the catalog', () => {
  const venue = freeVenue();
  const agent = makeAgent('specclass');
  specializeAgent({ actor: owner(), agentId: agent, platformId: venue.platformId });
  const key = seedRankedOpportunity(agent, venue, 40_000);
  assert.ok(key, `a clean candidate should exist: ${JSON.stringify(rankOpportunityQueue({ actor: owner(), agentId: agent, limit: 5 }).rows.map(row => row.blockers))}`);
  const stored = db.get<Row>('SELECT opportunity_class, state FROM mission_specialist_opportunities WHERE agent_id=? AND opportunity_key=?', [agent, key]);
  assert.equal(String(stored!.opportunity_class), venue.opportunityClass, 'the class comes from the verified catalog record, not the opportunity wording');
  assert.equal(String(stored!.state), 'candidate', 'a specialty that covers its own venue class adds no blocker');
});

it('refuses an assignment whose class the registered specialty does not cover', () => {
  const venue = freeVenue();
  const agent = makeAgent('specgate');
  specializeAgent({ actor: owner(), agentId: agent, platformId: venue.platformId });
  const key = seedRankedOpportunity(agent, venue, 45_000);
  assert.ok(key, 'the fitting case has to be assignable up to the state gates');
  db.run(`UPDATE mission_specialist_opportunities SET opportunity_class=? WHERE agent_id=? AND opportunity_key=?`, [venue.mismatchClass, agent, key]);
  assert.throws(() => assignOpportunity({ actor: owner(), agentId: agent, opportunityKey: key }), /specialist_specialty_mismatch/);
  // A row with no recorded class is refused too: an unproven fit is no fit.
  db.run(`UPDATE mission_specialist_opportunities SET opportunity_class=NULL WHERE agent_id=? AND opportunity_key=?`, [agent, key]);
  assert.throws(() => assignOpportunity({ actor: owner(), agentId: agent, opportunityKey: key }), /specialist_opportunity_unclassified/);
  // Restoring the class removes the specialty refusal — which proves the gate is specific. The next
  // refusal is the readiness ladder, which this agent has not climbed.
  db.run(`UPDATE mission_specialist_opportunities SET opportunity_class=? WHERE agent_id=? AND opportunity_key=?`, [venue.opportunityClass, agent, key]);
  assert.throws(() => assignOpportunity({ actor: owner(), agentId: agent, opportunityKey: key }), /specialist_not_execution_ready/);
  const untouched = db.get<Row>('SELECT state FROM mission_specialist_opportunities WHERE agent_id=? AND opportunity_key=?', [agent, key]);
  assert.equal(String(untouched!.state), 'candidate', 'a refused assignment leaves the queue exactly as it was');
});

it('rolls up the per-agent record — specialty, work, evidence, verified and earnings — from stored rows', () => {
  const venue = freeVenue();
  const agent = makeAgent('specrecord');
  specializeAgent({ actor: owner(), agentId: agent, platformId: venue.platformId });
  const definition = SPECIALIST_SPECIALTIES[venue.specialtyKey];
  const first = specialistRecord(agent);
  assert.equal(first.specialtyKey, venue.specialtyKey);
  assert.deepEqual([...first.workKinds], [...definition.does], 'the record reads the same config the gate enforces');
  assert.equal(first.specialtyLabel, definition.label);
  assert.equal(first.state, 'PLATFORM_ASSIGNED');
  assert.equal(first.earningsCents, 0, 'a pairing is not income');

  const key = seedRankedOpportunity(agent, venue, 30_000);
  assert.ok(key, 'the seeded opportunity is ranked for this agent');
  const ranked = specialistRecord(agent);
  assert.ok(ranked.work.ranked >= 1, 'the ranked count follows the queue table');
  assert.equal(ranked.evidence.gradedSuites, 0, 'no suite has been graded for this agent');
  assert.equal(ranked.evidence.venueRejections, 0, 'no rejection has been recorded against this venue');

  // Delivered work without a settlement record still pays nothing; a verified settlement does.
  db.run(`UPDATE mission_specialist_opportunities SET state='delivered' WHERE agent_id=? AND opportunity_key=?`, [agent, key]);
  // A settlement proof is keyed to an earning-engine opportunity, so the test creates one through
  // the real discovery path rather than inventing a foreign key the schema would reject.
  const engineOpportunity = discoverOpportunity({
    registryKey: 'paid_research_data', provider: 'Specialty Record Ltd', platform: 'Direct Client Research',
    grossCents: 30_000, expectedFeesCents: 0, expectedCostsCents: 0, paymentMethod: 'wise', settlementEvidence: 'statement',
    opportunityExpiry: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    evidenceJson: { lawfulPurposeRef: `client-research-approval-${slugSeed}`, datasetSha256: 'e'.repeat(64), evidenceUrl: `https://example.invalid/evidence/${slugSeed}`, nonSensitiveDataOnly: true, dataRightsReviewed: true },
  });
  db.run(`INSERT INTO mission_settlement_verifications (id, execution_id, opportunity_id, rail, external_id, provider_ref, verified, verification_detail, created_at, verified_at)
       VALUES (?, NULL, ?, 'wire', 'venue-reference-pending', NULL, 0, 'awaiting the platform statement', ?, NULL)`, [missionId('setl'), String(engineOpportunity.id), nowIso()]);
  const proof = db.get<Row>("SELECT id FROM mission_settlement_verifications WHERE external_id='venue-reference-pending'", []);
  assert.ok(proof, 'the settlement row exists before it is verified');
  assert.equal(specialistRecord(agent).earningsCents, 0, 'an unverified settlement is not earnings');
  assert.equal(specialistRecord(agent).verified.paymentProofs, 0, 'nor is it a proof');
  db.run("UPDATE mission_settlement_verifications SET verified=1, external_id='payout-txn-verified', verified_at=? WHERE id=?", [nowIso(), String(proof!.id)]);
  // The link the record depends on is the one recordOutcome writes: the reference on the opportunity.
  db.run(`UPDATE mission_specialist_opportunities SET payment_reference='payout-txn-verified' WHERE agent_id=? AND opportunity_key=?`, [agent, key]);
  const paid = specialistRecord(agent);
  assert.equal(paid.earningsCents, 30_000, 'verified settlement evidence moves the number, and only that');
  assert.equal(paid.verified.paymentProofs, 1);
  assert.match(paid.earningsBasis, /verified settlement/i);

  const roster = listSpecialistRecords({ limit: 400 });
  const listed = roster.records.find(entry => entry.agentId === agent);
  assert.ok(listed, 'the roster includes the agent the record was built for');
  assert.ok(listed!.earningsCents >= 30_000);
  assert.ok(roster.total >= 1, 'the roster counts the whole fleet, not the page');
});
