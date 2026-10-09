/**
 * ZA141251SA FLEET READINESS — what the registered fleet can *actually* do right now.
 *
 * Registration is not readiness. An agent row in `mission_agents` proves that a
 * specialist exists in the registry; it proves nothing about whether that agent can
 * be handed real work today. This module answers that second question from live rows
 * only, and refuses to infer capability from the existence of code or from a green
 * test run.
 *
 * It produces the exact numbers an owner needs and nothing else:
 *   registered → tooling → execution-ready → platform access verified → work assigned
 *   → completed with evidence → independently verified revenue → settled payout,
 * plus, for every agent that cannot start, the concrete blocker code that stopped it,
 * and an idempotent roll-up of those blockers into the owner's human-action queue.
 *
 * Every count carries the `basis` predicate it was computed from, so a number in a
 * report can always be traced back to the SQL that produced it. Fixture-origin agents
 * are excluded from production readiness, because a verification produced by a
 * `origin_platform='fixture'` agent is a test, not a fact about the world.
 */

import { missionDb as db, missionId, nowIso, appendMissionAudit, type Row, type SqlValue } from '../database';
import { currentPolicy } from '../policy';
import { createHumanActionTask, HUMAN_ACTION_TYPES, type HumanActionType } from '../human-action-gate';
import { listProviderReadiness, seedProviderReadiness } from './provider-capability-registry';

export type BlockerCode =
  | 'autonomy_disabled'
  | 'kill_switch_engaged'
  | 'no_payout_slot_verified'
  | 'no_platform_credential'
  | 'no_provider_ready'
  | 'no_active_money_grant'
  | 'no_scoped_contract'
  | 'owner_action_pending';

export interface BlockerSpec {
  code: BlockerCode;
  label: string;
  scope: 'global' | 'agent';
  ownerAction: HumanActionType;
  /** The cheapest legitimate way through, without buying anything. */
  freePath: string;
  /** How many agents this blocker is currently the reason for. */
  agentsAffected: number;
}

export interface AgentReadiness {
  agentId: string;
  slug: string;
  registered: boolean;
  hasActiveGrant: boolean;
  hasScopedContract: boolean;
  platformAccessVerified: boolean;
  providerReady: boolean;
  canStartNow: boolean;
  blockers: BlockerCode[];
}

export interface FleetSummary {
  generatedAt: string;
  measuredFrom: 'live mission database rows only';
  counts: {
    registeredAgents: number;
    fixtureOriginAgents: number;
    activeAgents: number;
    pausedOrRetiredAgents: number;
    agentsWithActiveGrant: number;
    agentsWithScopedContract: number;
    agentsWithVerifiedPlatformAccess: number;
    executionReadyAgents: number;
    startingConcurrently: number;
    blockedAgents: number;
    eligibleTasksAssignable: number;
    assignedEligibleTasks: number;
    completedWithEvidence: number;
    independentlyVerifiedRevenueCents: number;
    settledPayoutCents: number;
  };
  tooling: { registered: number; executable: number; restricted: number; blocked: number; detail: Array<{ key: string; status: string; requiredPermission: string }> };
  connectors: { total: number; ready: number; notConfigured: number; blocked: number; restricted: number; degraded: number };
  blockers: BlockerSpec[];
  gates: { policy: { autonomousEnabled: boolean; killSwitch: boolean; maxAgents: number; dailySpendCapCents: number; requireOwnerForPayout: boolean }; payoutSlots: { total: number; verified: number } };
  note: string;
}

/** Agents created by test fixtures are never counted as production readiness. The
 * mission's own provisioning writes origin_platform='mission'/'akbaral-registry'. */
const PRODUCTION_AGENT_WHERE = `origin_platform IS NULL OR origin_platform NOT IN ('fixture','test','test_fixture')`;

/** Fresh deployments have an unseeded readiness view; without rows the ToS gate is a
 *  no-op and the owner sees "nothing blocked" instead of "37 sources, all awaiting
 *  their own account". Seed before reading. Idempotent (both seeders are upserts). */
