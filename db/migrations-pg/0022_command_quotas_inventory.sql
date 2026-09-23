-- PostgreSQL twin of db/migrations/0022_command_quotas_inventory.sql.
-- Added without modifying any already-shipped SQLite migration/checksum.
-- 0022: Owner command flow, per-agent quotas, upgrade autonomy gates,
-- scalable inventory pipeline, ledger immutability.
--
-- WHAT THIS ADDS (and why):
--   * economy_commands — owner → agent command → opportunity → execution →
--     delivery → verification linkage. Every command is idempotent, audited,
--     and refuses to run under kill-switch/freeze/paused-agent.
--   * economy_agent_profiles quota columns — per-agent daily/monthly spend
--     caps (NULL = no quota). Spend checks read them before any debit.
--   * economy_policy auto-upgrade gates (default OFF) + economy_upgrades cost
--     + requester attribution — agents may REQUEST upgrades anytime; autonomous
--     execution needs owner-enabled policy + affordability from realized earnings.
--   * Inventory scale columns (source/external_id/content_hash) + import batch
--     + quarantine tables — the pipeline can ingest millions of rows with
--     validation, dedupe and per-batch reports. Only evidence-backed rows ever
--     reach economy_platforms; everything else is quarantined with a reason.
--   * Ledger immutability triggers — UPDATE/DELETE on economy_ledger abort.
--     Money history is append-only at the database layer, not just by convention.
--
-- DIALECT DIFFERENCES FROM THE SQLITE TWIN (intentional, and the reason this
-- file cannot be a byte-for-byte copy):
--   1. Timestamp defaults use to_char(now() at time zone 'utc', …) instead of
--      SQLite's strftime('%Y-%m-%dT%H:%M:%fZ','now'), matching every other
--      PostgreSQL migration in this directory.
--   2. SQLite expresses a refusing trigger as
--        CREATE TRIGGER … BEFORE UPDATE ON t BEGIN SELECT RAISE(ABORT, '…'); END;
--      PostgreSQL has no inline trigger body, so the same refusal is a PL/pgSQL
--      function plus two BEFORE triggers. Behaviour is identical: the statement
--      aborts and the caller receives the same message text.
--   3. Partial and expression indexes are portable; they are kept verbatim.

-- 1. Owner command flow ----------------------------------------------------
CREATE TABLE economy_commands (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,     -- owner-supplied; replays return the same command
  owner_user_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,                 -- registry slug, never free text
  instruction TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued',    -- issued|acknowledged|running|completed|failed|cancelled
  opportunity_id TEXT NULL REFERENCES economy_opportunities(id),
  execution_id TEXT NULL REFERENCES economy_executions(id),
  delivery_id TEXT NULL,
  result_summary TEXT NULL,
  verification TEXT NULL,                   -- verified|failed|pending|NULL (not yet judged)
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_economy_commands_agent ON economy_commands(agent_slug, created_at);
CREATE INDEX idx_economy_commands_status ON economy_commands(status);

-- 2. Per-agent spend quotas -------------------------------------------------
ALTER TABLE economy_agent_profiles ADD COLUMN daily_spend_quota_cents INTEGER NULL;
ALTER TABLE economy_agent_profiles ADD COLUMN monthly_spend_quota_cents INTEGER NULL;

-- 3. Upgrade autonomy gates --------------------------------------------------
ALTER TABLE economy_policy ADD COLUMN auto_upgrade_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE economy_policy ADD COLUMN max_auto_upgrade_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE economy_upgrades ADD COLUMN cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE economy_upgrades ADD COLUMN requested_by_agent TEXT NULL;

-- 4. Inventory scale ----------------------------------------------------------
ALTER TABLE economy_platforms ADD COLUMN source TEXT NOT NULL DEFAULT 'seed';
ALTER TABLE economy_platforms ADD COLUMN external_id TEXT NOT NULL DEFAULT '';
ALTER TABLE economy_platforms ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX idx_platforms_source_ext ON economy_platforms(source, external_id) WHERE external_id != '';
CREATE INDEX idx_platforms_hash ON economy_platforms(content_hash) WHERE content_hash != '';
CREATE INDEX idx_platforms_source ON economy_platforms(source);

CREATE TABLE economy_inventory_batches (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  received INTEGER NOT NULL DEFAULT 0,
  imported INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  quarantined INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE economy_inventory_quarantine (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES economy_inventory_batches(id),
  source TEXT NOT NULL DEFAULT '',
  external_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,                 -- why this row was refused (exact)
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_quarantine_batch ON economy_inventory_quarantine(batch_id);

-- 5. Ledger immutability ------------------------------------------------------
-- PostgreSQL equivalent of SQLite's `SELECT RAISE(ABORT, …)`: a function that
-- always raises, wired to BEFORE UPDATE and BEFORE DELETE so the statement
-- never commits. Money history stays append-only at the database layer.
CREATE OR REPLACE FUNCTION economy_ledger_refuse_mutation() RETURNS trigger AS $body$
BEGIN
  RAISE EXCEPTION 'economy_ledger is immutable: % refused', TG_OP;
END;
$body$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE ON economy_ledger
  FOR EACH ROW EXECUTE FUNCTION economy_ledger_refuse_mutation();
CREATE TRIGGER trg_ledger_no_delete BEFORE DELETE ON economy_ledger
  FOR EACH ROW EXECUTE FUNCTION economy_ledger_refuse_mutation();
