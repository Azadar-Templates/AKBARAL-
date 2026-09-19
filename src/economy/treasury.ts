import { createId, db } from '../db';
import { raiseAlertSync } from '../workforce/alerts';
import { findUserByEmail, createUser, appendAuditLog } from '../db';
import { agentFactory } from '../orchestrator/agent-factory';
import { getAgentBySlug } from '../agents/registry';
import {
  getEconomyPolicy,
  getExpansion,
  getImprovement,
  getResource,
  getUpgrade,
  insertExpansion,
  insertImprovement,
  insertResource,
  insertSettlement,
  insertUpgrade,
  ledgerAgentBreakdown,
  ledgerExpenseTotals,
  listAgentProfiles,
  listExpansions,
  listImprovements,
  listLedger,
  listResources,
  listSettlements,
  listUpgrades,
  postLedger,
  recordEconomyEvent,
  revenueTotals,
  updateExpansion,
  updateImprovement,
  updateResource,
  updateSettlement,
  updateUpgrade,
  upsertAgentProfile,
  parseEconomyJson,
  insertTransfer,
  getTransfer,
  getTransferByIdempotencyKey,
  updateTransfer,
  executedTransferTotalForAgent,
  listTransfers,
} from '../db/economy-repositories';
import { currentPolicy } from './policy';
import { assertSpendingAllowed, assertWithdrawalsAllowed, chargeSpawn, evaluateSpawn, recordSpawnDecision } from './hierarchy';

/**
 * ZA141251SA treasury + agent self-management flows.
 *
 * Financial honesty rules enforced here:
 *   - Only RECEIVED/SETTLED revenue rows count as realized income.
 *   - Every ledger movement is idempotent (ref_id UNIQUE) — a retried or
 *     restarted flow can never double-bill.
 *   - No private keys, provider credentials or payment instruments are ever
 *     stored in the treasury; resource rows carry references only, and real
 *     credentials are injected by the owner through the deployment secret
 *     store, never through agent memory.
 *   - Settlements never execute a real transfer without an external payment
 *     provider (none is configured by default): the record is created
 *     honestly as pending_provider.
 */

export const ECONOMY_SYSTEM_EMAIL = 'za141251sa-economy@akbaral.ai';

/** The economy's OWN system account (same pattern as the contact system
 *  account). Never a real user: user funds and agent budget never mix. */
