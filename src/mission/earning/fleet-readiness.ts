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
import { executionBackendConfigured } from './agent-class-contracts';
import { chatDispatchReadiness } from '../chat-provider';
import { githubCredentialStatus } from '../github-credential';
import { classifyMissionDataSource, productionClaimRefusal } from '../data-source';

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
    bountyLeadsAccepted: number;
    bountyAssignments: number;
    assignedEligibleTasks: number;
    completedWithEvidence: number;
    independentlyVerifiedRevenueCents: number;
    settledPayoutCents: number;
  };
  tooling: { registered: number; executable: number; restricted: number; blocked: number; detail: Array<{ key: string; status: string; requiredPermission: string }> };
  connectors: { total: number; ready: number; notConfigured: number; blocked: number; restricted: number; degraded: number };
  blockers: BlockerSpec[];
  /**
   * Where this verdict was read from, and what it is therefore allowed to claim. A readiness report
   * quoted without this is how a scratch database in /tmp ends up being described as the state of a
   * deployment. `claimRefusal` is non-null whenever the source cannot carry a production claim.
   */
  dataSource: { kind: string; label: string; source: string; engine: string; claimsAllowed: boolean; reasons: readonly string[] };
  claimStatus: string;
  claimRefusal: string | null;
  /**
   * The production-shaped fields of this verdict, each carrying its own source mark. The numbers are
   * not hidden when the source is a fixture — hiding them would look like a bug — they are labelled,
   * so a count can never be lifted out of this report as a fact about the deployment.
   */
  productionClaims: Record<string, { claim: string; value: unknown; status: string }>;
  /** The exact owner actions that clear the open blockers, and nothing else. */
  activation: OwnerActivationPath;
  /** The execution gates at configuration level, beside the agent counts, so "0 ready
   * agents" is never mistaken for "0 agents exist": a fully provisioned fleet with nowhere
   * to run and no model permit is still a fleet that cannot earn. */
  execution: {
    backendConfigured: boolean;
    sandboxImagePinned: boolean;
    sandboxMode: string;
    modelDispatchable: boolean;
    modelMode: string;
    modelBlockers: string[];
    githubCredentialPresent: boolean;
    githubCredentialSource: string | null;
  };
  contracts: { scopedActive: number; preparedProposals: number };
  gates: { policy: { autonomousEnabled: boolean; killSwitch: boolean; maxAgents: number; dailySpendCapCents: number; requireOwnerForPayout: boolean }; payoutSlots: { total: number; verified: number } };
  note: string;
}

/** Agents created by test fixtures are never counted as production readiness. The
 * mission's own provisioning writes origin_platform='mission'/'akbaral-registry'. */
// Parenthesized on purpose: AND binds tighter than OR, so an unparenthesized
// `... AND a IS NULL OR a NOT IN (...)` silently matches every row instead of none.
const PRODUCTION_AGENT_WHERE = `(origin_platform IS NULL OR origin_platform NOT IN ('fixture','test','test_fixture'))`;

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

/** How an owner clears something: the three things that actually exist. */
export type ActivationMechanism = 'env var' | 'dashboard control' | 'CLI command';

export interface OwnerActivationAction {
  code: BlockerCode;
  /** What the gate is, in the owner's words. */
  label: string;
  /** Measured right now, so the list doubles as a checklist of what is already done. */
  cleared: boolean;
  how: ActivationMechanism;
  /** The exact variable name, control, or command. Never a description of one. */
  target: string;
  /** The imperative sentence the owner acts on. */
  action: string;
  /** How to see that it cleared, from the same place. */
  verify: string;
  /** Where the target is defined, so "the control exists" is checkable rather than promised. */
  evidence: string;
  ownerAction: HumanActionType;
}

export interface OwnerActivationPath {
  generatedAt: string;
  dataSource: { kind: string; label: string; source: string };
  claimStatus: string;
  claimsAllowed: boolean;
  claimRefusal: string | null;
  /** The gates still closed, in the order they unblock each other. */
  remaining: OwnerActivationAction[];
  /** Every gate, cleared or not — the checklist view. */
  all: OwnerActivationAction[];
  allClear: boolean;
  note: string;
}

