import { missionDb, appendMissionAudit, missionId, nowIso, type Row } from './database';

/**
 * MISSION POLICY — the compliance and authority boundary.
 *
 * Two things live here and nowhere else:
 *
 * 1. LAWFUL ACTIVITY ONLY. `allowedActivities` is an explicit allow-list and
 *    `prohibitedActivities` is a hard deny-list (fake identities, KYC/AML
 *    bypass, sanctions evasion, fraud, fake engagement, unauthorized transfers,
 *    prohibited financial activity). The deny-list is not owner-editable: it is
 *    compiled into the build, so no configuration change can authorize it.
 *
 * 2. NO UNRESTRICTED FINANCIAL AUTHORITY. Every spend path asks
 *    `canAgentSpend()` first: wallet exists and is active, budget not exceeded,
 *    daily spend cap respected, per-transaction cap respected, and anything at
 *    or above `requireApprovalAboveCents` is routed to the owner approval queue
 *    instead of executing. Agents never hold a card or bank credential — the
 *    only spend instruments are provider-scoped credentials in the encrypted
 *    vault plus the wallet budgets enforced here.
 */

export const ALLOWED_ACTIVITY_KEYS = [
  'software_development',
  'research_and_analysis',
  'content_production',
  'content_publishing',
  'marketing_services',
  'design_services',
  'automation_services',
  'data_services',
  'support_services',
  'marketplace_products',
  'affiliate_programs',
  'lead_generation',
  'consulting',
  'education_content',
] as const;

/**
 * Compiled-in hard denies. These mirror the platform rules and are never
 * configurable — the policy row cannot enable them and an agent request that
 * matches one is refused with an audited reason.
 */
export const PROHIBITED_ACTIVITY_KEYS = [
  'fake_identities',
  'kyc_aml_bypass',
  'sanctions_evasion',
  'fraud',
  'fake_engagement',
  'purchased_followers_or_reviews',
  'unauthorized_transfers',
  'money_laundering',
  'prohibited_financial_activity',
  'credential_theft',
  'spam_or_unsolicited_bulk_messaging',
  'platform_terms_violation',
  'impersonation',
  'unlicensed_financial_advice',
  'regulated_goods_or_services',
] as const;

/** Human-readable prohibitions used in the dashboard + reports. */
export const PROHIBITION_STATEMENTS: Record<string, string> = {
  fake_identities: 'Creating or operating fake identities or personas.',
  kyc_aml_bypass: 'Bypassing, defeating or falsifying KYC/AML checks.',
  sanctions_evasion: 'Any activity that would evade sanctions or trade controls.',
  fraud: 'Fraud, misrepresentation or deceptive billing.',
  fake_engagement: 'Fabricating engagement (views, likes, followers, reviews).',
  purchased_followers_or_reviews: 'Buying followers, reviews, ratings or traffic.',
  unauthorized_transfers: 'Moving funds without owner authorization.',
  money_laundering: 'Layering or laundering funds.',
  prohibited_financial_activity: 'Lending, custody, exchange or other regulated financial activity without authorization.',
  credential_theft: 'Using credentials that do not belong to the mission.',
  spam_or_unsolicited_bulk_messaging: 'Spam or unsolicited bulk messaging.',
  platform_terms_violation: 'Actions that violate a provider’s or platform’s terms of service.',
  impersonation: 'Impersonating a person or organization.',
  unlicensed_financial_advice: 'Unlicensed financial, legal or medical advice.',
  regulated_goods_or_services: 'Regulated goods or services requiring a license we do not hold.',
};

export interface MissionPolicy {
  autonomousEnabled: boolean;
  killSwitch: boolean;
  allowAgentCreation: boolean;
  maxDepth: number;
  maxChildrenPerAgent: number;
  maxAgents: number;
  maxDailySpendCents: number;
  maxExpenseCents: number;
  maxPayoutCents: number;
  requireApprovalAboveCents: number;
  requireOwnerForPayout: boolean;
  /** Share of verified received revenue moved to the reinvestment wallet, in basis points (0..10000). */
  reinvestShareBps: number;
  /** Fixed daily realized-revenue target in minor units; 0 = no target configured. */
  dailyRevenueTargetCents: number;
  currency: string;
  allowedActivities: string[];
  prohibitedActivities: string[];
  providerActivation: Array<Record<string, unknown>>;
}

