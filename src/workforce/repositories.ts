import { db, type SqlValue } from '../db/database';
import { createId } from '../db/id';

/**
 * Workforce persistence — source health, deliveries, comms, workflow health,
 * and the per-agent multi-category overlay. Owner-only tables; no user-billing
 * joins anywhere in this file.
 */

const NOW = (): string => new Date().toISOString();

// ── Source health (risk / earnings protection) ─────────────────────────────

export interface SourceHealthRow {
  source_key: string;
  domain: string;
  category: string;
  status: string;
  consecutive_failures: number;
  total_successes: number;
  total_failures: number;
  last_error: string | null;
  last_seen_at: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  updated_at: string;
}

export function sourceKeyFor(domain: string, category: string): string {
  return `${domain.toLowerCase()}|${category}`;
}

export function getSourceHealth(key: string): SourceHealthRow | undefined {
  return db.get<SourceHealthRow>('SELECT * FROM economy_source_health WHERE source_key = ?', [key]);
}

export function listSourceHealth(status?: string, limit = 200): SourceHealthRow[] {
  return status
    ? db.all<SourceHealthRow>('SELECT * FROM economy_source_health WHERE status = ? ORDER BY updated_at DESC LIMIT ?', [status, limit])
    : db.all<SourceHealthRow>('SELECT * FROM economy_source_health ORDER BY updated_at DESC LIMIT ?', [limit]);
}

