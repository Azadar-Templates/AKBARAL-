import { randomBytes } from 'node:crypto';
import { env } from '../config/env';
import {
  cancelJobRow,
  claimNextDueJob,
  countJobsByStatus,
  finishJob,
  finishJobAttempt,
  findJobByIdempotencyKey,
  getJob,
  getJobByTaskId,
  getJobByWorkflowId,
  insertJob,
  insertJobAttempt,
  listJobs,
  scheduleJobRetry,
  type ExecutionJobRow,
} from '../db';
import { db } from '../db';
import { appendAuditLog } from '../db';
import { dispatchAgentExecution } from './executor';
import { runWorkflow } from './workflow-runner';
import { classifyExecutionError } from './errors';
import { reconcileTaskCancelled, reconcileTaskFailed } from './task-reconciler';
import type { ExecutionStream } from '../realtime/execution-stream';

/**
 * AKBARAL persistent execution engine (Milestone 3).
 *
 * A DB-backed queue that survives restarts:
 *   queued -> running -> completed
 *                     -> retrying (exponential backoff) -> running -> ...
 *                     -> failed (permanent error or attempts exhausted)
 *                     -> timed_out (per-step or overall budget exceeded)
 *                     -> cancelled (user or admin)
 *
 * Guarantees:
 *   - Idempotency: one job per logical execution (unique idempotency key);
 *     duplicate enqueues return the existing job.
 *   - Exclusive claims: a job is claimed by exactly one worker via a guarded
 *     transactional update.
 *   - Trust policy: the queue owns final task reconciliation for agent jobs —
 *     a free task credit is refunded exactly once for every unsuccessful
 *     terminal state (failed / timed_out / cancelled / crash) and kept only
 *     on success.
 *   - Honest state: every transition is written to the DB and pushed to the
 *     real-time stream; nothing is faked.
 */

export type QueueJobStatus = ExecutionJobRow['status'];

export interface ExecutionQueueOptions {
  stream?: ExecutionStream | null;
  pollIntervalMs?: number;
  concurrency?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  stepTimeoutMs?: number;
  workflowTimeoutMs?: number;
  workerId?: string;
}

interface AgentJobPayload {
  executionId: string;
  agentSlug: string;
}

interface WorkflowJobPayload {
  workflowId: string;
  /** Per-run timeout override (automations); falls back to the queue default. */
  timeoutMs?: number;
}

const TERMINAL_JOB_STATUSES: ReadonlySet<QueueJobStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
  'timed_out',
]);

export class ExecutionQueue {
  private stream: ExecutionStream | null | undefined;
  private readonly pollIntervalMs: number;
  private readonly concurrency: number;
  private readonly defaultMaxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly stepTimeoutMs: number;
  private readonly workflowTimeoutMs: number;
  private timer: NodeJS.Timeout | null = null;
  private readonly active = new Map<string, Promise<void>>();
  private readonly cancelledInMemory = new Set<string>();
  private started = false;

  readonly workerId: string;

  constructor(options: ExecutionQueueOptions = {}) {
    this.stream = options.stream;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.concurrency = options.concurrency ?? env.queueConcurrency;
    this.defaultMaxAttempts = options.maxAttempts ?? env.executionMaxAttempts;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? env.executionRetryBaseDelayMs;
    this.stepTimeoutMs = options.stepTimeoutMs ?? env.executionStepTimeoutMs;
    this.workflowTimeoutMs = options.workflowTimeoutMs ?? env.workflowTimeoutMs;
    this.workerId = options.workerId ?? `worker-${process.pid}-${randomBytes(4).toString('hex')}`;
  }

  /** Bind the real-time stream (called by the API server bootstrap). */
  bindStream(stream: ExecutionStream): void {
    this.stream = stream;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.timer = setInterval(() => this.tick(), this.pollIntervalMs);
    this.timer.unref?.();
    this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = null;
    this.started = false;
  }

  get isStarted(): boolean {
    return this.started;
  }

  // ---------------------------------------------------------------------------
  // Enqueue
  // ---------------------------------------------------------------------------