/**
 * The owner activation path: for every gate that stops the fleet, the one thing that clears it.
 *
 * Each entry names a real, currently-existing target — a variable documented in `.env.example`, a
 * control present in the dashboard markup, or a script in `package.json` — and carries its
 * `file:line` so the claim can be checked without trusting this file. Nothing here suggests a
 * workaround: an owner action stays an owner action, and the marks say which source the
 * cleared/not-cleared judgement came from.
 */
export function ownerActivationPath(): OwnerActivationPath {
  ensureGatesSeeded();
  const dataSource = classifyMissionDataSource();
  const mark = dataSource.label;
  const policy = currentPolicy();
  const credential = githubCredentialStatus(process.env, { scope: 'write' });
  const slotsVerified = count("SELECT COUNT(*) AS c FROM mission_payout_slots WHERE status='active' AND verified_at IS NOT NULL");
  const slotsTotal = count('SELECT COUNT(*) AS c FROM mission_payout_slots');
  const credentialsActive = count("SELECT COUNT(*) AS c FROM mission_credentials WHERE status='active' AND (expires_at IS NULL OR expires_at>?)", [nowIso()]);
  const connectorsReady = listProviderReadiness().filter(p => p.status === 'ready' && p.apiPermitted).length;
  const grants = count("SELECT COUNT(DISTINCT agent_id) AS c FROM mission_money_grants WHERE status='active' AND (expires_at IS NULL OR expires_at>?)", [nowIso()]);
  const contracts = count("SELECT COUNT(*) AS c FROM mission_agent_contracts WHERE status='active' AND (expires_at IS NULL OR expires_at>?)", [nowIso()]);
  const pendingActions = count("SELECT COUNT(*) AS c FROM mission_human_action_tasks WHERE status='pending' AND (notes IS NULL OR notes NOT LIKE 'fleet-readiness:%')");

  const entries: OwnerActivationAction[] = [
    {
      code: 'no_platform_credential', label: 'No GitHub/platform credential for the mission',
      cleared: credentialsActive > 0 || credential.present,
      how: 'env var', target: 'ZA141251SA_GITHUB_TOKEN',
      action: credentialsActive > 0
        ? `already satisfied: ${credentialsActive} active credential row(s) in the mission vault${credential.present ? `, and the process also reads ${credential.source} under the write scope` : ''}`
        : credential.present
          ? `already satisfied: the mission process reads ${credential.source}; register it as an active vault row to clear the DB gate`
          : 'set the variable in the host secret manager (Railway service variable), restart the mission process, then store it as an active mission credential — never paste it into chat or a tracked file',
      verify: 'npm run fleet:readiness — the github credential line reads "present via ZA141251SA_GITHUB_TOKEN"; --backends repeats it',
      evidence: '.env.example:268 (documented name, precedence and scopes); src/mission/github-credential.ts:37 and :52 (the accepted names and the read/write scope policy); src/mission/server.ts:1875 (the owner-only vault route)',
      ownerAction: HUMAN_ACTION_TYPES.ACCOUNT_CREATION,
    },
    {
      code: 'no_payout_slot_verified', label: 'No verified payout destination',
      cleared: slotsVerified > 0,
      how: 'dashboard control', target: '#slot-form + #slot-verification (Money → Payout slots)',
      action: slotsVerified > 0
        ? `already satisfied: ${slotsVerified} of ${slotsTotal} slot(s) active and verified`
        : `configure a slot in #slot-form, then confirm every control check in #slot-verification — ${slotsVerified} of ${slotsTotal} verified now; nothing can be paid out until one is`,
      verify: `npm run fleet:readiness — the payout slots line reads "N verified of M" with N >= 1 (a fresh database has M=0 until the slots are configured)`,
      evidence: 'mission-dashboard/index.html:334 (#slot-form), mission-dashboard/index.html:332 (#slot-verification), src/mission/server.ts:2277 (payout-slots routes)',
      ownerAction: HUMAN_ACTION_TYPES.PAYMENT_SETUP,
    },
    {
      code: 'autonomy_disabled', label: 'Autonomous execution is off (owner switch)',
      cleared: Boolean(policy.autonomousEnabled) && !policy.killSwitch,
      how: 'dashboard control', target: '#policy-autonomous (Approvals → Policy → Autonomous execution)',
      action: policy.autonomousEnabled
        ? (policy.killSwitch ? 'the switch is on but the kill switch is engaged; release it below' : 'already satisfied: the owner switch is on')
        : 'tick "Allow the fleet to act without a per-action owner approval" and Save. This is a decision, not a fix: leaving it off is the safe state while payout slots or credentials are still missing',
      verify: 'npm run fleet:readiness — the autonomous execution line reads "enabled"',
      evidence: 'mission-dashboard/index.html:211 (#policy-autonomous), src/mission/server.ts:1673 (PATCH /api/policy accepts autonomousEnabled), src/mission/policy.ts:204 and :237 (the flag is written and audited)',
      ownerAction: HUMAN_ACTION_TYPES.MANUAL_APPROVAL,
    },
    {
      code: 'kill_switch_engaged', label: 'Mission kill switch is engaged',
      cleared: !policy.killSwitch,
      how: 'dashboard control', target: '#kill-off (Approvals → Policy → Kill switch)',
      action: policy.killSwitch ? 'press "Release kill switch" to resume mission activity' : 'already satisfied: the kill switch is released',
      verify: 'npm run fleet:readiness — the kill switch line reads "off"',
      evidence: 'mission-dashboard/index.html:222-223 (#kill-on / #kill-off), src/mission/server.ts:1665 (owner-only kill-switch POST)',
      ownerAction: HUMAN_ACTION_TYPES.MANUAL_APPROVAL,
    },
    {
      code: 'no_provider_ready', label: 'No earning connector is provider-ready',
      cleared: connectorsReady > 0,
      how: 'env var', target: 'the per-connector variable named by CREDENTIAL_ENV (e.g. ZA141251SA_GITHUB_TOKEN for GitHub)',
      action: connectorsReady > 0
        ? `already satisfied: ${connectorsReady} connector(s) ready and API-permitted`
        : 'a connector turns ready the moment its own variable and owner account exist; nothing has to be bought — the read-only research paths are free-tier',
      verify: 'npm run fleet:readiness — the connector line counts "N ready"',
      evidence: 'src/mission/earning/provider-capability-registry.ts:15 (CREDENTIAL_ENV) and :59 (a GitHub name resolves through the single credential source)',
      ownerAction: HUMAN_ACTION_TYPES.TOS_ACCEPTANCE,
    },
    {
      code: 'no_scoped_contract', label: 'No approved scoped agent contract',
      cleared: contracts > 0,
      // It used to say `how: 'CLI command'` because that was true. It is now the wrong kind of true: the
      // owner reads this list in the browser and has no shell on the host, so a remedy that only exists in
      // a terminal is, to this reader, no remedy at all — the gate stayed open and the fleet stayed still.
      how: 'dashboard control',
      target: '#contracts-block (Approvals → Scoped agent contracts): "Prepare contracts", then "Approve"',
      action: contracts > 0
        ? `already satisfied: ${contracts} active scoped contract(s)`
        : 'prepare least-privilege proposals for a class the registry maps agents to, then approve one (or approve all of a class after repeating back the permission surface). Preparing grants nothing; a proposal that is empty or wider than its class is refused with the reason. From a shell the same two steps are `npm run fleet:readiness -- --contracts <class>` then `--contracts-approve=<id>`',
      verify: 'npm run fleet:readiness — the scoped contracts line counts "N active"; the console block reports the same gate beside its own counts',
      evidence: 'mission-dashboard/index.html:198 (#contracts-block), src/mission/server.ts:1676 (the owner-only route), src/mission/earning/agent-class-contracts.ts:254 (prepare), :314 (approve), :467 (the empty/over-broad refusal), package.json:83 (fleet:readiness)',
      ownerAction: HUMAN_ACTION_TYPES.MANUAL_APPROVAL,
    },
    {
      code: 'no_active_money_grant', label: 'No active zero-spend money grant',
      cleared: grants > 0,
      how: 'CLI command', target: 'npm run mission:sync-registry',
      action: grants > 0
        ? `already satisfied: ${grants} agent(s) hold an active grant`
        : 'registry sync grants zero-spend authority; a grant with spend_limit_cents>0 is only needed for paid work and stays an owner decision',
      verify: 'npm run fleet:readiness — execution-ready counts agents with an active grant',
      evidence: 'package.json:82 (mission:sync-registry), src/mission/money.ts (setMoneyGrant)',
      ownerAction: HUMAN_ACTION_TYPES.MANUAL_APPROVAL,
    },
    {
      code: 'owner_action_pending', label: 'A human-action task is open for at least one agent',
      cleared: pendingActions === 0,
      how: 'dashboard control', target: '#approvals / #head-approvals (Approvals)',
      action: pendingActions === 0
        ? 'already satisfied: no agent-specific owner task is open'
        : `clear the ${pendingActions} open task(s) in the Approvals queue — each one states what it is waiting for`,
      verify: 'npm run fleet:readiness — no owner_action_pending blocker is listed',
      evidence: 'mission-dashboard/index.html:189 (#approvals), mission-dashboard/index.html:183 (#head-approvals)',
      ownerAction: HUMAN_ACTION_TYPES.MANUAL_APPROVAL,
    },
  ];

  const remaining = entries.filter(entry => !entry.cleared);
  return {
    generatedAt: nowIso(),
    dataSource: { kind: dataSource.kind, label: mark, source: dataSource.source },
    claimStatus: mark,
    claimsAllowed: dataSource.productionClaimsAllowed,
    claimRefusal: productionClaimRefusal(dataSource, 'the cleared/not-cleared judgement in the owner activation path'),
    remaining,
    all: entries,
    allClear: remaining.length === 0,
    note: dataSource.productionClaimsAllowed
      ? `${remaining.length} owner action(s) outstanding, read from ${dataSource.source}. Each entry names the control that clears it; none of them is a workaround.`
      : `${mark}: this list was computed from ${dataSource.source}, so it is correct for that database only and must not be quoted as the deployment's state.`,
  };
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

/**
 * The production-shaped fields, each stamped with the source that justifies (or refuses) the claim.
 * `value` stays visible on purpose: an unlabelled number invites quoting, a labelled one does not.
 */
function productionClaimsFor(
  dataSource: ReturnType<typeof classifyMissionDataSource>,
  mark: string,
  counts: { registered: number; executionReady: number; blocked: number },
) {
  const status = dataSource.productionClaimsAllowed ? 'PRODUCTION' : mark;
  const stamped = (claim: string, value: unknown) => ({ claim, value, status });
  const payoutSlots = {
    total: count('SELECT COUNT(*) AS c FROM mission_payout_slots'),
    verified: count("SELECT COUNT(*) AS c FROM mission_payout_slots WHERE status='active' AND verified_at IS NOT NULL"),
  };
  const credential = githubCredentialStatus(process.env, { scope: 'write' });
  return {
    payoutSlots: stamped(`verified ${payoutSlots.verified} of ${payoutSlots.total}`, payoutSlots),
    platformCredential: stamped(`${credential.present ? `present via ${credential.source}` : 'absent'} (${credential.scope} scope; name only)`, { present: credential.present, source: credential.source, scope: credential.scope }),
    ownerAutonomy: stamped(`autonomous_enabled=${Boolean(currentPolicy().autonomousEnabled)} kill_switch=${Boolean(currentPolicy().killSwitch)}`, { autonomousEnabled: Boolean(currentPolicy().autonomousEnabled), killSwitch: Boolean(currentPolicy().killSwitch) }),
    agentCounts: stamped(
      `${counts.registered} registered · ${counts.executionReady} execution-ready · ${counts.blocked} blocked`,
      counts,
    ),
  };
}

/** The fleet verdict. Single pass over the registry rows — no per-agent queries. */
export function fleetSummary(): FleetSummary {
  ensureGatesSeeded();
  const dataSource = classifyMissionDataSource();
  const claimMark = dataSource.label;
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

  // Two work paths feed the fleet: the engine's opportunity queue and the
  // GitHub-issue-bounty workflow (its own candidates/assignments tables). Counting only
  // the first would report "0 eligible tasks" while real, policy-checked bounty
  // assignments were sitting in the second.
  const bountyEligible = count("SELECT COUNT(*) AS c FROM mission_bounty_opportunities WHERE risk_state='accepted'");
  const bountyAssigned = count("SELECT COUNT(*) AS c FROM mission_bounty_assignments WHERE state IN ('eligible','assigned','executing')");
  const eligible = count(
    "SELECT COUNT(*) AS c FROM mission_earning_engine_opportunities WHERE verification_state IN ('discovered','qualified','legitimacy_verified')",
  ) + bountyEligible;
  const assigned = count("SELECT COUNT(*) AS c FROM mission_earning_engine_opportunities WHERE verification_state IN ('assigned','executing')") + bountyAssigned;
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
        no_scoped_contract: { label: 'No approved scoped agent contract', ownerAction: HUMAN_ACTION_TYPES.MANUAL_APPROVAL, freePath: 'Prepare least-privilege contracts per class in the console — Approvals → Scoped agent contracts → "Prepare contracts" — and approve them there. `npm run fleet:readiness -- --contracts <class>` with `--contracts-approve=<id>` is the same module for an operator with a shell. Granting stays an owner action: nothing self-approves, and classes no agent may hold (submission, payout release) are never offered.' },
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
      bountyLeadsAccepted: bountyEligible,
      bountyAssignments: bountyAssigned,
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
    execution: {
      backendConfigured: executionBackendConfigured(),
      sandboxImagePinned: /^sha256:[a-f0-9]{64}$/.test(String(process.env.ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST ?? '').trim()),
      sandboxMode: (process.env.ZA141251SA_BOUNTY_SANDBOX_MODE ?? 'auto').trim().toLowerCase() || 'auto',
      ...(() => {
        const readiness = chatDispatchReadiness();
        return { modelDispatchable: readiness.dispatchable, modelMode: readiness.mode, modelBlockers: readiness.blockers };
      })(),
      // Presence and the winning NAME only, resolved through the single credential source under the
      // write scope, so this verdict can never disagree with the client that would use the token.
      githubCredentialPresent: githubCredentialStatus(process.env, { scope: 'write' }).present,
      githubCredentialSource: githubCredentialStatus(process.env, { scope: 'write' }).source,
    },
    contracts: {
      scopedActive: count("SELECT COUNT(*) AS c FROM mission_agent_contracts WHERE status='active' AND (expires_at IS NULL OR expires_at>?)", [nowIso()]),
      preparedProposals: count("SELECT COUNT(*) AS c FROM mission_agent_contract_proposals WHERE status='pending'"),
    },
    blockers,
    dataSource: {
      kind: dataSource.kind,
      label: claimMark,
      source: dataSource.source,
      engine: dataSource.engine,
      claimsAllowed: dataSource.productionClaimsAllowed,
      reasons: dataSource.reasons,
    },
    claimStatus: claimMark,
    claimRefusal: productionClaimRefusal(dataSource, 'this readiness verdict'),
    productionClaims: productionClaimsFor(dataSource, claimMark, {
      registered: agents.length, executionReady: admissible, blocked,
    }),
    activation: ownerActivationPath(),
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
