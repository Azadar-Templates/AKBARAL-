import { missionDb, nowIso, type Row } from './database';

/**
 * Owner-only, read-only head-agent view.
 *
 * This module intentionally contains SELECTs only. It does not call a model,
 * enqueue a chat job, append an audit event, mutate an approval, or invoke a
 * provider. The deterministic chat below is an evidence lookup/explanation
 * layer, not an execution interface.
 */

export interface HeadAgentCitation {
  sourceType: string;
  recordId: string;
  label: string;
  endpoint: string;
  fact: string;
}

export interface HeadAgentAlert {
  id: string;
  kind: string;
  severity: string;
  title: string;
  message: string;
  subjectType: string | null;
  subjectId: string | null;
  dueAt: string | null;
  status: string;
  derived: boolean;
  citation: HeadAgentCitation;
}

const MAX_ROWS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

function limit(value: number | undefined, fallback = MAX_ROWS): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_ROWS, Math.max(1, Math.floor(value as number)));
}

function text(value: unknown): string | null {
  const result = value === null || value === undefined ? '' : String(value).trim();
  return result || null;
}

function jsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function jsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function citation(sourceType: string, recordId: string, label: string, endpoint: string, fact: string): HeadAgentCitation {
  return { sourceType, recordId, label, endpoint, fact };
}

function ownerExists(ownerId: string): boolean {
  return Boolean(ownerId && missionDb.get<Row>('SELECT id FROM mission_owner WHERE id = ?', [ownerId]));
}

function ownerRows(table: string, ownerId: string, order = 'updated_at DESC', rowLimit = MAX_ROWS): Row[] {
  // Table names and order clauses are constants at every call site; values are
  // still parameterized. This helper keeps all new owner scoping in one place.
  if (!ownerExists(ownerId)) return [];
  return missionDb.all<Row>(`SELECT * FROM ${table} WHERE owner_id = ? ORDER BY ${order} LIMIT ?`, [ownerId, limit(rowLimit)]);
}