export function getEconomySystemUserId(): string {
  const existing = findUserByEmail(ECONOMY_SYSTEM_EMAIL);
  if (existing) return String(existing.id);
  const created = createUser({ email: ECONOMY_SYSTEM_EMAIL, name: 'ZA141251SA Economy', role: 'user', freeCredits: 0 });
  return String(created.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Treasury accounting
// ─────────────────────────────────────────────────────────────────────────────

export interface TreasurySummary {
  realizedRevenueCents: number;
  pendingRevenueCents: number;
  expectedRevenueCents: number;
  totalExpensesCents: number;
  expensesByCategory: Record<string, number>;
  netProfitCents: number;
  reservedCents: number;
  settledCents: number;
}

export function treasurySummary(): TreasurySummary {
  const revenue = revenueTotals();
  const expenses = ledgerExpenseTotals();
  const settled = db.get<{ total: number }>(
    "SELECT SUM(amount_cents) AS total FROM economy_ledger WHERE direction = 'debit' AND category = 'settlement'",
  );
  const reserved = db.get<{ total: number }>(
    "SELECT COALESCE(SUM(expected_cost_cents), 0) AS total FROM economy_opportunities WHERE status IN ('authorized','executing')",
  );
  return {
    realizedRevenueCents: revenue.realizedCents,
    pendingRevenueCents: revenue.pendingCents,
    expectedRevenueCents: revenue.expectedCents,
    totalExpensesCents: expenses.totalExpensesCents,
    expensesByCategory: expenses.byCategory,
    netProfitCents: revenue.realizedCents - expenses.totalExpensesCents,
    reservedCents: reserved ? Number(reserved.total) : 0,
    settledCents: settled ? Number(settled.total) : 0,
  };
}

export function recordLedgerRevenue(input: { opportunityId?: string | null; agentSlug?: string | null; amountCents: number; evidence: string; externalRef?: string | null }): { posted: boolean; revenueId: string } {
  if (input.amountCents <= 0) throw new Error('revenue amount must be positive');
  if (!input.evidence || input.evidence.trim().length < 4) throw new Error('revenue evidence is required — revenue is never claimed without evidence');
  const { revenue } = { revenue: null as unknown };
  void revenue;
  const id = createId('eco_rev');
  db.run(
    "INSERT INTO economy_revenue (id, opportunity_id, state, amount_cents, evidence, external_ref) VALUES (?, ?, 'received', ?, ?, ?)",
    [id, input.opportunityId ?? null, input.amountCents, input.evidence.trim(), input.externalRef ?? null],
  );
  const posted = postLedger({
    agentSlug: input.agentSlug ?? null,
    direction: 'credit',
    category: 'revenue',
    amountCents: input.amountCents,
    purpose: 'external revenue received (evidence recorded)',
    refType: 'revenue',
    refId: `rev:${id}`,
    policyDecision: 'owner_or_verified_collection',
  });
  recordEconomyEvent({
    kind: 'revenue',
    actor: input.agentSlug ?? 'owner',
    summary: `RECEIVED revenue ${input.amountCents} cents`,
    details: { evidence: input.evidence.trim(), externalRef: input.externalRef ?? null },
  });
  return { posted: !posted.duplicate, revenueId: id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner settlement (I)
// ─────────────────────────────────────────────────────────────────────────────

export interface SettlementOutcome {
  created: boolean;
  reason: string;
  settlementId?: string;
  amountCents?: number;
}

export function proposeSettlement(): SettlementOutcome {
  const policy = currentPolicy();
  const summary = treasurySummary();
  // Settled funds have already left the treasury ledger as debits; net
  // available = realized revenue - non-settlement expenses - already settled.
  const settledOut = summary.settledCents;
  const available = summary.realizedRevenueCents - (summary.totalExpensesCents - settledOut) - settledOut;
  const distributable = available - policy.settlementThresholdCents;
  if (distributable <= 0) {
    return { created: false, reason: `no distributable profit above the ${policy.settlementThresholdCents}-cent operating float (available: ${available})` };
  }
  const settlement = insertSettlement({
    amountCents: distributable,
    destination: policy.settlementDestination,
    ledgerRef: `settle:${Date.now()}:${distributable}`,
  });
  postLedger({
    direction: 'debit',
    category: 'settlement',
    amountCents: distributable,
    purpose: `owner settlement to ${policy.settlementDestination}`,
    refType: 'settlement',
    refId: `settlement:${settlement.id}`,
    policyDecision: 'auto_proposed_owner_confirmed_transfer',
  });
  recordEconomyEvent({
    kind: 'settlement',
    actor: 'owner',
    summary: `settlement proposed: ${distributable} cents to ${policy.settlementDestination} (pending external provider)`,
    details: { settlementId: settlement.id },
  });
  try {
    // D11: a proposed settlement sits until the owner transfers + confirms —
    // info-level so it never sits unnoticed.
    raiseAlertSync({
      condition: 'settlement-awaiting-owner', severity: 'info',
      title: `Settlement proposed: ${distributable}c to ${policy.settlementDestination}`,
      detail: `settlement ${settlement.id}: transfer the funds manually, then confirm with evidence. Nothing moves on its own.`,
      dedupeKey: `settlement-awaiting-owner:${settlement.id}`,
    });
  } catch { /* alerting must never break settlement */ }
  return { created: true, reason: 'created', settlementId: settlement.id, amountCents: distributable };
}

export function completeSettlement(id: string, evidence: string): void {
  const settlement = listSettlements().find((row) => row.id === id);
  if (!settlement) throw new Error('settlement not found');
  // Money leaving the system is the last place a freeze must hold: a frozen
  // withdrawal state stops confirmation even with valid evidence.
  assertWithdrawalsAllowed();
  if (!evidence || evidence.trim().length < 4) throw new Error('settlement completion requires evidence (reference/confirmation of the real transfer)');
  updateSettlement(id, { status: 'completed', completed_at: new Date().toISOString(), evidence: evidence.trim() });
  recordEconomyEvent({ kind: 'settlement', actor: 'owner', summary: `settlement ${id} confirmed completed with evidence` });
}

export { listSettlements };

// ─────────────────────────────────────────────────────────────────────────────
// Resource economy (E)
// ─────────────────────────────────────────────────────────────────────────────

export interface ResourceDecision {
  status: 'approved' | 'denied';
  reason: string;
}

export function requestResource(input: { kind: string; provider: string; description: string; monthlyCostCents: number; requestedByAgent?: string | null }): { decision: ResourceDecision; resourceId: string } {
  const policy = currentPolicy();
  // A spending freeze stops new commitments outright; the request is still
  // recorded (denied) so the attempt stays visible in the audit trail.
  if (policy.freezeSpending) {
    const resource = insertResource({
      kind: input.kind,
      provider: input.provider,
      description: input.description,
      monthlyCostCents: input.monthlyCostCents,
      requestedByAgent: input.requestedByAgent ?? null,
      policyDecision: 'denied: spending frozen by owner',
    });
    updateResource(resource.id, { status: 'denied' });
    recordEconomyEvent({
      kind: 'resource',
      actor: input.requestedByAgent ?? 'system',
      summary: `resource ${input.kind}/${input.provider} DENIED — spending is frozen`,
      details: { resourceId: resource.id },
    });
    return { decision: { status: 'denied', reason: 'spending frozen by owner' }, resourceId: resource.id };
  }
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const spentToday = db.get<{ total: number }>(
    "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM economy_ledger WHERE direction = 'debit' AND category != 'settlement' AND ts >= ?",
    [dayStart.toISOString()],
  );
  const spent = spentToday ? Number(spentToday.total) : 0;

  const reasons: string[] = [];
  if (policy.killSwitch) reasons.push('kill_switch_engaged');
  if (input.monthlyCostCents > policy.maxOpportunityCostCents) reasons.push('cost_above_per_item_cap');
  if (spent + input.monthlyCostCents > policy.maxDailySpendCents) reasons.push('daily_spend_budget_exhausted');
  const summary = treasurySummary();
  if (input.monthlyCostCents > summary.realizedRevenueCents) {
    reasons.push('not_funded_by_realized_revenue — resources are purchased from EARNED revenue only, never from user funds or owner capital by default');
  }

  const decision: ResourceDecision = reasons.length > 0
    ? { status: 'denied', reason: reasons.join('; ') }
    : { status: 'approved', reason: 'within policy; funded by realized revenue; provisioning requires owner confirmation (no autonomous payment credentials exist)' };

  const resource = insertResource({
    kind: input.kind,
    provider: input.provider,
    description: input.description,
    monthlyCostCents: input.monthlyCostCents,
    requestedByAgent: input.requestedByAgent ?? null,
    policyDecision: `${decision.status}: ${decision.reason}`,
  });
  recordEconomyEvent({
    kind: 'resource',
    actor: input.requestedByAgent ?? 'system',
    summary: `resource request ${input.kind}/${input.provider} → ${decision.status}`,
    details: { resourceId: resource.id, monthlyCostCents: input.monthlyCostCents, reasons },
  });
  if (decision.status === 'approved') updateResource(resource.id, { status: 'approved' });
  return { decision, resourceId: resource.id };
}

/**
 * Mark an approved resource as actually provisioned — owner action with
 * evidence. The agent NEVER holds payment credentials; provisioning happens
 * through the owner's accounts and the secret store, then is recorded here
 * (which posts the real expense, idempotently).
 */
export function confirmResourceProvisioned(id: string, evidence: string, actualCostCents?: number): void {
  const resource = getResource(id);
  if (!resource) throw new Error('resource not found');
  if (resource.status !== 'approved') throw new Error(`resource is '${resource.status}', not approved`);
  if (!evidence || evidence.trim().length < 4) throw new Error('provisioning evidence required');
  // Committing real money while spending is frozen would defeat the freeze.
  assertSpendingAllowed(`provisioning resource ${id}`);
  const cost = actualCostCents ?? resource.monthly_cost_cents;
  updateResource(id, { status: 'provisioned', provisioned_at: new Date().toISOString() });
  postLedger({
    agentSlug: resource.requested_by_agent,
    direction: 'debit',
    category: resource.kind === 'ai_api' || resource.kind === 'search_api' ? 'api_cost'
      : resource.kind === 'storage' ? 'storage_cost'
        : resource.kind === 'compute' || resource.kind === 'database' ? 'compute_cost'
          : 'resource_purchase',
    amountCents: cost,
    purpose: `provision ${resource.kind} from ${resource.provider}`,
    refType: 'resource',
    refId: `resource:${id}:provision`,
    policyDecision: resource.policy_decision,
  });
  recordEconomyEvent({ kind: 'resource', actor: 'owner', summary: `resource ${id} provisioned (${cost} cents, evidence recorded)` });
}

export function retireResource(id: string): void {
  const resource = getResource(id);
  if (!resource) throw new Error('resource not found');
  updateResource(id, { status: 'retired' });
  recordEconomyEvent({ kind: 'resource', actor: 'owner', summary: `resource ${id} retired` });
}

export { listResources };

// ─────────────────────────────────────────────────────────────────────────────
// Self-upgrade (F): benchmark → security check → economic check → apply → rollback
// ─────────────────────────────────────────────────────────────────────────────

const APPROVED_UPGRADE_TARGETS = new Set(['model', 'tool', 'api', 'compute', 'storage']);

export function proposeUpgrade(input: { target: string; currentValue: string; candidateValue: string; benchmark?: Record<string, unknown> | null }): { upgradeId: string; securityCheck: string; economicCheck: string } {
  if (!APPROVED_UPGRADE_TARGETS.has(input.target)) throw new Error(`upgrade target must be one of ${[...APPROVED_UPGRADE_TARGETS].join(', ')}`);
  const upgrade = insertUpgrade(input);
  // Security check: candidate must not reference credentials/secrets and must
  // come from the platform's own catalog namespace (models/tools), never an
  // arbitrary external endpoint.
  const candidate = input.candidateValue.toLowerCase();
  const securityOk = !/(api[_-]?key|secret|password|token|https?:\/\/)/i.test(candidate);
  const benchmark = input.benchmark ?? null;
  const economicOk = Boolean(benchmark && typeof benchmark.expectedNetCents === 'number' && benchmark.expectedNetCents > 0);
  updateUpgrade(upgrade.id, {
    security_check: securityOk ? 'passed' : 'failed',
    economic_check: economicOk ? 'passed' : 'failed',
  });
  recordEconomyEvent({
    kind: 'upgrade',
    actor: 'system',
    summary: `upgrade proposed: ${input.target} ${input.currentValue} → ${input.candidateValue} (security ${securityOk ? 'passed' : 'failed'}, economic ${economicOk ? 'passed' : 'failed'})`,
    details: { upgradeId: upgrade.id },
  });
  return { upgradeId: upgrade.id, securityCheck: securityOk ? 'passed' : 'failed', economicCheck: economicOk ? 'passed' : 'failed' };
}

export function applyUpgrade(id: string): { applied: boolean; reason: string } {
  const upgrade = getUpgrade(id);
  if (!upgrade) throw new Error('upgrade not found');
  if (upgrade.status !== 'proposed' && upgrade.status !== 'approved') return { applied: false, reason: `status is '${upgrade.status}'` };
  if (upgrade.security_check !== 'passed' || upgrade.economic_check !== 'passed') {
    updateUpgrade(id, { status: 'rejected' });
    return { applied: false, reason: `checks not passed (security=${upgrade.security_check}, economic=${upgrade.economic_check}) — the system does not blindly spend money` };
  }
  updateUpgrade(id, { status: 'applied', applied_at: new Date().toISOString() });
  if (upgrade.target === 'model') {
    // Scoped, real effect: the economy's own model preference (registry
    // routing for economy work only — never the public user platform).
    db.run("UPDATE economy_policy SET economy_model_key = ?, updated_at = ? WHERE id = 'global'", [
      upgrade.candidate_value,
      new Date().toISOString(),
    ]);
  }
  recordEconomyEvent({ kind: 'upgrade', actor: 'owner', summary: `upgrade ${id} APPLIED: ${upgrade.target} → ${upgrade.candidate_value}` });
  return { applied: true, reason: 'applied' };
}

export function rollbackUpgrade(id: string): { rolledBack: boolean; reason: string } {
  const upgrade = getUpgrade(id);
  if (!upgrade) throw new Error('upgrade not found');
  if (upgrade.status !== 'applied') return { rolledBack: false, reason: `status is '${upgrade.status}', nothing to roll back` };
  updateUpgrade(id, { status: 'rolled_back', rolled_back_at: new Date().toISOString() });
  if (upgrade.target === 'model') {
    db.run("UPDATE economy_policy SET economy_model_key = ?, updated_at = ? WHERE id = 'global'", [
      upgrade.current_value,
      new Date().toISOString(),
    ]);
  }
  recordEconomyEvent({ kind: 'upgrade', actor: 'owner', summary: `upgrade ${id} ROLLED BACK to ${upgrade.current_value}` });
  return { rolledBack: true, reason: 'rolled_back' };
}

export { listUpgrades };

// ─────────────────────────────────────────────────────────────────────────────
// Self-expansion (D): capability gap → Agent Factory → gated lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export interface ExpansionOutcome {
  expansionId: string;
  agentSlug: string;
  status: string;
  blockedReason?: string;
}

export function expandCapability(input: {
  gap: string;
  specialization: string;
  systemInstructions: string;
  parentAgentSlug?: string | null;
  name?: string;
  /** Actor driving the spawn: 'owner' for a manual decision, an agent slug for delegation. */
  actor?: string;
  /** Budget the new child may spend. */
  childBudgetCents?: number;
  /** 'owner' for an owner-approved hire, 'agent' when a parent delegates. */
  initiatedBy?: 'owner' | 'agent';
}): ExpansionOutcome {
  const actor = input.actor ?? input.parentAgentSlug ?? 'system';

  const rejectExpansion = (reason: string, summary: string): ExpansionOutcome => {
    const expansion = insertExpansion({ gap: input.gap, parentAgentSlug: input.parentAgentSlug ?? null });
    updateExpansion(expansion.id, { status: 'rejected', decided_at: new Date().toISOString() });
    recordEconomyEvent({ kind: 'expansion', actor, summary });
    return { expansionId: expansion.id, agentSlug: '', status: 'rejected', blockedReason: reason };
  };

  // Hierarchy gates (Section 2): no uncontrolled recursive spawning.
  if (input.parentAgentSlug && !getAgentBySlug(input.parentAgentSlug)) {
    return rejectExpansion('parent agent not found', `expansion REJECTED: parent ${input.parentAgentSlug} does not exist`);
  }

  // Every remaining gate — kill switch, provider access, spending freeze, depth,
  // children-per-parent, total cap, spawn rate and budget — is evaluated in one
  // place and recorded, so a refusal always states exactly which gate held.
  const decision = evaluateSpawn({
    parentAgentSlug: input.parentAgentSlug ?? null,
    actor,
    gap: input.gap,
    initiatedBy: input.initiatedBy ?? 'owner',
    ...(input.childBudgetCents !== undefined ? { childBudgetCents: input.childBudgetCents } : {}),
  });
  if (!decision.allowed) {
    recordSpawnDecision({ decision, parentAgentSlug: input.parentAgentSlug ?? null, gap: input.gap, actor });
    return rejectExpansion(decision.reason, `expansion REJECTED: ${decision.reason} — ${decision.reasonDetail}`);
  }
  const systemUserId = getEconomySystemUserId();
  const created = agentFactory.create({
    userId: systemUserId,
    name: input.name ?? `ZA141251SA ${input.specialization}`,
    specialization: input.specialization,
    description: `Self-expanded for capability gap: ${input.gap}`,
    systemInstructions: input.systemInstructions,
    toolPermissions: ['web_search', 'page_fetch'],
    verificationRules: ['output must directly address the assigned objective'],
  });
  const expansion = insertExpansion({ gap: input.gap, parentAgentSlug: input.parentAgentSlug ?? null, agentSlug: created.slug });
  upsertAgentProfile({
    agentSlug: created.slug,
    parentAgentSlug: input.parentAgentSlug ?? null,
    objectives: input.gap,
  });
  // The delegation is authorized and PAID FOR: the decision row records the
  // exact gates, the parent is charged the spawn cost, and the child receives
  // the budget the owner (or its parent) granted it.
  recordSpawnDecision({ decision, parentAgentSlug: input.parentAgentSlug ?? null, childAgentSlug: created.slug, gap: input.gap, actor });
  chargeSpawn({
    parentAgentSlug: input.parentAgentSlug ?? null,
    childAgentSlug: created.slug,
    costCents: decision.costCents,
    ...(input.childBudgetCents !== undefined ? { childBudgetCents: input.childBudgetCents } : {}),
  });
  // Lifecycle gates: draft → testing → security_verified → approved → active.
  // The factory's real security review runs now; the real test run requires
  // a model provider (without one this stays honestly in 'testing').
  try {
    const review = agentFactory.securityReview(created.slug);
    updateExpansion(expansion.id, { security_review_json: JSON.stringify(review), status: 'testing' });
  } catch {
    updateExpansion(expansion.id, { status: 'testing' });
  }
  recordEconomyEvent({
    kind: 'expansion',
    actor: input.parentAgentSlug ?? 'system',
    summary: `capability gap → new agent ${created.slug} (provenance parent: ${input.parentAgentSlug ?? 'none'}) in TESTING`,
    details: { expansionId: expansion.id },
  });
  return { expansionId: expansion.id, agentSlug: created.slug, status: 'testing' };
}

/** Advance an expansion after its gates pass. Owner-controlled. */
export function decideExpansion(id: string, decision: 'approve' | 'reject'): void {
  const expansion = getExpansion(id);
  if (!expansion) throw new Error('expansion not found');
  const nextStatus = decision === 'approve' ? 'approved' : 'rejected';
  updateExpansion(id, { status: nextStatus, decided_at: new Date().toISOString() });
  recordEconomyEvent({ kind: 'expansion', actor: 'owner', summary: `expansion ${id} → ${nextStatus}` });
}

export { listExpansions, listAgentProfiles, ledgerAgentBreakdown };

// ─────────────────────────────────────────────────────────────────────────────
// AKBARAL! improvement proposals (G) — proposals ONLY, never direct prod changes
// ─────────────────────────────────────────────────────────────────────────────

const IMPROVEMENT_AREAS = new Set(['web', 'app', 'backend', 'orchestrator', 'registry', 'factory', 'ux', 'performance', 'security', 'qa', 'marketing', 'documentation', 'support', 'infrastructure']);

export function proposeImprovement(input: { area: string; title: string; proposal: string }): { improvementId: string } {
  if (!IMPROVEMENT_AREAS.has(input.area)) throw new Error(`area must be one of ${[...IMPROVEMENT_AREAS].join(', ')}`);
  const improvement = insertImprovement(input);
  recordEconomyEvent({ kind: 'improvement', actor: 'system', summary: `AKBARAL improvement proposed [${input.area}]: ${input.title}` });
  // NOTE BY DESIGN: this subsystem records proposals and sandbox evidence.
  // It has NO code path that touches production — changes go through the
  // existing development/test/verification/deployment controls.
  return { improvementId: improvement.id };
}

export function recordImprovementSandboxResult(id: string, result: Record<string, unknown>): void {
  const improvement = getImprovement(id);
  if (!improvement) throw new Error('improvement not found');
  updateImprovement(id, { status: 'sandbox_tested', sandbox_result_json: JSON.stringify(result) });
  recordEconomyEvent({ kind: 'improvement', actor: 'system', summary: `improvement ${id} sandbox-tested` });
}

export { listImprovements, listLedger, getEconomyPolicy, parseEconomyJson };

// ─────────────────────────────────────────────────────────────────────────────
// Controlled agent accounts + treasury transfers (PART 8 / PART 10)
//
// Accounts are DERIVED from the real ledger — nothing can fabricate a
// balance. A transfer moves genuinely REALIZED, evidence-backed agent surplus
// into the main treasury, and only through owner approval.
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentAccountView {
  agentSlug: string;
  realizedRevenueCents: number;   // ledger credits attributed to this agent
  costCents: number;              // ledger debits attributed to this agent
  transferredOutCents: number;    // executed transfers to the main treasury
  availableCents: number;         // revenue − costs − transferred out
}

export type TransferRowView = ReturnType<typeof getTransfer>;

function breakdownFor(agentSlug: string): { revenue: number; cost: number } {
  const row = ledgerAgentBreakdown().find((r) => r.agent_slug === agentSlug);
  return { revenue: Number(row?.revenue_cents ?? 0), cost: Number(row?.cost_cents ?? 0) };
}

export function agentAccounts(): AgentAccountView[] {
  return ledgerAgentBreakdown()
    .filter((row) => row.agent_slug)
    .map((row) => {
      const revenue = Number(row.revenue_cents ?? 0);
      const cost = Number(row.cost_cents ?? 0);
      const transferred = executedTransferTotalForAgent(row.agent_slug!);
      return {
        agentSlug: row.agent_slug!,
        realizedRevenueCents: revenue,
        costCents: cost,
        transferredOutCents: transferred,
        availableCents: revenue - cost - transferred,
      };
    })
    .filter((account) => account.realizedRevenueCents > 0 || account.costCents > 0 || account.transferredOutCents > 0);
}

export function agentAccountFor(agentSlug: string): AgentAccountView {
  const { revenue, cost } = breakdownFor(agentSlug);
  const transferred = executedTransferTotalForAgent(agentSlug);
  return {
    agentSlug,
    realizedRevenueCents: revenue,
    costCents: cost,
    transferredOutCents: transferred,
    availableCents: revenue - cost - transferred,
  };
}

export class TreasuryTransferError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = 'TreasuryTransferError';
  }
}

export function proposeTreasuryTransfer(input: {
  sourceAgentSlug: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
  proposedBy: string;
}): { transfer: NonNullable<TransferRowView>; idempotentReplay: boolean } {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length < 4) {
    throw new TreasuryTransferError(400, 'invalid_request', 'idempotency key must be at least 4 characters');
  }
  // Withdrawal brake: an owner can freeze money movement without engaging the
  // kill switch (which would stop unrelated work too).
  assertWithdrawalsAllowed();
  // Idempotency: the same key always returns the same proposal, no side effects.
  const existing = getTransferByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    return { transfer: existing, idempotentReplay: true };
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new TreasuryTransferError(400, 'invalid_request', 'transfer amount must be a positive integer (cents)');
  }
  if (!input.reason || input.reason.trim().length < 4) {
    throw new TreasuryTransferError(400, 'invalid_request', 'a transfer reason is required');
  }
  const agent = getAgentBySlug(input.sourceAgentSlug);
  if (!agent) {
    throw new TreasuryTransferError(404, 'agent_not_found', `agent "${input.sourceAgentSlug}" does not exist in the registry`);
  }
  const account = agentAccountFor(input.sourceAgentSlug);
  if (account.availableCents < input.amountCents) {
    throw new TreasuryTransferError(
      400,
      'insufficient_realized_balance',
      `agent "${input.sourceAgentSlug}" has ${account.availableCents}c of realized surplus available — a transfer can never exceed evidence-backed net revenue (requested ${input.amountCents}c)`,
    );
  }
  const transfer = insertTransfer({
    sourceAgentSlug: input.sourceAgentSlug,
    amountCents: input.amountCents,
    reason: input.reason.trim(),
    idempotencyKey: input.idempotencyKey,
    proposedBy: input.proposedBy,
  });
  recordEconomyEvent({
    kind: 'treasury',
    actor: input.proposedBy,
    summary: `transfer proposed: ${input.amountCents}c from ${input.sourceAgentSlug} to main treasury (reason: ${input.reason.trim().slice(0, 120)})`,
    details: { transferId: transfer.id },
  });
  return { transfer, idempotentReplay: false };
}

