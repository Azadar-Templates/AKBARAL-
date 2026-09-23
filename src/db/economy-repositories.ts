import { financialTransaction } from './financial-transaction';
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
  max_agent_depth: number;
  max_children_per_agent: number;
  spawn_rate_per_hour: number;
  spawn_cost_cents: number;
  freeze_spending: number;
  freeze_withdrawals: number;
  provider_access_revoked: number;
  economy_model_key: string | null;
  discovery_categories_json: string;
  /** 0022: autonomous upgrade gates. Default OFF — an agent may REQUEST an
   *  upgrade, but executing one autonomously needs both flags plus affordability
   *  from realized earnings. Zero upfront investment is preserved. */
  auto_upgrade_enabled: number;
  max_auto_upgrade_cost_cents: number;
}

export function getEconomyPolicy(): EconomyPolicyRow {
  const row = db.get<EconomyPolicyRow>("SELECT * FROM economy_policy WHERE id = 'global'");
  if (!row) {
    // D9: fresh policy rows start at the 4,001-agent scale cap (existing rows
    // still on the shipped default are moved by migration 0019; owner-tuned
    // caps are never touched by either path).
    db.run("INSERT OR IGNORE INTO economy_policy (id, max_economy_agents) VALUES ('global', 5000)");
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
  platform_key: string | null;
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
  platformKey?: string | null;
  estimateBasis?: string;
}): { id: string; duplicate: boolean } {
  const existing = db.get<{ id: string }>('SELECT id FROM economy_opportunities WHERE source_url_hash = ?', [input.sourceUrlHash]);
  if (existing) return { id: existing.id, duplicate: true };
  const id = createId('eco_opp');
  db.run(
    `INSERT INTO economy_opportunities
       (id, source_url_hash, source_url, category, title, summary, expected_revenue_cents, expected_cost_cents,
        time_hours, risk_level, platform_rules, platform_key, probability, estimate_basis, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered')`,
    [id, input.sourceUrlHash, input.sourceUrl, input.category, input.title, input.summary ?? null,
      input.expectedRevenueCents, input.expectedCostCents, input.timeHours, input.riskLevel,
      input.platformRules ?? null, input.platformKey ?? null, input.probability, input.estimateBasis ?? 'category_default'],
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
  return financialTransaction(db, 'economy', () => {
  const history = db.all<ExecutionRow>('SELECT * FROM economy_executions WHERE opportunity_id = ?', [input.opportunityId]);
  const live = history.find(row => ['authorized', 'running'].includes(row.status));
  if (live) return { id: live.id, created: false };
  const round = history.reduce((max, row) => {
    const value = Number(row.idempotency_key.split('#')[1] ?? 0);
    return Math.max(max, Number.isSafeInteger(value) ? value : 0);
  }, -1) + 1;
  const id = createId('eco_exe');
  db.run(
    `INSERT INTO economy_executions (id, opportunity_id, agent_slug, idempotency_key, status, attempts, max_attempts, timeout_at)
     VALUES (?, ?, ?, ?, 'authorized', 0, ?, ?)`,
    [id, input.opportunityId, input.agentSlug, `opp:${input.opportunityId}:live#${round}`, input.maxAttempts ?? 2,
      new Date(Date.now() + input.timeoutMs).toISOString()],
  );
  return { id, created: true };
  });
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

/**
 * Realized-revenue windows for the owner dashboard. Only RECEIVED/SETTLED
 * revenue counts (the honesty rule); expected/pending are excluded so no
 * estimate can ever appear as income.
 */
export function revenueWindows(): { todayCents: number; last7DaysCents: number; last30DaysCents: number; lifetimeCents: number } {
  const now = Date.now();
  const iso = (msAgo: number): string => new Date(now - msAgo).toISOString();
  const day = 24 * 3600 * 1000;
  const realized = "state IN ('received','settled')";
  const sum = (since?: string): number => {
    const row = since
      ? db.get<{ total: number | null }>('SELECT SUM(amount_cents) AS total FROM economy_revenue WHERE ' + realized + ' AND received_at >= ?', [since])
      : db.get<{ total: number | null }>('SELECT SUM(amount_cents) AS total FROM economy_revenue WHERE ' + realized);
    return Number(row?.total ?? 0);
  };
  return {
    todayCents: sum(iso(day)),        // trailing 24h
    last7DaysCents: sum(iso(7 * day)),
    last30DaysCents: sum(iso(30 * day)),
    lifetimeCents: sum(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mission chat (owner ↔ agent; owner-only surface, fully audited)
// ─────────────────────────────────────────────────────────────────────────────

export interface MissionChatMessageRow {
  id: string;
  owner_user_id: string;
  agent_slug: string;
  direction: 'owner' | 'agent';
  content: string;
  status: string;
  model_key: string | null;
  error_code: string | null;
  created_at: string;
}

export function insertMissionMessage(input: {
  ownerUserId: string;
  agentSlug: string;
  direction: 'owner' | 'agent';
  content: string;
  status?: 'completed' | 'failed';
  modelKey?: string | null;
  errorCode?: string | null;
}): MissionChatMessageRow {
  const id = createId('mcm');
  const ts = NOW();
  db.run(
    'INSERT INTO mission_chat_messages (id, owner_user_id, agent_slug, direction, content, status, model_key, error_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.ownerUserId, input.agentSlug, input.direction, input.content, input.status ?? 'completed', input.modelKey ?? null, input.errorCode ?? null, ts],
  );
  return {
    id,
    owner_user_id: input.ownerUserId,
    agent_slug: input.agentSlug,
    direction: input.direction,
    content: input.content,
    status: input.status ?? 'completed',
    model_key: input.modelKey ?? null,
    error_code: input.errorCode ?? null,
    created_at: ts,
  };
}

export function listMissionMessages(ownerUserId: string, agentSlug: string, limit = 200): MissionChatMessageRow[] {
  return db.all<MissionChatMessageRow>(
    'SELECT * FROM mission_chat_messages WHERE owner_user_id = ? AND agent_slug = ? ORDER BY created_at ASC, id ASC LIMIT ?',
    [ownerUserId, agentSlug, Math.min(limit, 500)],
  );
}

export function listMissionThreads(ownerUserId: string): Array<{ agentSlug: string; messageCount: number; lastMessageAt: string; lastDirection: string }> {
  // No correlated subquery over grouped columns: PostgreSQL rejects it
  // ("subquery uses ungrouped column"), SQLite merely tolerates it. Keep the
  // query portable and fetch the last direction per (few) threads separately.
  const rows = db.all<{ agent_slug: string; n: number; last_at: string }>(
    `SELECT agent_slug, COUNT(*) AS n, MAX(created_at) AS last_at
     FROM mission_chat_messages WHERE owner_user_id = ? GROUP BY agent_slug ORDER BY last_at DESC`,
    [ownerUserId],
  );
  return rows.map((r) => {
    const last = db.get<{ direction: string }>(
      'SELECT direction FROM mission_chat_messages WHERE owner_user_id = ? AND agent_slug = ? ORDER BY created_at DESC, id DESC LIMIT 1',
      [ownerUserId, r.agent_slug],
    );
    return { agentSlug: r.agent_slug, messageCount: Number(r.n), lastMessageAt: r.last_at, lastDirection: last?.direction ?? 'owner' };
  });
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
  return financialTransaction(db, 'economy', () => {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0) throw new Error('ledger amount must be nonnegative integer cents');
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

  });
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
  /** 0022: what the upgrade costs, and which agent asked for it (NULL = owner). */
  cost_cents: number;
  requested_by_agent: string | null;
}

export function insertUpgrade(input: { target: string; currentValue: string; candidateValue: string; benchmark?: Record<string, unknown> | null; costCents?: number; requestedByAgent?: string | null }): UpgradeRow {
  const id = createId('eco_upg');
  db.run(
    'INSERT INTO economy_upgrades (id, target, current_value, candidate_value, benchmark_json, cost_cents, requested_by_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, input.target, input.currentValue, input.candidateValue, input.benchmark ? JSON.stringify(input.benchmark) : null,
     Math.max(0, Math.round(input.costCents ?? 0)), input.requestedByAgent ?? null],
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
  budget_cents: number;
  spend_cents: number;
  paused_at: string | null;
  paused_reason: string | null;
  /** 0022: per-agent spend caps in minor units. NULL = uncapped. */
  daily_spend_quota_cents: number | null;
  monthly_spend_quota_cents: number | null;
}

/** Children count for a parent agent (hierarchy gate). */
export function countAgentChildren(parentAgentSlug: string): number {
  const row = db.get<{ n: number | null }>('SELECT COUNT(*) AS n FROM economy_agent_profiles WHERE parent_agent_slug = ?', [parentAgentSlug]);
  return Number(row?.n ?? 0);
}

/** A single agent profile by slug (hierarchy gate lookups). */
export function getAgentProfileBySlug(agentSlug: string): AgentProfileRow | undefined {
  return db.get<AgentProfileRow>('SELECT * FROM economy_agent_profiles WHERE agent_slug = ?', [agentSlug]);
}

/** Depth of an agent in the child hierarchy (top-level = 0). Cycle-safe. */
export function agentHierarchyDepth(agentSlug: string): number {
  let depth = 0;
  let current: string | null = agentSlug;
  const seen = new Set<string>();
  while (current && !seen.has(current) && depth < 100) {
    seen.add(current);
    const row: { parent: string | null } | undefined = db.get<{ parent: string | null }>(
      'SELECT parent_agent_slug AS parent FROM economy_agent_profiles WHERE agent_slug = ?',
      [current],
    );
    if (!row || !row.parent) return depth;
    current = row.parent;
    depth += 1;
  }
  return depth;
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

/**
 * Every profile as a flat parent→children map.
 *
 * The descendant walk is done in JS rather than with a recursive CTE on
 * purpose: SQLite and PostgreSQL disagree on recursive-CTE syntax and this
 * layer must behave identically on both engines. One indexed parent lookup
 * builds the whole forest for any realistic economy size (hundreds to
 * thousands of agents), and the walk is cycle-safe by construction.
 */
export function agentChildrenMap(): Map<string | null, string[]> {
  const rows = db.all<{ agent_slug: string; parent_agent_slug: string | null }>(
    'SELECT agent_slug, parent_agent_slug FROM economy_agent_profiles',
  );
  const map = new Map<string | null, string[]>();
  for (const row of rows) {
    const key = row.parent_agent_slug ?? null;
    const bucket = map.get(key);
    if (bucket) bucket.push(row.agent_slug);
    else map.set(key, [row.agent_slug]);
  }
  return map;
}

/** Every descendant of `rootSlug` (exclusive of the root), breadth-first, cycle-safe. */
export function listDescendantSlugs(rootSlug: string): string[] {
  const children = agentChildrenMap();
  const out: string[] = [];
  const seen = new Set<string>([rootSlug]);
  const queue = [...(children.get(rootSlug) ?? [])];
  while (queue.length > 0) {
    const slug = queue.shift() as string;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
    queue.push(...(children.get(slug) ?? []));
  }
  return out;
}

/** Depth of every profile, keyed by slug (top-level agents are depth 0). */
export function agentDepths(): Map<string, number> {
  const rows = db.all<{ agent_slug: string; parent_agent_slug: string | null }>(
    'SELECT agent_slug, parent_agent_slug FROM economy_agent_profiles',
  );
  const parentOf = new Map<string, string | null>();
  for (const row of rows) parentOf.set(row.agent_slug, row.parent_agent_slug ?? null);
  const depths = new Map<string, number>();
  for (const row of rows) {
    if (depths.has(row.agent_slug)) continue;
    const chain: string[] = [];
    let current: string | null = row.agent_slug;
    const seen = new Set<string>();
    let depth = 0;
    while (current && !seen.has(current) && depth < 100) {
      const known = depths.get(current);
      if (known !== undefined) {
        depth += known;
        break;
      }
      seen.add(current);
      chain.push(current);
      const parentSlug: string | null = parentOf.get(current) ?? null;
      if (!parentSlug || !parentOf.has(parentSlug)) break;
      current = parentSlug;
      depth += 1;
    }
    // Resolve the recorded chain back down with absolute depths.
    chain.forEach((slug, index) => {
      const value = depth - index;
      depths.set(slug, value < 0 ? 0 : value);
    });
    if (!depths.has(row.agent_slug)) depths.set(row.agent_slug, depth);
  }
  return depths;
}

export function setAgentProfileStatus(input: {
  agentSlug: string;
  status: 'active' | 'paused';
  pausedAt?: string | null;
  pausedReason?: string | null;
}): number {
  const result = db.run(
    'UPDATE economy_agent_profiles SET status = ?, paused_at = ?, paused_reason = ? WHERE agent_slug = ?',
    [input.status, input.pausedAt ?? null, input.pausedReason ?? null, input.agentSlug],
  );
  return Number((result as { changes?: number }).changes ?? 0);
}

export function setAgentBudgetCents(agentSlug: string, budgetCents: number): void {
  db.run('UPDATE economy_agent_profiles SET budget_cents = ? WHERE agent_slug = ?', [Math.max(0, Math.round(budgetCents)), agentSlug]);
}

/** Record real spend against an agent's budget (debits are posted to the ledger separately). */
export function addAgentSpendCents(agentSlug: string, cents: number): void {
  if (cents <= 0) return;
  db.run('UPDATE economy_agent_profiles SET spend_cents = spend_cents + ? WHERE agent_slug = ?', [Math.round(cents), agentSlug]);
}

export interface DelegationRow {
  id: string;
  parent_agent_slug: string | null;
  child_agent_slug: string | null;
  gap: string | null;
  decision: string;
  reason: string;
  checks_json: string;
  depth: number;
  spawn_cost_cents: number;
  rate_used_in_window: number;
  actor: string;
  decided_at: string;
}

export function insertDelegation(input: {
  parentAgentSlug: string | null;
  childAgentSlug: string | null;
  gap?: string | null;
  decision: 'authorized' | 'rejected';
  reason: string;
  checks: unknown;
  depth: number;
  spawnCostCents: number;
  rateUsedInWindow: number;
  actor: string;
}): DelegationRow {
  const id = createId('dgt');
  const decidedAt = NOW();
  db.run(
    `INSERT INTO economy_delegations
       (id, parent_agent_slug, child_agent_slug, gap, decision, reason, checks_json, depth, spawn_cost_cents, rate_used_in_window, actor, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.parentAgentSlug,
      input.childAgentSlug,
      input.gap ?? null,
      input.decision,
      input.reason,
      JSON.stringify(input.checks ?? []),
      input.depth,
      input.spawnCostCents,
      input.rateUsedInWindow,
      input.actor,
      decidedAt,
    ],
  );
  return db.get<DelegationRow>('SELECT * FROM economy_delegations WHERE id = ?', [id])!;
}

export function listDelegations(filter: { parentAgentSlug?: string; childAgentSlug?: string; limit?: number } = {}): DelegationRow[] {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  if (filter.childAgentSlug) {
    return db.all<DelegationRow>('SELECT * FROM economy_delegations WHERE child_agent_slug = ? ORDER BY decided_at DESC LIMIT ?', [
      filter.childAgentSlug,
      limit,
    ]);
  }
  if (filter.parentAgentSlug) {
    return db.all<DelegationRow>('SELECT * FROM economy_delegations WHERE parent_agent_slug = ? ORDER BY decided_at DESC LIMIT ?', [
      filter.parentAgentSlug,
      limit,
    ]);
  }
  return db.all<DelegationRow>('SELECT * FROM economy_delegations ORDER BY decided_at DESC LIMIT ?', [limit]);
}

/** Authorized spawns since `sinceIso` — the rate-limit window (rejections do not consume it). */
export function countRecentAuthorizedDelegations(sinceIso: string): number {
  const row = db.get<{ n: number | null }>(
    "SELECT COUNT(*) AS n FROM economy_delegations WHERE decision = 'authorized' AND decided_at >= ?",
    [sinceIso],
  );
  return Number(row?.n ?? 0);
}

/** Authorized spawns by ONE parent since `sinceIso` (per-parent fairness). */
export function countRecentAuthorizedDelegationsByParent(parentAgentSlug: string | null, sinceIso: string): number {
  const row = parentAgentSlug
    ? db.get<{ n: number | null }>(
        "SELECT COUNT(*) AS n FROM economy_delegations WHERE decision = 'authorized' AND parent_agent_slug = ? AND decided_at >= ?",
        [parentAgentSlug, sinceIso],
      )
    : db.get<{ n: number | null }>(
        "SELECT COUNT(*) AS n FROM economy_delegations WHERE decision = 'authorized' AND parent_agent_slug IS NULL AND decided_at >= ?",
        [sinceIso],
      );
  return Number(row?.n ?? 0);
}

/** Realized spend of a whole subtree (sum of profile spend — includes descendants). */
export function subtreeSpendCents(rootSlug: string): number {
  const slugs = [rootSlug, ...listDescendantSlugs(rootSlug)];
  if (slugs.length === 0) return 0;
  const placeholders = slugs.map(() => '?').join(', ');
  const row = db.get<{ total: number | null }>(
    `SELECT SUM(spend_cents) AS total FROM economy_agent_profiles WHERE agent_slug IN (${placeholders})`,
    slugs,
  );
  return Number(row?.total ?? 0);
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

// ─────────────────────────────────────────────────────────────────────────────
// Treasury transfers (controlled movement of realized agent surplus)
// ─────────────────────────────────────────────────────────────────────────────

export interface TransferRow {
  id: string;
  source_agent_slug: string;
  destination: string;
  amount_cents: number;
  currency: string;
  reason: string;
  status: string; // proposed|executed|rejected
  idempotency_key: string;
  proposed_by: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export function insertTransfer(input: {
  sourceAgentSlug: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
  proposedBy: string;
}): TransferRow {
  const id = createId('eco_tr');
  db.run(
    "INSERT INTO economy_transfers (id, source_agent_slug, destination, amount_cents, currency, reason, status, idempotency_key, proposed_by, created_at) VALUES (?, ?, 'treasury', ?, 'USD', ?, 'proposed', ?, ?, ?)",
    [id, input.sourceAgentSlug, input.amountCents, input.reason, input.idempotencyKey, input.proposedBy, NOW()],
  );
  return getTransfer(id)!;
}

export function getTransfer(id: string): TransferRow | undefined {
  return db.get<TransferRow>('SELECT * FROM economy_transfers WHERE id = ?', [id]);
}

export function getTransferByIdempotencyKey(key: string): TransferRow | undefined {
  return db.get<TransferRow>('SELECT * FROM economy_transfers WHERE idempotency_key = ?', [key]);
}

export function updateTransfer(id: string, patch: Partial<Record<keyof TransferRow, SqlValue>>): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const assignments = fields.map((field) => `${field} = ?`).join(', ');
  db.run(`UPDATE economy_transfers SET ${assignments} WHERE id = ?`, [
    ...fields.map((f) => patch[f as keyof TransferRow] as SqlValue), id,
  ]);
}

export function listTransfers(limit = 100): TransferRow[] {
  return db.all<TransferRow>('SELECT * FROM economy_transfers ORDER BY created_at DESC LIMIT ?', [limit]);
}

export function executedTransferTotalForAgent(agentSlug: string): number {
  const row = db.get<{ total: number | null }>(
    "SELECT SUM(amount_cents) AS total FROM economy_transfers WHERE source_agent_slug = ? AND status = 'executed'",
    [agentSlug],
  );
  return Number(row?.total ?? 0);
}

// ── Owner command flow (0022) ────────────────────────────────────────────────

export interface CommandRow {
  id: string;
  idempotency_key: string;
  owner_user_id: string;
  agent_slug: string;
  instruction: string;
  status: string;
  opportunity_id: string | null;
  execution_id: string | null;
  delivery_id: string | null;
  result_summary: string | null;
  verification: string | null;
  created_at: string;
  updated_at: string;
}

export function insertCommand(input: { idempotencyKey: string; ownerUserId: string; agentSlug: string; instruction: string }): { row: CommandRow; duplicate: boolean } {
  const existing = db.get<CommandRow>('SELECT * FROM economy_commands WHERE idempotency_key = ?', [input.idempotencyKey]);
  if (existing) return { row: existing, duplicate: true };
  const id = createId('eco_cmd');
  db.run(
    'INSERT INTO economy_commands (id, idempotency_key, owner_user_id, agent_slug, instruction) VALUES (?, ?, ?, ?, ?)',
    [id, input.idempotencyKey, input.ownerUserId, input.agentSlug, input.instruction],
  );
  const row = db.get<CommandRow>('SELECT * FROM economy_commands WHERE id = ?', [id]);
  if (!row) throw new Error('command insert did not persist (id ' + id + ')');
  return { row, duplicate: false };
}

export function getCommand(id: string): CommandRow | undefined {
  return db.get<CommandRow>('SELECT * FROM economy_commands WHERE id = ?', [id]);
}

export function updateCommand(id: string, patch: { status?: string; opportunityId?: string | null; executionId?: string | null; deliveryId?: string | null; resultSummary?: string | null; verification?: string | null }): void {
  const sets = [];
  const vals = [];
  if (patch.status !== undefined) { sets.push('status = ?'); vals.push(patch.status); }
  if (patch.opportunityId !== undefined) { sets.push('opportunity_id = ?'); vals.push(patch.opportunityId); }
  if (patch.executionId !== undefined) { sets.push('execution_id = ?'); vals.push(patch.executionId); }
  if (patch.deliveryId !== undefined) { sets.push('delivery_id = ?'); vals.push(patch.deliveryId); }
  if (patch.resultSummary !== undefined) { sets.push('result_summary = ?'); vals.push(patch.resultSummary); }
  if (patch.verification !== undefined) { sets.push('verification = ?'); vals.push(patch.verification); }
  if (sets.length === 0) return;
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  db.run('UPDATE economy_commands SET ' + sets.join(', ') + ' WHERE id = ?', [...vals, id]);
}

export function listCommands(input: { agentSlug?: string; status?: string; limit?: number } = {}): CommandRow[] {
  const conds = [];
  const vals = [];
  if (input.agentSlug) { conds.push('agent_slug = ?'); vals.push(input.agentSlug); }
  if (input.status) { conds.push('status = ?'); vals.push(input.status); }
  const where = conds.length > 0 ? 'WHERE ' + conds.join(' AND ') : '';
  return db.all<CommandRow>('SELECT * FROM economy_commands ' + where + ' ORDER BY created_at DESC LIMIT ?', [...vals, Math.min(500, Math.max(1, input.limit ?? 100))]);
}

// ── Per-agent spend quotas (0022) ────────────────────────────────────────────

export function setAgentQuotas(agentSlug: string, quotas: { dailySpendQuotaCents?: number | null; monthlySpendQuotaCents?: number | null }): void {
  const profile = getAgentProfileBySlug(agentSlug);
  if (!profile) throw new Error('agent profile "' + agentSlug + '" does not exist');
  const entries: Array<[keyof typeof quotas, string]> = [['dailySpendQuotaCents', 'daily_spend_quota_cents'], ['monthlySpendQuotaCents', 'monthly_spend_quota_cents']];
  for (const [key, column] of entries) {
    const value = quotas[key];
    if (value === undefined) continue;
    if (value !== null && (!Number.isInteger(value) || value < 0)) throw new Error('quota "' + key + '" must be a non-negative integer or null (got ' + value + ')');
    db.run('UPDATE economy_agent_profiles SET ' + column + ' = ? WHERE agent_slug = ?', [value, agentSlug]);
  }
}

/** Ledger debits attributed to one agent since the given ISO instant. */
export function agentSpendSince(agentSlug: string, sinceIso: string): number {
  const row = db.get<{ total: number | null }>(
    "SELECT SUM(amount_cents) AS total FROM economy_ledger WHERE agent_slug = ? AND direction = 'debit' AND ts >= ?",
    [agentSlug, sinceIso],
  );
  return Number(row?.total ?? 0);
}