function ownerCount(table: string, ownerId: string): number {
  if (!ownerExists(ownerId)) return 0;
  return Number(missionDb.get<Row>(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_id = ?`, [ownerId])?.count ?? 0);
}

function trackedResourceRows(ownerId: string, rowLimit = MAX_ROWS): Row[] {
  return ownerRows('mission_head_agent_resources', ownerId, 'expires_at ASC, updated_at DESC', rowLimit);
}

function resourceCost(row: Row): { cents: number | null; currency: string; status: 'verified' | 'unverified'; evidence: string | null } {
  const evidence = text(row.cost_evidence);
  const verified = String(row.cost_status) === 'verified' && Number.isSafeInteger(Number(row.cost_cents)) && Boolean(evidence);
  return {
    cents: verified ? Number(row.cost_cents) : row.cost_cents === null || row.cost_cents === undefined ? null : Number(row.cost_cents),
    currency: String(row.currency ?? 'USD'),
    status: verified ? 'verified' : 'unverified',
    evidence: verified ? evidence : null,
  };
}

function daysUntil(value: unknown, now = Date.now()): number | null {
  const timestamp = new Date(String(value ?? '')).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.ceil((timestamp - now) / DAY_MS);
}

export function listTrackedResources(ownerId: string, rowLimit = MAX_ROWS): Array<Record<string, unknown>> {
  return trackedResourceRows(ownerId, rowLimit).map((row) => ({
    id: String(row.id),
    label: String(row.label),
    category: String(row.category),
    provider: text(row.provider),
    expiresAt: text(row.expires_at),
    daysUntilExpiry: daysUntil(row.expires_at),
    cost: resourceCost(row),
    notes: text(row.notes),
    status: String(row.status),
    updatedAt: String(row.updated_at),
    citation: citation('tracked-resource', String(row.id), String(row.label), '/api/mission/head-agent/resources', 'Owner-tracked resource record.'),
  }));
}

function persistedAlerts(ownerId: string, rowLimit = MAX_ROWS): HeadAgentAlert[] {
  return ownerRows('mission_head_agent_alerts', ownerId, 'due_at ASC, updated_at DESC', rowLimit).map((row) => {
    const id = String(row.id);
    return {
      id,
      kind: String(row.kind),
      severity: String(row.severity),
      title: String(row.title),
      message: String(row.message),
      subjectType: text(row.subject_type),
      subjectId: text(row.subject_id),
      dueAt: text(row.due_at),
      status: String(row.status),
      derived: false,
      citation: citation('head-alert', id, String(row.title), '/api/mission/head-agent/alerts', 'Durable owner alert record.'),
    };
  });
}

function derivedAlerts(ownerId: string): HeadAgentAlert[] {
  const result: HeadAgentAlert[] = [];
  const now = Date.now();
  for (const resource of trackedResourceRows(ownerId)) {
    const days = daysUntil(resource.expires_at, now);
    if (days === null || days > 30) continue;
    const expired = days < 0 || String(resource.status) === 'expired';
    const id = `derived:resource-expiry:${String(resource.id)}`;
    result.push({
      id,
      kind: 'expiry',
      severity: expired ? 'critical' : days <= 7 ? 'warning' : 'info',
      title: expired ? `Resource expired: ${String(resource.label)}` : `Resource expiry: ${String(resource.label)}`,
      message: expired ? 'This tracked resource is past its recorded expiry. Owner review is required.' : `This tracked resource expires in ${days} day${days === 1 ? '' : 's'}.`,
      subjectType: 'tracked-resource',
      subjectId: String(resource.id),
      dueAt: text(resource.expires_at),
      status: 'open',
      derived: true,
      citation: citation('tracked-resource', String(resource.id), String(resource.label), '/api/mission/head-agent/resources', 'Expiry is derived from the recorded expires_at value; no renewal was performed.'),
    });
  }

  const approvals = missionDb.all<Row>(
    `SELECT id, subject_type, subject_id, created_at FROM mission_approvals WHERE status = 'pending' ORDER BY created_at DESC LIMIT ?`,
    [MAX_ROWS],
  );
  for (const row of approvals) {
    const id = `derived:approval:${String(row.id)}`;
    result.push({
      id,
      kind: 'approval',
      severity: 'warning',
      title: `Approval pending: ${String(row.subject_type)}`,
      message: 'A human owner decision is pending. The head agent cannot approve it.',
      subjectType: text(row.subject_type),
      subjectId: text(row.subject_id),
      dueAt: null,
      status: 'open',
      derived: true,
      citation: citation('approval', String(row.id), `Approval ${String(row.id)}`, '/api/mission/head-agent/approvals', 'Pending approval record; no decision was made.'),
    });
  }

  const payouts = missionDb.all<Row>(
    `SELECT id, slot, status, created_at FROM mission_payouts WHERE status = 'pending_approval' ORDER BY created_at DESC LIMIT ?`,
    [MAX_ROWS],
  );
  for (const row of payouts) {
    const id = `derived:payout:${String(row.id)}`;
    result.push({
      id,
      kind: 'payout',
      severity: 'warning',
      title: 'Payout awaiting owner approval',
      message: 'A payout is queued. It has not been approved, sent, or settled.',
      subjectType: 'payout',
      subjectId: String(row.id),
      dueAt: null,
      status: 'open',
      derived: true,
      citation: citation('payout', String(row.id), `Payout ${String(row.id)}`, '/api/mission/head-agent/payouts', 'Payout queue record; amount and settlement remain separately verified.'),
    });
  }
  return result;
}

export function listHeadAgentAlerts(ownerId: string, rowLimit = MAX_ROWS): HeadAgentAlert[] {
  if (!ownerExists(ownerId)) return [];
  return [...persistedAlerts(ownerId, rowLimit), ...derivedAlerts(ownerId)].slice(0, limit(rowLimit));
}

export function listHeadAgentInfo(ownerId: string, rowLimit = MAX_ROWS): Array<Record<string, unknown>> {
  return ownerRows('mission_head_agent_info', ownerId, 'topic ASC, updated_at DESC', rowLimit).map((row) => ({
    id: String(row.id),
    topic: String(row.topic),
    title: String(row.title),
    body: String(row.body),
    source: {
      type: String(row.source_type),
      id: text(row.source_id),
      label: text(row.source_label),
      endpoint: text(row.source_endpoint),
    },
    status: String(row.status),
    updatedAt: String(row.updated_at),
    citation: citation('head-info', String(row.id), String(row.title), '/api/mission/head-agent/info', 'Durable owner information record.'),
  }));
}

export function listHeadAgentAgents(ownerId: string, rowLimit = MAX_ROWS): Array<Record<string, unknown>> {
  // The owner is the tenancy boundary; agents are mission records rather than
  // owner rows, so the query intentionally has no cross-tenant join to public data.
  if (!ownerExists(ownerId)) return [];
  const rows = missionDb.all<Row>(
    `SELECT id, slug, name, category, role_key, status, mission_role, origin_platform, created_at, updated_at
       FROM mission_agents ORDER BY updated_at DESC, slug ASC LIMIT ?`,
    [limit(rowLimit)],
  );
  return rows.map((row) => ({
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    category: text(row.category),
    role: text(row.role_key),
    missionRole: text(row.mission_role),
    status: String(row.status),
    origin: text(row.origin_platform),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    citation: citation('agent', String(row.id), String(row.name), '/api/mission/head-agent/agents', 'Mission agent roster record.'),
  }));
}

export function listHeadAgentApprovals(ownerId: string, rowLimit = MAX_ROWS): Array<Record<string, unknown>> {
  if (!ownerExists(ownerId)) return [];
  const rows = missionDb.all<Row>(
    `SELECT id, subject_type, subject_id, action, amount_cents, status, requested_by, created_at
       FROM mission_approvals ORDER BY created_at DESC LIMIT ?`,
    [limit(rowLimit)],
  );
  return rows.map((row) => ({
    id: String(row.id),
    subjectType: String(row.subject_type),
    subjectId: String(row.subject_id),
    action: String(row.action),
    amount: { cents: Number(row.amount_cents), status: Number(row.amount_cents) > 0 ? 'requested-not-verified' : 'not-applicable' },
    status: String(row.status),
    requestedBy: text(row.requested_by),
    createdAt: String(row.created_at),
    citation: citation('approval', String(row.id), `Approval ${String(row.id)}`, '/api/mission/head-agent/approvals', 'Approval state is factual; the head agent cannot decide it.'),
  }));
}

function revenueRows(status: string, rowLimit: number): Row[] {
  return missionDb.all<Row>(
    `SELECT id, amount_cents, currency, source, status, verifier, received_at, created_at
       FROM mission_revenue WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
    [status, limit(rowLimit)],
  );
}

function verifiedReceivedRows(rowLimit: number): Row[] {
  return revenueRows('received', rowLimit).filter((row) => Boolean(text(row.verifier)));
}

export function headAgentEarnings(ownerId: string, rowLimit = MAX_ROWS): Record<string, unknown> {
  if (!ownerExists(ownerId)) return { realized: { amount: { cents: 0, currency: 'USD', status: 'verified-received' }, count: 0, records: [] }, contractedExpected: { amount: { cents: 0, currency: 'USD', status: 'unverified-not-earned' }, count: 0, records: [] }, note: 'Owner record not found.' };
  const realizedRows = verifiedReceivedRows(rowLimit);
  const expectedRows = [...revenueRows('contracted', rowLimit), ...revenueRows('expected', rowLimit)];
  const realizedAggregate = missionDb.get<Row>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS cents, COUNT(*) AS count, MIN(currency) AS currency
       FROM mission_revenue WHERE status = 'received' AND verifier IS NOT NULL AND TRIM(verifier) <> ''`,
  );
  const expectedAggregate = missionDb.get<Row>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS cents, COUNT(*) AS count, MIN(currency) AS currency
       FROM mission_revenue WHERE status IN ('contracted', 'expected')`,
  );
  return {
    realized: {
      amount: { cents: Number(realizedAggregate?.cents ?? 0), currency: String(realizedAggregate?.currency ?? 'USD'), status: 'verified-received' },
      count: Number(realizedAggregate?.count ?? 0),
      records: realizedRows.map((row) => ({
        id: String(row.id),
        amount: { cents: Number(row.amount_cents), currency: String(row.currency), status: 'verified-received' },
        source: String(row.source),
        verifier: String(row.verifier),
        receivedAt: text(row.received_at),
        citation: citation('revenue', String(row.id), `Verified receipt ${String(row.id)}`, '/api/mission/head-agent/earnings', 'mission_revenue status=received with a non-empty verifier.'),
      })),
    },
    contractedExpected: {
      amount: { cents: Number(expectedAggregate?.cents ?? 0), currency: String(expectedAggregate?.currency ?? 'USD'), status: 'unverified-not-earned' },
      count: Number(expectedAggregate?.count ?? 0),
      records: expectedRows.map((row) => ({
        id: String(row.id),
        amount: { cents: Number(row.amount_cents), currency: String(row.currency), status: 'unverified-not-earned' },
        status: String(row.status),
        source: String(row.source),
        citation: citation('revenue', String(row.id), `Non-realized revenue record ${String(row.id)}`, '/api/mission/head-agent/earnings', 'Contracted/expected amount; not realized revenue.'),
      })),
    },
    note: 'Only received records with a non-empty verifier are shown as realized. Contracted and expected records are separate and are not earnings.',
  };
}

