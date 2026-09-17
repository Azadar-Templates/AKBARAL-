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
      tools: rows.map((row) => ({
        ...row,
        implemented: implemented.has(String(row.key)),
        credentialConfigured: credentialConfigured(String(row.required_credential_env_key ?? '')),
      })),
    });
  });

  // Per-tool credential status. Never exposes credential values — only whether
  // each required environment variable is present, so clients can show which
  // tools are usable right now and which honestly report provider_not_configured.
  router.get('/credentials', (_req: AuthenticatedRequest, res) => {
    const rows = db.all(
      'SELECT key, name, kind, requires_credential, required_credential_env_key FROM tools ORDER BY kind, name',
    ) as Array<{ key: string; name: string; kind: string; requires_credential: number; required_credential_env_key: string | null }>;
    const implemented = new Set(listImplementedTools());
    const credentials = rows.map((row) => {
      const envKeys = (row.required_credential_env_key ?? '')
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
      const configured = envKeys.length > 0 && envKeys.every((key) => Boolean(process.env[key]));
      const usable = implemented.has(row.key) && (!row.requires_credential || configured);
      return {
        tool: row.key,
        name: row.name,
        kind: row.kind,
        implemented: implemented.has(row.key),
        requiresCredential: row.requires_credential === 1,
        requiredEnvKeys: envKeys,
        configured,
        usable,
      };
    });
    res.status(200).json({
      credentials,
      summary: {
        total: credentials.length,
        usable: credentials.filter((entry) => entry.usable).length,
        missingCredentials: credentials
          .filter((entry) => entry.implemented && entry.requiresCredential && !entry.configured)
          .map((entry) => entry.tool),
      },
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

function credentialConfigured(requiredEnvKey: string): boolean {
  const keys = requiredEnvKey.split(',').map((key) => key.trim()).filter(Boolean);
  return keys.length === 0 || keys.every((key) => Boolean(process.env[key]));
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