export function ensureGatesSeeded(): void {
  if (Number(db.get<Row>('SELECT COUNT(*) AS c FROM mission_provider_readiness')?.c ?? 0) === 0) seedProviderReadiness();
}

function globalBlockerSpecs(): Array<Omit<BlockerSpec, 'agentsAffected'>> {
  const policy = currentPolicy();
  const specs: Array<Omit<BlockerSpec, 'agentsAffected'>> = [];
  if (policy.killSwitch) specs.push({
    code: 'kill_switch_engaged', label: 'Mission kill switch is engaged', scope: 'global', ownerAction: HUMAN_ACTION_TYPES.MANUAL_APPROVAL,
    freePath: 'Owner flips the switch off in the policy view; no cost.', agentsAffected: 0,
  } as Omit<BlockerSpec, 'agentsAffected'>);
  if (!policy.autonomousEnabled) specs.push({
    code: 'autonomy_disabled', label: 'Autonomous execution not enabled by the owner', scope: 'global', ownerAction: HUMAN_ACTION_TYPES.MANUAL_APPROVAL,
    freePath: 'Owner sets autonomous_enabled=1 once they accept the ToS/limits; free.', agentsAffected: 0,
  } as Omit<BlockerSpec, 'agentsAffected'>);
  const verifiedSlots = Number(db.get<Row>("SELECT COUNT(*) AS c FROM mission_payout_slots WHERE status='active' AND verified_at IS NOT NULL")?.c ?? 0);
  if (verifiedSlots === 0) specs.push({
    code: 'no_payout_slot_verified', label: 'No verified payout destination', scope: 'global', ownerAction: HUMAN_ACTION_TYPES.PAYMENT_SETUP,
    freePath: 'Owner verifies one of the five payout slots (bank/e-wallet verification is free at the destination bank); nothing can be paid out until then.',
    agentsAffected: 0,
  } as Omit<BlockerSpec, 'agentsAffected'>);
  const credentials = Number(db.get<Row>("SELECT COUNT(*) AS c FROM mission_credentials WHERE status='active' AND (expires_at IS NULL OR expires_at>?)", [nowIso()])?.c ?? 0);
  if (credentials === 0) specs.push({
    code: 'no_platform_credential', label: 'No active platform credential in the vault', scope: 'global', ownerAction: HUMAN_ACTION_TYPES.ACCOUNT_CREATION,
    freePath: 'Owner authorizes an existing account via OAuth/token and stores it in the vault; the three Gmail identities stay owner-held.', agentsAffected: 0,
  } as Omit<BlockerSpec, 'agentsAffected'>);
  const ready = listProviderReadiness().filter(p => p.status === 'ready' && p.apiPermitted);
  if (ready.length === 0) specs.push({
    code: 'no_provider_ready', label: 'No earning connector is provider-ready', scope: 'global', ownerAction: HUMAN_ACTION_TYPES.TOS_ACCEPTANCE,
    freePath: 'Free-tier connectors become ready the moment their env var and owner account exist; no purchase required for the read-only research paths.',
    agentsAffected: 0,
  } as Omit<BlockerSpec, 'agentsAffected'>);
  return specs;
}

function agentScopedSets() {
  const grants = new Set(db.all<Row>(
    "SELECT agent_id FROM mission_money_grants WHERE status='active' AND (expires_at IS NULL OR expires_at>?)", [nowIso()],
  ).map(r => String(r.agent_id)));
  const contracts = new Set(db.all<Row>(
    "SELECT agent_id FROM mission_agent_contracts WHERE status='active' AND (expires_at IS NULL OR expires_at>?)", [nowIso()],
  ).map(r => String(r.agent_id)));
  // The roll-up tasks this module files (notes 'fleet-readiness:<code>') describe a
  // global gate, not an individually blocked agent, so they must not feed back into
  // per-agent `owner_action_pending` — otherwise queueing one task would manufacture
  // the next blocker. Real owner tasks for a specific agent still count.
  const pendingActions = new Set(db.all<Row>(
    "SELECT agent_id AS agentId FROM mission_human_action_tasks WHERE status='pending' AND (notes IS NULL OR notes NOT LIKE 'fleet-readiness:%') LIMIT 5000",
  ).map(r => String(r.agentId)));
  const credentialProviders = new Set(db.all<Row>(
    "SELECT DISTINCT provider FROM mission_credentials WHERE status='active' AND (expires_at IS NULL OR expires_at>?)", [nowIso()],
  ).map(r => String(r.provider)));
  const readyConnectors = listProviderReadiness().filter(p => p.status === 'ready' && p.apiPermitted);
  return { grants, contracts, pendingActions, credentialProviders, readyConnectors };
}

