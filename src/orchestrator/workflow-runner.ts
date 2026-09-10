import {
  db,
  getWorkflow,
  listWorkflowSteps,
  updateWorkflowStatus,
  updateWorkflowStepStatus,
  updateAgentExecutionStatus,
  createWorkflow,
  createWorkflowStep,
} from '../db';
import { getAgentBySlug } from '../agents/registry';
import { createAgentTask, dispatchAgentExecution } from './executor';
import { routerComplete } from './goal-analyzer';
import { synthesizeFinalResult, type SynthesisStepInput } from './synthesizer';
import { reconcileTaskFailed } from './task-reconciler';
import type { ExecutionStream } from '../realtime/execution-stream';

export interface WorkflowRunResult {
  workflowId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'parsing_failed';
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  result: Record<string, unknown>;
  error?: string;
}

/**
 * Workflow execution engine.
 *
 * Runs the persisted task graph (workflow_steps). It respects `depends_on`
 * edges, executes each step through the specialist agent dispatcher (which
 * now includes the bounded tool stage and the real verification stage),
 * captures results, links steps to their tasks, aggregates credit accounting
 * and synthesizes the final MASTER AI result document. Failed steps do not
 * consume credits (the task layer refunds automatically); dependent steps
 * are skipped.
 */
export interface RunWorkflowOptions {
  /** Cancellation probe checked between steps and before applying results. */
  isCancelled?: () => boolean;
  /** Per-step execution timeout in milliseconds. */
  stepTimeoutMs?: number;
}

