/**
 * ZA141251SA RESULT VERIFICATION — evidence-driven, independently reviewed work.
 *
 * This is the "execution → result verification" link of the earning loop. It exists
 * because the previous automatic path graded itself: the continuous scheduler asked
 * `verifyWorkMultiAgent` to mark work verified using two hard-coded `passed: true`
 * attestations, one of them from the agent that did the work. A green test is not a
 * delivered task, so here a verdict is *derived* from durable evidence rather than
 * asserted by a caller.
 *
 * Rules this module enforces (all fail-closed):
 *   · evidence is content-addressed — sha256 digest of what was actually produced;
 *   · only the agent assigned to the opportunity may record its output, and only
 *     while the assignment is live (no writing evidence onto someone else's job);
 *   · a verifier may not approve the producer's own submission, may not approve its
 *     own evidence, and may not approve evidence that predates the assignment;
 *   · `passed` is computed from the checks, never supplied;
 *   · an opportunity flips to `verified` only when TWO distinct independent verifiers
 *     passed the SAME evidence digest set;
 *   · verifications performed by fixture agents are recorded as `test_fixture` and
 *     can never satisfy a production claim (see fleet-readiness.ts).
 *
 * Nothing here touches money: payment confirmation and USD settlement remain the
 * owner/provider gates in earning-engine (verifyProviderPayment / reconcileSettlement).
 */

import { missionDb as db, missionId, nowIso, sha256, appendMissionAudit, type Row } from '../database';
import { MoneyError } from '../money';
import * as EarningEngine from './earning-engine';

function deny(code: string): never { throw new MoneyError(`verification_${code}` as any); }

