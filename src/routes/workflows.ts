import { Router } from 'express';
import { HttpError, asyncRoute, businessErrorToHttp } from '../server/http';
import { createExecutionPlan } from '../orchestrator/planner';
import { createAgentTask, assertEmergencyStopDisabled } from '../orchestrator/executor';
import { executionQueue } from '../orchestrator/queue';
import { getWorkflow, listWorkflowSteps, db } from '../db';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { getBody, optionalString, requireString } from '../server/middleware/validation';
import type { ExecutionStream } from '../realtime/execution-stream';

export function createWorkflowsRouter(_stream: ExecutionStream): Router {
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
      try {
        assertEmergencyStopDisabled();
      } catch (error) {
        throw businessErrorToHttp(error);
      }
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
      try {
        assertEmergencyStopDisabled();
      } catch (error) {
        throw businessErrorToHttp(error);
      }
      const { job } = executionQueue.enqueueWorkflow({
        workflowId: req.params.id,
        userId: req.auth!.userId,
      });
      res.status(202).json({
        workflow: { id: req.params.id, status: job.status === 'queued' ? 'running' : job.status },
        job: { id: job.id, status: job.status, attempts: job.attempts, maxAttempts: job.max_attempts },
      });
    },
  );

  // Cancel a queued/running workflow and refund the in-flight step's task.
  router.post('/:id/cancel', (req: AuthenticatedRequest, res) => {
    const workflow = getWorkflow(req.params.id);
    if (!workflow || String(workflow.user_id) !== req.auth!.userId) {
      throw new HttpError(404, 'workflow not found', 'not_found');
    }
    const result = executionQueue.cancelWorkflow(req.params.id, req.auth!.userId, 'cancelled by user');
    if (!result.cancelled) {
      throw new HttpError(409, `workflow cannot be cancelled (current status: ${workflow.status})`, 'conflict');
    }
    res.status(200).json({ workflow: { id: req.params.id, status: 'cancelled' }, jobId: result.jobId ?? null });
  });

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
        throw businessErrorToHttp(error, 400, 'agent_dispatch_failed');
      }
      const { job } = executionQueue.enqueueAgentExecution({
        executionId: dispatched.executionId,
        agentSlug,
        taskId: dispatched.taskId,
        userId: req.auth!.userId,
      });
      res.status(202).json({
        task: {
          id: dispatched.taskId,
          status: 'queued',
          agentId: dispatched.agentId,
          agentSlug,
          executionId: dispatched.executionId,
        },
        job: { id: job.id, status: job.status, attempts: job.attempts, maxAttempts: job.max_attempts },
        freeCredits: dispatched.freeCredits,
      });
    },
  );

  return router;
}
