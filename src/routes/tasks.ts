import { Router } from 'express';
import {
  findTaskById,
  getAgentExecution,
  getExecutionOwnerId,
  listExecutionLogs,
  listTaskEvents,
  listTaskExecutions,
  listTasksByUser,
  getFile,
  listTaskFiles,
  attachFileToTask,
} from '../db';
import { createResearchTask, WEB_RESEARCH_AGENT_SLUG } from '../orchestrator/executor';
import { executionQueue } from '../orchestrator/queue';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError, businessErrorToHttp } from '../server/http';
import { getBody, optionalString, requireString } from '../server/middleware/validation';
import type { ExecutionStream } from '../realtime/execution-stream';

/**
 * Task API. The WebSocket execution stream is passed in from the app bootstrap
 * so each task's background execution broadcasts its real-time logs.
 */
export function createTasksRouter(_stream: ExecutionStream): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/research', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const goal = requireString(body, 'goal', 'goal');
    const description = optionalString(body, 'description');
    const projectId = optionalString(body, 'project_id');

    let dispatched;
    try {
      dispatched = createResearchTask({
        userId: req.auth!.userId,
        goal,
        description: description ?? null,
        projectId: projectId ?? null,
      });
    } catch (error) {
      throw businessErrorToHttp(error, 400, 'task_creation_failed');
    }

    // Enqueue on the persistent execution engine so the task survives
    // restarts, gets retries with backoff, timeouts and cancellation.
    const { job } = executionQueue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: WEB_RESEARCH_AGENT_SLUG,
      taskId: dispatched.taskId,
      userId: req.auth!.userId,
    });

    res.status(202).json({
      task: {
        id: dispatched.taskId,
        status: 'queued',
        agentId: dispatched.agentId,
        agentSlug: WEB_RESEARCH_AGENT_SLUG,
        executionId: dispatched.executionId,
      },
      job: { id: job.id, status: job.status, attempts: job.attempts, maxAttempts: job.max_attempts },
      freeCredits: dispatched.freeCredits,
    });
  });

  // User cancellation of a queued/running task. Never consumes the free task:
  // the reserved credit is refunded atomically.
  router.post('/:id/cancel', (req: AuthenticatedRequest, res) => {
    const task = findTaskById(req.params.id);
    if (!task || String(task.user_id) !== req.auth!.userId) {
      throw new HttpError(404, 'task not found', 'not_found');
    }
    const result = executionQueue.cancelTask(req.params.id, req.auth!.userId, 'cancelled by user');
    if (!result.cancelled) {
      throw new HttpError(409, `task cannot be cancelled (current status: ${task.status})`, 'conflict');
    }
    res.status(200).json({
      task: { id: req.params.id, status: 'cancelled' },
      jobId: result.jobId ?? null,
      freeTaskCredit: 'refunded',
    });
  });

  // ---- Task file attachments (Milestone 5) -------------------------------
  // Only the task owner may attach their own files; attached text content is
  // injected as user-provided data context into the agent execution.

  router.get('/:id/files', (req: AuthenticatedRequest, res) => {
    const task = findTaskById(req.params.id);
    if (!task || String(task.user_id) !== req.auth!.userId) {
      throw new HttpError(404, 'task not found', 'not_found');
    }
    const files = listTaskFiles(req.params.id).filter((file) => String(file.kind) !== 'artifact');
    res.status(200).json({ files });
  });

  router.post('/:id/files/:fileId', (req: AuthenticatedRequest, res) => {
    const task = findTaskById(req.params.id);
    if (!task || String(task.user_id) !== req.auth!.userId) {
      throw new HttpError(404, 'task not found', 'not_found');
    }
    const file = getFile(req.params.fileId);
    if (!file || String(file.user_id) !== req.auth!.userId) {
      throw new HttpError(404, 'file not found', 'not_found');
    }
    if (String(file.kind) === 'artifact') {
      throw new HttpError(409, 'artifacts cannot be attached to tasks', 'conflict');
    }
    if (file.task_id && String(file.task_id) !== req.params.id) {
      throw new HttpError(409, 'file is already attached to another task', 'conflict');
    }
    attachFileToTask(req.params.fileId, req.params.id);
    res.status(200).json({ attached: true, taskId: req.params.id, fileId: req.params.fileId });
  });

  router.delete('/:id/files/:fileId', (req: AuthenticatedRequest, res) => {
    const task = findTaskById(req.params.id);
    if (!task || String(task.user_id) !== req.auth!.userId) {
      throw new HttpError(404, 'task not found', 'not_found');
    }
    const file = getFile(req.params.fileId);
    if (!file || String(file.user_id) !== req.auth!.userId || String(file.task_id ?? '') !== req.params.id) {
      throw new HttpError(404, 'file is not attached to this task', 'not_found');
    }
    attachFileToTask(req.params.fileId, null);
    res.status(200).json({ detached: true });
  });

  router.get('/', (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const rows = listTasksByUser(userId, { limit, offset });
    res.status(200).json({ tasks: rows });
  });

  router.get('/execution/:id', (req: AuthenticatedRequest, res) => {
    const execution = getAgentExecution(req.params.id);
    if (!execution) {
      throw new HttpError(404, 'execution not found', 'not_found');
    }
    const ownerId = getExecutionOwnerId(execution.id);
    if (!ownerId || ownerId !== req.auth!.userId) {
      throw new HttpError(403, 'you do not have access to this execution', 'forbidden');
    }
    const logs = listExecutionLogs(execution.id);
    res.status(200).json({ execution, logs });
  });

  router.get('/:id', (req: AuthenticatedRequest, res) => {
    const task = findTaskById(req.params.id);
    if (!task || task.user_id !== req.auth!.userId) {
      throw new HttpError(404, 'task not found', 'not_found');
    }
    const executions = listTaskExecutions(task.id);
    const events = listTaskEvents(task.id);
    const logs = executions.flatMap((execution) => listExecutionLogs(execution.id));
    res.status(200).json({
      task,
      events,
      executions,
      logs,
    });
  });

  return router;
}
