-- 0010: Automation & Scheduled Workflows.
--
-- The `automations` table was introduced in 0003 as a CRM trigger skeleton
-- (name + trigger_key + opaque steps, never executed). This migration evolves
-- that same table into the production scheduling system: one-time, recurring
-- (cron, timezone-aware) and interval schedules, conditions, per-step goals,
-- timeouts, retries and occurrence-level idempotency.
--
-- The table is rebuilt because SQLite cannot relax the legacy NOT NULL on
-- trigger_key, which scheduler-managed rows do not use. Cohort isolation:
-- legacy CRM rows (created via /api/crm/automations, trigger_key set) keep
-- working unchanged and are excluded from scheduling (schedule_json NULL);
-- scheduler rows (created via /api/automations) have schedule_json set.
--
-- Runs are first-class rows with a UNIQUE idempotency key per occurrence so
-- scheduler restarts or racing instances can never double-fire.

CREATE TABLE automations_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_key TEXT,                          -- legacy CRM cohort; NULL for scheduler rows
  condition_json TEXT,
  steps_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',     -- active | paused
  run_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  next_run_at TEXT,                          -- NULL => not scheduled (fired one-shot / paused / legacy)
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  trigger_type TEXT,                         -- 'schedule' for scheduler-managed rows
  schedule_json TEXT,                        -- {kind:'once'|'cron'|'interval', ...}
  description TEXT,
  timeout_ms INTEGER NOT NULL DEFAULT 900000,
  max_retries INTEGER NOT NULL DEFAULT 1
);

INSERT INTO automations_new
  (id, user_id, name, trigger_key, condition_json, steps_json, status, run_count, last_run_at, created_at, updated_at)
SELECT
  id, user_id, name, trigger_key, condition_json, steps_json, status, run_count, last_run_at, created_at, updated_at
FROM automations;

DROP TABLE automations;
ALTER TABLE automations_new RENAME TO automations;

CREATE INDEX IF NOT EXISTS idx_automations_user_id ON automations(user_id);
CREATE INDEX IF NOT EXISTS idx_automations_status ON automations(status);
CREATE INDEX IF NOT EXISTS idx_automations_due ON automations(status, next_run_at);

CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_id TEXT,
  job_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',      -- queued | running | completed | failed | cancelled | skipped
  trigger_reason TEXT NOT NULL DEFAULT 'schedule', -- schedule | manual
  idempotency_key TEXT NOT NULL,
  scheduled_for TEXT,
  started_at TEXT,
  finished_at TEXT,
  error_message TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_runs_idempotency ON automation_runs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs(automation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_open ON automation_runs(status);

-- Multi-step automations carry a per-step goal; the shared workflow engine
-- reads it (falling back to the workflow goal for MASTER-planned workflows).
ALTER TABLE workflow_steps ADD COLUMN goal TEXT;