export function listHeadAgentPayouts(ownerId: string, rowLimit = MAX_ROWS): Array<Record<string, unknown>> {
  if (!ownerExists(ownerId)) return [];
  const rows = missionDb.all<Row>(
    `SELECT p.id, p.slot, p.status, p.amount_cents, p.currency, p.approval_id, p.requested_by, p.approved_by, p.approved_at, p.settlement_ref, p.created_at,
            s.status AS slot_status, s.verified_at AS slot_verified_at
       FROM mission_payouts p LEFT JOIN mission_payout_slots s ON s.slot = p.slot
      WHERE p.status IN ('pending_approval','approved','sent','settled','failed','rejected')
      ORDER BY p.created_at DESC LIMIT ?`,
    [limit(rowLimit)],
  );
  return rows.map((row) => ({
    id: String(row.id),
    slot: Number(row.slot),
    status: String(row.status),
    amount: { status: 'unverified-not-settled', cents: Number(row.amount_cents), currency: String(row.currency ?? 'USD') },
    approvalId: text(row.approval_id),
    requestedBy: text(row.requested_by),
    approvedBy: text(row.approved_by),
    approvedAt: text(row.approved_at),
    settlement: text(row.settlement_ref) ? 'settlement reference recorded' : 'not settled',
    slotVerification: {
      status: text(row.slot_status) ?? 'unconfigured',
      verifiedAt: text(row.slot_verified_at),
    },
    createdAt: String(row.created_at),
    citation: citation('payout', String(row.id), `Payout ${String(row.id)}`, '/api/mission/head-agent/payouts', 'Payout and destination verification state from mission payout records.'),
  }));
}

