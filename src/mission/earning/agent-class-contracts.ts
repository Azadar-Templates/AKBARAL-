/**
 * Least-privilege scoped contracts, prepared per agent class.
 *
 * WHY. The fleet report said 0 of 4,001 agents had a scoped contract, and the honest reading
 * is that permissions had been described but never actually issued — while the naive "fix"
 * (insert an active contract for every agent) would be worse than the gap: it would hand
 * every registered agent the same standing regardless of whether it has credentials, tooling,
 * a sandbox, or any eligible work. A contract is a permission grant, so it must be scoped to
 * a class that can do the job and approved by the owner.
 *
 * HOW THIS WORKS.
 *   · Each class declares an explicit permission allowlist, explicit denials, resource limits
 *     and a validity window. Classes that only a human may hold (`owner_submission`,
 *     `payout_release`) are declared so that their refusal is code, not policy prose.
 *   · Preparation checks eligibility against live rows — agent active, money grant present,
 *     execution backend actually configured — and writes a PROPOSAL, never a grant. Proposals
 *     live in `mission_agent_contract_proposals`, because a non-active row in
 *     `mission_agent_contracts` would make `grant()` deny the agent (see money.ts).
 *   · Activation is owner-only, re-checks eligibility, and re-verifies that the frozen
 *     permissions and limits still match the class definition, so nothing can be widened
 *     between proposal and approval.
 *
 * Nothing here grants anything to all agents, and nothing here touches money.
 */

import { existsSync, readdirSync } from 'node:fs';
import { missionDb as db, missionId, nowIso, sha256, appendMissionAudit, type Row, type SqlValue } from '../database';
import { assertMoneyOwner, MoneyError, type MoneyActor } from '../money';
import { currentPolicy } from '../policy';
import { createHumanActionTask, HUMAN_ACTION_TYPES } from '../human-action-gate';
import { defaultSandboxCacheRoot } from './namespace-bounty-sandbox';

/** Permission keys the mission already recognises. Inventing a key here would be a grant
 * nothing enforces, so the vocabulary is closed and each class picks a subset of it. */
export const GRANTABLE_PERMISSIONS = ['tool.request', 'resource.request', 'expense.request', 'report.submit'] as const;
export type GrantablePermission = (typeof GRANTABLE_PERMISSIONS)[number];

/** Held by the class definitions as explicit refusals, so "never" is testable. */
export const NEVER_GRANTED_PERMISSIONS = ['agent.create', 'credential.write', 'payout.send', 'wallet.transfer', 'treasury.freeze'] as const;

export interface AgentClassDefinition {
  agentClass: string;
  label: string;
  permissions: readonly GrantablePermission[];
  /** Explicitly withheld, and asserted by tests — this is the least-privilege statement. */
  denied: readonly string[];
  resourceLimits: { maxChildren: 0; maxDepth: 1; maxSpendCents: number; maxConcurrentRuns: number };
  /** Requires a configured execution backend, i.e. a sandbox that can run repository code. */
  requiresSandbox: boolean;
  /** Requires an active money grant, because the class may spend (bounded) resources. */
  requiresMoneyGrant: boolean;
  /** Only a human owner may hold this class; agent eligibility is refused by construction. */
  ownerOnly: boolean;
  validityDays: number;
  purpose: string;
}

const MAX_SPEND_CENTS = 5_000;

export const AGENT_CLASS_CONTRACTS: readonly AgentClassDefinition[] = [
  {
    agentClass: 'bounty_research',
    label: 'Bounty discovery, repository policy reads and live claim rechecks',
    permissions: ['report.submit'],
    denied: ['agent.create', 'credential.write', 'payout.send', 'wallet.transfer', 'treasury.freeze', 'expense.request', 'resource.request', 'tool.request'],
    resourceLimits: { maxChildren: 0, maxDepth: 1, maxSpendCents: 0, maxConcurrentRuns: 1 },
    requiresSandbox: false,
    // Research spends the shared GitHub request budget and nothing else; no money grant, so a
    // researcher cannot become a spender by accident.
    requiresMoneyGrant: false,
    ownerOnly: false,
    validityDays: 30,
    purpose: 'Read-only GitHub discovery, policy classification and claim verification. Produces recorded findings; never writes to a repository and never spends.',
  },
  {
    agentClass: 'bounty_execution',
    label: 'Sandboxed repository execution and test running for one assigned bounty',
    permissions: ['tool.request', 'report.submit'],
    denied: ['agent.create', 'credential.write', 'payout.send', 'wallet.transfer', 'treasury.freeze', 'expense.request'],
    resourceLimits: { maxChildren: 0, maxDepth: 1, maxSpendCents: MAX_SPEND_CENTS, maxConcurrentRuns: 1 },
    requiresSandbox: true,
    requiresMoneyGrant: true,
    ownerOnly: false,
    validityDays: 14,
    purpose: 'Runs the pinned sandbox on exactly one assigned opportunity, with bounded model spend. Cannot submit, cannot create agents, cannot touch credentials.',
  },
  {
    agentClass: 'evidence_verification',
    label: 'Independent verification of preserved execution evidence',
    permissions: ['report.submit'],
    denied: ['agent.create', 'credential.write', 'payout.send', 'wallet.transfer', 'treasury.freeze', 'expense.request', 'resource.request', 'tool.request'],
    resourceLimits: { maxChildren: 0, maxDepth: 1, maxSpendCents: 0, maxConcurrentRuns: 1 },
    requiresSandbox: false,
    requiresMoneyGrant: false,
    ownerOnly: false,
    validityDays: 30,
    purpose: 'Reads evidence records and writes verification rows only. A verifier that could also produce work would not be an independent verifier.',
  },
  {
    agentClass: 'owner_submission',
    label: 'Fork, push and open a pull request with the owner credential',
    permissions: [],
    denied: [...NEVER_GRANTED_PERMISSIONS],
    resourceLimits: { maxChildren: 0, maxDepth: 1, maxSpendCents: 0, maxConcurrentRuns: 1 },
    requiresSandbox: false,
    requiresMoneyGrant: false,
    ownerOnly: true,
    validityDays: 1,
    purpose: 'DECLARED SO THAT REFUSAL IS CODE: submission authority stays with the owner. Any attempt to prepare or activate this class for an agent is refused.',
  },
  {
    agentClass: 'payout_release',
    label: 'Release treasury payouts',
    permissions: [],
    denied: [...NEVER_GRANTED_PERMISSIONS],
    resourceLimits: { maxChildren: 0, maxDepth: 1, maxSpendCents: 0, maxConcurrentRuns: 1 },
    requiresSandbox: false,
    requiresMoneyGrant: false,
    ownerOnly: true,
    validityDays: 1,
    purpose: 'DECLARED SO THAT REFUSAL IS CODE: payout release is owner-only while `requireOwnerForPayout` is set, and no agent class may hold it.',
  },
] as const;

