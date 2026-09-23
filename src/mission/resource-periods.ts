import { missionDb, missionId, nowIso, sha256, appendMissionAudit, type Row } from './database';
import { MissionSelfServiceError, resourceCounters } from './self-management';
import { currentPolicy, canAgentSpend, dailySpendCents } from './policy';
import { getWallet, debit } from './treasury';
import { looksLikeInstrumentCredential } from './destination-safety';
import { providerChargeRecorded } from './resource-receipts';

type OwnerActor = { actorType: 'owner' | 'agent'; actorId: string };
export interface ResourcePeriodInput {
  idempotencyKey: string; expectedExpiresAt: string; periodStart: string; periodEnd: string;
  limits: Record<string, number>; startingUsage: Record<string, number>;
  actualCostCents: number; currency: string; walletId?: string;
  providerRef: string; evidence: string;
}
function fail(message: string, status = 409): never { throw new MissionSelfServiceError(status, message, 'resource_period'); }
function authorize(actor: OwnerActor): void { if (actor.actorType !== 'owner' || !actor.actorId?.trim()) fail('resource renewal evidence requires a trusted owner', 403); }
const canonical = (value: Record<string, number>) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
function iso(value: string): string {
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) fail('valid provider period timestamps are required', 400);
  return new Date(value).toISOString();
}

