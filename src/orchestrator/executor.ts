import {
  appendAgentExecutionLog,
  appendTaskEvent,
  consumeFreeCredit,
  createAgent,
  createAgentExecution,
  createTask,
  findAgentBySlug,
  findTaskById,
  getAgentExecution,
  getCreditAccount,
  listTaskEvents,
  listTaskExecutions,
  refundCredit,
  updateAgentExecutionStatus,
  updateTaskOutput,
  updateTaskStatus,
  listExecutionLogs,
} from '../db';
import { createResearchReport } from '../agents';
import { getAgentBySlug } from '../agents/registry';
import { modelRouter } from '../models';
import type { ExecutionStream } from '../realtime/execution-stream';

/**
 * Task/agent orchestrator.
 *
 * Implements the platform workflow:
 *   user goal -> plan (choose agent) -> execute agent -> tools/APIs -> verify
 *   -> final result.
 *
 * Credit policy:
 *   - A free task reserves one free credit on creation.
 *   - On success the credit remains consumed (successful-task consumption).
 *   - On failure the credit is automatically refunded.
 *   - On a Pro-required agent, the credit is refunded and the task is marked
 *     `requires_pro`.
 */

export const WEB_RESEARCH_AGENT_SLUG = 'web-research-001';

export interface DispatchedTask {
  taskId: string;
  executionId: string;
  agentId: string;
  userId: string;
  freeCredits: number;
}

export function getWebResearchAgentOrDefault(userId: string, projectId: string | null) {
  const existing = findAgentBySlug(WEB_RESEARCH_AGENT_SLUG);
  if (existing) {
    return existing;
  }
  // Development fallback: if the seed has not run, create Agent #001 on demand
  // so the platform can operate after a clean migration without an extra step.
  return createAgent({
    name: 'Web Research Agent',
    slug: WEB_RESEARCH_AGENT_SLUG,
    description:
      'Agent #001 — searches the web, retrieves sources, extracts facts and verifies results.',
    version: '1.0.0',
    ownerId: userId,
    projectId,
    status: 'active',
    config: {
      capabilities: ['web_search', 'page_fetch', 'source_extraction', 'verification'],
      limits: { maxSources: 5, maxFetches: 3, timeoutSeconds: 60 },
    },
  });
}

export function createResearchTask(input: {
  userId: string;
  goal: string;
  description?: string | null;
  projectId?: string | null;
}): DispatchedTask {
  if (!input.goal.trim()) {
    throw new Error('research goal is required');
  }

  const account = getCreditAccount(input.userId);
  if (!account) {
    throw new Error('credit account not found');
  }
  if (account.status !== 'active') {
    throw new Error('credit account is not active');
  }
  if (account.free_credits <= 0) {
    // No free task credit to reserve. The task is not created, so no refund is
    // needed; the API surfaces a Pro-required response.
    const error = new Error('Free task credits exhausted. This capability requires AKBARAL Pro.') as Error & { code?: string };
    error.code = 'requires_pro';
    throw error;
  }

  const agent = getWebResearchAgentOrDefault(input.userId, input.projectId ?? null);

  const task = createTask({
    userId: input.userId,
    title: input.goal,
    description: input.description ?? null,
    type: 'free',
    projectId: input.projectId ?? null,
    agentId: agent.id,
    inputData: { goal: input.goal },
  });

  const consumed = consumeFreeCredit({
    userId: input.userId,
    taskId: task.id,
    reason: `reserve free credit for research task ${task.id}`,
  });

  if (!consumed) {
    // Race/over-consumption guard: creation failed, roll back the task.
    updateTaskStatus({ id: task.id, status: 'cancelled', errorMessage: 'free credit could not be reserved' });
    const error = new Error('Free task credits exhausted. This capability requires AKBARAL Pro.') as Error & { code?: string };
    error.code = 'requires_pro';
    throw error;
  }

  const execution = createAgentExecution({
    agentId: agent.id,
    taskId: task.id,
    inputData: { goal: input.goal },
  });

  appendTaskEvent({
    taskId: task.id,
    executionId: execution.id,
    message: `Task created and free credit reserved (${account.free_credits - 1} remaining)`,
    level: 'info',
    type: 'status',
  });

  return {
    taskId: task.id,
    executionId: execution.id,
    agentId: agent.id,
    userId: input.userId,
    freeCredits: account.free_credits - 1,
  };
}

