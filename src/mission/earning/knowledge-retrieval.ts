import { missionDb, missionId, nowIso, type Row } from '../database';
import { seedKnowledgeBase } from './knowledge-catalog';

export interface KnowledgeTargetContext {
  agentRole: string;
  category?: 'web' | 'web3' | 'github' | 'infra';
  language?: string;
  framework?: string;
  fileTypes?: string[];
  entryPointSignals?: string[];
  vulnClasses?: string[];
  platformKey?: string;
  programId?: string;
  target?: string;
  runId?: string;
  findingId?: string;
}

export interface KnowledgeTraceItem { id: string; vulnClass: string; version: number; confidenceFloor: number; }
export interface KnowledgeTrace {
  knowledge: KnowledgeTraceItem[];
  agentRole: string;
  agentPlaybook: string | null;
  platformPlaybook: string | null;
  checklistPassed: string[];
  checklistFailed: string[];
  genericPass: boolean;
  consultedAt: string;
}

export interface KnowledgeConsultation {
  knowledge: Array<Record<string, unknown>>;
  agentPlaybook: Record<string, unknown> | null;
  platformPlaybook: Record<string, unknown> | null;
  trace: KnowledgeTrace;
  genericPass: boolean;
}

function json(value: unknown, fallback: unknown): any {
  try { return JSON.parse(String(value ?? '')); } catch { return fallback; }
}

function array(row: Row, key: string): unknown[] {
  const value = json(row[key], []);
  return Array.isArray(value) ? value : [];
}

function publicPlaybook(row: Row): Record<string, unknown> {
  return {
    agentRole: String(row.agent_role), orderedSteps: array(row, 'ordered_steps_json'), requiredInputs: array(row, 'required_inputs_json'), toolSequence: array(row, 'tool_sequence_json'), stopConditions: array(row, 'stop_conditions_json'), handoffTo: row.handoff_to == null ? null : String(row.handoff_to), successCriteria: array(row, 'success_criteria_json'), failConditions: array(row, 'fail_conditions_json'), learnedImprovements: array(row, 'learned_improvements_json'), vulnClasses: array(row, 'vuln_classes_json'), sourceType: String(row.source_type), sourceRef: String(row.source_ref), updatedAt: String(row.updated_at),
  };
}

function publicPlatformPlaybook(row: Row): Record<string, unknown> {
  return {
    platformKey: String(row.platform_key), submissionWorkflowSteps: array(row, 'submission_workflow_steps_json'), requiredFields: array(row, 'required_fields_json'), severityScale: json(row.severity_scale_json, {}), assetEvidenceRequirements: array(row, 'asset_evidence_requirements_json'), pocRequirements: array(row, 'poc_requirements_json'), formatLimits: json(row.format_limits_json, {}), disclosureRules: array(row, 'disclosure_rules_json'), commonRejectionReasons: array(row, 'common_rejection_reasons_json'), reviewTimelineExpectation: String(row.review_timeline_expectation), doNotDo: array(row, 'do_not_do_json'), sourceType: String(row.source_type), sourceRef: String(row.source_ref), status: String(row.status), updatedAt: String(row.updated_at),
  };
}

function approvedImprovements(knowledgeId: string): Array<Record<string, unknown>> {
  return missionDb.all<Row>(`SELECT id,agent_role,change_type,change_detail,evidence_ref,created_at FROM knowledge_improvements WHERE knowledge_id=? AND status='approved' AND approved_by_owner=1 ORDER BY created_at`, [knowledgeId]).map((row) => ({ id: String(row.id), agentRole: row.agent_role == null ? null : String(row.agent_role), changeType: String(row.change_type), changeDetail: String(row.change_detail), evidenceRef: String(row.evidence_ref), createdAt: String(row.created_at) }));
}

