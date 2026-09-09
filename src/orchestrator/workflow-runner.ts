import {
  db,
  getWorkflow,
  listWorkflowSteps,
  updateWorkflowStatus,
  updateWorkflowStepStatus,
  createWorkflow,
  createWorkflowStep,
} from '../db';
import { getAgentBySlug } from '../agents/registry';
import { createAgentTask, dispatchAgentExecution } from './executor';
import { routerComplete } from './goal-analyzer';
import { synthesizeFinalResult, type SynthesisStepInput } from './synthesizer';
import type { ExecutionStream } from '../realtime/execution-stream';

export interface WorkflowRunResult {
  workflowId: string;
  status: 'completed' | 'failed' | 'parsing_failed';
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
export async function runWorkflow(
  workflowId: string,
  stream?: ExecutionStream,
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

  for (const step of steps) {
    const stepOrder = Number(step.step_order ?? 0);
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

    const goal = String(workflow.goal ?? 'Untitled workflow');
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

      const run = await dispatchAgentExecution(dispatch.executionId, agentSlug, stream);
      if (run.status !== 'completed') {
        failed += 1;
        failureMessage = run.error ?? `step ${stepOrder} failed`;
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
      completed.set(String(stepOrder), run.output ?? {});
      const verification = extractVerification(run.output);
      stepMeta.push({
        stepOrder,
        agentSlug,
        specialization: specializationForStep(step.agent_id),
        status: 'completed',
        verified: verification?.passed ?? false,
        verificationScore: verification?.score ?? 0,
        content: extractContent(run.output),
      });
      updateWorkflowStepStatus({
        id: String(step.id),
        status: 'completed',
        result: run.output ?? {},
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
    summary: stepsSummary(completed.size, failed, skipped),
    stepResults: completed,
    finalResult,
  };

  const status = failed > 0 ? 'failed' : 'completed';
  updateWorkflowStatus({
    id: workflowId,
    status,
    result,
    errorMessage: failureMessage ?? null,
    completedAt: new Date().toISOString(),
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

function stepsSummary(completed: number, failed: number, skipped: number): string {
  if (failed > 0) {
    return `Workflow completed ${completed} step(s), failed ${failed}, skipped ${skipped}.`;
  }
  return `Workflow completed ${completed} step(s) with ${skipped} skipped.`;
}

export { createWorkflow, createWorkflowStep };
