import { missionDb, missionId, nowIso, appendMissionAudit, type Row } from './database';
import { currentPolicy } from './policy';

/**
 * FREE MODE and the verified-revenue operating budget.
 *
 * The mission's hard operating rule, enforced here rather than documented:
 *
 *   FREE MODE → REAL WORK → VERIFIED REVENUE → OWNER-APPROVED OPERATING BUDGET
 *   → APPROVED RESOURCE PURCHASE → MORE CAPABILITY → MORE VERIFIED REVENUE
 *
 * It must never run the other way (owner money → buy everything → hope the
 * agents earn). Concretely:
 *
 *   - "Verified revenue" means a mission_revenue row that is BOTH received and
 *     independently verified (`status='received' AND verifier IS NOT NULL`).
 *     Expected, contracted, promised or self-reported amounts are worth zero
 *     here, so no agent can talk the mission into spending.
 *   - With no verified revenue the mission is in FREE MODE: every paid
 *     resource request is refused and RECORDED (mission_blocked_resources)
 *     instead of being silently bought or silently dropped. The agent is
 *     expected to continue with a free alternative or another free
 *     opportunity.
 *   - Spending only becomes possible when the owner explicitly approves an
 *     operating budget, and that budget can never exceed the verified revenue
 *     that has not already been committed. The budget is capped, revocable and
 *     audited.
 *   - This ledger is mission-only. AKBARAL! customer revenue and the owner's
 *     personal funds are different systems in a different database and can
 *     never appear here.
 */

export class MissionFundingError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, message: string, code: string) {
    super(message);
    this.name = 'MissionFundingError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type FundingMode = 'FREE_MODE' | 'FUNDED';

export interface FundingPosture {
  mode: FundingMode;
  currency: string;
  /** Received AND independently verified revenue. Nothing else counts. */
  verifiedRevenueCents: number;
  /** Revenue that exists but is not verified yet — explicitly NOT spendable. */
  unverifiedRevenueCents: number;
  /** Already committed: approved/paid expenses plus provisioned resource costs. */
  committedCents: number;
  /** Verified revenue that is neither committed nor already budgeted. */
  uncommittedVerifiedCents: number;
  /** Sum of active owner-approved operating budgets. */
  approvedBudgetCents: number;
  /** Remaining allowance inside those budgets. */
  budgetRemainingCents: number;
  /** True only when a real, owner-approved, revenue-backed allowance remains. */
  spendingUnlocked: boolean;
  /** Human-readable reason when spending is locked. */
  lockReason: string | null;
  blockedResourceCount: number;
  blockedResourceCostCents: number;
}

function int(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

/**
 * Received AND verified only. `verifier` is written by the settlement
 * verification path (provider record, bank statement or owner confirmation) —
 * never by the agent that did the work.
 */
export function verifiedRevenueCents(): number {
  const row = missionDb.get<Row>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM mission_revenue
      WHERE status = 'received' AND verifier IS NOT NULL AND TRIM(COALESCE(verifier, '')) <> ''`,
  );
  return int(row?.total);
}

export function unverifiedRevenueCents(): number {
  const row = missionDb.get<Row>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM mission_revenue
      WHERE status <> 'received' OR verifier IS NULL OR TRIM(COALESCE(verifier, '')) = ''`,
  );
  return int(row?.total);
}

/** Money already committed to real costs (approved/paid expenses + provisioned resources). */
export function committedCents(): number {
  const expenses = missionDb.get<Row>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM mission_expenses WHERE status IN ('approved','paid')`,
  );
  const resources = missionDb.get<Row>(
    `SELECT COALESCE(SUM(provisioned_cost_cents), 0) AS total FROM mission_resources WHERE provisioned_cost_cents IS NOT NULL`,
  );
  return int(expenses?.total) + int(resources?.total);
}

function activeBudgets(): Row[] {
  return missionDb.all<Row>(`SELECT * FROM mission_operating_budget WHERE status = 'active' ORDER BY approved_at ASC`);
}

export function fundingPosture(): FundingPosture {
  const policy = currentPolicy();
  const verified = verifiedRevenueCents();
  const committed = committedCents();
  const budgets = activeBudgets();
  const approvedBudget = budgets.reduce((total, row) => total + int(row.amount_cents), 0);
  const budgetRemaining = budgets.reduce((total, row) => total + Math.max(0, int(row.amount_cents) - int(row.spent_cents)), 0);
  const uncommitted = Math.max(0, verified - committed - approvedBudget);
  const blocked = missionDb.get<Row>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(estimated_cost_cents), 0) AS cost
       FROM mission_blocked_resources
      WHERE status IN ('blocked_no_verified_funds','blocked_free_tier_exhausted','owner_approval_requested')`,
  );

