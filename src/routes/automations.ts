import { Router } from 'express';
import { HttpError, asyncRoute, businessErrorToHttp } from '../server/http';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { rateLimit } from '../server/middleware/rate-limit';
import { getBody } from '../server/middleware/validation';
import { appendAuditLog, db } from '../db';
import {
  countActiveAutomationsByUser,
  deleteAutomationRow,
  getAutomationRow,
  listAutomationRowsByUser,
  listAutomationRunRows,
  settleAutomationRun,
  setAutomationStatus,
  updateAutomationRow,
  createAutomationRow,
  type AutomationRow,
} from '../db/automation-repositories';
import { executionQueue } from '../orchestrator/queue';
import { automationScheduler } from '../automation/scheduler';
import { AUTOMATION_LIMITS, firstOccurrence, parseAutomationInput } from '../automation/validate';

/**
 * Automation & scheduled workflows API.
 *
 * Security model:
 *   - every route requires a valid bearer session (requireAuth);
 *   - every automation/run access is scoped to its owner — cross-user access
 *     is reported as an indistinguishable 404 (no existence oracle);
 *   - strict server-side validation of all client input (parseAutomationInput);
 *   - per-IP rate limits on top of the global API limiter;
 *   - audit log entries for every state-changing action;
 *   - automation definitions never contain secrets — agent/tool credentials
 *     live server-side only (same as the MASTER API).
 */

function requireOwnedAutomation(req: AuthenticatedRequest): AutomationRow {
  const automation = getAutomationRow(req.params.id);
  if (!automation || automation.user_id !== req.auth!.userId) {
    throw new HttpError(404, 'automation not found', 'not_found');
  }
  return automation;
}