export function recordSourceOutcome(input: {
  domain: string; category: string; ok: boolean; error?: string | null;
  blockAfterFailures?: number;
}): SourceHealthRow {
  const key = sourceKeyFor(input.domain, input.category);
  const existing = getSourceHealth(key);
  if (!existing) {
    db.run(
      `INSERT INTO economy_source_health (source_key, domain, category, status, consecutive_failures, total_successes, total_failures, last_error, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [key, input.domain.toLowerCase(), input.category, input.ok ? 'active' : 'active',
        input.ok ? 0 : 1, input.ok ? 1 : 0, input.ok ? 0 : 1, input.error ?? null, NOW()],
    );
    return getSourceHealth(key)!;
  }
  const failures = input.ok ? 0 : existing.consecutive_failures + 1;
  const threshold = input.blockAfterFailures ?? 3;
  const shouldBlock = !input.ok && failures >= threshold && existing.status === 'active';
  db.run(
    `UPDATE economy_source_health SET consecutive_failures = ?, total_successes = total_successes + ?,
      total_failures = total_failures + ?, last_error = ?, last_seen_at = ?,
      status = ?, blocked_at = ?, blocked_reason = ?, updated_at = ? WHERE source_key = ?`,
    [failures, input.ok ? 1 : 0, input.ok ? 0 : 1, input.error ?? existing.last_error, NOW(),
      shouldBlock ? 'unreliable' : existing.status,
      shouldBlock ? NOW() : existing.blocked_at,
      shouldBlock ? `auto-blocked after ${failures} consecutive failures: ${(input.error ?? 'unknown').slice(0, 200)}` : existing.blocked_reason,
      NOW(), key],
  );
  return getSourceHealth(key)!;
}

export function setSourceStatus(key: string, status: 'active' | 'unavailable' | 'restricted' | 'unreliable' | 'blocked', reason?: string | null): void {
  db.run(
    `UPDATE economy_source_health SET status = ?, blocked_at = CASE WHEN ? IN ('unavailable','restricted','unreliable','blocked') THEN COALESCE(blocked_at, ?) ELSE NULL END,
      blocked_reason = ?, updated_at = ? WHERE source_key = ?`,
    [status, status, NOW(), reason ?? null, NOW(), key],
  );
}

export function isSourceUsable(key: string): boolean {
  const row = getSourceHealth(key);
  return !row || row.status === 'active';
}

// ── Deliveries (proof of completed work) ───────────────────────────────────

export interface DeliveryRow {
  id: string;
  execution_id: string;
  opportunity_id: string;
  agent_slug: string;
  kind: string;
  title: string;
  evidence: string;
  external_ref: string | null;
  verified: number;
  delivered_at: string;
}

export function insertDelivery(input: {
  executionId: string; opportunityId: string; agentSlug: string;
  kind?: string; title: string; evidence: string; externalRef?: string | null; verified?: boolean;
}): DeliveryRow {
  const id = createId('eco_dlv');
  db.run(
    `INSERT INTO economy_deliveries (id, execution_id, opportunity_id, agent_slug, kind, title, evidence, external_ref, verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.executionId, input.opportunityId, input.agentSlug, input.kind ?? 'work_product',
      input.title.slice(0, 300), input.evidence.slice(0, 8000), input.externalRef ?? null, input.verified ? 1 : 0],
  );
  return db.get<DeliveryRow>('SELECT * FROM economy_deliveries WHERE id = ?', [id])!;
}

export function listDeliveries(filter: { executionId?: string; opportunityId?: string; agentSlug?: string; limit?: number } = {}): DeliveryRow[] {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  if (filter.executionId) return db.all<DeliveryRow>('SELECT * FROM economy_deliveries WHERE execution_id = ? ORDER BY delivered_at DESC LIMIT ?', [filter.executionId, limit]);
  if (filter.opportunityId) return db.all<DeliveryRow>('SELECT * FROM economy_deliveries WHERE opportunity_id = ? ORDER BY delivered_at DESC LIMIT ?', [filter.opportunityId, limit]);
  if (filter.agentSlug) return db.all<DeliveryRow>('SELECT * FROM economy_deliveries WHERE agent_slug = ? ORDER BY delivered_at DESC LIMIT ?', [filter.agentSlug, limit]);
  return db.all<DeliveryRow>('SELECT * FROM economy_deliveries ORDER BY delivered_at DESC LIMIT ?', [limit]);
}

// ── Customer communications (consented, template-bound, approved) ──────────

export interface CommRow {
  id: string;
  execution_id: string | null;
  opportunity_id: string | null;
  agent_slug: string;
  channel: string;
  recipient_masked: string;
  template: string;
  content_preview: string;
  consent_basis: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  provider_ref: string | null;
  error_message: string | null;
  created_at: string;
}

export function maskRecipient(channel: string, value: string): string {
  const v = value.trim();
  if (channel === 'email' && v.includes('@')) {
    const [local, domain] = v.split('@');
    return `${(local[0] ?? '*')}***@${domain}`;
  }
  if (v.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, v.length - 4))}${v.slice(-4)}`;
}

export function insertComm(input: {
  executionId?: string | null; opportunityId?: string | null; agentSlug: string;
  channel: string; recipientMasked: string; template: string; contentPreview: string; consentBasis: string;
}): CommRow {
  const id = createId('eco_com');
  db.run(
    `INSERT INTO economy_comms (id, execution_id, opportunity_id, agent_slug, channel, recipient_masked, template, content_preview, consent_basis)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.executionId ?? null, input.opportunityId ?? null, input.agentSlug, input.channel,
      input.recipientMasked.slice(0, 160), input.template.slice(0, 120), input.contentPreview.slice(0, 500), input.consentBasis.slice(0, 500)],
  );
  return db.get<CommRow>('SELECT * FROM economy_comms WHERE id = ?', [id])!;
}

export function getComm(id: string): CommRow | undefined {
  return db.get<CommRow>('SELECT * FROM economy_comms WHERE id = ?', [id]);
}

export function listComms(status?: string, limit = 100): CommRow[] {
  return status
    ? db.all<CommRow>('SELECT * FROM economy_comms WHERE status = ? ORDER BY created_at DESC LIMIT ?', [status, limit])
    : db.all<CommRow>('SELECT * FROM economy_comms ORDER BY created_at DESC LIMIT ?', [limit]);
}

export function updateComm(id: string, patch: Partial<Record<keyof CommRow, SqlValue>>): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  db.run(`UPDATE economy_comms SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`,
    [...fields.map((f) => patch[f as keyof CommRow] as SqlValue), id]);
}

// ── Workflow health (monitor + replace failed workflows) ───────────────────

export interface WorkflowRow {
  agent_slug: string;
  category: string;
  workflow_key: string;
  status: string;
  failure_count: number;
  success_count: number;
  last_error: string | null;
  replaced_by: string | null;
  updated_at: string;
}

