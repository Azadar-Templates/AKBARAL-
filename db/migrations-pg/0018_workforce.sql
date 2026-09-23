-- PostgreSQL twin of db/migrations/0018_workforce.sql.
-- Added without modifying any already-shipped SQLite migration/checksum.
-- 0018: Workforce production layer — multi-category earning workforce.
--
-- WHAT THIS ADDS (and why):
--   The private economy (0014/0017) already runs discovery → evaluation →
--   durable execution → verification → ledger, with hierarchy gates and
--   owner-only access. This migration adds the MINIMUM missing production
--   tables the 4,000+ agent workforce needs to operate as a REAL system:
--
--     1. SOURCE HEALTH. Risk/earnings protection: every discovery source
--        (domain + category) tracks consecutive failures. After a threshold
--        the source is auto-blocked (unavailable/restricted/unreliable) so
--        agents stop depending on it, secure legitimate earnings, and search
--        alternatives. Blocks are lifted ONLY by the owner.
--     2. DELIVERIES. Proof of completed work: every workforce execution
--        records what was delivered, where the evidence lives, and whether
--        it verified. No delivery → no revenue claim, ever.
--     3. CUSTOMER COMMUNICATIONS. Legitimate, consented, template-bound
--        outbound contact (platform messaging where rules permit). Restricted
--        channels ALWAYS require owner approval; every request/decision/send
--        is audited. No bulk unsolicited messaging is representable.
--     4. WORKFLOW HEALTH. Monitoring + replacement of failed workflows: per
--        (agent, category) failure counts. Beyond threshold the workflow is
--        marked failed and must be replaced/retired by the owner or the
--        workforce scheduler — agents never silently loop on a dead workflow.
--     5. AGENT CAPABILITIES OVERLAY. Multi-category eligibility: every
--        registry agent may work across MANY earning categories. The overlay
--        records which categories each agent is enabled for (derived from
--        registry capabilities + owner grants), without touching the registry.
--
-- ISOLATION IS UNCHANGED: all tables belong to the private economy, reachable
-- only through owner-only routes, and never join user billing/credit data.
-- Revenue honesty is unchanged: only evidence-backed RECEIVED rows count.

-- Per-agent multi-category overlay (registry itself is never modified).
ALTER TABLE economy_agent_profiles ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE economy_agent_profiles ADD COLUMN categories_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE economy_agent_profiles ADD COLUMN last_active_at TEXT;

-- Workforce policy: reinvestment share + daily realized-revenue target.
-- (Parity with the mission treasury; 0 = unconfigured, allocates/tracks nothing.)
ALTER TABLE economy_policy ADD COLUMN reinvest_share_bps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE economy_policy ADD COLUMN daily_revenue_target_cents INTEGER NOT NULL DEFAULT 0;

CREATE TABLE economy_source_health (
  source_key TEXT PRIMARY KEY,                -- host + category, e.g. 'example.com|freelance'
  domain TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',      -- active|unavailable|restricted|unreliable|blocked
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  total_successes INTEGER NOT NULL DEFAULT 0,
  total_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_seen_at TEXT,
  blocked_at TEXT,
  blocked_reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX idx_econ_source_health_status ON economy_source_health(status);
CREATE INDEX idx_econ_source_health_category ON economy_source_health(category);

CREATE TABLE economy_deliveries (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES economy_executions(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES economy_opportunities(id) ON DELETE CASCADE,
  agent_slug TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'work_product',  -- work_product|platform_submission|file|message|product_listing
  title TEXT NOT NULL,
  evidence TEXT NOT NULL,                     -- tool outputs / verification summary (truncated)
  external_ref TEXT,                          -- provider confirmation (URL, listing id, message id)
  verified INTEGER NOT NULL DEFAULT 0,        -- 1 = passed workforce verification
  delivered_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX idx_econ_deliveries_execution ON economy_deliveries(execution_id);
CREATE INDEX idx_econ_deliveries_opportunity ON economy_deliveries(opportunity_id);
CREATE INDEX idx_econ_deliveries_agent ON economy_deliveries(agent_slug);

CREATE TABLE economy_comms (
  id TEXT PRIMARY KEY,
  execution_id TEXT REFERENCES economy_executions(id) ON DELETE SET NULL,
  opportunity_id TEXT REFERENCES economy_opportunities(id) ON DELETE SET NULL,
  agent_slug TEXT NOT NULL,
  channel TEXT NOT NULL,                      -- platform_message|email|sms|social_dm
  recipient_masked TEXT NOT NULL,             -- masked reference only (never raw PII in listings)
  template TEXT NOT NULL,                     -- owner-approved template key or 'freeform-owner-approved'
  content_preview TEXT NOT NULL,              -- first 500 chars for the approval queue
  consent_basis TEXT NOT NULL,                -- why this contact is legitimate
  status TEXT NOT NULL DEFAULT 'requested',   -- requested|approved|rejected|sent|failed
  decided_by TEXT,
  decided_at TEXT,
  provider_ref TEXT,                          -- real provider message id after send
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX idx_econ_comms_status ON economy_comms(status);
CREATE INDEX idx_econ_comms_agent ON economy_comms(agent_slug);

CREATE TABLE economy_workflows (
  agent_slug TEXT NOT NULL,
  category TEXT NOT NULL,
  workflow_key TEXT NOT NULL,                 -- stable key, e.g. 'freelance:proposal'
  status TEXT NOT NULL DEFAULT 'active',      -- active|failed|replaced|retired
  failure_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  replaced_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  PRIMARY KEY (agent_slug, category, workflow_key)
);

CREATE INDEX idx_econ_workflows_status ON economy_workflows(status);
