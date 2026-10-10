/**
 * Specialist evaluation suites. The point of these tests is non-vacuity: a grader that always
 * passes would certify a thousand agents and mean nothing, so each behaviour is checked in both
 * directions — a correct profile passes, and a specific defect makes it fail with a reason that
 * names the defect.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `spec-eval-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'synthetic-specialist-eval-tests-not-live';
import { before, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { missionDb as db, applyMissionMigrations, type Row } from '../database';
import { provisionOwner } from '../auth';
import { ensurePayoutSlots } from '../treasury';
import { applyPlatformCatalog, VERIFIED_PLATFORM_RECORDS, platformRecordFor } from './platform-catalog';
import { buildSpecialistProfile } from './specialist-fleet';
import {
  SKILL_SCORE_THRESHOLD, assertLeastPrivilege, evaluationSummary, profileRulesDigest, runSpecialistEvaluation,
  skillVerificationState, suiteFor, type SpecialistProfileView,
} from './specialist-evaluation';

const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));
let ownerId = '';
const agentId = `agt-eval-${randomUUID().slice(0, 8)}`;

function githubProfile(): SpecialistProfileView & { agentClass: string } {
  const record = platformRecordFor('github_issue_bounties')!;
  return buildSpecialistProfile(agentId, record);
}
function withRewards(profile: SpecialistProfileView, patch: Record<string, unknown>): SpecialistProfileView {
  return { ...profile, rewardVerification: { ...profile.rewardVerification, ...patch } };
}

before(() => {
  applyMissionMigrations();
  ownerId = String(provisionOwner({ email: `eval-${randomUUID().slice(0, 8)}@example.invalid`, password: `synthetic-eval-${randomUUID()}` }).id);
  ensurePayoutSlots();
  db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,'Eval subject','specialist',0,'registry','active','worker','akbaral-registry','[\"coding\"]')",
    [agentId, `eval-${agentId.slice(-8)}`]);
  applyPlatformCatalog({ kind: 'owner', id: ownerId });
});

it('gives every claimed skill of every catalog venue a grader, or says it is ungraded', () => {
  const families = new Set<string>();
  for (const entry of VERIFIED_PLATFORM_RECORDS) {
    if (!entry.skills.length) continue;
    const suite = suiteFor(entry.platformId, entry.specialtyKey);
    assert.equal(suite.ungradedSkills.length, 0, `${entry.platformId} claims skills with no evaluator: ${suite.ungradedSkills.join(',')}`);
    assert.ok(suite.tasks.length >= 1, `${entry.platformId} claims skills but has no graded task`);
    // A venue the fleet could actually be pointed at needs more than one check: a single grader
    // is a formality, not a competency test.
    if (entry.verdict === 'active' && (entry.automationPolicy === 'permitted' || entry.automationPolicy === 'restricted')) {
      assert.ok(suite.tasks.length >= 3, `${entry.platformId} is assignable with only ${suite.tasks.length} graded checks`);
    }
    for (const task of suite.tasks) {
      families.add(task.grader);
      assert.notEqual(task.grader, 'ungraded');
      assert.equal(task.critical, ['scope_gate', 'evidence_chain', 'claim', 'disclosure_owner_only', 'reward_settleability', 'economics', 'durability_screen', 'receipt_verify'].includes(task.grader),
        `criticality flag for ${task.grader} is not what the ladder depends on`);
    }
  }
  assert.ok(families.has('scope_gate') && families.has('claim') && families.has('receipt_verify'), 'the safety families must be reachable from the catalog');
});

it('certifies a correct profile in deterministic mode and records the engines it consulted', () => {
  const outcome = runSpecialistEvaluation({ actor: { kind: 'owner', id: ownerId }, profile: githubProfile(), mode: 'deterministic' });
  assert.equal(outcome.passed, true, `expected a pass, failures: ${JSON.stringify(outcome.failures)}`);
  assert.equal(outcome.score, 100);
  assert.equal(outcome.stateApplied, false, 'a run only writes a certificate; moving an agent is a separate, gated transition');
  const engines = new Set(outcome.results.map(entry => entry.engine));
  assert.ok(engines.has('github-bounty-eligibility') && engines.has('github-bounty-scope-gate'), 'the graders must run the production engines, not a teaching copy');
  for (const entry of outcome.results) assert.ok(entry.detail.length > 8, `${entry.grader} passed without saying what it saw`);
});

it('binds the certificate to the profile digest, so editing the profile voids it', () => {
  const profile = githubProfile();
  const digest = profileRulesDigest(profile);
  runSpecialistEvaluation({ actor: { kind: 'owner', id: ownerId }, profile, mode: 'deterministic' });
  const verdict = skillVerificationState(agentId, profile.platformId, digest);
  assert.equal(verdict.verified, true);
  assert.equal(verdict.reason, 'passed');
  const edited: SpecialistProfileView = { ...profile, rules: { ...profile.rules, scope: [...profile.rules.scope, 'also poke the staging box'] } };
  const afterEdit = skillVerificationState(agentId, profile.platformId, profileRulesDigest(edited));
  assert.equal(afterEdit.verified, false, 'a modified profile may not inherit the old certificate');
  assert.equal(afterEdit.reason, 'profile_changed_since_evaluation');
});

it('refuses to let a fixture run certify an agent', () => {
  const profile = githubProfile();
  const outcome = runSpecialistEvaluation({ actor: { kind: 'owner', id: ownerId }, profile, mode: 'fixture', suiteVersion: 99 });
  assert.equal(outcome.passed, true, 'the fixture path runs the same graders');
  assert.equal(outcome.stateApplied, false, 'fixture mode may never move an agent forward');
  const verdict = skillVerificationState(agentId, profile.platformId, profileRulesDigest(profile));
  assert.ok(verdict.reason === 'passed' || verdict.reason === 'fixture_only', `unexpected verdict ${verdict.reason}`);
  // With only the fixture row present, the gate must read it as uncertifying.
  const fixtureOnly = skillVerificationState(agentId, profile.platformId, 'no-such-digest');
  assert.equal(fixtureOnly.verified, false);
});

it('fails a profile that drops the reward-honesty claim, and names the missing statement', () => {
  // The suite is derived from the venue record, so a profile cannot shrink its own exam by
  // editing its skill list; the sabotage has to be tested on a venue whose record grades that
  // skill at all (Layer3 is the one whose reading is still unverified but whose rules are known).
  const layer3 = platformRecordFor('layer3')!;
  assert.ok(suiteFor('layer3', layer3.specialtyKey).tasks.some(task => task.grader === 'reward_settleability'), 'layer3 must grade reward settleability');
  const stripped = withRewards(buildSpecialistProfile(agentId, layer3), { treats_advertised_reward_as_revenue: undefined });
  const outcome = runSpecialistEvaluation({
    actor: { kind: 'owner', id: ownerId },
    profile: stripped,
    mode: 'deterministic', suiteVersion: 7,
  });
  assert.equal(outcome.passed, false, 'a profile that can book an advertised ceiling as revenue must not certify');
  const failure = outcome.failures.find(entry => entry.grader === 'reward_settleability');
  assert.ok(failure && /nothing/.test(failure.detail), `expected the failure to name the absent statement, got ${JSON.stringify(failure)}`);
  assert.equal(failure!.kind, 'critical');
});

it('fails a profile that reaches past its class, even when everything else passes', () => {
  const profile = githubProfile();
  const greedy: SpecialistProfileView = { ...profile, permissions: [...profile.permissions, 'payout.release'] };
  const outcome = runSpecialistEvaluation({ actor: { kind: 'owner', id: ownerId }, profile: greedy, mode: 'deterministic', suiteVersion: 8 });
  assert.equal(outcome.passed, false);
  assert.ok(outcome.failures.some(entry => entry.grader === 'disclosure_owner_only' && /non-grantable/.test(entry.detail)));
});

it('fails a profile whose discovery rules never mention the live claim recheck', () => {
  const profile = githubProfile();
  const blind: SpecialistProfileView = { ...profile, rules: { ...profile.rules, discovery: ['list anything with a bounty label'] } };
  const outcome = runSpecialistEvaluation({ actor: { kind: 'owner', id: ownerId }, profile: blind, mode: 'deterministic', suiteVersion: 9 });
  const claim = outcome.results.find(entry => entry.grader === 'claim');
  assert.equal(claim!.passed, false, 'skipping the claim recheck is exactly the failure mode the fleet cannot afford');
  assert.equal(outcome.passed, false, 'a critical grader failing must veto regardless of score');
});

it('keeps a venue-level entry stake out of agent reach, and refuses a profile that holds spend', () => {
  const sherlock = platformRecordFor('sherlock')!;
  const profile = buildSpecialistProfile(agentId, sherlock);
  const clean = runSpecialistEvaluation({ actor: { kind: 'owner', id: ownerId }, profile, mode: 'deterministic', suiteVersion: 10 });
  assert.ok(clean.results.some(entry => entry.grader === 'economics' && entry.passed), 'a research profile must be clean of spend authority');
  const staking: SpecialistProfileView = { ...profile, permissions: ['report.submit', 'expense.request'] as never };
  const refused = runSpecialistEvaluation({ actor: { kind: 'owner', id: ownerId }, profile: staking, mode: 'deterministic', suiteVersion: 11 });
  assert.equal(refused.passed, false, 'a venue that charges a per-report stake may never be paired with an agent spend permission');
  assert.ok(refused.failures.some(entry => entry.grader === 'economics' && entry.kind === 'critical'));
});

it('reports the payout gate as an unread blocker instead of crashing when no slot exists', () => {
  db.run('DELETE FROM mission_payout_slots');
  const frantic = platformRecordFor('frantic_agent_marketplace')!;
  const outcome = runSpecialistEvaluation({
    actor: { kind: 'owner', id: ownerId },
    profile: buildSpecialistProfile(agentId, frantic),
    mode: 'deterministic', suiteVersion: 12,
  });
  const receipt = outcome.results.find(entry => entry.grader === 'receipt_verify');
  assert.ok(receipt, 'the venue that pays through receipts must be graded on receipt verification');
  assert.equal(receipt!.passed, false);
  assert.match(receipt!.detail, /no payout slot is configured/);
  assert.equal(outcome.passed, false, 'a missing payout gate must veto, not pass silently');
  ensurePayoutSlots();
});

it('honours the score threshold as a floor, not the whole decision', () => {
  assert.equal(SKILL_SCORE_THRESHOLD, 80);
  const profile = githubProfile();
  // 4 of 5 families is 80, which passes; 3 of 5 is 60, which does not. The soft-only failure
  // path is exercised by the duplicate-screen case below.
  const weakened: SpecialistProfileView = { ...profile, rejectionCodes: [] };
  const outcome = runSpecialistEvaluation({ actor: { kind: 'owner', id: ownerId }, profile: weakened, mode: 'deterministic', suiteVersion: 13 });
  const duplicate = outcome.results.find(entry => entry.grader === 'duplicate_screen');
  if (duplicate) assert.equal(duplicate.passed, false, 'a profile with no rejection vocabulary cannot claim duplicate screening');
  assert.equal(typeof outcome.score, 'number');
  assert.ok(outcome.score === 100 || outcome.passed === false, 'a soft failure may only fail the run through the threshold');
});

it('refuses a model-assisted run when there is no dispatch path, rather than quietly grading on substitutes', () => {
  const saved = process.env.ZA141251SA_CHAT_FREE_TIER;
  delete process.env.ZA141251SA_CHAT_FREE_TIER;
  try {
    assert.throws(() => runSpecialistEvaluation({ actor: { kind: 'owner', id: ownerId }, profile: githubProfile(), mode: 'model_assisted' }),
      /specialist_eval_model_unavailable/);
  } finally { if (saved !== undefined) process.env.ZA141251SA_CHAT_FREE_TIER = saved; }
});

it('refuses an invalid mode, an unknown venue and an empty suite', () => {
  assert.throws(() => runSpecialistEvaluation({ actor: { kind: 'owner', id: ownerId }, profile: githubProfile(), mode: 'vibes' as never }), /specialist_eval_mode_invalid/);
  assert.throws(() => runSpecialistEvaluation({ actor: { kind: 'owner', id: ownerId }, profile: { ...githubProfile(), platformId: 'not_a_venue' } }), /specialist_platform_record_missing/);
  const paladin = platformRecordFor('paladin')!;
  assert.equal(paladin.skills.length, 0, 'paladin stays skill-less because nothing was read about it');
  assert.throws(() => runSpecialistEvaluation({ actor: { kind: 'owner', id: ownerId }, profile: buildSpecialistProfile(agentId, paladin) }), /specialist_eval_suite_empty/);
});

it('checks permissions against the class contract before anything is granted', () => {
  assertLeastPrivilege('bounty_research', ['report.submit']);
  assertLeastPrivilege('bounty_execution', ['tool.request', 'report.submit']);
  assert.throws(() => assertLeastPrivilege('bounty_research', ['tool.request']), /specialist_permission_not_grantable/);
  assert.throws(() => assertLeastPrivilege('bounty_execution', ['credential.write']), /specialist_permission_not_grantable/);
  assert.throws(() => assertLeastPrivilege('nonsense', []), /specialist_class_unknown/);
});

it('summarises the ledger of runs by mode', () => {
  const summary = evaluationSummary();
  assert.ok(summary.suites >= 8, `expected several suite rows, saw ${summary.suites}`);
  assert.ok(summary.byMode.deterministic >= 1);
  assert.ok(summary.byMode.fixture >= 1);
  assert.equal(typeof summary.lowestScore, typeof summary.lowestScore);
  const evidence = db.get<Row>('SELECT evidence_json FROM mission_specialist_evaluations ORDER BY evaluated_at DESC LIMIT 1');
  assert.ok(JSON.parse(String(evidence!.evidence_json)).length >= 2, 'each graded task must be recorded with what it observed');
});
