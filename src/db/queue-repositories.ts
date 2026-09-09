import { db } from './database';
import { createId } from './id';

/**
 * Persistent execution-queue repositories (Milestone 3).
 *
 * All state transitions are guarded so concurrent workers or racing HTTP
 * requests can never double-claim, double-complete or overwrite a terminal
 * job state (e.g. a cancellation landing while a worker finalizes).
 */

export interface ExecutionJobRow {
  id: string;
  job_type: 'agent_execution' | 'workflow';
  idempotency_key: string;
  status: 'queued' | 'running' | 'retrying' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
  payload_json: string;
  task_id: string | null;
  workflow_id: string | null;
  user_id: string | null;
  priority: number;
  attempts: number;
  max_attempts: number;
  locked_by: string | null;
  locked_at: string | null;
  run_after: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface JobAttemptRow {
  id: string;
  job_id: string;
  attempt_number: number;
  status: 'started' | 'completed' | 'failed' | 'timed_out' | 'cancelled';
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

const NOW = (): string => new Date().toISOString();

const ACTIVE_JOB_STATUSES = "('queued', 'running', 'retrying')";

export function insertJob(input: {
  jobType: 'agent_execution' | 'workflow';
  idempotencyKey: string;
  payload: Record<string, unknown>;
  taskId?: string | null;
  workflowId?: string | null;
  userId?: string | null;
  priority?: number;
  maxAttempts?: number;
}): ExecutionJobRow {
  const id = createId('job');
  db.run(
    `INSERT INTO execution_jobs
       (id, job_type, idempotency_key, status, payload_json, task_id, workflow_id, user_id, priority, attempts, max_attempts, created_at, updated_at)
     VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      id,
      input.jobType,
      input.idempotencyKey,
      JSON.stringify(input.payload),
      input.taskId ?? null,
      input.workflowId ?? null,
      input.userId ?? null,
      input.priority ?? 100,
      input.maxAttempts ?? 2,
      NOW(),
      NOW(),
    ],
  );
  return getJob(id) as ExecutionJobRow;
}

export function getJob(id: string): ExecutionJobRow | undefined {
  return db.get('SELECT * FROM execution_jobs WHERE id = ?', [id]) as ExecutionJobRow | undefined;
}

export function findJobByIdempotencyKey(key: string): ExecutionJobRow | undefined {
  return db.get('SELECT * FROM execution_jobs WHERE idempotency_key = ?', [key]) as ExecutionJobRow | undefined;
}

export function getJobByTaskId(taskId: string): ExecutionJobRow | undefined {
  return db.get(
    'SELECT * FROM execution_jobs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1',
    [taskId],
  ) as ExecutionJobRow | undefined;
}

export function getJobByWorkflowId(workflowId: string): ExecutionJobRow | undefined {
  return db.get(
    'SELECT * FROM execution_jobs WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1',
    [workflowId],
  ) as ExecutionJobRow | undefined;
}

/**
 * Atomically claim the next due job for a worker. The guarded UPDATE inside
 * the transaction makes the claim exclusive even under concurrency.
 */
export function claimNextDueJob(workerId: string, now: string): ExecutionJobRow | undefined {
  return db.transaction((tx) => {
    const due = tx.get<{ id: string }>(
      `SELECT id FROM execution_jobs
       WHERE status IN ('queued', 'retrying') AND (run_after IS NULL OR run_after <= ?)
       ORDER BY priority ASC, created_at ASC
       LIMIT 1`,
      [now],
    );
    if (!due) {
      return undefined;
    }
    const claimed = tx.run(
      `UPDATE execution_jobs
       SET status = 'running', locked_by = ?, locked_at = ?, attempts = attempts + 1, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'retrying')`,
      [workerId, now, now, due.id],
    );
    if (claimed.changes !== 1) {
      return undefined;
    }
    return tx.get('SELECT * FROM execution_jobs WHERE id = ?', [due.id]) as ExecutionJobRow | undefined;
  });
}

/** Finalize a running job. Returns false if the job is no longer running (e.g. cancelled). */
export function finishJob(
  id: string,
  outcome: { status: 'completed' | 'failed' | 'timed_out'; errorCode?: string | null; errorMessage?: string | null },
): boolean {
  const result = db.run(
    `UPDATE execution_jobs
     SET status = ?, error_code = ?, error_message = ?, completed_at = ?, updated_at = ?
     WHERE id = ? AND status = 'running'`,
    [outcome.status, outcome.errorCode ?? null, outcome.errorMessage ?? null, NOW(), NOW(), id],
  );
  return result.changes === 1;
}

/** Schedule a retry with backoff. Returns false if the job is no longer running. */
export function scheduleJobRetry(
  id: string,
  runAfter: string,
  errorCode: string | null,
  errorMessage: string | null,
): boolean {
  const result = db.run(
    `UPDATE execution_jobs
     SET status = 'retrying', run_after = ?, error_code = ?, error_message = ?, locked_by = NULL, locked_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'running'`,
    [runAfter, errorCode, errorMessage, NOW(), id],
  );
  return result.changes === 1;
}

/** Cancel a job in any non-terminal state. Returns false if already terminal. */
export function cancelJobRow(id: string, reason: string): boolean {
  const result = db.run(
    `UPDATE execution_jobs
     SET status = 'cancelled', error_message = ?, completed_at = ?, updated_at = ?
     WHERE id = ? AND status IN ('queued', 'running', 'retrying')`,
    [reason, NOW(), NOW(), id],
  );
  return result.changes === 1;
}

/** Re-queue a stale running job (crash recovery). */
export function requeueStaleJob(id: string, reason: string): boolean {
  const result = db.run(
    `UPDATE execution_jobs
     SET status = 'queued', run_after = NULL, locked_by = NULL, locked_at = NULL,
         error_code = 'requeued_after_restart', error_message = ?, updated_at = ?
     WHERE id = ? AND status = 'running'`,
    [reason, NOW(), id],
  );
  return result.changes === 1;
}

export function listStaleRunningJobs(excludeWorkerId: string): ExecutionJobRow[] {
  return db.all(
    `SELECT * FROM execution_jobs
     WHERE status = 'running' AND (locked_by IS NULL OR locked_by != ?)`,
    [excludeWorkerId],
  ) as ExecutionJobRow[];
}

export function listJobs(filter: {
  status?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}): { jobs: ExecutionJobRow[]; total: number } {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filter.status) {
    where.push('status = ?');
    params.push(filter.status);
  }
  if (filter.userId) {
    where.push('user_id = ?');
    params.push(filter.userId);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(filter.limit ?? 50, 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  const jobs = db.all(
    `SELECT * FROM execution_jobs ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  ) as ExecutionJobRow[];
  const total = db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM execution_jobs ${whereSql}`, params)?.count ?? 0;
  return { jobs, total };
}

export function countJobsByStatus(): Record<string, number> {
  const rows = db.all<{ status: string; count: number }>(
    'SELECT status, COUNT(*) AS count FROM execution_jobs GROUP BY status',
  ) as Array<{ status: string; count: number }>;
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.status] = row.count;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

export function insertJobAttempt(jobId: string, attemptNumber: number): JobAttemptRow {
  const id = createId('att');
  db.run(
    `INSERT INTO job_attempts (id, job_id, attempt_number, status, started_at) VALUES (?, ?, ?, 'started', ?)`,
    [id, jobId, attemptNumber, NOW()],
  );
  return db.get('SELECT * FROM job_attempts WHERE id = ?', [id]) as JobAttemptRow;
}

export function finishJobAttempt(
  id: string,
  outcome: { status: 'completed' | 'failed' | 'timed_out' | 'cancelled'; errorCode?: string | null; errorMessage?: string | null },
): void {
  db.run(
    `UPDATE job_attempts SET status = ?, error_code = ?, error_message = ?, finished_at = ? WHERE id = ?`,
    [outcome.status, outcome.errorCode ?? null, outcome.errorMessage ?? null, NOW(), id],
  );
}

export function listJobAttempts(jobId: string): JobAttemptRow[] {
  return db.all(
    'SELECT * FROM job_attempts WHERE job_id = ? ORDER BY attempt_number ASC',
    [jobId],
  ) as JobAttemptRow[];
}

// ---------------------------------------------------------------------------
// Recovery helpers: rows not owned by any live job
// ---------------------------------------------------------------------------

/** Non-terminal tasks that are NOT owned by an active job (legacy/direct executions). */
export function listOrphanNonTerminalTasks(): Array<{ id: string; user_id: string }> {
  return db.all(
    `SELECT t.id, t.user_id FROM tasks t
     WHERE t.status IN ('created', 'queued', 'running')
       AND NOT EXISTS (SELECT 1 FROM execution_jobs j WHERE j.task_id = t.id AND j.status IN ${ACTIVE_JOB_STATUSES})
       AND NOT EXISTS (
         SELECT 1 FROM execution_jobs j JOIN workflow_steps ws ON ws.workflow_id = j.workflow_id
         WHERE j.status IN ${ACTIVE_JOB_STATUSES} AND ws.task_id = t.id
       )`,
  ) as Array<{ id: string; user_id: string }>;
}

/** Non-terminal executions that are NOT owned by an active job. */
export function listOrphanNonTerminalExecutions(): Array<{ id: string }> {
  return db.all(
    `SELECT e.id FROM agent_executions e
     WHERE e.status IN ('queued', 'running')
       AND NOT EXISTS (
         SELECT 1 FROM execution_jobs j
         WHERE j.status IN ${ACTIVE_JOB_STATUSES}
           AND j.job_type = 'agent_execution'
           AND json_extract(j.payload_json, '$.executionId') = e.id
       )`,
  ) as Array<{ id: string }>;
}

/** Running workflows that are NOT owned by an active job. */
export function listOrphanRunningWorkflows(): Array<{ id: string }> {
  return db.all(
    `SELECT w.id FROM workflows w
     WHERE w.status = 'running'
       AND NOT EXISTS (SELECT 1 FROM execution_jobs j WHERE j.workflow_id = w.id AND j.status IN ${ACTIVE_JOB_STATUSES})`,
  ) as Array<{ id: string }>;
}