/** Refusals carry their code as the message prefix, exactly like every other money-gate
 * refusal in the mission, so a caller can match on the reason without parsing prose. */
function refuse(code: string, detail?: string): never { throw new MoneyError(code, detail ? `${code}: ${detail}` : code); }

export function classContractDefinition(agentClass: string): AgentClassDefinition | null {
  const wanted = String(agentClass ?? '').trim().toLowerCase();
  return AGENT_CLASS_CONTRACTS.find(definition => definition.agentClass === wanted) ?? null;
}

/** Bounded per call, never globally: a batch limit is a throughput knob, not a ceiling on
 * how many agents may eventually hold a contract. */
export const MAX_PROPOSALS_PER_BATCH = 200;
const DEFAULT_PROPOSAL_BATCH = 25;
const PROPOSAL_TTL_DAYS = 14;

function digest(definition: AgentClassDefinition): string {
  return sha256(JSON.stringify({ permissions: [...definition.permissions].sort(), limits: definition.resourceLimits, denied: [...definition.denied].sort() })).slice(0, 8);
}

/** Sync, config-level: is there any execution backend this host could actually use? */
export function executionBackendConfigured(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const mode = (env.ZA141251SA_BOUNTY_SANDBOX_MODE ?? 'auto').trim().toLowerCase();
  if (mode === 'off') return false;
  const digest = (env.ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST ?? '').trim();
  if (/^sha256:[a-f0-9]{64}$/.test(digest) && /^(docker|podman)$/.test((env.ZA141251SA_BOUNTY_SANDBOX_RUNTIME ?? 'docker').trim().toLowerCase())) return true;
  const cache = defaultSandboxCacheRoot();
  try {
    return readdirSync(cache, { encoding: 'utf8' }).some(name => name.startsWith('rootfs-') && existsSync(`${cache}/${name}/.complete`));
  } catch { return false; }
}

export interface ClassEligibility {
  agentId: string;
  agentClass: string;
  eligible: boolean;
  blockers: string[];
  snapshot: Record<string, unknown>;
}

/** The readiness check for one agent and one class. Every blocker is a live fact, not a hope. */
export function classEligibility(agentId: string, agentClass: string, options: { ignoreProposalId?: string } = {}): ClassEligibility {
  const definition = classContractDefinition(agentClass);
  const blockers: string[] = [];
  if (!definition) return { agentId, agentClass: String(agentClass ?? ''), eligible: false, blockers: ['class_unknown'], snapshot: {} };
  if (definition.ownerOnly) blockers.push('class_owner_only');
  const agent = db.get<Row>('SELECT id, status, origin_platform, slug FROM mission_agents WHERE id=?', [agentId]);
  if (!agent) blockers.push('agent_not_found');
  else if (String(agent.status) !== 'active') blockers.push('agent_not_active');
  else if (String(agent.origin_platform ?? '') === 'fixture') blockers.push('agent_is_fixture_origin');

  const grant = db.get<Row>("SELECT agent_id, status, expires_at, spend_limit_cents FROM mission_money_grants WHERE agent_id=?", [agentId]);
  if (definition.requiresMoneyGrant) {
    if (!grant) blockers.push('no_active_money_grant');
    else if (String(grant.status) !== 'active') blockers.push('money_grant_not_active');
    else if (grant.expires_at && Date.parse(String(grant.expires_at)) <= Date.now()) blockers.push('money_grant_expired');
    else if (definition.resourceLimits.maxSpendCents > 0 && Number(grant.spend_limit_cents) < definition.resourceLimits.maxSpendCents) blockers.push('money_grant_below_class_spend_floor');
  }
  if (definition.requiresSandbox && !executionBackendConfigured()) blockers.push('no_execution_backend');
  if (!blockers.length && db.get<Row>(
    "SELECT id FROM mission_agent_contracts WHERE agent_id=? AND status='active' AND purpose LIKE ?",
    [agentId, `class:${definition.agentClass}:%`],
  )) blockers.push('active_contract_for_class_exists');
  // The proposal under review is not a blocker for its own approval.
  if (!blockers.length && db.get<Row>(
    "SELECT id FROM mission_agent_contract_proposals WHERE agent_id=? AND agent_class=? AND status='pending' AND id<>?",
    [agentId, definition.agentClass, options.ignoreProposalId ?? ''],
  )) blockers.push('proposal_already_pending');

  return {
    agentId, agentClass: definition.agentClass, eligible: blockers.length === 0, blockers,
    snapshot: {
      agentStatus: agent ? String(agent.status) : null,
      moneyGrant: grant ? { status: String(grant.status), spendLimitCents: Number(grant.spend_limit_cents) } : null,
      executionBackend: executionBackendConfigured(),
      classDigest: digest(definition),
    },
  };
}

