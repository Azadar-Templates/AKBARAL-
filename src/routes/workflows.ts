import { Router } from 'express';
import { createExecutionPlan } from '../orchestrator/planner';
import { runWorkflow } from '../orchestrator/workflow-runner';
import { createAgentTask, dispatchAgentExecution } from '../orchestrator/executor';
import { getWorkflow, listWorkflowSteps, db } from '../db';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { asyncRoute, HttpError } from '../server/http';
import { getBody, optionalString, requireString } from '../server/middleware/validation';
import type { ExecutionStream } from '../realtime/execution-stream';

export function createWorkflowsRouter(stream: ExecutionStream): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', (req: AuthenticatedRequest, res) => {
    const rows = db.all(
      `SELECT * FROM workflows WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.auth!.userId],
    );
    res.status(200).json({ workflows: rows });
  });

  router.post(
    '/master',
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const body = getBody(req);
      const goal = requireString(body, 'goal', 'goal');
      const projectId = optionalString(body, 'project_id');
      const plan = createExecutionPlan({
        userId: req.auth!.userId,
        projectId: projectId ?? null,
        goal,
      });
      res.status(202).json({
        workflow: { id: plan.workflowId, status: 'planned' },
        plan: {
          intents: plan.plan.intents,
          steps: plan.plan.steps,
          notes: plan.plan.notes,
        },
      });
    }),
  );

  router.post(
    '/:id/run',
    (req: AuthenticatedRequest, res) => {
      const workflow = getWorkflow(req.params.id);
      if (!workflow || String(workflow.user_id) !== req.auth!.userId) {
        throw new HttpError(404, 'workflow not found', 'not_found');
      }
      void runWorkflow(req.params.id, stream);
      res.status(202).json({ workflow: { id: req.params.id, status: 'running' } });
    },
  );

  router.get('/:id', (req: AuthenticatedRequest, res) => {
    const workflow = getWorkflow(req.params.id);
    if (!workflow || String(workflow.user_id) !== req.auth!.userId) {
      throw new HttpError(404, 'workflow not found', 'not_found');
    }
    res.status(200).json({
      workflow,
      steps: listWorkflowSteps(req.params.id),
    });
  });

  router.post(
    '/agent',
    (req: AuthenticatedRequest, res) => {
      const body = getBody(req);
      const agentSlug = requireString(body, 'agent_slug', 'agent_slug');
      const goal = requireString(body, 'goal', 'goal');
      const projectId = optionalString(body, 'project_id');
      let dispatched;
      try {
        dispatched = createAgentTask({
          userId: req.auth!.userId,
          agentSlug,
          goal,
          projectId: projectId ?? null,
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'requires_pro') {
          throw new HttpError(402, (error as Error).message, 'requires_pro');
        }
        throw new HttpError(400, (error as Error).message, 'agent_dispatch_failed');
      }
      void dispatchAgentExecution(dispatched.executionId, agentSlug, stream);
      res.status(202).json({
        task: {
          id: dispatched.taskId,
          status: 'queued',
          agentId: dispatched.agentId,
          agentSlug,
          executionId: dispatched.executionId,
        },
        freeCredits: dispatched.freeCredits,
      });
    },
  );

  return router;
}