  let lockReason: string | null = null;
  if (verified <= 0) {
    lockReason =
      'FREE MODE: no externally received and independently verified mission revenue exists yet, so no money can be spent. ' +
      'Agents must keep working with free resources until real payment is received and verified.';
  } else if (budgetRemaining <= 0) {
    lockReason =
      `Verified revenue exists (${verified} minor units) but the owner has not approved an operating budget from it. ` +
      'Approve a capped operating budget to allow a specific purchase.';
  }

  return {
    mode: lockReason === null ? 'FUNDED' : 'FREE_MODE',
    currency: policy.currency,
    verifiedRevenueCents: verified,
    unverifiedRevenueCents: unverifiedRevenueCents(),
    committedCents: committed,
    uncommittedVerifiedCents: uncommitted,
    approvedBudgetCents: approvedBudget,
    budgetRemainingCents: budgetRemaining,
    spendingUnlocked: lockReason === null,
    lockReason,
    blockedResourceCount: int(blocked?.n),
    blockedResourceCostCents: int(blocked?.cost),
  };
}

/**
 * The single gate every real spending path must pass. Throws in FREE MODE.
 * `amountCents === 0` is always allowed: recording a free resource is not
 * spending.
 */
export function assertSpendingUnlocked(amountCents: number, what: string): void {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new MissionFundingError(400, 'amount must be a non-negative integer number of minor units', 'validation_error');
  }
  if (amountCents === 0) return;
  const posture = fundingPosture();
  if (!posture.spendingUnlocked) {
    throw new MissionFundingError(
      409,
      `${what} requires money the mission has not earned yet — ${posture.lockReason}`,
      posture.verifiedRevenueCents <= 0 ? 'free_mode_no_verified_revenue' : 'operating_budget_required',
    );
  }
  if (amountCents > posture.budgetRemainingCents) {
    throw new MissionFundingError(
      409,
      `${what} (${amountCents}) exceeds the remaining owner-approved operating budget (${posture.budgetRemainingCents}) backed by verified revenue`,
      'operating_budget_exceeded',
    );
  }
}