export const EVIDENCE_KINDS = ['artifact', 'github_pr', 'github_commit', 'document', 'dataset', 'provider_receipt', 'owner_attestation'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export type CheckKey =
  | 'evidence_present'
  | 'producer_matches_assignment'
  | 'opportunity_executing'
  | 'verifier_independent'
  | 'verifier_not_author_of_evidence'
  | 'evidence_observed_after_assignment'
  | 'artifact_integrity';

export interface EvidenceInput {
  opportunityId: string;
  agentId: string;
  kind: EvidenceKind;
  ref: string;
  digest: string;
  sizeBytes?: number | null;
  executionId?: string | null;
  meta?: Record<string, unknown>;
}

export interface VerificationCheck { key: CheckKey; passed: boolean; detail: string }

export interface VerificationVerdict {
  verified: boolean;
  confidence: number;
  checks: VerificationCheck[];
  evidenceDigest: string;
  verifierAgentId: string;
  producerAgentId: string;
  mode: 'production' | 'test_fixture';
  issues: string[];
  /** Re-running the same reviewer over unchanged bytes returns the stored verdict
   *  instead of a second record — no duplicate voice, no lost work. */
  replayed: boolean;
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
/** Digests people type when they do not really have bytes: never acceptable as proof. */
const DEGENERATE_DIGESTS = new Set(['0'.repeat(64), 'f'.repeat(64), sha256(''), sha256('placeholder'), sha256('todo'), sha256('test')]);

/** Per-kind shape of a real, followable reference. "See Slack" is not a reference. */
const REF_PATTERNS: Record<EvidenceKind, RegExp | null> = {
  github_pr: /^https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/pull\/\d+$/i,
  github_commit: /^https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/commit\/[a-f0-9]{7,40}$/i,
  document: /^https:\/\/\S{4,}$/i,
  dataset: /^\S{4,}$/i,
  artifact: /^\S{4,}$/i,
  provider_receipt: /^\S{8,}$/i,
  owner_attestation: /^\S{8,}$/i,
};

function normalizeDigest(value: unknown): string {
  const text = String(value ?? '').trim().toLowerCase();
  if (!DIGEST_PATTERN.test(text)) deny('digest_must_be_sha256_hex');
  if (DEGENERATE_DIGESTS.has(text)) deny('digest_is_a_placeholder');
  return text;
}

function agentOrigin(agentId: string): string {
  return String(db.get<Row>('SELECT origin_platform FROM mission_agents WHERE id=?', [agentId])?.origin_platform ?? '');
}
/** Fixture agents exist only inside tests; a verdict they take can never be a
 *  production fact, so it is recorded as test_fixture and excluded everywhere. */
function isFixtureOrigin(agentId: string): boolean {
  return ['fixture', 'test', 'test_fixture'].includes(agentOrigin(agentId));
}
function agentActive(agentId: string): boolean {
  return db.get<Row>("SELECT 1 AS ok FROM mission_agents WHERE id=? AND status='active'", [agentId]) !== undefined;
}

/**
 * Record what an agent actually produced for an assignment. Idempotent on
 * (opportunity, digest): re-recording the same bytes returns the existing row
 * rather than double-counting a deliverable.
 */
export function recordExecutionEvidence(input: EvidenceInput): Row {
  const opp = EarningEngine.getEngineOpportunity(String(input.opportunityId));
  if (!opp) deny('opportunity_missing');
  const state = String(opp!.verification_state);
  if (!['assigned', 'executing'].includes(state)) deny(`state_not_writable:${state}`);
  if (String(opp!.exclusive_agent_id ?? '') !== String(input.agentId)) deny('producer_not_assigned_agent');
  if (!EVIDENCE_KINDS.includes(input.kind)) deny('unknown_evidence_kind');
  if (!agentActive(String(input.agentId))) deny('producer_not_active');
  const digest = normalizeDigest(input.digest);
  const ref = String(input.ref ?? '').trim();
  if (ref.length < 4 || ref.length > 2000) deny('evidence_ref_unusable');
  const pattern = REF_PATTERNS[input.kind];
  if (pattern && !pattern.test(ref)) deny(`evidence_ref_shape_${input.kind}`);
  const size = input.sizeBytes === undefined || input.sizeBytes === null ? null : Number(input.sizeBytes);
  if (size !== null && (!Number.isSafeInteger(size) || size < 0)) deny('evidence_size_invalid');

  const existing = db.get<Row>('SELECT * FROM mission_execution_evidence WHERE opportunity_id=? AND digest=?', [String(opp!.id), digest]);
  if (existing) return existing;

  const id = missionId('evd');
  db.run(
    `INSERT INTO mission_execution_evidence (id, opportunity_id, execution_id, agent_id, kind, ref, digest, size_bytes, meta_json, observed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, String(opp!.id), input.executionId ? String(input.executionId) : null, String(input.agentId), input.kind, ref, digest,
      size, JSON.stringify(input.meta ?? {}), nowIso()],
  );
  appendMissionAudit({
    actorType: 'agent', actorId: String(input.agentId), action: 'earning.evidence_recorded',
    subjectType: 'earning_opportunity', subjectId: String(opp!.id),
    detail: { kind: input.kind, digest, ref: ref.slice(0, 300) } as any,
  });
  return db.get<Row>('SELECT * FROM mission_execution_evidence WHERE id=?', [id])!;
}

export function listEvidence(opportunityId: string): Row[] {
  return db.all<Row>('SELECT * FROM mission_execution_evidence WHERE opportunity_id=? ORDER BY observed_at ASC, id ASC', [opportunityId]);
}

/** Single digest over the exact evidence set a verifier reviewed, so two verdicts
 *  can be compared for "they approved the same thing". */
export function evidenceSetDigest(rows: Row[]): string {
  return sha256(rows.map(r => `${String(r.kind)}:${String(r.digest)}`).sort().join('|'));
}

function check(key: CheckKey, passed: boolean, detail: string): VerificationCheck {
  return { key, passed, detail };
}

/**
 * Run the checks one independent verifier can actually run, and record the verdict.
 * The caller supplies only WHO is reviewing; every check below is read from durable
 * rows. Re-running the same verifier over the same evidence set is idempotent.
 */
export function verifyResult(opportunityId: string, verifierAgentId: string): VerificationVerdict {
  const opp = EarningEngine.getEngineOpportunity(String(opportunityId));
  if (!opp) deny('opportunity_missing');
  const producerId = String(opp!.exclusive_agent_id ?? '');
  if (!producerId) deny('unassigned_opportunity');
  if (!agentActive(String(verifierAgentId))) deny('verifier_not_active');

  const evidence = listEvidence(String(opp!.id));
  const foreignEvidence = evidence.filter(r => String(r.agent_id) !== producerId);
  const authoredByVerifier = evidence.filter(r => String(r.agent_id) === String(verifierAgentId));
  const assignedAt = Date.parse(String(opp!.assigned_at ?? opp!.created_at ?? ''));
  const stale = evidence.filter(r => {
    const at = Date.parse(String(r.observed_at));
    return Number.isFinite(assignedAt) && Number.isFinite(at) && at < assignedAt;
  });
  const digests = evidence.map(r => String(r.digest));
  const malformed = digests.filter(d => !DIGEST_PATTERN.test(String(d).toLowerCase()) || DEGENERATE_DIGESTS.has(String(d).toLowerCase()));
  const evidenceDigest = evidenceSetDigest(evidence);
  const prior = db.get<Row>(
    'SELECT * FROM mission_result_verifications WHERE opportunity_id=? AND verifier_agent_id=? AND evidence_digest=?',
    [String(opp!.id), String(verifierAgentId), evidenceDigest],
  );
  if (prior) {
    const storedChecks = (() => { try { return JSON.parse(String(prior.checks_json)) as VerificationCheck[]; } catch { return []; } })();
    return {
      verified: Number(prior.passed) === 1, confidence: Number(prior.confidence), checks: storedChecks,
      evidenceDigest, verifierAgentId: String(verifierAgentId), producerAgentId: producerId,
      mode: String(prior.mode) === 'test_fixture' ? 'test_fixture' : 'production',
      issues: storedChecks.filter(c => !c.passed).map(c => c.key), replayed: true,
    };
  }

  const checks: VerificationCheck[] = [
    check('evidence_present', evidence.length > 0, evidence.length ? `${evidence.length} evidence row(s)` : 'no artifact recorded for this assignment'),
    check('producer_matches_assignment', foreignEvidence.length === 0, foreignEvidence.length ? `${foreignEvidence.length} evidence row(s) not produced by the assigned agent` : 'all evidence attributed to the assigned producer'),
    check('opportunity_executing', String(opp!.verification_state) === 'executing', `verification_state=${String(opp!.verification_state)}`),
    check('verifier_independent', String(verifierAgentId) !== producerId, String(verifierAgentId) === producerId ? 'the producing agent cannot verify its own work' : 'independent reviewer'),
    check('verifier_not_author_of_evidence', authoredByVerifier.length === 0, authoredByVerifier.length ? 'verifier recorded this evidence itself' : 'verifier authored none of the approved evidence'),
    check('evidence_observed_after_assignment', stale.length === 0, stale.length ? `${stale.length} evidence row(s) predate the assignment` : 'evidence postdates assignment'),
    check('artifact_integrity', digests.length > 0 && malformed.length === 0 && new Set(digests).size === digests.length, malformed.length ? `${malformed.length} malformed digest(s)` : 'digests well-formed and unique'),
  ];
  // Two voices means two DIFFERENT agents on the same bytes: an agent re-approving
  // mutated evidence creates a second digest group, never a second voter here.
  const failed = checks.filter(c => !c.passed);
  const passed = failed.length === 0;
  // Confidence is the share of checks that cleared — never a hard-coded 0.92.
  const confidence = Math.round((checks.filter(c => c.passed).length / checks.length) * 100) / 100;
  const mode: 'production' | 'test_fixture' = isFixtureOrigin(producerId) || isFixtureOrigin(String(verifierAgentId)) ? 'test_fixture' : 'production';

  {
    db.run(
      `INSERT INTO mission_result_verifications (id, opportunity_id, verifier_agent_id, producer_agent_id, evidence_digest, checks_json, passed, confidence, mode, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [missionId('rvf'), String(opp!.id), String(verifierAgentId), producerId, evidenceDigest, JSON.stringify(checks), passed ? 1 : 0, confidence, mode, nowIso()],
    );
    appendMissionAudit({
      actorType: 'agent', actorId: String(verifierAgentId), action: passed ? 'earning.result_verified' : 'earning.result_verification_failed',
      subjectType: 'earning_opportunity', subjectId: String(opp!.id),
      detail: { evidenceDigest, confidence, failed: failed.map(f => `${f.key}:${f.detail}`).slice(0, 8), mode } as any,
    });
  }
  return { verified: passed, confidence, checks, evidenceDigest, verifierAgentId: String(verifierAgentId), producerAgentId: producerId, mode, issues: failed.map(f => f.key), replayed: false };
}

export interface CommitResult { verified: boolean; independentVerifiers: number; confidence: number; reason: string }

/**
 * Promote an opportunity to `verified` only when two distinct independent verifiers
 * passed the same evidence set. Delegates the actual state flip to the existing
 * engine state machine so the audit chain and version counter stay in one place.
 */
export function commitVerification(opportunityId: string): CommitResult {
  const opp = EarningEngine.getEngineOpportunity(String(opportunityId));
  if (!opp) deny('opportunity_missing');
  if (String(opp!.verification_state) !== 'executing') return { verified: false, independentVerifiers: 0, confidence: 0, reason: `not_executing:${String(opp!.verification_state)}` };
  const rows = db.all<Row>(
    "SELECT verifier_agent_id AS verifierId, evidence_digest AS digest, confidence FROM mission_result_verifications WHERE opportunity_id=? AND passed=1 AND mode='production'",
    [String(opp!.id)],
  );
  const fixtureOnly = Number(db.get<Row>(
    "SELECT COUNT(*) AS c FROM mission_result_verifications WHERE opportunity_id=? AND passed=1 AND mode='test_fixture'", [String(opp!.id)],
  )?.c ?? 0);
  const byDigest = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const key = String(r.digest);
    if (!byDigest.has(key)) byDigest.set(key, new Map());
    byDigest.get(key)!.set(String(r.verifierId), Number(r.confidence));
  }
  const producerId = String(opp!.exclusive_agent_id ?? '');
  const candidate = [...byDigest.values()].map(m => [...m.entries()]).find(entries => entries.length >= 2);
  if (!candidate) {
    return {
      verified: false, independentVerifiers: 0, confidence: 0,
      reason: fixtureOnly > 0 ? 'fixture_verifications_are_not_committable' : 'two_independent_verifications_required',
    };
  }
  const confidences = candidate.map(([, c]) => c);
  const verdict = EarningEngine.verifyWorkMultiAgent(String(opp!.id), candidate.map(([agentId, confidence]) => ({ agentId, confidence, passed: true })));
  if (!verdict.verified) return { verified: false, independentVerifiers: candidate.length, confidence: Math.min(...confidences), reason: 'engine_threshold' };
  appendMissionAudit({
    actorType: 'system', action: 'earning.result_verification_committed', subjectType: 'earning_opportunity', subjectId: String(opp!.id),
    detail: { verifiers: candidate.map(([a]) => a), producer: producerId || null, confidence: verdict.confidence } as any,
  });
  return { verified: true, independentVerifiers: candidate.length, confidence: verdict.confidence, reason: 'verified' };
}

/**
 * The scheduler's verification pass. Replaces the old self-attestation block: an
 * opportunity with no durable evidence stays `executing` and is reported as awaiting
 * evidence — it is never counted as completed work.
 */
export function autonomousVerifyExecuting(limit = 25): {
  scanned: number; verified: number; awaitingEvidence: number; failed: number; details: Array<{ opportunityId: string; reason: string }>;
} {
  const rows = db.all<Row>(
    "SELECT id FROM mission_earning_engine_opportunities WHERE verification_state='executing' ORDER BY updated_at ASC LIMIT ?",
    [Math.max(1, Math.min(200, Math.trunc(limit) || 1))],
  );
  let verified = 0, awaitingEvidence = 0, failed = 0;
  const details: Array<{ opportunityId: string; reason: string }> = [];
  for (const r of rows) {
    const oppId = String(r.id);
    try {
      const result = commitVerification(oppId);
      if (result.verified) { verified++; continue; }
      const evidenceCount = listEvidence(oppId).length;
      if (evidenceCount === 0) { awaitingEvidence++; details.push({ opportunityId: oppId, reason: 'awaiting_evidence' }); }
      else { failed++; details.push({ opportunityId: oppId, reason: result.reason }); }
    } catch (e) {
      failed++;
      details.push({ opportunityId: oppId, reason: String((e as MoneyError)?.code ?? (e as Error)?.message ?? 'verification_error').slice(0, 200) });
    }
  }
  return { scanned: rows.length, verified, awaitingEvidence, failed, details };
}

/** Read model for the owner view and the fleet readiness report. */
export function verificationStatus(opportunityId: string): {
  evidence: Row[]; verifications: Row[]; independentPasses: number; committed: boolean; state: string | null;
} {
  const evidence = listEvidence(opportunityId);
  const verifications = db.all<Row>(
    `SELECT id, verifier_agent_id, producer_agent_id, evidence_digest, passed, confidence, mode, created_at
       FROM mission_result_verifications WHERE opportunity_id=? ORDER BY created_at ASC`, [opportunityId],
  );
  const opp = EarningEngine.getEngineOpportunity(opportunityId);
  const digestGroups = new Map<string, Set<string>>();
  for (const v of verifications) {
    if (!Number(v.passed)) continue;
    const key = String(v.evidence_digest);
    if (!digestGroups.has(key)) digestGroups.set(key, new Set());
    digestGroups.get(key)!.add(String(v.verifier_agent_id));
  }
  const independentPasses = Math.max(0, ...[...digestGroups.values()].map(s => s.size));
  return {
    evidence, verifications, independentPasses,
    committed: independentPasses >= 2,
    state: opp ? String(opp.verification_state) : null,
  };
}

export function verificationLedgerSummary(): { evidenceRows: number; verifications: number; productionPasses: number; fixturePasses: number; opportunitiesCommitted: number } {
  const g = (sql: string) => Number(db.get<Row>(sql)?.c ?? 0);
  return {
    evidenceRows: g('SELECT COUNT(*) AS c FROM mission_execution_evidence'),
    verifications: g('SELECT COUNT(*) AS c FROM mission_result_verifications'),
    productionPasses: g("SELECT COUNT(*) AS c FROM mission_result_verifications WHERE passed=1 AND mode='production'"),
    fixturePasses: g("SELECT COUNT(*) AS c FROM mission_result_verifications WHERE passed=1 AND mode='test_fixture'"),
    opportunitiesCommitted: g("SELECT COUNT(DISTINCT id) AS c FROM mission_earning_engine_opportunities WHERE verification_state IN ('verified','delivered','payment_confirmed','settlement_verified')"),
  };
}