export function listHeadAgentProviders(ownerId: string, rowLimit = MAX_ROWS): Array<Record<string, unknown>> {
  if (!ownerExists(ownerId)) return [];
  const rows = missionDb.all<Row>(
    `SELECT id, provider_id, label, kind, credential_env, requires_owner_account, payout_verifiable, api_permitted, status, health_json, owner_actions_json, updated_at
       FROM mission_provider_readiness ORDER BY updated_at DESC, provider_id ASC LIMIT ?`,
    [limit(rowLimit)],
  );
  return rows.map((row) => {
    const health = jsonObject(row.health_json);
    const failures = missionDb.all<Row>(
      `SELECT failure_code, category, retry_after, attempts, created_at FROM mission_provider_failures WHERE provider_id = ? ORDER BY created_at DESC LIMIT 1`,
      [String(row.provider_id)],
    );
    const failure = failures[0];
    return {
      id: String(row.id),
      providerId: String(row.provider_id),
      label: String(row.label),
      kind: String(row.kind),
      credentialEnv: text(row.credential_env),
      requiresOwnerAccount: Number(row.requires_owner_account) === 1,
      payoutVerifiable: Number(row.payout_verifiable) === 1,
      apiPermitted: Number(row.api_permitted) === 1,
      status: String(row.status),
      health: { ok: health.ok ?? null, lastCheck: health.lastCheck ?? null, latencyMs: health.latencyMs ?? null, providerCode: health.providerCode ?? null },
      ownerActions: jsonArray(row.owner_actions_json),
      latestFailure: failure ? { code: String(failure.failure_code), category: String(failure.category), retryAfter: text(failure.retry_after), attempts: Number(failure.attempts), createdAt: String(failure.created_at) } : null,
      updatedAt: String(row.updated_at),
      citation: citation('provider-readiness', String(row.provider_id), String(row.label), '/api/mission/head-agent/providers', 'Provider readiness and failure records; no provider action was attempted.'),
    };
  });
}

