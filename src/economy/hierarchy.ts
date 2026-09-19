import {
  addAgentSpendCents,
  agentChildrenMap,
  agentSpendSince,
  agentDepths,
  countAgentChildren,
  countAgentProfiles,
  countRecentAuthorizedDelegations,
  countRecentAuthorizedDelegationsByParent,
  getAgentProfileBySlug,
  getEconomyPolicy,
  insertDelegation,
  ledgerDailySpend,
  listAgentProfiles,
  listDelegations,
  listDescendantSlugs,
  recordEconomyEvent,
  setAgentBudgetCents,
  setAgentProfileStatus,
  subtreeSpendCents,
  updateEconomyPolicy,
  type AgentProfileRow,
} from '../db/economy-repositories';
import { currentPolicy, type PolicySnapshot } from './policy';
import { appendAuditLog } from '../db';
import { getAgentBySlug } from '../agents/registry';

/**
 * ZA141251SA — agent hierarchy, delegation and emergency controls.
 *
 * WHAT LIVES HERE
 *   Controlled recursion. An agent may only create a child when EVERY gate
 *   passes, and every attempt — authorized or refused — is written down with
 *   the individual check results, so the question "why does this agent exist?"
 *   always resolves to agent → parent → decision → actor.
 *
 *   The gates, in the order they are evaluated:
 *     1. kill switch            — stops hierarchy work entirely
 *     2. provider access        — a child that cannot reach a provider cannot work
 *     3. spending freeze        — spawning costs budget; a freeze stops it
 *     4. parent exists          — no orphan provenance
 *     5. depth                  — parentDepth + 1 <= policy.maxAgentDepth
 *     6. children per parent    — <= policy.maxChildrenPerAgent
 *     7. total agent cap        — <= policy.maxEconomyAgents (owner-tunable;
 *                                 nothing in the code is pinned to 4,001)
 *     8. spawn rate             — <= policy.spawn_rate_per_hour (global AND
 *                                 per parent), measured over a real 60-minute
 *                                 window of authorized delegations
 *     9. budget                 — parent's remaining budget >= spawn cost, and
 *                                 the economy's daily spend still fits inside
 *                                 policy.max_daily_spend_cents
 *
 *   Nothing here can create money, move money, or bypass a gate: the module
 *   only decides and records, and the caller (treasury.expandCapability)
 *   performs the real creation through the Agent Factory.
 *
 *   Emergency controls are deliberately narrow so an operator can act during
 *   an investigation without dismantling the audit trail:
 *     · pause one agent            · pause/resume a whole subtree
 *     · pause all autonomous work  · freeze spending
 *     · freeze withdrawals         · revoke provider access
 *   Each writes an economy event AND an audit-log row with the actor.
 */

export type DelegationCheckName =
  | 'kill_switch'
  | 'provider_access'
  | 'spending_freeze'
  | 'parent_exists'
  | 'depth_limit'
  | 'children_limit'
  | 'total_agent_cap'
  | 'spawn_rate'
  | 'budget';

export interface DelegationCheck {
  name: DelegationCheckName;
  passed: boolean;
  detail: string;
}

export interface SpawnDecision {
  allowed: boolean;
  /** Canonical, stable phrase for the failing gate ('' when allowed). */
  reason: string;
  /** Machine name of the gate that refused, or null when allowed. */
  failedGate: DelegationCheckName | null;
  /** The numbers behind the decision, for the audit record and the operator UI. */
  reasonDetail: string;
  checks: DelegationCheck[];
  depth: number;
  costCents: number;
  rateUsedInWindow: number;
  budgetRemainingCents: number | null;
}

/**
 * The stable phrase for each gate. Callers (and the refusal records) depend on
 * these strings, so the numbers live in `detail` instead of being interpolated
 * into the reason — a dashboard can show the detail without parsing prose.
 */
const GATE_REASON: Record<DelegationCheckName, string> = {
  kill_switch: 'kill switch engaged',
  provider_access: 'provider access revoked',
  spending_freeze: 'spending frozen',
  parent_exists: 'parent agent not found',
  depth_limit: 'max agent depth reached',
  children_limit: 'parent child limit reached',
  total_agent_cap: 'agent cap reached',
  spawn_rate: 'spawn rate limit reached',
  budget: 'parent budget exhausted',
};