/** Record an already-evidenced current period, never buy/activate a subscription. */
export function recordResourcePeriod(resourceId: string, input: ResourcePeriodInput, actor: OwnerActor): { periodId: string; duplicate: boolean; externalPaymentExecuted: false; providerVerified: false } {
  return missionDb.transaction(() => {
    authorize(actor);
    const resource = missionDb.get<Row>('SELECT * FROM mission_resources WHERE id = ?', [resourceId]);
    if (!resource) fail('resource not found', 404);
    const start = iso(input.periodStart), end = iso(input.periodEnd);
    const limits = resourceCounters(input.limits, 'new period limits');
    const usage = resourceCounters(input.startingUsage, 'provider starting usage');
    if (JSON.stringify(Object.keys(limits).sort()) !== JSON.stringify(Object.keys(usage).sort())) fail('starting usage must explicitly include every new period counter', 400);
    const key = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
    const reference = typeof input.providerRef === 'string' ? input.providerRef.trim() : '';
    const evidence = typeof input.evidence === 'string' ? input.evidence.trim() : '';
    const amount = input.actualCostCents;
    if (key.length < 8 || key.length > 160 || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{3,199}$/.test(reference) || looksLikeInstrumentCredential(reference).unsafe || evidence.length < 12 || evidence.length > 2000 || !Number.isSafeInteger(amount) || amount < 0 || typeof input.currency !== 'string' || (input.walletId !== undefined && typeof input.walletId !== 'string')) fail('bounded idempotency, non-secret provider evidence and explicit actual cost/currency are required', 400);
    const fingerprint = sha256(JSON.stringify({ start, end, limits: canonical(limits), usage: canonical(usage), amount, currency: input.currency, walletId: input.walletId ?? null, reference, evidence, expectedExpiresAt: input.expectedExpiresAt }));
    const prior = missionDb.get<Row>('SELECT * FROM mission_resource_periods WHERE resource_id = ? AND idempotency_key = ?', [resourceId, key]);
    if (prior) {
      if (prior.request_fingerprint !== fingerprint) fail('renewal idempotency key belongs to different evidence');
      return { periodId: String(prior.id), duplicate: true, externalPaymentExecuted: false, providerVerified: false };
    }
    if (resource.status !== 'active' || !resource.provisioned_at) fail('only previously provisioned, non-retired resources can record a renewed period');
    if (!resource.expires_at || input.expectedExpiresAt !== resource.expires_at || !Number.isFinite(Date.parse(String(resource.expires_at)))) fail('resource expiry is missing or changed; refresh and review the provider period');
    const now = Date.now();
    if (Date.parse(start) < Date.parse(String(resource.expires_at)) || Date.parse(start) > now || Date.parse(end) <= now || Date.parse(end) <= Date.parse(start)) fail('renewal must be a current, non-overlapping provider period');
    if (missionDb.get("SELECT id FROM mission_resource_calls WHERE resource_id = ? AND status IN ('reserved', 'dispatched', 'uncertain') LIMIT 1", [resourceId]) || missionDb.get("SELECT b.call_id FROM mission_resource_call_budgets b JOIN mission_resource_calls c ON c.id = b.call_id WHERE c.resource_id = ? AND b.status = 'held' LIMIT 1", [resourceId])) fail('reconcile or cancel all outstanding quota and financial holds before changing billing periods');
    if (amount > Number(resource.monthly_cost_cents)) fail('renewal charge exceeds the approved resource quote');
    if (providerChargeRecorded(String(resource.provider), reference)) fail('provider charge reference already recorded');
    const policy = currentPolicy();
    if (policy.killSwitch) fail('mission kill switch is engaged');
    if (input.currency !== policy.currency) fail('renewal currency does not match mission policy');
    const wallet = input.walletId ? getWallet(input.walletId) : null;
    if ((input.walletId && !wallet) || (amount > 0 && !wallet)) fail('select an existing funded private mission wallet');
    if (wallet && (wallet.currency !== input.currency || (wallet.agentId && wallet.agentId !== resource.agent_id))) fail('renewal wallet currency or agent assignment does not match', 403);
    if (amount > 0) {
      const gate = canAgentSpend({ walletId: wallet!.id, agentId: String(resource.agent_id), amountCents: amount, category: 'expense' }, policy, dailySpendCents(nowIso()));
      if (!gate.allowed && !gate.requiresApproval) fail(`renewal funding refused: ${gate.reasons.join(', ')}`);
    }
    const id = missionId('period');
    const ledger = amount > 0 ? debit({ walletId: wallet!.id, amountCents: amount, category: 'expense', reference: id, idempotencyKey: `resource-period:${id}`, ...actor, memo: `Owner-evidenced resource period ${reference}; no external payment initiated` }) : null;
    missionDb.run('INSERT INTO mission_resource_periods (id, resource_id, provider, period_start, period_end, previous_expiry, previous_usage, previous_limits, starting_usage, period_limits, actual_cost_cents, wallet_id, currency, provider_ref, evidence, ledger_id, idempotency_key, request_fingerprint, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, resourceId, resource.provider, start, end, resource.expires_at, String(resource.usage), String(resource.limits), canonical(usage), canonical(limits), amount, wallet?.id ?? null, input.currency, reference, evidence, ledger?.id ?? null, key, fingerprint, actor.actorId, nowIso()]);
    missionDb.run('UPDATE mission_resources SET expires_at = ?, usage = ?, limits = ?, updated_at = ? WHERE id = ?', [end, canonical(usage), canonical(limits), nowIso(), resourceId]);
    appendMissionAudit({ ...actor, action: 'resource.period_recorded', subjectType: 'resource', subjectId: resourceId, detail: { periodId: id, previousExpiry: resource.expires_at, periodStart: start, periodEnd: end, amountCents: amount, providerRef: reference, externalPaymentExecuted: false, providerVerified: false } });
    return { periodId: id, duplicate: false, externalPaymentExecuted: false, providerVerified: false };
  });
}
export function listResourcePeriods(resourceId: string, actor: OwnerActor, options: { before?: string; limit?: number } = {}): { periods: Row[]; nextCursor: string | null } {
  authorize(actor);
  if (!missionDb.get('SELECT id FROM mission_resources WHERE id = ?', [resourceId])) fail('resource not found', 404);
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('period limit must be 1–100', 400);
  const anchor = options.before ? missionDb.get<Row>('SELECT period_start FROM mission_resource_periods WHERE id = ? AND resource_id = ?', [options.before, resourceId]) : null;
  if (options.before && !anchor) fail('period cursor does not belong to this resource', 400);
  const rows = missionDb.all<Row>(`SELECT id, period_start, period_end, previous_expiry, previous_usage, previous_limits, starting_usage, period_limits, actual_cost_cents, currency, wallet_id, provider_ref, evidence, ledger_id, created_at FROM mission_resource_periods WHERE resource_id = ?${anchor ? ' AND period_start < ?' : ''} ORDER BY period_start DESC LIMIT ?`, [resourceId, ...(anchor ? [anchor.period_start] : []), limit + 1]);
  const periods = rows.slice(0, limit);
  return { periods, nextCursor: rows.length > limit ? String(periods[periods.length - 1].id) : null };
}
