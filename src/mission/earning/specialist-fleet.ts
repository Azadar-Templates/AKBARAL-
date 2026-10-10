/**
 * The specialist fleet: one verified platform per agent, one real expert profile per agent, one
 * auditable readiness ladder per agent.
 *
 * WHAT THIS MODULE DECIDES. Assignment, profile materialization, state transitions, opportunity
 * ranking and outcome recording. Every one of those is written as a gate that refuses, not a
 * counter that increments: an agent can only be called EXECUTION_READY because the code re-read
 * the platform evidence, the evaluation certificate, the credential row, the contract row and
 * the policy, and every one of them said yes.
 *
 * WHAT IT NEVER DOES. It never creates accounts, never handles credentials (it only checks that a
 * credential record exists for the venue), never submits anything outward, never touches the
 * ledger, and never assigns an agent to an unverified or closed venue. Overflow agents — the many
 * thousands with no distinct verified platform left — are recorded as `UNASSIGNED_PLATFORM`,
 * which is a real state with a real reason, not a silent gap. The fleet is not padded to a number.
 *
 * The owner-facing readiness numbers stay in `fleet-readiness.ts`; this module consumes it rather
 * than restating it, so the dashboard and the state machine can never disagree.
 */

import { missionDb as db, missionId, nowIso, sha256, appendMissionAudit, type Row, type SqlValue } from '../database';
import { MoneyError, type MoneyActor } from '../money';
import { getPlatform } from './platform-discovery';
import { listConnectorContracts } from './connector-execution-contracts';
import { readinessFor, type BlockerCode } from './fleet-readiness';
import {
  AUTHORIZED_ACCOUNT_GROUPS, DISCOVERY_CATEGORIES, GMAIL_GROUPS, catalogSummary, latestEvidence, platformRecordFor,
  resolvePermissions, resolveRegistryPlatformId, resolveToolKeys,
  type GmailGroup, type PlatformRecord,
} from './platform-catalog';
import { profileRulesDigest, runSpecialistEvaluation, skillVerificationState, suiteFor, type SpecialistProfileView } from './specialist-evaluation';
import { describeSpecialty, isSpecialtyFit, specialtyFor } from './specialty-registry';

function deny(code: string, detail?: string): never {
  throw new MoneyError(code, detail ? `${code}: ${detail}` : code);
}

export const STATE_LADDER = ['REGISTERED', 'PLATFORM_ASSIGNED', 'TRAINING', 'SKILLS_VERIFIED', 'ACCESS_READY', 'CONTRACT_APPROVED', 'EXECUTION_READY', 'WORKING'] as const;
export const EXCEPTION_STATES = ['BLOCKED', 'INACTIVE', 'NEEDS_OWNER_ACTION'] as const;
export type SpecialistState = (typeof STATE_LADDER)[number] | (typeof EXCEPTION_STATES)[number];
/** `UNASSIGNED_PLATFORM` is a fleet readiness state, never a specialist profile state: an agent
 *  with no venue has no profile, and inventing one to fill a row would be a false record. */
export type FleetState = SpecialistState | 'UNASSIGNED_PLATFORM';
export const EVIDENCE_MAX_AGE_DAYS = 30;

function json(value: unknown): string { return JSON.stringify(value ?? null); }
function parse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export interface AssignmentResult {
  readonly assignmentId: string;
  readonly agentId: string;
  readonly platformId: string;
  readonly specialtyKey: string;
  readonly gmailGroup: GmailGroup;
  readonly reused: boolean;
}

/** The venue must have a current, open, non-prohibited evidence record. Everything else fails. */
export function assertAssignablePlatform(platformId: string): {
  readonly record: PlatformRecord; readonly registryId: string; readonly evidenceId: string; readonly platformStatus: string;
} {
  const record = platformRecordFor(platformId);
  if (!record) deny('platform_not_in_catalog', platformId);
  // Every foreign key below has to point at the row that actually exists, so the venue is
  // resolved once here and carried forward instead of being re-spelled.
  const registryId = resolveRegistryPlatformId(platformId);
  if (!registryId) deny('platform_not_in_registry', `${platformId}: run --apply-catalog first`);
  const summary = catalogSummary({ maxAgeDays: EVIDENCE_MAX_AGE_DAYS }).rows
    .find(row => row.platformId === registryId || row.catalogId === platformId);
  if (!summary) deny('platform_evidence_missing', platformId);
  const blocking = summary!.blockingReasons;
  if (blocking.length) deny('platform_not_assignable', `${platformId}: ${blocking.join(',')}`);
  const evidence = latestEvidence(platformId);
  if (!evidence) deny('platform_evidence_missing', platformId);
  const platform = getPlatform(registryId!);
  const status = String(platform?.status ?? 'DISCOVERED');
  // A venue the owner has restricted or blocked is not assignable even with a fresh record:
  // the owner's permission decision outranks our reading of the marketplace.
  if (status === 'RESTRICTED' || status === 'BLOCKED') deny('platform_restricted_by_owner', `${platformId} is ${status}`);
  return { record: record!, registryId: registryId!, evidenceId: String(evidence!.id), platformStatus: status };
}

/** Rules, skills, tools and permissions come from the venue record — nothing is invented here. */
export interface BuiltSpecialistProfile extends SpecialistProfileView {
  readonly agentClass: string;
  /** Tool keys the venue record named but no connector contract backs, kept visible as gaps. */
  readonly unresolvedTools: readonly string[];
  readonly resolvedTools: readonly string[];
}

export function buildSpecialistProfile(agentId: string, record: PlatformRecord): BuiltSpecialistProfile {
  const tools = resolveToolKeys(record.toolKeys);
  const permissions = resolvePermissions(record.agentClass, []);
  return {
    agentId,
    platformId: record.platformId,
    specialtyKey: record.specialtyKey,
    agentClass: record.agentClass,
    rules: {
      discovery: [`Enumerate only from ${record.officialUrl} and the venue's own machine-readable listings; record the observation timestamp for every candidate`, 'Re-check the live claim state immediately before any work starts, and again before submission'],
      eligibility: [`${record.accountRequirements.map(entry => `account: ${entry}`).join('; ') || 'no account terms recorded'}`, `${record.paymentConditions.map(entry => `payment: ${entry}`).join('; ') || 'no payment terms recorded'}`, record.automationPolicy === 'prohibited' ? 'the venue prohibits automated participation: all work here is prepared for the owner and never submitted by an agent' : `automation policy at the venue: ${record.automationPolicy}`],
      scope: record.scopeRules.map(entry => `scope: ${entry}`),
      submission: record.submissionRequirements.map(entry => `submission: ${entry}`).concat(['no external submission without explicit owner approval', 'every submission carries reproducible evidence and the venue-required disclosures']),
      severity: record.deadlinePolicy ? [`venue deadline policy: ${record.deadlinePolicy}`, 'a finding is only as good as its severity argument against the venue rubric', 'informational, out-of-scope and non-monetary outcomes are never recorded as revenue'] : ['venue rubric unread: severity claims are refused rather than guessed'],
    },
    skills: record.skills,
    permissions: [...permissions.permissions],
    denied: [...permissions.denied],
    deadlineVerification: [record.deadlinePolicy, `hard window check before commitment: refuse when the remaining time cannot fit verification plus owner review`],
    rewardVerification: {
      requires_settlement_evidence: true,
      non_monetary_reward_is_not_revenue: true,
      advertised_reward_ceiling_verified: false,
      // Stated twice on purpose, because the two are different claims an auditor will ask about
      // separately: the venue's advertised ceiling is not a verified figure, and the specialist
      // must never treat it as revenue. A grader asserts both, so neither can be implied.
      treats_advertised_reward_as_revenue: false,
      stated_maximum_usd_cents: record.maxRewardUsdCents,
      conditions: [...record.paymentConditions],
    },
    rejectionCodes: [...record.rejectionCodes],
    submissionRequirements: [...record.submissionRequirements],
    // Kept out of the graded profile view but persisted on the row: a tool with no registered
    // connector contract is a wish, so it is recorded as unresolved instead of being granted.
    unresolvedTools: tools.missing,
    resolvedTools: tools.resolved.map(entry => entry.key),
  };
}

