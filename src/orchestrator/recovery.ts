import {
  db,
  refundTaskCredit,
  updateTaskStatus,
  updateWorkflowStatus,
  updateWorkflowStepStatus,
  updateAgentExecutionStatus,
} from '../db';

/**
 * Crash recovery (Milestone 3, stage 1).
 *
 * Executions run in-process. If the process dies mid-run (crash, deploy,
 * restart), workflows, steps, tasks and agent executions are left in
 * non-terminal states with free-task credits already reserved — forever.
 *
 * This reconciliation runs at boot BEFORE the server accepts traffic: every
 * non-terminal workflow/step/task/execution is marked failed with an honest
 * "interrupted by server restart" error and every affected task's reserved
 * credit is refunded (idempotently — refundTaskCredit refuses double
 * refunds per task).
 */

export interface RecoveryReport {
  workflows: number;
  steps: number;
  tasks: number;
  executions: number;
  creditsRefunded: number;
}

const INTERRUPTED = 'interrupted by server restart';

export function recoverInterruptedWork(): RecoveryReport {
  const report: RecoveryReport = { workflows: 0, steps: 0, tasks: 0, executions: 0, creditsRefunded: 0 };

  // 1. Agent executions stuck in a non-terminal state.
  const executions = db.all<{ id: string }>(
    "SELECT id FROM agent_executions WHERE status IN ('queued', 'running')",
  ) as Array<{ id: string }>;
  for (const execution of executions) {
    updateAgentExecutionStatus({
      id: execution.id,
      status: 'failed',
      errorMessage: INTERRUPTED,
      completedAt: new Date().toISOString(),
    });
    report.executions += 1;
  }

  // 2. Tasks stuck in a non-terminal state: fail + refund the reserved credit.
  // Task states: created -> running -> completed | failed | cancelled. A crash
  // can leave a task in 'created' (reserved but not yet dispatched) or
  // 'running' (mid-execution); both are orphaned at boot.
  const tasks = db.all<{ id: string; user_id: string }>(
    "SELECT id, user_id FROM tasks WHERE status IN ('created', 'queued', 'running')",
  ) as Array<{ id: string; user_id: string }>;
  for (const task of tasks) {
    updateTaskStatus({
      id: task.id,
      status: 'failed',
      completedAt: new Date().toISOString(),
      errorMessage: INTERRUPTED,
    });
    const refund = refundTaskCredit({
      userId: task.user_id,
      taskId: task.id,
      reason: `crash recovery refund for interrupted task ${task.id}`,
    });
    if (refund) {
      report.creditsRefunded += 1;
    }
    report.tasks += 1;
  }

  // 3. Workflow steps stuck running.
  const steps = db.all<{ id: string }>(
    "SELECT id FROM workflow_steps WHERE status = 'running'",
  ) as Array<{ id: string }>;
  for (const step of steps) {
    updateWorkflowStepStatus({ id: step.id, status: 'failed', errorMessage: INTERRUPTED });
    report.steps += 1;
  }

  // 4. Workflows stuck running.
  const workflows = db.all<{ id: string }>(
    "SELECT id FROM workflows WHERE status = 'running'",
  ) as Array<{ id: string }>;
  for (const workflow of workflows) {
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