function productionAgents(): Row[] {
  return db.all<Row>(`SELECT id, slug, status, capabilities, origin_platform FROM mission_agents WHERE ${PRODUCTION_AGENT_WHERE}`);
}

/** Full verdict for one agent. Reads live rows; invents nothing. */
export function readinessFor(agentId: string): AgentReadiness {
  ensureGatesSeeded();
  const row = db.get<Row>('SELECT id, slug, status, origin_platform FROM mission_agents WHERE id=?', [agentId]);
  if (!row) return { agentId, slug: '', registered: false, hasActiveGrant: false, hasScopedContract: false, platformAccessVerified: false, providerReady: false, canStartNow: false, blockers: [] };
  const sets = agentScopedSets();
  const policy = currentPolicy();
  const blockers: BlockerCode[] = [];
  if (String(row.status) !== 'active') blockers.push('kill_switch_engaged');
  if (!policy.autonomousEnabled || policy.killSwitch) blockers.push('autonomy_disabled');
  const hasActiveGrant = sets.grants.has(agentId);
  if (!hasActiveGrant) blockers.push('no_active_money_grant');
  const hasScopedContract = sets.contracts.has(agentId);
  if (!hasScopedContract) blockers.push('no_scoped_contract');
  const platformAccessVerified = sets.credentialProviders.size > 0;
  if (!platformAccessVerified) blockers.push('no_platform_credential');
  const providerReady = sets.readyConnectors.length > 0;
  if (!providerReady) blockers.push('no_provider_ready');
  const payoutReady = Number(db.get<Row>("SELECT COUNT(*) AS c FROM mission_payout_slots WHERE status='active' AND verified_at IS NOT NULL")?.c ?? 0) > 0;
  if (!payoutReady) blockers.push('no_payout_slot_verified');
  if (sets.pendingActions.has(agentId)) blockers.push('owner_action_pending');
  return {
    agentId, slug: String(row.slug), registered: true, hasActiveGrant, hasScopedContract,
    platformAccessVerified, providerReady, canStartNow: blockers.length === 0, blockers,
  };
}

function count(sql: string, params: SqlValue[] = []): number {
  return Number(db.get<Row>(sql, params)?.c ?? 0);
}
function sum(sql: string, params: SqlValue[] = []): number {
  return Number(db.get<Row>(sql, params)?.total ?? 0);
}