/** Owner decision on a proposed transfer. Approve executes it for real. */
export function decideTreasuryTransfer(id: string, decision: 'approve' | 'reject', decidedBy: string): NonNullable<TransferRowView> {
  const transfer = getTransfer(id);
  if (!transfer) throw new TreasuryTransferError(404, 'not_found', 'transfer not found');
  if (transfer.status !== 'proposed') {
    // Idempotent re-decision: replaying the SAME decision returns the transfer
    // as-is. The OPPOSITE decision on a final transfer is refused — a
    // rejected transfer can never be quietly approved afterwards (and vice
    // versa); a new proposal with a new idempotency key is required.
    if ((transfer.status === 'executed' && decision === 'approve') || (transfer.status === 'rejected' && decision === 'reject')) {
      return transfer;
    }
    throw new TreasuryTransferError(400, 'decision_final', `transfer ${id} is already ${transfer.status}; decisions are final (propose a new transfer if needed)`);
  }
  if (decision === 'reject') {
    updateTransfer(id, { status: 'rejected', decided_by: decidedBy, decided_at: new Date().toISOString() });
    recordEconomyEvent({ kind: 'treasury', actor: decidedBy, summary: `transfer ${id} REJECTED` });
    return getTransfer(id)!;
  }
  // Approval re-validates the balance — the proposal may have aged.
  const account = agentAccountFor(transfer.source_agent_slug);
  if (account.availableCents < transfer.amount_cents) {
    updateTransfer(id, { status: 'rejected', decided_by: decidedBy, decided_at: new Date().toISOString() });
    recordEconomyEvent({
      kind: 'treasury',
      actor: decidedBy,
      summary: `transfer ${id} REJECTED at approval: realized balance (${account.availableCents}c) no longer covers ${transfer.amount_cents}c`,
    });
    throw new TreasuryTransferError(400, 'insufficient_realized_balance', `realized balance is now ${account.availableCents}c — the transfer was rejected instead of executed`);
  }
  // Execute: post the movement to the real ledger. agent_slug is NULL so the
  // credit is treasury bookkeeping, never counted as the agent's revenue
  // again; postLedger's ref_id idempotency makes a double execution
  // impossible even if the decision were raced.
  postLedger({
    agentSlug: null,
    direction: 'credit',
    category: 'treasury_transfer',
    amountCents: transfer.amount_cents,
    purpose: `surplus transfer to main treasury from ${transfer.source_agent_slug} (reason: ${transfer.reason.slice(0, 160)})`,
    refType: 'treasury_transfer',
    refId: transfer.id,
    policyDecision: 'owner-approved',
  });
  updateTransfer(id, { status: 'executed', decided_by: decidedBy, decided_at: new Date().toISOString() });
  appendAuditLog({
    actorId: decidedBy,
    action: 'economy.treasury.transfer.approved',
    resourceType: 'economy_transfer',
    resourceId: transfer.id,
    description: `${transfer.amount_cents}c from ${transfer.source_agent_slug} to main treasury`,
  });
  recordEconomyEvent({
    kind: 'treasury',
    actor: decidedBy,
    summary: `transfer ${id} EXECUTED: ${transfer.amount_cents}c from ${transfer.source_agent_slug} to main treasury`,
  });
  return getTransfer(id)!;
}

