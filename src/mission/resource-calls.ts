import { reserveResourceBudget, recheckResourceBudget, releaseCancelledResourceBudget, getResourceCallBudget, type ResourceBudget } from './resource-budgets';
import { missionDb, missionId, nowIso, appendMissionAudit, type Row } from './database';
import { getCredentialPublic, MissionSelfServiceError, pendingResourceUsage, resourceCounters, resourceReadiness } from './self-management';

/** Internal worker boundary. Actors must come from trusted authentication, never
 * a request body. This meters quota only, not payments or provider verification. */
export interface ResourceCallActor { actorType: 'owner' | 'agent'; actorId: string }
export interface ReserveResourceCall extends ResourceCallActor {
  budget?: ResourceBudget;
  resourceId: string;
  agentId: string;
  idempotencyKey: string;
  operationFingerprint: string;
  units: Record<string, number>;
}
export interface ResourceCallPermit {
  callId: string;
  resourceId: string;
  agentId: string;
  provider: string;
  credentialId: string;
  credentialVersion: number;
  operationFingerprint: string;
  deadlineAt: string;
  units: Readonly<Record<string, number>>;
}
function fail(message: string, code = 'conflict', status = 409): never { throw new MissionSelfServiceError(status, message, code); }
const canonical = (value: Record<string, number>): string => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
function callTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 300000) fail('provider timeout must be 1–300000 milliseconds', 'validation_error', 400);
  return value;
}
function actorFor(actor: ResourceCallActor, agentId: string): void {
  if (!['owner', 'agent'].includes(actor.actorType) || !actor.actorId?.trim() || (actor.actorType === 'agent' && actor.actorId !== agentId)) fail('call belongs to another agent or requires a trusted actor', 'forbidden', 403);
}
function getCall(id: string): Row {
  return missionDb.get<Row>('SELECT * FROM mission_resource_calls WHERE id = ?', [id]) ?? fail('resource call not found', 'not_found', 404);
}
function getResource(id: string): Row {
  return missionDb.get<Row>('SELECT * FROM mission_resources WHERE id = ?', [id]) ?? fail('resource not found', 'not_found', 404);
}
function binding(resourceId: string, agentId: string, excludeCallId?: string, checkQuota = true) {
  const resource = getResource(resourceId);
  if (resource.agent_id !== agentId) fail('resource assignment changed or belongs to another agent', 'forbidden', 403);
  const blockers = resourceReadiness(resourceId, excludeCallId).blockers.filter(value => checkQuota || !value.startsWith('quota_'));
  if (blockers.length) fail(`resource is not ready: ${blockers.join(', ')}`, 'resource_unavailable');
  const credential = resource.credential_id ? getCredentialPublic(String(resource.credential_id)) : null;
  if (!credential) fail('provider calls require a stored resource credential', 'credential_required');
  const limits = resourceCounters(JSON.parse(String(resource.limits ?? '{}')), 'resource limits');
  const snapshot = JSON.stringify({ resourceId, agentId, provider: String(resource.provider), credentialId: credential.id, credentialVersion: credential.rotationCount, credentialExpiry: credential.expiresAt, resourceExpiry: resource.expires_at, provisioningRef: resource.provisioning_ref, plan: resource.plan, limits: canonical(limits) });
  return { resource, credential, limits, snapshot };
}
function requireCapacity(resource: Row, units: Record<string, number>, limits: Record<string, number>, excludeCallId?: string): void {
  if (!Object.keys(limits).length || canonicalKeys(limits) !== canonicalKeys(units) || Object.values(units).some(value => value <= 0)) fail('reserve a positive amount for every configured quota counter', 'validation_error', 400);
  const usage = resourceCounters(JSON.parse(String(resource.usage ?? '{}')), 'resource usage');
  const held = pendingResourceUsage(String(resource.id), excludeCallId);
  for (const [key, amount] of Object.entries(units)) {
    const total = usage[key] + (held[key] ?? 0) + amount;
    if (!Number.isFinite(total) || total > limits[key] || total > Number.MAX_SAFE_INTEGER) fail(`insufficient unreserved quota: ${key}`, 'quota_exhausted');
  }
}
function canonicalKeys(value: Record<string, number>): string { return JSON.stringify(Object.keys(value).sort()); }
function audit(row: Row, actor: ResourceCallActor, action: string, detail: Record<string, unknown> = {}): void {
  appendMissionAudit({ ...actor, action: `resource.call_${action}`, subjectType: 'resource', subjectId: String(row.resource_id), detail: { callId: row.id, ...detail } });
}