export class HierarchyControlError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HierarchyControlError';
  }
}

const SPAWN_WINDOW_MS = 60 * 60 * 1000;

function dayStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function depthOf(slug: string, depths: Map<string, number>): number {
  return depths.get(slug) ?? 0;
}

/**
 * Evaluate a spawn request against the live policy. Pure decision: it reads
 * state but never creates an agent. `recordSpawnDecision` writes the verdict.
 */
export function evaluateSpawn(input: {
  parentAgentSlug?: string | null;
  actor?: string;
  gap?: string | null;
  /** Optional: a child may be granted its own budget at creation time. */
  childBudgetCents?: number;
  /**
   * Who is asking:
   *   'owner' — a deliberate owner action (the economy API is owner-only). The
   *             parent is not charged and its budget does not constrain the
   *             decision, exactly like a hire approved by the owner.
   *   'agent' — the parent is spawning a child on its own initiative. This is
   *             the case the budget and rate gates exist for.
   */
  initiatedBy?: 'owner' | 'agent';
  policy?: PolicySnapshot;
  now?: Date;
}): SpawnDecision {
  const policy = input.policy ?? currentPolicy();
  const now = input.now ?? new Date();
  const initiatedBy = input.initiatedBy ?? 'owner';
  const parentSlug = input.parentAgentSlug ?? null;
  const checks: DelegationCheck[] = [];
  const add = (name: DelegationCheckName, passed: boolean, detail: string): void => {
    checks.push({ name, passed, detail });
  };

  const depths = agentDepths();
  const depth = parentSlug ? depthOf(parentSlug, depths) + 1 : 0;
  // Only an agent-initiated delegation is a spend by the parent.
  const costCents = initiatedBy === 'agent' && parentSlug ? Math.max(0, policy.spawnCostCents) : 0;
  const sinceIso = new Date(now.getTime() - SPAWN_WINDOW_MS).toISOString();
  const rateUsedInWindow = countRecentAuthorizedDelegations(sinceIso);
  const parentRateUsed = countRecentAuthorizedDelegationsByParent(parentSlug, sinceIso);

  add('kill_switch', !policy.killSwitch, policy.killSwitch ? 'kill switch engaged — hierarchy is frozen' : 'kill switch clear');
  add(
    'provider_access',
    !policy.providerAccessRevoked,
    policy.providerAccessRevoked ? 'provider access revoked — a new agent could not execute' : 'provider access available',
  );
  add('spending_freeze', !policy.freezeSpending, policy.freezeSpending ? 'spending frozen — spawning costs budget' : 'spending permitted');

  // A parent may be an economy agent (it has a profile overlay) or a registry
  // specialist that is being given its first delegation. Both are real
  // provenance; only an unknown slug is refused.
  const parentProfile = parentSlug ? getAgentProfileBySlug(parentSlug) : undefined;
  if (parentSlug) {
    const registryParent = parentProfile ? undefined : getAgentBySlug(parentSlug);
    const exists = Boolean(parentProfile ?? registryParent);
    add(
      'parent_exists',
      exists,
      exists
        ? parentProfile
          ? `parent ${parentSlug} found (economy agent)`
          : `parent ${parentSlug} found (registry specialist, no economy profile yet)`
        : `parent ${parentSlug} is not a registered agent`,
    );
  }

  add(
    'depth_limit',
    depth <= policy.maxAgentDepth,
    // The phrase "depth limit" is part of the operator-facing contract (the
    // event log and the audit tests grep for it), so the detail keeps it.
    `depth limit: depth ${depth} / cap ${policy.maxAgentDepth}${parentSlug ? ` (parent at ${depth - 1})` : ' (root level)'}`,
  );

  const children = parentSlug ? countAgentChildren(parentSlug) : 0;
  add(
    'children_limit',
    children < policy.maxChildrenPerAgent,
    parentSlug ? `parent has ${children} / ${policy.maxChildrenPerAgent} children` : 'root-level spawn (no parent limit applies)',
  );

  const profiles = countAgentProfiles();
  add('total_agent_cap', profiles < policy.maxEconomyAgents, `${profiles} / ${policy.maxEconomyAgents} economy agents in the hierarchy`);

  const globalRateOk = rateUsedInWindow < policy.spawnRatePerHour;
  const parentRateOk = parentSlug === null || parentRateUsed < policy.spawnRatePerHour;
  add(
    'spawn_rate',
    globalRateOk && parentRateOk,
    `last 60 min: ${rateUsedInWindow} global / cap ${policy.spawnRatePerHour}; this parent ${parentSlug ? parentRateUsed : 0} / cap ${policy.spawnRatePerHour}`,
  );

  const dailySpend = ledgerDailySpend(dayStartIso(now));
  const dailyHeadroom = policy.maxDailySpendCents - dailySpend;
  const budgetRemainingCents = parentProfile ? Math.max(0, Number(parentProfile.budget_cents) - Number(parentProfile.spend_cents)) : null;
  // Budgeting applies to DELEGATION: an agent that spawns a child on its own
  // initiative pays for it from its own budget, and the economy's daily spend
  // ceiling still applies. An owner-initiated creation is a hire: the owner
  // already authorized it through the API, so the parent's budget neither
  // blocks it nor is it charged.
  const parentBudgetOk = initiatedBy === 'agent' && parentProfile ? (budgetRemainingCents as number) >= costCents : true;
  const dailyOk = initiatedBy === 'agent' ? costCents <= dailyHeadroom : true;
  add(
    'budget',
    parentBudgetOk && dailyOk,
    initiatedBy === 'agent'
      ? parentProfile
        ? `parent budget remaining ${budgetRemainingCents}c vs cost ${costCents}c; daily spend headroom ${dailyHeadroom}c`
        : `agent-initiated root spawn cost ${costCents}c vs daily spend headroom ${dailyHeadroom}c`
      : 'owner-initiated creation (no parent budget to charge)',
  );

  const failed = checks.find((check) => !check.passed);
  return {
    allowed: !failed,
    reason: failed ? GATE_REASON[failed.name] : '',
    failedGate: failed ? failed.name : null,
    reasonDetail: failed ? failed.detail : `all ${checks.length} gates passed`,
    checks,
    depth,
    costCents,
    rateUsedInWindow,
    budgetRemainingCents,
  };
}

