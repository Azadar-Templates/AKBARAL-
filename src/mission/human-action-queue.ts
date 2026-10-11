/**
 * ZA141251SA HUMAN-ACTION QUEUE — the owner's side of `mission_human_action_tasks`.
 *
 * WHY THIS FILE EXISTS. `mission_human_action_tasks` is the queue an agent writes to when it hits a
 * human-only action, and `owner_action_pending` in `earning/fleet-readiness.ts` is computed from its open
 * rows (`:179` per agent, `:248` globally). The queue had two writers and NO owner-side reader: nothing in
 * the mission server listed the rows, and the only callers of `resolveHumanActionTask`
 * (`human-action-gate.ts:98`) in the whole tree are a test and the public app's read-only BOSS dashboard
 * (`src/routes/boss-dashboard.ts:332`). So production could report "clear the 2 open task(s) in the
 * Approvals queue" while the console had no queue to open and no button to press — a blocker whose remedy
 * was an invisible control is a circle the owner cannot break by hand.
 *
 * WHAT THIS MODULE IS. A view plus two owner-only decisions, and nothing else:
 *
 *   · it LISTS open tasks with the exact subject each one refers to, resolved from stored columns — for a
 *     contract-batch task that means the class and how many proposals are still pending for it;
 *   · it RESOLVES through the existing gate module (`resolveHumanActionTask`), so the status transition,
 *     the `completed_by` attribution and the `human_action.resolved` audit row stay the ones every other
 *     caller already produces. Task handling is not reimplemented here;
 *   · approving a contract-batch task grants the batch **through the existing contract module**
 *     (`approveAllClassContractProposals` — the same function the CLI and the contracts block call), so the
 *     owner still has to repeat back the exact permission surface and a proposal whose set is empty or
 *     wider than its class is still refused. If nothing is genuinely pending, nothing is granted;
 *   · a task whose subject has gone is reported `stale` and the owner may close it, but the system never
 *     closes it on its own — no sweeper, no timer, no `expired` write;
 *   · rejecting needs a short recorded reason, touches no contract, and is all-or-nothing: the task update
 *     and its audit row commit together or not at all.
 *
 * What it never does: no agent identity may approve, reject or bulk-resolve anything here; no task row is
 * deleted (its audit trail outlives it by design); and closing a task is never described as evidence that
 * some human action happened outside this system — an attestation is labelled as one.
 */

import { missionDb as db, appendMissionAudit, type Row } from './database';
import { resolveHumanActionTask, HUMAN_ACTION_TYPES, type HumanActionTask } from './human-action-gate';
import { assertMoneyOwner, MoneyError, type MoneyActor } from './money';
import {
  MAX_PROPOSALS_PER_BATCH,
  approveAllClassContractProposals,
  classContractDefinition,
  contractSurface,
} from './earning/agent-class-contracts';
import { ownerActivationPath } from './earning/fleet-readiness';

/** The two shapes a task's `reason` can have, because these are the only two writers in the product. */
const CONTRACT_BATCH_REASON = /prepared for class '([a-z_]+)' and await owner approval/;
const ROLLUP_NOTE = /^fleet-readiness:([a-z_]+)/;
const ROLLUP_REASON = /^\[([a-z_]+)\]\s/;

/** The longest reason an owner may record, and the shortest that counts as a decision rather than a shrug. */
const REASON_MIN = 4;
const REASON_MAX = 500;
const LIST_LIMIT = 200;

type Surface = ReturnType<typeof contractSurface>;

type Subject =
  | {
      kind: 'contract-batch';
      waitingFor: string;
      agentClass: string;
      pending: number;
      /** Pending proposal ids for this class, capped — a pointer, not a dump. */
      proposalIds: string[];
      surface: Surface | null;
      stale: boolean;
    }
  | {
      kind: 'fleet-gate';
      waitingFor: string;
      gateCode: string;
      /** From the real activation path, never from a reimplementation. `null` = could not be read. */
      gateCleared: boolean | null;
      stale: boolean | null;
    }
  | {
      kind: 'unlinked';
      waitingFor: string;
      stale: null;
    };

export interface QueueItem {
  taskId: string;
  actionType: string;
  actionLabel: string;
  agentId: string;
  opportunityId: string | null;
  reason: string;
  raisedAt: string;
  notes: string | null;
  /** True when an owner decision here can change something real — a batch still waiting to be granted. */
  actionable: boolean;
  subject: Subject;
  /** What clicking Approve would actually do — stated before the click, not after. */
  approveEffect: string;
  /** What clicking Reject would actually do. Same for every kind: cancel the marker, change nothing else. */
  rejectEffect: string;
}