  enqueueAgentExecution(input: {
    executionId: string;
    agentSlug: string;
    taskId?: string | null;
    userId?: string | null;
    priority?: number;
    maxAttempts?: number;
  }): { job: ExecutionJobRow; created: boolean } {
    const idempotencyKey = `agent:${input.executionId}`;
    const duplicate = findJobByIdempotencyKey(idempotencyKey);
    if (duplicate) {
      return { job: duplicate, created: false };
    }
    const job = insertJob({
      jobType: 'agent_execution',
      idempotencyKey,
      payload: { executionId: input.executionId, agentSlug: input.agentSlug },
      taskId: input.taskId ?? null,
      userId: input.userId ?? null,
      priority: input.priority ?? 100,
      maxAttempts: input.maxAttempts ?? this.defaultMaxAttempts,
    });
    this.pushJobStatus(job, `Queued agent execution (${input.agentSlug})`);
    return { job, created: true };
  }

  enqueueWorkflow(input: {
    workflowId: string;
    userId?: string | null;
    priority?: number;
    maxAttempts?: number;
    timeoutMs?: number;
  }): { job: ExecutionJobRow; created: boolean } {
    const idempotencyKey = `workflow:${input.workflowId}`;
    const duplicate = findJobByIdempotencyKey(idempotencyKey);
    if (duplicate) {
      return { job: duplicate, created: false };
    }
    const job = insertJob({
      jobType: 'workflow',
      idempotencyKey,
      payload: {
        workflowId: input.workflowId,
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
      },
      workflowId: input.workflowId,
      userId: input.userId ?? null,
      priority: input.priority ?? 100,
      maxAttempts: input.maxAttempts ?? this.defaultMaxAttempts,
    });
    this.pushJobStatus(job, 'Queued workflow run');
    return { job, created: true };
  }

  // ---------------------------------------------------------------------------
  // Cancellation
  // ---------------------------------------------------------------------------

  /** Cancel a job in any non-terminal state; reconciles the underlying task. */
  cancelJob(jobId: string, by: string, reason: string): { cancelled: boolean; job?: ExecutionJobRow } {
    const job = getJob(jobId);
    if (!job) {
      return { cancelled: false };
    }
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      return { cancelled: false, job };
    }

    // Reconcile the user-facing state first so credits are refunded exactly
    // once, then mark the job cancelled.
    if (job.job_type === 'agent_execution' && job.task_id) {
      const reconciled = reconcileTaskCancelled({
        taskId: job.task_id,
        by,
        reason,
        stream: this.stream ?? undefined,
      });
      if (!reconciled.applied) {
        // Task already completed (race): the work is done; the job finishes
        // normally. Do not cancel.
        return { cancelled: false, job };
      }
    }
    if (job.job_type === 'workflow' && job.workflow_id) {
      cancelWorkflowRow(job.workflow_id, reason);
      cancelRunningStepTask(job.workflow_id, by, reason, this.stream ?? undefined);
    }

