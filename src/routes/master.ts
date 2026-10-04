import { Router } from 'express';
import { HttpError, asyncRoute, businessErrorToHttp } from '../server/http';
import { analyzeGoal } from '../orchestrator/goal-analyzer';
import { createExecutionPlan } from '../orchestrator/planner';
import { assertEmergencyStopDisabled } from '../orchestrator/executor';
import { executionQueue } from '../orchestrator/queue';
import { db, getWorkflow, listWorkflowSteps } from '../db';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { getBody, optionalString, requireString } from '../server/middleware/validation';
import type { ExecutionStream } from '../realtime/execution-stream';
import { publicErrorMessage, toPublicFailure, withPublicErrorMessage } from '../server/safe-errors';
import { Buffer } from 'node:buffer';

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
export function createMasterRouter(_stream: ExecutionStream): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    '/',
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const body = getBody(req);
      const goal = requireString(body, 'goal', 'goal');
      const projectId = optionalString(body, 'project_id');
      const autoRun = body.auto_run === undefined ? true : Boolean(body.auto_run);
      // Attachments (Build #4 §1): owner-verified file ids — every id must
      // belong to the caller and not be claimed by another task yet.
      const rawAttachmentIds = Array.isArray(body.attachment_file_ids)
        ? (body.attachment_file_ids as unknown[]).filter((id): id is string => typeof id === 'string')
        : [];
      const attachmentFileIds = [...new Set(rawAttachmentIds)].slice(0, 5);
      if (attachmentFileIds.length > 0) {
        const owned = db.all<{ n: number }>(
          `SELECT COUNT(*) AS n FROM files WHERE user_id = ? AND task_id IS NULL AND id IN (${attachmentFileIds.map(() => '?').join(', ')})`,
          [req.auth!.userId, ...attachmentFileIds],
        );
        if (Number((owned[0] as { n: number } | undefined)?.n ?? 0) !== attachmentFileIds.length) {
          throw new HttpError(400, 'attachment files not found or already attached', 'invalid_request');
        }
      }

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

      // Stages 3-6 run on the persistent execution engine: tools ->
      // execution -> verification -> synthesis, with retries, timeouts and
      // cancellation. Logs stream over the existing WebSocket channel.
      let jobInfo: { id: string; status: string; attempts: number; maxAttempts: number } | null = null;
      if (autoRun) {
        const { job } = executionQueue.enqueueWorkflow({
          workflowId: planned.workflowId,
          userId: req.auth!.userId,
          ...(attachmentFileIds.length > 0 ? { attachmentFileIds } : {}),
        });
        jobInfo = { id: job.id, status: job.status, attempts: job.attempts, maxAttempts: job.max_attempts };
      }

      res.status(202).json({
        workflow: {
          id: planned.workflowId,
          status: autoRun ? 'running' : 'planned',
        },
        job: jobInfo,
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

  // Six-stage SSE projection for the typed Work shell. Every status is derived
  // from persisted workflow/step state; no synthetic completion is emitted.
  router.get('/:id/events', (req: AuthenticatedRequest, res) => {
    const workflow = getWorkflow(req.params.id);
    if (!workflow || String(workflow.user_id) !== req.auth!.userId) {
      throw new HttpError(404, 'workflow not found', 'not_found');
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let lastPayload = '';
    const publish = () => {
      const current = getWorkflow(req.params.id);
      if (!current || res.destroyed) return;
      const steps = listWorkflowSteps(req.params.id);
      const workflowStatus = String(current.status);
      const completed = steps.filter((step) => String(step.status) === 'completed').length;
      const failed = steps.some((step) => ['failed', 'cancelled'].includes(String(step.status)));
      const total = steps.length;
      const terminal = ['completed', 'failed', 'cancelled'].includes(workflowStatus);
      const stageStatus = (index: number): 'complete' | 'active' | 'pending' | 'failed' => {
        if (failed && index >= 3) return 'failed';
        if (index <= 2) return 'complete';
        if (workflowStatus === 'completed') return 'complete';
        if (index === 3) return completed < total ? 'active' : 'complete';
        if (index === 4) return completed === total && total > 0 ? 'active' : 'pending';
        return 'pending';
      };
      const payload = JSON.stringify({
        type: terminal ? 'done' : 'progress',
        workflowId: req.params.id,
        workflowStatus,
        completedSteps: completed,
        totalSteps: total,
        stages: ['Understanding', 'Planning', 'Routing', 'Executing', 'Verifying', 'Complete'].map((label, index) => ({ label, status: stageStatus(index) })),
      });
      if (payload !== lastPayload) {
        lastPayload = payload;
        res.write(`data: ${payload}\n\n`);
      }
      if (terminal) {
        clearInterval(timer);
        res.end();
      }
    };
    const timer = setInterval(publish, 1_000);
    publish();
    res.on('close', () => clearInterval(timer));
  });

  // Authenticated, owner-scoped bundle export. The archive contains only the
  // persisted result for this workflow; no client-created Blob is trusted.
  router.get('/:id/export', (req: AuthenticatedRequest, res) => {
    const workflow = getWorkflow(req.params.id);
    if (!workflow || String(workflow.user_id) !== req.auth!.userId) throw new HttpError(404, 'workflow not found', 'not_found');
    const result = String(workflow.result_json ?? '{}');
    const name = 'artifact.json';
    const data = Buffer.from(result, 'utf8');
    const crc32 = (input: Buffer) => { let crc = 0xffffffff; for (const byte of input) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; };
    const crc = crc32(data);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28); nameBytes.copy(local, 30);
    const central = Buffer.alloc(46 + nameBytes.length); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(0, 42); nameBytes.copy(central, 46);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length + data.length, 16);
    res.setHeader('content-type', 'application/zip'); res.setHeader('content-disposition', `attachment; filename="akbaral-${req.params.id}.zip"`); res.status(200).send(Buffer.concat([local, data, central, end]));
  });

  router.get('/:id', (req: AuthenticatedRequest, res) => {
    const workflow = getWorkflow(req.params.id);
    if (!workflow || String(workflow.user_id) !== req.auth!.userId) {
      throw new HttpError(404, 'workflow not found', 'not_found');
    }
    const steps = listWorkflowSteps(req.params.id);
    const job = executionQueue.getJobByWorkflowId(req.params.id) ?? null;
    // error_message columns are raw operator diagnostics; the API only ever
    // emits the public copy (see src/server/safe-errors.ts).
    const tasks = steps
      .map((step) => (step.task_id ? String(step.task_id) : null))
      .filter((taskId): taskId is string => Boolean(taskId))
      .map((taskId) =>
        db.get<Record<string, unknown>>('SELECT id, status, title, error_message, created_at, completed_at FROM tasks WHERE id = ?', [taskId]),
      )
      .map((row) => (row ? { ...row, error_message: publicErrorMessage(row.error_message) } : row));
    res.status(200).json({
      workflow: withPublicErrorMessage(workflow),
      steps: steps.map(withPublicErrorMessage),
      tasks,
      job: job
        ? (() => {
            const failure = toPublicFailure({ code: job.error_code, message: job.error_message });
            return {
              id: job.id,
              status: job.status,
              attempts: job.attempts,
              maxAttempts: job.max_attempts,
              errorCode: job.error_message || job.error_code ? failure.code : null,
              errorMessage: job.error_message ? failure.message : null,
            };
          })()
        : null,
      finalResult: workflow.result_json ? JSON.parse(String(workflow.result_json))?.finalResult ?? null : null,
    });
  });

  return router;
}