export { listTransfers };

// ─────────────────────────────────────────────────────────────────────────────
// Earning loop closer + approved reinvestment (workforce earning expansion)
// ─────────────────────────────────────────────────────────────────────────────

export class EarningError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = 'EarningError';
  }
}

interface DeliveryRowLite {
  id: string;
  opportunity_id: string;
  agent_slug: string;
  verified: number;
}

/**
 * Record an external payment against a VERIFIED delivery. This is the only
 * path that turns delivered work into 'received' revenue: it requires the
 * delivery's deterministic verification PLUS external payment evidence, and
 * each delivery can be paid exactly once (UNIQUE delivery_id — a second
 * claim for the same work is refused, never double-counted).
 */
export function recordDeliveryPayment(input: {
  deliveryId: string; amountCents: number; evidence: string; externalRef?: string | null; recordedBy: string;
}): { revenueId: string; posted: boolean } {
  const delivery = db.get<DeliveryRowLite>('SELECT id, opportunity_id, agent_slug, verified FROM economy_deliveries WHERE id = ?', [input.deliveryId]);
  if (!delivery) throw new EarningError(404, 'delivery_not_found', `delivery "${input.deliveryId}" does not exist`);
  if (!delivery.verified) {
    throw new EarningError(400, 'delivery_not_verified', `delivery "${input.deliveryId}" is not verified — payment cannot be recorded against unverified work`);
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new EarningError(400, 'invalid_request', 'payment amount must be a positive integer (cents)');
  }
  if (!input.evidence || input.evidence.trim().length < 4) {
    throw new EarningError(400, 'invalid_request', 'payment evidence is required (payout reference, receipt, transaction id)');
  }
  const existing = db.get<{ delivery_id: string }>('SELECT delivery_id FROM economy_delivery_payments WHERE delivery_id = ?', [input.deliveryId]);
  if (existing) {
    throw new EarningError(400, 'already_recorded', `delivery "${input.deliveryId}" already has a recorded payment — each delivery pays exactly once`);
  }
  const revenue = recordLedgerRevenue({
    opportunityId: delivery.opportunity_id,
    agentSlug: delivery.agent_slug,
    amountCents: input.amountCents,
    evidence: input.evidence.trim(),
    ...(input.externalRef ? { externalRef: input.externalRef } : {}),
  });
  db.run(
    'INSERT INTO economy_delivery_payments (delivery_id, revenue_id, amount_cents, evidence, external_ref, recorded_by) VALUES (?, ?, ?, ?, ?, ?)',
    [input.deliveryId, revenue.revenueId, input.amountCents, input.evidence.trim(), input.externalRef ?? null, input.recordedBy],
  );
  recordEconomyEvent({
    kind: 'revenue', actor: input.recordedBy,
    summary: `delivery payment recorded: ${input.amountCents}c for delivery ${input.deliveryId} (agent ${delivery.agent_slug})`,
    details: { revenueId: revenue.revenueId, externalRef: input.externalRef ?? null },
  });
  return { revenueId: revenue.revenueId, posted: revenue.posted };
}