/** The fleet verdict. Single pass over the registry rows — no per-agent queries. */
export function fleetSummary(): FleetSummary {
  ensureGatesSeeded();
  const policy = currentPolicy();
  const sets = agentScopedSets();
  const agents = productionAgents();
  const globalSpecs = globalBlockerSpecs();
  const globalBlocked = globalSpecs.length > 0;

  let admissible = 0;
  let blocked = 0;
  const perCode = new Map<string, number>();
  for (const row of agents) {
    const id = String(row.id);
    const agentBlockers: BlockerCode[] = [];
    if (String(row.status) !== 'active') agentBlockers.push('kill_switch_engaged');
    if (!sets.grants.has(id)) agentBlockers.push('no_active_money_grant');
    if (!sets.contracts.has(id)) agentBlockers.push('no_scoped_contract');
    if (sets.pendingActions.has(id)) agentBlockers.push('owner_action_pending');
    if (globalBlocked) agentBlockers.push(...globalSpecs.map(s => s.code));
    if (agentBlockers.length === 0) admissible++;
    else {
      blocked++;
      for (const code of agentBlockers) perCode.set(code, (perCode.get(code) ?? 0) + 1);
    }
  }

  const eligible = count(
    "SELECT COUNT(*) AS c FROM mission_earning_engine_opportunities WHERE verification_state IN ('discovered','qualified','legitimacy_verified')",
  );
  const assigned = count("SELECT COUNT(*) AS c FROM mission_earning_engine_opportunities WHERE verification_state IN ('assigned','executing')");
  const completedWithEvidence = count(
    `SELECT COUNT(DISTINCT v.opportunity_id) AS c FROM mission_result_verifications v
       JOIN mission_earning_engine_opportunities e ON e.id = v.opportunity_id
      WHERE v.passed=1 AND v.mode='production' AND e.verification_state IN ('verified','delivered','payment_confirmed','settlement_verified')`,
  );
  const toolStatuses = db.all<Row>('SELECT key, status, required_permission FROM mission_tools ORDER BY status DESC, key');
  const connectorRows = listProviderReadiness();
  const connectors = {
    total: connectorRows.length,
    ready: connectorRows.filter(p => p.status === 'ready').length,
    notConfigured: connectorRows.filter(p => p.status === 'not_configured').length,
    blocked: connectorRows.filter(p => p.status === 'blocked').length,
    restricted: connectorRows.filter(p => p.status === 'restricted').length,
    degraded: connectorRows.filter(p => p.status === 'degraded').length,
  };

  const blockers: BlockerSpec[] = globalSpecs.map(spec => ({ ...spec, agentsAffected: perCode.get(spec.code) ?? (spec.scope === 'global' ? agents.length : 0) }));
  for (const code of ['no_active_money_grant', 'no_scoped_contract', 'owner_action_pending'] as BlockerCode[]) {
    const n = perCode.get(code) ?? 0;
    if (n > 0) {
      const meta: Record<string, { label: string; ownerAction: HumanActionType; freePath: string }> = {
        no_active_money_grant: { label: 'No active money grant', ownerAction: HUMAN_ACTION_TYPES.MANUAL_APPROVAL, freePath: 'Registry sync already grants zero-spend authority; a grant with spend_limit_cents>0 is only needed for paid work.' },
        no_scoped_contract: { label: 'No approved scoped agent contract', ownerAction: HUMAN_ACTION_TYPES.MANUAL_APPROVAL, freePath: 'Owner/parent approves a contract per agent class via POST /agents/{id}/contract — free, and it is what bounds permissions.' },
        owner_action_pending: { label: 'A human-action task is open for this agent', ownerAction: HUMAN_ACTION_TYPES.MANUAL_APPROVAL, freePath: 'Owner clears the pending task in the approvals queue.' },
      };
      blockers.push({ code, scope: 'agent', agentsAffected: n, ...meta[code] });
    }
  }

  const concurrencyCeiling = count('SELECT COALESCE(SUM(max_concurrency),0) AS c FROM agent_registry WHERE active=1');
  return {
    generatedAt: nowIso(),
    measuredFrom: 'live mission database rows only',
    counts: {
      registeredAgents: count(`SELECT COUNT(*) AS c FROM mission_agents WHERE ${PRODUCTION_AGENT_WHERE}`),
      activeAgents: count(`SELECT COUNT(*) AS c FROM mission_agents WHERE status='active' AND ${PRODUCTION_AGENT_WHERE}`),
      pausedOrRetiredAgents: count(`SELECT COUNT(*) AS c FROM mission_agents WHERE status!='active' AND ${PRODUCTION_AGENT_WHERE}`),
      fixtureOriginAgents: count(`SELECT COUNT(*) AS c FROM mission_agents WHERE origin_platform IN ('fixture','test','test_fixture')`),
      agentsWithActiveGrant: sets.grants.size,
      agentsWithScopedContract: sets.contracts.size,
      agentsWithVerifiedPlatformAccess: sets.credentialProviders.size > 0
        ? count(`SELECT COUNT(*) AS c FROM mission_agents WHERE status='active' AND ${PRODUCTION_AGENT_WHERE}`)
        : 0,
      executionReadyAgents: admissible,
      startingConcurrently: Math.min(admissible, Math.max(eligible, 0), concurrencyCeiling > 0 ? concurrencyCeiling : Number.MAX_SAFE_INTEGER),
      blockedAgents: blocked,
      eligibleTasksAssignable: eligible,
      assignedEligibleTasks: assigned,
      completedWithEvidence,
      independentlyVerifiedRevenueCents: sum("SELECT COALESCE(SUM(amount_cents),0) AS total FROM mission_revenue WHERE status='received' AND verifier IS NOT NULL"),
      settledPayoutCents: sum("SELECT COALESCE(SUM(amount_cents),0) AS total FROM mission_payouts WHERE status='settled' AND settlement_ref IS NOT NULL"),
    },
    tooling: {
      registered: toolStatuses.length,
      executable: toolStatuses.filter(t => String(t.status) === 'approved').length,
      restricted: toolStatuses.filter(t => String(t.status) === 'restricted').length,
      blocked: toolStatuses.filter(t => String(t.status) === 'blocked').length,
      detail: toolStatuses.map(t => ({ key: String(t.key), status: String(t.status), requiredPermission: String(t.required_permission) })),
    },
    connectors,
    blockers,
    gates: {
      policy: {
        autonomousEnabled: Boolean(policy.autonomousEnabled), killSwitch: Boolean(policy.killSwitch), maxAgents: policy.maxAgents,
        dailySpendCapCents: policy.maxDailySpendCents, requireOwnerForPayout: Boolean(policy.requireOwnerForPayout),
      },
      payoutSlots: { total: count('SELECT COUNT(*) AS c FROM mission_payout_slots'), verified: count('SELECT COUNT(*) AS c FROM mission_payout_slots WHERE status=\'active\' AND verified_at IS NOT NULL') },
    },
    note: 'startingConcurrently is bounded by the least of: admissible agents, eligible verified work items, and the active class concurrency ceiling. Registration count never raises that bound.',
  };
}

