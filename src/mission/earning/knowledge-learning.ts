import { appendMissionAudit, missionDb, missionId, nowIso, type Row } from '../database';
import { ensureKnowledgeBase } from './knowledge-retrieval';

export type LearningSource = 'owner_feedback' | 'platform_rejection' | 'quality_gate_rejection' | 'confirmed_true_positive';
export type ImprovementType = 'add_pattern' | 'add_false_positive' | 'tighten_confidence_floor' | 'deprecate_pattern';

function bounded(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f]/.test(value)) throw new Error(`${name} is required and bounded`);
  return value.trim();
}

export function recordLearningEvent(input: { source: LearningSource; findingId?: string | null; programId?: string | null; platformKey?: string | null; vulnClass?: string | null; reasonCode: string; detail: string; createdBy: string }): string {
  const id = missionId('le');
  missionDb.run(`INSERT INTO learning_events (id,source,finding_id,program_id,platform_key,vuln_class,reason_code,detail,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, [id, input.source, input.findingId ?? null, input.programId ?? null, input.platformKey ?? null, input.vulnClass ?? null, bounded(input.reasonCode, 'reasonCode', 160), bounded(input.detail, 'detail', 4000), bounded(input.createdBy, 'createdBy', 200), nowIso()]);
  return id;
}

export function proposeKnowledgeImprovement(input: { knowledgeId: string; agentRole?: string | null; changeType: ImprovementType; changeDetail: string; evidenceRef: string }): Record<string, unknown> {
  ensureKnowledgeBase();
  if (!missionDb.get('SELECT id FROM vuln_knowledge WHERE id=?', [input.knowledgeId])) throw new Error('knowledge entry not found');
  const id = missionId('ki');
  missionDb.run(`INSERT INTO knowledge_improvements (id,knowledge_id,agent_role,change_type,change_detail,evidence_ref,approved_by_owner,status,created_at,updated_at) VALUES (?,?,?,?,?,?,0,'pending',?,?)`, [id, input.knowledgeId, input.agentRole ?? null, input.changeType, bounded(input.changeDetail, 'changeDetail', 4000), bounded(input.evidenceRef, 'evidenceRef', 300), nowIso(), nowIso()]);
  return knowledgeImprovement(id)!;
}

function knowledgeImprovement(id: string): Record<string, unknown> | null {
  const row = missionDb.get<Row>('SELECT * FROM knowledge_improvements WHERE id=?', [id]);
  return row ? { id: String(row.id), knowledgeId: String(row.knowledge_id), agentRole: row.agent_role == null ? null : String(row.agent_role), changeType: String(row.change_type), changeDetail: String(row.change_detail), evidenceRef: String(row.evidence_ref), approvedByOwner: Number(row.approved_by_owner) === 1, status: String(row.status), createdAt: String(row.created_at), updatedAt: String(row.updated_at) } : null;
}

export function listPendingImprovements(): Array<Record<string, unknown>> {
  ensureKnowledgeBase();
  return missionDb.all<Row>(`SELECT i.*,k.vuln_class,k.version,e.source AS evidence_source,e.reason_code AS evidence_reason,e.detail AS evidence_detail,e.created_by AS evidence_created_by
    FROM knowledge_improvements i JOIN vuln_knowledge k ON k.id=i.knowledge_id LEFT JOIN learning_events e ON e.id=i.evidence_ref
    WHERE i.status='pending' AND i.approved_by_owner=0 ORDER BY i.created_at`).map((row) => ({ ...knowledgeImprovement(String(row.id)), vulnClass: String(row.vuln_class), knowledgeVersion: Number(row.version), evidence: { source: row.evidence_source == null ? null : String(row.evidence_source), reasonCode: row.evidence_reason == null ? null : String(row.evidence_reason), detail: row.evidence_detail == null ? null : String(row.evidence_detail), createdBy: row.evidence_created_by == null ? null : String(row.evidence_created_by) } }));
}

export function approveKnowledgeImprovement(ownerId: string, id: string): Record<string, unknown> {
  ensureKnowledgeBase();
  const row = missionDb.get<Row>('SELECT * FROM knowledge_improvements WHERE id=? AND status=\'pending\' AND approved_by_owner=0', [id]);
  if (!row) throw new Error('pending knowledge improvement not found');
  if (String(row.change_type) === 'tighten_confidence_floor') {
    const match = String(row.change_detail).match(/(?:floor|confidence)\s*(?:to|=|:)\s*(0(?:\.\d+)?|1(?:\.0+)?)/i);
    if (!match) throw new Error('confidence-floor improvement requires an explicit floor');
    const next = Number(match[1]);
    const current = Number(missionDb.get<Row>('SELECT confidence_floor FROM vuln_knowledge WHERE id=?', [String(row.knowledge_id)])?.confidence_floor ?? 0);
    if (!Number.isFinite(next) || next < current || next > 1) throw new Error('approved learning cannot lower the confidence floor');
    missionDb.run('UPDATE vuln_knowledge SET confidence_floor=?,updated_at=? WHERE id=?', [next, nowIso(), String(row.knowledge_id)]);
  }
  const at = nowIso();
  missionDb.run('UPDATE knowledge_improvements SET approved_by_owner=1,status=\'approved\',updated_at=? WHERE id=?', [at, id]);
  appendMissionAudit({ actorType: 'owner', actorId: ownerId, action: 'knowledge.improvement_approved', subjectType: 'knowledge_improvement', subjectId: id, detail: { knowledgeId: String(row.knowledge_id), changeType: String(row.change_type) } });
  return knowledgeImprovement(id)!;
}

export function rejectKnowledgeImprovement(ownerId: string, id: string, reason: string): Record<string, unknown> {
  const row = missionDb.get<Row>('SELECT * FROM knowledge_improvements WHERE id=? AND status=\'pending\' AND approved_by_owner=0', [id]);
  if (!row) throw new Error('pending knowledge improvement not found');
  const at = nowIso();
  missionDb.run('UPDATE knowledge_improvements SET status=\'rejected\',updated_at=? WHERE id=?', [at, id]);
  appendMissionAudit({ actorType: 'owner', actorId: ownerId, action: 'knowledge.improvement_rejected', subjectType: 'knowledge_improvement', subjectId: id, detail: { reason: bounded(reason || 'owner_rejected', 'reason', 1000) } });
  return knowledgeImprovement(id)!;
}

export function recordQualityGateLearning(input: { findingId?: string | null; programId?: string | null; platformKey?: string | null; vulnClass?: string | null; reasons: unknown[]; createdBy?: string }): string {
  const eventId = recordLearningEvent({ source: 'quality_gate_rejection', findingId: input.findingId, programId: input.programId, platformKey: input.platformKey, vulnClass: input.vulnClass, reasonCode: 'quality_gate_rejection', detail: JSON.stringify(input.reasons).slice(0, 4000), createdBy: input.createdBy ?? 'system' });
  const knowledge = input.vulnClass ? missionDb.get<Row>('SELECT id FROM vuln_knowledge WHERE vuln_class=?', [input.vulnClass]) : undefined;
  if (knowledge) proposeKnowledgeImprovement({ knowledgeId: String(knowledge.id), agentRole: 'quality_gate', changeType: 'add_false_positive', changeDetail: `Owner review required before treating this quality-gate reason as a reusable false-positive pattern: ${JSON.stringify(input.reasons).slice(0, 1000)}`, evidenceRef: eventId });
  return eventId;
}

export function recordOwnerFeedbackLearning(input: { findingId?: string | null; programId?: string | null; platformKey?: string | null; vulnClass?: string | null; reasonCode: string; detail: string; confirmedTruePositive?: boolean; ownerId: string }): string {
  const source: LearningSource = input.confirmedTruePositive ? 'confirmed_true_positive' : 'owner_feedback';
  const eventId = recordLearningEvent({ source, findingId: input.findingId, programId: input.programId, platformKey: input.platformKey, vulnClass: input.vulnClass, reasonCode: input.reasonCode, detail: input.detail, createdBy: input.ownerId });
  if (input.vulnClass) {
    const knowledge = missionDb.get<Row>('SELECT id FROM vuln_knowledge WHERE vuln_class=?', [input.vulnClass]);
    if (knowledge) {
      const currentFloor = Number(missionDb.get<Row>('SELECT confidence_floor FROM vuln_knowledge WHERE id=?', [String(knowledge.id)])?.confidence_floor ?? 0);
      const suggestedFloor = Math.min(1, Number((currentFloor + 0.05).toFixed(2)));
      proposeKnowledgeImprovement({ knowledgeId: String(knowledge.id), agentRole: null, changeType: input.confirmedTruePositive ? 'tighten_confidence_floor' : 'add_false_positive', changeDetail: input.confirmedTruePositive ? `confidence floor to ${suggestedFloor.toFixed(2)}; owner approval is required` : `Owner review required: ${input.reasonCode}`, evidenceRef: eventId });
    }
  }
  return eventId;
}

export function recordPlatformOutcomeLearning(input: { programId: string; findingId?: string | null; platformKey: string; vulnClass?: string | null; outcome: 'accepted' | 'rejected_invalid' | 'rejected_duplicate' | 'rejected_spam' | 'rejected_other'; detail: string; ownerId: string }): string {
  return recordOwnerFeedbackLearning({ findingId: input.findingId, programId: input.programId, platformKey: input.platformKey, vulnClass: input.vulnClass, reasonCode: input.outcome, detail: input.detail, confirmedTruePositive: input.outcome === 'accepted', ownerId: input.ownerId });
}