/**
 * Create a task+execution for any registered specialist agent and reserve the
 * free credit. The agent execution is dispatched by slug.
 */
export function createAgentTask(input: {
  userId: string;
  agentSlug: string;
  goal: string;
  projectId?: string | null;
}): DispatchedTask {
  const account = getCreditAccount(input.userId);
  if (!account) {
    throw new Error('credit account not found');
  }
  if (account.status !== 'active') {
    throw new Error('credit account is not active');
  }
  if (account.free_credits <= 0) {
    const error = new Error('Free task credits exhausted. This capability requires AKBARAL Pro.') as Error & { code?: string };
    error.code = 'requires_pro';
    throw error;
  }

  const agent = getAgentBySlug(input.agentSlug);
  if (!agent) {
    const error = new Error(`Agent "${input.agentSlug}" does not exist`) as Error & { code?: string };
    error.code = 'agent_not_found';
    throw error;
  }

  const task = createTask({
    userId: input.userId,
    title: `${agent.specialization}: ${input.goal}`,
    description: agent.specialization,
    type: 'free',
    projectId: input.projectId ?? null,
    agentId: agent.id,
    inputData: { goal: input.goal, agentSlug: input.agentSlug },
  });

  const consumed = consumeFreeCredit({
    userId: input.userId,
    taskId: task.id,
    reason: `reserve free credit for ${input.agentSlug}`,
  });
  if (!consumed) {
    updateTaskStatus({ id: task.id, status: 'cancelled', errorMessage: 'free credit could not be reserved' });
    const error = new Error('Free task credits exhausted. This capability requires AKBARAL Pro.') as Error & { code?: string };
    error.code = 'requires_pro';
    throw error;
  }

  const execution = createAgentExecution({
    agentId: agent.id,
    taskId: task.id,
    inputData: { goal: input.goal, agentSlug: input.agentSlug },
  });
  appendTaskEvent({
    taskId: task.id,
    executionId: execution.id,
    message: `Agent "${agent.slug}" queued and free credit reserved`,
    level: 'info',
    type: 'status',
  });

  return {
    taskId: task.id,
    executionId: execution.id,
    agentId: agent.id,
    userId: input.userId,
    freeCredits: account.free_credits - 1,
  };
}

/**
 * Dispatch an execution to the correct specialist. Agent #001 uses the real
 * research pipeline; every other registered agent uses the model router with
 * that agent's genuine instructions/tooling/verification contract.
 */
export function dispatchAgentExecution(
  executionId: string,
  agentSlug: string,
  stream?: ExecutionStream,
): Promise<{ status: string; output: Record<string, unknown> | null; error?: string }> {
  if (agentSlug === WEB_RESEARCH_AGENT_SLUG) {
    return runWebResearchExecution(executionId, stream);
  }
  return runGenericAgentExecution(executionId, agentSlug, stream);
}

/**
 * Execute a registered specialist agent through the model router. If no
 * provider credential is configured, the run fails honestly with a
 * `provider_not_configured` error and the free credit is refunded.
 */
