import {
  attachRunExecution,
  bumpRunAttempt,
  getAutomationRunRow,
  getLastSettledAutomationRun,
  insertAutomationRun,
  listDueAutomations,
  listOpenAutomationRunRows,
  markRunRunning,
  recordAutomationFailure,
  recordAutomationFired,
  settleAutomationRun,
  setAutomationStatus,
  type AutomationRow,
  type AutomationRunRow,
} from '../db/automation-repositories';
import { db, getJob, getTrialStatus } from '../db';
import { appendAuditLog } from '../db';
import { executionQueue } from '../orchestrator/queue';
import { createWorkflow, createWorkflowStep } from '../db';
import { cronNextAfter } from './cron';
import type { AutomationCondition, AutomationSchedule, AutomationStep } from './validate';

/**
 * AutomationScheduler — durable, crash-safe automation engine.
 *
 * Responsibilities per tick:
 *   1. FIRE: every active automation whose next_run_at is due gets exactly
 *      one run row (UNIQUE idempotency key per occurrence — duplicates from
 *      restarts or racing instances are impossible), a persisted workflow
 *      built from its steps, and a queue job on the existing execution
 *      engine. Missed occurrences during downtime are NOT backfilled: after
 *      firing once, the schedule advances to the next future slot.
 *   2. RECONCILE: open runs are settled from the authoritative job/workflow
 *      state — this is what makes restarts and crashes safe. Runs stuck
 *      without a job (crash between insert and enqueue) are re-fired with a
 *      bounded attempt budget; runs exceeding their timeout are cancelled
 *      gracefully (which refunds the in-flight step's task credit through
 *      the queue's existing reconciliation).
 *
 * Conditions gate firing (evaluated server-side from persisted state).
 * Credits are checked before firing: an automation whose owner has no task
 * credits is auto-paused (with a notification) instead of looping uselessly.
 */

const RECOVERY_GRACE_MS = 60_000; // run stuck without a job before re-fire
const MAX_RECOVERY_ATTEMPTS = 3;
const MANUAL_RUN_COOLDOWN_MS = 10_000;

export interface SchedulerLogger {
  info(message: string): void;
  warn(message: string): void;
}

