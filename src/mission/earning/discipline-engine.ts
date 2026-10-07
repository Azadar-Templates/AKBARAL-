import { missionDb, missionId, nowIso, type Row } from '../database';
import { assertInScope, cvss31BaseScore } from './bug-bounty-system';
import { adapterFor } from './platform-adapters';

export type RiskLevel = 'healthy' | 'caution' | 'restricted';
export interface QualityPolicyInput { programId: string; minConfidenceThreshold?: number; requirePoc?: boolean; requireEvidenceScreenshot?: boolean; maxSubmissionsPerWeek?: number; duplicateWindowDays?: number; rejectOnWeakEvidence?: boolean; minCvssForSubmit?: number }
function num(value: unknown, name: string, min: number, max: number, fallback: number): number { const n = value === undefined ? fallback : Number(value); if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} is invalid`); return n; }
function policyPublic(row: Row): Record<string, unknown> { return { id: String(row.id), programId: String(row.program_id), minConfidenceThreshold: Number(row.min_confidence_threshold), requirePoc: Number(row.require_poc) === 1, requireEvidenceScreenshot: Number(row.require_evidence_screenshot) === 1, maxSubmissionsPerWeek: Number(row.max_submissions_per_week), duplicateWindowDays: Number(row.duplicate_window_days), rejectOnWeakEvidence: Number(row.reject_on_weak_evidence) === 1, minCvssForSubmit: Number(row.min_cvss_for_submit), updatedBy: String(row.updated_by), updatedAt: String(row.updated_at) }; }
export function getQualityPolicy(programId: string): Record<string, unknown> | null { const row = missionDb.get<Row>('SELECT * FROM quality_policies WHERE program_id=?', [programId]); return row ? policyPublic(row) : null; }
export function saveQualityPolicy(input: QualityPolicyInput, ownerId: string): Record<string, unknown> {
  if (!missionDb.get('SELECT id FROM bounty_programs WHERE id=?', [input.programId])) throw new Error('program not found');
  const values = { minConfidenceThreshold: num(input.minConfidenceThreshold, 'minConfidenceThreshold', 0, 1, 0.75), requirePoc: input.requirePoc === true, requireEvidenceScreenshot: input.requireEvidenceScreenshot === true, maxSubmissionsPerWeek: Math.floor(num(input.maxSubmissionsPerWeek, 'maxSubmissionsPerWeek', 0, 100000, 3)), duplicateWindowDays: Math.floor(num(input.duplicateWindowDays, 'duplicateWindowDays', 0, 3650, 30)), rejectOnWeakEvidence: input.rejectOnWeakEvidence !== false, minCvssForSubmit: num(input.minCvssForSubmit, 'minCvssForSubmit', 0, 10, 0) };
  const existing = missionDb.get<Row>('SELECT id FROM quality_policies WHERE program_id=?', [input.programId]); const id = existing ? String(existing.id) : missionId('qpol'); const at = nowIso();
  if (existing) missionDb.run('UPDATE quality_policies SET min_confidence_threshold=?,require_poc=?,require_evidence_screenshot=?,max_submissions_per_week=?,duplicate_window_days=?,reject_on_weak_evidence=?,min_cvss_for_submit=?,updated_by=?,updated_at=? WHERE id=?', [values.minConfidenceThreshold, values.requirePoc ? 1 : 0, values.requireEvidenceScreenshot ? 1 : 0, values.maxSubmissionsPerWeek, values.duplicateWindowDays, values.rejectOnWeakEvidence ? 1 : 0, values.minCvssForSubmit, ownerId, at, id]);
  else missionDb.run('INSERT INTO quality_policies (id,program_id,min_confidence_threshold,require_poc,require_evidence_screenshot,max_submissions_per_week,duplicate_window_days,reject_on_weak_evidence,min_cvss_for_submit,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id, input.programId, values.minConfidenceThreshold, values.requirePoc ? 1 : 0, values.requireEvidenceScreenshot ? 1 : 0, values.maxSubmissionsPerWeek, values.duplicateWindowDays, values.rejectOnWeakEvidence ? 1 : 0, values.minCvssForSubmit, ownerId, at]);
  return getQualityPolicy(input.programId)!;
}

function confidence(finding: Row): { score: number; breakdown: Record<string, number> } {
  const breakdown = { reproduced: String(finding.reproduction ?? '').trim() ? 0.25 : 0, evidenceAttached: String(finding.evidence ?? '').trim() ? 0.2 : 0, scopeConfirmed: 0.2, severityJustified: String(finding.cvss_justification ?? '').trim() && finding.cvss_vector ? 0.2 : 0, impactExplained: String(finding.impact ?? '').trim() ? 0.15 : 0 };
  return { score: Number(Object.values(breakdown).reduce((sum, value) => sum + value, 0).toFixed(4)), breakdown };
}
function latestRisk(programId: string): RiskLevel { return String(missionDb.get<Row>('SELECT risk_level FROM bounty_program_risk WHERE program_id=?', [programId])?.risk_level ?? 'healthy') as RiskLevel; }
function rejection(programId: string, findingId: string | null, platformKey: string | null, reason: string, detail: string, fingerprint?: string | null): void { missionDb.run('INSERT INTO bounty_rejection_lessons (id,program_id,finding_id,platform_key,reason_code,reason_detail,fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?)', [missionId('brl'), programId, findingId, platformKey, reason, detail.slice(0, 2000), fingerprint ?? null, nowIso()]); }

export function validateFindingForSubmission(input: { findingId: string; platformKey: string }): Record<string, unknown> {
  const finding = missionDb.get<Row>('SELECT * FROM bounty_findings WHERE id=?', [input.findingId]);
  if (!finding) return { ready: false, reasons: ['finding_not_found'] };
  const reasons: string[] = []; const policyRow = missionDb.get<Row>('SELECT * FROM quality_policies WHERE program_id=?', [String(finding.program_id)]);
  if (!policyRow) { rejection(String(finding.program_id), input.findingId, input.platformKey, 'missing_policy', 'A quality policy is required before any payload build.', String(finding.finding_fingerprint)); return { ready: false, reasons: ['quality_policy_missing'], findingId: input.findingId }; }
  try { assertInScope(String(finding.program_id), String(finding.target), { agentType: 'discipline_engine' }); } catch { reasons.push('scope_gate_blocked'); }
  if (String(finding.state) !== 'gated') reasons.push('finding_not_quality_gated');
  const confidenceResult = confidence(finding); const policy = policyPublic(policyRow);
  if (confidenceResult.score < Number(policy.minConfidenceThreshold)) reasons.push(`confidence_below_threshold:${confidenceResult.score}`);
  if (policy.rejectOnWeakEvidence && (!String(finding.evidence ?? '').trim() || !String(finding.reproduction ?? '').trim())) reasons.push('weak_evidence');
  if (policy.requirePoc && !String(finding.reproduction ?? '').trim()) reasons.push('poc_required');
  if (policy.requireEvidenceScreenshot && !/screenshot|image|attachment/i.test(String(finding.evidence ?? ''))) reasons.push('evidence_screenshot_required');
  let cvss: number | null = null; try { cvss = finding.cvss_vector ? cvss31BaseScore(String(finding.cvss_vector)) : null; } catch { reasons.push('cvss_unverified'); }
  if (cvss !== null && cvss < Number(policy.minCvssForSubmit)) reasons.push('cvss_below_policy_minimum');
  const duplicate = missionDb.get<Row>('SELECT id FROM bounty_findings WHERE program_id=? AND finding_fingerprint=? AND id<>?', [String(finding.program_id), String(finding.finding_fingerprint), input.findingId]) || missionDb.get<Row>('SELECT id FROM bounty_rejection_lessons WHERE program_id=? AND fingerprint=? AND (finding_id IS NULL OR finding_id<>?)', [String(finding.program_id), String(finding.finding_fingerprint), input.findingId]);
  if (duplicate) reasons.push('duplicate_or_similar_prior_finding');
  const weekStart = new Date(); weekStart.setUTCDate(weekStart.getUTCDate() - 7); const weekly = Number(missionDb.get<Row>(`SELECT COUNT(*) AS count FROM bounty_submissions s JOIN bounty_findings f ON f.id=s.finding_id WHERE f.program_id=? AND s.created_at>=?`, [String(finding.program_id), weekStart.toISOString()])?.count ?? 0);
  if (weekly >= Number(policy.maxSubmissionsPerWeek)) reasons.push('weekly_submission_cap_exceeded');
  const risk = latestRisk(String(finding.program_id)); if (risk === 'restricted') reasons.push('program_reputation_restricted');
  if (reasons.length) rejection(String(finding.program_id), input.findingId, input.platformKey, reasons[0].split(':')[0], reasons.join('; '), String(finding.finding_fingerprint));
  missionDb.run('UPDATE bounty_findings SET confidence_score=?,confidence_breakdown_json=?,updated_at=? WHERE id=?', [confidenceResult.score, JSON.stringify(confidenceResult.breakdown), nowIso(), input.findingId]);
  return { ready: reasons.length === 0, reasons, findingId: input.findingId, platformKey: input.platformKey, confidence: confidenceResult, cvssScore: cvss, riskLevel: risk, policy };
}

export function buildPlatformSubmissionPayload(input: { findingId: string; platformKey: string }): Record<string, unknown> {
  const gate = validateFindingForSubmission(input); if (gate.ready !== true) return { status: 'not_ready', gate };
  const finding = missionDb.get<Row>('SELECT * FROM bounty_findings WHERE id=?', [input.findingId])!; const adapter = adapterFor(input.platformKey);
  const payload = adapter.buildSubmissionPayload({ ...finding, findingFingerprint: finding.finding_fingerprint, cvssVector: finding.cvss_vector, cvssScore: finding.cvss_score, vulnerabilityClass: finding.vulnerability_class, codeLocationPattern: finding.code_location_pattern }, { programId: String(finding.program_id), target: String(finding.target) });
  return { ...payload, submitted: false, gate };
}

export function lessonsSnapshot(): Array<Record<string, unknown>> { return missionDb.all<Row>('SELECT reason_code,COUNT(*) AS count,MAX(created_at) AS last_seen FROM bounty_rejection_lessons GROUP BY reason_code ORDER BY count DESC,reason_code').map((row) => ({ reasonCode: String(row.reason_code), count: Number(row.count), lastSeen: String(row.last_seen) })); }
export function lessonsDetail(limit = 200): Array<Record<string, unknown>> { return missionDb.all<Row>('SELECT * FROM bounty_rejection_lessons ORDER BY created_at DESC LIMIT ?', [Math.min(Math.max(limit, 1), 500)]); }

export function recordPlatformFeedback(input: { programId: string; findingId?: string; platformKey: string; outcome: 'accepted'|'rejected_invalid'|'rejected_duplicate'|'rejected_spam'|'rejected_other'; detail: string }, ownerId: string): Record<string, unknown> {
  const at = nowIso(); missionDb.run('INSERT INTO bounty_platform_feedback (id,program_id,finding_id,platform_key,outcome,detail,created_at) VALUES (?,?,?,?,?,?,?)', [missionId('bpf'), input.programId, input.findingId ?? null, input.platformKey, input.outcome, String(input.detail).slice(0, 2000), at]);
  const warnings = Number(missionDb.get<Row>("SELECT COUNT(*) AS count FROM bounty_platform_feedback WHERE program_id=? AND outcome IN ('rejected_invalid','rejected_duplicate','rejected_spam')", [input.programId])?.count ?? 0); const level: RiskLevel = warnings >= 3 ? 'restricted' : warnings >= 1 ? 'caution' : 'healthy'; const multiplier = level === 'restricted' ? 0.25 : level === 'caution' ? 0.5 : 1;
  const existing = missionDb.get<Row>('SELECT program_id FROM bounty_program_risk WHERE program_id=?', [input.programId]); if (existing) missionDb.run('UPDATE bounty_program_risk SET risk_level=?,warning_count=?,submission_rate_multiplier=?,last_reviewed_at=?,updated_at=? WHERE program_id=?', [level, warnings, multiplier, at, at, input.programId]); else missionDb.run('INSERT INTO bounty_program_risk (program_id,risk_level,warning_count,submission_rate_multiplier,last_reviewed_at,updated_at) VALUES (?,?,?,?,?,?)', [input.programId, level, warnings, multiplier, at, at]);
  rejection(input.programId, input.findingId ?? null, input.platformKey, input.outcome, input.detail); return { programId: input.programId, platformKey: input.platformKey, outcome: input.outcome, riskLevel: level, warningCount: warnings, submissionRateMultiplier: multiplier, recordedBy: ownerId, createdAt: at };
}

export function reputationSnapshot(): Array<Record<string, unknown>> {
  const programs = missionDb.all<Row>('SELECT id,platform,program_handle FROM bounty_programs ORDER BY platform,program_handle');
  return programs.map((program) => {
    const submitted = Number(missionDb.get<Row>('SELECT COUNT(*) AS count FROM bounty_submissions s JOIN bounty_findings f ON f.id=s.finding_id WHERE f.program_id=?', [String(program.id)])?.count ?? 0); const accepted = Number(missionDb.get<Row>("SELECT COUNT(*) AS count FROM bounty_platform_feedback WHERE program_id=? AND outcome='accepted'", [String(program.id)])?.count ?? 0); const rejected = Number(missionDb.get<Row>("SELECT COUNT(*) AS count FROM bounty_platform_feedback WHERE program_id=? AND outcome LIKE 'rejected_%'", [String(program.id)])?.count ?? 0); const duplicate = Number(missionDb.get<Row>("SELECT COUNT(*) AS count FROM bounty_platform_feedback WHERE program_id=? AND outcome='rejected_duplicate'", [String(program.id)])?.count ?? 0); const invalid = Number(missionDb.get<Row>("SELECT COUNT(*) AS count FROM bounty_platform_feedback WHERE program_id=? AND outcome='rejected_invalid'", [String(program.id)])?.count ?? 0); const risk = missionDb.get<Row>('SELECT risk_level,warning_count,submission_rate_multiplier FROM bounty_program_risk WHERE program_id=?', [String(program.id)]);
    return { programId: String(program.id), platform: String(program.platform), programHandle: String(program.program_handle), findingsSubmitted: submitted, accepted, rejected, duplicateRate: submitted ? duplicate / submitted : 0, invalidRate: submitted ? invalid / submitted : 0, riskLevel: String(risk?.risk_level ?? 'healthy'), warningCount: Number(risk?.warning_count ?? 0), submissionRateMultiplier: Number(risk?.submission_rate_multiplier ?? 1) };
  });
}

export function reputationForProgram(programId: string): Record<string, unknown> | null { return reputationSnapshot().find((item) => item.programId === programId) ?? null; }
