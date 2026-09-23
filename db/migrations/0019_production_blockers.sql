-- 0019: Production-blocker fixes from the 2026-09-19 workforce audit (D5/D9/D11 + image path).
--
-- WHAT THIS ADDS (and why):
--   1. WORKFORCE STAGING (D5). The workforce runs tools as the
--      'workforce:service' identity, which owns nothing. These two tables let
--      the owner stage SPECIFIC knowledge items and files for workforce use,
--      item by item. Unstaging revokes access immediately; deleting the
--      underlying file/knowledge row revokes it too (resolution joins live
--      rows at read time). No user data is reachable without explicit staging.
--   2. OWNER ALERTS (D11). Centralized, deduplicated record of silent-stop
--      conditions (discovery unavailable, source auto-blocked, workflow
--      failed, stale executions exhausted, settlement awaiting owner). One
--      open alert per dedupe key; repeats increment a counter instead of
--      spamming. Email delivery is best-effort and honestly recorded.
--   3. IMAGE REQUESTS (degraded-path fix). image_render stays out of the
--      autonomous tool set (paid tool). Agents file a request (free); the
--      owner approves per item; fulfillment calls the provider and attaches
--      the result. No approval → no spend, ever.
--   4. DELEGATION SCALE DEFAULT (D9). The 50-agent cap predates the 4,001
--      registry. Rows still on the shipped default move to 5000 (headroom for
--      the full registry + growth); owner-tuned values are NEVER touched.
--      Money gates (spawn cost, daily/per-opportunity caps, approvals) are
--      unchanged — counts scale, spending stays governed.
--
-- ISOLATION IS UNCHANGED: owner-only tables, no user-billing joins.
-- AUTONOMY IS UNCHANGED: autonomous_enabled/discovery_enabled keep their values.

-- D5 staging ---------------------------------------------------------------
CREATE TABLE workforce_staged_knowledge (
  knowledge_item_id TEXT PRIMARY KEY,   -- knowledge_items(id); resolved live at read time
  staged_by TEXT NOT NULL,              -- owner actor id
  staged_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE workforce_staged_files (
  file_id TEXT PRIMARY KEY,             -- files(id); storage key resolved live at read time
  staged_by TEXT NOT NULL,
  staged_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- D11 alerts ---------------------------------------------------------------
CREATE TABLE owner_alerts (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL,             -- one OPEN alert per key (e.g. 'source-blocked:example.com|seo')
  condition TEXT NOT NULL,              -- discovery-unavailable | source-blocked | workflow-failed | stale-executions | settlement-awaiting-owner
  severity TEXT NOT NULL DEFAULT 'warning', -- info | warning | critical
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  occurrences INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',  -- open | acknowledged | resolved
  delivery_status TEXT NOT NULL DEFAULT 'stored', -- stored | not_configured | sent | failed
  delivery_ref TEXT,
  delivery_error TEXT,
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_owner_alerts_status ON owner_alerts(status);
CREATE INDEX idx_owner_alerts_dedupe ON owner_alerts(dedupe_key, status);

-- Image path ---------------------------------------------------------------
CREATE TABLE workforce_image_requests (
  id TEXT PRIMARY KEY,
  execution_id TEXT,
  opportunity_id TEXT,
  agent_slug TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested', -- requested | approved | fulfilled | rejected | failed
  decided_by TEXT,
  decided_at TEXT,
  result_ref TEXT,                      -- provider URL or format/bytes note (never a fabricated image)
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_image_requests_status ON workforce_image_requests(status);
CREATE INDEX idx_image_requests_execution ON workforce_image_requests(execution_id);

-- D9 scale default (default-valued rows only; owner-tuned caps untouched) --
UPDATE economy_policy SET max_economy_agents = 5000, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE max_economy_agents = 50;
