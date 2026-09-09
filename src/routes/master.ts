import { Router } from 'express';
import { HttpError, asyncRoute, businessErrorToHttp } from '../server/http';
import { analyzeGoal } from '../orchestrator/goal-analyzer';
import { createExecutionPlan } from '../orchestrator/planner';
import { runWorkflow } from '../orchestrator/workflow-runner';
import { assertEmergencyStopDisabled } from '../orchestrator/executor';
import { db, getWorkflow, listWorkflowSteps } from '../db';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { getBody, optionalString, requireString } from '../server/middleware/validation';
import type { ExecutionStream } from '../realtime/execution-stream';

/**
 * MASTER AI one-shot API.
 *
 * POST /api/master  — the full pipeline entry point:
 *   USER GOAL -> goal analysis -> plan (specialist selection) -> workflow run
 *   (tools -> execution -> verification) -> synthesized FINAL RESULT.
 * Returns immediately with the workflow handle + the analysis/plan; execution
 * streams over WebSocket and the final result is served by GET /api/master/:id.
 *
 * GET /api/master/:id — workflow + step graph + final result document.
 */
export function createMasterRouter(stream: ExecutionStream): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    '/',
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const body = getBody(req);
      const goal = requireString(body, 'goal', 'goal');
      const projectId = optionalString(body, 'project_id');
      const autoRun = body.auto_run === undefined ? true : Boolean(body.auto_run);

      try {
        assertEmergencyStopDisabled();
      } catch (error) {
        throw businessErrorToHttp(error);
      }

      // Stage 1: goal analysis (LLM when a provider is configured, honest
      // heuristic fallback otherwise — mode is always disclosed).
      const analysis = await analyzeGoal({ goal });

      // Stage 2: plan (specialist selection from the 4,000+ registry).
      const planned = createExecutionPlan({
        userId: req.auth!.userId,
        projectId: projectId ?? null,
        goal,
        analysis,
      });

      // Stages 3-6 run in the background: tools -> execution -> verification
      // -> synthesis. Logs stream over the existing WebSocket channel.
      if (autoRun) {
        void runWorkflow(planned.workflowId, stream);
      }

      res.status(202).json({
        workflow: {
          id: planned.workflowId,
          status: autoRun ? 'running' : 'planned',
        },
        analysis: {
          mode: analysis.mode,
          intents: analysis.intents,
          deliverables: analysis.deliverables,
          constraints: analysis.constraints,
          complexity: analysis.complexity,
          clarifiers: analysis.clarifiers,
          notes: analysis.notes,
        },
        plan: {
          intents: planned.plan.intents,
          steps: planned.plan.steps,
          notes: planned.plan.notes,
        },
      });
    }),
  );

  router.get('/:id', (req: AuthenticatedRequest, res) => {
    const workflow = getWorkflow(req.params.id);
    if (!workflow || String(workflow.user_id) !== req.auth!.userId) {
      throw new HttpError(404, 'workflow not found', 'not_found');
    }
    const steps = listWorkflowSteps(req.params.id);
    const tasks = steps
      .map((step) => (step.task_id ? String(step.task_id) : null))
      .filter((taskId): taskId is string => Boolean(taskId))
      .map((taskId) =>
        db.get('SELECT id, status, title, error_message, created_at, completed_at FROM tasks WHERE id = ?', [taskId]),
      );
    res.status(200).json({
      workflow,
      steps,
      tasks,
      finalResult: workflow.result_json ? JSON.parse(String(workflow.result_json))?.finalResult ?? null : null,
    });
  });

  return router;
}