export function listHeadAgentOpportunities(ownerId: string, rowLimit = MAX_ROWS): Array<Record<string, unknown>> {
  if (!ownerExists(ownerId)) return [];
  const rows = missionDb.all<Row>(
    `SELECT id, source, provider, external_id, service_id, brief, quote_cents, evidence_hash, evidence, observed_at, consent_expires_at, eligibility_json, state, created_at
       FROM mission_discovery_opportunities ORDER BY created_at DESC LIMIT ?`,
    [limit(rowLimit)],
  );
  return rows.map((row) => ({
    id: String(row.id),
    source: String(row.source),
    provider: String(row.provider),
    externalId: String(row.external_id),
    serviceId: String(row.service_id),
    brief: String(row.brief),
    quote: { cents: Number(row.quote_cents), currency: 'USD', status: 'unverified-not-revenue' },
    evidenceHash: String(row.evidence_hash),
    evidence: String(row.evidence),
    observedAt: String(row.observed_at),
    consentExpiresAt: String(row.consent_expires_at),
    eligibility: jsonObject(row.eligibility_json),
    state: String(row.state),
    createdAt: String(row.created_at),
    citation: citation('discovery-opportunity', String(row.id), `Opportunity ${String(row.id)}`, '/api/mission/head-agent/opportunities', 'Discovery record with source, evidence, consent and eligibility. Discovered opportunities are not revenue.'),
  }));
}

export function headAgentOverview(ownerId: string): Record<string, unknown> {
  const agents = listHeadAgentAgents(ownerId);
  const approvals = listHeadAgentApprovals(ownerId);
  const alerts = listHeadAgentAlerts(ownerId);
  const resources = listTrackedResources(ownerId);
  const earnings = headAgentEarnings(ownerId);
  const providers = listHeadAgentProviders(ownerId);
  const opportunities = listHeadAgentOpportunities(ownerId);
  const payouts = listHeadAgentPayouts(ownerId);
  const statusRows = ownerExists(ownerId)
    ? missionDb.all<Row>('SELECT status, COUNT(*) AS count FROM mission_agents GROUP BY status')
    : [];
  const statusCounts = statusRows.reduce<Record<string, number>>((counts, row) => {
    counts[String(row.status)] = Number(row.count);
    return counts;
  }, {});
  const totalAgentRecords = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  return {
    readOnly: true,
    generatedAt: nowIso(),
    notificationDelivery: 'UNKNOWN / VERIFY REQUIRED',
    missionStatus: {
      agents: { total: totalAgentRecords, returned: agents.length, byStatus: statusCounts },
      pendingApprovals: ownerExists(ownerId) ? Number(missionDb.get<Row>(`SELECT COUNT(*) AS count FROM mission_approvals WHERE status = 'pending'`)?.count ?? 0) : 0,
      openAlerts: alerts.filter((row) => String(row.status) === 'open').length,
      trackedResources: ownerCount('mission_head_agent_resources', ownerId),
      providerReadinessRecords: ownerExists(ownerId) ? Number(missionDb.get<Row>('SELECT COUNT(*) AS count FROM mission_provider_readiness')?.count ?? 0) : 0,
      discoveredOpportunities: ownerExists(ownerId) ? Number(missionDb.get<Row>('SELECT COUNT(*) AS count FROM mission_discovery_opportunities')?.count ?? 0) : 0,
      payoutQueueRecords: ownerExists(ownerId) ? Number(missionDb.get<Row>(`SELECT COUNT(*) AS count FROM mission_payouts WHERE status = 'pending_approval'`)?.count ?? 0) : 0,
    },
    agents,
    approvals,
    earnings,
    resources,
    alerts,
    providers,
    opportunities,
    payouts,
    info: listHeadAgentInfo(ownerId),
    boundaries: [
      'The head agent may read, explain, list approvals and flag expiry/provider state.',
      'Every mission action remains a human owner decision. No purchase, account creation, submission, approval, payout, or external action is available here.',
      'Discovery records, quotes and expected amounts are not revenue. Realized revenue requires received status and a non-empty verifier.',
    ],
  };
}

function contains(question: string, words: string[]): boolean {
  return words.some((word) => question.includes(word));
}

