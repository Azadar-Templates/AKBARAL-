import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `resultverif-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'synthetic-result-verification-tests-not-live';
import { before, beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { missionDb as db, applyMissionMigrations, sha256, verifyMissionAudit } from '../database';
import { provisionOwner } from '../auth';
import { updatePolicy, setKillSwitch } from '../policy';
import * as Engine from './earning-engine';
import * as Verification from './result-verification';

const keepAlive = setInterval(() => {}, 1000);
let ownerId: string;
let producer = '';
let verifierB = '';
let verifierC = '';

type Row = Record<string, unknown>;

/** Real-registry-origin agents: a verdict taken by a 'fixture' agent is a test fact,
 *  and these tests need to prove the production path works. */
function makeAgent(slug: string, origin: string): string {
  const id = `agt-${slug}-${randomUUID().slice(0, 8)}`;
  db.run(
    "INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,?,0,'custom','active','worker',?,?)",
    [id, slug, `Agent ${slug}`, 'specialist', origin, JSON.stringify(['software_development'])],
  );
  return id;
}

function digest(seed: string): string { return sha256(seed); }

function executingOpportunity(agentId: string): Row {
  const opp = Engine.discoverOpportunity({
    registryKey: 'software_development', provider: 'Acme OSS Program', platform: 'GitHub',
    grossCents: 40000, expectedFeesCents: 0, expectedCostsCents: 0,
    paymentMethod: 'bounty: GitHub → mission payout slot 1',
    settlementEvidence: 'awaiting maintainer merge + payout confirm',
    opportunityExpiry: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    evidenceJson: { brief: 'fix flaky integration test', issueUrl: 'https://github.com/acme/widgets/issues/42' },
  }) as Row;
  Engine.lockOpportunityExclusive(String(opp.id), agentId);
  Engine.scheduleWork(String(opp.id), agentId);
  return Engine.getEngineOpportunity(String(opp.id))!;
}

before(() => {
  applyMissionMigrations();
  const owner = provisionOwner({ email: 'rv-owner@example.test', password: 'StrongPass!123', displayName: 'RV Owner' }) as { id?: string; owner?: { id: string } };
  ownerId = String(owner.id ?? owner.owner?.id ?? 'rv-owner');
  producer = makeAgent('rv-producer', 'akbaral-registry');
  verifierB = makeAgent('rv-verifier-b', 'akbaral-registry');
  verifierC = makeAgent('rv-verifier-c', 'akbaral-registry');
  updatePolicy({
    currency: 'USD', killSwitch: false, autonomousEnabled: true, maxDailySpendCents: 100000,
    maxExpenseCents: 10000, requireApprovalAboveCents: 5000,
  } as never, ownerId);
});

beforeEach(() => {
  setKillSwitch(false, ownerId);
  for (const table of ['mission_result_verifications', 'mission_execution_evidence', 'mission_earning_engine_opportunities', 'mission_agent_earnings_ledger', 'mission_opportunity_roi', 'mission_earning_scores', 'mission_audit']) {
    try { db.run(`DELETE FROM ${table}`); } catch { /* table may not exist yet on a fresh engine */ }
  }
  updatePolicy({ autonomousEnabled: true, allowAgentCreation: true, maxAgents: 5000 } as never, ownerId);
});

after(() => { try { db.close(); } finally { clearInterval(keepAlive); } });

it('refuses evidence whose digest is not real content', () => {
  const opp = executingOpportunity(producer);
  assert.throws(() => Verification.recordExecutionEvidence({
    opportunityId: String(opp.id), agentId: producer, kind: 'artifact', ref: 'patches/flaky-test.diff', digest: 'not-a-digest',
  }), /digest_must_be_sha256_hex/);
  assert.throws(() => Verification.recordExecutionEvidence({
    opportunityId: String(opp.id), agentId: producer, kind: 'artifact', ref: 'patches/flaky-test.diff', digest: '0'.repeat(64),
  }), /digest_is_a_placeholder/);
  assert.throws(() => Verification.recordExecutionEvidence({
    opportunityId: String(opp.id), agentId: producer, kind: 'artifact', ref: 'patches/flaky-test.diff', digest: sha256(''),
  }), /digest_is_a_placeholder/);
  assert.equal(Verification.listEvidence(String(opp.id)).length, 0);
});

it('a github_pr reference must be a followable URL, and the kind must be known', () => {
  const opp = executingOpportunity(producer);
  assert.throws(() => Verification.recordExecutionEvidence({
    opportunityId: String(opp.id), agentId: producer, kind: 'github_pr', ref: 'asked alice on slack', digest: digest('pr-1'),
  }), /evidence_ref_shape_github_pr/);
  assert.throws(() => Verification.recordExecutionEvidence({
    opportunityId: String(opp.id), agentId: producer, kind: 'carrier_pigeon' as never, ref: 'pigeon-9', digest: digest('pr-1'),
  }), /unknown_evidence_kind/);
});

it('only the assigned producer can record output onto an assignment (cross-agent isolation)', () => {
  const opp = executingOpportunity(producer);
  assert.throws(() => Verification.recordExecutionEvidence({
    opportunityId: String(opp.id), agentId: verifierB, kind: 'artifact', ref: 'someone-else.patch', digest: digest('foreign'),
  }), /producer_not_assigned_agent/);
  assert.equal(Verification.listEvidence(String(opp.id)).length, 0);
});

it('records evidence once and idempotently, and refuses it outside a live assignment', () => {
  const opp = executingOpportunity(producer);
  const first = Verification.recordExecutionEvidence({
    opportunityId: String(opp.id), agentId: producer, kind: 'github_pr',
    ref: 'https://github.com/acme/widgets/pull/43', digest: digest('pr-43'), sizeBytes: 4096,
  });
  const again = Verification.recordExecutionEvidence({
    opportunityId: String(opp.id), agentId: producer, kind: 'github_pr',
    ref: 'https://github.com/acme/widgets/pull/43', digest: digest('pr-43'), sizeBytes: 4096,
  });
  assert.equal(String(first.id), String(again.id));
  assert.equal(Verification.listEvidence(String(opp.id)).length, 1);
  const closed = executingOpportunity(producer);
  db.run("UPDATE mission_earning_engine_opportunities SET verification_state='verified' WHERE id=?", [String(closed.id)]);
  assert.throws(() => Verification.recordExecutionEvidence({
    opportunityId: String(closed.id), agentId: producer, kind: 'artifact', ref: 'late.patch', digest: digest('late'),
  }), /state_not_writable:verified/);
});

it('a producing agent cannot verify its own work', () => {
  const opp = executingOpportunity(producer);
  Verification.recordExecutionEvidence({
    opportunityId: String(opp.id), agentId: producer, kind: 'artifact', ref: 'fix.diff', digest: digest('self-attest'),
  });
  const verdict = Verification.verifyResult(String(opp.id), producer);
  assert.equal(verdict.verified, false);
  assert.ok(verdict.issues.includes('verifier_independent'));
  assert.equal(Engine.getEngineOpportunity(String(opp.id))!.verification_state, 'executing');
});

it('one independent verifier is not enough; two that saw the same bytes are', () => {
  const opp = executingOpportunity(producer);
  const evidence = Verification.recordExecutionEvidence({
    opportunityId: String(opp.id), agentId: producer, kind: 'github_pr',
    ref: 'https://github.com/acme/widgets/pull/51', digest: digest('pr-51'),
  });
  assert.ok(String(evidence.digest));
  const b = Verification.verifyResult(String(opp.id), verifierB);
  assert.equal(b.verified, true);
  assert.equal(b.confidence, 1);
  assert.equal(b.mode, 'production');
  let commit = Verification.commitVerification(String(opp.id));
  assert.equal(commit.verified, false);
  assert.match(commit.reason, /two_independent_verifications_required/);
  assert.equal(Engine.getEngineOpportunity(String(opp.id))!.verification_state, 'executing');

  const c = Verification.verifyResult(String(opp.id), verifierC);
  assert.equal(c.verified, true);
  assert.equal(c.evidenceDigest, b.evidenceDigest);
  commit = Verification.commitVerification(String(opp.id));
  assert.equal(commit.verified, true);
  assert.equal(commit.independentVerifiers, 2);
  assert.equal(Engine.getEngineOpportunity(String(opp.id))!.verification_state, 'verified');
  const status = Verification.verificationStatus(String(opp.id));
  assert.equal(status.independentPasses, 2);
  assert.equal(status.committed, true);
});

it('verifier re-approval of the same bytes is idempotent and never adds a second voice', () => {
  const opp = executingOpportunity(producer);
  Verification.recordExecutionEvidence({ opportunityId: String(opp.id), agentId: producer, kind: 'artifact', ref: 'patch.diff', digest: digest('dup') });
  const first = Verification.verifyResult(String(opp.id), verifierB);
  const second = Verification.verifyResult(String(opp.id), verifierB);
  assert.equal(first.verified, true);
  assert.equal(first.replayed, false);
  assert.equal(second.verified, true);
  assert.equal(second.replayed, true);
  assert.equal(Verification.verificationStatus(String(opp.id)).verifications.length, 1);
  assert.equal(Verification.commitVerification(String(opp.id)).verified, false);
});

it('evidence that predates the assignment, or that is not the producer’s, is refused', () => {
  const opp = executingOpportunity(producer);
  Verification.recordExecutionEvidence({ opportunityId: String(opp.id), agentId: producer, kind: 'artifact', ref: 'old.diff', digest: digest('old') });
  db.run("UPDATE mission_execution_evidence SET observed_at = datetime(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'-2 hours') WHERE opportunity_id = ?", [String(opp.id)]);
  db.run("UPDATE mission_earning_engine_opportunities SET assigned_at = datetime(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'+1 hour') WHERE id = ?", [String(opp.id)]);
  const stale = Verification.verifyResult(String(opp.id), verifierB);
  assert.equal(stale.verified, false);
  assert.ok(stale.issues.includes('evidence_observed_after_assignment'));

  db.run("UPDATE mission_earning_engine_opportunities SET assigned_at = datetime(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = ?", [String(opp.id)]);
  const opp2 = executingOpportunity(producer);
  db.run(
    `INSERT INTO mission_execution_evidence (id, opportunity_id, agent_id, kind, ref, digest, meta_json, observed_at)
     VALUES ('evd-forged', ?, ?, 'artifact', 'forged.diff', ?, '{}', datetime(strftime('%Y-%m-%dT%H:%M:%fZ','now'))),
            ('evd-forged-2', ?, ?, 'artifact', 'forged2.diff', ?, '{}', datetime(strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
    [String(opp2.id), verifierC, digest('forged'), String(opp2.id), verifierC, digest('forged2')],
  );
  const foreign = Verification.verifyResult(String(opp2.id), verifierB);
  assert.equal(foreign.verified, false);
  assert.ok(foreign.issues.includes('producer_matches_assignment'));
  assert.equal(Engine.getEngineOpportunity(String(opp2.id))!.verification_state, 'executing');
});

