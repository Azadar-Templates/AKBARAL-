import { db } from './database';
import { createId } from './id';

/**
 * Automation & scheduled-workflow persistence (migration 0010).
 *
 * Concurrency contract:
 *   - Occurrence-level duplicate protection comes from the UNIQUE index on
 *     automation_runs.idempotency_key: two scheduler instances (or a restart
 *     racing the previous process) can both attempt to fire the same
 *     occurrence; exactly one insert wins.
 *   - Status transitions use guarded UPDATE ... WHERE status IN (...), the
 *     same pattern as the execution queue.
 */

export interface AutomationRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused';
  trigger_type: string;
  schedule_json: string;
  condition_json: string | null;
  steps_json: string;
  timeout_ms: number;
  max_retries: number;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  fail_count: number;
  created_at: string;
  updated_at: string;
}

export interface AutomationRunRow {
  id: string;
  automation_id: string;
  user_id: string;
  workflow_id: string | null;
  job_id: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  trigger_reason: 'schedule' | 'manual';
  idempotency_key: string;
  scheduled_for: string | null;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  attempt: number;
  created_at: string;
}

export function createAutomationRow(input: {
  userId: string;
  name: string;
  description: string | null;
  scheduleJson: string;
  conditionJson: string | null;
  stepsJson: string;
  timeoutMs: number;
  maxRetries: number;
  nextRunAt: string | null;
}): AutomationRow {
  const id = createId('atm');
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO automations
       (id, user_id, name, description, status, trigger_type, schedule_json, condition_json, steps_json,
        timeout_ms, max_retries, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', 'schedule', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      input.name,
      input.description,
      input.scheduleJson,
      input.conditionJson,
      input.stepsJson,
      input.timeoutMs,
      input.maxRetries,
      input.nextRunAt,
      now,
      now,
    ],
  );
  return getAutomationRow(id) as AutomationRow;
}

export function getAutomationRow(id: string): AutomationRow | undefined {
  return db.get<AutomationRow>('SELECT * FROM automations WHERE id = ? AND schedule_json IS NOT NULL', [id]);
}

export function listAutomationRowsByUser(userId: string, limit = 100): AutomationRow[] {
  return db.all<AutomationRow>(
    `SELECT * FROM automations WHERE user_id = ? AND schedule_json IS NOT NULL ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  );
}

export function countActiveAutomationsByUser(userId: string): number {
  const row = db.get<{ total: number }>(`SELECT COUNT(*) AS total FROM automations WHERE user_id = ? AND status = 'active' AND schedule_json IS NOT NULL`, [userId]);
  return row?.total ?? 0;
}

export function updateAutomationRow(input: {
  id: string;
  name: string;
  description: string | null;
  scheduleJson: string;
  conditionJson: string | null;
  stepsJson: string;
  timeoutMs: number;
  maxRetries: number;
  nextRunAt: string | null;
}): boolean {
  const result = db.run(
    `UPDATE automations SET name = ?, description = ?, schedule_json = ?, condition_json = ?, steps_json = ?,
        timeout_ms = ?, max_retries = ?, next_run_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.name,
      input.description,
      input.scheduleJson,
      input.conditionJson,
      input.stepsJson,
      input.timeoutMs,
      input.maxRetries,
      input.nextRunAt,
      new Date().toISOString(),
      input.id,
    ],
  );
  return result.changes === 1;
}

/** Pause or resume. Resuming recomputes the next occurrence from now. */
export function setAutomationStatus(id: string, status: 'active' | 'paused', nextRunAt: string | null): boolean {
  const result = db.run(
    `UPDATE automations SET status = ?, next_run_at = ?, updated_at = ? WHERE id = ?`,
    [status, nextRunAt, new Date().toISOString(), id],
  );
  return result.changes === 1;
}

