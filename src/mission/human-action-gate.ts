/**
 * ZA141251SA HUMAN-ACTION GATE
 *
 * When an agent encounters an action that requires human intervention
 * (KYC, captcha, identity verification, payment setup, ToS acceptance),
 * the agent does NOT pretend it completed the action. Instead, this module
 * creates an owner action task in the approvals queue.
 *
 * The agent remains in its current state. The scheduler skips it until
 * the owner completes the human action and marks the task resolved.
 */

import { missionDb as db, missionId, nowIso, appendMissionAudit, type Row } from './database';
import { type MoneyActor } from './money';

export interface HumanActionTask {
  id: string;
  agentId: string;
  opportunityId: string | null;
  actionType: string;
  reason: string;
  platformUrl: string | null;
  status: 'pending' | 'completed' | 'expired' | 'cancelled';
  createdAt: string;
  completedAt: string | null;
  completedBy: string | null;
}

/** Known human-only action types that require owner intervention */
export const HUMAN_ACTION_TYPES = {
  KYC_VERIFICATION: 'kyc_verification',
  IDENTITY_VERIFICATION: 'identity_verification',
  PHONE_VERIFICATION: 'phone_verification',
  EMAIL_VERIFICATION: 'email_verification',
  CAPTCHA: 'captcha',
  TOS_ACCEPTANCE: 'tos_acceptance',
  ACCOUNT_CREATION: 'account_creation',
  PAYMENT_SETUP: 'payment_setup',
  BANK_VERIFICATION: 'bank_verification',
  TWO_FACTOR_SETUP: 'two_factor_setup',
  PLATFORM_INTERVIEW: 'platform_interview',
  PORTFOLIO_REVIEW: 'portfolio_review',
  MANUAL_APPROVAL: 'manual_approval',
  LEGAL_AGREEMENT: 'legal_agreement',
} as const;

export type HumanActionType = typeof HUMAN_ACTION_TYPES[keyof typeof HUMAN_ACTION_TYPES];

/**
 * Create a human action task when an agent cannot proceed autonomously.
 * The agent is blocked until the owner resolves this task.
 */
export function createHumanActionTask(input: {
  agentId: string;
  opportunityId?: string | null;
  actionType: HumanActionType;
  reason: string;
  platformUrl?: string | null;
}): HumanActionTask {
  const id = missionId('hat');
  const createdAt = nowIso();

  db.run(
    `INSERT INTO mission_human_action_tasks (id, agent_id, opportunity_id, action_type, reason, platform_url, status, created_at)
     VALUES (?,?,?, ?,?,?, 'pending', ?)`,
    [id, input.agentId, input.opportunityId ?? null, input.actionType, input.reason.slice(0, 2000), input.platformUrl ?? null, createdAt],
  );

  appendMissionAudit({
    actorType: 'agent',
    actorId: input.agentId,
    action: 'human_action.created',
    subjectType: 'human_action_task',
    subjectId: id,
    detail: {
      actionType: input.actionType,
      reason: input.reason.slice(0, 500),
      opportunityId: input.opportunityId ?? null,
      platformUrl: input.platformUrl ?? null,
    },
  });

  return {
    id,
    agentId: input.agentId,
    opportunityId: input.opportunityId ?? null,
    actionType: input.actionType,
    reason: input.reason,
    platformUrl: input.platformUrl ?? null,
    status: 'pending',
    createdAt,
    completedAt: null,
    completedBy: null,
  };
}

/** Owner resolves a human action task — unblocks the agent */
export function resolveHumanActionTask(input: {
  taskId: string;
  actor: MoneyActor;
  resolvedSuccessfully: boolean;
  notes?: string;
}): HumanActionTask {
  if (input.actor.kind !== 'owner') throw new Error('only owner can resolve human action tasks');

  const task = db.get<Row>('SELECT * FROM mission_human_action_tasks WHERE id = ?', [input.taskId]);
  if (!task) throw new Error('human action task not found');
  if (String(task.status) !== 'pending') throw new Error('task already resolved');

  const status = input.resolvedSuccessfully ? 'completed' : 'cancelled';
  const now = nowIso();

  db.run(
    `UPDATE mission_human_action_tasks SET status = ?, completed_at = ?, completed_by = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`,
    [status, now, input.actor.id, input.notes ?? null, now, input.taskId],
  );

  appendMissionAudit({
    actorType: 'owner',
    actorId: input.actor.id,
    action: 'human_action.resolved',
    subjectType: 'human_action_task',
    subjectId: input.taskId,
    detail: {
      resolvedSuccessfully: input.resolvedSuccessfully,
      notes: (input.notes ?? '').slice(0, 500),
      agentId: String(task.agent_id),
      actionType: String(task.action_type),
    },
  });

  return {
    id: String(task.id),
    agentId: String(task.agent_id),
    opportunityId: task.opportunity_id ? String(task.opportunity_id) : null,
    actionType: String(task.action_type),
    reason: String(task.reason),
    platformUrl: task.platform_url ? String(task.platform_url) : null,
    status,
    createdAt: String(task.created_at),
    completedAt: now,
    completedBy: input.actor.id,
  };
}

/** List pending human action tasks for BOSS dashboard */
export function listPendingHumanActions(limit = 100): HumanActionTask[] {
  return db.all<Row>(
    "SELECT * FROM mission_human_action_tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?",
    [limit],
  ).map(toTask);
}

/** List all human action tasks */
export function listAllHumanActions(limit = 200): HumanActionTask[] {
  return db.all<Row>(
    'SELECT * FROM mission_human_action_tasks ORDER BY created_at DESC LIMIT ?',
    [limit],
  ).map(toTask);
}

/** Check if an agent has any pending human action tasks (used by scheduler to skip blocked agents) */
export function agentHasPendingHumanAction(agentId: string): boolean {
  const row = db.get<Row>(
    "SELECT COUNT(*) as c FROM mission_human_action_tasks WHERE agent_id = ? AND status = 'pending'",
    [agentId],
  );
  return Number(row?.c ?? 0) > 0;
}

function toTask(row: Row): HumanActionTask {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    opportunityId: row.opportunity_id ? String(row.opportunity_id) : null,
    actionType: String(row.action_type),
    reason: String(row.reason),
    platformUrl: row.platform_url ? String(row.platform_url) : null,
    status: String(row.status) as any,
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    completedBy: row.completed_by ? String(row.completed_by) : null,
  };
}