function serializeAutomation(row: AutomationRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    schedule: JSON.parse(row.schedule_json),
    condition: row.condition_json ? JSON.parse(row.condition_json) : null,
    steps: JSON.parse(row.steps_json),
    timeoutMs: row.timeout_ms,
    maxRetries: row.max_retries,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    runCount: row.run_count,
    failCount: row.fail_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeRun(row: Record<string, unknown>): Record<string, unknown> {
  const { id, automation_id, workflow_id, job_id, status, trigger_reason, scheduled_for, started_at, finished_at, error_message, attempt, created_at } =
    row as Record<string, string>;
  return {
    id,
    automationId: automation_id,
    workflowId: workflow_id,
    jobId: job_id,
    status,
    triggerReason: trigger_reason,
    scheduledFor: scheduled_for,
    startedAt: started_at,
    finishedAt: finished_at,
    errorMessage: error_message,
    attempt,
    createdAt: created_at,
  };
}

export function createAutomationsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  // Abuse protection on top of the global limiter: automation management is
  // low-volume; bursts indicate scripting or probing.
  router.use(rateLimit({ prefix: 'automations', max: 60, windowMs: 60_000 }));

  router.get('/', (req: AuthenticatedRequest, res) => {
    const rows = listAutomationRowsByUser(req.auth!.userId);
    res.status(200).json({ automations: rows.map(serializeAutomation) });
  });

  router.post(
    '/',
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const body = getBody(req);
      const definition = parseAutomationInput(body, req.auth!.userId);
      if (countActiveAutomationsByUser(req.auth!.userId) >= AUTOMATION_LIMITS.maxPerUser) {
        throw new HttpError(409, `at most ${AUTOMATION_LIMITS.maxPerUser} active automations are allowed per account`, 'limit_reached');
      }
      const nextMs = firstOccurrence(definition.schedule, Date.now());
      const automation = createAutomationRow({
        userId: req.auth!.userId,
        name: definition.name,
        description: definition.description,
        scheduleJson: JSON.stringify(definition.schedule),
        conditionJson: definition.condition ? JSON.stringify(definition.condition) : null,
        stepsJson: JSON.stringify(definition.steps),
        timeoutMs: definition.timeoutMs,
        maxRetries: definition.maxRetries,
        nextRunAt: nextMs === null ? null : new Date(nextMs).toISOString(),
      });
      appendAuditLog({
        actorId: req.auth!.userId,
        action: 'automation.created',
        resourceType: 'automation',
        resourceId: automation.id,
        description: `created automation "${automation.name}"`,
        metadata: { schedule: definition.schedule, steps: definition.steps.length },
      });
      res.status(201).json({ automation: serializeAutomation(automation) });
    }),
  );

  router.get('/:id', (req: AuthenticatedRequest, res) => {
    const automation = requireOwnedAutomation(req);
    res.status(200).json({ automation: serializeAutomation(automation) });
  });

  router.patch(
    '/:id',
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const automation = requireOwnedAutomation(req);
      const body = getBody(req);
      const definition = parseAutomationInput(body, req.auth!.userId);
      const nextMs = firstOccurrence(definition.schedule, Date.now());
      const applied = updateAutomationRow({
        id: automation.id,
        name: definition.name,
        description: definition.description,
        scheduleJson: JSON.stringify(definition.schedule),
        conditionJson: definition.condition ? JSON.stringify(definition.condition) : null,
        stepsJson: JSON.stringify(definition.steps),
        timeoutMs: definition.timeoutMs,
        maxRetries: definition.maxRetries,
        // A paused automation stays paused on edit (no surprise wake-ups);
        // next occurrence is recomputed for when it is resumed.
        nextRunAt: automation.status === 'active' && nextMs !== null ? new Date(nextMs).toISOString() : null,
      });
      if (!applied) {
        throw new HttpError(404, 'automation not found', 'not_found');
      }
      appendAuditLog({
        actorId: req.auth!.userId,
        action: 'automation.updated',
        resourceType: 'automation',
        resourceId: automation.id,
        description: `updated automation "${definition.name}"`,
        metadata: { schedule: definition.schedule, steps: definition.steps.length },
      });
      res.status(200).json({ automation: serializeAutomation(getAutomationRow(automation.id) as AutomationRow) });
    }),
  );

  router.post('/:id/pause', (req: AuthenticatedRequest, res) => {
    const automation = requireOwnedAutomation(req);
    if (automation.status !== 'active') {
      throw new HttpError(409, `automation is already ${automation.status}`, 'conflict');
    }
    setAutomationStatus(automation.id, 'paused', null);
    appendAuditLog({
      actorId: req.auth!.userId,
      action: 'automation.paused',
      resourceType: 'automation',
      resourceId: automation.id,
      description: `paused automation "${automation.name}"`,
      metadata: {},
    });
    res.status(200).json({ automation: serializeAutomation(getAutomationRow(automation.id) as AutomationRow) });
  });

  router.post('/:id/resume', (req: AuthenticatedRequest, res) => {
    const automation = requireOwnedAutomation(req);
    if (automation.status !== 'paused') {
      throw new HttpError(409, `automation is ${automation.status}, not paused`, 'conflict');
    }
    // Recompute the next occurrence from now — paused time does not backfill.
    const schedule = JSON.parse(automation.schedule_json) as { kind: string };
    const nextMs = firstOccurrence(JSON.parse(automation.schedule_json), Date.now());
    if (schedule.kind !== 'once' && nextMs === null) {
      throw new HttpError(409, 'automation schedule never matches again — edit it before resuming', 'conflict');
    }
    setAutomationStatus(automation.id, 'active', nextMs === null ? null : new Date(nextMs).toISOString());
    appendAuditLog({
      actorId: req.auth!.userId,
      action: 'automation.resumed',
      resourceType: 'automation',
      resourceId: automation.id,
      description: `resumed automation "${automation.name}"`,
      metadata: { nextRunAt: nextMs },
    });
    res.status(200).json({ automation: serializeAutomation(getAutomationRow(automation.id) as AutomationRow) });
  });

  router.delete('/:id', (req: AuthenticatedRequest, res) => {
    const automation = requireOwnedAutomation(req);
    // Cancel any open run first (graceful: refunds the in-flight step task).
    const openRuns = listAutomationRunRows(automation.id, 50).filter((run) => run.status === 'queued' || run.status === 'running');
    for (const run of openRuns) {
      if (run.job_id) {
        executionQueue.cancelJob(run.job_id, req.auth!.userId, `automation "${automation.name}" deleted`);
      }
      settleAutomationRun({ runId: run.id, status: 'cancelled', errorMessage: 'automation deleted' });
    }
    deleteAutomationRow(automation.id);
    appendAuditLog({
      actorId: req.auth!.userId,
      action: 'automation.deleted',
      resourceType: 'automation',
      resourceId: automation.id,
      description: `deleted automation "${automation.name}"`,
      metadata: { cancelledRuns: openRuns.length },
    });
    res.status(204).send();
  });

  /** Trigger a run immediately (guards still apply: credits, cooldown). */
  router.post('/:id/run', (req: AuthenticatedRequest, res) => {
    const automation = requireOwnedAutomation(req);
    try {
      const run = automationScheduler.triggerManualRun(automation);
      res.status(202).json({
        run: serializeRun(run as unknown as Record<string, unknown>),
        workflow: { id: run.workflow_id },
      });
    } catch (error) {
      throw businessErrorToHttp(error, 409, 'run_failed');
    }
  });

  /** Cancel an in-flight run of one of my automations. */
  router.post('/:id/runs/:runId/cancel', (req: AuthenticatedRequest, res) => {
    const automation = requireOwnedAutomation(req);
    const run = db.get<{ id: string; job_id: string | null; status: string }>(
      'SELECT id, job_id, status FROM automation_runs WHERE id = ? AND automation_id = ? AND user_id = ?',
      [req.params.runId, automation.id, req.auth!.userId],
    );
    if (!run) {
      throw new HttpError(404, 'run not found', 'not_found');
    }
    if (run.status !== 'queued' && run.status !== 'running') {
      throw new HttpError(409, `run is already ${run.status}`, 'conflict');
    }
    let cancelled = false;
    if (run.job_id) {
      cancelled = executionQueue.cancelJob(run.job_id, req.auth!.userId, 'cancelled by user').cancelled;
    }
    settleAutomationRun({ runId: run.id, status: 'cancelled', errorMessage: 'cancelled by user' });
    appendAuditLog({
      actorId: req.auth!.userId,
      action: 'automation.run_cancelled',
      resourceType: 'automation_run',
      resourceId: run.id,
      description: `cancelled run of automation "${automation.name}"`,
      metadata: { jobId: run.job_id, queueCancelled: cancelled },
    });
    res.status(200).json({ run: { id: run.id, status: 'cancelled' }, queueCancelled: cancelled });
  });

  router.get('/:id/runs', (req: AuthenticatedRequest, res) => {
    const automation = requireOwnedAutomation(req);
    const limit = Math.min(Number(req.query.limit ?? 25), 100);
    const rows = listAutomationRunRows(automation.id, limit);
    res.status(200).json({ runs: rows.map((row) => serializeRun(row as unknown as Record<string, unknown>)) });
  });

  return router;
}