/** Scheduler bookkeeping when an occurrence is fired (stats only — next_run_at is advanced separately). */
export function recordAutomationFired(id: string): void {
  db.run(
    `UPDATE automations SET last_run_at = ?, run_count = run_count + 1, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), new Date().toISOString(), id],
  );
}

export function recordAutomationFailure(id: string): void {
  db.run(`UPDATE automations SET fail_count = fail_count + 1, updated_at = ? WHERE id = ?`, [new Date().toISOString(), id]);
}

export function listDueAutomations(nowIso: string, limit = 50): AutomationRow[] {
  return db.all<AutomationRow>(
    `SELECT * FROM automations WHERE status = 'active' AND schedule_json IS NOT NULL AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC LIMIT ?`,
    [nowIso, limit],
  );
}

export function deleteAutomationRow(id: string): boolean {
  const result = db.run(`DELETE FROM automations WHERE id = ?`, [id]);
  return result.changes === 1;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/**
 * Insert a run with occurrence-level idempotency. Returns undefined when the
 * occurrence was already recorded (duplicate fire attempt).
 */
export function insertAutomationRun(input: {
  automationId: string;
  userId: string;
  triggerReason: 'schedule' | 'manual';
  idempotencyKey: string;
  scheduledFor: string | null;
}): AutomationRunRow | undefined {
  const id = createId('arn');
  try {
    db.run(
      `INSERT INTO automation_runs (id, automation_id, user_id, status, trigger_reason, idempotency_key, scheduled_for, created_at)
       VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)`,
      [id, input.automationId, input.userId, input.triggerReason, input.idempotencyKey, input.scheduledFor, new Date().toISOString()],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('idx_automation_runs_idempotency') || message.toUpperCase().includes('UNIQUE')) {
      return undefined;
    }
    throw error;
  }
  return getAutomationRunRow(id);
}

export function getAutomationRunRow(id: string): AutomationRunRow | undefined {
  return db.get<AutomationRunRow>('SELECT * FROM automation_runs WHERE id = ?', [id]);
}

export function listAutomationRunRows(automationId: string, limit = 25): AutomationRunRow[] {
  return db.all<AutomationRunRow>(
    `SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY created_at DESC LIMIT ?`,
    [automationId, limit],
  );
}

export function listOpenAutomationRunRows(): AutomationRunRow[] {
  return db.all<AutomationRunRow>(`SELECT * FROM automation_runs WHERE status IN ('queued', 'running') ORDER BY created_at ASC LIMIT 200`);
}

export function getLastSettledAutomationRun(automationId: string): AutomationRunRow | undefined {
  return db.get<AutomationRunRow>(
    `SELECT * FROM automation_runs WHERE automation_id = ? AND status IN ('completed', 'failed', 'cancelled', 'skipped') ORDER BY created_at DESC LIMIT 1`,
    [automationId],
  );
}

/** Attach the created workflow/job to a queued run. */
export function attachRunExecution(runId: string, workflowId: string, jobId: string): void {
  db.run(
    `UPDATE automation_runs SET workflow_id = ?, job_id = ?, started_at = COALESCE(started_at, ?) WHERE id = ? AND status = 'queued'`,
    [workflowId, jobId, new Date().toISOString(), runId],
  );
}

export function markRunRunning(runId: string): void {
  db.run(`UPDATE automation_runs SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ? AND status IN ('queued', 'running')`, [
    new Date().toISOString(),
    runId,
  ]);
}

/** Guarded terminal transition — exactly one settler wins. */
export function settleAutomationRun(input: {
  runId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'skipped';
  errorMessage?: string | null;
}): boolean {
  const result = db.run(
    `UPDATE automation_runs SET status = ?, finished_at = ?, error_message = ? WHERE id = ? AND status IN ('queued', 'running')`,
    [input.status, new Date().toISOString(), input.errorMessage ?? null, input.runId],
  );
  return result.changes === 1;
}

export function bumpRunAttempt(runId: string): void {
  db.run(`UPDATE automation_runs SET attempt = attempt + 1 WHERE id = ?`, [runId]);
}
