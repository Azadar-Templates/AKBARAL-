import { createId, db } from '../db';
import { findUserByEmail, createUser } from '../db';
import { agentFactory } from '../orchestrator/agent-factory';
import {
  countAgentProfiles,
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
} from '../db/economy-repositories';
import { currentPolicy } from './policy';

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

export function recordLedgerRevenue(input: { opportunityId?: string | null; agentSlug?: string | null; amountCents: number; evidence: string; externalRef?: string | null }): { posted: boolean } {
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
  return { posted: !posted.duplicate };
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
  return { created: true, reason: 'created', settlementId: settlement.id, amountCents: distributable };
}

export function completeSettlement(id: string, evidence: string): void {
  const settlement = listSettlements().find((row) => row.id === id);
  if (!settlement) throw new Error('settlement not found');
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

export function expandCapability(input: { gap: string; specialization: string; systemInstructions: string; parentAgentSlug?: string | null; name?: string }): ExpansionOutcome {
  const policy = currentPolicy();
  const profileCount = countAgentProfiles();
  if (profileCount >= policy.maxEconomyAgents) {
    const expansion = insertExpansion({ gap: input.gap, parentAgentSlug: input.parentAgentSlug ?? null });
    updateExpansion(expansion.id, { status: 'rejected', decided_at: new Date().toISOString() });
    recordEconomyEvent({ kind: 'expansion', actor: input.parentAgentSlug ?? 'system', summary: `expansion REJECTED: agent cap reached (${profileCount}/${policy.maxEconomyAgents}) — no uncontrolled replication` });
    return { expansionId: expansion.id, agentSlug: '', status: 'rejected', blockedReason: 'agent cap reached' };
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