function refuse(code: string, detail?: string, statusCode = 409): never {
  throw new MoneyError(code, detail ? `${code}: ${detail}` : code, statusCode);
}

/** True pending-proposal count per class, in one aggregate query — the view never walks the fleet per agent. */
function truePendingCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of db.all<Row>(
    "SELECT agent_class, COUNT(*) AS c FROM mission_agent_contract_proposals WHERE status='pending' GROUP BY agent_class",
  )) {
    counts.set(String(row.agent_class), Number(row.c));
  }
  return counts;
}

/** The proposal rows needed to show what a batch would grant, bounded per class by the module's own cap. */
function pendingByClass(): Map<string, Row[]> {
  const byClass = new Map<string, Row[]>();
  // `SELECT *`, not a projection: the surface digest the owner is asked to confirm is computed by
  // `contractSurface` from the stored columns, and a trimmed row would produce a different digest than the
  // one the module computes at approval time — which would make every confirmation fail closed for the
  // wrong reason.
  const rows = db.all<Row>(
    `SELECT * FROM mission_agent_contract_proposals
      WHERE status='pending' ORDER BY agent_class, requested_at, id LIMIT ?`,
    [MAX_PROPOSALS_PER_BATCH * 12],
  );
  for (const row of rows) {
    const key = String(row.agent_class);
    const bucket = byClass.get(key) ?? [];
    if (bucket.length < MAX_PROPOSALS_PER_BATCH) bucket.push(row);
    byClass.set(key, bucket);
  }
  return byClass;
}

/**
 * Live gate state, read once per view, straight from the activation path that produced the blocker.
 * `null` on failure so the queue reports the subject as unreadable instead of guessing it is still open.
 */
function gateStates(): Map<string, boolean> | null {
  try {
    const map = new Map<string, boolean>();
    for (const entry of ownerActivationPath().all) map.set(String(entry.code), Boolean(entry.cleared));
    return map;
  } catch {
    return null;
  }
}

const ACTION_LABELS = HUMAN_ACTION_TYPES as unknown as Record<string, string>;

function labelFor(actionType: string): string {
  const key = String(actionType ?? '');
  const label = ACTION_LABELS[key.toUpperCase()] ?? null;
  if (label) return String(label).replace(/_/g, ' ');
  return key ? key.replace(/_/g, ' ') : 'unspecified human action';
}