export interface SpecializeResult {
  readonly assignment: AssignmentResult;
  readonly state: SpecialistState;
  readonly stateReason: string;
  readonly profileDigest: string;
  readonly evaluation: { readonly score: number; readonly passed: boolean; readonly graders: number } | null;
}

/**
 * Assign one agent to one platform and materialize its profile. Idempotent per agent+platform, so
 * a refresh pass can run repeatedly; a second platform for the same agent, or a second agent for
 * the same platform, is refused rather than replaced.
 */
export function specializeAgent(input: { readonly actor: MoneyActor; readonly agentId: string; readonly platformId: string; readonly gmailGroup?: GmailGroup; readonly runFixtureEvaluation?: boolean }): SpecializeResult {
  const agent = db.get<Row>('SELECT id, slug, status, origin_platform FROM mission_agents WHERE id=?', [input.agentId]);
  if (!agent) deny('specialist_agent_unknown', input.agentId);
  if (String(agent!.origin_platform ?? '') === 'fixture' || String(agent!.origin_platform ?? '') === 'test') deny('specialist_agent_is_fixture', input.agentId);
  if (String(agent!.status) !== 'active') deny('specialist_agent_not_active', String(agent!.status));
  const { record, registryId, evidenceId, platformStatus } = assertAssignablePlatform(input.platformId);
  const platformId = registryId;
  const gmailGroup: GmailGroup = input.gmailGroup ?? record!.gmailGroup;
  if (!((GMAIL_GROUPS as readonly string[])).includes(gmailGroup)) deny('specialist_account_group_unknown', gmailGroup);
  // An unauthorized grouping is a recorded gap, not a reason to skip the specialist: the rules,
  // skills and evaluation are real work the fleet can do today, and only access needs the owner.
  const groupAuthorized = AUTHORIZED_ACCOUNT_GROUPS.includes(gmailGroup);

  // Every write for one specialization lands together or not at all. A half-written assignment
  // would burn a platform slot with no profile behind it, and a retry could not tell that apart
  // from an honest assignment — which is precisely how a fleet ends up with phantom specialists.
  const written = db.transaction((): {
    assignmentId: string; reused: boolean; digest: string; evaluation: SpecializeResult['evaluation'];
    initialState: SpecialistState; initialStateReason: string; platformId: string;
  } => {
    const existing = db.get<Row>("SELECT * FROM mission_agent_platform_assignments WHERE agent_id=? AND slot_type='primary' AND status='active'", [input.agentId]);
    let assignmentId: string;
    let reused = false;
    if (existing) {
      if (String(existing.platform_id) !== platformId) deny('agent_already_assigned', `${input.agentId} holds ${String(existing.platform_id)}; release it first — one agent is one platform`);
      reused = true;
      assignmentId = String(existing.id);
    } else {
      const taken = db.get<Row>("SELECT agent_id FROM mission_agent_platform_assignments WHERE platform_id=? AND slot_type='primary' AND status='active'", [platformId]);
      if (taken) deny('platform_already_taken', `${input.platformId} is the primary platform of ${String(taken.agent_id)}`);
      assignmentId = missionId('asgn');
      db.run(`INSERT INTO mission_agent_platform_assignments (id,agent_id,platform_id,specialty_key,gmail_group,slot_type,status,evidence_id,assigned_by,assigned_at)
        VALUES (?,?,?,?,?,?,'active',?,?,?)`, [
        assignmentId, input.agentId, platformId, record!.specialtyKey, gmailGroup, 'primary', evidenceId, `${input.actor.kind}:${input.actor.id}`, nowIso(),
      ] as SqlValue[]);
    }

    const profile = buildSpecialistProfile(input.agentId, record!);
    const digest = profileRulesDigest(profile);
    const suite = suiteFor(platformId, record!.specialtyKey);
    const now = nowIso();
    const toolsJson = json(profile.resolvedTools);
    const workflow = {
      stages: ['discover', 'verify_open_and_payable', 'check_eligibility_and_scope', 'assign', 'apply_requirements', 'execute', 'test', 'independent_verify', 'attach_evidence_and_report', 'owner_approved_submission', 'track_acceptance', 'verify_payment', 'ledger'],
      tools: resolveToolKeys(record!.toolKeys),
      ownerApprovalRequiredFor: ['account creation', 'identity or KYC', 'wallet or payout setup', 'any credential write', 'every external submission'],
      securityConstraints: ['authorized scope only', 'no destructive testing', 'no probing of systems outside the named asset'],
      evaluationGate: suite.tasks.map(task => ({ key: task.grader, label: task.label, critical: task.critical })),
    };
    const current = db.get<Row>('SELECT profile_version, state, created_at FROM mission_agent_specialists WHERE agent_id=?', [input.agentId]);
    const nextVersion = Number(current?.profile_version ?? 0) + (current ? 1 : 0);
    const initialState: SpecialistState = groupAuthorized ? 'PLATFORM_ASSIGNED' : 'NEEDS_OWNER_ACTION';
    const initialStateReason = groupAuthorized
      ? `assigned to ${platformId} (registry status ${platformStatus})`
      : `assigned to ${platformId}; ${gmailGroup} is not an authorized account grouping, so access awaits the owner`;
    db.run(`INSERT OR REPLACE INTO mission_agent_specialists
      (agent_id,platform_id,specialty_key,display_role,agent_class,profile_version,rules_digest,rules_json,skills_json,tools_json,permissions_json,denied_permissions_json,
       workflow_json,deadline_policy_json,reward_verification_json,rejection_codes_json,evaluation_gate_json,state,state_reason,state_evidence_json,skill_level,metrics_json,trained_at,skills_verified_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      input.agentId, platformId, record!.specialtyKey, record!.displayRole, record!.agentClass,
      nextVersion || 1, digest, json(profile.rules), json(profile.skills), toolsJson, json(profile.permissions), json(profile.denied),
      json(workflow), json({ policy: record!.deadlinePolicy, checks: profile.deadlineVerification }), json(profile.rewardVerification), json(profile.rejectionCodes), json(workflow.evaluationGate),
      initialState, initialStateReason, json({ evidence_id: evidenceId, gmail_group: gmailGroup, group_authorized: groupAuthorized, suite: suite.suiteKey }),
      0, json({}), null, null, current ? String(current.created_at ?? now) : now, now,
    ] as SqlValue[]);
    if (!current) {
      db.run('INSERT INTO mission_agent_state_transitions (id,agent_id,from_state,to_state,reason,evidence_digest,actor_type,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [missionId('strn'), input.agentId, 'REGISTERED', initialState, `platform ${input.platformId} assigned with a verified evidence record`, digest, input.actor.kind, input.actor.id, now] as SqlValue[]);
    }

    // A fixture-mode evaluation proves the suite runs; it can never certify the agent, and its
    // result is stored so the owner can see the graders were exercised on this profile.
    let evaluation: SpecializeResult['evaluation'] = null;
    if (input.runFixtureEvaluation) {
      // Grade the stored row, not the in-memory build, so the digest recorded on the certificate is
      // the one `evaluateGates` will look for later.
      evaluation = (() => {
        const stored = db.get<Row>('SELECT platform_id, specialty_key, rules_json, skills_json, permissions_json, denied_permissions_json, deadline_policy_json, reward_verification_json, rejection_codes_json FROM mission_agent_specialists WHERE agent_id=?', [input.agentId]);
        const outcome = runSpecialistEvaluation({ actor: input.actor, profile: profileFromRow(stored, input.agentId, String(stored?.platform_id ?? '')), mode: 'fixture' });
        return { score: outcome.score, passed: outcome.passed, graders: outcome.results.length };
      })();
    }
    return { assignmentId, reused, digest, evaluation, initialState, initialStateReason, platformId };
  });
  const { assignmentId, reused, digest, evaluation, initialState, initialStateReason } = written;
  appendMissionAudit({
    actorType: input.actor.kind, actorId: input.actor.id, action: reused ? 'specialist.assignment.refreshed' : 'specialist.assignment.created',
    subjectType: 'agent', subjectId: input.agentId,
    detail: { platform: platformId, specialty: record!.specialtyKey, gmail_group: gmailGroup, profile_digest: digest.slice(0, 16), evaluation },
  });
  if (!groupAuthorized) {
    upsertFleetState(input.agentId, 'NEEDS_OWNER_ACTION', {
      blockers: [`account_group_unavailable: ${gmailGroup} is not an authorized account grouping for this mission`],
      ownerActions: [`authorize an account grouping for ${platformId} (or move this venue under one that exists) — never a shared inbox, never a distributed password`],
      // Deliberately after the transaction commits: the owner-action record describes the gap
      // rather than the assignment, so it must survive a retry of the write phase.
    }, nowIso(), input.actor);
  }
  return {
    assignment: { assignmentId, agentId: input.agentId, platformId, specialtyKey: record!.specialtyKey, gmailGroup, reused },
    state: initialState, stateReason: initialStateReason, profileDigest: digest, evaluation,
  };
}

export function releaseAssignment(input: { readonly actor: MoneyActor; readonly agentId: string; readonly reason: string }): { released: boolean } {
  if (input.actor.kind !== 'owner') deny('specialist_release_owner_only');
  const existing = db.get<Row>("SELECT id, platform_id FROM mission_agent_platform_assignments WHERE agent_id=? AND slot_type='primary' AND status='active'", [input.agentId]);
  if (!existing) return { released: false };
  const now = nowIso();
  db.run("UPDATE mission_agent_platform_assignments SET status='released', released_by=?, released_at=?, release_reason=? WHERE id=?",
    [`${input.actor.kind}:${input.actor.id}`, now, input.reason.slice(0, 480), String(existing.id)] as SqlValue[]);
  db.run("UPDATE mission_agent_specialists SET state='REGISTERED', state_reason=?, updated_at=? WHERE agent_id=?", [`released from ${String(existing.platform_id)}: ${input.reason}`.slice(0, 480), now, input.agentId] as SqlValue[]);
  db.run('INSERT INTO mission_agent_state_transitions (id,agent_id,from_state,to_state,reason,evidence_digest,actor_type,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [missionId('strn'), input.agentId, 'PLATFORM_ASSIGNED', 'REGISTERED', input.reason.slice(0, 480), null, input.actor.kind, input.actor.id, now] as SqlValue[]);
  appendMissionAudit({ actorType: input.actor.kind, actorId: input.actor.id, action: 'specialist.assignment.released', subjectType: 'agent', subjectId: input.agentId, detail: { platform: String(existing.platform_id), reason: input.reason } });
  return { released: true };
}

export interface GateReport { readonly blockers: string[]; readonly ownerActions: string[] }

function hasCredentialFor(platformId: string, record: PlatformRecord | null): boolean {
  const connectorIds = new Set(listConnectorContracts().map(contract => contract.connectorId));
  const keys = [platformId, ...((record?.toolKeys ?? []).filter(key => connectorIds.has(key)))];
  for (const key of keys) {
    if (db.get<Row>("SELECT id FROM mission_credentials WHERE provider=? AND status='active' LIMIT 1", [key])) return true;
    if (db.get<Row>("SELECT id FROM mission_credentials WHERE provider=? AND status='active' LIMIT 1", [key.replace(/[^a-z0-9]+/g, '-')])) return true;
  }
  return false;
}

function activeContractFor(agentId: string): { present: boolean; expired: boolean } {
  const row = db.get<Row>('SELECT status, expires_at, approved_at FROM mission_agent_contracts WHERE agent_id=? ORDER BY created_at DESC LIMIT 1', [agentId]);
  if (!row || String(row.status) !== 'active') return { present: false, expired: false };
  const expiresAt = row.expires_at ? Date.parse(String(row.expires_at)) : NaN;
  return { present: true, expired: Number.isFinite(expiresAt) && expiresAt < Date.now() };
}

/**
 * Everything a state transition needs, computed from rows and engines. `blockers` empty means the
 * state is earned right now; a blocker is always a sentence the owner can act on.
 */
export function evaluateGates(agentId: string, desired: SpecialistState): GateReport {
  const blockers: string[] = [];
  const ownerActions: string[] = [];
  const specialist = db.get<Row>('SELECT * FROM mission_agent_specialists WHERE agent_id=?', [agentId]);
  const assignment = db.get<Row>("SELECT * FROM mission_agent_platform_assignments WHERE agent_id=? AND slot_type='primary' AND status='active'", [agentId]);
  const rank = STATE_LADDER.indexOf(desired as (typeof STATE_LADDER)[number]);
  if (rank >= 1 && (!assignment || !specialist)) {
    blockers.push('no_active_platform_assignment: the agent holds no primary platform with a verified evidence record');
    return { blockers, ownerActions };
  }
  if (rank < 1) return { blockers, ownerActions };

  const platformId = String(assignment?.platform_id ?? specialist?.platform_id ?? '');
  const record = platformId ? platformRecordFor(platformId) : null;
  const needSkills = rank >= STATE_LADDER.indexOf('TRAINING');
  if (needSkills) {
    const suite = suiteFor(platformId, String(specialist?.specialty_key ?? ''));
    if (!suite.tasks.length) blockers.push('no_evaluation_suite: the venue record declares no testable skills');
  }
  if (rank >= STATE_LADDER.indexOf('SKILLS_VERIFIED')) {
    const digest = profileRulesDigest(profileFromRow(specialist, agentId, platformId));
    const verdict = skillVerificationState(agentId, platformId, digest);
    if (!verdict.verified) blockers.push(`skill_certificate_${verdict.reason}: a non-fixture suite pass against this exact profile digest is required`);
  }
  if (rank >= STATE_LADDER.indexOf('ACCESS_READY')) {
    const group = String(assignment?.gmail_group ?? '') as GmailGroup;
    if (!AUTHORIZED_ACCOUNT_GROUPS.includes(group)) {
      blockers.push(`account_group_unavailable: ${group || 'no group'} is not an authorized account grouping for this mission`);
      ownerActions.push(`authorize an account grouping for ${platformId}, or move this platform under a group that exists — no shared inbox, no distributed password`);
    }
    if (!hasCredentialFor(platformId, record)) {
      blockers.push('credential_absent: no active mission credential record exists for this venue');
      ownerActions.push(`store the ${platformId} credential through the host secret manager (never in chat or Git), then register it as an active mission credential`);
    }
    const status = String(getPlatform(platformId)?.status ?? 'DISCOVERED');
    if (status === 'RESTRICTED' || status === 'BLOCKED') blockers.push(`platform_${status.toLowerCase()}: the owner has withheld permission for this venue`);
    const evidence = latestEvidence(platformId);
    if (!evidence) blockers.push('evidence_missing: no verification record for this venue');
    else if ((Date.now() - Date.parse(String(evidence.observed_at))) / 86_400_000 > EVIDENCE_MAX_AGE_DAYS) blockers.push('evidence_stale: re-read the venue before relying on it');
  }
  if (rank >= STATE_LADDER.indexOf('CONTRACT_APPROVED')) {
    const contract = activeContractFor(agentId);
    if (!contract.present) blockers.push('no_scoped_contract: an approved, active agent contract is required');
    else if (contract.expired) blockers.push('contract_expired: renew the scoped contract');
  }
  if (rank >= STATE_LADDER.indexOf('EXECUTION_READY')) {
    const readiness = readinessFor(agentId);
    for (const code of readiness.blockers as BlockerCode[]) {
      if (code === 'no_scoped_contract') continue; // already reported with the fuller sentence above
      blockers.push(`${code}: ${readinessBlockerText[code] ?? 'see the fleet readiness gates'}`);
      const action = readinessBlockerAction[code];
      if (action && !ownerActions.includes(action)) ownerActions.push(action);
    }
  }
  if (desired === 'WORKING') {
    const assigned = db.get<Row>("SELECT id FROM mission_specialist_opportunities WHERE agent_id=? AND state='assigned' LIMIT 1", [agentId]);
    if (!assigned) blockers.push('no_assigned_opportunity: an owner must place one ranked opportunity on this specialist before work starts');
  }
  if (desired === 'BLOCKED' || desired === 'INACTIVE' || desired === 'NEEDS_OWNER_ACTION') return { blockers: [], ownerActions };
  return { blockers, ownerActions: [...new Set(ownerActions)] };
}

const readinessBlockerText: Record<string, string> = {
  autonomy_disabled: 'the owner policy has autonomous execution off (or the kill switch engaged), so production autonomy stays disabled',
  kill_switch_engaged: 'the agent itself is not active',
  no_payout_slot_verified: 'no payout destination is verified, so earned money would have nowhere provable to land',
  no_platform_credential: 'no venue credential is registered',
  no_provider_ready: 'no connector is marked ready',
  no_active_money_grant: 'no active money grant exists for this agent, so any spend would be unauthorized',
  owner_action_pending: 'an owner action task is still open against this agent',
};
const readinessBlockerAction: Record<string, string> = {
  autonomy_disabled: 'enable autonomous execution in the mission policy only when every other gate has passed — this is an owner switch and was left off',
  no_payout_slot_verified: 'verify a payout slot through the existing payout verification flow',
  no_active_money_grant: 'grant a bounded money permit for the specific work, or keep the agent research-only',
  no_provider_ready: 'complete the connector owner steps listed in the provider readiness table',
  owner_action_pending: 'close the outstanding owner action task',
};

function profileFromRow(row: Row | undefined | null, agentId: string, platformId: string): SpecialistProfileView {
  if (!row) deny('specialist_profile_missing', agentId);
  const rules = parse(row!.rules_json as string, { discovery: [], eligibility: [], scope: [], submission: [], severity: [] });
  return {
    agentId, platformId,
    specialtyKey: String(row.specialty_key ?? ''),
    rules,
    skills: parse<SpecialistProfileView['skills']>(row.skills_json as string, []),
    permissions: parse<string[]>(row.permissions_json as string, []),
    denied: parse<string[]>(row.denied_permissions_json as string, []),
    deadlineVerification: parse<{ checks?: string[] }>(row.deadline_policy_json as string, {}).checks ?? [],
    rewardVerification: parse<Record<string, unknown>>(row.reward_verification_json as string, {}),
    rejectionCodes: parse<string[]>(row.rejection_codes_json as string, []),
    submissionRequirements: parse<{ submission?: string[] }>(row.rules_json as string, {}).submission ?? [],
  };
}

export interface StateResult { readonly from: SpecialistState | null; readonly to: SpecialistState; readonly enforced: boolean }

/**
 * Move one agent along the ladder. Forward moves are exactly one step and every step re-runs its
 * gate; exception states are reachable from anywhere; moving backwards requires the owner. A
 * refused transition still records the blockers, because "why not" is the answer the report needs.
 */
export function setSpecialistState(input: { readonly actor: MoneyActor; readonly agentId: string; readonly to: SpecialistState; readonly reason: string }): StateResult {
  if (!(STATE_LADDER as readonly string[]).includes(input.to) && !(EXCEPTION_STATES as readonly string[]).includes(input.to)) deny('specialist_state_unknown', input.to);
  const row = db.get<Row>('SELECT state FROM mission_agent_specialists WHERE agent_id=?', [input.agentId]);
  if (!row) deny('specialist_profile_missing', input.agentId);
  const from = String(row!.state) as SpecialistState;
  if (from === input.to) return { from, to: input.to, enforced: false };

  const fromRank = (STATE_LADDER as readonly string[]).indexOf(from);
  const toRank = STATE_LADDER.indexOf(input.to as (typeof STATE_LADDER)[number]);
  if (toRank >= 0 && fromRank >= 0) {
    if (toRank > fromRank + 1) deny('specialist_state_skip', `${from} -> ${input.to}: the ladder is walked, not jumped`);
    if (toRank < fromRank && input.actor.kind !== 'owner') deny('specialist_state_regression_owner_only', `${from} -> ${input.to}`);
  }
  const gates = evaluateGates(input.agentId, input.to);
  const now = nowIso();
  if (gates.blockers.length) {
    const recorded: SpecialistState = input.to === 'NEEDS_OWNER_ACTION' ? 'NEEDS_OWNER_ACTION' : (gates.ownerActions.length ? 'NEEDS_OWNER_ACTION' : 'BLOCKED');
    db.run('UPDATE mission_agent_specialists SET state=?, state_reason=?, state_evidence_json=?, updated_at=? WHERE agent_id=?',
      [recorded, `${input.to} refused: ${gates.blockers[0]}`.slice(0, 900), json({ wanted: input.to, blockers: gates.blockers, owner_actions: gates.ownerActions }), now, input.agentId] as SqlValue[]);
    db.run('INSERT INTO mission_agent_state_transitions (id,agent_id,from_state,to_state,reason,evidence_digest,actor_type,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [missionId('strn'), input.agentId, from, recorded, `refused ${input.to}: ${gates.blockers.join('; ')}`.slice(0, 900), null, input.actor.kind, input.actor.id, now] as SqlValue[]);
    upsertFleetState(input.agentId, recorded, gates, now, input.actor);
    appendMissionAudit({ actorType: input.actor.kind, actorId: input.actor.id, action: 'specialist.state.refused', subjectType: 'agent', subjectId: input.agentId, detail: { wanted: input.to, from, blockers: gates.blockers } });
    return { from, to: recorded, enforced: true };
  }
  const specialist = db.get<Row>('SELECT platform_id, specialty_key, rules_json, skills_json, permissions_json, denied_permissions_json, deadline_policy_json, reward_verification_json, rejection_codes_json FROM mission_agent_specialists WHERE agent_id=?', [input.agentId]);
  const digest = profileRulesDigest(profileFromRow(specialist, input.agentId, String(specialist?.platform_id ?? '')));
  const extra: Partial<Record<SpecialistState, string>> = { TRAINING: 'trained_at', SKILLS_VERIFIED: 'skills_verified_at' };
  const column = extra[input.to];
  db.run(`UPDATE mission_agent_specialists SET state=?, state_reason=?, state_evidence_json=?, updated_at=?${column ? `, ${column}=?` : ''} WHERE agent_id=?`,
    column ? [input.to, input.reason.slice(0, 900), json({ gates: 'passed' }), now, now, input.agentId] as SqlValue[]
      : [input.to, input.reason.slice(0, 900), json({ gates: 'passed' }), now, input.agentId] as SqlValue[]);
  if (input.to === 'SKILLS_VERIFIED') {
    const verdict = skillVerificationState(input.agentId, String(specialist?.platform_id ?? ''), digest);
    db.run('UPDATE mission_agent_specialists SET skill_level=? WHERE agent_id=?', [Math.max(0, Math.min(100, Number(verdict.score ?? 0))), input.agentId] as SqlValue[]);
  }
  db.run('INSERT INTO mission_agent_state_transitions (id,agent_id,from_state,to_state,reason,evidence_digest,actor_type,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [missionId('strn'), input.agentId, from, input.to, input.reason.slice(0, 900), digest, input.actor.kind, input.actor.id, now] as SqlValue[]);
  upsertFleetState(input.agentId, input.to, gates, now, input.actor);
  appendMissionAudit({ actorType: input.actor.kind, actorId: input.actor.id, action: `specialist.state.${input.to.toLowerCase()}`, subjectType: 'agent', subjectId: input.agentId, detail: { from, reason: input.reason.slice(0, 240) } });
  return { from, to: input.to, enforced: true };
}

function upsertFleetState(agentId: string, state: FleetState, gates: GateReport, now: string, actor: MoneyActor): void {
  const assignment = db.get<Row>("SELECT platform_id FROM mission_agent_platform_assignments WHERE agent_id=? AND slot_type='primary' AND status='active'", [agentId]);
  db.run(`INSERT OR REPLACE INTO mission_agent_fleet_states (agent_id,state,platform_id,reasons_json,owner_actions_json,evidence_digest,refreshed_at,refreshed_by)
    VALUES (?,?,?,?,?,?,?,?)`, [
    agentId, state, assignment?.platform_id ?? null, json(gates.blockers), json(gates.ownerActions),
    sha256(json({ state, blockers: gates.blockers, actions: gates.ownerActions })).slice(0, 32), now, `${actor.kind}:${actor.id}`,
  ] as SqlValue[]);
}

/**
 * Refresh every registered agent's readiness from rows only: assigned agents get their gate
 * re-evaluated, and unassigned agents are recorded as `UNASSIGNED_PLATFORM` with the reason being
 * that no distinct verified venue is left for them. No agent is invented, and none is dropped.
 */
export function refreshFleetStates(actor: MoneyActor, options: { readonly limit?: number } = {}): {
  readonly scanned: number; readonly assigned: number; readonly unassigned: number; readonly counts: Record<string, number>;
} {
  const limit = options.limit ?? 5000;
  const agents = db.all<Row>(`SELECT id FROM mission_agents WHERE (origin_platform IS NULL OR origin_platform NOT IN ('fixture','test','test_fixture')) ORDER BY id LIMIT ?`, [limit]) ?? [];
  const assignments = new Map((db.all<Row>("SELECT agent_id, platform_id FROM mission_agent_platform_assignments WHERE slot_type='primary' AND status='active'") ?? []).map(row => [String(row.agent_id), String(row.platform_id)]));
  const counts: Record<string, number> = {};
  const now = nowIso();
  let unassigned = 0;
  // One summary read for the whole pass: gates that reach out to `readinessFor` are expensive,
  // so they run only for the handful of agents that have actually reached the upper ladder.
  const openVenues = catalogSummary({ maxAgeDays: EVIDENCE_MAX_AGE_DAYS }).counts.assignable ?? 0;
  const unassignedReason = `no_unassigned_verifiable_platform_left: ${assignments.size} agents hold the ${openVenues} venues verified open today, and the registry has no further venue whose evidence says it is open`;
  for (const agent of agents) {
    const agentId = String(agent.id);
    const platformId = assignments.get(agentId);
    const specialist = db.get<Row>('SELECT state FROM mission_agent_specialists WHERE agent_id=?', [agentId]);
    let state: FleetState;
    let gates: GateReport = { blockers: [], ownerActions: [] };
    if (!platformId) {
      state = 'UNASSIGNED_PLATFORM';
      unassigned++;
      gates = {
        blockers: [assignments.size >= openVenues ? unassignedReason : 'not_yet_mapped: no specialist assignment has been recorded against this agent yet'],
        ownerActions: ['approve additional verified venues, or accept that these agents stay unassigned — the fleet is not padded to a number'],
      };
    } else {
      state = (specialist ? String(specialist.state) : 'PLATFORM_ASSIGNED') as SpecialistState;
      const rank = (STATE_LADDER as readonly string[]).indexOf(state);
      if (rank >= STATE_LADDER.indexOf('SKILLS_VERIFIED')) gates = evaluateGates(agentId, state as SpecialistState);
    }
    upsertFleetState(agentId, state, gates, now, actor);
    counts[state] = (counts[state] ?? 0) + 1;
  }
  appendMissionAudit({ actorType: actor.kind, actorId: actor.id, action: 'specialist.fleet.refreshed', subjectType: 'fleet', subjectId: 'states', detail: { scanned: agents.length, assigned: assignments.size, unassigned, counts } });
  return { scanned: agents.length, assigned: assignments.size, unassigned, counts };
}

export interface RankedOpportunity {
  readonly key: string; readonly title: string; readonly url: string | null;
  readonly reward_usd_cents: number; readonly funding_verified: boolean; readonly priority: number;
  readonly factors: Record<string, number | string | null>; readonly blockers: string[];
  /** The registry opportunity class of the paired venue, recorded so the specialty gate can be
   *  re-checked later without re-deriving it from the venue label. */
  readonly opportunity_class: string | null;
}

/**
 * Priority is computed from what is *known*, and unknown is scored as unknown. A capped,
 * documented formula beats a vague ranking: the factors are stored next to the score so the
 * ordering can be argued with later.
 */
export function rankOpportunityQueue(input: { readonly actor: MoneyActor; readonly agentId: string; readonly limit?: number }): {
  readonly rows: RankedOpportunity[]; readonly written: number; readonly registryRows: number; readonly note: string | null;
} {
  const specialist = db.get<Row>('SELECT platform_id, specialty_key FROM mission_agent_specialists WHERE agent_id=?', [input.agentId]);
  if (!specialist) deny('specialist_profile_missing', input.agentId);
  const platformId = String(specialist!.platform_id);
  const specialtyKey = String(specialist!.specialty_key);
  const record = platformRecordFor(platformId);
  // The class comes from the verified catalog record for the paired venue, never from the
  // opportunity's own wording: a specialist may only be ranked into work its specialty covers.
  const opportunityClass = record?.opportunityClass ?? null;
  const fitsSpecialty = isSpecialtyFit(specialtyKey, opportunityClass);
  const limit = input.limit ?? 25;
  const registry = db.all<Row>(
    `SELECT * FROM mission_opportunities WHERE platform=? AND status IN ('pending_review','verified') ORDER BY created_at DESC LIMIT ?`,
    [record ? record.label : platformId, limit * 2],
  ) ?? [];
  const rows: RankedOpportunity[] = [];
  for (const opportunity of registry) {
    const blockers: string[] = [];
    const status = String(opportunity.status);
    const fundingVerified = status === 'verified';
    if (!fundingVerified) blockers.push('funding_unverified: the registry row has not been verified against the venue');
    const automation = String(opportunity.automation_permission ?? 'conditional');
    if (automation === 'disallowed') blockers.push('automation_disallowed_by_source');
    const reward = Number(opportunity.payout_max_cents ?? 0);
    if (!(reward > 0)) blockers.push('no_stated_reward: an advertised range with no floor is not income');
    const skills = parse<string[]>(opportunity.skills as string, []);
    const fitScore = record ? Math.min(25, skills.length * 5) : 0;
    const eligibility = parse<string[]>(opportunity.country_eligibility as string, []).length ? 'declared' : 'unknown';
    if (eligibility === 'unknown') blockers.push('eligibility_unread');
    if (!fitsSpecialty) blockers.push(`specialty_mismatch: ${describeSpecialty(specialtyKey)} does not cover ${opportunityClass ?? 'an unclassified venue'}`);
    const rewardWeight = Math.min(35, Math.round((Math.min(reward, 500_000) / 500_000) * 35));
    const priority = (fundingVerified ? 30 : 0) + rewardWeight + fitScore + (automation === 'allowed' ? 5 : 0);
    rows.push({
      key: String(opportunity.id), title: String(opportunity.title).slice(0, 240),
      url: opportunity.source_url ? String(opportunity.source_url) : null,
      reward_usd_cents: reward, funding_verified: fundingVerified, priority,
      factors: { funding_verified: fundingVerified ? 1 : 0, reward_weight: rewardWeight, fit: fitScore, automation, competition: 'unmeasured', deadline: null, effort: String(opportunity.risk_level ?? 'unknown') },
      opportunity_class: opportunityClass,
      blockers,
    });
  }
  rows.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
  const top = rows.slice(0, limit);
  const now = nowIso();
  let rank = 1;
  for (const row of top) {
    db.run(`INSERT OR REPLACE INTO mission_specialist_opportunities
      (id,agent_id,platform_id,opportunity_key,title,url,reward_usd_cents,funding_verified,eligibility,deadline_at,competition,effort,fit_score,priority_score,factors_json,rank,state,blockers_json,opportunity_class,ranked_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      missionId('sopp'), input.agentId, platformId, row.key, row.title, row.url, row.reward_usd_cents, row.funding_verified ? 1 : 0,
      String(row.factors.eligibility ?? 'unknown'), null, String(row.factors.competition), String(row.factors.effort), Number(row.factors.fit ?? 0), row.priority,
      json(row.factors), rank, row.blockers.length ? 'blocked' : 'candidate', json(row.blockers), row.opportunity_class, now, now, now,
    ] as SqlValue[]);
    rank++;
  }
  appendMissionAudit({ actorType: input.actor.kind, actorId: input.actor.id, action: 'specialist.queue.ranked', subjectType: 'agent', subjectId: input.agentId, detail: { platform: platformId, candidates: registry.length, ranked: top.length } });
  // An empty queue from an empty registry and an empty queue from a populated one are different
  // facts, and reporting them identically would hide whether discovery has run at all.
  const note = registry.length === 0
    ? `registry_empty: no opportunity row exists for ${record ? record.label : platformId} yet, so there is nothing to rank — run discovery, do not manufacture a queue`
    : (top.length === 0 ? 'all_candidates_filtered' : null);
  return { rows: top, written: top.length, registryRows: registry.length, note };
}

/** Only the owner may put work onto a specialist's plate; that is the assignment gate. */
export function assignOpportunity(input: { readonly actor: MoneyActor; readonly agentId: string; readonly opportunityKey: string }): { assigned: boolean; blockers: string[] } {
  if (input.actor.kind !== 'owner') deny('specialist_assignment_owner_only', 'placing work on a specialist is an owner decision');
  const row = db.get<Row>(
    `SELECT o.id, o.blockers_json, o.opportunity_class AS opportunityClass, s.specialty_key AS specialtyKey
       FROM mission_specialist_opportunities o
       LEFT JOIN mission_agent_specialists s ON s.agent_id = o.agent_id
      WHERE o.agent_id=? AND o.opportunity_key=?`,
    [input.agentId, input.opportunityKey],
  );
  if (!row) deny('specialist_opportunity_unranked', input.opportunityKey);
  const blockers = parse<string[]>(row!.blockers_json as string, []);
  if (blockers.length) deny('specialist_opportunity_blocked', blockers.join('; '));
  // Specialty is not decoration: an agent may only be handed work its registered specialty
  // covers. A missing class is refused rather than waved through, so a row ranked before the
  // class was recorded has to be re-ranked instead of quietly assigned.
  const specialtyKey = row!.specialtyKey ? String(row!.specialtyKey) : null;
  if (!specialtyKey) deny('specialist_profile_missing', input.agentId);
  const opportunityClass = row!.opportunityClass ? String(row!.opportunityClass) : null;
  if (!opportunityClass) deny('specialist_opportunity_unclassified', 'rank the queue again so the venue class is recorded; no class, no fit check');
  if (!isSpecialtyFit(specialtyKey, opportunityClass)) {
    deny('specialist_specialty_mismatch', `${describeSpecialty(specialtyKey)} cannot be assigned ${opportunityClass} work`);
  }
  // Checked at EXECUTION_READY, not WORKING: being handed an opportunity is what makes the
  // WORKING state reachable, so requiring it here would deadlock the sequence.
  const gates = evaluateGates(input.agentId, 'EXECUTION_READY');
  if (gates.blockers.length) deny('specialist_not_execution_ready', gates.blockers.join('; '));
  db.run("UPDATE mission_specialist_opportunities SET state='assigned', updated_at=? WHERE id=?", [nowIso(), String(row!.id)] as SqlValue[]);
  appendMissionAudit({ actorType: 'owner', actorId: input.actor.id, action: 'specialist.opportunity.assigned', subjectType: 'agent', subjectId: input.agentId, detail: { opportunity: input.opportunityKey } });
  return { assigned: true, blockers: [] };
}

export type OutcomeKind = 'delivered' | 'accepted' | 'rejected_invalid' | 'rejected_duplicate' | 'rejected_spam' | 'rejected_other' | 'no_response' | 'payment_verified';
const REJECTION_OUTCOMES: readonly OutcomeKind[] = ['rejected_invalid', 'rejected_duplicate', 'rejected_spam', 'rejected_other'];

/**
 * Record what the venue actually said. Acceptance and rejection are facts from the outside, so an
 * agent cannot mark its own work accepted, and payment is only recorded when a durable settlement
 * verification with that external reference exists. Nothing here writes the ledger.
 */
export function recordOutcome(input: {
  readonly actor: MoneyActor; readonly agentId: string; readonly opportunityKey: string; readonly outcome: OutcomeKind;
  readonly detail?: string; readonly evidenceRef?: string; readonly programId?: string; readonly reasonCode?: string;
}): { recorded: boolean; skillLevel: number; lessonRecorded: boolean } {
  const row = db.get<Row>('SELECT id, state, platform_id FROM mission_specialist_opportunities WHERE agent_id=? AND opportunity_key=?', [input.agentId, input.opportunityKey]);
  if (!row) deny('specialist_opportunity_unranked', input.opportunityKey);
  if (input.outcome === 'accepted' && input.actor.kind !== 'owner') deny('specialist_acceptance_needs_owner_evidence', 'acceptance must be reported by the owner from the venue, not asserted by the fleet');
  if (input.outcome === 'payment_verified') {
    if (input.actor.kind !== 'owner') deny('specialist_payment_owner_only');
    const reference = String(input.evidenceRef ?? '').trim();
    if (!reference) deny('specialist_payment_evidence_missing', 'a settlement reference is required before any payment is recorded');
    const proof = db.get<Row>('SELECT id FROM mission_settlement_verifications WHERE external_id=? AND verified=1 LIMIT 1', [reference]);
    if (!proof) deny('specialist_payment_evidence_unverifiable', 'no verified settlement record carries that reference; revenue stays at zero until one does');
  }
  const now = nowIso();
  const state = input.outcome === 'accepted' || input.outcome === 'payment_verified' ? 'delivered' : (REJECTION_OUTCOMES.includes(input.outcome) ? 'dropped' : 'delivered');
  // The verified settlement reference is stored on the opportunity, so the per-agent record can be
  // rebuilt from evidence years later instead of trusting a metric written at the same moment.
  const reference = input.outcome === 'payment_verified' ? String(input.evidenceRef ?? '').trim() : null;
  db.run('UPDATE mission_specialist_opportunities SET state=?, payment_reference=COALESCE(?, payment_reference), updated_at=? WHERE id=?',
    [state, reference, now, String(row!.id)] as SqlValue[]);

  let lessonRecorded = false;
  if (REJECTION_OUTCOMES.includes(input.outcome)) {
    const reasonCode = String(input.reasonCode ?? input.outcome).slice(0, 80);
    db.run('INSERT INTO bounty_rejection_lessons (id,program_id,finding_id,platform_key,reason_code,reason_detail,fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?)', [
      missionId('rej'), input.programId ?? null, null, String(row!.platform_id),
      reasonCode, String(input.detail ?? 'no detail supplied').slice(0, 900),
      sha256(`${input.agentId}|${input.opportunityKey}|${reasonCode}`), now,
    ] as SqlValue[]);
    lessonRecorded = true;
  }
  // Skill level moves only with a graded suite result, never with a self-declared outcome.
  const verdict = db.get<Row>("SELECT score FROM mission_specialist_evaluations WHERE agent_id=? AND passed=1 AND mode!='fixture' ORDER BY evaluated_at DESC LIMIT 1", [input.agentId]);
  const skillLevel = Math.max(0, Math.min(100, Number(verdict?.score ?? 0)));
  const metrics = parse<Record<string, number>>(db.get<Row>('SELECT metrics_json FROM mission_agent_specialists WHERE agent_id=?', [input.agentId])?.metrics_json as string, {});
  metrics[input.outcome] = Number(metrics[input.outcome] ?? 0) + 1;
  metrics.total_outcomes = Number(metrics.total_outcomes ?? 0) + 1;
  db.run('UPDATE mission_agent_specialists SET metrics_json=?, skill_level=?, updated_at=? WHERE agent_id=?', [json(metrics), skillLevel, now, input.agentId] as SqlValue[]);
  appendMissionAudit({
    actorType: input.actor.kind, actorId: input.actor.id, action: `specialist.outcome.${input.outcome}`, subjectType: 'agent', subjectId: input.agentId,
    detail: { opportunity: input.opportunityKey, lesson_recorded: lessonRecorded, evidence_ref: input.evidenceRef ? '[recorded]' : null },
  });
  return { recorded: true, skillLevel, lessonRecorded };
}

/** Owner-facing view: run the suites in deterministic mode for every assigned agent. */
export function certifyAgents(input: { readonly actor: MoneyActor; readonly agentIds?: readonly string[]; readonly limit?: number }): {
  readonly attempted: number; readonly passed: number; readonly failed: readonly { agentId: string; score: number; blockers: readonly string[] }[];
} {
  if (input.actor.kind !== 'owner') deny('specialist_certification_owner_only', 'a skill certificate is issued against owner-approved rules; agents cannot certify themselves');
  const ids = input.agentIds?.length ? input.agentIds.map(String)
    : (db.all<Row>('SELECT agent_id AS id FROM mission_agent_platform_assignments WHERE slot_type=\'primary\' AND status=\'active\' ORDER BY agent_id LIMIT ?', [input.limit ?? 50]) ?? []).map(row => String(row.id));
  const failed: { agentId: string; score: number; blockers: readonly string[] }[] = [];
  let passed = 0;
  for (const agentId of ids) {
    const specialist = db.get<Row>('SELECT platform_id, specialty_key, rules_json, skills_json, permissions_json, denied_permissions_json, deadline_policy_json, reward_verification_json, rejection_codes_json FROM mission_agent_specialists WHERE agent_id=?', [agentId]);
    if (!specialist) { failed.push({ agentId, score: 0, blockers: ['no_profile'] }); continue; }
    const profile = profileFromRow(specialist, agentId, String(specialist.platform_id));
    try {
      const outcome = runSpecialistEvaluation({ actor: input.actor, profile, mode: 'deterministic', applyState: true });
      if (outcome.passed) {
        setSpecialistState({ actor: input.actor, agentId, to: 'TRAINING', reason: `specialization started for ${profile.platformId}` });
        const moved = setSpecialistState({ actor: input.actor, agentId, to: 'SKILLS_VERIFIED', reason: `suite ${outcome.suiteKey} passed at score ${outcome.score}` });
        if (moved.to === 'SKILLS_VERIFIED') passed++;
        else failed.push({ agentId, score: outcome.score, blockers: [moved.to] });
      } else {
        failed.push({ agentId, score: outcome.score, blockers: outcome.failures.map(entry => `${entry.grader}:${entry.detail}`).slice(0, 6) });
      }
    } catch (error) {
      failed.push({ agentId, score: 0, blockers: [String((error as Error).message).slice(0, 200)] });
    }
  }
  return { attempted: ids.length, passed, failed };
}

/** The report the owner reads: coverage, states, the first executable opportunity, and what is owed. */
export function fleetReport(): {
  readonly generatedAt: string;
  readonly agents: { total: number; assigned: number; unassigned: number; withRecordedState: number; bySpecialty: Record<string, number> };
  readonly platforms: { catalog: number; assignable: number; assigned: number; byVerdict: Record<string, number> };
  readonly states: Record<string, number>;
  readonly evaluations: { suites: number; passed: number };
  readonly firstExecutable: { agentId: string; platformId: string; opportunityKey: string; title: string; priority: number; rewardUsdCents: number } | null;
  readonly blockers: Record<string, number>;
  /** Read-only view of the existing adapter surface for the assigned venues. The fleet never
   *  registers or mutates an adapter: that would change what a background worker does. */
  readonly adapters: { configured: number; total: number; statuses: Record<string, number>; note: string };
  readonly ownerActions: readonly { action: string; agents: number; platforms: readonly string[] }[];
  readonly revenue: { ledgerRevenueCents: number; settledProofs: number; note: string };
} {
  const states = db.all<Row>('SELECT state, COUNT(*) AS c FROM mission_agent_fleet_states GROUP BY state') ?? [];
  const stateCounts: Record<string, number> = {};
  for (const row of states) stateCounts[String(row.state)] = Number(row.c);
  const totalAgents = Number(db.get<Row>('SELECT COUNT(*) AS c FROM mission_agents')?.c ?? 0);
  const recordedStates = Number(db.get<Row>('SELECT COUNT(*) AS c FROM mission_agent_fleet_states')?.c ?? 0);
  const assigned = Number(db.get<Row>("SELECT COUNT(*) AS c FROM mission_agent_platform_assignments WHERE slot_type='primary' AND status='active'")?.c ?? 0);
  const bySpecialty: Record<string, number> = {};
  for (const row of db.all<Row>("SELECT specialty_key, COUNT(*) AS c FROM mission_agent_platform_assignments WHERE status='active' GROUP BY specialty_key") ?? []) bySpecialty[String(row.specialty_key)] = Number(row.c);
  const summary = catalogSummary({ maxAgeDays: EVIDENCE_MAX_AGE_DAYS });
  const byVerdict: Record<string, number> = {};
  for (const row of summary.rows) byVerdict[row.verdict] = (byVerdict[row.verdict] ?? 0) + 1;
  const blockers: Record<string, number> = {};
  // One line per distinct owner action, with how many agents it covers: ten copies of the same
  // sentence is noise, and the number of agents waiting on it is the part that matters.
  const actionIndex = new Map<string, { action: string; agents: number; platforms: Set<string> }>();
  for (const row of db.all<Row>('SELECT state, platform_id, reasons_json, owner_actions_json FROM mission_agent_fleet_states') ?? []) {
    for (const reason of parse<string[]>(row.reasons_json as string, [])) {
      const key = reason.split(':')[0].slice(0, 80);
      blockers[key] = (blockers[key] ?? 0) + 1;
    }
    for (const action of parse<string[]>(row.owner_actions_json as string, [])) {
      const entry = actionIndex.get(action) ?? { action, agents: 0, platforms: new Set<string>() };
      entry.agents++;
      if (row.platform_id) entry.platforms.add(String(row.platform_id));
      actionIndex.set(action, entry);
    }
  }
  const ownerActions = [...actionIndex.values()].sort((a, b) => b.agents - a.agents)
    .map(entry => ({ action: entry.action, agents: entry.agents, platforms: [...entry.platforms].slice(0, 6) }));
  const assignedPlatforms = (db.all<Row>("SELECT DISTINCT platform_id AS id FROM mission_agent_platform_assignments WHERE status='active'") ?? []).map(row => String(row.id));
  const adapterRows = assignedPlatforms.length
    ? (db.all<Row>(`SELECT platform_key, adapter_status, category FROM platform_adapters WHERE platform_key IN (${assignedPlatforms.map(() => '?').join(',')})`, assignedPlatforms) ?? [])
    : [];
  const adapterStatuses: Record<string, number> = {};
  for (const row of adapterRows) adapterStatuses[String(row.adapter_status)] = (adapterStatuses[String(row.adapter_status)] ?? 0) + 1;

  const first = db.get<Row>(
    `SELECT o.agent_id AS agentId, o.platform_id AS platformId, o.opportunity_key AS opportunityKey, o.title AS title, o.priority_score AS priority, o.reward_usd_cents AS reward
       FROM mission_specialist_opportunities o JOIN mission_agent_specialists s ON s.agent_id = o.agent_id
      WHERE o.state='candidate' AND s.state IN ('EXECUTION_READY','WORKING') ORDER BY o.priority_score DESC, o.rank ASC LIMIT 1`,
  );
  const revenueCents = Number(db.get<Row>("SELECT COALESCE(SUM(amount_cents),0) AS c FROM mission_ledger WHERE direction='credit' AND category='revenue'")?.c ?? 0);
  const proofs = Number(db.get<Row>('SELECT COUNT(*) AS c FROM mission_settlement_verifications WHERE verified=1')?.c ?? 0);
  const evaluations = db.get<Row>('SELECT COUNT(*) AS suites, COALESCE(SUM(passed),0) AS p FROM mission_specialist_evaluations WHERE mode!=\'fixture\'');
  return {
    generatedAt: nowIso(),
    agents: { total: totalAgents, assigned, unassigned: Math.max(0, totalAgents - assigned), withRecordedState: recordedStates, bySpecialty },
    platforms: { catalog: summary.rows.length, assignable: summary.counts.assignable ?? 0, assigned, byVerdict },
    states: stateCounts,
    evaluations: { suites: Number(evaluations?.suites ?? 0), passed: Number(evaluations?.p ?? 0) },
    firstExecutable: first ? {
      agentId: String(first.agentId), platformId: String(first.platformId), opportunityKey: String(first.opportunityKey),
      title: String(first.title), priority: Number(first.priority), rewardUsdCents: Number(first.reward),
    } : null,
    blockers,
    ownerActions: ownerActions.slice(0, 20),
    adapters: {
      configured: adapterRows.length, total: assignedPlatforms.length, statuses: adapterStatuses,
      note: 'Adapters are read from the existing registry; none was created or changed by the fleet.',
    },
    revenue: { ledgerRevenueCents: revenueCents, settledProofs: proofs, note: 'Ledger revenue and settlement proofs only; advertised venue rewards are never counted here.' },
  };
}

/**
 * What the discovery registry actually covers, per opportunity family. The fleet is meant to keep
 * all seven families fresh, so coverage is reported from the stored evidence rather than asserted
 * from the constant: a family with no venue, or with venues whose readings have gone stale, shows
 * up here as a gap instead of being hidden by the list of categories.
 */
export function registryCoverage(options: { readonly now?: () => Date; readonly maxAgeDays?: number } = {}): {
  readonly categories: { category: string; how: string; venues: number; assignable: number; stale: number }[];
  readonly uncovered: readonly string[];
} {
  const maxAgeDays = options.maxAgeDays ?? EVIDENCE_MAX_AGE_DAYS;
  // The injected clock reaches the staleness check itself, so a test can move "today" instead of
  // merely observing whatever the summary happened to compute.
  const now = options.now ?? (() => new Date());
  const summary = catalogSummary({ maxAgeDays, now }).rows;
  const assignable = new Set(summary.filter(row => row.assignable).map(row => row.catalogId));
  const categories = DISCOVERY_CATEGORIES.map(entry => {
    const rows = summary.filter(row => {
      const evidence = latestEvidence(row.catalogId);
      if (!evidence) return false;
      const facts = parse<{ category?: string }>(evidence.facts_json as string, {});
      return facts.category === entry.category;
    });
    return {
      category: entry.category,
      how: entry.how,
      venues: rows.length,
      assignable: rows.filter(row => assignable.has(row.catalogId)).length,
      stale: rows.filter(row => row.blockingReasons.includes('verification_stale')).length,
    };
  });
  return { categories, uncovered: categories.filter(entry => entry.assignable === 0).map(entry => entry.category) };
}

/**
 * The per-agent record the owner asked for: specialty, work done, evidence, verified outcomes and
 * earnings — every number counted from stored rows, none remembered from a prompt. `earningsCents`
 * only ever moves with a verified settlement record, so an agent that completed work but was not
 * paid shows the work and $0.
 */
export function specialistRecord(agentId: string): {
  readonly agentId: string;
  readonly specialtyKey: string | null;
  readonly specialtyLabel: string;
  readonly workKinds: readonly string[];
  readonly platformId: string | null;
  readonly state: string | null;
  readonly skillLevel: number;
  readonly work: { readonly ranked: number; readonly assigned: number; readonly delivered: number; readonly dropped: number };
  readonly evidence: { readonly gradedSuites: number; readonly passedSuites: number; readonly transitions: number; readonly venueRejections: number };
  readonly verified: { readonly accepted: number; readonly paymentProofs: number };
  readonly earningsCents: number;
  readonly earningsBasis: string;
} {
  const specialist = db.get<Row>(
    'SELECT platform_id, specialty_key, skill_level, state, metrics_json FROM mission_agent_specialists WHERE agent_id=?',
    [agentId],
  );
  const specialtyKey = specialist ? String(specialist.specialty_key) : null;
  const definition = specialtyFor(specialtyKey);
  const metrics = parse<Record<string, number>>(specialist?.metrics_json as string, {});
  const counts = (sql: string, params: SqlValue[] = [agentId]) => Number(db.get<Row>(sql, params)?.c ?? 0);
  const work = {
    ranked: counts('SELECT COUNT(*) AS c FROM mission_specialist_opportunities WHERE agent_id=?'),
    assigned: counts("SELECT COUNT(*) AS c FROM mission_specialist_opportunities WHERE agent_id=? AND state='assigned'"),
    delivered: counts("SELECT COUNT(*) AS c FROM mission_specialist_opportunities WHERE agent_id=? AND state='delivered'"),
    dropped: counts("SELECT COUNT(*) AS c FROM mission_specialist_opportunities WHERE agent_id=? AND state='dropped'"),
  };
  const platformId = specialist ? String(specialist.platform_id) : null;
  const evidence = {
    gradedSuites: counts("SELECT COUNT(*) AS c FROM mission_specialist_evaluations WHERE agent_id=? AND mode!='fixture'"),
    passedSuites: counts("SELECT COUNT(*) AS c FROM mission_specialist_evaluations WHERE agent_id=? AND passed=1 AND mode!='fixture'"),
    transitions: counts('SELECT COUNT(*) AS c FROM mission_agent_state_transitions WHERE agent_id=?'),
    venueRejections: counts('SELECT COUNT(*) AS c FROM bounty_rejection_lessons WHERE platform_key=?', [platformId ?? ''] as SqlValue[]),
  };
  // A payment counts once, and only through the reference `recordOutcome` refused to invent: the
  // settlement row has to exist and be verified. Anything else stays zero.
  const proofSql = `SELECT COUNT(*) AS c FROM mission_specialist_opportunities o
                      WHERE o.agent_id=? AND o.payment_reference IS NOT NULL
                        AND EXISTS (SELECT 1 FROM mission_settlement_verifications v
                                     WHERE v.external_id = o.payment_reference AND v.verified = 1)`;
  const verified = { accepted: Number(metrics.accepted ?? 0), paymentProofs: counts(proofSql) };
  const earnings = Number(db.get<Row>(`SELECT COALESCE(SUM(o.reward_usd_cents),0) AS c FROM mission_specialist_opportunities o
                     WHERE o.agent_id=? AND o.state='delivered' AND o.payment_reference IS NOT NULL
                       AND EXISTS (SELECT 1 FROM mission_settlement_verifications v
                                    WHERE v.external_id = o.payment_reference AND v.verified = 1)`, [agentId] as SqlValue[])?.c ?? 0);
  return {
    agentId,
    specialtyKey,
    specialtyLabel: definition?.label ?? 'unassigned specialty',
    workKinds: definition ? [...definition.does] : [],
    platformId,
    state: specialist ? String(specialist.state) : null,
    skillLevel: Number(specialist?.skill_level ?? 0),
    work,
    evidence,
    verified,
    earningsCents: earnings,
    earningsBasis: 'sum of rewards on delivered opportunities whose recorded payment reference has a verified settlement row; advertised rewards and self-declared outcomes never count',
  };
}

/** Every specialist with a pairing, oldest pairing first — the owner's roster view. */
export function listSpecialistRecords(input: { readonly limit?: number } = {}): {
  readonly records: readonly ReturnType<typeof specialistRecord>[];
  readonly total: number;
} {
  const rows = db.all<Row>(
    'SELECT agent_id AS id FROM mission_agent_specialists ORDER BY created_at ASC, agent_id ASC LIMIT ?',
    [input.limit ?? 50] as SqlValue[],
  ) ?? [];
  return { records: rows.map(row => specialistRecord(String(row.id))), total: Number(db.get<Row>('SELECT COUNT(*) AS c FROM mission_agent_specialists')?.c ?? 0) };
}

/** Agents whose venue is verified but whose account grouping the owner has not authorized. */
export function groupingGaps(): { platformId: string; gmailGroup: string; specialists: number }[] {
  const rows = db.all<Row>(
    `SELECT a.platform_id AS platformId, a.gmail_group AS gmailGroup, COUNT(*) AS c
       FROM mission_agent_platform_assignments a JOIN mission_agent_specialists s ON s.agent_id = a.agent_id
      WHERE a.status='active' AND s.state='NEEDS_OWNER_ACTION' GROUP BY a.platform_id, a.gmail_group`,
  ) ?? [];
  return rows.map(row => ({ platformId: String(row.platformId), gmailGroup: String(row.gmailGroup ?? ''), specialists: Number(row.c) }));
}