    cancelJobRow(jobId, reason);
    this.cancelledInMemory.add(jobId);
    const updated = getJob(jobId);
    this.pushJobStatus(updated ?? job, `Cancelled by ${by}: ${reason}`);
    return { cancelled: true, job: updated };
  }

  /** Cancel the job (if any) that owns a task, else reconcile the task directly. */
  cancelTask(taskId: string, by: string, reason: string): { cancelled: boolean; jobId?: string } {
    const job = getJobByTaskId(taskId);
    if (job) {
      const result = this.cancelJob(job.id, by, reason);
      return { cancelled: result.cancelled, jobId: job.id };
    }
    // Task may belong to a workflow step.
    const step = db.get<{ workflow_id: string }>(
      'SELECT workflow_id FROM workflow_steps WHERE task_id = ? LIMIT 1',
      [taskId],
    );
    if (step) {
      const workflowJob = getJobByWorkflowId(String(step.workflow_id));
      if (workflowJob && !TERMINAL_JOB_STATUSES.has(workflowJob.status)) {
        const result = this.cancelJob(workflowJob.id, by, reason);
        return { cancelled: result.cancelled, jobId: workflowJob.id };
      }
    }
    // Direct-dispatch task without a queue job (legacy path).
    const reconciled = reconcileTaskCancelled({ taskId, by, reason, stream: this.stream ?? undefined });
    return { cancelled: reconciled.applied };
  }

  cancelWorkflow(workflowId: string, by: string, reason: string): { cancelled: boolean; jobId?: string } {
    const job = getJobByWorkflowId(workflowId);
    if (!job || TERMINAL_JOB_STATUSES.has(job.status)) {
      return { cancelled: false };
    }
    const result = this.cancelJob(job.id, by, reason);
    return { cancelled: result.cancelled, jobId: job.id };
  }

  /** Admin/emergency: cancel every non-terminal job. */
  adminCancelAll(by: string, reason: string): { cancelled: number } {
    const { jobs } = listJobs({ limit: 200, offset: 0 });
    let cancelled = 0;
    for (const job of jobs) {
      if (!TERMINAL_JOB_STATUSES.has(job.status)) {
        if (this.cancelJob(job.id, by, reason).cancelled) {
          cancelled += 1;
        }
      }
    }
    appendAuditLog({
      actorId: by,
      action: 'queue.admin_cancel',
      resourceType: 'execution_queue',
      resourceId: 'execution_queue',
      description: `admin cancelled ${cancelled} job(s): ${reason}`,
      metadata: { cancelled },
    });
    return { cancelled };
  }

  // ---------------------------------------------------------------------------
  // Observability
  // ---------------------------------------------------------------------------

  listJobs(filter: { status?: string; userId?: string; limit?: number; offset?: number }) {
    return listJobs(filter);
  }

  getJobByTaskId(taskId: string) {
    return getJobByTaskId(taskId);
  }

  getJobByWorkflowId(workflowId: string) {
    return getJobByWorkflowId(workflowId);
  }

  stats(): { byStatus: Record<string, number>; activeWorkers: number } {
    return {
      byStatus: countJobsByStatus(),
      activeWorkers: this.active.size,
    };
  }

  // ---------------------------------------------------------------------------
  // Worker loop
  // ---------------------------------------------------------------------------

  private tick(): void {
    while (this.active.size < this.concurrency) {
      const job = claimNextDueJob(this.workerId, new Date().toISOString());
      if (!job) {
        break;
      }
      const promise = this.runJob(job).finally(() => {
        this.active.delete(job.id);
      });
      this.active.set(job.id, promise);
    }
  }

  private async runJob(job: ExecutionJobRow): Promise<void> {
    const attempt = insertJobAttempt(job.id, job.attempts);
    this.pushJobStatus(job, `Attempt ${job.attempts}/${job.max_attempts} started`);

    const isCancelled = (): boolean =>
      this.cancelledInMemory.has(job.id) || getJob(job.id)?.status === 'cancelled';

    try {
      if (job.job_type === 'agent_execution') {
        await this.runAgentJob(job, isCancelled);
      } else {
        await this.runWorkflowJob(job, isCancelled);
      }
    } catch (error) {
      // Handler-level infrastructure error (not an execution error).
      const message = error instanceof Error ? error.message : String(error);
      const classified = classifyExecutionError({ message });
      await this.handleJobFailure(job, attempt.id, classified, message);
    }
    this.cancelledInMemory.delete(job.id);
  }

  private async runAgentJob(job: ExecutionJobRow, isCancelled: () => boolean): Promise<void> {
    const payload = JSON.parse(job.payload_json) as AgentJobPayload;
    const attemptId = latestAttemptId(job.id);

    const outcome = await raceWithTimeout(
      dispatchAgentExecution(payload.executionId, payload.agentSlug, {
        stream: this.stream ?? undefined,
        deferTaskFailure: true,
        isCancelled,
      }),
      this.stepTimeoutMs,
    );

    if (outcome.timedOut) {
      markExecutionTimedOut(payload.executionId, this.stepTimeoutMs);
      await this.handleJobFailure(job, attemptId, { code: 'timed_out', retryable: true }, `timed_out: agent execution exceeded ${this.stepTimeoutMs}ms`);
      return;
    }

    if (outcome.value.status === 'completed') {
      finishJob(job.id, { status: 'completed' });
      finishJobAttempt(attemptId, { status: 'completed' });
      this.pushJobStatus(getJob(job.id) ?? job, 'Agent execution completed');
      return;
    }

    if (outcome.value.code === 'cancelled' || isCancelled()) {
      finishJobAttempt(attemptId, { status: 'cancelled', errorCode: 'cancelled' });
      // Job/task state was already written by the cancellation path.
      return;
    }

    const classified = classifyExecutionError({
      code: outcome.value.code,
      message: outcome.value.error ?? 'execution failed',
      retryable: (outcome.value as { retryable?: boolean }).retryable,
    });
    await this.handleJobFailure(job, attemptId, classified, outcome.value.error ?? 'execution failed');
  }

  private async runWorkflowJob(job: ExecutionJobRow, isCancelled: () => boolean): Promise<void> {
    const payload = JSON.parse(job.payload_json) as WorkflowJobPayload;
    const attemptId = latestAttemptId(job.id);

    const timeoutMs = payload.timeoutMs ?? this.workflowTimeoutMs;
    const outcome = await raceWithTimeout(
      runWorkflow(payload.workflowId, this.stream ?? undefined, {
        isCancelled,
        stepTimeoutMs: this.stepTimeoutMs,
      }),
      timeoutMs,
    );

    if (outcome.timedOut) {
      const message = `timed_out: workflow exceeded ${timeoutMs}ms`;
      db.run(
        `UPDATE workflows SET status='failed', error_message=?, completed_at=? WHERE id=? AND status IN ('planned','running')`,
        [message, new Date().toISOString(), payload.workflowId],
      );
      // Reconcile the in-flight step's task (if any).
      const runningStep = db.get<{ task_id: string | null; id: string }>(
        "SELECT task_id, id FROM workflow_steps WHERE workflow_id = ? AND status = 'running' LIMIT 1",
        [payload.workflowId],
      );
      if (runningStep?.task_id) {
        reconcileTaskFailed({
          taskId: String(runningStep.task_id),
          code: 'timed_out',
          message,
          stream: this.stream ?? undefined,
        });
        db.run(`UPDATE workflow_steps SET status='failed', error_message=? WHERE id=?`, [message, runningStep.id]);
      }
      await this.handleJobFailure(job, attemptId, { code: 'timed_out', retryable: false }, message);
      return;
    }

    const result = outcome.value;
    if (result.status === 'completed') {
      finishJob(job.id, { status: 'completed' });
      finishJobAttempt(attemptId, { status: 'completed' });
      this.pushJobStatus(getJob(job.id) ?? job, 'Workflow completed');
      return;
    }

    if (result.status === 'cancelled' || isCancelled()) {
      finishJobAttempt(attemptId, { status: 'cancelled', errorCode: 'cancelled' });
      return;
    }

    const classified = classifyExecutionError({ message: result.error ?? 'workflow failed' });
    await this.handleJobFailure(job, attemptId, classified, result.error ?? 'workflow failed');
  }

  /**
   * Finalize a failed attempt: retry with exponential backoff when the error
   * is retryable and attempts remain; otherwise settle the job and reconcile
   * the task (fail + refund) for agent jobs.
   */
  private async handleJobFailure(
    job: ExecutionJobRow,
    attemptId: string,
    classified: { code: string; retryable: boolean },
    message: string,
  ): Promise<void> {
    if (getJob(job.id)?.status === 'cancelled') {
      finishJobAttempt(attemptId, { status: 'cancelled', errorCode: 'cancelled' });
      return;
    }

    if (classified.retryable && job.attempts < job.max_attempts) {
      const backoffMs = Math.min(this.retryBaseDelayMs * 2 ** (job.attempts - 1), 30_000);
      const runAfter = new Date(Date.now() + backoffMs).toISOString();
      const scheduled = scheduleJobRetry(job.id, runAfter, classified.code, message);
      if (scheduled) {
        finishJobAttempt(attemptId, {
          status: classified.code === 'timed_out' ? 'timed_out' : 'failed',
          errorCode: classified.code,
          errorMessage: message,
        });
        const updated = getJob(job.id);
        if (updated) {
          this.pushJobStatus(
            updated,
            `Attempt ${job.attempts}/${job.max_attempts} failed (${classified.code}); retrying in ${Math.round(backoffMs / 100) / 10}s`,
          );
        }
        return;
      }
      // The job was cancelled between the failure and the retry scheduling.
      finishJobAttempt(attemptId, { status: 'cancelled', errorCode: 'cancelled' });
      return;
    }

    const finalStatus = classified.code === 'timed_out' ? 'timed_out' : 'failed';
    finishJob(job.id, { status: finalStatus, errorCode: classified.code, errorMessage: message });
    finishJobAttempt(attemptId, {
      status: finalStatus === 'timed_out' ? 'timed_out' : 'failed',
      errorCode: classified.code,
      errorMessage: message,
    });

    if (job.job_type === 'agent_execution' && job.task_id) {
      reconcileTaskFailed({
        taskId: job.task_id,
        code: classified.code,
        message,
        stream: this.stream ?? undefined,
      });
    }
    const updated = getJob(job.id);
    if (updated) {
      this.pushJobStatus(updated, `Job ${finalStatus} (${classified.code})`);
    }
  }

  private pushJobStatus(job: ExecutionJobRow, message: string): void {
    const channel =
      job.job_type === 'workflow' ? job.workflow_id ?? job.id : job.task_id ?? job.id;
    const executionChannel =
      job.job_type === 'agent_execution'
        ? (JSON.parse(job.payload_json) as AgentJobPayload).executionId
        : channel;
    this.stream?.pushStatus({
      executionId: executionChannel,
      status: job.status,
      message,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function latestAttemptId(jobId: string): string {
  const row = db.get<{ id: string }>(
    'SELECT id FROM job_attempts WHERE job_id = ? ORDER BY attempt_number DESC LIMIT 1',
    [jobId],
  );
  return row?.id ?? '';
}

function cancelWorkflowRow(workflowId: string, reason: string): void {
  db.run(
    `UPDATE workflows SET status='cancelled', error_message=?, completed_at=? WHERE id=? AND status IN ('planned','running')`,
    [reason, new Date().toISOString(), workflowId],
  );
}

/** Refund the task of the currently running step of a cancelled workflow. */
function cancelRunningStepTask(workflowId: string, by: string, reason: string, stream?: ExecutionStream): void {
  const steps = db.all<{ task_id: string | null; id: string; status: string }>(
    "SELECT task_id, id, status FROM workflow_steps WHERE workflow_id = ? AND status IN ('running', 'pending')",
    [workflowId],
  ) as Array<{ task_id: string | null; id: string; status: string }>;
  for (const step of steps) {
    if (step.status === 'running') {
      db.run(`UPDATE workflow_steps SET status='cancelled', error_message=? WHERE id=?`, [reason, step.id]);
      if (step.task_id) {
        reconcileTaskCancelled({ taskId: String(step.task_id), by, reason, stream });
      }
    } else {
      db.run(`UPDATE workflow_steps SET status='skipped', error_message=? WHERE id=?`, ['workflow cancelled', step.id]);
    }
  }
}

function markExecutionTimedOut(executionId: string, timeoutMs: number): void {
  db.run(
    `UPDATE agent_executions SET status='failed', error_message=?, completed_at=? WHERE id=? AND status IN ('queued','running')`,
    [`timed_out: agent execution exceeded ${timeoutMs}ms`, new Date().toISOString(), executionId],
  );
}

type TimeoutOutcome<T> = { timedOut: false; value: T } | { timedOut: true };

async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<TimeoutOutcome<T>> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<{ timedOut: true }>((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      timer.unref?.();
    });
    const result: unknown = await Promise.race([promise, timeout]);
    if ((result as { timedOut?: boolean }).timedOut === true) {
      return { timedOut: true };
    }
    return { timedOut: false, value: result as T };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Production singleton. The API server binds the real-time stream and starts
 * the worker loop at bootstrap.
 */
export const executionQueue = new ExecutionQueue();