export function reserveResourceCall(input: ReserveResourceCall): Row {
  return missionDb.transaction(() => {
    actorFor(input, input.agentId);
    const resource = getResource(input.resourceId);
    if (resource.agent_id !== input.agentId) fail('resource belongs to another agent', 'forbidden', 403);
    const key = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
    if (key.length < 8 || key.length > 160) fail('idempotency key must contain 8–160 characters', 'validation_error', 400);
    if (!/^[a-f0-9]{64}$/.test(input.operationFingerprint)) fail('a SHA-256 operation fingerprint is required', 'validation_error', 400);
    const units = resourceCounters(input.units, 'call reservation');
    const prior = missionDb.get<Row>('SELECT * FROM mission_resource_calls WHERE resource_id = ? AND idempotency_key = ?', [input.resourceId, key]);
    if (prior) {
      if (prior.agent_id !== input.agentId || prior.operation_fingerprint !== input.operationFingerprint || prior.reserved_usage !== canonical(units)) fail('idempotency key belongs to another reservation', 'idempotency_conflict');
      reserveResourceBudget(prior, input.budget, input, true);
      return prior;
    }
    const current = binding(input.resourceId, input.agentId);
    requireCapacity(resource, units, current.limits);
    const id = missionId('rcall');
    missionDb.run("INSERT INTO mission_resource_calls (id, resource_id, agent_id, idempotency_key, operation_fingerprint, binding_snapshot, reserved_usage, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?)", [id, input.resourceId, input.agentId, key, input.operationFingerprint, current.snapshot, canonical(units), nowIso()]);
    const row = getCall(id);
    reserveResourceBudget(row, input.budget, input);
    audit(row, input, 'reserved', { units });
    return row;
  });
}

/** Claims once before crossing the asynchronous boundary. Rejected preflight
 * cancels only an unstarted reservation and commits that release atomically. */
export function claimResourceCall(id: string, actor: ResourceCallActor, timeoutMs = 60000): ResourceCallPermit {
  timeoutMs = callTimeout(timeoutMs);
  const result = missionDb.transaction(() => {
    const row = getCall(id);
    actorFor(actor, String(row.agent_id));
    if (row.status !== 'reserved') fail(`call is ${row.status}; automatic redispatch is forbidden`);
    try {
      recheckResourceBudget(row);
      const current = binding(String(row.resource_id), String(row.agent_id), id);
      if (current.snapshot !== row.binding_snapshot) fail('authorized resource/credential binding changed');
      const units = resourceCounters(JSON.parse(String(row.reserved_usage)), 'reserved usage');
      requireCapacity(current.resource, units, current.limits, id);
      const deadlineAt = new Date(Date.now() + timeoutMs).toISOString();
      missionDb.run("UPDATE mission_resource_calls SET status = 'dispatched', dispatched_at = ?, deadline_at = ? WHERE id = ?", [nowIso(), deadlineAt, id]);
      audit(row, actor, 'dispatched');
      return { permit: Object.freeze({ callId: id, resourceId: String(row.resource_id), agentId: String(row.agent_id), provider: String(current.resource.provider), credentialId: current.credential.id, credentialVersion: current.credential.rotationCount, operationFingerprint: String(row.operation_fingerprint), deadlineAt, units: Object.freeze({ ...units }) }) };
    } catch (error) {
      if (!(error instanceof MissionSelfServiceError)) throw error;
      missionDb.run("UPDATE mission_resource_calls SET status = 'cancelled', resolved_at = ? WHERE id = ?", [nowIso(), id]);
      releaseCancelledResourceBudget(id);
      audit(row, actor, 'cancelled', { reason: error.code });
      return { denied: error };
    }
  });
  if (result.denied) throw result.denied;
  return result.permit!;
}

export function cancelResourceCall(id: string, actor: ResourceCallActor): Row {
  return missionDb.transaction(() => {
    const row = getCall(id);
    actorFor(actor, String(row.agent_id));
    if (row.status === 'cancelled') return row;
    if (row.status !== 'reserved') fail('only an unstarted reservation can be cancelled; reconcile dispatched usage');
    missionDb.run("UPDATE mission_resource_calls SET status = 'cancelled', resolved_at = ? WHERE id = ?", [nowIso(), id]);
    releaseCancelledResourceBudget(id);
    audit(row, actor, 'cancelled', { reason: 'cancelled_before_dispatch' });
    return getCall(id);
  });
}

export function markResourceCallUncertain(id: string, actor: ResourceCallActor): Row {
  return missionDb.transaction(() => {
    const row = getCall(id);
    actorFor(actor, String(row.agent_id));
    if (row.status === 'uncertain') return row;
    if (row.status !== 'dispatched') fail('only a dispatched call can have an uncertain outcome');
    missionDb.run("UPDATE mission_resource_calls SET status = 'uncertain' WHERE id = ?", [id]);
    audit(row, actor, 'uncertain', { quotaRetained: true });
    return getCall(id);
  });
}

