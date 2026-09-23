import { providerChargeRecorded } from './resource-receipts';
import { missionDb, nowIso, appendMissionAudit, type Row } from './database';
import { canAgentSpend, currentPolicy, dailySpendCents } from './policy';
import { MissionSelfServiceError } from './self-management';
import { debit, getWallet } from './treasury';

export interface ResourceBudget { walletId: string; maxCostCents: number }
type Actor = { actorType: 'owner' | 'agent'; actorId: string };
function fail(message: string, status = 409): never { throw new MissionSelfServiceError(status, message, 'resource_budget'); }
export function getResourceCallBudget(callId: string): Row | undefined {
  return missionDb.get<Row>('SELECT * FROM mission_resource_call_budgets WHERE call_id = ?', [callId]);
}

function checkBudget(call: Row, input: ResourceBudget, excludeCallId?: string): string {
  const wallet = getWallet(input.walletId);
  if (!wallet || wallet.agentId !== call.agent_id) fail('provider budget wallet must belong to the assigned agent', 403);
  if (!Number.isSafeInteger(input.maxCostCents) || input.maxCostCents <= 0) fail('provider budget requires positive integer maxCostCents', 400);
  // Provider workers cannot inherit the legacy unlimited-budget interpretation.
  if (wallet.budgetCents <= 0) fail('provider calls require an explicit positive wallet budget');
  const policy = currentPolicy();
  if (wallet.currency !== policy.currency) fail('provider budget currency does not match mission policy');
  const decision = canAgentSpend({ walletId: wallet.id, agentId: String(call.agent_id), amountCents: input.maxCostCents, category: 'expense' }, policy, dailySpendCents(nowIso()), excludeCallId);
  if (!decision.allowed) fail(`provider budget refused: ${decision.requiresApproval ? 'owner approval required; automatic dispatch forbidden' : decision.reasons.join(', ')}`);
  return wallet.currency;
}

/** Called only inside the quota reservation's transaction. */
export function reserveResourceBudget(call: Row, input: ResourceBudget | undefined, actor: Actor, replay = false): void {
  const prior = getResourceCallBudget(String(call.id));
  if (replay) {
    if (Boolean(prior) !== Boolean(input) || (prior && input && (prior.wallet_id !== input.walletId || Number(prior.reserved_cents) !== input.maxCostCents))) fail('idempotency key belongs to another provider budget');
    return;
  }
  if (!input) return;
  const currency = checkBudget(call, input);
  missionDb.run("INSERT INTO mission_resource_call_budgets (call_id, wallet_id, currency, reserved_cents, status, created_at) VALUES (?, ?, ?, ?, 'held', ?)", [call.id, input.walletId, currency, input.maxCostCents, nowIso()]);
  appendMissionAudit({ ...actor, action: 'resource.budget_held', subjectType: 'resource', subjectId: String(call.resource_id), detail: { callId: call.id, walletId: input.walletId, reservedCents: input.maxCostCents, moneyMoved: false } });
}
export function recheckResourceBudget(call: Row): void {
  const hold = getResourceCallBudget(String(call.id));
  if (!hold) return; // Legacy quota-only adapters are not silently relabelled budget-enforced.
  if (hold.status !== 'held') fail('provider budget is no longer held');
  const currency = checkBudget(call, { walletId: String(hold.wallet_id), maxCostCents: Number(hold.reserved_cents) }, String(call.id));
  if (currency !== hold.currency) fail('provider budget currency changed');
}
export function releaseCancelledResourceBudget(callId: string): void {
  // The call cancellation audit is in the same outer transaction.
  if (missionDb.get<Row>('SELECT status FROM mission_resource_calls WHERE id = ?', [callId])?.status !== 'cancelled') fail('only cancelled unstarted calls can release a provider budget');
  missionDb.run("UPDATE mission_resource_call_budgets SET status = 'released', resolved_at = ? WHERE call_id = ? AND status = 'held'", [nowIso(), callId]);
}

/** Explicit owner accounting of an evidenced charge; no external payment is
 * initiated. Quota evidence alone is NOT a financial receipt. */
export function recordResourceCallCost(resourceId: string, callId: string, actor: Actor, receipt: { actualCostCents: number; providerRef: string; evidence: string }): { budget: Row; externalPaymentExecuted: false } {
  return missionDb.transaction(() => {
    if (actor.actorType !== 'owner' || !actor.actorId?.trim()) fail('provider cost reconciliation requires a trusted owner', 403);
    const call = missionDb.get<Row>('SELECT c.*, r.provider FROM mission_resource_calls c JOIN mission_resources r ON r.id = c.resource_id WHERE c.id = ? AND c.resource_id = ?', [callId, resourceId]);
    if (!call) fail('resource call not found', 404);
    const hold = getResourceCallBudget(callId);
    if (!hold) fail('resource call has no financial reservation', 404);
    const amount = receipt.actualCostCents;
    const reference = typeof receipt.providerRef === 'string' ? receipt.providerRef.trim() : '';
    const evidence = typeof receipt.evidence === 'string' ? receipt.evidence.trim() : '';
    if (!Number.isSafeInteger(amount) || amount < 0 || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{3,199}$/.test(reference) || evidence.length < 12 || evidence.length > 2000) fail('actual nonnegative integer cost, provider charge reference and non-secret financial evidence are required', 400);
    if (hold.status === 'recorded') {
      if (Number(hold.actual_cents) !== amount || hold.provider_ref !== reference || hold.evidence !== evidence) fail('provider cost receipt cannot be changed');
      return { budget: hold, externalPaymentExecuted: false };
    }
    if (hold.status !== 'held' || !['succeeded', 'failed'].includes(String(call.status))) fail('reconcile actual provider usage before recording its financial receipt');
    const wallet = getWallet(String(hold.wallet_id));
    if (!wallet || wallet.currency !== hold.currency) fail('original provider budget wallet currency changed');
    // Fail before binding a potentially out-of-range SQL INTEGER amount. This
    // also preserves the original hold when an evidenced overage is unfunded.
    if (amount > wallet.balanceCents) fail('insufficient wallet balance for the evidenced provider charge');
    if (providerChargeRecorded(String(call.provider), reference)) fail('provider charge reference already recorded for this provider');
    // Release only our own hold while recording the actual charge, atomically.
    // A debit failure (including an unfunded overage) rolls everything back.
    missionDb.run("UPDATE mission_resource_call_budgets SET status = 'recorded', actual_cents = ?, provider_ref = ?, evidence = ?, resolved_at = ? WHERE call_id = ?", [amount, reference, evidence, nowIso(), callId]);
    const ledger = amount > 0 ? debit({ walletId: String(hold.wallet_id), amountCents: amount, category: 'expense', reference: callId, idempotencyKey: `resource-call-cost:${callId}`, ...actor, memo: `Owner-evidenced provider charge ${reference}; no external payment initiated` }) : null;
    if (ledger) missionDb.run('UPDATE mission_resource_call_budgets SET ledger_id = ? WHERE call_id = ?', [ledger.id, callId]);
    appendMissionAudit({ ...actor, action: 'resource.cost_recorded', subjectType: 'resource', subjectId: resourceId, detail: { callId, amountCents: amount, providerRef: reference, externalPaymentExecuted: false, providerVerified: false } });
    return { budget: getResourceCallBudget(callId)!, externalPaymentExecuted: false };
  });
}