/** Persist one delegation decision. Called for refusals AND authorizations. */
export function recordSpawnDecision(input: {
  decision: SpawnDecision;
  parentAgentSlug?: string | null;
  childAgentSlug?: string | null;
  gap?: string | null;
  actor?: string;
}): void {
  const { decision } = input;
  insertDelegation({
    parentAgentSlug: input.parentAgentSlug ?? null,
    childAgentSlug: input.childAgentSlug ?? null,
    gap: input.gap ?? null,
    decision: decision.allowed ? 'authorized' : 'rejected',
    reason: decision.allowed ? decision.reasonDetail : `${decision.reason} (${decision.reasonDetail})`,
    checks: decision.checks,
    depth: decision.depth,
    spawnCostCents: decision.costCents,
    rateUsedInWindow: decision.rateUsedInWindow,
    actor: input.actor ?? 'system',
  });
}

/**
 * Charge a parent for the child it just created and give the child its budget.
 * The debit is real: it lands on the parent profile AND on the economy ledger
 * category `agent_creation`, so a spawn can never look free.
 */
export function chargeSpawn(input: {
  parentAgentSlug: string | null;
  childAgentSlug: string;
  costCents: number;
  childBudgetCents?: number;
}): void {
  const budget = Math.max(0, Math.round(input.childBudgetCents ?? 0));
  if (input.parentAgentSlug && input.costCents > 0) {
    assertAgentQuota(input.parentAgentSlug, input.costCents);
    addAgentSpendCents(input.parentAgentSlug, input.costCents);
  }
  setAgentBudgetCents(input.childAgentSlug, budget);
}

// ─────────────────────────────────────────────────────────────────────────────
// Structure: tree, descendants, provenance
// ─────────────────────────────────────────────────────────────────────────────

export interface HierarchyNode {
  agentSlug: string;
  parentAgentSlug: string | null;
  depth: number;
  status: string;
  objectives: string | null;
  budgetCents: number;
  spendCents: number;
  childCount: number;
  pausedAt: string | null;
  pausedReason: string | null;
}