/** The agents that could hold this class right now, in the registry's own order. */
export function eligibleAgentsForClass(agentClass: string, limit = DEFAULT_PROPOSAL_BATCH): string[] {
  const definition = classContractDefinition(agentClass);
  if (!definition || definition.ownerOnly || limit < 1) return [];
  const cap = Math.min(limit, MAX_PROPOSALS_PER_BATCH);
  const rows = db.all<Row>(`SELECT id FROM mission_agents
    WHERE COALESCE(origin_platform,'')<>'fixture' AND status='active'
      AND (? = 0 OR id IN (SELECT agent_id FROM mission_money_grants WHERE status='active' AND (expires_at IS NULL OR expires_at>?)))
    ORDER BY id LIMIT ?`, [definition.requiresMoneyGrant ? 1 : 0, nowIso(), cap * 4] as SqlValue[]);
  return rows.map(row => String(row.id)).filter(id => classEligibility(id, agentClass).eligible).slice(0, cap);
}

/**
 * Owner-side preparation. Writes a proposal whose permissions are frozen from the class
 * definition, so the reviewer approves the exact grant that activation will apply.
 */
export function prepareClassContract(actor: MoneyActor, input: { agentId: string; agentClass: string; note?: string }) {
  assertMoneyOwner(actor);
  const agentId = String(input.agentId ?? '').trim();
  const definition = classContractDefinition(String(input.agentClass ?? ''));
  if (!agentId || !definition) refuse('invalid_input', 'agentId and a known agentClass are required');
  if (definition.ownerOnly) refuse('class_owner_only', `${definition.agentClass} may not be granted to an agent`);
  const eligibility = classEligibility(agentId, definition.agentClass);
  if (!eligibility.eligible) refuse(`contract_ineligible:${eligibility.blockers[0]}`, `not eligible: ${eligibility.blockers.join(',')}`);
  const policy = currentPolicy();
  const spendCap = Math.min(definition.resourceLimits.maxSpendCents, policy.maxExpenseCents);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + Math.min(definition.validityDays, PROPOSAL_TTL_DAYS) * 86_400_000).toISOString();
  const id = missionId('ccp');
  return db.transaction(() => {
    db.run(`INSERT INTO mission_agent_contract_proposals
      (id,agent_id,agent_class,purpose,permissions_json,resource_limits_json,budget_cents,status,eligibility_json,requested_by,requested_at,expires_at)
      VALUES (?,?,?,?,?,?,?,'pending',?,?,?,?)`,
    [id, agentId, definition.agentClass, `class:${definition.agentClass}:${digest(definition)}`,
      JSON.stringify([...definition.permissions].sort()), JSON.stringify({ ...definition.resourceLimits, maxSpendCents: spendCap, requiresSandbox: definition.requiresSandbox }),
      Math.max(0, spendCap), JSON.stringify(eligibility.snapshot), actor.id, now, expiresAt] as SqlValue[]);
    appendMissionAudit({
      actorType: 'owner', actorId: actor.id, action: 'agent_contract.prepared',
      subjectType: 'agent_contract_proposal', subjectId: id,
      detail: { agentId, agentClass: definition.agentClass, permissions: [...definition.permissions], maxSpendCents: spendCap, note: String(input.note ?? '').slice(0, 400), granted: false },
    });
    return db.get<Row>('SELECT * FROM mission_agent_contract_proposals WHERE id=?', [id])!;
  });
}

/**
 * Bounded batch preparation for a class. It stops at the first refusal reason per agent, and
 * never activates anything: the count that moves is `pending`, and it moves because an owner
 * will review each row. One unreviewed batch per class at a time — see the queue guard below.
 */
export function prepareClassContractsForClass(actor: MoneyActor, input: { agentClass: string; limit?: number }) {
  assertMoneyOwner(actor);
  const definition = classContractDefinition(String(input.agentClass ?? ''));
  if (!definition) refuse('class_unknown', 'unknown agent class');
  // The candidate query below already returns nothing for a class no agent may hold, so without this the
  // bulk path would answer 200 / "prepared 0" to a request to prepare `payout_release`. That is fail-closed
  // in effect and misleading in word: the owner would see an empty result where there is a rule.
  if (definition.ownerOnly) refuse('class_owner_only', `${definition.agentClass} may not be granted to an agent, prepared or otherwise`);
  const limit = Math.max(1, Math.min(MAX_PROPOSALS_PER_BATCH, Number.isSafeInteger(input.limit) ? Number(input.limit) : DEFAULT_PROPOSAL_BATCH));
  // The queue guard. Pressing "Prepare" twice must not quietly grow a backlog nobody has read: per agent
  // the eligibility check already refuses a duplicate (`proposal_already_pending`), but at fleet scale a
  // second click would otherwise walk on to the *next* 25 agents and add 25 more rows to a pile that is
  // still unreviewed. So a class with anything pending in it prepares nothing until the owner has dealt
  // with what is already there — approve the batch (which is the point of the queue), reject it, or let
  // it expire after `proposalTtlDays`, and the next batch becomes available. Nothing about this caps how
  // many agents may eventually hold a contract; it only says one unreviewed batch at a time.
  const alreadyPending = count("SELECT COUNT(*) AS c FROM mission_agent_contract_proposals WHERE agent_class=? AND status='pending'", [definition.agentClass]);
  if (alreadyPending > 0) {
    refuse('proposals_already_pending_for_class', `${alreadyPending} proposal(s) for ${definition.agentClass} are already awaiting the owner. Approve or reject that batch (or let it expire after ${PROPOSAL_TTL_DAYS} days) and the next batch becomes available — a second click is not allowed to grow a queue nobody has read`);
  }
  const candidates = eligibleAgentsForClass(definition.agentClass, limit);
  const prepared: string[] = [];
  const skipped: Array<{ agentId: string; reason: string }> = [];
  for (const agentId of candidates) {
    try {
      prepared.push(String(prepareClassContract(actor, { agentId, agentClass: definition.agentClass }).id));
    } catch (error) {
      skipped.push({ agentId, reason: error instanceof MoneyError ? error.code : 'prepare_failed' });
    }
  }
  if (prepared.length > 0) {
    // Put the review in the owner's queue once per class, not once per agent, so a batch of
    // 200 prepared contracts produces one task rather than 200 notifications.
    createHumanActionTask({
      agentId: prepared.length ? (db.get<Row>('SELECT agent_id FROM mission_agent_contract_proposals WHERE id=?', [prepared[0]])?.agent_id as string) : '',
      opportunityId: null,
      actionType: HUMAN_ACTION_TYPES.MANUAL_APPROVAL,
      reason: `${prepared.length} scoped contract proposal(s) prepared for class '${definition.agentClass}' and await owner approval. Granting is deliberately not automatic: review each frozen permission set, then approve or let it expire in ${PROPOSAL_TTL_DAYS} days.`,
      platformUrl: null,
    });
  }
  return {
    agentClass: definition.agentClass,
    considered: limit,
    eligible: candidates.length,
    prepared: prepared.length,
    preparedIds: prepared,
    skipped,
    pendingAfterThisBatch: prepared.length,
    note: 'Prepared is not granted. `scopedContract` in the fleet report stays 0 until an owner approves, which is the point. Another batch for this class unlocks when this one is reviewed.',
  };
}