function describe(task: Row, byClass: Map<string, Row[]>, counts: Map<string, number>, gates: Map<string, boolean> | null): QueueItem {
  const actionType = String(task.action_type ?? '');
  const reason = String(task.reason ?? '');
  const notes = task.notes == null ? null : String(task.notes);
  const base = {
    taskId: String(task.id),
    actionType,
    actionLabel: labelFor(actionType),
    agentId: String(task.agent_id),
    opportunityId: task.opportunity_id ? String(task.opportunity_id) : null,
    reason,
    raisedAt: String(task.created_at),
    notes,
  };

  const rollup = (notes ?? '').match(ROLLUP_NOTE) ?? reason.match(ROLLUP_REASON);
  if (rollup) {
    const gateCode = String(rollup[1]);
    const cleared = gates ? gates.get(gateCode) ?? null : null;
    return {
      ...base,
      actionable: false,
      subject: {
        kind: 'fleet-gate',
        gateCode,
        gateCleared: cleared,
        stale: cleared === null ? null : cleared,
        waitingFor: cleared === null
          ? `a global gate (${gateCode}) this entry was filed to describe. Its live state could not be read, so it is reported as unreadable rather than assumed`
          : cleared
            ? `nothing: the ${gateCode} gate reports itself cleared, so this entry is a leftover description of it`
            : `the ${gateCode} gate itself, which is still not satisfied. This entry records the gate; it is not the gate`,
      },
      approveEffect: `closes this entry only. It records that the owner reviewed it — it does not change the ${gateCode} gate and does not mark it satisfied, and the blocker stays exactly as the gate reports it`,
      rejectEffect: 'cancels this entry with the reason recorded. The gate and every blocker derived from it are untouched',
    };
  }

  const batch = reason.match(CONTRACT_BATCH_REASON);
  if (batch) {
    const agentClass = String(batch[1]);
    const pending = counts.get(agentClass) ?? 0;
    const proposals = byClass.get(agentClass) ?? [];
    const definition = classContractDefinition(agentClass);
    const surface = definition && proposals.length > 0 ? contractSurface(agentClass, proposals) : null;
    return {
      ...base,
      actionable: pending > 0,
      subject: {
        kind: 'contract-batch',
        agentClass,
        pending,
        proposalIds: proposals.map(row => String(row.id)),
        surface,
        stale: pending === 0,
        waitingFor: pending > 0
          ? `${pending} scoped contract proposal(s) for class '${agentClass}' awaiting the owner's decision. Each one is a frozen permission set, and granting it is an owner act`
          : `nothing any more: no pending proposal exists for class '${agentClass}', so this entry describes a batch that was already granted, rejected or expired`,
      },
      approveEffect: pending > 0
        ? `approves those ${pending} proposal(s) through the contract module — the same path as "Approve all" in the Scoped agent contracts block, so it demands the exact surface digest and still refuses any proposal whose permission set is empty or wider than its class. Nothing is granted silently`
        : `closes this stale entry only. There is no pending proposal for ${agentClass}, so no contract row is created or changed by this click`,
      rejectEffect: pending > 0
        ? `cancels this entry with the reason recorded. The ${pending} pending proposal(s) stay pending and untouched: no contract is granted and none is refused on the owner's behalf`
        : 'cancels this entry with the reason recorded. Nothing else changes',
    };
  }

  return {
    ...base,
    actionable: false,
    subject: {
      kind: 'unlinked',
      stale: null,
      waitingFor: 'an owner decision about something this entry does not link to a machine-readable subject. Its own text is the only record: read it before deciding',
    },
    approveEffect: 'records that the owner completed this human action. It is an attestation by whoever clicked, with no evidence attached — nothing in the fleet, wallet or ledger changes',
    rejectEffect: 'cancels this entry with the reason recorded. Nothing else changes',
  };
}

function loadPending(taskId: string): Row {
  const id = String(taskId ?? '').trim();
  if (!id) refuse('task_id_required', 'a task id is required');
  const task = db.get<Row>('SELECT * FROM mission_human_action_tasks WHERE id = ?', [id]);
  if (!task) refuse('task_not_found', `no human-action task ${id} exists — an entry that was never filed cannot be decided`, 404);
  if (String(task.status) !== 'pending') {
    refuse('task_not_pending', `task ${id} is already '${String(task.status)}'. A resolved entry is never re-opened or re-decided by a second click`);
  }
  return task;
}

/** Owner only, always. An agent actor is refused before anything is read or written. */
function requireOwnerActor(actor: MoneyActor): void {
  if (actor.kind !== 'owner') {
    appendMissionAudit({
      // `mission_audit.actor_type` admits owner|system|provider|agent; a caller that is neither owner nor
      // agent is recorded as the system observing an unattributable attempt, never as a made-up actor.
      actorType: actor.kind === 'agent' ? 'agent' : 'system',
      actorId: String((actor as { id?: string }).id ?? 'none'),
      action: 'human_action.decision_refused',
      subjectType: 'human_action_task',
      subjectId: 'none',
      detail: { reason: 'owner_required', actorKind: actor.kind },
    });
    refuse('owner_required', 'a human-action task is decided by the owner, never by an agent — not the head agent, not a worker, not a scheduler run');
  }
  assertMoneyOwner(actor);
}

