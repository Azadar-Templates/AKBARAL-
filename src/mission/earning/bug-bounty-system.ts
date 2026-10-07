import { missionDb, missionId, nowIso, sha256, type Row } from '../database';
import { currentPolicy } from '../policy';

/**
 * Scope-first bug-bounty control plane.
 *
 * This module intentionally has no HTTP client, shell runner, GitHub client or
 * provider import. `assertInScope` is the only boundary an external adapter may
 * use, and `runScopedExternalAction` calls it before the supplied callback. The
 * callback is never reached when the program has no explicit allowlist match.
 */

export class BountyScopeError extends Error {
  readonly code = 'target_out_of_scope';
  readonly statusCode = 403;
  constructor(public readonly programId: string, public readonly target: string, public readonly reason: string) {
    super(`target is not authorized by the configured bounty scope: ${reason}`);
  }
}

export class BountySystemError extends Error {
  constructor(public readonly code: string, message = code, public readonly statusCode = 409) { super(message); }
}

export interface ScopeMatch {
  programId: string;
  target: string;
  targetType: string;
  authRequired: boolean;
  rateLimitPerMin: number | null;
}

export interface ProgramInput {
  platform: string;
  programHandle: string;
  scopeUrl: string;
  inScopeAssets?: string[];
  outOfScope?: string[];
  rateLimitPolicy?: Record<string, unknown>;
  authRequired?: boolean;
  bountyRange?: Record<string, unknown>;
  programTermsHash: string;
  active?: boolean;
}

function boundedString(value: unknown, name: string, maximum = 400): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f]/.test(value)) {
    throw new BountySystemError('validation_error', `${name} is required and bounded`, 400);
  }
  return value.trim();
}

function stringList(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1000 || !value.every((item) => typeof item === 'string' && item.trim() && item.length <= 2048)) {
    throw new BountySystemError('validation_error', `${name} must be a bounded string list`, 400);
  }
  return value.map((item) => String(item).trim());
}

function objectJson(value: unknown, name: string): string {
  if (value === undefined || value === null) return '{}';
  if (typeof value !== 'object' || Array.isArray(value)) throw new BountySystemError('validation_error', `${name} must be an object`, 400);
  const encoded = JSON.stringify(value);
  if (encoded.length > 16000) throw new BountySystemError('validation_error', `${name} is too large`, 400);
  return encoded;
}

function parseJson(value: unknown, fallback: unknown): any {
  try { return JSON.parse(String(value ?? '')); } catch { return fallback; }
}

function recordScopeEvent(input: { programId: string; target: string; decision: 'allowed' | 'blocked'; reason: string; agentType?: string; runId?: string }): void {
  missionDb.run(
    `INSERT INTO scope_gate_events (id, program_id, target, decision, reason, agent_type, run_id, created_at) VALUES (?,?,?,?,?,?,?,?)`,
    [missionId('sge'), input.programId, input.target.slice(0, 2048), input.decision, input.reason.slice(0, 400), input.agentType ?? null, input.runId ?? null, nowIso()],
  );
}

function normalizeHost(value: string): string | null {
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '') || null;
  } catch { return null; }
}

