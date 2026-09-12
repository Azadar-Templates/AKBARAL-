import { db, type SqlValue } from './database';
import { createId } from './id';

/**
 * ZA141251SA agent-economy persistence.
 *
 * ISOLATION CONTRACT (enforced here, not just documented):
 *   - This file NEVER queries users, credit_accounts, billing tables or any
 *     user-owned data. The economy's ledger, revenue and treasury state are
 *     entirely separate tables; user funds and agent operating budget cannot
 *     mix at the query level.
 *   - The 4,001-agent registry is read-only here (agent_slug references).
 */

const NOW = (): string => new Date().toISOString();

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy (singleton row)
// ─────────────────────────────────────────────────────────────────────────────

export interface EconomyPolicyRow {
  autonomous_enabled: number;
  kill_switch: number;
  discovery_enabled: number;
  max_concurrent_executions: number;
  max_daily_spend_cents: number;
  max_opportunity_cost_cents: number;
  min_expected_net_cents: number;
  min_roi: number;
  settlement_threshold_cents: number;
  settlement_destination: string;
  max_economy_agents: number;
  economy_model_key: string | null;
  discovery_categories_json: string;
}

export function getEconomyPolicy(): EconomyPolicyRow {
  const row = db.get<EconomyPolicyRow>("SELECT * FROM economy_policy WHERE id = 'global'");
  if (!row) {
    db.run("INSERT OR IGNORE INTO economy_policy (id) VALUES ('global')");
    return db.get<EconomyPolicyRow>("SELECT * FROM economy_policy WHERE id = 'global'")!;
  }
  return row;
}

export function updateEconomyPolicy(patch: Partial<Omit<EconomyPolicyRow, 'discovery_categories_json'>> & { discovery_categories_json?: string }): EconomyPolicyRow {
  const fields = Object.keys(patch).filter((key) => key !== 'id');
  for (const field of fields) {
    db.run(`UPDATE economy_policy SET ${field} = ?, updated_at = ? WHERE id = 'global'`, [
      patch[field as keyof typeof patch] as SqlValue,
      NOW(),
    ]);
  }
  return getEconomyPolicy();
}

// ─────────────────────────────────────────────────────────────────────────────
// Events (audit chronology — feeds the daily report)
// ─────────────────────────────────────────────────────────────────────────────

export interface EconomyEventRow {
  id: string;
  ts: string;
  kind: string;
  actor: string;
  summary: string;
  details_json: string | null;
}

export function recordEconomyEvent(input: { kind: string; actor?: string; summary: string; details?: Record<string, unknown> | null }): { id: string; ts: string } {
  const id = createId('eco_evt');
  const ts = NOW();
  db.run(
    'INSERT INTO economy_events (id, ts, kind, actor, summary, details_json) VALUES (?, ?, ?, ?, ?, ?)',
    [id, ts, input.kind, input.actor ?? 'system', input.summary, input.details ? JSON.stringify(input.details) : null],
  );
  return { id, ts };
}

