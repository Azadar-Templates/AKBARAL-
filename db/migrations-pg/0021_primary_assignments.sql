-- PostgreSQL twin of db/migrations/0021_primary_assignments.sql.
-- Added without modifying any already-shipped SQLite migration/checksum.
-- 0021: Exclusive 1:1 primary assignments (agent ↔ earning opportunity).
--
-- RULE: every earning opportunity has EXACTLY ONE primary agent, and every
-- agent has AT MOST ONE primary opportunity. No shared primaries, ever.
--
-- WHAT THIS ADDS:
--   1. economy_opportunity_assignments. The exclusive primary mapping with
--      HARD database uniqueness on BOTH sides:
--        · UNIQUE(agent_slug)    — an agent holds at most one primary.
--        · UNIQUE(platform_key)  — a platform answers to one primary agent.
--        · UNIQUE(dedicated_account_property_id) — a concrete external
--          account/property (channel, store, seller seat, enrolled affiliate
--          identity) belongs to one assignment. NULL means "account not yet
--          created by the owner" — SQLite treats each NULL as distinct, so
--          any number of pending_account rows coexist honestly.
--      Status lifecycle: pending_account → active → paused → revoked.
--      required_credentials_json names the credential/scopes the work needs
--      (never the secret values); earning_workflow_key names the executable
--      workflow for the platform's mechanism.
--   2. economy_opportunities.platform_key — links a catalog-discovered
--      opportunity back to its platform so dispatch can route it to the
--      platform's primary agent. NULL for web-search discoveries.
--
-- The older economy_platform_assignments table is UNCHANGED: it holds
-- non-exclusive supporting/routing hints. Only this table confers primary
-- ownership, and only one row per side can exist — the database refuses
-- duplicates even if application code ever attempted them.
--
-- ISOLATION IS UNCHANGED: owner-only tables, no user-billing joins.

CREATE TABLE economy_opportunity_assignments (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL UNIQUE,
  platform_key TEXT NOT NULL UNIQUE REFERENCES economy_platforms(platform_key) ON DELETE CASCADE,
  dedicated_account_property_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending_account',  -- pending_account | active | paused | revoked
  required_credentials_json TEXT NOT NULL DEFAULT '[]',
  earning_workflow_key TEXT NOT NULL DEFAULT '',
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_opp_assignments_status ON economy_opportunity_assignments(status);

ALTER TABLE economy_opportunities ADD COLUMN platform_key TEXT;
CREATE INDEX idx_econ_opportunities_platform ON economy_opportunities(platform_key);
