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
 * will review each row.
 */
export function prepareClassContractsForClass(actor: MoneyActor, input: { agentClass: string; limit?: number }) {
  assertMoneyOwner(actor);
  const definition = classContractDefinition(String(input.agentClass ?? ''));
  if (!definition) refuse('class_unknown', 'unknown agent class');
  const limit = Math.max(1, Math.min(MAX_PROPOSALS_PER_BATCH, Number.isSafeInteger(input.limit) ? Number(input.limit) : DEFAULT_PROPOSAL_BATCH));
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
    note: 'Prepared is not granted. `scopedContract` in the fleet report stays 0 until an owner approves, which is the point.',
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
  const drift = matchAgainstDefinition(proposal, definition);
  if (drift) refuse(drift, 'the frozen proposal no longer matches its class definition');
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