export function listEconomyEvents(limit = 100, sinceIso?: string): EconomyEventRow[] {
  return sinceIso
    ? db.all<EconomyEventRow>('SELECT * FROM economy_events WHERE ts >= ? ORDER BY ts DESC LIMIT ?', [sinceIso, limit])
    : db.all<EconomyEventRow>('SELECT * FROM economy_events ORDER BY ts DESC LIMIT ?', [limit]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Opportunities
// ─────────────────────────────────────────────────────────────────────────────

export interface OpportunityRow {
  id: string;
  source_url_hash: string;
  source_url: string;
  category: string;
  title: string;
  summary: string | null;
  expected_revenue_cents: number;
  expected_cost_cents: number;
  time_hours: number;
  risk_level: string;
  platform_rules: string | null;
  probability: number;
  expected_net_cents: number;
  roi: number | null;
  estimate_basis: string;
  status: string;
  policy_decision_json: string | null;
  evidence_json: string | null;
  discovered_at: string;
  evaluated_at: string | null;
  updated_at: string;
}

export function insertOpportunity(input: {
  sourceUrlHash: string;
  sourceUrl: string;
  category: string;
  title: string;
  summary?: string | null;
  expectedRevenueCents: number;
  expectedCostCents: number;
  timeHours: number;
  riskLevel: string;
  probability: number;
  platformRules?: string | null;
  estimateBasis?: string;
}): { id: string; duplicate: boolean } {
  const existing = db.get<{ id: string }>('SELECT id FROM economy_opportunities WHERE source_url_hash = ?', [input.sourceUrlHash]);
  if (existing) return { id: existing.id, duplicate: true };
  const id = createId('eco_opp');
  db.run(
    `INSERT INTO economy_opportunities
       (id, source_url_hash, source_url, category, title, summary, expected_revenue_cents, expected_cost_cents,
        time_hours, risk_level, platform_rules, probability, estimate_basis, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered')`,
    [id, input.sourceUrlHash, input.sourceUrl, input.category, input.title, input.summary ?? null,
      input.expectedRevenueCents, input.expectedCostCents, input.timeHours, input.riskLevel,
      input.platformRules ?? null, input.probability, input.estimateBasis ?? 'category_default'],
  );
  return { id, duplicate: false };
}

export function getOpportunity(id: string): OpportunityRow | undefined {
  return db.get<OpportunityRow>('SELECT * FROM economy_opportunities WHERE id = ?', [id]);
}

export function listOpportunities(status?: string, limit = 50): OpportunityRow[] {
  return status
    ? db.all<OpportunityRow>('SELECT * FROM economy_opportunities WHERE status = ? ORDER BY discovered_at DESC LIMIT ?', [status, limit])
    : db.all<OpportunityRow>('SELECT * FROM economy_opportunities ORDER BY discovered_at DESC LIMIT ?', [limit]);
}

export function updateOpportunity(id: string, patch: Partial<Record<keyof OpportunityRow, SqlValue>>): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const assignments = fields.map((field) => `${field} = ?`).join(', ');
  db.run(
    `UPDATE economy_opportunities SET ${assignments}, updated_at = ? WHERE id = ?`,
    [...fields.map((f) => patch[f as keyof OpportunityRow] as SqlValue), NOW(), id],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Executions (durable, idempotent)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionRow {
  id: string;
  opportunity_id: string;
  agent_slug: string;
  idempotency_key: string;
  status: string;
  attempts: number;
  max_attempts: number;
  started_at: string | null;
  timeout_at: string | null;
  completed_at: string | null;
  result_json: string | null;
  verification_json: string | null;
  error_message: string | null;
  cost_cents: number;
}

export function insertExecution(input: { opportunityId: string; agentSlug: string; timeoutMs: number; maxAttempts?: number }): { id: string; created: boolean } {
  const key = `opp:${input.opportunityId}:live`;
  const existing = db.get<ExecutionRow>('SELECT * FROM economy_executions WHERE idempotency_key = ?', [key]);
  if (existing && !['completed', 'failed', 'cancelled', 'timed_out'].includes(existing.status)) {
    return { id: existing.id, created: false };
  }
  // A settled execution may be retried by bumping the round inside the key.
  const round = existing ? Number(existing.idempotency_key.split('#')[1] || 0) + 1 : 0;
  const id = createId('eco_exe');
  db.run(
    `INSERT INTO economy_executions (id, opportunity_id, agent_slug, idempotency_key, status, attempts, max_attempts, timeout_at)
     VALUES (?, ?, ?, ?, 'authorized', 0, ?, ?)`,
    [id, input.opportunityId, input.agentSlug, `opp:${input.opportunityId}:live#${round}`, input.maxAttempts ?? 2,
      new Date(Date.now() + input.timeoutMs).toISOString()],
  );
  return { id, created: true };
}

export function getExecution(id: string): ExecutionRow | undefined {
  return db.get<ExecutionRow>('SELECT * FROM economy_executions WHERE id = ?', [id]);
}

export function getLiveExecutionForOpportunity(opportunityId: string): ExecutionRow | undefined {
  // Cross-engine safe ordering: no rowid (PG has none) — pick the newest
  // live row deterministically in JS.
  const rows = db.all<ExecutionRow>(
    "SELECT * FROM economy_executions WHERE opportunity_id = ? AND status IN ('authorized','running')",
    [opportunityId],
  );
  return rows.sort((a, b) => String(b.started_at ?? b.timeout_at ?? '').localeCompare(String(a.started_at ?? a.timeout_at ?? '')))[0];
}

export function updateExecution(id: string, patch: Partial<Record<keyof ExecutionRow, SqlValue>>): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const assignments = fields.map((field) => `${field} = ?`).join(', ');
  db.run(`UPDATE economy_executions SET ${assignments} WHERE id = ?`, [
    ...fields.map((f) => patch[f as keyof ExecutionRow] as SqlValue), id,
  ]);
}

export function listExecutions(status?: string, limit = 50): ExecutionRow[] {
  return status
    ? db.all<ExecutionRow>('SELECT * FROM economy_executions WHERE status = ? ORDER BY started_at DESC LIMIT ?', [status, limit])
    : db.all<ExecutionRow>('SELECT * FROM economy_executions ORDER BY started_at DESC LIMIT ?', [limit]);
}

export function listStaleExecutions(nowIso: string): ExecutionRow[] {
  return db.all<ExecutionRow>(
    "SELECT * FROM economy_executions WHERE status IN ('authorized','running') AND timeout_at IS NOT NULL AND timeout_at < ?",
    [nowIso],
  );
}

export function countActiveExecutions(): number {
  const row = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM economy_executions WHERE status IN ('authorized','running')");
  return row ? Number(row.n) : 0;
}

export function insertExecutionParticipant(input: { executionId: string; agentSlug: string; role: string; costShareCents: number }): void {
  db.run(
    'INSERT INTO economy_execution_participants (id, execution_id, agent_slug, role, cost_share_cents) VALUES (?, ?, ?, ?, ?)',
    [createId('eco_par'), input.executionId, input.agentSlug, input.role, input.costShareCents],
  );
}

export function listExecutionParticipants(executionId: string): Array<{ agent_slug: string; role: string; cost_share_cents: number }> {
  return db.all('SELECT agent_slug, role, cost_share_cents FROM economy_execution_participants WHERE execution_id = ?', [executionId]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Revenue lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export interface RevenueRow {
  id: string;
  opportunity_id: string | null;
  state: string;
  amount_cents: number;
  currency: string;
  evidence: string | null;
  external_ref: string | null;
  created_at: string;
  received_at: string | null;
  settled_at: string | null;
}

export function insertRevenue(input: { opportunityId?: string | null; state: string; amountCents: number; evidence?: string | null; externalRef?: string | null }): RevenueRow {
  const id = createId('eco_rev');
  db.run(
    "INSERT INTO economy_revenue (id, opportunity_id, state, amount_cents, evidence, external_ref) VALUES (?, ?, ?, ?, ?, ?)",
    [id, input.opportunityId ?? null, input.state, input.amountCents, input.evidence ?? null, input.externalRef ?? null],
  );
  return getRevenue(id)!;
}

export function getRevenue(id: string): RevenueRow | undefined {
  return db.get<RevenueRow>('SELECT * FROM economy_revenue WHERE id = ?', [id]);
}

export function listRevenue(state?: string, limit = 100): RevenueRow[] {
  return state
    ? db.all<RevenueRow>('SELECT * FROM economy_revenue WHERE state = ? ORDER BY created_at DESC LIMIT ?', [state, limit])
    : db.all<RevenueRow>('SELECT * FROM economy_revenue ORDER BY created_at DESC LIMIT ?', [limit]);
}

export function updateRevenue(id: string, patch: Partial<Record<keyof RevenueRow, SqlValue>>): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const assignments = fields.map((field) => `${field} = ?`).join(', ');
  db.run(`UPDATE economy_revenue SET ${assignments}, updated_at = ? WHERE id = ?`, [
    ...fields.map((f) => patch[f as keyof RevenueRow] as SqlValue), NOW(), id,
  ]);
}

export function revenueTotals(): { realizedCents: number; pendingCents: number; expectedCents: number } {
  const rows = db.all<{ state: string; total: number }>(
    "SELECT state, SUM(amount_cents) AS total FROM economy_revenue WHERE state IN ('received','settled','pending','expected') GROUP BY state",
  );
  const map = new Map(rows.map((r) => [r.state, Number(r.total)]));
  return {
    realizedCents: (map.get('received') ?? 0) + (map.get('settled') ?? 0),
    pendingCents: map.get('pending') ?? 0,
    expectedCents: map.get('expected') ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ledger (idempotent by ref_id UNIQUE)
// ─────────────────────────────────────────────────────────────────────────────

export interface LedgerRow {
  id: string;
  ts: string;
  agent_slug: string | null;
  direction: string;
  category: string;
  amount_cents: number;
  currency: string;
  purpose: string;
  ref_type: string;
  ref_id: string;
  policy_decision: string | null;
  status: string;
}

/**
 * Post a ledger movement. Idempotent: a ref_id posts exactly once — retrying
 * a crashed step can never double-bill.
 */
export function postLedger(input: {
  agentSlug?: string | null;
  direction: 'credit' | 'debit';
  category: string;
  amountCents: number;
  purpose: string;
  refType: string;
  refId: string;
  policyDecision?: string | null;
}): { id: string; duplicate: boolean } {
  if (input.amountCents === 0) return { id: '', duplicate: true };
  const existing = db.get<{ id: string }>('SELECT id FROM economy_ledger WHERE ref_id = ?', [input.refId]);
  if (existing) return { id: existing.id, duplicate: true };
  const id = createId('eco_lgr');
  db.run(
    `INSERT INTO economy_ledger (id, agent_slug, direction, category, amount_cents, purpose, ref_type, ref_id, policy_decision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.agentSlug ?? null, input.direction, input.category, input.amountCents, input.purpose, input.refType, input.refId, input.policyDecision ?? null],
  );
  return { id, duplicate: false };
}

export function listLedger(limit = 100): LedgerRow[] {
  // No rowid ordering (PostgreSQL has none) — ts DESC is the audit order.
  return db.all<LedgerRow>('SELECT * FROM economy_ledger ORDER BY ts DESC LIMIT ?', [limit]);
}

export function ledgerExpenseTotals(): { totalExpensesCents: number; byCategory: Record<string, number> } {
  const rows = db.all<{ category: string; total: number }>(
    "SELECT category, SUM(amount_cents) AS total FROM economy_ledger WHERE direction = 'debit' GROUP BY category",
  );
  const byCategory: Record<string, number> = {};
  let totalExpensesCents = 0;
  for (const row of rows) {
    byCategory[row.category] = Number(row.total);
    totalExpensesCents += Number(row.total);
  }
  return { totalExpensesCents, byCategory };
}

export function ledgerDailySpend(dayStartIso: string): number {
  const row = db.get<{ total: number }>(
    "SELECT SUM(amount_cents) AS total FROM economy_ledger WHERE direction = 'debit' AND category != 'settlement' AND ts >= ?",
    [dayStartIso],
  );
  return row ? Number(row.total) : 0;
}

export function ledgerAgentBreakdown(): Array<{ agent_slug: string | null; revenue_cents: number; cost_cents: number }> {
  return db.all(
    `SELECT agent_slug,
            SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE 0 END) AS revenue_cents,
            SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE 0 END) AS cost_cents
     FROM economy_ledger GROUP BY agent_slug`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Resources / upgrades / expansions / improvements / profiles / settlements
// ─────────────────────────────────────────────────────────────────────────────

export interface ResourceRow {
  id: string;
  kind: string;
  provider: string;
  description: string;
  monthly_cost_cents: number;
  status: string;
  requested_by_agent: string | null;
  policy_decision: string | null;
  provisioned_at: string | null;
  created_at: string;
}

export function insertResource(input: { kind: string; provider: string; description: string; monthlyCostCents: number; requestedByAgent?: string | null; policyDecision?: string | null }): ResourceRow {
  const id = createId('eco_res');
  db.run(
    "INSERT INTO economy_resources (id, kind, provider, description, monthly_cost_cents, status, requested_by_agent, policy_decision) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, input.kind, input.provider, input.description, input.monthlyCostCents, 'requested', input.requestedByAgent ?? null, input.policyDecision ?? null],
  );
  return db.get<ResourceRow>('SELECT * FROM economy_resources WHERE id = ?', [id])!;
}

export function getResource(id: string): ResourceRow | undefined {
  return db.get<ResourceRow>('SELECT * FROM economy_resources WHERE id = ?', [id]);
}

export function updateResource(id: string, patch: Partial<Record<keyof ResourceRow, SqlValue>>): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const assignments = fields.map((field) => `${field} = ?`).join(', ');
  db.run(`UPDATE economy_resources SET ${assignments} WHERE id = ?`, [
    ...fields.map((f) => patch[f as keyof ResourceRow] as SqlValue), id,
  ]);
}

export function listResources(status?: string): ResourceRow[] {
  return status
    ? db.all<ResourceRow>('SELECT * FROM economy_resources WHERE status = ? ORDER BY created_at DESC', [status])
    : db.all<ResourceRow>('SELECT * FROM economy_resources ORDER BY created_at DESC');
}

export interface UpgradeRow {
  id: string;
  target: string;
  current_value: string;
  candidate_value: string;
  benchmark_json: string | null;
  security_check: string;
  economic_check: string;
  status: string;
  applied_at: string | null;
  rolled_back_at: string | null;
  created_at: string;
}

export function insertUpgrade(input: { target: string; currentValue: string; candidateValue: string; benchmark?: Record<string, unknown> | null }): UpgradeRow {
  const id = createId('eco_upg');
  db.run(
    'INSERT INTO economy_upgrades (id, target, current_value, candidate_value, benchmark_json) VALUES (?, ?, ?, ?, ?)',
    [id, input.target, input.currentValue, input.candidateValue, input.benchmark ? JSON.stringify(input.benchmark) : null],
  );
  return db.get<UpgradeRow>('SELECT * FROM economy_upgrades WHERE id = ?', [id])!;
}

export function getUpgrade(id: string): UpgradeRow | undefined {
  return db.get<UpgradeRow>('SELECT * FROM economy_upgrades WHERE id = ?', [id]);
}

export function updateUpgrade(id: string, patch: Partial<Record<keyof UpgradeRow, SqlValue>>): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const assignments = fields.map((field) => `${field} = ?`).join(', ');
  db.run(`UPDATE economy_upgrades SET ${assignments} WHERE id = ?`, [
    ...fields.map((f) => patch[f as keyof UpgradeRow] as SqlValue), id,
  ]);
}

export function listUpgrades(): UpgradeRow[] {
  return db.all<UpgradeRow>('SELECT * FROM economy_upgrades ORDER BY created_at DESC');
}

export interface ExpansionRow {
  id: string;
  gap: string;
  parent_agent_slug: string | null;
  agent_slug: string | null;
  status: string;
  security_review_json: string | null;
  benchmark_json: string | null;
  created_at: string;
  decided_at: string | null;
}

export function insertExpansion(input: { gap: string; parentAgentSlug?: string | null; agentSlug?: string | null }): ExpansionRow {
  const id = createId('eco_exp');
  db.run(
    "INSERT INTO economy_expansions (id, gap, parent_agent_slug, agent_slug, status) VALUES (?, ?, ?, ?, 'draft')",
    [id, input.gap, input.parentAgentSlug ?? null, input.agentSlug ?? null],
  );
  return db.get<ExpansionRow>('SELECT * FROM economy_expansions WHERE id = ?', [id])!;
}

export function getExpansion(id: string): ExpansionRow | undefined {
  return db.get<ExpansionRow>('SELECT * FROM economy_expansions WHERE id = ?', [id]);
}

export function updateExpansion(id: string, patch: Partial<Record<keyof ExpansionRow, SqlValue>>): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const assignments = fields.map((field) => `${field} = ?`).join(', ');
  db.run(`UPDATE economy_expansions SET ${assignments} WHERE id = ?`, [
    ...fields.map((f) => patch[f as keyof ExpansionRow] as SqlValue), id,
  ]);
}

export function listExpansions(): ExpansionRow[] {
  return db.all<ExpansionRow>('SELECT * FROM economy_expansions ORDER BY created_at DESC');
}

export interface ImprovementRow {
  id: string;
  area: string;
  title: string;
  proposal: string;
  status: string;
  sandbox_result_json: string | null;
  created_at: string;
}

export function insertImprovement(input: { area: string; title: string; proposal: string }): ImprovementRow {
  const id = createId('eco_imp');
  db.run(
    "INSERT INTO economy_improvements (id, area, title, proposal) VALUES (?, ?, ?, ?)",
    [id, input.area, input.title, input.proposal],
  );
  return db.get<ImprovementRow>('SELECT * FROM economy_improvements WHERE id = ?', [id])!;
}

export function listImprovements(): ImprovementRow[] {
  return db.all<ImprovementRow>('SELECT * FROM economy_improvements ORDER BY created_at DESC');
}

export function getImprovement(id: string): ImprovementRow | undefined {
  return db.get<ImprovementRow>('SELECT * FROM economy_improvements WHERE id = ?', [id]);
}

export function updateImprovement(id: string, patch: Partial<Record<keyof ImprovementRow, SqlValue>>): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const assignments = fields.map((field) => `${field} = ?`).join(', ');
  db.run(`UPDATE economy_improvements SET ${assignments} WHERE id = ?`, [
    ...fields.map((f) => patch[f as keyof ImprovementRow] as SqlValue), id,
  ]);
}

export interface AgentProfileRow {
  agent_slug: string;
  parent_agent_slug: string | null;
  objectives: string | null;
  status: string;
  enabled_at: string;
}

export function upsertAgentProfile(input: { agentSlug: string; parentAgentSlug?: string | null; objectives?: string | null }): void {
  db.run(
    `INSERT INTO economy_agent_profiles (agent_slug, parent_agent_slug, objectives) VALUES (?, ?, ?)
     ON CONFLICT(agent_slug) DO UPDATE SET objectives = excluded.objectives`,
    [input.agentSlug, input.parentAgentSlug ?? null, input.objectives ?? null],
  );
}

export function listAgentProfiles(): AgentProfileRow[] {
  return db.all<AgentProfileRow>('SELECT * FROM economy_agent_profiles ORDER BY enabled_at DESC');
}

export function countAgentProfiles(): number {
  const row = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM economy_agent_profiles');
  return row ? Number(row.n) : 0;
}

export interface SettlementRow {
  id: string;
  amount_cents: number;
  currency: string;
  destination: string;
  status: string;
  ledger_ref: string;
  created_at: string;
  completed_at: string | null;
  evidence: string | null;
}

export function insertSettlement(input: { amountCents: number; destination: string; ledgerRef: string }): SettlementRow {
  const id = createId('eco_set');
  db.run(
    "INSERT INTO economy_settlements (id, amount_cents, destination, ledger_ref, status) VALUES (?, ?, ?, ?, 'pending_provider')",
    [id, input.amountCents, input.destination, input.ledgerRef],
  );
  return db.get<SettlementRow>('SELECT * FROM economy_settlements WHERE id = ?', [id])!;
}

export function listSettlements(): SettlementRow[] {
  return db.all<SettlementRow>('SELECT * FROM economy_settlements ORDER BY created_at DESC');
}

export function getSettlement(id: string): SettlementRow | undefined {
  return db.get<SettlementRow>('SELECT * FROM economy_settlements WHERE id = ?', [id]);
}

export function updateSettlement(id: string, patch: Partial<Record<keyof SettlementRow, SqlValue>>): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const assignments = fields.map((field) => `${field} = ?`).join(', ');
  db.run(`UPDATE economy_settlements SET ${assignments} WHERE id = ?`, [
    ...fields.map((f) => patch[f as keyof SettlementRow] as SqlValue), id,
  ]);
}

export { parseJson as parseEconomyJson };
