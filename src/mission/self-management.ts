import { looksLikeInstrumentCredential } from './destination-safety';
import { debit, getWallet } from './treasury';
import { missionDb, missionId, nowIso, appendMissionAudit, type Row } from './database';
import { encryptCredential, vaultConfigured, MissionAuthError } from './auth';
import { currentPolicy, requestApproval, canAgentSpend, dailySpendCents } from './policy';

/**
 * AGENT SELF-MANAGEMENT — the infrastructure that lets agents operate real
 * services inside declared limits, and nothing more.
 *
 *   discover approved tools/providers   → mission_tools (deny by default)
 *   request/create scoped resources     → mission_resources (+ approval above cap)
 *   track API expiration                → credentials/ resources expiry sweeps
 *   rotate/replace credentials          → encrypted vault + rotation history
 *   monitor usage/cost                  → provider-reported usage + ledger costs
 *   request/execute permitted upgrades  → budget-checked, approval above cap
 *   maintain assigned services          → mission_services health records
 *   report all actions                  → hash-chained audit on every mutation
 *
 * HARD RULE: an agent never receives a raw password, API key or card. Agents
 * reference credentials by id; the value is decrypted only inside the process
 * that calls the provider. Card/bank credentials are never accepted at all —
 * money leaves only through an approved payout to a verified slot.
 */

export type SelfServiceActor = 'owner' | 'agent';

/** Owner-only operations are refused for an agent actor at the library level. */
function assertOwnerAction(actorType: SelfServiceActor | undefined, action: string): void {
  if (actorType === 'agent') {
    throw new MissionSelfServiceError(403, `an agent cannot ${action} — this decision belongs to the mission owner`, 'forbidden');
  }
}