/** Tamper guard: the stored proposal must still match the class definition it was frozen from. */
function matchAgainstDefinition(proposal: Row, definition: AgentClassDefinition): string | null {
  let permissions: unknown; let limits: unknown;
  try { permissions = JSON.parse(String(proposal.permissions_json)); limits = JSON.parse(String(proposal.resource_limits_json)); } catch { return 'proposal_payload_unreadable'; }
  if (!Array.isArray(permissions)) return 'proposal_permissions_invalid';
  const expected = [...definition.permissions].sort();
  const actual = [...permissions as string[]].sort();
  if (actual.length !== expected.length || actual.some((permission, index) => permission !== expected[index])) return 'proposal_permissions_widened';
  if (actual.some(permission => (definition.denied as readonly string[]).includes(permission))) return 'proposal_permissions_denied_for_class';
  if (actual.some(permission => !(GRANTABLE_PERMISSIONS as readonly string[]).includes(permission as GrantablePermission))) return 'proposal_permission_outside_vocabulary';
  const limitsRow = (limits && typeof limits === 'object' ? limits : {}) as Record<string, unknown>;
  if (Number(limitsRow.maxChildren) !== 0) return 'proposal_allows_child_creation';
  if (Number(limitsRow.maxDepth) !== 1) return 'proposal_allows_deeper_tree';
  const policy = currentPolicy();
  if (Number(limitsRow.maxSpendCents) > policy.maxExpenseCents) return 'proposal_spend_above_policy_cap';
  if (Number(proposal.budget_cents) > policy.maxExpenseCents) return 'proposal_budget_above_policy_cap';
  return null;
}

/**
 * Owner activation. This is the only function that turns a proposal into a live contract, and
 * it refuses anything that drifted, expired, or lost eligibility since it was prepared.
 */