export async function runWorkflow(
  workflowId: string,
  stream?: ExecutionStream,
  options?: RunWorkflowOptions,
): Promise<WorkflowRunResult> {
  const workflow = getWorkflow(workflowId);
  if (!workflow) {
    throw new Error(`workflow ${workflowId} not found`);
  }

  const steps = listWorkflowSteps(workflowId);
  updateWorkflowStatus({ id: workflowId, status: 'running' });

  const completed = new Map<string, Record<string, unknown>>();
  const stepMeta: SynthesisStepInput[] = [];
  const taskIds: string[] = [];
  let failed = 0;
  let skipped = 0;
  let failureMessage: string | undefined;
  let cancelled = false;

  for (const step of steps) {
    const stepOrder = Number(step.step_order ?? 0);

    // Resume support: steps already completed in a previous (interrupted or
    // retried) run are not re-executed; their persisted results feed the
    // synthesis and the dependency graph.
    if (String(step.status ?? '') === 'completed' && step.result_json) {
      let prior: Record<string, unknown> = {};
      try {
        prior = JSON.parse(String(step.result_json)) as Record<string, unknown>;
      } catch {
        prior = {};
      }
      completed.set(String(stepOrder), prior);
      stepMeta.push({
        stepOrder,
        agentSlug: agentSlugForStep(step.agent_id),
        specialization: specializationForStep(step.agent_id),
        status: 'completed',
        verified: Boolean((prior.verification as { passed?: boolean } | undefined)?.passed),
        verificationScore: Number((prior.verification as { score?: number } | undefined)?.score ?? 0),
        content: extractContent(prior),
      });
      if (step.task_id) {
        taskIds.push(String(step.task_id));
      }
      continue;
    }

    // Cancellation probe between steps.
    if (options?.isCancelled?.()) {
      cancelled = true;
      break;
    }

    const dependencies = String(step.depends_on ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const blocked = dependencies.some((dependencyOrder) => !completed.has(dependencyOrder));
    if (blocked) {
      updateWorkflowStepStatus({
        id: String(step.id),
        status: 'skipped',
        errorMessage: 'dependency failed or not completed',
      });
      skipped += 1;
      stepMeta.push({
        stepOrder,
        agentSlug: agentSlugForStep(step.agent_id),
        specialization: specializationForStep(step.agent_id),
        status: 'skipped',
        verified: false,
        verificationScore: 0,
        content: '',
        error: 'dependency failed or not completed',
      });
      continue;
    }

    const agentId = step.agent_id ? String(step.agent_id) : null;
    const agentSlug = agentId
      ? (db.get<{ slug: string }>('SELECT slug FROM agents WHERE id = ?', [agentId])?.slug ?? '')
      : '';
    if (!agentSlug) {
      updateWorkflowStepStatus({ id: String(step.id), status: 'skipped', errorMessage: 'agent not found' });
      skipped += 1;
      stepMeta.push({
        stepOrder,
        agentSlug: '',
        specialization: '',
        status: 'skipped',
        verified: false,
        verificationScore: 0,
        content: '',
        error: 'agent not found',
      });
      continue;
    }

    // Automations carry a per-step goal; MASTER-planned workflows fall back
    // to the workflow goal.
    const goal = step.goal ? String(step.goal) : String(workflow.goal ?? 'Untitled workflow');
    updateWorkflowStepStatus({ id: String(step.id), status: 'running' });
    stream?.pushStatus({
      executionId: workflowId,
      status: 'running',
      message: `Workflow step ${stepOrder}: ${agentSlug}`,
    });

    try {
      const dispatch = createAgentTask({
        userId: String(workflow.user_id),
        agentSlug,
        goal,
        projectId: workflow.project_id ? String(workflow.project_id) : null,
      });
      taskIds.push(dispatch.taskId);
      updateWorkflowStepStatus({ id: String(step.id), status: 'running', taskId: dispatch.taskId });

      const run = await withStepTimeout(
        dispatchAgentExecution(dispatch.executionId, agentSlug, stream),
        options?.stepTimeoutMs,
      );

      if (run.timedOut) {
        failed += 1;
        failureMessage = `timed_out: step ${stepOrder} (${agentSlug}) exceeded the per-step time budget`;
        markStepTimedOut(dispatch.executionId, dispatch.taskId, failureMessage);
        updateWorkflowStepStatus({
          id: String(step.id),
          status: 'failed',
          errorMessage: failureMessage,
          taskId: dispatch.taskId,
        });
        stepMeta.push({
          stepOrder,
          agentSlug,
          specialization: specializationForStep(step.agent_id),
          status: 'failed',
          verified: false,
          verificationScore: 0,
          content: '',
          error: failureMessage,
        });
        break;
      }

      if (run.value.status !== 'completed') {
        failed += 1;
        failureMessage = run.value.error ?? `step ${stepOrder} failed`;
        updateWorkflowStepStatus({
          id: String(step.id),
          status: 'failed',
          errorMessage: failureMessage,
          taskId: dispatch.taskId,
        });
        stepMeta.push({
          stepOrder,
          agentSlug,
          specialization: specializationForStep(step.agent_id),
          status: 'failed',
          verified: false,
          verificationScore: 0,
          content: '',
          error: failureMessage,
        });
        break;
      }

      // Cancellation probe before applying the step result.
      if (options?.isCancelled?.()) {
        cancelled = true;
        updateWorkflowStepStatus({
          id: String(step.id),
          status: 'cancelled',
          errorMessage: 'workflow cancelled',
          taskId: dispatch.taskId,
        });
        break;
      }

      completed.set(String(stepOrder), run.value.output ?? {});
      const verification = extractVerification(run.value.output);
      stepMeta.push({
        stepOrder,
        agentSlug,
        specialization: specializationForStep(step.agent_id),
        status: 'completed',
        verified: verification?.passed ?? false,
        verificationScore: verification?.score ?? 0,
        content: extractContent(run.value.output),
      });
      updateWorkflowStepStatus({
        id: String(step.id),
        status: 'completed',
        result: run.value.output ?? {},
        taskId: dispatch.taskId,
      });
    } catch (error) {
      failed += 1;
      failureMessage = error instanceof Error ? error.message : String(error);
      updateWorkflowStepStatus({ id: String(step.id), status: 'failed', errorMessage: failureMessage });
      stepMeta.push({
        stepOrder,
        agentSlug,
        specialization: specializationForStep(step.agent_id),
        status: 'failed',
        verified: false,
        verificationScore: 0,
        content: '',
        error: failureMessage,
      });
      break;
    }
  }

  // --- FINAL RESULT: synthesis + honest credit accounting ------------------
  const credits = aggregateCredits(taskIds);
  const finalResult = await synthesizeFinalResult({
    goal: String(workflow.goal ?? ''),
    steps: stepMeta,
    credits,
    complete: completed.size > 0 ? routerComplete : null,
  });

  const result: Record<string, unknown> = {
    workflowId,
    goal: workflow.goal,
    summary: stepsSummary(completed.size, failed, skipped, cancelled),
    stepResults: completed,
    finalResult,
  };

  if (cancelled) {
    // The cancellation path already wrote the terminal workflow state; do not
    // overwrite it here.
    stream?.pushStatus({
      executionId: workflowId,
      status: 'cancelled',
      message: 'Workflow cancelled',
    });
    return {
      workflowId,
      status: 'cancelled',
      completedSteps: completed.size,
      failedSteps: failed,
      skippedSteps: skipped,
      result,
      error: 'cancelled',
    };
  }

  const status = failed > 0 ? 'failed' : 'completed';
  // Guarded: an overall timeout or cancellation may have terminalized the
  // workflow while the last step was in flight; never overwrite that.
  updateWorkflowStatus({
    id: workflowId,
    status,
    result,
    errorMessage: failureMessage ?? null,
    completedAt: new Date().toISOString(),
    expectedStatuses: ['planned', 'running'],
  });
  stream?.pushStatus({
    executionId: workflowId,
    status,
    message: status === 'completed' ? 'Workflow completed' : 'Workflow failed',
    errorMessage: failureMessage ?? null,
  });

  return {
    workflowId,
    status,
    completedSteps: completed.size,
    failedSteps: failed,
    skippedSteps: skipped,
    result,
    error: failureMessage,
  };
}

/**
 * Race a step execution against its time budget. On timeout the losing
 * promise is left to settle quietly (its guarded task/execution writes are
 * no-ops once the step has been marked timed out) and the caller marks the
 * step, execution and task failed with an honest timed_out error.
 */
async function withStepTimeout(
  promise: Promise<{ status: string; output: Record<string, unknown> | null; error?: string; code?: string }>,
  timeoutMs?: number,
): Promise<
  | { timedOut: false; value: { status: string; output: Record<string, unknown> | null; error?: string; code?: string } }
  | { timedOut: true }
> {
  if (!timeoutMs || timeoutMs <= 0) {
    return { timedOut: false, value: await promise };
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const value = await Promise.race([
      promise,
      new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
        timer.unref?.();
      }),
    ]);
    if ('timedOut' in value && value.timedOut) {
      return { timedOut: true };
    }
    return { timedOut: false, value: value as { status: string; output: Record<string, unknown> | null; error?: string; code?: string } };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** Mark a timed-out step's execution and task failed with a refund. */
function markStepTimedOut(executionId: string, taskId: string, message: string): void {
  updateAgentExecutionStatus({
    id: executionId,
    status: 'failed',
    errorMessage: message,
    completedAt: new Date().toISOString(),
  });
  reconcileTaskFailed({ taskId, code: 'timed_out', message, executionId });
}

function extractVerification(output: Record<string, unknown> | null): { passed: boolean; score: number } | null {
  if (!output) {
    return null;
  }
  const verification = output.verification as { passed?: unknown; score?: unknown } | undefined;
  if (!verification || typeof verification.passed !== 'boolean') {
    return null;
  }
  return {
    passed: verification.passed,
    score: typeof verification.score === 'number' ? verification.score : 0,
  };
}

function extractContent(output: Record<string, unknown> | null): string {
  if (!output) {
    return '';
  }
  return typeof output.content === 'string' ? output.content : '';
}

function agentSlugForStep(agentId: unknown): string {
  if (!agentId) {
    return '';
  }
  return db.get<{ slug: string }>('SELECT slug FROM agents WHERE id = ?', [String(agentId)])?.slug ?? '';
}

function specializationForStep(agentId: unknown): string {
  if (!agentId) {
    return '';
  }
  const agent = getAgentBySlug(agentSlugForStep(agentId));
  return agent?.specialization ?? '';
}

/** Aggregate consumed vs refunded credits for the tasks created by this run. */
function aggregateCredits(taskIds: string[]): { consumed: number; refunded: number } {
  if (taskIds.length === 0) {
    return { consumed: 0, refunded: 0 };
  }
  const placeholders = taskIds.map(() => '?').join(',');
  const rows = db.all<{ type: string; count: number }>(
    `SELECT type, COUNT(*) AS count FROM credit_transactions
     WHERE task_id IN (${placeholders}) AND status = 'completed'
     GROUP BY type`,
    taskIds,
  ) as Array<{ type: string; count: number }>;
  const consumed = rows.find((row) => row.type === 'consume_task')?.count ?? 0;
  const refunded = rows.find((row) => row.type === 'refund_task')?.count ?? 0;
  return { consumed, refunded };
}

function stepsSummary(completed: number, failed: number, skipped: number, cancelled = false): string {
  if (cancelled) {
    return `Workflow cancelled after ${completed} completed step(s).`;
  }
  if (failed > 0) {
    return `Workflow completed ${completed} step(s), failed ${failed}, skipped ${skipped}.`;
  }
  return `Workflow completed ${completed} step(s) with ${skipped} skipped.`;
}

export { createWorkflow, createWorkflowStep };