function publicKnowledge(row: Row, includeApproved = false): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: String(row.id), vulnClass: String(row.vuln_class), category: String(row.category), detectionPatterns: array(row, 'detection_patterns_json'), codeSignals: array(row, 'code_signals_json'), taintSources: array(row, 'taint_sources_json'), taintSinks: array(row, 'taint_sinks_json'), validationChecklist: array(row, 'validation_checklist_json'), safeReproductionTemplate: array(row, 'safe_reproduction_template_json'), commonFalsePositives: array(row, 'common_false_positives_json'), falsePositiveSignals: array(row, 'false_positive_signals_json'), realWorldReferences: array(row, 'real_world_references_json'), severityGuidance: array(row, 'severity_guidance_json'), cvssVectorGuidance: array(row, 'cvss_vector_guidance_json'), confidenceFloor: Number(row.confidence_floor), sourceType: String(row.source_type), sourceRef: String(row.source_ref), referenceStatus: String(row.reference_status), version: Number(row.version), updatedAt: String(row.updated_at),
  };
  if (includeApproved) result.approvedImprovements = approvedImprovements(String(row.id));
  return result;
}

function contextTerms(context: KnowledgeTargetContext): string[] {
  const stopTerms = new Set(['language', 'unknown', 'fictional', 'input', 'source', 'target', 'string', 'object', 'request', 'data', 'code', 'function', 'role', 'web', 'web3', 'github', 'infra']);
  return [context.category ?? '', context.language ?? '', context.framework ?? '', ...(context.fileTypes ?? []), ...(context.entryPointSignals ?? []), ...(context.vulnClasses ?? [])].join(' ').toLowerCase().split(/[^a-z0-9_]+/).filter((term) => term.length > 2 && !stopTerms.has(term));
}

function contextClassHints(context: KnowledgeTargetContext): Set<string> {
  const text = contextTerms(context).join(' ');
  const hints = new Set((context.vulnClasses ?? []).map((value) => value.toLowerCase()));
  if (/solidity|evm|ethereum|smart.?contract|\.sol\b/.test(text)) ['reentrancy', 'oracle_price_manipulation', 'integer_overflow_precision', 'access_control', 'signature_replay_permit', 'proxy_upgrade_risk'].forEach((value) => hints.add(value));
  if (/rest|api|http|express|django|rails|spring|graphql|endpoint|json/.test(text)) ['sql_injection', 'idor_bola', 'ssrf', 'broken_access_control', 'xss', 'csrf'].forEach((value) => hints.add(value));
  if (/github|workflow|actions|pull.?request|repository|\.ya?ml/.test(text)) ['github_actions_injection', 'unsafe_workflow_permissions', 'secret_exposure', 'dependency_confusion'].forEach((value) => hints.add(value));
  if (/oracle|price|feed|twap/.test(text)) hints.add('oracle_price_manipulation');
  if (/callback|withdraw|external.?call/.test(text)) hints.add('reentrancy');
  if (/query|sql|database|orm/.test(text)) hints.add('sql_injection');
  if (/object.?id|tenant|authorization|access.?control/.test(text)) hints.add('idor_bola');
  if (/url.?fetch|webhook|metadata|internal.?request/.test(text)) hints.add('ssrf');
  return hints;
}

function scoreKnowledge(row: Row, context: KnowledgeTargetContext, hints: Set<string>, terms: string[]): number {
  const vulnClass = String(row.vuln_class).toLowerCase();
  const haystack = [vulnClass, String(row.category), ...array(row, 'detection_patterns_json').map(String), ...array(row, 'code_signals_json').map(String), ...array(row, 'taint_sources_json').map(String), ...array(row, 'taint_sinks_json').map(String)].join(' ').toLowerCase();
  let score = 0;
  if (hints.has(vulnClass)) score += 100;
  if (context.category && String(row.category) === context.category) score += 25;
  for (const term of terms) if (haystack.includes(term)) score += term === vulnClass ? 30 : 2;
  return score;
}

export function ensureKnowledgeBase(): void {
  seedKnowledgeBase();
}