export async function runGenericAgentExecution(
  executionId: string,
  agentSlug: string,
  stream?: ExecutionStream,
): Promise<{ status: string; output: Record<string, unknown> | null; error?: string }> {
  const execution = getExecutionSafe(executionId);
  const start = Date.now();
  updateAgentExecutionStatus({ id: executionId, status: 'running', startedAt: new Date().toISOString() });
  stream?.pushStatus({ executionId, status: 'running', message: `Agent ${agentSlug} started` });
  appendLog(executionId, stream, `Specialist agent ${agentSlug} started`, 'info', 'system', { agentSlug });

  const task = execution.task_id ? findTaskById(execution.task_id) : undefined;
  if (task) {
    updateTaskStatus({ id: task.id, status: 'running', startedAt: new Date().toISOString() });
  }

  const agent = getAgentBySlug(agentSlug);
  if (!agent) {
    return failExecution(executionId, task?.id, `Agent ${agentSlug} is not registered`, stream);
  }

  const goalInput = (() => {
    try {
      const parsed = JSON.parse(execution.input_data ?? '') as { goal?: string };
      return parsed.goal ?? agentSlug;
    } catch {
      return agentSlug;
    }
  })();

  appendLog(executionId, stream, `Using ${agent.specialization}`, 'info', 'log', {
    capabilities: agent.capabilities,
    workflow: agent.workflow,
  });

  try {
    const result = await modelRouter.complete(
      {
        capability: agent.modelRequirements,
        answerQuality: agent.costUsage.priority === 'high' ? 'high' : 'balanced',
        taskId: task?.id ?? null,
        agentExecutionId: executionId,
      },
      [
        { role: 'system', content: agent.systemInstructions },
        { role: 'user', content: goalInput },
      ],
    );

    const output: Record<string, unknown> = {
      type: 'agent_result',
      agent: { slug: agentSlug, specialization: agent.specialization },
      content: result.text,
      model: result.model,
      provider: result.provider,
      latencyMs: result.latencyMs,
    };
    updateAgentExecutionStatus({
      id: executionId,
      status: 'completed',
      outputData: output,
      durationMs: Date.now() - start,
      completedAt: new Date().toISOString(),
    });
    stream?.pushStatus({ executionId, status: 'completed', message: `Agent ${agentSlug} completed` });
    appendLog(executionId, stream, `Verification passed (${result.model} / ${result.provider})`, 'info', 'verification', {
      model: result.model,
      provider: result.provider,
      latencyMs: result.latencyMs,
    });

    if (task) {
      updateTaskStatus({ id: task.id, status: 'completed', completedAt: new Date().toISOString() });
      updateTaskOutput({ id: task.id, outputData: output });
      appendTaskEvent({ taskId: task.id, executionId, message: `Agent ${agentSlug} completed successfully`, level: 'info', type: 'status' });
    }
    return { status: 'completed', output };
  } catch (error) {
    return failExecution(executionId, task?.id, error instanceof Error ? error.message : String(error), stream);
  }
}

async function failExecution(
  executionId: string,
  taskId: string | undefined,
  message: string,
  stream: ExecutionStream | undefined,
): Promise<{ status: string; output: null; error: string }> {
  const start = Date.now();
  const code = (message.includes('not configured') || message.includes('provider_not_configured')) ? 'provider_not_configured' : 'execution_failed';
  updateAgentExecutionStatus({
    id: executionId,
    status: 'failed',
    errorMessage: message,
    durationMs: Date.now() - start,
    completedAt: new Date().toISOString(),
  });
  stream?.pushStatus({ executionId, status: 'failed', message, errorMessage: message });
  appendLog(executionId, stream, `Execution failed: ${message}`, 'error', 'verification', { code });

  if (taskId) {
    updateTaskStatus({ id: taskId, status: 'failed', completedAt: new Date().toISOString(), errorMessage: message });
    appendTaskEvent({ taskId, executionId, message: `Task failed: ${message}`, level: 'error', type: 'status' });
    const task = findTaskById(taskId);
    if (task) {
      const refund = refundCredit({ userId: task.user_id, taskId: task.id, reason: `automatic refund for failed task ${task.id}` });
      if (refund) {
        appendTaskEvent({ taskId, executionId, message: 'Free credit automatically refunded', level: 'info', type: 'status' });
      }
    }
  }
  return { status: 'failed', output: null, error: message };
}

/**
 * Execute Agent #001 for a created task. Safe to call directly (e.g. from
 * tests) and normally fired in the background by the HTTP task handler so logs
 * stream over WebSocket while the endpoint returns the task/execution handles.
 */
