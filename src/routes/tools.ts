import { Router } from 'express';
import { listImplementedTools } from '../tools';
import { runTool } from '../tools';
import { db, findProjectById, findTaskById, getExecutionOwnerId, listAgentTools } from '../db';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError, asyncRoute } from '../server/http';
import { getBody } from '../server/middleware/validation';

export function createToolsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', (_req: AuthenticatedRequest, res) => {
    const rows = db.all(
      'SELECT key, name, description, kind, requires_credential, required_credential_env_key, supports_streaming, status FROM tools ORDER BY kind, name',
    ) as Array<Record<string, unknown>>;
    const implemented = new Set(listImplementedTools());
    res.status(200).json({
      tools: rows.map((row) => ({ ...row, implemented: implemented.has(String(row.key)) })),
    });
  });

  router.post(
    '/:key/run',
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const body = getBody(req);
      const projectId = typeof body.project_id === 'string' ? body.project_id : null;
      const taskId = typeof body.task_id === 'string' ? body.task_id : null;
      const executionId = typeof body.execution_id === 'string' ? body.execution_id : null;
      assertToolContext(req.auth!.userId, projectId, taskId, executionId);
      const input = (body.input ?? {}) as Record<string, unknown>;
      const result = await runTool(req.params.key, input, {
        userId: req.auth!.userId,
        projectId,
        taskId,
        executionId,
      });
      res.status(result.ok ? 200 : 200).json({ result });
    }),
  );

  router.get('/agents/:slug', (req: AuthenticatedRequest, res) => {
    const agent = db.get<{ id: string }>('SELECT id FROM agents WHERE slug = ?', [req.params.slug]);
    if (!agent) {
      throw new HttpError(404, 'agent not found', 'not_found');
    }
    res.status(200).json({ tools: listAgentTools(agent.id) });
  });

  return router;
}

function assertToolContext(userId: string, projectId: string | null, taskId: string | null, executionId: string | null): void {
  if (projectId) {
    const project = findProjectById(projectId);
    if (!project || String(project.owner_id) !== userId) {
      throw new HttpError(403, 'project context does not belong to the current user', 'forbidden');
    }
  }
  if (taskId) {
    const task = findTaskById(taskId);
    if (!task || String(task.user_id) !== userId) {
      throw new HttpError(403, 'task context does not belong to the current user', 'forbidden');
    }
  }
  if (executionId) {
    const ownerId = getExecutionOwnerId(executionId);
    if (!ownerId || ownerId !== userId) {
      throw new HttpError(403, 'execution context does not belong to the current user', 'forbidden');
    }
  }
}
