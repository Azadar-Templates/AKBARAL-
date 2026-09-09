import { db } from '../db';
import {
  finishJob,
  listOrphanNonTerminalExecutions,
  listOrphanNonTerminalTasks,
  listOrphanRunningWorkflows,
  listStaleRunningJobs,
  requeueStaleJob,
  type ExecutionJobRow,
} from '../db';
import { refundTaskCredit, updateTaskStatus, updateWorkflowStatus, updateWorkflowStepStatus, updateAgentExecutionStatus } from '../db';
import { reconcileTaskFailed } from './task-reconciler';
import { executionQueue } from './queue';

/**
 * Crash recovery (Milestone 3).
 *
 * Runs at boot BEFORE the queue starts accepting work:
 *
 *  1. Stale running jobs (locked by a dead worker) are re-queued for a final
 *     attempt when attempts remain, or failed + task-refunded when exhausted.
 *  2. Queued/retrying jobs need no action — the new worker claims them.
 *  3. Non-terminal tasks/executions/workflows NOT owned by any live job are
 *     reconciled the legacy way: honest failure + exactly-once refund.
 *
 * All refunds are idempotent per task (refundTaskCredit refuses doubles), so
 * a crash during recovery itself is safe to re-run.
 */

export interface RecoveryReport {
  jobsRequeued: number;
  jobsFailed: number;
  workflows: number;
  steps: number;
  tasks: number;
  executions: number;
  creditsRefunded: number;
}

const INTERRUPTED = 'interrupted by server restart';

export function recoverInterruptedWork(): RecoveryReport {
  const report: RecoveryReport = {
    jobsRequeued: 0,
    jobsFailed: 0,
    workflows: 0,
    steps: 0,
    tasks: 0,
    executions: 0,
    creditsRefunded: 0,
  };

  // --- 1. Stale running jobs from a dead worker -----------------------------
  const staleJobs = listStaleRunningJobs(executionQueue.workerId);
  for (const job of staleJobs) {
    if (job.attempts < job.max_attempts) {
      if (requeueStaleJob(job.id, `${INTERRUPTED} (attempt ${job.attempts} interrupted)`)) {
        report.jobsRequeued += 1;
      }
    } else {
      if (finishJob(job.id, { status: 'failed', errorCode: 'interrupted', errorMessage: INTERRUPTED })) {
        report.jobsFailed += 1;
        if (job.job_type === 'agent_execution' && job.task_id) {
          const reconciled = reconcileTaskFailed({
            taskId: job.task_id,
            code: 'interrupted',
            message: INTERRUPTED,
          });
          if (reconciled.applied) {
            report.creditsRefunded += 1;
          }
        }
        if (job.job_type === 'workflow' && job.workflow_id) {
          db.run(
            `UPDATE workflows SET status='failed', error_message=?, completed_at=? WHERE id=? AND status IN ('planned','running')`,
            [INTERRUPTED, new Date().toISOString(), job.workflow_id],
          );
          report.workflows += 1;
        }
      }
    }
  }

  // --- 2. Orphan agent executions (no live job owns them) -------------------
  const executions = listOrphanNonTerminalExecutions();
  for (const execution of executions) {
    updateAgentExecutionStatus({
      id: execution.id,
      status: 'failed',
      errorMessage: INTERRUPTED,
      completedAt: new Date().toISOString(),
    });
    report.executions += 1;
  }

  // --- 3. Orphan tasks (no live job owns them) ------------------------------
  const tasks = listOrphanNonTerminalTasks();
  for (const task of tasks) {
    const applied = updateTaskStatus({
      id: task.id,
      status: 'failed',
      completedAt: new Date().toISOString(),
      errorMessage: INTERRUPTED,
      expectedStatuses: ['created', 'queued', 'running'],
    });
    if (!applied) {
      continue;
    }
    report.tasks += 1;
    const refund = refundTaskCredit({
      userId: task.user_id,
      taskId: task.id,
      reason: `crash recovery refund for interrupted task ${task.id}`,
    });
    if (refund) {
      report.creditsRefunded += 1;
    }
  }

  // --- 4. Running workflow steps of orphaned workflows ----------------------
  const orphanWorkflows = listOrphanRunningWorkflows();
  const orphanWorkflowIds = new Set(orphanWorkflows.map((workflow) => workflow.id));
  if (orphanWorkflowIds.size > 0) {
    const steps = db.all<{ id: string; workflow_id: string }>(
      `SELECT id, workflow_id FROM workflow_steps WHERE status = 'running'`,
    ) as Array<{ id: string; workflow_id: string }>;
    for (const step of steps) {
      if (orphanWorkflowIds.has(step.workflow_id)) {
        updateWorkflowStepStatus({ id: step.id, status: 'failed', errorMessage: INTERRUPTED });
        report.steps += 1;
      }
    }
  }

  // --- 5. Orphan running workflows ------------------------------------------
  for (const workflow of orphanWorkflows) {
    updateWorkflowStatus({
      id: workflow.id,
      status: 'failed',
      errorMessage: INTERRUPTED,
      completedAt: new Date().toISOString(),
    });
    report.workflows += 1;
  }

  return report;
}

/** Type re-export for route layer convenience. */
export type { ExecutionJobRow };