function normalizeTarget(value: string, type?: string): string {
  const raw = boundedString(value, 'target', 2048);
  if (type === 'domain') return normalizeHost(raw) ?? raw.toLowerCase().replace(/\.$/, '');
  if (type === 'repo') {
    return raw.replace(/^https?:\/\/(?:www\.)?github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
  }
  if (type === 'API') {
    try {
      const parsed = new URL(raw);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '') || '/'}`.toLowerCase();
    } catch { return raw.toLowerCase().replace(/\/+$/, ''); }
  }
  return raw.toLowerCase().replace(/\/+$/, '');
}

function candidateValues(target: string, type: string): string[] {
  const values = [normalizeTarget(target, type)];
  const host = normalizeHost(target);
  if (host) values.push(host);
  if (type === 'repo') values.push(normalizeTarget(target, 'repo'));
  return [...new Set(values.filter(Boolean))];
}

function targetMatches(candidate: string, listed: string, type: string): boolean {
  const candidateValuesList = candidateValues(candidate, type);
  const normalizedListed = normalizeTarget(listed, type);
  return candidateValuesList.some((value) => value === normalizedListed || (type === 'domain' && normalizedListed.startsWith('*.') && (value === normalizedListed.slice(2) || value.endsWith(`.${normalizedListed.slice(2)}`))));
}

/** Hard scope gate. No row means blocked; an out-of-scope row wins over any
 * broad-looking program metadata. Every decision is durably logged. */
export function assertInScope(programId: string, target: string, context: { agentType?: string; runId?: string } = {}): ScopeMatch {
  const pid = boundedString(programId, 'programId', 200);
  const rawTarget = boundedString(target, 'target', 2048);
  const program = missionDb.get<Row>('SELECT id, active FROM bounty_programs WHERE id = ?', [pid]);
  if (!program) {
    recordScopeEvent({ programId: pid, target: rawTarget, decision: 'blocked', reason: 'program_not_configured', ...context });
    throw new BountyScopeError(pid, rawTarget, 'program_not_configured');
  }
  if (Number(program.active) !== 1) {
    recordScopeEvent({ programId: pid, target: rawTarget, decision: 'blocked', reason: 'program_inactive', ...context });
    throw new BountyScopeError(pid, rawTarget, 'program_inactive');
  }
  const rows = missionDb.all<Row>('SELECT * FROM scope_allowlist WHERE program_id = ? ORDER BY id', [pid]);
  const candidates = rows.filter((row) => targetMatches(rawTarget, String(row.target), String(row.target_type)));
  const denied = candidates.find((row) => Number(row.in_scope) !== 1);
  if (denied) {
    recordScopeEvent({ programId: pid, target: rawTarget, decision: 'blocked', reason: 'explicitly_out_of_scope', ...context });
    throw new BountyScopeError(pid, rawTarget, 'explicitly_out_of_scope');
  }
  const allowed = candidates.find((row) => Number(row.in_scope) === 1);
  if (!allowed) {
    recordScopeEvent({ programId: pid, target: rawTarget, decision: 'blocked', reason: 'target_not_allowlisted', ...context });
    throw new BountyScopeError(pid, rawTarget, 'target_not_allowlisted');
  }
  recordScopeEvent({ programId: pid, target: rawTarget, decision: 'allowed', reason: 'explicit_allowlist_match', ...context });
  return {
    programId: pid,
    target: rawTarget,
    targetType: String(allowed.target_type),
    authRequired: Number(allowed.auth_required) === 1,
    rateLimitPerMin: allowed.rate_limit_per_min === null ? null : Number(allowed.rate_limit_per_min),
  };
}

export async function runScopedExternalAction<T>(input: { programId: string; target: string; agentType?: string; runId?: string; action: (scope: ScopeMatch) => Promise<T> | T }): Promise<T> {
  const scope = assertInScope(input.programId, input.target, { agentType: input.agentType, runId: input.runId });
  return input.action(scope);
}

function programPublic(row: Row): Record<string, unknown> {
  return {
    id: String(row.id), platform: String(row.platform), programHandle: String(row.program_handle), scopeUrl: String(row.scope_url),
    inScopeAssets: parseJson(row.in_scope_assets_json, []), outOfScope: parseJson(row.out_of_scope_json, []),
    rateLimitPolicy: parseJson(row.rate_limit_policy_json, {}), authRequired: Number(row.auth_required) === 1,
    bountyRange: parseJson(row.bounty_range_json, {}), programTermsHash: String(row.program_terms_hash), active: Number(row.active) === 1,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function listBountyPrograms(): Array<Record<string, unknown>> {
  return missionDb.all<Row>('SELECT * FROM bounty_programs ORDER BY updated_at DESC, id').map(programPublic);
}

export function getBountyProgram(id: string): Record<string, unknown> | null {
  const row = missionDb.get<Row>('SELECT * FROM bounty_programs WHERE id = ?', [boundedString(id, 'programId', 200)]);
  return row ? programPublic(row) : null;
}

export function createBountyProgram(input: ProgramInput): Record<string, unknown> {
  const platform = boundedString(input.platform, 'platform', 80);
  const programHandle = boundedString(input.programHandle, 'programHandle', 200);
  const scopeUrl = boundedString(input.scopeUrl, 'scopeUrl', 2000);
  const termsHash = boundedString(input.programTermsHash, 'programTermsHash', 200);
  if (!/^[a-f0-9]{64}$/i.test(termsHash)) throw new BountySystemError('validation_error', 'programTermsHash must be a SHA-256 hex digest', 400);
  const id = missionId('bpr');
  const timestamp = nowIso();
  try {
    missionDb.run(
      `INSERT INTO bounty_programs (id,platform,program_handle,scope_url,in_scope_assets_json,out_of_scope_json,rate_limit_policy_json,auth_required,bounty_range_json,program_terms_hash,active,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, platform, programHandle, scopeUrl, JSON.stringify(stringList(input.inScopeAssets, 'inScopeAssets')), JSON.stringify(stringList(input.outOfScope, 'outOfScope')), objectJson(input.rateLimitPolicy, 'rateLimitPolicy'), input.authRequired === false ? 0 : 1, objectJson(input.bountyRange, 'bountyRange'), termsHash.toLowerCase(), input.active === true ? 1 : 0, timestamp, timestamp],
    );
  } catch (error) {
    if (/unique/i.test(error instanceof Error ? error.message : '')) throw new BountySystemError('program_exists', 'that program handle already exists', 409);
    throw error;
  }
  return getBountyProgram(id)!;
}

export function updateBountyProgram(id: string, patch: Partial<ProgramInput> & { active?: boolean }): Record<string, unknown> {
  const existing = missionDb.get<Row>('SELECT * FROM bounty_programs WHERE id = ?', [boundedString(id, 'programId', 200)]);
  if (!existing) throw new BountySystemError('not_found', 'program not found', 404);
  const termsHash = patch.programTermsHash ?? String(existing.program_terms_hash);
  if (!/^[a-f0-9]{64}$/i.test(termsHash)) throw new BountySystemError('validation_error', 'programTermsHash must be a SHA-256 hex digest', 400);
  const inScope = patch.inScopeAssets === undefined ? String(existing.in_scope_assets_json) : JSON.stringify(stringList(patch.inScopeAssets, 'inScopeAssets'));
  const outScope = patch.outOfScope === undefined ? String(existing.out_of_scope_json) : JSON.stringify(stringList(patch.outOfScope, 'outOfScope'));
  const rate = patch.rateLimitPolicy === undefined ? String(existing.rate_limit_policy_json) : objectJson(patch.rateLimitPolicy, 'rateLimitPolicy');
  const range = patch.bountyRange === undefined ? String(existing.bounty_range_json) : objectJson(patch.bountyRange, 'bountyRange');
  missionDb.run(
    `UPDATE bounty_programs SET platform=?,program_handle=?,scope_url=?,in_scope_assets_json=?,out_of_scope_json=?,rate_limit_policy_json=?,auth_required=?,bounty_range_json=?,program_terms_hash=?,active=?,updated_at=? WHERE id=?`,
    [patch.platform ? boundedString(patch.platform, 'platform', 80) : existing.platform, patch.programHandle ? boundedString(patch.programHandle, 'programHandle', 200) : existing.program_handle, patch.scopeUrl ? boundedString(patch.scopeUrl, 'scopeUrl', 2000) : existing.scope_url, inScope, outScope, rate, patch.authRequired === undefined ? existing.auth_required : patch.authRequired ? 1 : 0, range, termsHash.toLowerCase(), patch.active === undefined ? existing.active : patch.active ? 1 : 0, nowIso(), id],
  );
  return getBountyProgram(id)!;
}

