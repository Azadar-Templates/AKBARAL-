-- PostgreSQL twin of db/migrations/0020_workforce_earning.sql.
-- Added without modifying any already-shipped SQLite migration/checksum.
-- 0020: Full earning workforce — platform catalog, delivery payments, reinvestment.
--
-- WHAT THIS ADDS (and why):
--   1. PLATFORM CATALOG (economy_platforms). The evidence-backed earning
--      inventory (affiliate programs/networks, creator programs, marketplaces,
--      freelance platforms) lives IN the database so agents can be matched to
--      real platforms with real terms (payout evidence, fees, KYC, countries,
--      risk, sources, verification date). Every row carries its verification
--      STATUS: only 'verified' (official payout evidence) and 'candidate'
--      (directory evidence) rows are ever seeded or served; 'rejected' rows
--      (gambling, scams, defunct, no documented earning mechanism) are NEVER
--      imported — the seed function refuses them.
--   2. PLATFORM ASSIGNMENTS (economy_platform_assignments). Explicit routing
--      hints binding an agent to the platforms it works. Assignment is not
--      permission: publishing/bidding still needs the platform account +
--      owner approval recorded on the category's requiresProvider path.
--   3. DELIVERY PAYMENTS (economy_delivery_payments). Closes the earning loop:
--      a VERIFIED delivery plus external payment evidence becomes 'received'
--      revenue exactly once (UNIQUE per delivery — double-claim impossible).
--   4. REINVESTMENT (economy_reinvestments). Owner-approved allocation of an
--      agent's REALIZED surplus back into growth (tools, inventory, ads).
--      Funded from evidence-backed surplus only; idempotent by key; every
--      decision lands in the audit trail.
--
-- ISOLATION IS UNCHANGED: owner-only tables, no user-billing joins.
-- AUTONOMY IS UNCHANGED: no auto-spend; reinvestment needs an owner decision,
-- payments need external evidence, publishing still needs accounts + approval.

-- 1. Platform catalog ------------------------------------------------------
CREATE TABLE economy_platforms (
  platform_key TEXT PRIMARY KEY,              -- stable slug, e.g. 'amazon-associates'
  name TEXT NOT NULL,
  official_url TEXT NOT NULL DEFAULT '',
  mechanism TEXT NOT NULL DEFAULT '',         -- affiliate | affiliate_network | creator_* | marketplace_selling | ...
  workforce_categories_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'candidate',   -- verified | candidate (rejected never stored)
  payout_evidence TEXT NOT NULL DEFAULT '',
  fees TEXT NOT NULL DEFAULT '',
  payout_method TEXT NOT NULL DEFAULT '',
  minimum_payout TEXT NOT NULL DEFAULT '',
  account_kyc TEXT NOT NULL DEFAULT '',
  countries TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT 'unknown', -- low | medium | high | unknown
  source_urls_json TEXT NOT NULL DEFAULT '[]',
  verification_date TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_economy_platforms_status ON economy_platforms(status);
CREATE INDEX idx_economy_platforms_mechanism ON economy_platforms(mechanism);

-- 2. Platform assignments --------------------------------------------------
CREATE TABLE economy_platform_assignments (
  agent_slug TEXT NOT NULL,
  platform_key TEXT NOT NULL REFERENCES economy_platforms(platform_key) ON DELETE CASCADE,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  PRIMARY KEY (agent_slug, platform_key)
);
CREATE INDEX idx_platform_assignments_agent ON economy_platform_assignments(agent_slug);

-- 3. Delivery payments (earning loop closer) -------------------------------
CREATE TABLE economy_delivery_payments (
  delivery_id TEXT PRIMARY KEY REFERENCES economy_deliveries(id) ON DELETE CASCADE,
  revenue_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  evidence TEXT NOT NULL,
  external_ref TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

-- 4. Reinvestment ----------------------------------------------------------
CREATE TABLE economy_reinvestments (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  purpose TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'proposed',   -- proposed | executed | rejected
  proposed_by TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