/** The open queue, ready to render. Read side of the console's Approvals panel. */
export function humanActionQueueView(options: { includeResolved?: boolean } = {}) {
  const rows = options.includeResolved
    ? db.all<Row>('SELECT * FROM mission_human_action_tasks ORDER BY created_at DESC LIMIT ?', [LIST_LIMIT])
    : db.all<Row>("SELECT * FROM mission_human_action_tasks WHERE status='pending' ORDER BY created_at ASC LIMIT ?", [LIST_LIMIT]);
  const total = Number(db.get<Row>(
    options.includeResolved
      ? 'SELECT COUNT(*) AS c FROM mission_human_action_tasks'
      : "SELECT COUNT(*) AS c FROM mission_human_action_tasks WHERE status='pending'",
  )?.c ?? 0);

  const needsGates = rows.some(row => String(row.notes ?? '').startsWith('fleet-readiness:') || ROLLUP_REASON.test(String(row.reason ?? '')));
  const byClass = pendingByClass();
  const counts = truePendingCounts();
  const gates = needsGates ? gateStates() : new Map<string, boolean>();
  const items = rows.map(row => describe(row, byClass, counts, gates));

  return {
    generatedAt: new Date().toISOString(),
    items,
    /** Everything the owner has not decided yet: open and either still pointing at something or unreadable. */
    open: items.filter(item => item.subject.stale !== true),
    stale: items.filter(item => item.subject.stale === true),
    total,
    shown: items.length,
    truncated: total > items.length,
    counts: {
      open: items.length,
      actionable: items.filter(item => item.actionable).length,
      stale: items.filter(item => item.subject.stale === true).length,
      unreadableSubject: items.filter(item => item.subject.kind === 'unlinked').length,
      gatesReadable: gates !== null,
    },
    blocker: {
      code: 'owner_action_pending' as const,
      // The readiness blocker counts open tasks that are not roll-ups; this asks the same question of the
      // same table, so the number the console shows and the number the blocker quotes cannot drift.
      openOwnerTasks: Number(db.get<Row>(
        "SELECT COUNT(*) AS c FROM mission_human_action_tasks WHERE status='pending' AND (notes IS NULL OR notes NOT LIKE 'fleet-readiness:%')",
      )?.c ?? 0),
    },
    note: 'Every row here is an entry an agent filed because a human-only action stood in its way. Nothing closes on its own: there is no expiry, no sweep and no bulk resolve. Approving a contract batch goes through the contract module, which grants nothing it was not shown and confirmed; approving anything else is an owner attestation and is recorded as one.',
  };
}

/**
 * The owner's "yes". For a contract batch this is the grant itself, and it is only allowed while the
 * subject is genuinely pending; for anything else it closes the entry as an attestation and touches no
 * other row.
 */
export function approveHumanActionTask(actor: MoneyActor, input: { taskId: string; confirmSurface?: string }) {
  requireOwnerActor(actor);
  const task = loadPending(input.taskId);
  const item = describe(task, pendingByClass(), truePendingCounts(), new Map());
  const subject = item.subject;

  if (subject.kind === 'contract-batch' && subject.pending > 0) {
    const agentClass = subject.agentClass;
    // The grant is NOT folded into a transaction of its own here, deliberately. The contract module owns the
    // granting unit and its own refusals — a refused digest or an over-broad proposal writes an audit row
    // and must survive; wrapping it in an outer transaction would roll that refusal away with the nothing
    // it changed, and the owner would be left with an entry that says nothing happened. So: the module
    // commits what it commits, and closing the queue entry is a second, separate act that follows it. If
    // the close itself ever failed, the grants stand and the entry stays open for the owner to close —
    // the reverse (un-granting real permissions because a marker could not be ticked) would be the lie.
    const result = approveAllClassContractProposals(actor, { agentClass, confirmSurface: input.confirmSurface });
    const details = {
      viaTaskId: item.taskId,
      agentClass: result.agentClass,
      granted: result.granted,
      refusedCount: result.refusedCount,
      refused: result.refused.map(entry => ({ proposalId: entry.proposalId, code: entry.code })),
      surfaceDigest: result.surface.surfaceDigest,
    };
    if (result.refusedCount > 0) {
      appendMissionAudit({
        actorType: 'owner', actorId: actor.id, action: 'human_action.approval_left_open',
        subjectType: 'human_action_task', subjectId: item.taskId, detail: details,
      });
      return {
        effect: 'granted_but_task_left_open' as const,
        task: item,
        grants: result,
        closed: false,
        note: `${result.granted} proposal(s) granted and ${result.refusedCount} refused, so this entry stays open — a refusal is still a decision the owner owes, and the contracts block lists each one with its reason`,
      };
    }
    return db.transaction(() => {
      const taskResult = resolveHumanActionTask({
        taskId: item.taskId,
        actor,
        resolvedSuccessfully: true,
        notes: `approved from the mission owner console via task ${item.taskId}: ${result.granted} scoped contract proposal(s) for ${result.agentClass} granted through the contract module, surface ${result.surface.surfaceDigest}`,
      });
      appendMissionAudit({
        actorType: 'owner', actorId: actor.id, action: 'human_action.task_resolved_with_grants',
        subjectType: 'human_action_task', subjectId: item.taskId, detail: details,
      });
      return {
        effect: 'granted_and_closed' as const,
        task: item,
        grants: result,
        closed: true,
        taskResult,
        note: `${result.granted} scoped contract(s) for ${result.agentClass} are active, and this entry is closed because the batch it pointed at is decided`,
      };
    });
  }

  const kind = subject.kind;
  const gateCode = kind === 'fleet-gate' ? subject.gateCode : null;
  const gateCleared = kind === 'fleet-gate' ? subject.gateCleared : null;
  const batchClass = kind === 'contract-batch' ? subject.agentClass : null;
  return db.transaction(() => {
    const taskResult = resolveHumanActionTask({
      taskId: item.taskId,
      actor,
      resolvedSuccessfully: true,
      notes: kind === 'contract-batch'
        ? `closed as stale from the mission owner console: no pending proposal existed for ${batchClass} at close time, so no contract was created or changed by this click`
        : kind === 'fleet-gate'
          ? `reviewed from the mission owner console; the ${gateCode} gate was ${gateCleared === null ? 'unreadable' : gateCleared ? 'already cleared' : 'still open'} at close time, and this click changed neither`
          : 'completed from the mission owner console as an owner attestation; no evidence was attached to it',
    });
    appendMissionAudit({
      actorType: 'owner', actorId: actor.id, action: 'human_action.task_approved',
      subjectType: 'human_action_task', subjectId: item.taskId,
      detail: {
        viaConsole: true,
        actionType: item.actionType,
        subjectKind: kind,
        stale: subject.stale === true,
        grantsWritten: 0,
        evidence: 'none — an attestation records the owner’s decision, not an external completion',
      },
    });
    return {
      effect: kind === 'contract-batch' ? ('closed_stale' as const) : ('closed_attestation' as const),
      task: item,
      closed: true,
      taskResult,
      note: kind === 'contract-batch'
        ? 'no contract row was written by this click — the batch it referred to has nothing pending any more'
        : 'this closes the entry only: it is the owner saying they have dealt with it, recorded as an attestation',
    };
  });
}