export interface HierarchyTree {
  root: string | null;
  nodes: HierarchyNode[];
  total: number;
  maxDepth: number;
  paused: number;
}

/** The whole economy hierarchy (or one subtree), depth-ordered. */
export function hierarchyTree(rootSlug?: string | null): HierarchyTree {
  const profiles = listAgentProfiles();
  const depths = agentDepths();
  const children = agentChildrenMap();
  const byslug = new Map(profiles.map((profile) => [profile.agent_slug, profile]));

  const slugs = rootSlug
    ? [rootSlug, ...listDescendantSlugs(rootSlug)].filter((slug) => byslug.has(slug))
    : profiles.map((profile) => profile.agent_slug);

  const nodes: HierarchyNode[] = slugs
    .map((slug) => {
      const profile = byslug.get(slug) as AgentProfileRow;
      return {
        agentSlug: slug,
        parentAgentSlug: profile.parent_agent_slug ?? null,
        depth: rootSlug ? depthOf(slug, depths) - depthOf(rootSlug, depths) : depthOf(slug, depths),
        status: profile.status,
        objectives: profile.objectives ?? null,
        budgetCents: Number(profile.budget_cents ?? 0),
        spendCents: Number(profile.spend_cents ?? 0),
        childCount: (children.get(slug) ?? []).length,
        pausedAt: profile.paused_at ?? null,
        pausedReason: profile.paused_reason ?? null,
      };
    })
    .sort((a, b) => (a.depth === b.depth ? a.agentSlug.localeCompare(b.agentSlug) : a.depth - b.depth));

  return {
    root: rootSlug ?? null,
    nodes,
    total: nodes.length,
    maxDepth: nodes.reduce((max, node) => Math.max(max, node.depth), 0),
    paused: nodes.filter((node) => node.status === 'paused').length,
  };
}

/** agent → parent → … → root, with one delegation row for the parent link. */
export function delegationChain(agentSlug: string): Array<{ agentSlug: string; parentAgentSlug: string | null; depth: number; authorizedBy: string | null }> {
  const depths = agentDepths();
  const chain: Array<{ agentSlug: string; parentAgentSlug: string | null; depth: number; authorizedBy: string | null }> = [];
  const seen = new Set<string>();
  let current: string | null = agentSlug;
  let depth = depthOf(agentSlug, depths);
  while (current && !seen.has(current)) {
    seen.add(current);
    const profile = getAgentProfileBySlug(current);
    const parent: string | null = profile?.parent_agent_slug ?? null;
    const delegation: ReturnType<typeof listDelegations>[number] | undefined = parent
      ? listDelegations({ childAgentSlug: current, limit: 1 })[0]
      : undefined;
    chain.push({
      agentSlug: current,
      parentAgentSlug: parent,
      depth,
      authorizedBy: delegation ? delegation.actor : profile ? 'seed' : null,
    });
    if (!parent) break;
    current = parent;
    depth -= 1;
  }
  return chain;
}

// ─────────────────────────────────────────────────────────────────────────────
// Emergency controls
// ─────────────────────────────────────────────────────────────────────────────

function auditControl(actor: string, action: string, description: string, metadata?: Record<string, unknown>): void {
  try {
    appendAuditLog({
      actorId: actor,
      action,
      resourceType: 'economy_hierarchy',
      description,
      ...(metadata ? { metadata } : {}),
    });
  } catch {
    // Audit must never make a control fail: the economy event below is the
    // durable record inside this subsystem.
  }
}

export function pauseAgent(input: { agentSlug: string; reason: string; actor: string }): { changed: boolean } {
  const profile = getAgentProfileBySlug(input.agentSlug);
  if (!profile) throw new HierarchyControlError(404, 'not_found', `agent ${input.agentSlug} is not an economy agent`);
  if (profile.status === 'paused') return { changed: false };
  const at = new Date().toISOString();
  setAgentProfileStatus({ agentSlug: input.agentSlug, status: 'paused', pausedAt: at, pausedReason: input.reason.slice(0, 300) });
  recordEconomyEvent({
    kind: 'security',
    actor: input.actor,
    summary: `agent ${input.agentSlug} PAUSED — ${input.reason.slice(0, 200)}`,
    details: { agentSlug: input.agentSlug, pausedAt: at },
  });
  auditControl(input.actor, 'economy.agent.pause', `economy agent ${input.agentSlug} paused`, { reason: input.reason });
  return { changed: true };
}

