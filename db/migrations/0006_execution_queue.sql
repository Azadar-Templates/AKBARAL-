-- 0006_execution_queue.sql
-- Persistent execution queue (Milestone 3: production execution engine).
--
-- Jobs survive process restarts. A job wraps either a single specialist agent
-- execution or a whole workflow run. Every attempt is recorded in
-- job_attempts for auditability. The idempotency key prevents duplicate
-- execution of the same logical work.

CREATE TABLE IF NOT EXISTS execution_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,                    -- agent_execution | workflow
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',     -- queued | running | retrying | completed | failed | cancelled | timed_out
  payload_json TEXT NOT NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 100,     -- lower runs first
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  locked_by TEXT,                            -- worker id that claimed the job
  locked_at TEXT,
  run_after TEXT,                            -- earliest next-run time (retry backoff)
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_jobs_idempotency ON execution_jobs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_execution_jobs_status_due ON execution_jobs(status, run_after, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_execution_jobs_task ON execution_jobs(task_id);
CREATE INDEX IF NOT EXISTS idx_execution_jobs_workflow ON execution_jobs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_execution_jobs_user ON execution_jobs(user_id, created_at);

CREATE TABLE IF NOT EXISTS job_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES execution_jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'started',    -- started | completed | failed | timed_out | cancelled
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_attempts_job ON job_attempts(job_id, attempt_number);