export interface ResourceCallReceipt {
  outcome: 'succeeded' | 'failed';
  actualUsage: Record<string, number>;
  providerRef: string;
  evidence: string;
}
/** Actual overages are recorded, not discarded to fit an estimate. No automatic
 * refund follows a timeout; uncertain calls require an explicit owner receipt. */
export function settleResourceCall(id: string, actor: ResourceCallActor, receipt: ResourceCallReceipt): { call: Row; authorizationChanged: boolean } {
  return missionDb.transaction(() => {
    const row = getCall(id);
    actorFor(actor, String(row.agent_id));
    const expiredDispatch = row.status === 'dispatched' && (!row.deadline_at || !Number.isFinite(Date.parse(String(row.deadline_at))) || Date.parse(String(row.deadline_at)) <= Date.now());
    if ((row.status === 'uncertain' || expiredDispatch) && actor.actorType !== 'owner') fail('uncertain usage requires owner reconciliation', 'forbidden', 403);
    const actual = resourceCounters(receipt.actualUsage, 'actual usage');
    if (!['succeeded', 'failed'].includes(receipt.outcome) || canonicalKeys(actual) !== canonicalKeys(JSON.parse(String(row.reserved_usage)))) fail('receipt must describe every reserved counter and a known outcome', 'validation_error', 400);
    const reference = typeof receipt.providerRef === 'string' ? receipt.providerRef.trim() : '';
    const evidence = typeof receipt.evidence === 'string' ? receipt.evidence.trim() : '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{3,199}$/.test(reference) || evidence.length < 12 || evidence.length > 2000) fail('a bounded provider reference and non-secret usage evidence are required', 'validation_error', 400);
    let authorizationChanged = false;
    try { authorizationChanged = binding(String(row.resource_id), String(row.agent_id), id, false).snapshot !== row.binding_snapshot; }
    catch (error) { if (!(error instanceof MissionSelfServiceError)) throw error; authorizationChanged = true; }
    if (['succeeded', 'failed'].includes(String(row.status))) {
      if (row.status !== receipt.outcome || row.actual_usage !== canonical(actual) || row.provider_ref !== reference || row.evidence !== evidence) fail('call receipt cannot be changed after settlement', 'idempotency_conflict');
      return { call: row, authorizationChanged };
    }
    if (!['dispatched', 'uncertain'].includes(String(row.status))) fail(`cannot settle a call that is ${row.status}`);
    if (missionDb.get('SELECT id FROM mission_resource_calls WHERE resource_id = ? AND provider_ref = ? AND id <> ?', [row.resource_id, reference, id])) fail('provider reference already accounted for on this resource', 'duplicate_receipt');
    const resource = getResource(String(row.resource_id));
    const usage = resourceCounters(JSON.parse(String(resource.usage ?? '{}')), 'resource usage');
    for (const [key, amount] of Object.entries(actual)) {
      if (usage[key] === undefined) fail('usage history is missing; owner reconciliation required');
      usage[key] += amount;
    }
    const total = resourceCounters(usage, 'total resource usage');
    missionDb.run('UPDATE mission_resources SET usage = ?, updated_at = ? WHERE id = ?', [canonical(total), nowIso(), row.resource_id]);
    missionDb.run('UPDATE mission_resource_calls SET status = ?, actual_usage = ?, provider_ref = ?, evidence = ?, resolved_at = ? WHERE id = ?', [receipt.outcome, canonical(actual), reference, evidence, nowIso(), id]);
    audit(row, actor, 'settled', { outcome: receipt.outcome, actualUsage: actual, providerRef: reference, authorizationChanged, providerVerified: false });
    return { call: getCall(id), authorizationChanged };
  });
}

/** The callback must be a trusted server-side adapter, never a client URL or
 * executable supplied in a message. No secret or response payload is persisted.
 * Existing unrelated provider entry points are NOT automatically covered. */