export function resumeAgent(input: { agentSlug: string; reason: string; actor: string }): { changed: boolean } {
  const profile = getAgentProfileBySlug(input.agentSlug);
  if (!profile) throw new HierarchyControlError(404, 'not_found', `agent ${input.agentSlug} is not an economy agent`);
  if (profile.status !== 'paused') return { changed: false };
  setAgentProfileStatus({ agentSlug: input.agentSlug, status: 'active', pausedAt: null, pausedReason: null });
  recordEconomyEvent({
    kind: 'security',
    actor: input.actor,
    summary: `agent ${input.agentSlug} RESUMED — ${input.reason.slice(0, 200)}`,
    details: { agentSlug: input.agentSlug },
  });
  auditControl(input.actor, 'economy.agent.resume', `economy agent ${input.agentSlug} resumed`, { reason: input.reason });
  return { changed: true };
}

/** Pause one subtree — the root and every descendant (thousands is fine). */
export function pauseHierarchy(input: { rootAgentSlug: string; reason: string; actor: string }): { paused: string[]; alreadyPaused: string[] } {
  const slugs = [input.rootAgentSlug, ...listDescendantSlugs(input.rootAgentSlug)];
  const paused: string[] = [];
  const alreadyPaused: string[] = [];
  const at = new Date().toISOString();
  for (const slug of slugs) {
    const profile = getAgentProfileBySlug(slug);
    if (!profile) continue;
    if (profile.status === 'paused') {
      alreadyPaused.push(slug);
      continue;
    }
    setAgentProfileStatus({ agentSlug: slug, status: 'paused', pausedAt: at, pausedReason: input.reason.slice(0, 300) });
    paused.push(slug);
  }
  if (paused.length > 0) {
    recordEconomyEvent({
      kind: 'security',
      actor: input.actor,
      summary: `hierarchy ${input.rootAgentSlug} PAUSED (${paused.length} agent(s), root included) — ${input.reason.slice(0, 160)}`,
      details: { root: input.rootAgentSlug, paused },
    });
    auditControl(input.actor, 'economy.hierarchy.pause', `economy hierarchy ${input.rootAgentSlug} paused`, {
      reason: input.reason,
      paused,
    });
  }
  return { paused, alreadyPaused };
}

export function resumeHierarchy(input: { rootAgentSlug: string; reason: string; actor: string }): { resumed: string[] } {
  const slugs = [input.rootAgentSlug, ...listDescendantSlugs(input.rootAgentSlug)];
  const resumed: string[] = [];
  for (const slug of slugs) {
    const profile = getAgentProfileBySlug(slug);
    if (!profile || profile.status !== 'paused') continue;
    setAgentProfileStatus({ agentSlug: slug, status: 'active', pausedAt: null, pausedReason: null });
    resumed.push(slug);
  }
  if (resumed.length > 0) {
    recordEconomyEvent({
      kind: 'security',
      actor: input.actor,
      summary: `hierarchy ${input.rootAgentSlug} RESUMED (${resumed.length} agent(s)) — ${input.reason.slice(0, 160)}`,
      details: { root: input.rootAgentSlug, resumed },
    });
    auditControl(input.actor, 'economy.hierarchy.resume', `economy hierarchy ${input.rootAgentSlug} resumed`, {
      reason: input.reason,
      resumed,
    });
  }
  return { resumed };
}