export function headAgentChat(ownerId: string, question: string): Record<string, unknown> {
  const normalized = question.trim().toLocaleLowerCase();
  if (!normalized) throw new Error('question is required');
  if (normalized.length > 2000) throw new Error('question is too long');

  const overview = headAgentOverview(ownerId);
  const citations: HeadAgentCitation[] = [];
  const add = (items: unknown): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const record = item as Record<string, unknown>;
      if (record.citation && typeof record.citation === 'object') citations.push(record.citation as HeadAgentCitation);
      if (citations.length >= 8) break;
    }
  };
  const agents = overview.agents as Array<Record<string, unknown>>;
  const alerts = overview.alerts as HeadAgentAlert[];
  const approvals = overview.approvals as Array<Record<string, unknown>>;
  const resources = overview.resources as Array<Record<string, unknown>>;
  const providers = overview.providers as Array<Record<string, unknown>>;
  const opportunities = overview.opportunities as Array<Record<string, unknown>>;
  const payouts = overview.payouts as Array<Record<string, unknown>>;
  const earnings = overview.earnings as Record<string, any>;
  let answer: string;

  if (contains(normalized, ['approval', 'approve', 'pending', 'منظوری'])) {
    const pending = approvals.filter((row) => String(row.status) === 'pending');
    add(pending);
    answer = pending.length
      ? `${pending.length} approval${pending.length === 1 ? '' : 's'} are pending. The head agent can list and explain them, but cannot approve or reject them.`
      : 'There are no pending approval records. No approval action was taken.';
  } else if (contains(normalized, ['earning', 'revenue', 'income', 'kamai', 'کمائی'])) {
    add((earnings.realized as Record<string, unknown>).records);
    add((earnings.contractedExpected as Record<string, unknown>).records);
    const realized = (earnings.realized as Record<string, any>).amount;
    const expected = (earnings.contractedExpected as Record<string, any>).amount;
    answer = `Verified realized revenue is ${realized.cents} ${realized.currency} across ${(earnings.realized as any).count} record(s). Contracted/expected is kept separate at ${expected.cents} ${expected.currency} and is not earned revenue.`;
  } else if (contains(normalized, ['expiry', 'expire', 'renew', 'resource', 'renewal'])) {
    add(alerts.filter((alert) => alert.kind === 'expiry'));
    add(resources);
    const expiryAlerts = alerts.filter((alert) => alert.kind === 'expiry');
    answer = expiryAlerts.length
      ? `${expiryAlerts.length} resource expiry alert${expiryAlerts.length === 1 ? '' : 's'} need owner review. No resource was renewed or changed.`
      : 'No tracked resource expiry alert is currently recorded or derived within the 30-day review window.';
  } else if (contains(normalized, ['provider', 'connector', 'readiness', 'failure'])) {
    add(providers);
    const blocked = providers.filter((row) => !['ready', 'configured'].includes(String(row.status)));
    answer = blocked.length
      ? `${blocked.length} provider readiness record(s) are not ready/configured. The head agent reports the blocker evidence only; it did not call a provider.`
      : providers.length ? 'All stored provider readiness records are ready or configured. This is readiness evidence, not proof of earnings.' : 'No provider readiness records are stored.';
  } else if (contains(normalized, ['opportun', 'lead', 'job', 'client'])) {
    add(opportunities);
    answer = opportunities.length
      ? `${opportunities.length} discovery record(s) are available. They retain source, evidence, consent and eligibility, but discovered leads and quotes are not revenue.`
      : 'No discovery opportunity records are stored. No demand, earnings or availability is inferred.';
  } else if (contains(normalized, ['payout', 'withdraw', 'payment queue'])) {
    add(payouts);
    const pending = payouts.filter((row) => String(row.status) === 'pending_approval');
    answer = pending.length
      ? `${pending.length} payout request(s) are awaiting the human owner. The head agent cannot approve, send, settle, or change a payout.`
      : 'No payout is currently awaiting owner approval. Existing payout records, if any, remain read-only here.';
  } else if (contains(normalized, ['agent', 'status', 'what', 'kya', 'happening'])) {
    add(agents);
    const status = (overview.missionStatus as Record<string, unknown>).agents as Record<string, unknown>;
    answer = `The mission roster contains ${status.total} agent record(s). Current status counts are ${JSON.stringify(status.byStatus)}. The head agent is read-only and notify-only.`;
  } else {
    add(alerts);
    add(approvals);
    add(agents);
    const status = overview.missionStatus as Record<string, unknown>;
    answer = `Read-only mission status: ${JSON.stringify(status)}. I can explain approvals, verified earnings, resource expiry, provider readiness, payout queue state and discovery evidence. No action was taken.`;
  }

  return {
    readOnly: true,
    answer,
    citations: citations.slice(0, 8),
    notificationDelivery: 'UNKNOWN / VERIFY REQUIRED',
  };
}
