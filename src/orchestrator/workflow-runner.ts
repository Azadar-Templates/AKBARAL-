import {
  db,
  getWorkflow,
  listWorkflowSteps,
  updateWorkflowStatus,
  updateWorkflowStepStatus,
  createWorkflow,
  createWorkflowStep,
} from '../db';
import { createAgentTask, dispatchAgentExecution } from './executor';
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
 * edges, executes each step through the specialist agent dispatcher, captures
 * results, and aggregates the final result. Failed steps do not consume credits
 * (the task layer refunds automatically); dependent steps are skipped.
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
      continue;
    }

    const agentId = step.agent_id ? String(step.agent_id) : null;
    const agentSlug = agentId
      ? (db.get<{ slug: string }>('SELECT slug FROM agents WHERE id = ?', [agentId])?.slug ?? '')
      : '';
    if (!agentSlug) {
      updateWorkflowStepStatus({ id: String(step.id), status: 'skipped', errorMessage: 'agent not found' });
      skipped += 1;
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
      const run = await dispatchAgentExecution(dispatch.executionId, agentSlug, stream);
      if (run.status !== 'completed') {
        failed += 1;
        failureMessage = run.error ?? `step ${stepOrder} failed`;
        updateWorkflowStepStatus({ id: String(step.id), status: 'failed', errorMessage: failureMessage });
        break;
      }
      completed.set(String(stepOrder), run.output ?? {});
      updateWorkflowStepStatus({
        id: String(step.id),
        status: 'completed',
        result: run.output ?? {},
      });
    } catch (error) {
      failed += 1;
      failureMessage = error instanceof Error ? error.message : String(error);
      updateWorkflowStepStatus({ id: String(step.id), status: 'failed', errorMessage: failureMessage });
      break;
    }
  }

  const result: Record<string, unknown> = {
    workflowId,
    goal: workflow.goal,
    summary: stepsSummary(completed.size, failed, skipped),
    stepResults: completed,
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

function stepsSummary(completed: number, failed: number, skipped: number): string {
  if (failed > 0) {
    return `Workflow completed ${completed} step(s), failed ${failed}, skipped ${skipped}.`;
  }
  return `Workflow completed ${completed} step(s) with ${skipped} skipped.`;
}

export { createWorkflow, createWorkflowStep };