/**
 * The owner's "not now / not this". Requires a reason, cancels the marker, and changes nothing else —
 * least of all a contract. All-or-nothing: a throw rolls the task update and its audit row back together.
 */
export function rejectHumanActionTask(actor: MoneyActor, input: { taskId: string; reason?: string }) {
  requireOwnerActor(actor);
  const task = loadPending(input.taskId);
  const reason = String(input.reason ?? '').trim();
  if (reason.length < REASON_MIN) {
    refuse('reason_required', `a rejection has to say why (${REASON_MIN}-${REASON_MAX} characters); an entry is never cancelled silently`);
  }
  if (reason.length > REASON_MAX) {
    refuse('reason_too_long', `keep the reason under ${REASON_MAX} characters — it goes into the audit trail, not into a document`);
  }

  const item = describe(task, pendingByClass(), truePendingCounts(), new Map());
  const subject = item.subject;
  const agentClass = subject.kind === 'contract-batch' ? subject.agentClass : null;
  const pendingBefore = subject.kind === 'contract-batch' ? subject.pending : null;

  return db.transaction(() => {
    const taskResult = resolveHumanActionTask({
      taskId: item.taskId,
      actor,
      resolvedSuccessfully: false,
      notes: `rejected from the mission owner console — ${reason}`,
    });
    const pendingAfter = agentClass === null ? null : truePendingCounts().get(agentClass) ?? 0;
    appendMissionAudit({
      actorType: 'owner', actorId: actor.id, action: 'human_action.task_rejected',
      subjectType: 'human_action_task', subjectId: item.taskId,
      detail: {
        viaConsole: true,
        actionType: item.actionType,
        subjectKind: subject.kind,
        reason: reason.slice(0, REASON_MAX),
        // Proof that a rejection is not a decision about any contract: the class' pending count is measured
        // before and after, inside a transaction that only ever touched the task row.
        pendingProposalsBefore: pendingBefore,
        pendingProposalsAfter: pendingAfter,
        contractsWritten: 0,
      },
    });
    return {
      effect: 'rejected' as const,
      task: item,
      reason,
      closed: true,
      taskResult,
      pendingProposalsAfter: pendingAfter,
      note: pendingAfter && pendingAfter > 0
        ? `${pendingAfter} proposal(s) for ${agentClass} are still pending, untouched by this rejection — the fleet stays blocked on them, which is the point: cancelling the marker did not settle the requirement`
        : 'nothing else changed: no proposal, contract, grant or earning was touched by this rejection',
    };
  });
}

export type { HumanActionTask };