export function deleteBountyProgram(id: string): void {
  const program = missionDb.get<Row>('SELECT id FROM bounty_programs WHERE id = ?', [boundedString(id, 'programId', 200)]);
  if (!program) throw new BountySystemError('not_found', 'program not found', 404);
  missionDb.run('DELETE FROM bounty_programs WHERE id = ?', [id]);
}

export function listScopeAllowlist(programId: string): Array<Record<string, unknown>> {
  boundedString(programId, 'programId', 200);
  return missionDb.all<Row>('SELECT * FROM scope_allowlist WHERE program_id = ? ORDER BY target', [programId]).map((row) => ({
    id: String(row.id), programId: String(row.program_id), target: String(row.target), targetType: String(row.target_type), inScope: Number(row.in_scope) === 1,
    authRequired: Number(row.auth_required) === 1, rateLimitPerMin: row.rate_limit_per_min == null ? null : Number(row.rate_limit_per_min),
    lastVerifiedAt: row.last_verified_at == null ? null : String(row.last_verified_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
}

export function upsertScopeAllowlist(programId: string, input: { target: string; targetType: 'domain' | 'repo' | 'package' | 'API'; inScope: boolean; authRequired?: boolean; rateLimitPerMin?: number | null; lastVerifiedAt?: string | null }): Record<string, unknown> {
  if (!missionDb.get('SELECT id FROM bounty_programs WHERE id = ?', [programId])) throw new BountySystemError('not_found', 'program not found', 404);
  if (!['domain', 'repo', 'package', 'API'].includes(input.targetType)) throw new BountySystemError('validation_error', 'targetType is invalid', 400);
  const target = normalizeTarget(input.target, input.targetType);
  const limitValue = input.rateLimitPerMin === null || input.rateLimitPerMin === undefined ? null : input.rateLimitPerMin;
  if (limitValue !== null && (!Number.isSafeInteger(limitValue) || limitValue < 1 || limitValue > 100000)) throw new BountySystemError('validation_error', 'rateLimitPerMin is invalid', 400);
  const existing = missionDb.get<Row>('SELECT id FROM scope_allowlist WHERE program_id=? AND target=?', [programId, target]);
  const id = existing ? String(existing.id) : missionId('sal');
  const at = input.lastVerifiedAt ? boundedString(input.lastVerifiedAt, 'lastVerifiedAt', 80) : null;
  if (existing) {
    missionDb.run('UPDATE scope_allowlist SET target_type=?,in_scope=?,auth_required=?,rate_limit_per_min=?,last_verified_at=?,updated_at=? WHERE id=?', [input.targetType, input.inScope ? 1 : 0, input.authRequired ? 1 : 0, limitValue, at, nowIso(), id]);
  } else {
    missionDb.run('INSERT INTO scope_allowlist (id,program_id,target,target_type,in_scope,auth_required,rate_limit_per_min,last_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [id, programId, target, input.targetType, input.inScope ? 1 : 0, input.authRequired ? 1 : 0, limitValue, at, nowIso(), nowIso()]);
  }
  return listScopeAllowlist(programId).find((row) => row.id === id)!;
}

export function removeScopeAllowlist(programId: string, id: string): void {
  const result = missionDb.run('DELETE FROM scope_allowlist WHERE id=? AND program_id=?', [id, programId]);
  if (!result.changes) throw new BountySystemError('not_found', 'scope entry not found', 404);
}

export function listAgentRegistry(): Array<Record<string, unknown>> {
  return missionDb.all<Row>('SELECT * FROM agent_registry WHERE active=1 ORDER BY type').map((row) => ({
    type: String(row.type), capabilityDescription: String(row.capability_description), inputSchema: parseJson(row.input_schema_json, {}), outputSchema: parseJson(row.output_schema_json, {}),
    requiredTools: parseJson(row.required_tools_json, []), maxConcurrency: Number(row.max_concurrency), rateLimitPerMin: Number(row.rate_limit_per_min), costBudgetCents: Number(row.cost_budget_cents), qualityGateRequired: Number(row.quality_gate_required) === 1,
  }));
}

function registryRow(agentType: string): Row {
  const row = missionDb.get<Row>('SELECT * FROM agent_registry WHERE type=? AND active=1', [agentType]);
  if (!row) throw new BountySystemError('agent_not_registered', 'agent type is not registered', 404);
  return row;
}

function objectInput(input: unknown): Record<string, any> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BountySystemError('malformed_input', 'agent input must be an object', 400);
  return input as Record<string, any>;
}

function safeText(value: unknown, name: string, max = 10000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /\u0000/.test(value)) throw new BountySystemError('malformed_input', `${name} is required`, 400);
  return value;
}

function lineEvidence(source: string, pattern: RegExp, max = 12): string[] {
  return source.split(/\r?\n/).map((line, index) => ({ line: index + 1, value: line.slice(0, 500) })).filter((row) => pattern.test(row.value)).slice(0, max).map((row) => `L${row.line}: ${row.value}`);
}

function codeAnalyst(input: Record<string, any>): Record<string, unknown> {
  const source = safeText(input.source, 'source', 500000);
  const files = Array.isArray(input.files) ? input.files.filter((item: unknown) => typeof item === 'string').slice(0, 200) : [];
  return {
    codeMap: [{ files: files.length || 1, languages: [...new Set((files.join(' ') + source).match(/\.(sol|rs|py|js|ts|go|c|cc|cpp)\b/gi)?.map((x) => x.slice(1).toLowerCase()) ?? [])], lines: source.split(/\r?\n/).length }],
    entryPoints: lineEvidence(source, /(export\s+(async\s+)?function|def\s+|fn\s+|func\s+|route|app\.(get|post|put|delete)|public\s+)/i),
    trustBoundaries: lineEvidence(source, /(authorization|authenticate|session|request|req\.|params|query|body|database|sql|exec\(|spawn\(|fetch\(|http)/i),
  };
}

function securityAuditor(input: Record<string, any>): Record<string, unknown> {
  const source = safeText(input.source, 'source', 500000);
  const patterns: Array<[string, RegExp, string]> = [
    ['injection', /(SELECT|INSERT|UPDATE|DELETE).*[+`]|exec\(|spawn\(|child_process|shell\s*:/i, 'Review untrusted input reaching a query or process sink.'],
    ['xss', /innerHTML|outerHTML|dangerouslySetInnerHTML|document\.write/i, 'Review output encoding and trusted-content boundaries.'],
    ['ssrf', /fetch\(|axios\.|request\(|http\.get\(/i, 'Review whether the URL is attacker-controlled and egress restricted.'],
    ['path_traversal', /path\.(join|resolve)\(|readFile|writeFile|unlink/i, 'Review path normalization and authorization before filesystem access.'],
    ['access_control', /isAdmin|role|permission|authorize|owner_id|requireOwner/i, 'Review authorization coverage and fail-closed behavior.'],
    ['unsafe_deserialization', /deserialize|unserialize|pickle\.loads|yaml\.load\s*\(/i, 'Review parser safety and untrusted object construction.'],
  ];
  const findings = patterns.flatMap(([kind, pattern, guidance]) => {
    const evidence = lineEvidence(source, pattern, 4);
    return evidence.length ? [{ vulnerabilityClass: kind, evidence, guidance, confidence: 'candidate-not-verified' }] : [];
  });
  return { findings };
}

function exploitValidator(input: Record<string, any>): Record<string, unknown> {
  const harness = objectInput(input.harness);
  if (harness.exfiltration === true || harness.destructive === true || harness.persistence === true || harness.externalTarget === true) throw new BountySystemError('unsafe_reproduction', 'reproduction contains a prohibited side effect', 403);
  const observed = safeText(input.observed, 'observed', 16000);
  const expected = safeText(input.expected, 'expected', 16000);
  return { reproducible: observed !== expected, steps: Array.isArray(harness.steps) ? harness.steps.filter((step: unknown) => typeof step === 'string').slice(0, 20) : [], evidence: observed.slice(0, 4000), observedVsExpected: { observed, expected }, safe: true };
}

function testEngineer(input: Record<string, any>): Record<string, unknown> {
  const source = safeText(input.source, 'source', 500000);
  const finding = objectInput(input.finding);
  const testName = String(finding.vulnerabilityClass ?? 'security_regression').replace(/[^a-z0-9_]+/gi, '_').toLowerCase().slice(0, 80) || 'security_regression';
  return { testFiles: [{ path: `security/${testName}.test.txt`, content: `# Owner-run regression test plan\n# Evidence: ${String(finding.evidence ?? '').slice(0, 500)}\nassert expected behavior after fix\n` }], commands: ['owner-run-local-test-harness'], expected: `The regression must demonstrate that ${testName} is no longer reachable without testing a live external target.`, sourceLines: source.split(/\r?\n/).length };
}

function researchAgent(input: Record<string, any>): Record<string, unknown> {
  const references = Array.isArray(input.references) ? input.references.filter((item: unknown) => item && typeof item === 'object').slice(0, 100) : [];
  return { references: references.map((item: any) => ({ title: String(item.title ?? '').slice(0, 300), url: String(item.url ?? '').slice(0, 1000), relevance: String(item.relevance ?? '').slice(0, 1000), ownerSupplied: true })), gaps: references.length ? [] : ['No owner-supplied reference was provided; no prior art is inferred.'] };
}

function bountyRules(input: Record<string, any>): Record<string, unknown> {
  const program = objectInput(input.program);
  const finding = objectInput(input.finding);
  const gaps: string[] = [];
  if (finding.target && program.inScopeAssets && !Array.isArray(program.inScopeAssets)) gaps.push('program scope assets malformed');
  if (!String(finding.evidence ?? '').trim()) gaps.push('evidence missing');
  if (!String(finding.reproduction ?? '').trim()) gaps.push('reproduction missing');
  if (!String(finding.cvssVector ?? '').startsWith('CVSS:3.1/')) gaps.push('CVSS v3.1 vector missing');
  return { compliant: gaps.length === 0, checks: [{ key: 'scope', result: gaps.includes('program scope assets malformed') ? 'fail' : 'requires_scope_gate' }, { key: 'evidence', result: finding.evidence ? 'pass' : 'fail' }, { key: 'reproduction', result: finding.reproduction ? 'pass' : 'fail' }, { key: 'cvss', result: finding.cvssVector ? 'pass' : 'fail' }], gaps };
}

function patchDeveloper(input: Record<string, any>): Record<string, unknown> {
  const source = safeText(input.source, 'source', 500000);
  const finding = objectInput(input.finding);
  const patch = objectInput(input.patch);
  if (patch.externalPush === true || patch.openPr === true) throw new BountySystemError('external_action_blocked', 'patch preparation cannot push or open a PR', 403);
  const diff = typeof patch.diff === 'string' ? patch.diff.slice(0, 100000) : `# Draft-only patch plan for ${String(finding.title ?? finding.vulnerabilityClass ?? 'finding')}\n# Source lines: ${source.split(/\r?\n/).length}\n`;
  return { diff, tests: Array.isArray(patch.tests) ? patch.tests.filter((test: unknown) => typeof test === 'string').slice(0, 20) : [], draftOnly: true, upstreamPr: false };
}

function codeReviewer(input: Record<string, any>): Record<string, unknown> {
  const diff = safeText(input.diff, 'diff', 100000);
  const tests = Array.isArray(input.tests) ? input.tests.filter((test: unknown) => typeof test === 'string') : [];
  const findings: string[] = [];
  if (/rm\s+-rf|curl\s+https?:|wget\s+https?:|git\s+push|openPr/i.test(diff)) findings.push('patch contains an external or destructive action');
  if (!tests.length) findings.push('regression test evidence is missing');
  return { approved: findings.length === 0, findings, coverage: tests.slice(0, 20) };
}

function reportWriter(input: Record<string, any>): Record<string, unknown> {
  const finding = objectInput(input.finding);
  const required = ['title', 'target', 'summary', 'evidence', 'reproduction', 'impact'];
  const missing = required.filter((key) => !String(finding[key] ?? '').trim());
  if (missing.length) throw new BountySystemError('report_incomplete', `report fields missing: ${missing.join(',')}`, 400);
  const report = { summary: String(finding.summary), affectedAsset: String(finding.target), severity: String(finding.severity ?? 'unverified'), cvss: { vector: String(finding.cvssVector ?? ''), score: finding.cvssScore ?? null, justification: String(finding.cvssJustification ?? '') }, reproduction: String(finding.reproduction), impact: String(finding.impact), evidence: String(finding.evidence), remediation: String(finding.remediation ?? 'Owner review required; no remediation is inferred.') };
  return { report, contentHash: sha256(JSON.stringify(report)) };
}

function browserMonitor(input: Record<string, any>): Record<string, unknown> {
  const observations = Array.isArray(input.observations) ? input.observations.filter((item: unknown) => item && typeof item === 'object').slice(0, 200) : [];
  return { feed: observations.map((item: any) => ({ platform: String(item.platform ?? ''), program: String(item.program ?? ''), target: String(item.target ?? ''), change: String(item.change ?? ''), source: String(item.source ?? ''), observedAt: String(item.observedAt ?? ''), autoSubmitted: false })), requiresOwnerReview: observations.length > 0 };
}

function gitAgent(input: Record<string, any>): Record<string, unknown> {
  const repo = safeText(input.repo, 'repo', 500);
  return { plan: { repository: repo, branch: String(input.branch ?? 'owner-review/security-fix'), commitMessage: String(input.commitMessage ?? 'Prepare owner-reviewed security fix'), pullRequest: 'draft-only' }, push: false, fork: false, upstreamSubmission: false };
}

function orchestrator(input: Record<string, any>): Record<string, unknown> {
  const stages = Array.isArray(input.stages) ? input.stages.slice(0, 20) : [];
  const pipeline = stages.map((stage: any, index: number) => ({ stage: String(stage.name ?? stage), state: index === 0 ? 'queued' : 'blocked-until-quality-gate', qualityGateRequired: true }));
  return { pipeline, blocked: pipeline.some((stage: any) => stage.state !== 'queued'), reason: 'Every transition requires explicit quality-gate evidence and human approval before submission.' };
}

function memoryKnowledgeBase(input: Record<string, any>): Record<string, unknown> {
  const operation = input.operation === 'lookup' ? 'lookup' : input.operation === 'store' ? 'store' : null;
  if (!operation) throw new BountySystemError('malformed_input', 'operation must be lookup or store', 400);
  const programId = safeText(input.programId, 'programId', 200);
  const target = safeText(input.target, 'target', 2048);
  if (operation === 'lookup') return { entries: missionDb.all<Row>('SELECT id,entry_type,finding_fingerprint,content_hash,content,created_at,updated_at FROM knowledge_base_entries WHERE program_id=? AND target=? ORDER BY updated_at DESC LIMIT 100', [programId, target]) };
  const entry = objectInput(input.entry);
  const content = safeText(entry.content, 'entry.content', 100000);
  const id = missionId('kb');
  missionDb.run('INSERT INTO knowledge_base_entries (id,program_id,target,entry_type,finding_fingerprint,content_hash,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [id, programId, target, String(entry.entryType ?? 'lesson'), entry.findingFingerprint ?? null, sha256(content), content, nowIso(), nowIso()]);
  return { written: true, id, contentHash: sha256(content) };
}

const REQUIRED_INPUTS: Record<string, string[]> = {
  code_analyst: ['source'], security_auditor: ['source'], exploit_validator: ['observed', 'expected', 'harness'], test_engineer: ['source', 'finding'],
  research_agent: ['references', 'technology'], bug_bounty_rules: ['program', 'finding'], patch_developer: ['source', 'finding', 'patch'], code_reviewer: ['source', 'diff', 'tests'],
  report_writer: ['finding', 'rules'], browser_monitor: ['observations'], git_agent: ['repo', 'patch'], orchestrator: ['finding', 'stages'], memory_knowledge_base: ['operation', 'programId', 'target'], quality_gate: ['finding'],
};

const HANDLERS: Record<string, (input: Record<string, any>) => Record<string, unknown>> = {
  code_analyst: codeAnalyst, security_auditor: securityAuditor, exploit_validator: exploitValidator, test_engineer: testEngineer,
  research_agent: researchAgent, bug_bounty_rules: bountyRules, patch_developer: patchDeveloper, code_reviewer: codeReviewer,
  report_writer: reportWriter, browser_monitor: browserMonitor, git_agent: gitAgent, orchestrator, memory_knowledge_base: memoryKnowledgeBase,
  quality_gate: (input) => qualityGateFinding({ programId: safeText(input.programId, 'programId', 200), target: safeText(input.target, 'target', 2048), finding: objectInput(input.finding) }),
};

export interface AgentRunInput { agentType: string; programId: string; target: string; input: Record<string, unknown>; ownerId?: string; findingId?: string; requestedCostCents?: number; availableTools?: string[] }

function recordStage(findingId: string | undefined, agentType: string, state: string, runId: string, detail?: string): void {
  if (!findingId || !missionDb.get('SELECT id FROM bounty_findings WHERE id=?', [findingId])) return;
  missionDb.run(`INSERT INTO bounty_run_stage_states (id,finding_id,stage,state,agent_type,run_id,detail,updated_at) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(finding_id,stage) DO UPDATE SET state=excluded.state,agent_type=excluded.agent_type,run_id=excluded.run_id,detail=excluded.detail,updated_at=excluded.updated_at`, [missionId('bst'), findingId, agentType, state, agentType, runId, detail ?? null, nowIso()]);
}

function updateRun(id: string, fields: { status: string; startAt?: string | null; endAt?: string | null; output?: unknown; error?: string | null; calls?: string[]; costCents?: number }): void {
  missionDb.run(`UPDATE agent_run_logs SET status=?,start_at=COALESCE(?,start_at),end_at=?,output_json=?,output_ref=?,error=?,tool_calls_json=?,cost_cents=?,updated_at=? WHERE id=?`, [fields.status, fields.startAt ?? null, fields.endAt ?? null, fields.output === undefined ? null : JSON.stringify(fields.output), fields.output === undefined ? null : sha256(JSON.stringify(fields.output)), fields.error ?? null, JSON.stringify(fields.calls ?? []), fields.costCents ?? 0, nowIso(), id]);
}

/** Queue → lease claim → safe local execution → terminal result. A target is
 * scope-checked before a handler is invoked, including handlers that only read
 * local source, so every agent type fails closed consistently. */
export function runBountyAgent(input: AgentRunInput): Record<string, unknown> {
  const registry = registryRow(input.agentType);
  const programId = boundedString(input.programId, 'programId', 200);
  const target = boundedString(input.target, 'target', 2048);
  if (!missionDb.get('SELECT id FROM bounty_programs WHERE id=?', [programId])) throw new BountySystemError('program_not_configured', 'program is not configured', 403);
  const runId = missionId('arl');
  const queuedAt = nowIso();
  const leaseExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  missionDb.run(`INSERT INTO agent_run_logs (id,agent_type,program_id,target,status,lease_expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [runId, input.agentType, programId, target, 'queued', leaseExpiresAt, queuedAt, queuedAt]);
  recordStage(input.findingId, input.agentType, 'queued', runId);
  try {
    assertInScope(programId, target, { agentType: input.agentType, runId });
    const policy = currentPolicy();
    if (policy.killSwitch) throw new BountySystemError('kill_switch_engaged', 'mission kill switch is engaged', 409);
    const activeRuns = Number(missionDb.get<Row>("SELECT COUNT(*) AS count FROM agent_run_logs WHERE agent_type=? AND status='running' AND lease_expires_at>?", [input.agentType, nowIso()])?.count ?? 0);
    if (activeRuns >= Number(registry.max_concurrency)) throw new BountySystemError('concurrency_cap', 'agent concurrency cap reached', 409);
    const rateWindow = new Date(Date.now() - 60 * 1000).toISOString();
    const recentRuns = Number(missionDb.get<Row>('SELECT COUNT(*) AS count FROM agent_run_logs WHERE agent_type=? AND created_at>?', [input.agentType, rateWindow])?.count ?? 0);
    if (recentRuns >= Number(registry.rate_limit_per_min)) throw new BountySystemError('rate_limit_exceeded', 'per-agent rate limit reached', 429);
    const requestedCost = input.requestedCostCents ?? 0;
    if (!Number.isSafeInteger(requestedCost) || requestedCost < 0 || requestedCost > Number(registry.cost_budget_cents)) throw new BountySystemError('spend_cap_exceeded', 'requested agent cost exceeds its configured cap', 409);
    if (requestedCost > 0) throw new BountySystemError('money_gate_blocked', 'no verified money operation is available to this read-only bounty runner', 409);
    const requiredTools = parseJson(registry.required_tools_json, []) as string[];
    const available = new Set(input.availableTools ?? requiredTools);
    const missing = requiredTools.filter((tool) => !available.has(tool));
    if (missing.length) throw new BountySystemError('missing_tool', `required tools unavailable: ${missing.join(',')}`, 409);
    const handler = HANDLERS[input.agentType];
    if (!handler) throw new BountySystemError('agent_handler_missing', 'registered agent has no safe handler', 500);
    const candidateInput = objectInput(input.input);
    const missingInputs = (REQUIRED_INPUTS[input.agentType] ?? []).filter((key) => candidateInput[key] === undefined || candidateInput[key] === null);
    if (missingInputs.length) throw new BountySystemError('malformed_input', `required input missing: ${missingInputs.join(',')}`, 422);
    const start = nowIso();
    const claimed = missionDb.run("UPDATE agent_run_logs SET status='running',start_at=?,updated_at=? WHERE id=? AND status='queued' AND lease_expires_at>?", [start, start, runId, start]);
    if (!claimed.changes) throw new BountySystemError('lease_claim_failed', 'agent run lease could not be claimed', 409);
    recordStage(input.findingId, input.agentType, 'running', runId);
    const output = handler({ ...candidateInput, programId, target });
    updateRun(runId, { status: 'done', endAt: nowIso(), output, calls: requiredTools, costCents: 0 });
    recordStage(input.findingId, input.agentType, 'done', runId);
    return { runId, status: 'done', agentType: input.agentType, target, output, outputRef: sha256(JSON.stringify(output)) };
  } catch (error) {
    const scope = error instanceof BountyScopeError;
    const code = error instanceof BountySystemError ? error.code : scope ? error.code : 'agent_failed';
    const terminalState = scope || code === 'kill_switch_engaged' || code === 'money_gate_blocked' ? 'blocked' : 'failed';
    updateRun(runId, { status: terminalState, endAt: nowIso(), error: code });
    recordStage(input.findingId, input.agentType, terminalState === 'blocked' ? 'blocked' : 'rejected', runId, code);
    if (scope) throw error;
    throw new BountySystemError(code, error instanceof Error ? error.message : code, error instanceof BountySystemError ? error.statusCode : 409);
  }
}

function requiredFinding(value: unknown): Record<string, any> {
  const finding = objectInput(value);
  for (const key of ['title', 'summary', 'evidence', 'vulnerabilityClass', 'codeLocationPattern']) safeText(finding[key], key, 30000);
  return finding;
}

export function findingFingerprint(programId: string, target: string, vulnerabilityClass: string, codeLocationPattern: string): string {
  return sha256([programId, normalizeTarget(target), vulnerabilityClass.trim().toLowerCase(), codeLocationPattern.trim().toLowerCase()].join('|'));
}

function parseCvssVector(vector: string): Record<string, string> {
  const value = safeText(vector, 'cvssVector', 300);
  if (!value.startsWith('CVSS:3.1/')) throw new BountySystemError('cvss_invalid', 'only CVSS:3.1 vectors are accepted', 400);
  const parts = Object.fromEntries(value.slice('CVSS:3.1/'.length).split('/').map((part) => part.split(':', 2))) as Record<string, string>;
  const required = ['AV', 'AC', 'PR', 'UI', 'S', 'C', 'I', 'A'];
  if (required.some((key) => !parts[key])) throw new BountySystemError('cvss_invalid', 'CVSS v3.1 base vector is incomplete', 400);
  return parts;
}

function roundUp(value: number): number { return Math.ceil(value * 10 - 1e-9) / 10; }

export function cvss31BaseScore(vector: string): number {
  const metrics = parseCvssVector(vector);
  const AV: Record<string, number> = { N: .85, A: .62, L: .55, P: .2 };
  const AC: Record<string, number> = { L: .77, H: .44 };
  const UI: Record<string, number> = { N: .85, R: .62 };
  const CIA: Record<string, number> = { N: 0, L: .22, H: .56 };
  if (AV[metrics.AV] === undefined || AC[metrics.AC] === undefined || UI[metrics.UI] === undefined || !['U', 'C'].includes(metrics.S) || CIA[metrics.C] === undefined || CIA[metrics.I] === undefined || CIA[metrics.A] === undefined) throw new BountySystemError('cvss_invalid', 'CVSS metric value is invalid', 400);
  const pr: Record<string, Record<string, number>> = { U: { N: .85, L: .62, H: .27 }, C: { N: .85, L: .68, H: .5 } };
  if (pr[metrics.S][metrics.PR] === undefined) throw new BountySystemError('cvss_invalid', 'CVSS privilege metric is invalid', 400);
  const iss = 1 - ((1 - CIA[metrics.C]) * (1 - CIA[metrics.I]) * (1 - CIA[metrics.A]));
  if (iss <= 0) return 0;
  const impact = metrics.S === 'U' ? 6.42 * iss : 7.52 * (iss - .029) - 3.25 * Math.pow(iss - .02, 15);
  const exploitability = 8.22 * AV[metrics.AV] * AC[metrics.AC] * pr[metrics.S][metrics.PR] * UI[metrics.UI];
  const rawScore = metrics.S === 'U' ? impact + exploitability : 1.08 * (impact + exploitability);
  return roundUp(Math.min(10, rawScore));
}

function recordRejectAndLearn(programId: string, target: string, fingerprint: string | null, reason: string, detail: Record<string, unknown>): void {
  const content = JSON.stringify({ reason, ...detail });
  missionDb.run('INSERT INTO knowledge_base_entries (id,program_id,target,entry_type,finding_fingerprint,content_hash,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [missionId('kbl'), programId, target, 'lesson', fingerprint, sha256(content), content, nowIso(), nowIso()]);
}

export function qualityGateFinding(input: { programId: string; target: string; finding: Record<string, any> }): Record<string, unknown> {
  const scope = assertInScope(input.programId, input.target, { agentType: 'quality_gate' });
  const finding = requiredFinding(input.finding);
  const fingerprint = findingFingerprint(input.programId, input.target, String(finding.vulnerabilityClass), String(finding.codeLocationPattern));
  const duplicate = missionDb.get<Row>('SELECT id FROM bounty_findings WHERE finding_fingerprint=? AND state NOT IN (\'rejected\',\'duplicate\')', [fingerprint]) || missionDb.get<Row>('SELECT id FROM knowledge_base_entries WHERE finding_fingerprint=?', [fingerprint]);
  const checks: Record<string, string> = { inScope: 'pass', evidence: String(finding.evidence).trim() ? 'pass' : 'fail', reproduction: String(finding.reproduction ?? '').trim() ? 'pass' : 'fail', duplicate: duplicate ? 'fail' : 'pass' };
  let cvssScore: number | null = null;
  try { cvssScore = finding.cvssVector ? cvss31BaseScore(String(finding.cvssVector)) : null; checks.cvss = cvssScore === null ? 'fail' : 'pass'; } catch { checks.cvss = 'fail'; }
  const reasons = Object.entries(checks).filter(([, result]) => result !== 'pass').map(([key]) => key);
  const decision = reasons.length ? 'reject' : 'pass';
  return { decision, reasons, checks, fingerprint, cvssScore, scope: { targetType: scope.targetType }, duplicateId: duplicate ? String(duplicate.id) : null };
}

export function createBountyFinding(input: { programId: string; target: string; finding: Record<string, any> }): Record<string, unknown> {
  const finding = requiredFinding(input.finding);
  const gate = qualityGateFinding(input);
  if (gate.decision === 'reject') {
    recordRejectAndLearn(input.programId, input.target, String(gate.fingerprint), 'quality_gate_rejected', { reasons: gate.reasons, checks: gate.checks });
    throw new BountySystemError('quality_gate_rejected', `finding rejected: ${(gate.reasons as string[]).join(', ')}`, 409);
  }
  const id = missionId('bfi');
  const timestamp = nowIso();
  const score = gate.cvssScore as number | null;
  missionDb.run(`INSERT INTO bounty_findings (id,program_id,target,vulnerability_class,code_location_pattern,finding_fingerprint,title,summary,evidence,reproduction,impact,severity,cvss_vector,cvss_score,cvss_justification,state,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, input.programId, input.target, String(finding.vulnerabilityClass), String(finding.codeLocationPattern), String(gate.fingerprint), String(finding.title), String(finding.summary), String(finding.evidence), finding.reproduction ?? null, finding.impact ?? null, finding.severity ?? null, finding.cvssVector ?? null, score, finding.cvssJustification ?? null, 'gated', timestamp, timestamp]);
  missionDb.run('INSERT INTO quality_gate_reviews (id,finding_id,decision,reasons_json,checks_json,reviewer,created_at) VALUES (?,?,?,?,?,?,?)', [missionId('qgr'), id, 'pass', '[]', JSON.stringify(gate.checks), 'quality_gate', timestamp]);
  return missionDb.get<Row>('SELECT * FROM bounty_findings WHERE id=?', [id])!;
}

function ownerIsActive(ownerId: string): boolean { return Boolean(missionDb.get<Row>("SELECT id FROM mission_owner WHERE id=? AND role='owner' AND status='active'", [ownerId])); }

export function approveFindingForSubmission(ownerId: string, findingId: string, reportContent: Record<string, unknown>): Record<string, unknown> {
  if (!ownerIsActive(ownerId)) throw new BountySystemError('owner_required', 'active owner is required', 403);
  const finding = missionDb.get<Row>('SELECT * FROM bounty_findings WHERE id=?', [findingId]);
  if (!finding) throw new BountySystemError('not_found', 'finding not found', 404);
  const review = missionDb.get<Row>('SELECT decision FROM quality_gate_reviews WHERE finding_id=? ORDER BY created_at DESC LIMIT 1', [findingId]);
  if (String(review?.decision) !== 'pass' || String(finding.state) !== 'gated') throw new BountySystemError('quality_gate_required', 'only a quality-gated finding can be approved', 409);
  if (missionDb.get<Row>('SELECT id FROM bounty_submissions WHERE finding_id=?', [findingId])) throw new BountySystemError('already_approved', 'finding already has an immutable submission approval log', 409);
  const reportJson = objectJson(reportContent, 'reportContent');
  const contentHash = sha256(reportJson);
  const timestamp = nowIso();
  missionDb.transaction(() => {
    missionDb.run("UPDATE bounty_findings SET state='approved',approved_by=?,approved_at=?,report_json=?,updated_at=? WHERE id=?", [ownerId, timestamp, reportJson, timestamp, findingId]);
    missionDb.run('INSERT INTO bounty_submissions (id,finding_id,approved_by,approved_at,report_content_hash,outcome,created_at) VALUES (?,?,?,?,?,\'pending\',?)', [missionId('bsub'), findingId, ownerId, timestamp, contentHash, timestamp]);
  });
  return { findingId, approved: true, submitted: false, reportContentHash: contentHash, note: 'Human approval recorded. No external submission was performed.' };
}

export function rejectFinding(ownerId: string, findingId: string, reason: string): Record<string, unknown> {
  if (!ownerIsActive(ownerId)) throw new BountySystemError('owner_required', 'active owner is required', 403);
  const note = boundedString(reason, 'reason', 2000);
  const finding = missionDb.get<Row>('SELECT id,program_id,target,finding_fingerprint FROM bounty_findings WHERE id=?', [findingId]);
  if (!finding) throw new BountySystemError('not_found', 'finding not found', 404);
  missionDb.transaction(() => {
    const timestamp = nowIso();
    missionDb.run("UPDATE bounty_findings SET state='rejected',updated_at=? WHERE id=?", [timestamp, findingId]);
    missionDb.run('INSERT INTO quality_gate_reviews (id,finding_id,decision,reasons_json,checks_json,reviewer,created_at) VALUES (?,?,?,?,?,?,?)', [missionId('qgr'), findingId, 'reject', JSON.stringify([note]), '{}', ownerId, timestamp]);
    recordRejectAndLearn(String(finding.program_id), String(finding.target), String(finding.finding_fingerprint), 'owner_rejected', { findingId, ownerId, rejectedAt: timestamp });
  });
  return { findingId, rejected: true, reason: note, submitted: false };
}

export function bountyFindingSnapshot(findingId?: string): Array<Record<string, unknown>> {
  const rows = findingId ? missionDb.all<Row>('SELECT * FROM bounty_findings WHERE id=?', [findingId]) : missionDb.all<Row>('SELECT * FROM bounty_findings ORDER BY updated_at DESC LIMIT 200');
  return rows.map((row) => ({ ...row, report_json: parseJson(row.report_json, null) }));
}

export function bountyStageSnapshot(findingId: string): Array<Record<string, unknown>> { return missionDb.all<Row>('SELECT * FROM bounty_run_stage_states WHERE finding_id=? ORDER BY updated_at,stage', [findingId]); }
export function bountySubmissionSnapshot(): Array<Record<string, unknown>> { return missionDb.all<Row>('SELECT * FROM bounty_submissions ORDER BY created_at DESC LIMIT 200'); }
export function scopeEventSnapshot(programId?: string): Array<Record<string, unknown>> { return programId ? missionDb.all<Row>('SELECT * FROM scope_gate_events WHERE program_id=? ORDER BY created_at DESC LIMIT 200', [programId]) : missionDb.all<Row>('SELECT * FROM scope_gate_events ORDER BY created_at DESC LIMIT 200'); }