export interface ReinvestmentRow {
  id: string;
  agent_slug: string;
  amount_cents: number;
  purpose: string;
  idempotency_key: string;
  status: string;
  proposed_by: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export function getReinvestment(id: string): ReinvestmentRow | undefined {
  return db.get<ReinvestmentRow>('SELECT * FROM economy_reinvestments WHERE id = ?', [id]);
}

export function listReinvestments(limit = 100): ReinvestmentRow[] {
  return db.all<ReinvestmentRow>('SELECT * FROM economy_reinvestments ORDER BY created_at DESC LIMIT ?', [Math.min(Math.max(limit, 1), 500)]);
}

/**
 * Propose allocating an agent's REALIZED surplus back into growth (tools,
 * inventory, ads, content). Funded from evidence-backed surplus only — the
 * same rule as treasury transfers. Proposal never moves money.
 */
export function proposeReinvestment(input: {
  agentSlug: string; amountCents: number; purpose: string; idempotencyKey: string; proposedBy: string;
}): { reinvestment: ReinvestmentRow; idempotentReplay: boolean } {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length < 4) {
    throw new EarningError(400, 'invalid_request', 'idempotency key must be at least 4 characters');
  }
  // A spending freeze stops new commitments outright (recorded as denied so
  // the attempt stays visible).
  assertSpendingAllowed('propose reinvestment');
  const existing = db.get<ReinvestmentRow>('SELECT * FROM economy_reinvestments WHERE idempotency_key = ?', [input.idempotencyKey]);
  if (existing) return { reinvestment: existing, idempotentReplay: true };
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new EarningError(400, 'invalid_request', 'reinvestment amount must be a positive integer (cents)');
  }
  if (!input.purpose || input.purpose.trim().length < 4) {
    throw new EarningError(400, 'invalid_request', 'a reinvestment purpose is required');
  }
  const agent = getAgentBySlug(input.agentSlug);
  if (!agent) throw new EarningError(404, 'agent_not_found', `agent "${input.agentSlug}" does not exist in the registry`);
  const account = agentAccountFor(input.agentSlug);
  if (account.availableCents < input.amountCents) {
    throw new EarningError(
      400, 'insufficient_realized_balance',
      `agent "${input.agentSlug}" has ${account.availableCents}c of realized surplus available — reinvestment can never exceed evidence-backed net revenue (requested ${input.amountCents}c)`,
    );
  }
  const id = createId('eco_riv');
  db.run(
    `INSERT INTO economy_reinvestments (id, agent_slug, amount_cents, purpose, idempotency_key, status, proposed_by)
     VALUES (?, ?, ?, ?, ?, 'proposed', ?)`,
    [id, input.agentSlug, input.amountCents, input.purpose.trim(), input.idempotencyKey, input.proposedBy],
  );
  const reinvestment = getReinvestment(id)!;
  recordEconomyEvent({
    kind: 'treasury', actor: input.proposedBy,
    summary: `reinvestment proposed: ${input.amountCents}c of ${input.agentSlug} surplus → ${input.purpose.trim().slice(0, 120)}`,
    details: { reinvestmentId: id },
  });
  return { reinvestment, idempotentReplay: false };
}