export function approveClassContractProposal(actor: MoneyActor, proposalId: string, note?: string): Row {
  assertMoneyOwner(actor);
  const proposal = db.get<Row>('SELECT * FROM mission_agent_contract_proposals WHERE id=?', [proposalId]);
  if (!proposal) refuse('not_found', 'proposal not found');
  if (String(proposal.status) !== 'pending') refuse('proposal_not_pending', `proposal is ${String(proposal.status)}`);
  if (Date.parse(String(proposal.expires_at)) <= Date.now()) {
    db.transaction(() => { db.run("UPDATE mission_agent_contract_proposals SET status='expired',reviewed_at=? WHERE id=? AND status='pending'", [nowIso(), proposalId]); });
    refuse('proposal_expired', 'the owner review window closed; prepare it again on current facts');
  }
  const definition = classContractDefinition(String(proposal.agent_class));
  if (!definition) refuse('class_unknown', 'class definition no longer exists');
  if (definition.ownerOnly) refuse('class_owner_only', `${definition.agentClass} may not be granted to an agent`);
  // Two gates, one place, both ahead of the insert. The empty/unreadable check comes first because
  // "there is nothing here" must never be reported as a drift story. `matchAgainstDefinition` is the
  // pre-existing tamper check and is untouched. The exactness gate comes after it and answers the
  // question the drift check does not: is what remains *inside this class's own ceiling* — its spend
  // cap, its budget, its vocabulary — rather than merely inside the global policy cap.
  const nothing = emptyGrantFault(proposal, definition);
  if (nothing) refuseApproval(actor, proposalId, nothing, { agentId: String(proposal.agent_id), agentClass: definition.agentClass });
  const drift = matchAgainstDefinition(proposal, definition);
  if (drift) refuse(drift, 'the frozen proposal no longer matches its class definition');
  const scope = approvalScopeFault(proposal, definition);
  if (scope) refuseApproval(actor, proposalId, scope, { agentId: String(proposal.agent_id), agentClass: definition.agentClass });
  const agentId = String(proposal.agent_id);
  const eligibility = classEligibility(agentId, definition.agentClass, { ignoreProposalId: proposalId });
  // The agent must still qualify; and "an active contract for this class already exists" is
  // the only blocker that means this approval is a duplicate rather than a grant.
  if (!eligibility.eligible && eligibility.blockers.join(',') !== 'active_contract_for_class_exists') {
    refuse(`contract_ineligible:${eligibility.blockers[0]}`, `not eligible: ${eligibility.blockers.join(',')}`);
  }
  const contractId = missionId('ctr');
  const now = nowIso();
  return db.transaction(() => {
    db.run(`INSERT INTO mission_agent_contracts (id,agent_id,parent_agent_id,purpose,permissions,resource_limits,budget_cents,status,approved_by,approved_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [contractId, agentId, null, String(proposal.purpose), String(proposal.permissions_json), String(proposal.resource_limits_json),
      Number(proposal.budget_cents), 'active', actor.id, now, new Date(Date.now() + definition.validityDays * 86_400_000).toISOString()] as SqlValue[]);
    db.run("UPDATE mission_agent_contract_proposals SET status='approved',reviewed_by=?,reviewed_at=?,review_note=?,contract_id=? WHERE id=? AND status='pending'",
      [actor.id, now, String(note ?? '').slice(0, 1000), contractId, proposalId]);
    appendMissionAudit({
      actorType: 'owner', actorId: actor.id, action: 'agent_contract.activated',
      subjectType: 'agent', subjectId: agentId,
      detail: { contractId, proposalId, agentClass: definition.agentClass, permissions: JSON.parse(String(proposal.permissions_json)), validityDays: definition.validityDays },
    });
    return db.get<Row>('SELECT * FROM mission_agent_contracts WHERE id=?', [contractId])!;
  });
}

export function rejectClassContractProposal(actor: MoneyActor, proposalId: string, note: string): Row {
  assertMoneyOwner(actor);
  const reason = String(note ?? '').trim();
  if (!reason || reason.length > 1000) refuse('invalid_input', 'a rejection needs a short reason');
  return db.transaction(() => {
    db.run("UPDATE mission_agent_contract_proposals SET status='rejected',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'",
      [actor.id, nowIso(), reason, proposalId]);
    appendMissionAudit({ actorType: 'owner', actorId: actor.id, action: 'agent_contract.rejected', subjectType: 'agent_contract_proposal', subjectId: proposalId, detail: { reason } });
    const row = db.get<Row>('SELECT * FROM mission_agent_contract_proposals WHERE id=?', [proposalId]);
    if (!row) refuse('not_found', 'proposal not found');
    return row;
  });
}

/** Drop proposals nobody reviewed. Expiry is what makes "prepared" a real state, not a backlog. */
export function expireStaleProposals(): { expired: number } {
  const result = db.run("UPDATE mission_agent_contract_proposals SET status='expired' WHERE status='pending' AND expires_at<=?", [nowIso()]);
  return { expired: Number(result.changes ?? 0) };
}

export function listClassContractProposals(status: 'pending' | 'all' = 'pending', limit = 25) {
  const cap = Math.max(1, Math.min(200, Number.isSafeInteger(limit) ? limit : 25));
  const rows = status === 'all'
    ? db.all<Row>('SELECT * FROM mission_agent_contract_proposals ORDER BY requested_at DESC,id DESC LIMIT ?', [cap])
    : db.all<Row>("SELECT * FROM mission_agent_contract_proposals WHERE status='pending' ORDER BY requested_at,id LIMIT ?", [cap]);
  return rows.map(row => ({
    id: String(row.id), agentId: String(row.agent_id), agentClass: String(row.agent_class),
    permissions: JSON.parse(String(row.permissions_json)) as string[],
    resourceLimits: JSON.parse(String(row.resource_limits_json)) as Record<string, unknown>,
    budgetCents: Number(row.budget_cents), status: String(row.status),
    requestedAt: String(row.requested_at), expiresAt: String(row.expires_at),
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null, contractId: row.contract_id ? String(row.contract_id) : null,
  }));
}

/** Per-class view for the fleet report: what is offered, prepared, granted, and blocked. */
export function classContractReadiness() {
  const pending = count("SELECT COUNT(*) AS c FROM mission_agent_contract_proposals WHERE status='pending'");
  return AGENT_CLASS_CONTRACTS.map(definition => ({
    agentClass: definition.agentClass,
    label: definition.label,
    ownerOnly: definition.ownerOnly,
    permissions: [...definition.permissions],
    denied: [...definition.denied],
    active: count("SELECT COUNT(*) AS c FROM mission_agent_contracts WHERE status='active' AND (expires_at IS NULL OR expires_at>?) AND purpose LIKE ?", [nowIso(), `class:${definition.agentClass}:%`]),
    pendingProposals: definition.ownerOnly ? 0 : count("SELECT COUNT(*) AS c FROM mission_agent_contract_proposals WHERE status='pending' AND agent_class=?", [definition.agentClass]),
    eligibleNow: definition.ownerOnly ? 0 : eligibleAgentsForClass(definition.agentClass, 20).length,
    validityDays: definition.validityDays,
    requiresSandbox: definition.requiresSandbox,
    requiresMoneyGrant: definition.requiresMoneyGrant,
    pendingTotal: pending,
  }));
}

function count(sql: string, params: SqlValue[] = []): number {
  return Number(db.get<Row>(sql, params)?.c ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// The owner console's view of the same module: what a grant means in plain
// language, the fail-closed scope gate, and a bounded "approve all" that cannot
// approve anything the owner has not read.
//
// WHY THIS LIVES HERE AND NOT IN THE ROUTE. The route is one of three callers (the
// operator CLI and any future worker are the others). A scope rule written in the
// handler would be a rule the CLI skips, and the whole point of this module is that
// the permission set is decided in exactly one place.
// ─────────────────────────────────────────────────────────────────────────────

/** What each permission key lets its holder do, in the owner's words rather than in identifiers.
 *  An owner approving a permission grant has to be able to read what they are approving; a list
 *  of dotted keys is not that. Every key in GRANTABLE_PERMISSIONS must appear here, and a test
 *  pins the two lists against each other so a new permission cannot ship without a sentence. */
export const PERMISSION_PLAIN_LANGUAGE: Readonly<Record<GrantablePermission, string>> = Object.freeze({
  'tool.request': 'ask for a tool to be run on its behalf — every request is still decided by the tool gate',
  'resource.request': 'ask for metered resources (compute, storage) inside the policy caps',
  'expense.request': 'ask for money to be spent up to this contract’s budget — the owner still decides each one',
  'report.submit': 'file a work report or finding so it can be verified and, if it earns, paid',
});

/** What a contract never carries, stated for the owner rather than implied by absence. */
export const GRANT_NEVER_TEXT = 'never: create agents, write credentials, send a payout, move wallet money, freeze the treasury, open a pull request';

export function permissionSurfaceText(permissions: readonly string[]): string[] {
  return permissions.map(permission =>
    (PERMISSION_PLAIN_LANGUAGE as Readonly<Record<string, string>>)[permission] ?? `"${permission}" — not a permission the mission enforces, so this grant would mean nothing`);
}

export interface ApprovalScopeFault { code: string; detail: string }

/**
 * The fail-closed scope gate: refuse any proposal whose permission set is empty or wider than
 * its class, before a single row is written.
 *
 * `matchAgainstDefinition` answers "did this proposal drift from its class?"; this answers the
 * owner-facing question "is what is about to be granted worth granting, and is it inside the
 * class's declared ceiling?". An empty set is refused because a contract that grants nothing is
 * either a placeholder or a mistake — and the fleet gate counts *any* active contract, so an
 * empty one would let the blocker clear on paper while nothing was actually permitted.
 */
/**
 * The half of the gate that has to run before anything else: if there is no readable, non-empty
 * permission set, there is nothing to approve, and no later check should be allowed to dress that
 * up as a drift problem.
 */
export function emptyGrantFault(proposal: Row, definition: AgentClassDefinition): ApprovalScopeFault | null {
  let permissions: unknown;
  try { permissions = JSON.parse(String(proposal.permissions_json)); } catch {
    return { code: 'contract_permissions_unreadable', detail: 'the stored permission set cannot be parsed, so there is nothing this approval could grant' };
  }
  if (!Array.isArray(permissions)) return { code: 'contract_permissions_unreadable', detail: 'the stored permission set is not a list, so it cannot be checked against the class' };
  if (definition.ownerOnly) return { code: 'contract_class_owner_only', detail: `${definition.agentClass} is a class no agent may hold; the console cannot approve it either` };
  if ([...new Set(permissions as string[])].length === 0) {
    return { code: 'contract_permissions_empty', detail: `a contract that grants no permission cannot be approved — ${definition.agentClass} declares [${definition.permissions.join(', ') || 'none'}], and approving an empty grant would move the fleet's contract gate without permitting anything` };
  }
  return null;
}

export function approvalScopeFault(proposal: Row, definition: AgentClassDefinition): ApprovalScopeFault | null {
  const empty = emptyGrantFault(proposal, definition);
  if (empty) return empty;
  const permissions = JSON.parse(String(proposal.permissions_json)) as unknown[];
  let limits: unknown;
  try { limits = JSON.parse(String(proposal.resource_limits_json)); } catch {
    return { code: 'contract_limits_unreadable', detail: 'the stored resource limits cannot be parsed, so no ceiling can be confirmed for this grant' };
  }
  const granted = [...new Set(permissions as string[])];
  const allowed = new Set<string>(definition.permissions);
  const deniedForClass = (definition.denied as readonly string[]);
  const overBroad = granted.filter(permission => !allowed.has(permission));
  if (overBroad.length > 0) {
    const explicitlyDenied = overBroad.filter(permission => deniedForClass.includes(permission));
    if (explicitlyDenied.length > 0) return { code: 'contract_permissions_denied_for_class', detail: `${explicitlyDenied.join(', ')} is explicitly denied for ${definition.agentClass}; the proposal asks for more than the class allows` };
    return { code: 'contract_permissions_over_broad', detail: `${overBroad.join(', ')} is outside the ${definition.agentClass} allowlist [${[...allowed].join(', ') || 'empty'}]; nothing is widened by approval` };
  }
  const outsideVocabulary = granted.filter(permission => !(GRANTABLE_PERMISSIONS as readonly string[]).includes(permission as GrantablePermission));
  if (outsideVocabulary.length > 0) return { code: 'contract_permission_outside_vocabulary', detail: `${outsideVocabulary.join(', ')} is not a key the mission enforces, so a grant of it would be decoration rather than permission` };

  const limitsRow = (limits && typeof limits === 'object' ? limits : {}) as Record<string, unknown>;
  if (Number(limitsRow.maxChildren ?? 0) > 0) return { code: 'contract_allows_child_creation', detail: `the proposal allows ${String(limitsRow.maxChildren)} child agents; every scoped class is capped at zero` };
  if (Number(limitsRow.maxDepth ?? 0) > 1) return { code: 'contract_allows_deeper_tree', detail: `the proposal allows tree depth ${String(limitsRow.maxDepth)}; every scoped class is capped at 1` };
  const spendCap = Number(limitsRow.maxSpendCents ?? 0);
  if (spendCap > definition.resourceLimits.maxSpendCents) return { code: 'contract_spend_over_broad', detail: `the proposal caps spend at ${spendCap} cents while ${definition.agentClass} allows at most ${definition.resourceLimits.maxSpendCents} cents` };
  const policy = currentPolicy();
  if (spendCap > policy.maxExpenseCents) return { code: 'contract_spend_above_policy_cap', detail: `the proposal's spend cap ${spendCap} exceeds the policy maximum ${policy.maxExpenseCents}` };
  const budget = Number(proposal.budget_cents ?? 0);
  if (budget > definition.resourceLimits.maxSpendCents) return { code: 'contract_budget_over_broad', detail: `the proposal budgets ${budget} cents for a class whose ceiling is ${definition.resourceLimits.maxSpendCents} cents` };
  if (budget > policy.maxExpenseCents) return { code: 'contract_budget_above_policy_cap', detail: `the proposal budgets ${budget} cents, above the policy maximum ${policy.maxExpenseCents}` };
  return null;
}

/** A refusal is a decision, so it is recorded before it is thrown — and outside any transaction, so
 *  the rollback that follows cannot take the evidence of why with it. */
function refuseApproval(actor: MoneyActor, proposalId: string, fault: ApprovalScopeFault, context: Record<string, unknown>): never {
  appendMissionAudit({
    actorType: 'owner', actorId: actor.id, action: 'agent_contract.approval_refused',
    subjectType: 'agent_contract_proposal', subjectId: proposalId,
    detail: { reason: fault.code, why: fault.detail, ...context },
  });
  throw new MoneyError(fault.code, `${fault.code}: ${fault.detail}`);
}

/** The total surface a bulk approval would grant: read once by the console, echoed back by the owner,
 *  recomputed at approval time so a proposal that appeared or vanished in between fails instead of
 *  silently changing what was agreed to. */
export function contractSurface(agentClass: string, proposals: readonly Row[]) {
  const permissions = new Set<string>();
  let totalBudgetCents = 0;
  let totalSpendCapCents = 0;
  for (const row of proposals) {
    try {
      for (const permission of JSON.parse(String(row.permissions_json)) as string[]) permissions.add(String(permission));
    } catch { /* unreadable rows are refused individually, with the reason, by the scope gate */ }
    totalBudgetCents += Math.max(0, Number(row.budget_cents ?? 0));
    try {
      const limits = JSON.parse(String(row.resource_limits_json)) as Record<string, unknown>;
      totalSpendCapCents += Math.max(0, Number(limits.maxSpendCents ?? 0));
    } catch { /* as above */ }
  }
  const sorted = [...permissions].sort();
  const stated = { agentClass, contracts: proposals.length, permissions: sorted, totalBudgetCents, totalSpendCapCents };
  return {
    ...stated,
    permissionsPlain: permissionSurfaceText(sorted),
    never: GRANT_NEVER_TEXT,
    surfaceDigest: sha256(JSON.stringify(stated)).slice(0, 16),
  };
}

/**
 * The owner console's read: one row per class, every number an aggregate, nothing per agent.
 *
 * It deliberately does not call `classContractReadiness()`, which samples per-agent eligibility: that
 * is correct for a CLI report on a laptop and wrong for a page load — the fleet is 4,001 agents, and
 * per-agent work inside a GET is exactly what blanked the Overview. What the owner is choosing from
 * here (counts, ceilings, permission text, how many rows exist) is all one grouped query per number.
 */
export function classContractConsoleView() {
  const now = nowIso();
  const agents = count("SELECT COUNT(*) AS c FROM mission_agents WHERE status='active' AND COALESCE(origin_platform,'')<>'fixture'");
  const withGrant = count("SELECT COUNT(DISTINCT agent_id) AS c FROM mission_money_grants WHERE status='active' AND (expires_at IS NULL OR expires_at>?)", [now]);
  const specialistCounts = new Map<string, number>(db.all<Row>('SELECT agent_class, COUNT(*) AS c FROM mission_agent_specialists GROUP BY agent_class').map(row => [String(row.agent_class), Number(row.c)]));
  const backend = executionBackendConfigured();
  const activeTotal = count("SELECT COUNT(*) AS c FROM mission_agent_contracts WHERE status='active' AND (expires_at IS NULL OR expires_at>?)", [now]);
  const classes = AGENT_CLASS_CONTRACTS.map(definition => {
    const pendingRows = definition.ownerOnly ? [] as Row[] : db.all<Row>(
      "SELECT * FROM mission_agent_contract_proposals WHERE agent_class=? AND status='pending' ORDER BY requested_at, id LIMIT ?",
      [definition.agentClass, MAX_PROPOSALS_PER_BATCH],
    );
    const blockers: string[] = [];
    if (definition.ownerOnly) blockers.push('class_owner_only');
    if (definition.requiresMoneyGrant && withGrant === 0) blockers.push('no_agent_holds_an_active_money_grant');
    if (definition.requiresSandbox && !backend) blockers.push('no_execution_backend');
    return {
      agentClass: definition.agentClass,
      label: definition.label,
      purpose: definition.purpose,
      permissions: [...definition.permissions],
      permissionsPlain: permissionSurfaceText(definition.permissions),
      denied: [...definition.denied],
      never: GRANT_NEVER_TEXT,
      resourceLimits: definition.resourceLimits,
      validityDays: definition.validityDays,
      ownerOnly: definition.ownerOnly,
      requiresSandbox: definition.requiresSandbox,
      requiresMoneyGrant: definition.requiresMoneyGrant,
      // What the registry says this class is for, counted rather than assumed. 0 is an answer: an
      // unassigned class is offered because it is grantable, not because a venue needs it today.
      specialistsAssigned: specialistCounts.get(definition.agentClass) ?? 0,
      needsIt: agents,
      withActiveMoneyGrant: withGrant,
      activeContracts: count("SELECT COUNT(*) AS c FROM mission_agent_contracts WHERE status='active' AND (expires_at IS NULL OR expires_at>?) AND purpose LIKE ?", [now, `class:${definition.agentClass}:%`]),
      pendingProposals: pendingRows.length,
      // The rows themselves, so an owner can approve one at a time, each with the fault that would
      // refuse it already computed and shown — a refusal the owner can read before clicking beats one
      // they discover by clicking.
      pending: pendingRows.map(row => ({
        id: String(row.id),
        agentId: String(row.agent_id),
        permissions: (() => { try { return [...new Set(JSON.parse(String(row.permissions_json)) as string[])].sort(); } catch { return null; } })(),
        budgetCents: Math.max(0, Number(row.budget_cents ?? 0)),
        requestedAt: String(row.requested_at),
        expiresAt: String(row.expires_at),
        expired: Date.parse(String(row.expires_at)) <= Date.now(),
        scopeFault: approvalScopeFault(row, definition),
      })),
      surface: contractSurface(definition.agentClass, pendingRows),
      canPrepareNow: blockers.length === 0,
      blockers,
    };
  });
  return {
    generatedAt: now,
    registry: { agents, withActiveMoneyGrant: withGrant, executionBackendConfigured: backend, specialists: specialistCounts.size },
    blocker: {
      code: 'no_scoped_contract' as const,
      cleared: activeTotal > 0,
      activeContracts: activeTotal,
      // Both readings have to be on screen, or "approve one and the fleet is unblocked" becomes an
      // implication an owner could act on. The gate is global; execution readiness is per agent.
      judgement: 'the gate below counts active contracts across the fleet: one approved contract clears it. Each individual agent still needs its own approved contract before it can start — that is the per-agent reading in the fleet report, and preparing is not granting.',
    },
    limits: { maxProposalsPerBatch: MAX_PROPOSALS_PER_BATCH, defaultBatch: DEFAULT_PROPOSAL_BATCH, proposalTtlDays: PROPOSAL_TTL_DAYS },
    classes,
    note: 'Prepared is not granted. Nothing here approves anything: every row below stays pending until the owner approves it, and a class no agent may hold is listed so the refusal is visible rather than silent.',
  };
}

export type ClassContractConsoleView = ReturnType<typeof classContractConsoleView>;

/**
 * Bounded bulk approval for one class. There is no "approve the whole fleet" and no approve-all
 * across classes: the surface the owner confirms is one class's permission set times the exact
 * proposals that exist for it at the moment of the click, recomputed here and required to match
 * what the console showed. If it does not match, nothing is granted.
 */
export function approveAllClassContractProposals(actor: MoneyActor, input: { agentClass: string; confirmSurface?: string }) {
  assertMoneyOwner(actor);
  const definition = classContractDefinition(String(input.agentClass ?? ''));
  if (!definition) refuse('class_unknown', 'unknown agent class');
  if (definition.ownerOnly) refuse('class_owner_only', `${definition.agentClass} may not be granted to an agent, in bulk or otherwise`);
  const pending = db.all<Row>(
    "SELECT * FROM mission_agent_contract_proposals WHERE agent_class=? AND status='pending' ORDER BY requested_at, id LIMIT ?",
    [definition.agentClass, MAX_PROPOSALS_PER_BATCH],
  );
  const surface = contractSurface(definition.agentClass, pending);
  const stated = String(input.confirmSurface ?? '').trim();
  if (pending.length === 0) refuse('nothing_pending', `no pending proposal exists for ${definition.agentClass}; prepare the class first`);
  if (!stated || stated !== surface.surfaceDigest) {
    appendMissionAudit({
      actorType: 'owner', actorId: actor.id, action: 'agent_contract.bulk_approval_refused',
      subjectType: 'agent_class', subjectId: definition.agentClass,
      detail: { reason: stated ? 'confirmation_surface_mismatch' : 'confirmation_required', stated: stated || null, expected: surface.surfaceDigest, surface: { contracts: surface.contracts, permissions: surface.permissions, totalBudgetCents: surface.totalBudgetCents } },
    });
    refuse('confirmation_surface_mismatch', `the surface you confirmed (${stated || 'nothing stated'}) is not the surface on record now (${surface.surfaceDigest}: ${surface.contracts} contract(s), ${surface.permissions.join('+') || 'no permission'}). Nothing was approved; re-read the list and confirm again`);
  }
  const granted: Array<{ contractId: string; agentId: string; proposalId: string }> = [];
  const refused: Array<{ proposalId: string; agentId: string; code: string; detail: string }> = [];
  for (const row of pending) {
    const proposalId = String(row.id);
    try {
      const contract = approveClassContractProposal(actor, proposalId, 'approved from the owner console (bulk, surface confirmed)');
      granted.push({ contractId: String(contract.id), agentId: String(contract.agent_id), proposalId });
    } catch (error) {
      refused.push({
        proposalId, agentId: String(row.agent_id),
        code: error instanceof MoneyError ? error.code : 'approve_failed',
        detail: String((error as Error).message).slice(0, 400),
      });
    }
  }
  if (granted.length > 0) {
    appendMissionAudit({
      actorType: 'owner', actorId: actor.id, action: 'agent_contract.bulk_approved',
      subjectType: 'agent_class', subjectId: definition.agentClass,
      detail: { granted: granted.length, refused: refused.length, surface: { contracts: surface.contracts, permissions: surface.permissions, totalBudgetCents: surface.totalBudgetCents }, surfaceDigest: surface.surfaceDigest },
    });
  }
  return {
    agentClass: definition.agentClass,
    considered: pending.length,
    granted: granted.length,
    grantedIds: granted,
    // A count and the list: the banner needs a number, the owner needs the reasons, and a UI that had to
    // choose one would quietly drop the other.
    refusedCount: refused.length,
    refused,
    surface,
    note: refused.length > 0
      ? `${granted.length} granted, ${refused.length} refused — each refusal carries its own reason and is recorded in the audit trail. A refusal was never a partial grant.`
      : `${granted.length} contract(s) activated from proposals the owner confirmed by surface digest.`,
  };
}