export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private readonly intervalMs: number;
  private readonly logger: SchedulerLogger;
  private readonly manualRuns = new Map<string, number>();

  constructor(options?: { intervalMs?: number; logger?: SchedulerLogger }) {
    this.intervalMs = options?.intervalMs ?? 1000;
    this.logger = options?.logger ?? console;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (error) {
        this.logger.warn(`[akbaral] automation tick failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
  }

  get isStarted(): boolean {
    return this.started;
  }

  /** One scheduler pass (also invoked directly by tests). */
  tick(): void {
    this.fireDue();
    this.reconcile();
  }

  // ---------------------------------------------------------------------------
  // Firing
  // ---------------------------------------------------------------------------

  private fireDue(): void {
    const now = new Date();
    for (const automation of listDueAutomations(now.toISOString())) {
      try {
        this.fireAutomation(automation, now);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[akbaral] automation ${automation.id} failed to fire: ${message}`);
        recordAutomationFailure(automation.id);
        // Advance past the failing occurrence so a broken automation cannot
        // hot-loop the scheduler; the failure is visible in the log + stats.
        this.advance(automation, null, now.getTime());
      }
    }
  }

  private fireAutomation(automation: AutomationRow, now: Date): void {
    const scheduledForMs = Date.parse(String(automation.next_run_at));
    const idempotencyKey = this.occurrenceKey(automation, scheduledForMs);

    // Duplicate protection: the run row is inserted FIRST with a UNIQUE key.
    const run = insertAutomationRun({
      automationId: automation.id,
      userId: automation.user_id,
      triggerReason: 'schedule',
      idempotencyKey,
      scheduledFor: automation.next_run_at,
    });
    if (!run) {
      // Occurrence already recorded — just make sure the schedule advanced.
      this.advance(automation, scheduledForMs, now.getTime());
      return;
    }

    // Condition gate (server-side, persisted state only).
    const conditionFailure = this.evaluateCondition(automation);
    if (conditionFailure !== null) {
      settleAutomationRun({ runId: run.id, status: 'skipped', errorMessage: conditionFailure });
      this.advance(automation, scheduledForMs, now.getTime());
      return;
    }

    // Credit pre-flight: auto-pause instead of firing no-op work in a loop.
    const trial = getTrialStatus(automation.user_id);
    if (trial.requiresPro) {
      settleAutomationRun({ runId: run.id, status: 'skipped', errorMessage: 'no task credits remaining' });
      setAutomationStatus(automation.id, 'paused', null);
      appendAuditLog({
        actorId: automation.user_id,
        action: 'automation.auto_paused',
        resourceType: 'automation',
        resourceId: automation.id,
        description: `automation "${automation.name}" auto-paused: no task credits remaining`,
        metadata: { runId: run.id },
      });
      void notifyAutomationNeedsAttention({
        userId: automation.user_id,
        automationId: automation.id,
        name: automation.name,
        reason: 'no task credits remaining — the automation was paused automatically',
      });
      this.logger.info(`[akbaral] automation ${automation.id} auto-paused (no credits)`);
      return;
    }

    this.launchRun(automation, run);
    this.advance(automation, scheduledForMs, now.getTime());
  }

  /** Manual "run now": bypasses the schedule (not the guards). */
  triggerManualRun(automation: AutomationRow): AutomationRunRow {
    const last = this.manualRuns.get(automation.id) ?? 0;
    if (Date.now() - last < MANUAL_RUN_COOLDOWN_MS) {
      throw Object.assign(new Error('This automation was triggered manually less than 10 seconds ago.'), { code: 'conflict' });
    }
    this.manualRuns.set(automation.id, Date.now());

    const trial = getTrialStatus(automation.user_id);
    if (trial.requiresPro) {
      throw Object.assign(new Error('Task credits exhausted. This capability requires AKBARAL Pro.'), { code: 'requires_pro' });
    }

    const run = insertAutomationRun({
      automationId: automation.id,
      userId: automation.user_id,
      triggerReason: 'manual',
      idempotencyKey: `manual:${automation.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      scheduledFor: null,
    });
    if (!run) {
      throw Object.assign(new Error('could not start a run — try again'), { code: 'conflict' });
    }
    this.launchRun(automation, run);
    appendAuditLog({
      actorId: automation.user_id,
      action: 'automation.manual_run',
      resourceType: 'automation',
      resourceId: automation.id,
      description: `manual run of automation "${automation.name}"`,
      metadata: { runId: run.id },
    });
    return getAutomationRunRow(run.id) as AutomationRunRow;
  }

  /** Create the persisted workflow from the automation steps and enqueue it. */
  private launchRun(automation: AutomationRow, run: AutomationRunRow): void {
    const steps = JSON.parse(automation.steps_json) as AutomationStep[];
    const workflow = createWorkflow({
      userId: automation.user_id,
      goal: `Automation: ${automation.name}`,
      intent: `automation:${automation.id}`,
      plan: { automationId: automation.id, runId: run.id, steps: steps.length },
    });
    steps.forEach((step, index) => {
      createWorkflowStep({
        workflowId: workflow.id,
        stepOrder: index + 1,
        dependsOn: index === 0 ? [] : [String(index)],
        goal: step.goal,
        toolKey: step.toolKey,
      });
    });
    // Resolve agent ids now so the runner does not depend on the JSON.
    for (let index = 0; index < steps.length; index += 1) {
      db.run(
        `UPDATE workflow_steps SET agent_id = (SELECT id FROM agents WHERE slug = ?) WHERE workflow_id = ? AND step_order = ?`,
        [steps[index].agentSlug, workflow.id, index + 1],
      );
    }

    const { job } = executionQueue.enqueueWorkflow({
      workflowId: workflow.id,
      userId: automation.user_id,
      maxAttempts: Math.min(automation.max_retries + 1, 5),
      timeoutMs: automation.timeout_ms,
    });
    attachRunExecution(run.id, workflow.id, job.id);
    recordAutomationFired(automation.id);
  }

  // ---------------------------------------------------------------------------
  // Reconciliation (crash safety + terminal settlement + notifications)
  // ---------------------------------------------------------------------------

  private reconcile(): void {
    for (const run of listOpenAutomationRunRows()) {
      try {
        this.reconcileRun(run);
      } catch (error) {
        this.logger.warn(`[akbaral] automation run ${run.id} reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private reconcileRun(run: AutomationRunRow): void {
    const automation = db.get<{ id: string; name: string; user_id: string; timeout_ms: number }>(
      'SELECT id, name, user_id, timeout_ms FROM automations WHERE id = ?',
      [run.automation_id],
    );
    if (!automation) {
      // Automation deleted while a run was open — settle it.
      settleAutomationRun({ runId: run.id, status: 'cancelled', errorMessage: 'automation deleted' });
      return;
    }

    if (!run.job_id) {
      // Crash between run insert and enqueue: re-fire with a bounded budget.
      if (Date.now() - Date.parse(run.created_at) > RECOVERY_GRACE_MS) {
        if (run.attempt >= MAX_RECOVERY_ATTEMPTS) {
          settleAutomationRun({ runId: run.id, status: 'failed', errorMessage: 'scheduler recovery failed' });
          recordAutomationFailure(run.automation_id);
          return;
        }
        bumpRunAttempt(run.id);
        this.logger.info(`[akbaral] automation run ${run.id} recovered (attempt ${run.attempt + 1})`);
        this.launchRunByIds(run, automation);
      }
      return;
    }

    const job = getJob(run.job_id);
    if (!job) {
      settleAutomationRun({ runId: run.id, status: 'failed', errorMessage: 'execution job missing' });
      recordAutomationFailure(run.automation_id);
      return;
    }

    if (run.status === 'queued' && (job.status === 'running' || job.status === 'retrying')) {
      markRunRunning(run.id);
      return;
    }

    switch (job.status) {
      case 'completed':
        if (settleAutomationRun({ runId: run.id, status: 'completed' })) {
          void notifyAutomationRunFinished({ userId: run.user_id, automationId: automation.id, name: automation.name, runId: run.id, status: 'completed' });
        }
        return;
      case 'failed':
      case 'timed_out':
        if (settleAutomationRun({ runId: run.id, status: 'failed', errorMessage: job.status === 'timed_out' ? 'workflow timed out' : 'workflow failed' })) {
          recordAutomationFailure(run.automation_id);
          void notifyAutomationRunFinished({ userId: run.user_id, automationId: automation.id, name: automation.name, runId: run.id, status: 'failed' });
        }
        return;
      case 'cancelled':
        if (settleAutomationRun({ runId: run.id, status: 'cancelled', errorMessage: 'cancelled' })) {
          void notifyAutomationRunFinished({ userId: run.user_id, automationId: automation.id, name: automation.name, runId: run.id, status: 'cancelled' });
        }
        return;
      case 'queued':
      case 'retrying':
      case 'running': {
        // Still executing: enforce the per-automation timeout as a graceful
        // cancellation (queue reconciliation refunds the in-flight step).
        const startedAt = run.started_at ? Date.parse(run.started_at) : Date.parse(run.created_at);
        const budget = automation.timeout_ms + RECOVERY_GRACE_MS;
        if (Date.now() - startedAt > budget) {
          this.logger.info(`[akbaral] automation run ${run.id} exceeded ${automation.timeout_ms}ms — cancelling`);
          executionQueue.cancelJob(run.job_id, 'automation-timeout', `automation exceeded ${automation.timeout_ms}ms`);
        }
        return;
      }
      default:
        return;
    }
  }

  /** Re-launch a recovered run against a fresh workflow (idempotent enqueue). */
  private launchRunByIds(run: AutomationRunRow, automation: { id: string; name: string; user_id: string; timeout_ms: number; max_retries?: number }): void {
    const rows = db.get<{ steps_json: string; max_retries: number }>('SELECT steps_json, max_retries FROM automations WHERE id = ?', [automation.id]);
    if (!rows) {
      settleAutomationRun({ runId: run.id, status: 'cancelled', errorMessage: 'automation deleted' });
      return;
    }
    const steps = JSON.parse(rows.steps_json) as AutomationStep[];
    const workflow = createWorkflow({
      userId: automation.user_id,
      goal: `Automation: ${automation.name}`,
      intent: `automation:${automation.id}:recovery`,
      plan: { automationId: automation.id, runId: run.id, recoveryAttempt: run.attempt },
    });
    steps.forEach((step, index) => {
      createWorkflowStep({
        workflowId: workflow.id,
        stepOrder: index + 1,
        dependsOn: index === 0 ? [] : [String(index)],
        goal: step.goal,
        toolKey: step.toolKey,
      });
      db.run(
        `UPDATE workflow_steps SET agent_id = (SELECT id FROM agents WHERE slug = ?) WHERE workflow_id = ? AND step_order = ?`,
        [step.agentSlug, workflow.id, index + 1],
      );
    });
    const { job } = executionQueue.enqueueWorkflow({
      workflowId: workflow.id,
      userId: automation.user_id,
      maxAttempts: Math.min(rows.max_retries + 1, 5),
      timeoutMs: automation.timeout_ms,
    });
    attachRunExecution(run.id, workflow.id, job.id);
  }

  // ---------------------------------------------------------------------------
  // Schedules, conditions, keys
  // ---------------------------------------------------------------------------

  private evaluateCondition(automation: AutomationRow): string | null {
    if (!automation.condition_json) return null;
    let condition: AutomationCondition;
    try {
      condition = JSON.parse(automation.condition_json) as AutomationCondition;
    } catch {
      return 'condition could not be parsed';
    }
    const last = getLastSettledAutomationRun(automation.id);
    const evaluateAtom = (atom: unknown): string | null => {
      const typed = atom as { type?: string; equals?: string; seconds?: number };
      if (typed?.type === 'last_run_outcome') {
        if (!last) return 'no previous run';
        if (String(last.status) !== String(typed.equals)) {
          return `previous run outcome was "${last.status}" (required "${typed.equals}")`;
        }
        return null;
      }
      if (typed?.type === 'min_interval_since_last_run') {
        if (!last || !last.finished_at) return null;
        const elapsed = (Date.now() - Date.parse(last.finished_at)) / 1000;
        if (elapsed < Number(typed.seconds ?? 0)) {
          return `previous run finished ${Math.floor(elapsed)}s ago (minimum ${typed.seconds}s)`;
        }
        return null;
      }
      return 'unknown condition type';
    };
    const failures: string[] = [];
    if (condition.all) {
      for (const atom of condition.all) {
        const failure = evaluateAtom(atom);
        if (failure) failures.push(failure);
      }
      if (failures.length > 0) return failures[0];
    }
    if (condition.any) {
      const satisfied = condition.any.some((atom) => evaluateAtom(atom) === null);
      if (!satisfied) return 'no "any" condition was satisfied';
    }
    return null;
  }

  /** Advance next_run_at past the fired occurrence (no backfill of missed ones). */
  private advance(automation: AutomationRow, scheduledForMs: number | null, nowMs: number): void {
    const schedule = JSON.parse(automation.schedule_json) as AutomationSchedule;
    let nextMs: number | null = null;
    if (schedule.kind === 'once') {
      nextMs = null; // fired — never again
    } else if (schedule.kind === 'cron') {
      nextMs = cronNextAfter(scheduledForMs ?? nowMs, schedule.expr, schedule.tz);
    } else {
      const anchor = scheduledForMs ?? nowMs;
      nextMs = anchor + schedule.seconds * 1000;
      if (nextMs <= nowMs) {
        // Missed occurrences during downtime: skip to the next future slot.
        while (nextMs !== null && nextMs <= nowMs) {
          nextMs += schedule.seconds * 1000;
        }
      }
    }
    db.run(
      `UPDATE automations SET next_run_at = ?, updated_at = ? WHERE id = ?`,
      [nextMs === null ? null : new Date(nextMs).toISOString(), new Date().toISOString(), automation.id],
    );
  }

  private occurrenceKey(automation: AutomationRow, scheduledForMs: number | null): string {
    if (scheduledForMs === null) return `once:${automation.id}`;
    return `occ:${automation.id}:${Math.floor(scheduledForMs / 60000)}`;
  }
}

// Notification hooks (in-app + push through the M12 system).
async function notifyAutomationRunFinished(input: {
  userId: string;
  automationId: string;
  name: string;
  runId: string;
  status: 'completed' | 'failed' | 'cancelled';
}): Promise<void> {
  const { notifyAutomationRun } = await import('../push/automation-notify');
  try {
    await notifyAutomationRun(input);
  } catch (error) {
    console.warn(`[akbaral] automation notification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function notifyAutomationNeedsAttention(input: { userId: string; automationId: string; name: string; reason: string }): Promise<void> {
  const { notifyAutomationAttention } = await import('../push/automation-notify');
  try {
    await notifyAutomationAttention(input);
  } catch (error) {
    console.warn(`[akbaral] automation notification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Singleton used by the API server bootstrap (same pattern as executionQueue). */
export const automationScheduler = new AutomationScheduler();