export class MissionSelfServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, message: string, code: string) {
    super(message);
    this.name = 'MissionSelfServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Approved tools / providers catalog (default deny)
// ─────────────────────────────────────────────────────────────────────────────

/** Seeded catalog: real providers, honest activation state. */
const DEFAULT_TOOLS: Array<{
  key: string; name: string; category: string; provider: string; costModel: string; estCostCents: number;
  status: 'approved' | 'restricted' | 'blocked'; requiredPermission: string; termsUrl: string; notes: string;
}> = [
  { key: 'gemini_api', name: 'Google Gemini API', category: 'ai_model', provider: 'google', costModel: 'metered', estCostCents: 1, status: 'approved', requiredPermission: 'model.call', termsUrl: 'https://ai.google.dev/terms', notes: 'Primary reasoning model. Requires GOOGLE_API_KEY in the deployment environment.' },
  { key: 'web_search', name: 'Web search provider', category: 'search', provider: 'tavily|brave|serper|google_cse', costModel: 'usage', estCostCents: 1, status: 'approved', requiredPermission: 'search.query', termsUrl: '', notes: 'Provider chosen by the deployment configuration; keyless fallback available.' },
  { key: 'object_storage', name: 'Object storage', category: 'storage', provider: 'provider-configured', costModel: 'subscription', estCostCents: 500, status: 'approved', requiredPermission: 'storage.write', termsUrl: '', notes: 'Requires a provider account + scoped token before use.' },
  { key: 'compute_runner', name: 'Compute / job runner', category: 'compute', provider: 'provider-configured', costModel: 'usage', estCostCents: 300, status: 'approved', requiredPermission: 'compute.run', termsUrl: '', notes: 'Long-job execution. Requires an activated provider account.' },
  { key: 'email_delivery', name: 'Transactional email', category: 'communication', provider: 'provider-configured', costModel: 'usage', estCostCents: 5, status: 'restricted', requiredPermission: 'email.send', termsUrl: '', notes: 'Restricted: outbound messaging requires an owner-approved template and consent list.' },
  { key: 'payment_links', name: 'Payment links / invoicing', category: 'payments', provider: 'provider-configured', costModel: 'fee', estCostCents: 0, status: 'restricted', requiredPermission: 'payments.invoice', termsUrl: '', notes: 'Restricted: issuing an invoice/payment link requires an active payment provider and owner approval.' },
  { key: 'social_publishing', name: 'Social publishing (YouTube/Instagram/TikTok)', category: 'content', provider: 'platforms', costModel: 'free', estCostCents: 0, status: 'restricted', requiredPermission: 'content.publish', termsUrl: '', notes: 'Restricted: publishing needs an activated platform account/OAuth token, and engagement metrics come only from those platform APIs.' },
  { key: 'card_or_bank_api', name: 'Card / bank transfer API', category: 'payments', provider: 'n/a', costModel: 'n/a', estCostCents: 0, status: 'blocked', requiredPermission: 'n/a', termsUrl: '', notes: 'Blocked by design: agents never hold card or bank credentials. Funds move only through approved payouts to verified slots.' },
];

export function seedTools(): number {
  let inserted = 0;
  for (const tool of DEFAULT_TOOLS) {
    const existing = missionDb.get<Row>('SELECT * FROM mission_tools WHERE key = ?', [tool.key]);
    if (existing) {
      // Re-assert the permanent block: even if a row was edited by hand, seeding
      // puts a compiled-in block back.
      if ((PERMANENTLY_BLOCKED_TOOLS as readonly string[]).includes(tool.key) && String(existing.status ?? 'blocked') !== 'blocked') {
        missionDb.run('UPDATE mission_tools SET status = ? WHERE key = ?', ['blocked', tool.key]);
      }
      continue;
    }
    missionDb.run(
      `INSERT INTO mission_tools (id, key, name, category, provider, cost_model, est_cost_cents, status, required_permission, terms_url, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [missionId('tol'), tool.key, tool.name, tool.category, tool.provider, tool.costModel, tool.estCostCents, tool.status, tool.requiredPermission, tool.termsUrl, tool.notes],
    );
    inserted += 1;
  }
  return inserted;
}

export function listTools(status?: string): Row[] {
  seedTools();
  return status
    ? missionDb.all<Row>('SELECT * FROM mission_tools WHERE status = ? ORDER BY category, name', [status])
    : missionDb.all<Row>('SELECT * FROM mission_tools ORDER BY status, category, name');
}

export function getTool(key: string): Row | undefined {
  seedTools();
  return missionDb.get<Row>('SELECT * FROM mission_tools WHERE key = ?', [key]);
}

/**
 * Tools the mission can never use, regardless of who asks: an owner action
 * cannot enable them and re-seeding restores the block.
 */
export const PERMANENTLY_BLOCKED_TOOLS = ['card_or_bank_api'] as const;

export function setToolStatus(key: string, status: 'approved' | 'restricted' | 'blocked', actorId: string, actorType?: SelfServiceActor): Row {
  assertOwnerAction(actorType, 'change a tool status');
  if ((PERMANENTLY_BLOCKED_TOOLS as readonly string[]).includes(key) && status !== 'blocked') {
    throw new MissionSelfServiceError(
      403,
      `${key} is permanently blocked: agents never hold card or bank credentials — funds move only through approved payouts to verified slots`,
      'forbidden',
    );
  }
  const tool = missionDb.get<Row>('SELECT * FROM mission_tools WHERE key = ?', [key]);
  if (!tool) throw new MissionSelfServiceError(404, 'tool not found', 'not_found');
  missionDb.run('UPDATE mission_tools SET status = ? WHERE key = ?', [status, key]);
  appendMissionAudit({ actorType: 'owner', actorId, action: 'tool.status_changed', subjectType: 'tool', subjectId: key, detail: { from: String(tool.status), to: status } });
  return missionDb.get<Row>('SELECT * FROM mission_tools WHERE key = ?', [key])!;
}

export function requestTool(input: { agentId: string; toolKey: string; justification?: string | null; actorId?: string | null }): Row {
  const tool = getTool(input.toolKey);
  if (!tool) throw new MissionSelfServiceError(404, 'unknown tool — agents may only request catalog entries', 'not_found');
  const id = missionId('tqr');
  missionDb.run(
    `INSERT INTO mission_tool_requests (id, agent_id, tool_key, justification) VALUES (?, ?, ?, ?)`,
    [id, input.agentId, input.toolKey, (input.justification ?? '').slice(0, 500) || null],
  );
  // A blocked tool can never be approved by request — surface that immediately.
  if (String(tool.status) === 'blocked') {
    missionDb.run('UPDATE mission_tool_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?', ['rejected', nowIso(), 'system', id]);
    appendMissionAudit({
      actorType: 'agent', actorId: input.agentId, action: 'tool.request_blocked',
      subjectType: 'tool', subjectId: input.toolKey, detail: { reason: 'tool is permanently blocked by policy' },
    });
  } else {
    requestApproval({ subjectType: 'tool', subjectId: id, action: 'tool.approve', requestedBy: input.actorId ?? input.agentId, note: `tool request: ${input.toolKey}` });
  }
  return missionDb.get<Row>('SELECT * FROM mission_tool_requests WHERE id = ?', [id])!;
}

export function decideToolRequest(input: { id: string; decision: 'approved' | 'rejected'; actorId: string; actorType?: SelfServiceActor }): Row {
  assertOwnerAction(input.actorType, 'decide a tool request');
  const row = missionDb.get<Row>('SELECT * FROM mission_tool_requests WHERE id = ?', [input.id]);
  if (!row) throw new MissionSelfServiceError(404, 'tool request not found', 'not_found');
  if (String(row.status) !== 'requested') throw new MissionSelfServiceError(409, `request already ${row.status}`, 'conflict');
  missionDb.run('UPDATE mission_tool_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?', [input.decision, input.actorId, nowIso(), input.id]);
  appendMissionAudit({
    actorType: 'owner', actorId: input.actorId, action: `tool.request_${input.decision}`,
    subjectType: 'tool', subjectId: String(row.tool_key), detail: { agentId: String(row.agent_id) },
  });
  return missionDb.get<Row>('SELECT * FROM mission_tool_requests WHERE id = ?', [input.id])!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Credentials: encrypted vault, masked reads, auditable rotation
// ─────────────────────────────────────────────────────────────────────────────

export interface CredentialPublic {
  id: string;
  provider: string;
  label: string;
  kind: string;
  scope: string[];
  envVar: string | null;
  maskedHint: string;
  status: string;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  lastRotatedAt: string | null;
  rotationCount: number;
  createdAt: string;
}

function toPublicCredential(row: Row): CredentialPublic {
  const expiresAt = row.expires_at ? String(row.expires_at) : null;
  let daysUntilExpiry: number | null = null;
  if (expiresAt && !Number.isNaN(new Date(expiresAt).getTime())) {
    daysUntilExpiry = Math.round((new Date(expiresAt).getTime() - Date.now()) / (24 * 3600 * 1000));
  }
  let scope: string[] = [];
  try {
    const parsed = JSON.parse(String(row.scope ?? '[]'));
    scope = Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    scope = [];
  }
  return {
    id: String(row.id),
    provider: String(row.provider),
    label: String(row.label),
    kind: String(row.kind),
    scope,
    envVar: row.env_var ? String(row.env_var) : null,
    maskedHint: String(row.masked_hint),
    status: String(row.status),
    expiresAt,
    daysUntilExpiry,
    lastRotatedAt: row.last_rotated_at ? String(row.last_rotated_at) : null,
    // Rotations PERFORMED since the credential was first stored (creation is
    // the initial version, not a rotation).
    rotationCount: Number(row.rotation_count),
    createdAt: String(row.created_at),
  };
}

/**
 * Store a provider credential. The plaintext is encrypted immediately and is
 * never returned again — not by this function, not by any route, not in the
 * audit trail.
 */
export function storeCredential(input: {
  provider: string;
  label: string;
  kind?: string;
  scope?: string[];
  envVar?: string | null;
  secret: string;
  expiresAt?: string | null;
  actorId?: string | null;
}): CredentialPublic {
  return missionDb.transaction(() => {
  if (!vaultConfigured()) {
    throw new MissionAuthError(
      503,
      'the credential vault is not configured (set ZA141251SA_CREDENTIAL_KEY to a 32+ character secret) — refusing to store a credential unencrypted',
      'vault_not_configured',
    );
  }
  const secret = (input.secret ?? '').trim();
  if (secret.length < 8) throw new MissionSelfServiceError(400, 'the credential value is too short to be a provider secret', 'validation_error');
  const encrypted = encryptCredential(secret);
  const id = missionId('crd');
  missionDb.run(
    `INSERT INTO mission_credentials (id, provider, label, kind, scope, env_var, masked_hint, ciphertext, iv, tag, expires_at, last_rotated_at, rotation_count, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      id, input.provider.slice(0, 60), input.label.slice(0, 120), input.kind ?? 'api_key',
      JSON.stringify(input.scope ?? []), input.envVar ?? null, encrypted.hint,
      encrypted.ciphertext, encrypted.iv, encrypted.tag, input.expiresAt ?? null, nowIso(), input.actorId ?? null,
    ],
  );
  appendMissionAudit({
    actorType: input.actorId ? 'owner' : 'system',
    actorId: input.actorId ?? null,
    action: 'credential.stored',
    subjectType: 'credential',
    subjectId: id,
    // provider/label/expiry only — never the value, never the ciphertext.
    detail: { provider: input.provider, label: input.label, expiresAt: input.expiresAt ?? null },
  });
  return toPublicCredential(missionDb.get<Row>('SELECT * FROM mission_credentials WHERE id = ?', [id])!);

  });
}