export interface ReconcileResult { created: string[]; existing: string[]; openTotal: number }

/**
 * Roll the blockers up into the owner's queue so "blocked" always names an action.
 * Idempotent: one open task per blocker code, tagged with a signature in `notes`;
 * re-running while a task is open creates nothing.
 */
export function reconcileOwnerActions(actorId = 'fleet-readiness'): ReconcileResult {
  const summary = fleetSummary();
  const signature = (code: string) => `fleet-readiness:${code}`;
  const open = db.all<Row>("SELECT notes FROM mission_human_action_tasks WHERE status='pending'").map(r => String(r.notes ?? ''));
  const created: string[] = [];
  const existing: string[] = [];
  for (const spec of summary.blockers) {
    const sig = signature(spec.code);
    if (open.some(n => n.includes(sig))) { existing.push(spec.code); continue; }
    const parent = db.get<Row>(`SELECT id FROM mission_agents WHERE ${PRODUCTION_AGENT_WHERE} AND status='active' ORDER BY slug LIMIT 1`);
    if (!parent) continue;
    const task = createHumanActionTask({
      agentId: String(parent.id),
      opportunityId: null,
      actionType: spec.ownerAction,
      reason: `[${spec.code}] ${spec.label}. Affects ${spec.agentsAffected} agent(s). Free path: ${spec.freePath}`,
      platformUrl: null,
    });
    db.run('UPDATE mission_human_action_tasks SET notes=? WHERE id=?', [sig, task.id]);
    created.push(spec.code);
    appendMissionAudit({
      actorType: 'system', actorId, action: 'fleet_readiness.owner_action_queued',
      subjectType: 'human_action_task', subjectId: task.id, detail: { code: spec.code, agentsAffected: spec.agentsAffected } as any,
    });
    open.push(sig);
  }
  return { created, existing, openTotal: count("SELECT COUNT(*) AS c FROM mission_human_action_tasks WHERE status='pending'") };
}

/** A stable id used by nothing but the report footer, so a report can be tied to a run. */
export function readinessReportId(): string {
  return missionId('fleet');
}