interface PolicyRow extends Row {
  autonomous_enabled: number;
  kill_switch: number;
  allow_agent_creation: number;
  max_depth: number;
  max_children_per_agent: number;
  max_agents: number;
  max_daily_spend_cents: number;
  max_expense_cents: number;
  max_payout_cents: number;
  require_approval_above_cents: number;
  require_owner_for_payout: number;
  reinvest_share_bps: number;
  daily_revenue_target_cents: number;
  currency: string;
  allowed_activities: string;
  prohibited_activities: string;
  provider_activation: string;
}

function parseArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function parseObjects(value: string | null | undefined): Array<Record<string, unknown>> {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed.filter((entry) => entry && typeof entry === 'object') as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

/** The singleton policy row, created on first read with safe defaults. */
export function ensurePolicy(currency: string): PolicyRow {
  const existing = missionDb.get<PolicyRow>('SELECT * FROM mission_policy WHERE id = ?', ['global']);
  if (existing) return existing;
  missionDb.run(
    `INSERT INTO mission_policy (id, currency, allowed_activities, prohibited_activities, provider_activation)
     VALUES ('global', ?, ?, ?, ?)`,
    [
      currency,
      JSON.stringify([...ALLOWED_ACTIVITY_KEYS]),
      // Stored for transparency only; the compiled list above is authoritative.
      JSON.stringify([...PROHIBITED_ACTIVITY_KEYS]),
      JSON.stringify([]),
    ],
  );
  return missionDb.get<PolicyRow>('SELECT * FROM mission_policy WHERE id = ?', ['global'])!;
}

export function currentPolicy(currency = 'USD'): MissionPolicy {
  const row = ensurePolicy(currency);
  return {
    autonomousEnabled: Number(row.autonomous_enabled) === 1,
    killSwitch: Number(row.kill_switch) === 1,
    allowAgentCreation: Number(row.allow_agent_creation) === 1,
    maxDepth: Number(row.max_depth),
    maxChildrenPerAgent: Number(row.max_children_per_agent),
    maxAgents: Number(row.max_agents),
    maxDailySpendCents: Number(row.max_daily_spend_cents),
    maxExpenseCents: Number(row.max_expense_cents),
    maxPayoutCents: Number(row.max_payout_cents),
    requireApprovalAboveCents: Number(row.require_approval_above_cents),
    requireOwnerForPayout: Number(row.require_owner_for_payout) === 1,
    reinvestShareBps: Number(row.reinvest_share_bps ?? 0),
    dailyRevenueTargetCents: Number(row.daily_revenue_target_cents ?? 0),
    currency: row.currency,
    // Allow-list = the configured subset of the compiled allowed keys.
    allowedActivities: parseArray(row.allowed_activities).filter((key) =>
      (ALLOWED_ACTIVITY_KEYS as readonly string[]).includes(key),
    ),
    prohibitedActivities: [...PROHIBITED_ACTIVITY_KEYS],
    providerActivation: parseObjects(row.provider_activation),
  };
}

export function updatePolicy(patch: Partial<MissionPolicy>, actorId: string): MissionPolicy {
  const row = ensurePolicy('USD');
  const fields: string[] = [];
  const values: Array<string | number> = [];
  const setNumber = (column: string, value: number | undefined, min: number, max: number) => {
    if (value === undefined) return;
    fields.push(`${column} = ?`);
    values.push(Math.min(max, Math.max(min, Math.round(value))));
  };
  const setFlag = (column: string, value: boolean | undefined) => {
    if (value === undefined) return;
    fields.push(`${column} = ?`);
    values.push(value ? 1 : 0);
  };
  setFlag('autonomous_enabled', patch.autonomousEnabled);
  setFlag('allow_agent_creation', patch.allowAgentCreation);
  setFlag('require_owner_for_payout', patch.requireOwnerForPayout);
  setNumber('max_depth', patch.maxDepth, 0, 8);
  setNumber('max_children_per_agent', patch.maxChildrenPerAgent, 0, 64);
  setNumber('max_agents', patch.maxAgents, 1, 100_000);
  setNumber('max_daily_spend_cents', patch.maxDailySpendCents, 0, 100_000_000);
  setNumber('max_expense_cents', patch.maxExpenseCents, 0, 100_000_000);
  setNumber('max_payout_cents', patch.maxPayoutCents, 0, 1_000_000_000);
  setNumber('require_approval_above_cents', patch.requireApprovalAboveCents, 0, 1_000_000_000);
  setNumber('reinvest_share_bps', patch.reinvestShareBps, 0, 10_000);
  // Owner-defined aspirational target: $1B/day per agent = 100_000_000_000 cents.
  // Allow up to $10T/day (1_000_000_000_000_000 cents) for configurability, within safe integer.
  setNumber('daily_revenue_target_cents', patch.dailyRevenueTargetCents, 0, 1_000_000_000_000_000);
  if (patch.currency) {
    fields.push('currency = ?');
    values.push(String(patch.currency).slice(0, 8));
  }
  if (patch.allowedActivities) {
    const filtered = patch.allowedActivities.filter((key) => (ALLOWED_ACTIVITY_KEYS as readonly string[]).includes(key));
    fields.push('allowed_activities = ?');
    values.push(JSON.stringify(filtered));
  }
  if (patch.providerActivation) {
    fields.push('provider_activation = ?');
    values.push(JSON.stringify(patch.providerActivation).slice(0, 40_000));
  }
  if (fields.length === 0) {
    return currentPolicy(row.currency);
  }
  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  missionDb.run(`UPDATE mission_policy SET ${fields.join(', ')} WHERE id = 'global'`, values);
  appendMissionAudit({
    actorType: 'owner',
    actorId,
    action: 'policy.update',
    subjectType: 'policy',
    subjectId: 'global',
    detail: patch as Record<string, unknown>,
  });
  return currentPolicy(row.currency);
}

export function setKillSwitch(engaged: boolean, actorId: string): boolean {
  ensurePolicy('USD');
  missionDb.run(
    `UPDATE mission_policy SET kill_switch = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'global'`,
    [engaged ? 1 : 0],
  );
  appendMissionAudit({
    actorType: 'owner',
    actorId,
    action: engaged ? 'kill_switch.engaged' : 'kill_switch.released',
    subjectType: 'policy',
    subjectId: 'global',
  });
  return engaged;
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity + spend authorization
// ─────────────────────────────────────────────────────────────────────────────

export interface ActivityDecision {
  allowed: boolean;
  reasons: string[];
}

/**
 * Is this activity lawful and permitted for the mission? Deny-list beats
 * allow-list beats configuration, in that order.
 */
export function checkActivity(activityKey: string, policy: MissionPolicy): ActivityDecision {
  const reasons: string[] = [];
  const key = String(activityKey ?? '').trim();
  if (!key) return { allowed: false, reasons: ['activity_key_required'] };
  // The kill switch is absolute: it suspends every activity, including ones the
  // policy otherwise enables, until the owner releases it.
  if (policy.killSwitch) {
    return { allowed: false, reasons: ['kill_switch_engaged: the mission kill switch is engaged — all activity is suspended'] };
  }
  if ((PROHIBITED_ACTIVITY_KEYS as readonly string[]).includes(key)) {
    reasons.push(`prohibited_activity:${key}`);
    return { allowed: false, reasons };
  }
  if (!(ALLOWED_ACTIVITY_KEYS as readonly string[]).includes(key)) {
    reasons.push(`unknown_activity:${key}`);
    return { allowed: false, reasons };
  }
  if (!policy.allowedActivities.includes(key)) {
    reasons.push(`activity_not_enabled:${key}`);
    return { allowed: false, reasons };
  }
  return { allowed: true, reasons };
}

export interface SpendRequest {
  walletId: string;
  amountCents: number;
  category: string;
  agentId?: string | null;
  description?: string;
}

export interface SpendDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reasons: string[];
  dailySpentCents: number;
  policyRemainingCents: number;
}

interface WalletRow extends Row {
  id: string;
  balance_cents: number;
  budget_cents: number;
  spent_cents: number;
  status: string;
  currency: string;
}

/**
 * The single gate every spend must pass. Returns whether the spend may execute
 * now, or must be routed to the owner approval queue, or is refused outright.
 */
export function canAgentSpend(request: SpendRequest, policy: MissionPolicy, dailySpentCents: number): SpendDecision {
  const reasons: string[] = [];
  const amount = Math.round(Number(request.amountCents) || 0);
  if (amount <= 0) return { allowed: false, requiresApproval: false, reasons: ['amount_must_be_positive'], dailySpentCents, policyRemainingCents: policy.maxDailySpendCents - dailySpentCents };

  const wallet = missionDb.get<WalletRow>('SELECT * FROM mission_wallets WHERE id = ?', [request.walletId]);
  if (!wallet) return { allowed: false, requiresApproval: false, reasons: ['wallet_not_found'], dailySpentCents, policyRemainingCents: policy.maxDailySpendCents - dailySpentCents };

  if (policy.killSwitch) reasons.push('kill_switch_engaged');
  if (String(wallet.status) !== 'active') reasons.push(`wallet_${wallet.status}`);

  const budget = Number(wallet.budget_cents);
  const spent = Number(wallet.spent_cents);
  if (budget > 0 && spent + amount > budget) {
    reasons.push(`wallet_budget_exceeded (${spent + amount} > ${budget})`);
  }
  if (Number(wallet.balance_cents) < amount) {
    reasons.push(`insufficient_wallet_balance (${wallet.balance_cents} < ${amount})`);
  }
  if (amount > policy.maxExpenseCents) {
    reasons.push(`expense_above_per_transaction_cap (${amount} > ${policy.maxExpenseCents})`);
  }
  const dailyRemaining = policy.maxDailySpendCents - dailySpentCents;
  if (amount > dailyRemaining) {
    reasons.push(`daily_spend_cap_exceeded (remaining ${dailyRemaining})`);
  }

  const requiresApproval = amount >= policy.requireApprovalAboveCents;
  const allowed = reasons.length === 0 && !requiresApproval;
  return { allowed, requiresApproval: reasons.length === 0 && requiresApproval, reasons, dailySpentCents, policyRemainingCents: dailyRemaining };
}

export function dailySpendCents(dateIso: string): number {
  const day = dateIso.slice(0, 10);
  const row = missionDb.get<{ cents: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM mission_ledger
     WHERE direction = 'debit' AND category IN ('expense','upgrade','fee') AND substr(created_at, 1, 10) = ?`,
    [day],
  );
  return Number(row?.cents ?? 0);
}

/** Register an approval request (never auto-approves). */
export function requestApproval(input: {
  subjectType: string;
  subjectId: string;
  action: string;
  amountCents?: number;
  requestedBy?: string | null;
  note?: string | null;
}): string {
  const id = missionId('apr');
  missionDb.run(
    `INSERT INTO mission_approvals (id, subject_type, subject_id, action, amount_cents, requested_by, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.subjectType, input.subjectId, input.action, Math.round(input.amountCents ?? 0), input.requestedBy ?? null, input.note ?? null],
  );
  appendMissionAudit({
    actorType: input.requestedBy ? 'agent' : 'system',
    actorId: input.requestedBy ?? null,
    action: 'approval.requested',
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    detail: { action: input.action, amountCents: input.amountCents ?? 0 },
  });
  return id;
}

export function decideApproval(input: {
  id: string;
  decision: 'approved' | 'rejected';
  decidedBy: string;
  note?: string | null;
  /** Only the mission owner may decide; an agent actor is refused here too. */
  actorType?: 'owner' | 'agent';
}): {
  ok: boolean;
  status: string;
  approval?: Row;
  reason?: string;
} {
  if (input.actorType === 'agent') {
    return { ok: false, status: 'forbidden', reason: 'an agent cannot decide an approval — this belongs to the mission owner' };
  }
  const approval = missionDb.get<Row>('SELECT * FROM mission_approvals WHERE id = ?', [input.id]);
  if (!approval) return { ok: false, status: 'not_found', reason: 'approval not found' };
  if (String(approval.status) !== 'pending') {
    return { ok: false, status: 'conflict', reason: `approval already ${approval.status}` };
  }
  missionDb.run(
    `UPDATE mission_approvals SET status = ?, decided_by = ?, decided_at = ?, note = COALESCE(?, note) WHERE id = ?`,
    [input.decision, input.decidedBy, nowIso(), input.note ?? null, input.id],
  );
  appendMissionAudit({
    actorType: 'owner',
    actorId: input.decidedBy,
    action: `approval.${input.decision}`,
    subjectType: String(approval.subject_type),
    subjectId: String(approval.subject_id),
    detail: { approvalId: input.id, note: input.note ?? null },
  });
  return { ok: true, status: input.decision, approval: missionDb.get<Row>('SELECT * FROM mission_approvals WHERE id = ?', [input.id]) };
}
