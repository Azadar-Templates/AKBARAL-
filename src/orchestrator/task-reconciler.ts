import {
  appendAuditLog,
  appendTaskEvent,
  findTaskById,
  refundTaskCredit,
  updateTaskStatus,
} from '../db';
import type { ExecutionStream } from '../realtime/execution-stream';

/**
 * Task reconciliation (Milestone 3).
 *
 * Single source of truth for terminal task transitions and the trust policy:
 * every terminal transition is guarded by the current task status, so races
 * between completion, cancellation, timeout and crash recovery can never
 * double-refund, double-complete or overwrite each other. The credit refund
 * itself is idempotent per task (refundTaskCredit).
 */

export const NON_TERMINAL_TASK_STATUSES = ['created', 'queued', 'running'] as const;

export interface ReconcileResult {
  applied: boolean;
  reason?: string;
}

/**
 * Fail a task (guarded) and refund its reserved credit exactly once.
 * Used for final execution failures, timeouts and crash recovery.
 */
export function reconcileTaskFailed(input: {
  taskId: string;
  code: string;
  message: string;
  executionId?: string | null;
  stream?: ExecutionStream;
}): ReconcileResult {
  const applied = updateTaskStatus({
    id: input.taskId,
    status: 'failed',
    completedAt: new Date().toISOString(),
    errorMessage: input.message,
    expectedStatuses: [...NON_TERMINAL_TASK_STATUSES],
  });
  if (!applied) {
    return { applied: false, reason: 'task already terminal' };
  }

  const task = findTaskById(input.taskId);
  if (task) {
    const refund = refundTaskCredit({
      userId: String(task.user_id),
      taskId: task.id,
      reason: `automatic refund for failed task ${task.id} (${input.code})`,
    });
    appendTaskEvent({
      taskId: task.id,
      executionId: input.executionId ?? null,
      message: refund
        ? `Task failed (${input.code}) — free task credit automatically refunded`
        : `Task failed (${input.code})`,
      level: 'error',
      type: 'status',
    });
    appendAuditLog({
      actorId: task.user_id,
      action: 'task.failed',
      resourceType: 'task',
      resourceId: task.id,
      description: `task failed (${input.code})`,
      metadata: { executionId: input.executionId ?? null, code: input.code },
    });
  }
  input.stream?.pushStatus({
    executionId: input.executionId ?? input.taskId,
    status: 'failed',
    message: input.message,
    errorMessage: input.message,
  });
  return { applied: true };
}

/**
 * Cancel a task (guarded) and refund its reserved credit. Never applies to a
 * task that already reached a terminal state (completed/failed/cancelled).
 */
export function reconcileTaskCancelled(input: {
  taskId: string;
  by: string;
  reason: string;
  stream?: ExecutionStream;
}): ReconcileResult {
  const applied = updateTaskStatus({
    id: input.taskId,
    status: 'cancelled',
    completedAt: new Date().toISOString(),
    errorMessage: input.reason,
    expectedStatuses: [...NON_TERMINAL_TASK_STATUSES],
  });
  if (!applied) {
    return { applied: false, reason: 'task already terminal' };
  }

  const task = findTaskById(input.taskId);
  if (task) {
    const refund = refundTaskCredit({
      userId: String(task.user_id),
      taskId: task.id,
      reason: `refund for cancelled task ${task.id}`,
    });
    appendTaskEvent({
      taskId: task.id,
      message: refund
        ? `Task cancelled by ${input.by} — free task credit refunded`
        : `Task cancelled by ${input.by}`,
      level: 'info',
      type: 'status',
    });
    appendAuditLog({
      actorId: input.by,
      action: 'task.cancelled',
      resourceType: 'task',
      resourceId: task.id,
      description: `task cancelled by ${input.by}: ${input.reason}`,
      metadata: { refunded: Boolean(refund) },
    });
  }
  input.stream?.pushStatus({
    executionId: input.taskId,
    status: 'cancelled',
    message: input.reason,
  });
  return { applied: true };
}