export async function runResourceCall<T>(input: ReserveResourceCall, invoke: (permit: ResourceCallPermit, signal: AbortSignal) => Promise<ResourceCallReceipt & { value: T }>, options: { timeoutMs?: number } = {}): Promise<{ call: Row; value: T }> {
  const timeoutMs = callTimeout(options.timeoutMs ?? 60000);
  const reserved = reserveResourceCall(input);
  const permit = claimResourceCall(String(reserved.id), input, timeoutMs);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let outcome: Awaited<ReturnType<typeof invoke>>;
  try {
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new MissionSelfServiceError(504, 'provider call deadline exceeded; quota retained pending reconciliation', 'provider_timeout');
        reject(error);
        controller.abort(error);
      }, Math.max(1, Date.parse(permit.deadlineAt) - Date.now()));
    });
    outcome = await Promise.race([Promise.resolve().then(() => {
      if (Date.now() >= Date.parse(permit.deadlineAt)) fail('provider call deadline elapsed before invocation', 'provider_timeout', 504);
      return invoke(permit, controller.signal);
    }), timedOut]);
    // A blocking callback can delay timer delivery; the durable clock still wins.
    if (Date.now() >= Date.parse(permit.deadlineAt)) fail('provider response arrived after its deadline; quota retained', 'provider_timeout', 504);
  } catch (error) {
    controller.abort();
    markResourceCallUncertain(permit.callId, input);
    throw error;
  } finally { clearTimeout(timer); }
  let settled: ReturnType<typeof settleResourceCall>;
  try { settled = settleResourceCall(permit.callId, input, outcome); }
  catch (error) { markResourceCallUncertain(permit.callId, input); throw error; }
  if (settled.authorizationChanged) fail('provider usage recorded but authority changed; result withheld', 'authorization_changed');
  if (outcome.outcome === 'failed') fail('provider reported failure; usage recorded and result withheld', 'provider_failed');
  return { call: settled.call, value: outcome.value };
}

export interface ResourceCallPublic {
  id: string; resourceId: string; agentId: string; status: string;
  reservedUsage: Record<string, number>; actualUsage: Record<string, number> | null;
  providerRef: string | null; evidence: string | null;
  createdAt: string; deadlineAt: string | null; resolvedAt: string | null;
  budget: { walletId: string; currency: string; reservedCents: number; status: string; actualCents: number | null } | null;
}
function publicCall(row: Row): ResourceCallPublic {
  const hold = getResourceCallBudget(String(row.id));
  return {
    budget: hold ? { walletId: String(hold.wallet_id), currency: String(hold.currency), reservedCents: Number(hold.reserved_cents), status: String(hold.status), actualCents: hold.actual_cents === null ? null : Number(hold.actual_cents) } : null,
    id: String(row.id), resourceId: String(row.resource_id), agentId: String(row.agent_id), status: String(row.status),
    reservedUsage: resourceCounters(JSON.parse(String(row.reserved_usage)), 'reserved usage'),
    actualUsage: row.actual_usage ? resourceCounters(JSON.parse(String(row.actual_usage)), 'actual usage') : null,
    providerRef: row.provider_ref ? String(row.provider_ref) : null, evidence: row.evidence ? String(row.evidence) : null,
    createdAt: String(row.created_at), deadlineAt: row.deadline_at ? String(row.deadline_at) : null, resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  };
}
function ownerCallAccess(resourceId: string, actor: ResourceCallActor, callId?: string): void {
  if (actor.actorType !== 'owner' || !actor.actorId?.trim()) fail('resource-call review requires a trusted owner', 'forbidden', 403);
  getResource(resourceId);
  if (callId && getCall(callId).resource_id !== resourceId) fail('call does not belong to this resource', 'not_found', 404);
}

/** Owner-only view; never expose encrypted credentials or internal binding/key data. */
export function listOwnerResourceCalls(resourceId: string, actor: ResourceCallActor, options: { before?: string; limit?: number } = {}): { calls: ResourceCallPublic[]; nextCursor: string | null } {
  ownerCallAccess(resourceId, actor);
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('call page limit must be 1–100', 'validation_error', 400);
  let rows: Row[];
  if (options.before) {
    const anchor = getCall(options.before);
    if (anchor.resource_id !== resourceId) fail('cursor belongs to another resource', 'validation_error', 400);
    rows = missionDb.all<Row>('SELECT * FROM mission_resource_calls WHERE resource_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?', [resourceId, anchor.created_at, anchor.created_at, anchor.id, limit + 1]);
  } else rows = missionDb.all<Row>('SELECT * FROM mission_resource_calls WHERE resource_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', [resourceId, limit + 1]);
  const page = rows.slice(0, limit);
  return { calls: page.map(publicCall), nextCursor: rows.length > limit ? String(page.at(-1)!.id) : null };
}

export function cancelOwnerResourceCall(resourceId: string, callId: string, actor: ResourceCallActor): ResourceCallPublic {
  return missionDb.transaction(() => {
    ownerCallAccess(resourceId, actor, callId);
    return publicCall(cancelResourceCall(callId, actor));
  });
}
export function reconcileOwnerResourceCall(resourceId: string, callId: string, actor: ResourceCallActor, receipt: ResourceCallReceipt): { call: ResourceCallPublic; authorizationChanged: boolean; providerVerified: false; moneyMoved: false } {
  return missionDb.transaction(() => {
    ownerCallAccess(resourceId, actor, callId);
    const settled = settleResourceCall(callId, actor, receipt);
    return { call: publicCall(settled.call), authorizationChanged: settled.authorizationChanged, providerVerified: false, moneyMoved: false };
  });
}