/** Secrets never leave this surface: values are structurally absent. */
export function listCredentials(): CredentialPublic[] {
  return missionDb.all<Row>('SELECT * FROM mission_credentials ORDER BY created_at DESC').map(toPublicCredential);
}

export function getCredentialPublic(id: string): CredentialPublic | null {
  const row = missionDb.get<Row>('SELECT * FROM mission_credentials WHERE id = ?', [id]);
  return row ? toPublicCredential(row) : null;
}

export function rotateCredential(input: {
  id: string;
  secret: string;
  reason?: string | null;
  actorType?: 'owner' | 'agent';
  actorId?: string | null;
  verified?: boolean;
}): CredentialPublic {
  return missionDb.transaction(() => {
  if (!vaultConfigured()) {
    throw new MissionAuthError(503, 'the credential vault is not configured — rotation is disabled', 'vault_not_configured');
  }
  const row = missionDb.get<Row>('SELECT * FROM mission_credentials WHERE id = ?', [input.id]);
  if (!row) throw new MissionSelfServiceError(404, 'credential not found', 'not_found');
  if (String(row.status) === 'revoked') throw new MissionSelfServiceError(409, 'credential is revoked', 'conflict');
  const secret = (input.secret ?? '').trim();
  if (secret.length < 8) throw new MissionSelfServiceError(400, 'the replacement value is too short to be a provider secret', 'validation_error');
  const encrypted = encryptCredential(secret);
  missionDb.transaction(() => {
    missionDb.run(
      `UPDATE mission_credentials
         SET ciphertext = ?, iv = ?, tag = ?, masked_hint = ?, status = 'active',
             last_rotated_at = ?, rotation_count = rotation_count + 1, updated_at = ?
       WHERE id = ?`,
      [encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.hint, nowIso(), nowIso(), input.id],
    );
    missionDb.run(
      `INSERT INTO mission_credential_rotations (id, credential_id, reason, rotated_by, actor_type, new_hint, verified)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [missionId('rot'), input.id, (input.reason ?? '').slice(0, 300) || null, input.actorId ?? null, input.actorType ?? 'owner', encrypted.hint, input.verified ? 1 : 0],
    );
  });
  appendMissionAudit({
    actorType: input.actorType ?? 'owner',
    actorId: input.actorId ?? null,
    action: 'credential.rotated',
    subjectType: 'credential',
    subjectId: input.id,
    detail: { reason: input.reason ?? null, verified: Boolean(input.verified), hint: encrypted.hint },
  });
  return toPublicCredential(missionDb.get<Row>('SELECT * FROM mission_credentials WHERE id = ?', [input.id])!);

  });
}

export function revokeCredential(id: string, actorId: string, reason?: string | null, actorType?: SelfServiceActor): CredentialPublic {
  return missionDb.transaction(() => {
  assertOwnerAction(actorType, 'revoke a credential');
  const row = missionDb.get<Row>('SELECT * FROM mission_credentials WHERE id = ?', [id]);
  if (!row) throw new MissionSelfServiceError(404, 'credential not found', 'not_found');
  missionDb.run(`UPDATE mission_credentials SET status = 'revoked', updated_at = ? WHERE id = ?`, [nowIso(), id]);
  appendMissionAudit({ actorType: 'owner', actorId, action: 'credential.revoked', subjectType: 'credential', subjectId: id, detail: { reason: reason ?? null } });
  return toPublicCredential(missionDb.get<Row>('SELECT * FROM mission_credentials WHERE id = ?', [id])!);

  });
}

export function credentialRotations(credentialId: string): Row[] {
  return missionDb.all<Row>('SELECT * FROM mission_credential_rotations WHERE credential_id = ? ORDER BY created_at DESC', [credentialId]);
}

/** Expiry sweep: what needs rotation/attention, ordered by urgency. */
/**
 * Credentials that need attention because they are close to expiry. Revoked
 * credentials are excluded entirely: they are no longer usable, so reporting
 * them as "expiring" would raise a false alarm and hide the real work.
 */
export function expiringCredentials(withinDays = 30): Array<CredentialPublic & { urgency: 'expired' | 'critical' | 'soon' | 'ok' }> {
  return listCredentials()
    .filter((credential) => credential.status !== 'revoked')
    .map((credential) => {
      const days = credential.daysUntilExpiry;
      let urgency: 'expired' | 'critical' | 'soon' | 'ok' = 'ok';
      if (credential.status === 'revoked') urgency = 'ok';
      else if (days === null) urgency = 'ok';
      else if (days < 0) urgency = 'expired';
      else if (days <= 7) urgency = 'critical';
      else if (days <= withinDays) urgency = 'soon';
      return { ...credential, urgency };
    })
    .sort((a, b) => (a.daysUntilExpiry ?? 99999) - (b.daysUntilExpiry ?? 99999));
}

/** Sweep credential status (active → expiring → expired) and audit transitions. */
export function sweepCredentialStatus(): { updated: number; expired: number } {
  return missionDb.transaction(() => {
  const rows = missionDb.all<Row>('SELECT * FROM mission_credentials WHERE status != ?', ['revoked']);
  let updated = 0;
  let expired = 0;
  for (const row of rows) {
    const expiresAt = row.expires_at ? String(row.expires_at) : null;
    if (!expiresAt) continue;
    const days = (new Date(expiresAt).getTime() - Date.now()) / (24 * 3600 * 1000);
    const next = days < 0 ? 'expired' : days <= 14 ? 'expiring' : 'active';
    if (next !== String(row.status)) {
      missionDb.run('UPDATE mission_credentials SET status = ?, updated_at = ? WHERE id = ?', [next, nowIso(), String(row.id)]);
      appendMissionAudit({ actorType: 'system', action: `credential.${next}`, subjectType: 'credential', subjectId: String(row.id), detail: { expiresAt } });
      updated += 1;
      if (next === 'expired') expired += 1;
    }
  }
  return { updated, expired };

  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Resources (scoped infrastructure with expiry + usage + maintenance)
// ─────────────────────────────────────────────────────────────────────────────

export function requestResource(input: {
  agentId: string;
  kind: string;
  provider: string;
  plan?: string | null;
  monthlyCostCents?: number;
  autoRenew?: boolean;
  expiresAt?: string | null;
  limits?: Record<string, unknown> | null;
  credentialId?: string | null;
  actorId?: string | null;
}): Row {
  return missionDb.transaction(() => {
  const policy = currentPolicy();
  const monthly = input.monthlyCostCents ?? 0;
  if (!Number.isSafeInteger(monthly) || monthly < 0) throw new MissionSelfServiceError(400, 'resource cost must be nonnegative integer cents', 'validation_error');
  if (input.expiresAt && !Number.isFinite(Date.parse(input.expiresAt))) throw new MissionSelfServiceError(400, 'invalid resource expiry', 'validation_error');
  const id = missionId('res');
  const status = monthly >= policy.requireApprovalAboveCents ? 'requested' : 'approved';
  missionDb.run(
    `INSERT INTO mission_resources (id, agent_id, kind, provider, plan, monthly_cost_cents, status, auto_renew, expires_at, limits, credential_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.agentId, input.kind.slice(0, 40), input.provider.slice(0, 80), input.plan ?? null, monthly, status, input.autoRenew ? 1 : 0, input.expiresAt ?? null, input.limits ? JSON.stringify(input.limits) : null, input.credentialId ?? null],
  );
  if (status === 'requested') {
    requestApproval({ subjectType: 'resource', subjectId: id, action: 'resource.approve', amountCents: monthly, requestedBy: input.actorId ?? input.agentId, note: `${input.provider} ${input.kind}` });
  }
  appendMissionAudit({
    actorType: input.actorId ? 'owner' : 'agent',
    actorId: input.actorId ?? input.agentId,
    action: status === 'requested' ? 'resource.requested' : 'resource.created',
    subjectType: 'resource', subjectId: id,
    detail: { kind: input.kind, provider: input.provider, monthlyCostCents: monthly },
  });
  return missionDb.get<Row>('SELECT * FROM mission_resources WHERE id = ?', [id])!;

  });
}

export function decideResource(input: { id: string; decision: 'approved' | 'rejected'; actorId: string; note?: string | null; actorType?: SelfServiceActor }): Row {
  return missionDb.transaction(() => {
  assertOwnerAction(input.actorType, 'approve a resource');
  const row = missionDb.get<Row>('SELECT * FROM mission_resources WHERE id = ?', [input.id]);
  if (!row) throw new MissionSelfServiceError(404, 'resource not found', 'not_found');
  if (String(row.status) !== 'requested') throw new MissionSelfServiceError(409, `resource is ${row.status}`, 'conflict');
  missionDb.run('UPDATE mission_resources SET status = ?, updated_at = ? WHERE id = ?', [input.decision === 'approved' ? 'approved' : 'retired', nowIso(), input.id]);
  appendMissionAudit({ actorType: 'owner', actorId: input.actorId, action: `resource.${input.decision}`, subjectType: 'resource', subjectId: input.id, detail: { note: input.note ?? null } });
  return missionDb.get<Row>('SELECT * FROM mission_resources WHERE id = ?', [input.id])!;

  });
}

export function listResources(agentId?: string): Row[] {
  return agentId
    ? missionDb.all<Row>('SELECT * FROM mission_resources WHERE agent_id = ? ORDER BY created_at DESC', [agentId])
    : missionDb.all<Row>('SELECT * FROM mission_resources ORDER BY created_at DESC LIMIT 200');
}

export function recordResourceUsage(input: { id: string; usage: Record<string, unknown>; actorType?: 'owner' | 'agent' | 'provider'; actorId?: string | null }): Row {
  return missionDb.transaction(() => {
  const row = missionDb.get<Row>('SELECT * FROM mission_resources WHERE id = ?', [input.id]);
  if (!row) throw new MissionSelfServiceError(404, 'resource not found', 'not_found');
  if (input.actorType === 'agent' && String(row.agent_id) !== input.actorId) throw new MissionSelfServiceError(403, 'resource belongs to another agent', 'forbidden');
  missionDb.run('UPDATE mission_resources SET usage = ?, updated_at = ? WHERE id = ?', [JSON.stringify(input.usage).slice(0, 8000), nowIso(), input.id]);
  appendMissionAudit({
    actorType: input.actorType ?? 'agent', actorId: input.actorId ?? null,
    action: 'resource.usage_recorded', subjectType: 'resource', subjectId: input.id,
    detail: { keys: Object.keys(input.usage) },
  });
  return missionDb.get<Row>('SELECT * FROM mission_resources WHERE id = ?', [input.id])!;

  });
}

/** Renewal/maintenance sweep: what expires soon or has lapsed. */
export function resourceRenewals(withinDays = 30): Array<{ resource: Row; daysUntilExpiry: number | null; action: 'renew' | 'expired' | 'ok' }> {
  return listResources().map((resource) => {
    const expiresAt = resource.expires_at ? String(resource.expires_at) : null;
    const days = expiresAt ? Math.round((new Date(expiresAt).getTime() - Date.now()) / (24 * 3600 * 1000)) : null;
    const action: 'renew' | 'expired' | 'ok' = days === null ? 'ok' : days < 0 ? 'expired' : days <= withinDays ? 'renew' : 'ok';
    return { resource, daysUntilExpiry: days, action };
  });
}

export function retireResource(id: string, actorId: string, reason?: string | null, actorType?: SelfServiceActor): Row {
  return missionDb.transaction(() => {
  assertOwnerAction(actorType, 'retire a resource');
  const row = missionDb.get<Row>('SELECT * FROM mission_resources WHERE id = ?', [id]);
  if (!row) throw new MissionSelfServiceError(404, 'resource not found', 'not_found');
  missionDb.run(`UPDATE mission_resources SET status = 'retired', updated_at = ? WHERE id = ?`, [nowIso(), id]);
  appendMissionAudit({ actorType: 'owner', actorId, action: 'resource.retired', subjectType: 'resource', subjectId: id, detail: { reason: reason ?? null } });
  return missionDb.get<Row>('SELECT * FROM mission_resources WHERE id = ?', [id])!;

  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Upgrades (budget-checked; execution above the cap needs approval)
// ─────────────────────────────────────────────────────────────────────────────

export function requestUpgrade(input: {
  agentId: string;
  capability: string;
  requestedCostCents: number;
  justification?: string | null;
  walletId?: string | null;
  actorType?: 'owner' | 'agent';
  actorId?: string | null;
}): { upgrade: Row; budget: ReturnType<typeof canAgentSpend> | null } {
  return missionDb.transaction(() => {
  const policy = currentPolicy();
  const cost = input.requestedCostCents;
  if (!Number.isSafeInteger(cost) || cost < 0) throw new MissionSelfServiceError(400, 'upgrade cost must be nonnegative integer cents', 'validation_error');
  const walletId = input.walletId ?? missionDb.get<Row>('SELECT id FROM mission_wallets WHERE agent_id = ? AND status = ? LIMIT 1', [input.agentId, 'active'])?.id;
  const budget = walletId
    ? canAgentSpend({ walletId: String(walletId), amountCents: cost, category: 'upgrade', agentId: input.agentId }, policy, dailySpendCents(nowIso()))
    : null;
  const id = missionId('upg');
  missionDb.run(
    `INSERT INTO mission_upgrades (id, agent_id, capability, justification, requested_cost_cents, status, budget_ok, wallet_id)
     VALUES (?, ?, ?, ?, ?, 'requested', ?, ?)`,
    [id, input.agentId, input.capability.slice(0, 160), (input.justification ?? '').slice(0, 600) || null, cost, budget?.allowed ? 1 : 0, walletId ? String(walletId) : null],
  );
  requestApproval({
    subjectType: 'upgrade', subjectId: id, action: 'upgrade.approve', amountCents: cost,
    requestedBy: input.actorId ?? input.agentId,
    note: budget && !budget.allowed ? `budget check failed: ${budget.reasons.join('; ')}` : `capability: ${input.capability}`,
  });
  appendMissionAudit({
    actorType: input.actorType ?? 'agent', actorId: input.actorId ?? input.agentId,
    action: 'upgrade.requested', subjectType: 'upgrade', subjectId: id,
    detail: { capability: input.capability, costCents: cost, budgetOk: Boolean(budget?.allowed), reasons: budget?.reasons ?? [] },
  });
  return { upgrade: missionDb.get<Row>('SELECT * FROM mission_upgrades WHERE id = ?', [id])!, budget };

  });
}

export function decideUpgrade(input: { id: string; decision: 'approved' | 'rejected'; actorId: string; note?: string | null; actorType?: SelfServiceActor }): Row {
  return missionDb.transaction(() => {
  assertOwnerAction(input.actorType, 'approve an upgrade');
  const row = missionDb.get<Row>('SELECT * FROM mission_upgrades WHERE id = ?', [input.id]);
  if (!row) throw new MissionSelfServiceError(404, 'upgrade not found', 'not_found');
  if (String(row.status) !== 'requested') throw new MissionSelfServiceError(409, `upgrade is ${row.status}`, 'conflict');
  if (input.decision === 'rejected') {
    missionDb.run('UPDATE mission_upgrades SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?', ['rejected', input.actorId, nowIso(), input.id]);
  } else {
    // Approval is not payment: the cost is charged to the wallet only if one is
    // attached, and the debit itself can still be refused by the budget gate.
    const walletId = row.wallet_id ? String(row.wallet_id) : null;
    const cost = Number(row.requested_cost_cents);
    if (!walletId && cost > 0) throw new MissionSelfServiceError(409, 'a funded wallet is required for this upgrade', 'wallet_required');
    if (walletId && cost > 0) {
      const policy = currentPolicy();
      const decision = canAgentSpend({ walletId, amountCents: cost, category: 'upgrade', agentId: row.agent_id ? String(row.agent_id) : null }, policy, dailySpendCents(nowIso()));
      if (!decision.allowed && !decision.requiresApproval) {
        throw new MissionSelfServiceError(409, `budget check failed at approval time: ${decision.reasons.join('; ')}`, 'policy_denied');
      }
      debit({
        walletId, amountCents: cost, category: 'upgrade', reference: input.id, idempotencyKey: `upgrade:${input.id}`,
        memo: `capability upgrade: ${row.capability}`, actorType: 'owner', actorId: input.actorId,
      });
    }
    missionDb.run('UPDATE mission_upgrades SET status = ?, decided_by = ?, decided_at = ?, budget_ok = 1 WHERE id = ?', ['approved', input.actorId, nowIso(), input.id]);
  }
  appendMissionAudit({ actorType: 'owner', actorId: input.actorId, action: `upgrade.${input.decision}`, subjectType: 'upgrade', subjectId: input.id, detail: { note: input.note ?? null } });
  return missionDb.get<Row>('SELECT * FROM mission_upgrades WHERE id = ?', [input.id])!;

  });
}

export function applyUpgrade(id: string, actorId: string, actorType?: SelfServiceActor): Row {
  return missionDb.transaction(() => {
  assertOwnerAction(actorType, 'apply an upgrade');
  const row = missionDb.get<Row>('SELECT * FROM mission_upgrades WHERE id = ?', [id]);
  if (!row) throw new MissionSelfServiceError(404, 'upgrade not found', 'not_found');
  if (String(row.status) !== 'approved') throw new MissionSelfServiceError(409, `only approved upgrades can be applied (status: ${row.status})`, 'conflict');
  missionDb.run('UPDATE mission_upgrades SET status = ?, applied_at = ? WHERE id = ?', ['applied', nowIso(), id]);
  appendMissionAudit({ actorType: 'owner', actorId, action: 'upgrade.applied', subjectType: 'upgrade', subjectId: id });
  return missionDb.get<Row>('SELECT * FROM mission_upgrades WHERE id = ?', [id])!;

  });
}

export function listUpgrades(agentId?: string): Row[] {
  return agentId
    ? missionDb.all<Row>('SELECT * FROM mission_upgrades WHERE agent_id = ? ORDER BY created_at DESC', [agentId])
    : missionDb.all<Row>('SELECT * FROM mission_upgrades ORDER BY created_at DESC LIMIT 200');
}

// ─────────────────────────────────────────────────────────────────────────────
// Assigned services (maintenance records + health)
// ─────────────────────────────────────────────────────────────────────────────

export function createService(input: {
  agentId: string;
  name: string;
  kind: string;
  provider?: string | null;
  notes?: string | null;
  actorId?: string | null;
}): Row {
  const id = missionId('svc');
  missionDb.run(
    `INSERT INTO mission_services (id, agent_id, name, kind, provider, status, notes) VALUES (?, ?, ?, ?, ?, 'unknown', ?)`,
    [id, input.agentId, input.name.slice(0, 160), input.kind.slice(0, 40), input.provider ?? null, (input.notes ?? '').slice(0, 600) || null],
  );
  appendMissionAudit({
    actorType: input.actorId ? 'owner' : 'agent', actorId: input.actorId ?? input.agentId,
    action: 'service.created', subjectType: 'service', subjectId: id, detail: { name: input.name, kind: input.kind },
  });
  return missionDb.get<Row>('SELECT * FROM mission_services WHERE id = ?', [id])!;
}

export function listServices(agentId?: string): Row[] {
  return agentId
    ? missionDb.all<Row>('SELECT * FROM mission_services WHERE agent_id = ? ORDER BY created_at DESC', [agentId])
    : missionDb.all<Row>('SELECT * FROM mission_services ORDER BY created_at DESC LIMIT 200');
}

/**
 * Record a service health report. `healthSource` must name where the reading
 * came from (provider API / owner check / agent report) — an unlabelled health
 * number would be indistinguishable from an invented one.
 */
export function recordServiceHealth(input: {
  id: string;
  status: 'healthy' | 'degraded' | 'down' | 'maintenance' | 'unknown';
  healthSource: 'provider-api' | 'owner-check' | 'agent-report';
  notes?: string | null;
  actorType?: 'owner' | 'agent' | 'provider' | 'system';
  actorId?: string | null;
}): Row {
  const row = missionDb.get<Row>('SELECT * FROM mission_services WHERE id = ?', [input.id]);
  if (!row) throw new MissionSelfServiceError(404, 'service not found', 'not_found');
  missionDb.run(
    'UPDATE mission_services SET status = ?, health_source = ?, last_checked_at = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?',
    [input.status, input.healthSource, nowIso(), (input.notes ?? '').slice(0, 600) || null, nowIso(), input.id],
  );
  appendMissionAudit({
    actorType: input.actorType ?? 'agent', actorId: input.actorId ?? null,
    action: 'service.health_recorded', subjectType: 'service', subjectId: input.id,
    detail: { status: input.status, healthSource: input.healthSource },
  });
  return missionDb.get<Row>('SELECT * FROM mission_services WHERE id = ?', [input.id])!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-management summary (what an agent can see about its own operating kit)
// ─────────────────────────────────────────────────────────────────────────────

export interface SelfManagementSnapshot {
  tools: { approved: number; restricted: number; blocked: number; total: number };
  credentials: { total: number; expiringSoon: number; expired: number; vaultConfigured: boolean };
  resources: { total: number; active: number; expiringSoon: number; monthlyCostCents: number };
  upgrades: { requested: number; approved: number; applied: number };
  services: { total: number; healthy: number; degraded: number; down: number };
  requiresExternalActivation: Array<{ provider: string; action: string; why: string }>;
}

export const EXTERNAL_ACTIVATION: Array<{ provider: string; action: string; why: string }> = [
  { provider: 'google', action: 'Set GOOGLE_API_KEY in the deployment secret store', why: 'Real Gemini calls are refused (honest provider_not_configured error) until a key exists.' },
  { provider: 'search', action: 'Set a search provider key (TAVILY_API_KEY / BRAVE_SEARCH_API_KEY / SERPER_API_KEY) or AKBARAL_SEARCH_ENDPOINT', why: 'Without it the platform falls back to the keyless provider, which may be unavailable.' },
  { provider: 'payments', action: 'Connect the payment provider and set its webhook secret', why: 'Revenue can only be recorded as received against a verified provider/webhook reference.' },
  { provider: 'payouts', action: 'Configure and verify at least one of the four payout slots', why: 'Payouts are refused until a destination slot is verified by the owner.' },
  { provider: 'social', action: 'Activate platform accounts (YouTube/Instagram/TikTok OAuth) for publishing', why: 'Publishing is restricted until a platform account exists; engagement is only ever read from those APIs.' },
];

export function selfManagementSnapshot(agentId?: string): SelfManagementSnapshot {
  seedTools();
  const tools = missionDb.all<Row>('SELECT status, COUNT(*) AS count FROM mission_tools GROUP BY status');
  const toolCount = (status: string) => Number(tools.find((row) => String(row.status) === status)?.count ?? 0);
  const credentials = expiringCredentials(30);
  const resources = agentId ? listResources(agentId) : listResources();
  const renewals = resourceRenewals(30);
  const upgrades = listUpgrades(agentId);
  const services = listServices(agentId);
  const byStatus = (status: string) => upgrades.filter((row) => String(row.status) === status).length;
  return {
    tools: {
      approved: toolCount('approved'),
      restricted: toolCount('restricted'),
      blocked: toolCount('blocked'),
      total: tools.reduce((total, row) => total + Number(row.count), 0),
    },
    credentials: {
      total: credentials.length,
      expiringSoon: credentials.filter((row) => row.urgency === 'soon' || row.urgency === 'critical').length,
      expired: credentials.filter((row) => row.urgency === 'expired').length,
      vaultConfigured: vaultConfigured(),
    },
    resources: {
      total: resources.length,
      active: resources.filter((row) => String(row.status) === 'active').length,
      expiringSoon: renewals.filter((row) => row.action === 'renew').length,
      monthlyCostCents: resources.reduce((total, row) => total + Number(row.monthly_cost_cents), 0),
    },
    upgrades: { requested: byStatus('requested'), approved: byStatus('approved'), applied: byStatus('applied') },
    services: {
      total: services.length,
      healthy: services.filter((row) => String(row.status) === 'healthy').length,
      degraded: services.filter((row) => String(row.status) === 'degraded').length,
      down: services.filter((row) => String(row.status) === 'down').length,
    },
    requiresExternalActivation: EXTERNAL_ACTIVATION,
  };
}

/** Owner-recorded provider evidence; this never calls a payment API. */
export function provisionResource(input: { id: string; walletId?: string; actualCostCents: number; providerRef: string; evidence: string; actorId: string; actorType?: SelfServiceActor }): Row {
  assertOwnerAction(input.actorType, 'record resource provisioning');
  return missionDb.transaction(() => {
    const resource = missionDb.get<Row>('SELECT * FROM mission_resources WHERE id = ?', [input.id]);
    if (!resource) throw new MissionSelfServiceError(404, 'resource not found', 'not_found');
    if (!['approved', 'needs_verification'].includes(String(resource.status))) throw new MissionSelfServiceError(409, 'resource must be approved and not already provisioned', 'conflict');
    const amount = input.actualCostCents;
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > Number(resource.monthly_cost_cents)) throw new MissionSelfServiceError(400, 'actual resource cost exceeds its approved quote or is invalid', 'validation_error');
    if (looksLikeInstrumentCredential(input.providerRef).unsafe) throw new MissionSelfServiceError(400, 'provisioning reference must not contain payment instruments or credentials', 'unsafe_reference');
    if (input.providerRef.trim().length < 4 || input.evidence.trim().length < 12) throw new MissionSelfServiceError(400, 'provider reference and provisioning evidence are required', 'verification_required');
    if (missionDb.get('SELECT id FROM mission_resources WHERE provider = ? AND provisioning_ref = ?', [String(resource.provider), input.providerRef.trim()])) throw new MissionSelfServiceError(409, 'provider provisioning reference already recorded', 'duplicate_receipt');
    const policy = currentPolicy();
    if (policy.killSwitch) throw new MissionSelfServiceError(409, 'mission kill switch is engaged', 'policy_denied');
    if (amount > 0) {
      const wallet = input.walletId ? getWallet(input.walletId) : null;
      if (!wallet) throw new MissionSelfServiceError(409, 'select a funded mission wallet; customer funds are never used', 'wallet_required');
      if (wallet.agentId && wallet.agentId !== String(resource.agent_id)) throw new MissionSelfServiceError(403, 'resource cannot spend another agent wallet', 'forbidden');
      if (wallet.currency !== policy.currency) throw new MissionSelfServiceError(409, 'resource funding currency does not match mission currency', 'currency_mismatch');
      const gate = canAgentSpend({ walletId: wallet.id, agentId: String(resource.agent_id), amountCents: amount, category: 'expense' }, policy, dailySpendCents(nowIso()));
      if (!gate.allowed && !gate.requiresApproval) throw new MissionSelfServiceError(409, `resource funding refused: ${gate.reasons.join('; ')}`, 'policy_denied');
      debit({ walletId: wallet.id, amountCents: amount, category: 'expense', reference: input.id, idempotencyKey: `resource:${input.id}:provision`, actorType: 'owner', actorId: input.actorId, memo: `provider resource ${resource.provider}: ${input.providerRef.trim()}` });
    }
    missionDb.run('UPDATE mission_resources SET status = ?, funding_wallet_id = ?, provisioning_ref = ?, provisioned_cost_cents = ?, provisioned_at = ?, updated_at = ? WHERE id = ?', ['active', input.walletId ?? null, input.providerRef.trim(), amount, nowIso(), nowIso(), input.id]);
    appendMissionAudit({ actorType: 'owner', actorId: input.actorId, action: 'resource.provisioned', subjectType: 'resource', subjectId: input.id, detail: { providerRef: input.providerRef.trim(), evidence: input.evidence.trim(), amountCents: amount, fundingWalletId: input.walletId ?? null } });
    return missionDb.get<Row>('SELECT * FROM mission_resources WHERE id = ?', [input.id])!;
  });
}

/** Live readiness, independent of sweeps; never exposes credential plaintext. */
export function resourceReadiness(id: string): { usable: boolean; blockers: string[] } {
  const resource = missionDb.get<Row>('SELECT * FROM mission_resources WHERE id = ?', [id]);
  if (!resource) return { usable: false, blockers: ['resource_not_found'] };
  const blockers: string[] = [];
  if (currentPolicy().killSwitch) blockers.push('kill_switch_engaged');
  if (/api/i.test(String(resource.kind)) && !resource.credential_id) blockers.push('credential_not_configured');
  if (resource.status !== 'active' || !resource.provisioned_at) blockers.push('resource_not_provisioned');
  if (resource.expires_at && (!Number.isFinite(Date.parse(String(resource.expires_at))) || Date.parse(String(resource.expires_at)) <= Date.now())) blockers.push('resource_expired');
  if (resource.credential_id) {
    const credential = getCredentialPublic(String(resource.credential_id));
    if (!credential || !['active', 'expiring'].includes(credential.status) || (credential.expiresAt && (!Number.isFinite(Date.parse(credential.expiresAt)) || Date.parse(credential.expiresAt) <= Date.now()))) blockers.push('credential_unavailable_or_expired');
    if (credential && credential.provider !== String(resource.provider)) blockers.push('credential_provider_mismatch');
  }
  try {
    const limits = JSON.parse(String(resource.limits ?? '{}')) as Record<string, unknown>;
    const usage = JSON.parse(String(resource.usage ?? '{}')) as Record<string, unknown>;
    for (const [key, cap] of Object.entries(limits)) {
      if (typeof cap === 'number' && cap >= 0 && typeof usage[key] === 'number' && Number(usage[key]) >= cap) blockers.push(`quota_exhausted:${key}`);
    }
  } catch { blockers.push('invalid_usage_or_limits'); }
  return { usable: blockers.length === 0, blockers };
}