/** Stop ALL autonomous economy work (every economy agent), leaving the kill switch alone. */
export function pauseAllAgents(input: { reason: string; actor: string }): { paused: number } {
  const at = new Date().toISOString();
  let paused = 0;
  for (const profile of listAgentProfiles()) {
    if (profile.status === 'paused') continue;
    setAgentProfileStatus({ agentSlug: profile.agent_slug, status: 'paused', pausedAt: at, pausedReason: input.reason.slice(0, 300) });
    paused += 1;
  }
  updateEconomyPolicy({ autonomous_enabled: 0 });
  recordEconomyEvent({
    kind: 'security',
    actor: input.actor,
    summary: `ALL autonomous work PAUSED (${paused} agent(s), autonomous operation switched off) — ${input.reason.slice(0, 160)}`,
    details: { paused },
  });
  auditControl(input.actor, 'economy.pause_all', 'all economy agents paused and autonomy disabled', { reason: input.reason, paused });
  return { paused };
}

export function resumeAllAgents(input: { reason: string; actor: string }): { resumed: number } {
  let resumed = 0;
  for (const profile of listAgentProfiles()) {
    if (profile.status !== 'paused') continue;
    setAgentProfileStatus({ agentSlug: profile.agent_slug, status: 'active', pausedAt: null, pausedReason: null });
    resumed += 1;
  }
  recordEconomyEvent({
    kind: 'security',
    actor: input.actor,
    summary: `autonomous work RESUMED for ${resumed} agent(s) — autonomy itself stays OFF until the owner enables it`,
    details: { resumed },
  });
  auditControl(input.actor, 'economy.resume_all', 'economy agents resumed', { reason: input.reason, resumed });
  return { resumed };
}

export type ControlKind = 'spending' | 'withdrawals' | 'provider_access';

const CONTROL_FIELDS: Record<ControlKind, 'freeze_spending' | 'freeze_withdrawals' | 'provider_access_revoked'> = {
  spending: 'freeze_spending',
  withdrawals: 'freeze_withdrawals',
  provider_access: 'provider_access_revoked',
};

/**
 * Narrow brakes. `frozen: true` engages, `false` releases — both audited.
 * These never touch the kill switch, so an operator keeps the ability to
 * freeze one thing while watching everything else.
 */
export function setControl(input: { kind: ControlKind; frozen: boolean; reason: string; actor: string }): { kind: ControlKind; frozen: boolean } {
  const field = CONTROL_FIELDS[input.kind];
  updateEconomyPolicy({ [field]: input.frozen ? 1 : 0 });
  const verb = input.frozen ? 'ENGAGED' : 'RELEASED';
  recordEconomyEvent({
    kind: 'security',
    actor: input.actor,
    summary: `${input.kind} control ${verb} — ${input.reason.slice(0, 200)}`,
    details: { kind: input.kind, frozen: input.frozen },
  });
  auditControl(input.actor, `economy.control.${input.kind}`, `economy ${input.kind} control ${verb.toLowerCase()}`, {
    reason: input.reason,
    frozen: input.frozen,
  });
  return { kind: input.kind, frozen: input.frozen };
}

/** Live control state + what each one currently blocks (for the dashboard). */
export function hierarchyControls(): {
  killSwitch: boolean;
  autonomousEnabled: boolean;
  freezeSpending: boolean;
  freezeWithdrawals: boolean;
  providerAccessRevoked: boolean;
  pausedAgents: number;
  totalAgents: number;
  spawnRatePerHour: number;
  spawnsLastHour: number;
  spawnCostCents: number;
  maxAgentDepth: number;
  maxChildrenPerAgent: number;
  maxEconomyAgents: number;
} {
  const row = getEconomyPolicy();
  const sinceIso = new Date(Date.now() - SPAWN_WINDOW_MS).toISOString();
  const profiles = listAgentProfiles();
  return {
    killSwitch: row.kill_switch === 1,
    autonomousEnabled: row.autonomous_enabled === 1,
    freezeSpending: row.freeze_spending === 1,
    freezeWithdrawals: row.freeze_withdrawals === 1,
    providerAccessRevoked: row.provider_access_revoked === 1,
    pausedAgents: profiles.filter((profile) => profile.status === 'paused').length,
    totalAgents: profiles.length,
    spawnRatePerHour: row.spawn_rate_per_hour,
    spawnsLastHour: countRecentAuthorizedDelegations(sinceIso),
    spawnCostCents: row.spawn_cost_cents,
    maxAgentDepth: row.max_agent_depth,
    maxChildrenPerAgent: row.max_children_per_agent,
    maxEconomyAgents: row.max_economy_agents,
  };
}

