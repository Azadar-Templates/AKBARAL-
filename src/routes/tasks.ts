import { Router } from 'express';
import {
  findTaskById,
  getAgentExecution,
  getExecutionOwnerId,
  listExecutionLogs,
  listTaskEvents,
  listTaskExecutions,
  listTasksByUser,
} from '../db';
import { createResearchTask, runWebResearchExecution } from '../orchestrator/executor';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError, businessErrorToHttp } from '../server/http';
import { getBody, optionalString, requireString } from '../server/middleware/validation';
import type { ExecutionStream } from '../realtime/execution-stream';

/**
 * Task API. The WebSocket execution stream is passed in from the app bootstrap
 * so each task's background execution broadcasts its real-time logs.
 */
export function createTasksRouter(stream: ExecutionStream): Router {
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

    // Run in the background so the client gets handles immediately and can
    // subscribe to WebSocket logs while results stream in.
    void runWebResearchExecution(dispatched.executionId, stream);

    res.status(202).json({
      task: {
        id: dispatched.taskId,
        status: 'queued',
        agentId: dispatched.agentId,
        agentSlug: 'web-research-001',
        executionId: dispatched.executionId,
      },
      freeCredits: dispatched.freeCredits,
    });
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