export function retrieveKnowledge(context: KnowledgeTargetContext, limit = 12): KnowledgeConsultation {
  ensureKnowledgeBase();
  const terms = contextTerms(context);
  const hints = contextClassHints(context);
  const rows = missionDb.all<Row>('SELECT * FROM vuln_knowledge ORDER BY category,vuln_class');
  const ranked = rows.map((row) => ({ row, score: scoreKnowledge(row, context, hints, terms) })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || String(a.row.vuln_class).localeCompare(String(b.row.vuln_class))).slice(0, Math.max(1, Math.min(limit, 50)));
  const agentRow = missionDb.get<Row>('SELECT * FROM agent_playbooks WHERE agent_role=? AND active=1', [context.agentRole]);
  const platformRow = context.platformKey ? missionDb.get<Row>('SELECT * FROM platform_playbooks WHERE platform_key=?', [context.platformKey]) : undefined;
  const consultedAt = nowIso();
  const knowledge = ranked.map((entry) => publicKnowledge(entry.row, true));
  const trace: KnowledgeTrace = {
    knowledge: ranked.map((entry) => ({ id: String(entry.row.id), vulnClass: String(entry.row.vuln_class), version: Number(entry.row.version), confidenceFloor: Number(entry.row.confidence_floor) })),
    agentRole: context.agentRole,
    agentPlaybook: agentRow ? String(agentRow.agent_role) : null,
    platformPlaybook: platformRow ? String(platformRow.platform_key) : null,
    checklistPassed: [],
    checklistFailed: [],
    genericPass: ranked.length === 0,
    consultedAt,
  };
  for (let index = 0; index < ranked.length; index += 1) {
    const entry = ranked[index];
    missionDb.run(`INSERT INTO knowledge_usage (id,knowledge_id,knowledge_version,agent_role,program_id,target,run_id,finding_id,retrieval_rank,relevance_score,consulted,used_in_finding,consulted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [missionId('ku'), String(entry.row.id), Number(entry.row.version), context.agentRole, context.programId ?? null, context.target ?? null, context.runId ?? null, context.findingId ?? null, index + 1, entry.score, 1, context.findingId ? 1 : 0, consultedAt]);
  }
  return { knowledge, agentPlaybook: agentRow ? publicPlaybook(agentRow) : null, platformPlaybook: platformRow ? publicPlatformPlaybook(platformRow) : null, trace, genericPass: ranked.length === 0 };
}

export function consultKnowledgeBeforeAnalysis(context: KnowledgeTargetContext): KnowledgeConsultation {
  const consultation = retrieveKnowledge(context);
  // A playbook is required for every registered control role. A missing role
  // is a generic pass, never a silently invented playbook.
  if (!consultation.agentPlaybook) consultation.trace.genericPass = true;
  return consultation;
}

export function knowledgeForClass(vulnClass: string): Record<string, unknown> | null {
  ensureKnowledgeBase();
  const row = missionDb.get<Row>('SELECT * FROM vuln_knowledge WHERE vuln_class=? AND reference_status=\'verified\'', [vulnClass.trim().toLowerCase()]);
  return row ? publicKnowledge(row) : null;
}

export function pinKnowledgeTrace(vulnClass: string, supplied?: unknown, agentRole = 'quality_gate'): KnowledgeTrace | null {
  const existing = supplied && typeof supplied === 'object' ? supplied as Partial<KnowledgeTrace> : null;
  const classRow = knowledgeForClass(vulnClass);
  if (!classRow) return null;
  const suppliedItems = Array.isArray(existing?.knowledge) ? existing.knowledge.filter((item): item is KnowledgeTraceItem => Boolean(item && typeof item === 'object' && typeof (item as KnowledgeTraceItem).id === 'string' && Number.isInteger(Number((item as KnowledgeTraceItem).version)))) : [];
  const matched = suppliedItems.find((item) => item.id === classRow.id && Number(item.version) === Number(classRow.version));
  return {
    knowledge: matched ? suppliedItems.map((item) => ({ id: item.id, vulnClass: item.vulnClass, version: Number(item.version), confidenceFloor: Number(item.confidenceFloor ?? 0) })) : [{ id: String(classRow.id), vulnClass: String(classRow.vulnClass), version: Number(classRow.version), confidenceFloor: Number(classRow.confidenceFloor) }],
    agentRole: String(existing?.agentRole ?? agentRole), agentPlaybook: existing?.agentPlaybook ? String(existing.agentPlaybook) : null, platformPlaybook: existing?.platformPlaybook ? String(existing.platformPlaybook) : null, checklistPassed: Array.isArray(existing?.checklistPassed) ? existing.checklistPassed.map(String) : [], checklistFailed: Array.isArray(existing?.checklistFailed) ? existing.checklistFailed.map(String) : [], genericPass: false, consultedAt: String(existing?.consultedAt ?? nowIso()),
  };
}

function isNegated(haystack: string, signal: string): boolean {
  const escaped = signal.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:no|not|without|lacks?|missing)\\s+(?:a\\s+)?(?:[a-z0-9_-]+\\s+){0,3}${escaped}`).test(haystack);
}

export function falsePositiveReview(input: { vulnClass: string; finding: Record<string, unknown> }): { decision: 'pass' | 'block' | 'unverified'; matchedPattern: string | null; knowledgeId: string | null; version: number | null } {
  ensureKnowledgeBase();
  const row = missionDb.get<Row>('SELECT * FROM vuln_knowledge WHERE vuln_class=?', [input.vulnClass.trim().toLowerCase()]);
  if (!row) return { decision: 'unverified', matchedPattern: null, knowledgeId: null, version: null };
  const haystack = Object.values(input.finding).filter((value) => typeof value === 'string').join(' ').toLowerCase();
  const signals = array(row, 'false_positive_signals_json').map(String);
  const patterns = array(row, 'common_false_positives_json').map(String);
  const approved = approvedImprovements(String(row.id)).filter((item) => item.changeType === 'add_false_positive');
  for (const improvement of approved) {
    const detail = String(improvement.changeDetail).toLowerCase();
    if (detail.length >= 8 && haystack.includes(detail) && !isNegated(haystack, detail)) return { decision: 'block', matchedPattern: String(improvement.changeDetail), knowledgeId: String(row.id), version: Number(row.version) };
  }
  for (let index = 0; index < signals.length; index += 1) {
    const signal = signals[index].toLowerCase();
    if (signal && haystack.includes(signal) && !isNegated(haystack, signal)) return { decision: 'block', matchedPattern: patterns[index] ?? `known false-positive signal: ${signals[index]}`, knowledgeId: String(row.id), version: Number(row.version) };
  }
  return { decision: 'pass', matchedPattern: null, knowledgeId: String(row.id), version: Number(row.version) };
}

export function linkUsageToFinding(runId: string, findingId: string): number {
  return missionDb.run('UPDATE knowledge_usage SET finding_id=?,used_in_finding=1 WHERE run_id=?', [findingId, runId]).changes;
}

export function knowledgeUsageSnapshot(): Array<Record<string, unknown>> {
  ensureKnowledgeBase();
  return missionDb.all<Row>(`SELECT k.id,k.vuln_class,k.category,k.version,COUNT(u.id) AS consulted_count,COALESCE(SUM(u.used_in_finding),0) AS used_in_finding,MAX(u.consulted_at) AS last_consulted_at
    FROM vuln_knowledge k LEFT JOIN knowledge_usage u ON u.knowledge_id=k.id AND u.knowledge_version=k.version
    GROUP BY k.id,k.vuln_class,k.category,k.version ORDER BY consulted_count DESC,k.vuln_class`).map((row) => ({ knowledgeId: String(row.id), vulnClass: String(row.vuln_class), category: String(row.category), version: Number(row.version), consultedCount: Number(row.consulted_count), usedInFinding: Number(row.used_in_finding), hitRate: Number(row.consulted_count) ? Number(row.used_in_finding) / Number(row.consulted_count) : 0, lastConsultedAt: row.last_consulted_at == null ? null : String(row.last_consulted_at), neverUsed: Number(row.consulted_count) === 0 }));
}

export function listKnowledge(category?: string): Array<Record<string, unknown>> {
  ensureKnowledgeBase();
  const rows = category ? missionDb.all<Row>('SELECT * FROM vuln_knowledge WHERE category=? ORDER BY category,vuln_class', [category]) : missionDb.all<Row>('SELECT * FROM vuln_knowledge ORDER BY category,vuln_class');
  return rows.map((row) => publicKnowledge(row, true));
}

export function listAgentPlaybooks(): Array<Record<string, unknown>> {
  ensureKnowledgeBase();
  return missionDb.all<Row>('SELECT * FROM agent_playbooks WHERE active=1 ORDER BY agent_role').map(publicPlaybook);
}

export function listPlatformPlaybooks(): Array<Record<string, unknown>> {
  ensureKnowledgeBase();
  return missionDb.all<Row>('SELECT * FROM platform_playbooks ORDER BY platform_key').map(publicPlatformPlaybook);
}