/**
 * Guards used by the money and execution paths. They throw instead of
 * returning a boolean so a caller can never forget to check.
 */
export function assertWithdrawalsAllowed(): void {
  const policy = currentPolicy();
  if (policy.freezeWithdrawals) {
    throw new HierarchyControlError(423, 'withdrawals_frozen', 'withdrawals are frozen by the owner — no transfer or settlement can complete');
  }
}

export function assertSpendingAllowed(operation: string): void {
  const policy = currentPolicy();
  if (policy.freezeSpending) {
    throw new HierarchyControlError(423, 'spending_frozen', `spending is frozen by the owner — ${operation} is refused`);
  }
}

export function assertProviderAccessAllowed(operation: string): void {
  const policy = currentPolicy();
  if (policy.providerAccessRevoked) {
    throw new HierarchyControlError(423, 'provider_access_revoked', `provider access is revoked — ${operation} cannot reach a provider`);
  }
}

/** Agent-level guard: a paused agent (or a paused ancestor) must not be dispatched. */
export function assertAgentRunnable(agentSlug: string): void {
  const profile = getAgentProfileBySlug(agentSlug);
  if (profile && profile.status === 'paused') {
    throw new HierarchyControlError(409, 'agent_paused', `agent ${agentSlug} is paused${profile.paused_reason ? `: ${profile.paused_reason}` : ''}`);
  }
  for (const ancestor of listAncestors(agentSlug)) {
    const row = getAgentProfileBySlug(ancestor);
    if (row && row.status === 'paused') {
      throw new HierarchyControlError(409, 'ancestor_paused', `agent ${agentSlug} is inside the paused hierarchy of ${ancestor}`);
    }
  }
}

/** Parent chain (excluding the agent itself), nearest parent first. */
export function listAncestors(agentSlug: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([agentSlug]);
  let current: string | null = getAgentProfileBySlug(agentSlug)?.parent_agent_slug ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    out.push(current);
    current = getAgentProfileBySlug(current)?.parent_agent_slug ?? null;
  }
  return out;
}

export function subtreeSpend(rootAgentSlug: string): number {
  return subtreeSpendCents(rootAgentSlug);
}

export { listDelegations };

// ── Per-agent spend quotas (0022) ────────────────────────────────────────────
// A quota caps what ONE agent (plus its own ledger-attributed spend) may burn
// per UTC day / calendar month. NULL quota = uncapped. Every enforcement
// states the window, the spent figure and the cap — never a bare "denied".

export interface AgentQuotaStatus {
  agentSlug: string;
  dailyQuotaCents: number | null;
  dailySpentCents: number;
  monthlyQuotaCents: number | null;
  monthlySpentCents: number;
}

export function agentQuotaStatus(agentSlug: string): AgentQuotaStatus {
  const profile = getAgentProfileBySlug(agentSlug);
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {
    agentSlug,
    dailyQuotaCents: profile?.daily_spend_quota_cents ?? null,
    dailySpentCents: agentSpendSince(agentSlug, dayStart.toISOString()),
    monthlyQuotaCents: profile?.monthly_spend_quota_cents ?? null,
    monthlySpentCents: agentSpendSince(agentSlug, monthStart.toISOString()),
  };
}

export function assertAgentQuota(agentSlug: string, additionalCents: number): AgentQuotaStatus {
  const status = agentQuotaStatus(agentSlug);
  if (status.dailyQuotaCents !== null && status.dailySpentCents + additionalCents > status.dailyQuotaCents) {
    throw new HierarchyControlError(
      409, 'daily_quota_exceeded',
      'agent "' + agentSlug + '" daily quota: spent ' + status.dailySpentCents + 'c of ' + status.dailyQuotaCents + 'c — +' + additionalCents + 'c refused',
    );
  }
  if (status.monthlyQuotaCents !== null && status.monthlySpentCents + additionalCents > status.monthlyQuotaCents) {
    throw new HierarchyControlError(
      409, 'monthly_quota_exceeded',
      'agent "' + agentSlug + '" monthly quota: spent ' + status.monthlySpentCents + 'c of ' + status.monthlyQuotaCents + 'c — +' + additionalCents + 'c refused',
    );
  }
  return status;
}