/** Owner-only: turn verified revenue into a capped, revocable spending allowance. */
export function approveOperatingBudget(input: {
  amountCents: number;
  purpose: string;
  actorId: string;
  actorType?: 'owner' | 'agent';
}): Row {
  if (input.actorType === 'agent') {
    throw new MissionFundingError(403, 'an agent cannot approve an operating budget — this decision belongs to the mission owner', 'forbidden');
  }
  const amount = input.amountCents;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new MissionFundingError(400, 'budget amount must be a positive integer number of minor units', 'validation_error');
  }
  const purpose = String(input.purpose ?? '').trim();
  if (purpose.length < 12 || purpose.length > 500) {
    throw new MissionFundingError(400, 'state a 12–500 character purpose for the operating budget', 'validation_error');
  }
  return missionDb.transaction(() => {
    const posture = fundingPosture();
    if (posture.verifiedRevenueCents <= 0) {
      throw new MissionFundingError(
        409,
        'no externally received and independently verified mission revenue exists — an operating budget cannot be created from money the mission has not earned',
        'free_mode_no_verified_revenue',
      );
    }
    if (amount > posture.uncommittedVerifiedCents) {
      throw new MissionFundingError(
        409,
        `budget ${amount} exceeds uncommitted verified revenue ${posture.uncommittedVerifiedCents}`,
        'insufficient_verified_revenue',
      );
    }
    const id = missionId('bdg');
    const now = nowIso();
    missionDb.run(
      `INSERT INTO mission_operating_budget (id, amount_cents, spent_cents, currency, backed_by_verified_revenue_cents, status, purpose, approved_by, approved_at, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      [id, amount, posture.currency, posture.verifiedRevenueCents, purpose, input.actorId, now, now, now],
    );
    appendMissionAudit({
      actorType: 'owner',
      actorId: input.actorId,
      action: 'funding.budget_approved',
      subjectType: 'operating_budget',
      subjectId: id,
      detail: { amountCents: amount, purpose, backedByVerifiedRevenueCents: posture.verifiedRevenueCents },
    });
    return missionDb.get<Row>('SELECT * FROM mission_operating_budget WHERE id = ?', [id])!;
  });
}

export function revokeOperatingBudget(input: { id: string; reason: string; actorId: string; actorType?: 'owner' | 'agent' }): Row {
  if (input.actorType === 'agent') {
    throw new MissionFundingError(403, 'an agent cannot revoke an operating budget', 'forbidden');
  }
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 4) throw new MissionFundingError(400, 'give a reason for revoking the budget', 'validation_error');
  return missionDb.transaction(() => {
    const row = missionDb.get<Row>('SELECT * FROM mission_operating_budget WHERE id = ?', [input.id]);
    if (!row) throw new MissionFundingError(404, 'operating budget not found', 'not_found');
    if (row.status !== 'active') throw new MissionFundingError(409, 'only an active operating budget can be revoked', 'conflict');
    missionDb.run('UPDATE mission_operating_budget SET status = ?, revoked_at = ?, revoked_reason = ?, updated_at = ? WHERE id = ?', [
      'revoked',
      nowIso(),
      reason,
      nowIso(),
      input.id,
    ]);
    appendMissionAudit({
      actorType: 'owner',
      actorId: input.actorId,
      action: 'funding.budget_revoked',
      subjectType: 'operating_budget',
      subjectId: input.id,
      detail: { reason },
    });
    return missionDb.get<Row>('SELECT * FROM mission_operating_budget WHERE id = ?', [input.id])!;
  });
}

/** Consume allowance when a real purchase happens. Called inside the spending transaction. */
export function consumeOperatingBudget(amountCents: number, reference: string): void {
  if (amountCents <= 0) return;
  let remaining = amountCents;
  for (const budget of activeBudgets()) {
    if (remaining <= 0) break;
    const available = Math.max(0, int(budget.amount_cents) - int(budget.spent_cents));
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    const spent = int(budget.spent_cents) + take;
    missionDb.run('UPDATE mission_operating_budget SET spent_cents = ?, status = ?, updated_at = ? WHERE id = ?', [
      spent,
      spent >= int(budget.amount_cents) ? 'exhausted' : 'active',
      nowIso(),
      budget.id,
    ]);
    remaining -= take;
  }
  if (remaining > 0) {
    throw new MissionFundingError(409, `no owner-approved operating budget covers ${reference}`, 'operating_budget_exceeded');
  }
}

export interface PaidResourceRequest {
  agentId?: string | null;
  opportunityId?: string | null;
  resourceKey: string;
  provider: string;
  kind: 'api' | 'storage' | 'compute' | 'database' | 'tool' | 'domain' | 'other';
  purpose: string;
  estimatedCostCents: number;
  /** A genuinely free path that achieves the same outcome, if one exists. */
  freeAlternative?: string | null;
  detail?: string | null;
}

export type PaidResourceDecision =
  | { decision: 'use_free_alternative'; freeAlternative: string; record: Row }
  | { decision: 'blocked'; reason: string; code: string; record: Row }
  | { decision: 'owner_approval_required'; budgetRemainingCents: number; record: Row };

/**
 * The single entry point an agent uses when a capability needs a resource that
 * is not free. It NEVER spends money and NEVER fails silently:
 *
 *   free alternative exists     → record it and tell the agent to use it
 *   FREE MODE (no verified $)   → record the blocked requirement, refuse
 *   verified funds + budget     → record it as needing explicit owner approval
 *
 * In all three cases the agent is expected to carry on with other legitimate
 * free work; the recorded rows are what the owner reads to decide whether real
 * earnings should be reinvested into this resource.
 */
export function requestPaidResource(input: PaidResourceRequest): PaidResourceDecision {
  const resourceKey = String(input.resourceKey ?? '').trim();
  const provider = String(input.provider ?? '').trim();
  const purpose = String(input.purpose ?? '').trim();
  if (resourceKey.length < 3 || provider.length < 2 || purpose.length < 8) {
    throw new MissionFundingError(400, 'resourceKey, provider and an 8+ character purpose are required', 'validation_error');
  }
  const cost = int(input.estimatedCostCents);
  if (cost < 0) throw new MissionFundingError(400, 'estimated cost cannot be negative', 'validation_error');
  const freeAlternative = input.freeAlternative ? String(input.freeAlternative).trim() : '';

  const posture = fundingPosture();
  const status = freeAlternative
    ? 'free_alternative_used'
    : posture.spendingUnlocked
      ? 'owner_approval_required'
      : posture.verifiedRevenueCents > 0
        ? 'blocked_no_verified_funds'
        : 'blocked_no_verified_funds';

  const record = upsertBlockedResource({
    agentId: input.agentId ?? null,
    opportunityId: input.opportunityId ?? null,
    resourceKey,
    provider,
    kind: input.kind,
    purpose,
    estimatedCostCents: cost,
    status,
    freeAlternative: freeAlternative || null,
    detail: input.detail ?? null,
  });

  if (freeAlternative) {
    return { decision: 'use_free_alternative', freeAlternative, record };
  }
  if (!posture.spendingUnlocked) {
    return {
      decision: 'blocked',
      reason: posture.lockReason ?? 'spending is locked',
      code: posture.verifiedRevenueCents <= 0 ? 'free_mode_no_verified_revenue' : 'operating_budget_required',
      record,
    };
  }
  return { decision: 'owner_approval_required', budgetRemainingCents: posture.budgetRemainingCents, record };
}

function upsertBlockedResource(input: {
  agentId: string | null;
  opportunityId: string | null;
  resourceKey: string;
  provider: string;
  kind: string;
  purpose: string;
  estimatedCostCents: number;
  status: string;
  freeAlternative: string | null;
  detail: string | null;
}): Row {
  return missionDb.transaction(() => {
    const existing = missionDb.get<Row>(
      `SELECT * FROM mission_blocked_resources
        WHERE resource_key = ? AND COALESCE(agent_id, '') = ? AND COALESCE(opportunity_id, '') = ?`,
      [input.resourceKey, input.agentId ?? '', input.opportunityId ?? ''],
    );
    const now = nowIso();
    if (existing) {
      missionDb.run(
        `UPDATE mission_blocked_resources
            SET occurrences = occurrences + 1, last_seen_at = ?, status = ?, estimated_cost_cents = ?,
                free_alternative = ?, detail = ?
          WHERE id = ?`,
        [now, input.status, input.estimatedCostCents, input.freeAlternative, input.detail, existing.id],
      );
      return missionDb.get<Row>('SELECT * FROM mission_blocked_resources WHERE id = ?', [existing.id])!;
    }
    const id = missionId('blk');
    missionDb.run(
      `INSERT INTO mission_blocked_resources
         (id, agent_id, opportunity_id, resource_key, provider, kind, purpose, estimated_cost_cents, status, free_alternative, detail, occurrences, first_seen_at, last_seen_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      [
        id,
        input.agentId,
        input.opportunityId,
        input.resourceKey,
        input.provider,
        input.kind,
        input.purpose,
        input.estimatedCostCents,
        input.status,
        input.freeAlternative,
        input.detail,
        now,
        now,
      ],
    );
    appendMissionAudit({
      actorType: 'agent',
      actorId: input.agentId ?? 'mission',
      action: input.freeAlternative ? 'funding.free_alternative_used' : 'funding.resource_blocked',
      subjectType: 'blocked_resource',
      subjectId: id,
      detail: {
        resourceKey: input.resourceKey,
        provider: input.provider,
        estimatedCostCents: input.estimatedCostCents,
        status: input.status,
        freeAlternative: input.freeAlternative,
      },
    });
    return missionDb.get<Row>('SELECT * FROM mission_blocked_resources WHERE id = ?', [id])!;
  });
}