export function recordWorkflowOutcome(input: {
  agentSlug: string; category: string; workflowKey: string; ok: boolean; error?: string | null; failAfter?: number;
}): WorkflowRow {
  const existing = db.get<WorkflowRow>(
    'SELECT * FROM economy_workflows WHERE agent_slug = ? AND category = ? AND workflow_key = ?',
    [input.agentSlug, input.category, input.workflowKey],
  );
  if (!existing) {
    db.run(
      `INSERT INTO economy_workflows (agent_slug, category, workflow_key, status, failure_count, success_count, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [input.agentSlug, input.category, input.workflowKey, input.ok ? 'active' : 'active',
        input.ok ? 0 : 1, input.ok ? 1 : 0, input.error ?? null],
    );
  } else {
    const failures = input.ok ? 0 : existing.failure_count + 1;
    const threshold = input.failAfter ?? 3;
    const failed = !input.ok && failures >= threshold && existing.status === 'active';
    db.run(
      `UPDATE economy_workflows SET failure_count = ?, success_count = success_count + ?, last_error = ?, status = ?, updated_at = ? WHERE agent_slug = ? AND category = ? AND workflow_key = ?`,
      [failures, input.ok ? 1 : 0, input.error ?? existing.last_error, failed ? 'failed' : existing.status, NOW(), input.agentSlug, input.category, input.workflowKey],
    );
  }
  return db.get<WorkflowRow>(
    'SELECT * FROM economy_workflows WHERE agent_slug = ? AND category = ? AND workflow_key = ?',
    [input.agentSlug, input.category, input.workflowKey],
  )!;
}

export function listWorkflows(status?: string, limit = 200): WorkflowRow[] {
  return status
    ? db.all<WorkflowRow>('SELECT * FROM economy_workflows WHERE status = ? ORDER BY updated_at DESC LIMIT ?', [status, limit])
    : db.all<WorkflowRow>('SELECT * FROM economy_workflows ORDER BY updated_at DESC LIMIT ?', [limit]);
}

export function setWorkflowStatus(agentSlug: string, category: string, workflowKey: string, status: 'active' | 'failed' | 'replaced' | 'retired', replacedBy?: string | null): void {
  db.run(
    'UPDATE economy_workflows SET status = ?, failure_count = CASE WHEN ? = \'active\' THEN 0 ELSE failure_count END, replaced_by = COALESCE(?, replaced_by), updated_at = ? WHERE agent_slug = ? AND category = ? AND workflow_key = ?',
    [status, status, replacedBy ?? null, NOW(), agentSlug, category, workflowKey],
  );
}

export function isWorkflowUsable(agentSlug: string, category: string, workflowKey: string): boolean {
  const row = db.get<WorkflowRow>(
    'SELECT * FROM economy_workflows WHERE agent_slug = ? AND category = ? AND workflow_key = ?',
    [agentSlug, category, workflowKey],
  );
  return !row || row.status === 'active';
}

// ── Agent overlay: multi-category eligibility ──────────────────────────────

export function setAgentOverlay(agentSlug: string, input: { capabilities?: string[]; categories?: string[]; touchActive?: boolean }): void {
  const sets: string[] = [];
  const params: SqlValue[] = [];
  if (input.capabilities) { sets.push('capabilities_json = ?'); params.push(JSON.stringify(input.capabilities.slice(0, 100))); }
  if (input.categories) { sets.push('categories_json = ?'); params.push(JSON.stringify(input.categories.slice(0, 60))); }
  if (input.touchActive) { sets.push('last_active_at = ?'); params.push(NOW()); }
  if (sets.length === 0) return;
  db.run(`UPDATE economy_agent_profiles SET ${sets.join(', ')} WHERE agent_slug = ?`, [...params, agentSlug]);
}

export function getAgentOverlay(agentSlug: string): { capabilities: string[]; categories: string[] } {
  const row = db.get<{ capabilities_json: string; categories_json: string }>(
    'SELECT capabilities_json, categories_json FROM economy_agent_profiles WHERE agent_slug = ?', [agentSlug],
  );
  const parse = (raw: string | undefined): string[] => {
    try {
      const v = JSON.parse(raw ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch { return []; }
  };
  return { capabilities: parse(row?.capabilities_json), categories: parse(row?.categories_json) };
}