it('no evidence means no verification: the opportunity stays executing and is reported as awaiting', () => {
  const opp = executingOpportunity(producer);
  const pass = Verification.autonomousVerifyExecuting(5);
  assert.equal(pass.scanned, 1);
  assert.equal(pass.verified, 0);
  assert.equal(pass.awaitingEvidence, 1);
  assert.equal(pass.details[0]!.reason, 'awaiting_evidence');
  assert.equal(Engine.getEngineOpportunity(String(opp.id))!.verification_state, 'executing');
});

it('fixture-origin agents can never mint a production verdict', () => {
  const fixtureProducer = makeAgent('rv-fixture-producer', 'fixture');
  const opp = executingOpportunity(fixtureProducer);
  Verification.recordExecutionEvidence({ opportunityId: String(opp.id), agentId: fixtureProducer, kind: 'artifact', ref: 'test-output.diff', digest: digest('fixture-work') });
  const verdict = Verification.verifyResult(String(opp.id), verifierB);
  assert.equal(verdict.mode, 'test_fixture');
  const ledger = Verification.verificationLedgerSummary();
  assert.equal(ledger.fixturePasses, 1);
  assert.equal(ledger.productionPasses, 0);
  // A fixture verdict is never committable, so the opportunity cannot advance.
  const other = makeAgent('rv-fixture-verifier', 'akbaral-registry');
  assert.equal(Verification.verifyResult(String(opp.id), other).mode, 'test_fixture');
  const commit = Verification.commitVerification(String(opp.id));
  assert.equal(commit.verified, false);
  assert.equal(commit.reason, 'fixture_verifications_are_not_committable');
  assert.equal(Engine.getEngineOpportunity(String(opp.id))!.verification_state, 'executing');
});

it('writes into the audit chain without breaking it', () => {
  const opp = executingOpportunity(producer);
  Verification.recordExecutionEvidence({ opportunityId: String(opp.id), agentId: producer, kind: 'artifact', ref: 'chain.diff', digest: digest('chain') });
  Verification.verifyResult(String(opp.id), verifierB);
  Verification.verifyResult(String(opp.id), verifierC);
  Verification.commitVerification(String(opp.id));
  assert.equal(verifyMissionAudit().ok, true);
});