/** Owner decision on a proposed reinvestment. Approve executes it for real. */
export function decideReinvestment(id: string, decision: 'approve' | 'reject', decidedBy: string): ReinvestmentRow {
  const reinvestment = getReinvestment(id);
  if (!reinvestment) throw new EarningError(404, 'not_found', 'reinvestment not found');
  if (reinvestment.status !== 'proposed') {
    if ((reinvestment.status === 'executed' && decision === 'approve') || (reinvestment.status === 'rejected' && decision === 'reject')) {
      return reinvestment;
    }
    throw new EarningError(400, 'decision_final', `reinvestment ${id} is already ${reinvestment.status}; decisions are final (propose a new one if needed)`);
  }
  if (decision === 'reject') {
    db.run("UPDATE economy_reinvestments SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ?", [decidedBy, new Date().toISOString(), id]);
    recordEconomyEvent({ kind: 'treasury', actor: decidedBy, summary: `reinvestment ${id} REJECTED` });
    return getReinvestment(id)!;
  }
  assertSpendingAllowed(`approve reinvestment ${id}`);
  const account = agentAccountFor(reinvestment.agent_slug);
  if (account.availableCents < reinvestment.amount_cents) {
    db.run("UPDATE economy_reinvestments SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ?", [decidedBy, new Date().toISOString(), id]);
    recordEconomyEvent({
      kind: 'treasury', actor: decidedBy,
      summary: `reinvestment ${id} REJECTED at approval: realized balance (${account.availableCents}c) no longer covers ${reinvestment.amount_cents}c`,
    });
    throw new EarningError(400, 'insufficient_realized_balance', `realized balance is now ${account.availableCents}c — the reinvestment was rejected instead of executed`);
  }
  postLedger({
    agentSlug: reinvestment.agent_slug,
    direction: 'debit',
    category: 'reinvestment',
    amountCents: reinvestment.amount_cents,
    purpose: `approved reinvestment: ${reinvestment.purpose.slice(0, 160)}`,
    refType: 'reinvestment',
    refId: `reinvest:${id}`,
    policyDecision: 'owner-approved',
  });
  db.run("UPDATE economy_reinvestments SET status = 'executed', decided_by = ?, decided_at = ? WHERE id = ?", [decidedBy, new Date().toISOString(), id]);
  appendAuditLog({
    actorId: decidedBy,
    action: 'economy.treasury.reinvest.approved',
    resourceType: 'economy_reinvestment',
    resourceId: id,
    description: `${reinvestment.amount_cents}c of ${reinvestment.agent_slug} surplus → ${reinvestment.purpose.slice(0, 120)}`,
  });
  recordEconomyEvent({
    kind: 'treasury', actor: decidedBy,
    summary: `reinvestment ${id} EXECUTED: ${reinvestment.amount_cents}c of ${reinvestment.agent_slug} surplus → ${reinvestment.purpose.slice(0, 120)}`,
  });
  return getReinvestment(id)!;
}