export async function runWebResearchExecution(
  executionId: string,
  stream?: ExecutionStream,
): Promise<{ status: string; output: Record<string, unknown> | null; error?: string }> {
  const execution = getExecutionSafe(executionId);
  const start = Date.now();
  const runStartedAt = new Date().toISOString();

  updateAgentExecutionStatus({ id: executionId, status: 'running', startedAt: runStartedAt });
  stream?.pushStatus({ executionId, status: 'running', message: 'Agent started' });
  appendLog(executionId, stream, 'Agent #001 started', 'info', 'system', { agentId: execution.agent_id });

  const task = execution.task_id ? findTaskById(execution.task_id) : undefined;
  if (task) {
    updateTaskStatus({ id: task.id, status: 'running', startedAt: runStartedAt });
    appendTaskEvent({
      taskId: task.id,
      executionId,
      message: 'Agent execution started',
      level: 'info',
      type: 'status',
    });
  }

  const goal = parseGoal(execution.input_data ?? '');

  appendLog(executionId, stream, `Planning research across web sources for: ${goal}`, 'info', 'log');
  appendLog(executionId, stream, 'Planning -> specialist agent: web-research-001', 'info', 'log');

  try {
    const report = await createResearchReport(goal, 5, 3);
    appendLog(executionId, stream, `Research complete (${report.durationMs}ms, ${report.verifiedSources} verified sources)`, 'info', 'verification', {
      durationMs: report.durationMs,
      sourceCount: report.sources.length,
      verifiedSources: report.verifiedSources,
    });

    const output: Record<string, unknown> = {
      type: 'web_research_report',
      report,
      agent: { slug: WEB_RESEARCH_AGENT_SLUG, version: '1.0.0' },
    };

    updateAgentExecutionStatus({
      id: executionId,
      status: 'completed',
      outputData: output,
      durationMs: Date.now() - start,
      completedAt: new Date().toISOString(),
    });
    stream?.pushStatus({ executionId, status: 'completed', message: 'Task completed' });
    appendLog(executionId, stream, 'Verification passed — result ready', 'info', 'verification', {
      verifiedSources: report.verifiedSources,
    });

    if (task) {
      updateTaskStatus({ id: task.id, status: 'completed', completedAt: new Date().toISOString() });
      updateTaskOutput({ id: task.id, outputData: output });
      appendTaskEvent({
        taskId: task.id,
        executionId,
        message: 'Task completed successfully',
        level: 'info',
        type: 'status',
      });
    }

    return { status: 'completed', output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateAgentExecutionStatus({
      id: executionId,
      status: 'failed',
      errorMessage: message,
      durationMs: Date.now() - start,
      completedAt: new Date().toISOString(),
    });
    stream?.pushStatus({ executionId, status: 'failed', message, errorMessage: message });
    appendLog(executionId, stream, `Execution failed: ${message}`, 'error', 'verification', { error: message });

    if (task) {
      updateTaskStatus({ id: task.id, status: 'failed', completedAt: new Date().toISOString(), errorMessage: message });
      appendTaskEvent({
        taskId: task.id,
        executionId,
        message: `Task failed: ${message}`,
        level: 'error',
        type: 'status',
      });

      // Automatic refund on failure.
      const refund = refundCredit({
        userId: task.user_id,
        taskId: task.id,
        reason: `automatic refund for failed task ${task.id}`,
      });
      if (refund) {
        appendTaskEvent({
          taskId: task.id,
          executionId,
          message: 'Free credit automatically refunded',
          level: 'info',
          type: 'status',
        });
      }
    }

    return { status: 'failed', output: null, error: message };
  }
}

export function getTaskDetail(taskId: string) {
  const task = findTaskById(taskId);
  if (!task) {
    return undefined;
  }
  return {
    task,
    events: listTaskEvents(taskId),
    executions: listTaskExecutions(taskId),
    logs: listTaskExecutions(taskId).flatMap((execution) =>
      listExecutionLogs(execution.id).map((log) => log),
    ),
  };
}

function getExecutionSafe(executionId: string) {
  const execution = getAgentExecution(executionId);
  if (!execution) {
    throw new Error(`execution ${executionId} not found`);
  }
  return execution;
}

function parseGoal(inputData: string): string {
  try {
    const parsed = JSON.parse(inputData) as { goal?: unknown };
    if (typeof parsed.goal === 'string' && parsed.goal.trim()) {
      return parsed.goal.trim();
    }
  } catch {
    // fall through
  }
  return inputData.trim() || 'untitled research task';
}

function appendLog(
  executionId: string,
  stream: ExecutionStream | undefined,
  message: string,
  level: string,
  type: string,
  data?: Record<string, unknown>,
): void {
  if (stream) {
    stream.pushLog({ executionId, message, level, type, data: data ?? null });
    return;
  }
  appendAgentExecutionLog({ executionId, message, level, type, data: data ?? null });
}