export function listBlockedResources(limit = 100): Row[] {
  return missionDb.all<Row>(
    `SELECT * FROM mission_blocked_resources ORDER BY last_seen_at DESC LIMIT ?`,
    [Math.max(1, Math.min(500, limit))],
  );
}

export interface ReinvestmentPlanItem {
  resourceKey: string;
  provider: string;
  kind: string;
  estimatedCostCents: number;
  occurrences: number;
  agentsAffected: number;
  opportunitiesAffected: number;
  purpose: string;
  unlockedAtVerifiedRevenueCents: number;
  alreadyAffordable: boolean;
}

/**
 * What verified revenue would buy, cheapest-first. This is a PLAN, never an
 * instruction: nothing here is purchased without an explicit owner approval.
 */
export function reinvestmentPlan(): { posture: FundingPosture; items: ReinvestmentPlanItem[] } {
  const posture = fundingPosture();
  const rows = missionDb.all<Row>(
    `SELECT resource_key, provider, kind,
            MAX(estimated_cost_cents) AS cost,
            SUM(occurrences) AS occurrences,
            COUNT(DISTINCT COALESCE(agent_id, '')) AS agents,
            COUNT(DISTINCT COALESCE(opportunity_id, '')) AS opportunities,
            MIN(purpose) AS purpose
       FROM mission_blocked_resources
      WHERE status IN ('blocked_no_verified_funds','blocked_free_tier_exhausted','owner_approval_requested')
      GROUP BY resource_key, provider, kind
      ORDER BY cost ASC, occurrences DESC`,
  );
  let running = 0;
  const items = rows.map((row) => {
    running += int(row.cost);
    return {
      resourceKey: String(row.resource_key),
      provider: String(row.provider),
      kind: String(row.kind),
      estimatedCostCents: int(row.cost),
      occurrences: int(row.occurrences),
      agentsAffected: int(row.agents),
      opportunitiesAffected: int(row.opportunities),
      purpose: String(row.purpose ?? ''),
      unlockedAtVerifiedRevenueCents: running,
      alreadyAffordable: posture.budgetRemainingCents >= int(row.cost),
    };
  });
  return { posture, items };
}

/** Mark a recorded requirement as satisfied by an approved, provisioned resource. */
export function markBlockedResourceUnblocked(input: { id: string; resourceId: string; actorId: string }): Row {
  return missionDb.transaction(() => {
    const row = missionDb.get<Row>('SELECT * FROM mission_blocked_resources WHERE id = ?', [input.id]);
    if (!row) throw new MissionFundingError(404, 'blocked resource record not found', 'not_found');
    missionDb.run('UPDATE mission_blocked_resources SET status = ?, resource_id = ?, resolved_at = ? WHERE id = ?', [
      'unblocked',
      input.resourceId,
      nowIso(),
      input.id,
    ]);
    appendMissionAudit({
      actorType: 'owner',
      actorId: input.actorId,
      action: 'funding.resource_unblocked',
      subjectType: 'blocked_resource',
      subjectId: input.id,
      detail: { resourceId: input.resourceId },
    });
    return missionDb.get<Row>('SELECT * FROM mission_blocked_resources WHERE id = ?', [input.id])!;
  });
}
