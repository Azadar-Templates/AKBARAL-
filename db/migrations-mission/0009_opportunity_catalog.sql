-- ZA141251SA mission — opportunity discovery catalog (0009)
-- Scalable 100M+ earning-opportunity catalog, ingestion pipeline, deduplication, verification lifecycle.
-- No fabricated platforms/jobs/earnings — all sources must be legitimate public sources with real URLs.

-- ── Opportunity sources (legitimate public directories, APIs, affiliate networks, etc.) ──
CREATE TABLE IF NOT EXISTS mission_opportunity_sources (
  id                   TEXT PRIMARY KEY,
  key                  TEXT NOT NULL UNIQUE, -- e.g. upwork, fiverr, amazon_associates, remotive, gumroad
  name                 TEXT NOT NULL,
  category             TEXT NOT NULL, -- freelance_marketplace|affiliate_network|remote_job_board|creator_monetization|e_commerce|digital_product|research|survey|microtask|other
  description          TEXT,
  base_url             TEXT NOT NULL,
  api_endpoint         TEXT,
  docs_url             TEXT,
  tos_url              TEXT,
  privacy_url          TEXT,
  requires_api_key     INTEGER NOT NULL DEFAULT 0,
  api_key_env_var      TEXT,
  rate_limit_rpm       INTEGER NOT NULL DEFAULT 10, -- requests per minute
  rate_limit_daily     INTEGER NOT NULL DEFAULT 1000,
  automation_allowed   INTEGER NOT NULL DEFAULT 0, -- 0 disallowed, 1 allowed, 2 conditional
  automation_notes     TEXT,
  country_eligibility  TEXT NOT NULL DEFAULT '[]', -- JSON array of ISO codes or ["global"]
  payout_currencies    TEXT NOT NULL DEFAULT '[]', -- JSON array e.g. ["USD","EUR"]
  payout_methods       TEXT NOT NULL DEFAULT '[]', -- JSON e.g. ["paypal","bank","stripe"]
  fees_description     TEXT,
  account_rules        TEXT,
  api_available        INTEGER NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'active', -- active|paused|disabled|needs_api_key
  last_ingested_at     TEXT,
  last_verified_at     TEXT,
  ingestion_cursor     TEXT, -- opaque cursor for incremental ingestion
  total_ingested       INTEGER NOT NULL DEFAULT 0,
  total_verified       INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_opportunity_sources_category ON mission_opportunity_sources(category);
CREATE INDEX IF NOT EXISTS idx_opportunity_sources_status ON mission_opportunity_sources(status);

-- ── Main opportunity catalog (designed for 100M+ rows, cursor pagination, dedup) ──
CREATE TABLE IF NOT EXISTS mission_opportunities (
  id                    TEXT PRIMARY KEY,
  source_id             TEXT REFERENCES mission_opportunity_sources(id) ON DELETE SET NULL,
  platform              TEXT NOT NULL, -- e.g. Upwork, Fiverr, Amazon Associates, YouTube
  opportunity_type      TEXT NOT NULL, -- job|gig|affiliate_offer|product_listing|monetization_program|remote_job|survey|microtask|research|digital_product|other
  title                 TEXT NOT NULL,
  description           TEXT,
  category              TEXT NOT NULL, -- same taxonomy as sources, plus subcategories
  country_eligibility   TEXT NOT NULL DEFAULT '[]', -- JSON array
  skills                TEXT NOT NULL DEFAULT '[]', -- JSON array
  payout_currency       TEXT NOT NULL DEFAULT 'USD',
  payout_method         TEXT, -- paypal|bank|stripe|wise|payoneer|crypto|other
  payout_min_cents      INTEGER,
  payout_max_cents      INTEGER,
  payout_frequency      TEXT, -- one_time|hourly|monthly|per_sale|per_view|other
  fees                  TEXT, -- JSON or text description
  account_rules         TEXT,
  api_available         INTEGER NOT NULL DEFAULT 0,
  automation_permission TEXT NOT NULL DEFAULT 'conditional', -- allowed|disallowed|conditional
  tos_url               TEXT,
  source_url            TEXT NOT NULL, -- canonical URL where opportunity was found
  external_id           TEXT, -- provider's own ID
  dedup_hash            TEXT NOT NULL UNIQUE, -- sha256(platform|source_url|external_id|type)
  status                TEXT NOT NULL DEFAULT 'pending_review', -- pending_review|verified|rejected|expired|archived
  risk_level            TEXT NOT NULL DEFAULT 'medium', -- low|medium|high
  verification_notes    TEXT,
  last_verified_at      TEXT,
  last_seen_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Scalability indexes: never load all rows, always filtered + paginated
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_dedup ON mission_opportunities(dedup_hash);
CREATE INDEX IF NOT EXISTS idx_opportunities_source ON mission_opportunities(source_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_platform ON mission_opportunities(platform);
CREATE INDEX IF NOT EXISTS idx_opportunities_type ON mission_opportunities(opportunity_type);
CREATE INDEX IF NOT EXISTS idx_opportunities_category ON mission_opportunities(category);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON mission_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opportunities_risk ON mission_opportunities(risk_level);
CREATE INDEX IF NOT EXISTS idx_opportunities_created ON mission_opportunities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_verified ON mission_opportunities(last_verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_external ON mission_opportunities(external_id);

-- Country eligibility mapping for efficient filtering at scale (normalized)
CREATE TABLE IF NOT EXISTS mission_opportunity_countries (
  opportunity_id TEXT NOT NULL REFERENCES mission_opportunities(id) ON DELETE CASCADE,
  country_code   TEXT NOT NULL, -- ISO 3166-1 alpha-2 or "global"
  PRIMARY KEY (opportunity_id, country_code)
);
CREATE INDEX IF NOT EXISTS idx_opp_countries_country ON mission_opportunity_countries(country_code);

-- Skills mapping for efficient agent matching at scale
CREATE TABLE IF NOT EXISTS mission_opportunity_skills (
  opportunity_id TEXT NOT NULL REFERENCES mission_opportunities(id) ON DELETE CASCADE,
  skill          TEXT NOT NULL, -- normalized lower-case skill key
  PRIMARY KEY (opportunity_id, skill)
);
CREATE INDEX IF NOT EXISTS idx_opp_skills_skill ON mission_opportunity_skills(skill);

-- ── Ingestion queue (pagination, rate limits, retries, incremental) ──
CREATE TABLE IF NOT EXISTS mission_opportunity_ingestion_queue (
  id             TEXT PRIMARY KEY,
  source_id      TEXT NOT NULL REFERENCES mission_opportunity_sources(id) ON DELETE CASCADE,
  job_type       TEXT NOT NULL DEFAULT 'ingest', -- ingest|verify|reindex
  cursor         TEXT, -- pagination cursor or page number
  payload        TEXT, -- JSON: filters, since, etc.
  status         TEXT NOT NULL DEFAULT 'pending', -- pending|processing|completed|failed|rate_limited
  attempts       INTEGER NOT NULL DEFAULT 0,
  max_attempts   INTEGER NOT NULL DEFAULT 5,
  last_error     TEXT,
  next_retry_at  TEXT,
  rate_limit_key TEXT, -- e.g. source_id or api endpoint for bucketing
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at     TEXT,
  completed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_ingestion_queue_status ON mission_opportunity_ingestion_queue(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_ingestion_queue_source ON mission_opportunity_ingestion_queue(source_id, status);

-- Ingestion runs (audit trail of ingestion batches)
CREATE TABLE IF NOT EXISTS mission_opportunity_ingestion_runs (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL REFERENCES mission_opportunity_sources(id) ON DELETE CASCADE,
  started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at    TEXT,
  status          TEXT NOT NULL DEFAULT 'running', -- running|completed|failed
  items_fetched   INTEGER NOT NULL DEFAULT 0,
  items_new       INTEGER NOT NULL DEFAULT 0,
  items_updated   INTEGER NOT NULL DEFAULT 0,
  items_duplicate INTEGER NOT NULL DEFAULT 0,
  items_failed    INTEGER NOT NULL DEFAULT 0,
  cursor_start    TEXT,
  cursor_end      TEXT,
  error_summary   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_source ON mission_opportunity_ingestion_runs(source_id, started_at DESC);

-- ── Verification lifecycle (never fabricate earnings) ──
CREATE TABLE IF NOT EXISTS mission_opportunity_verifications (
  id              TEXT PRIMARY KEY,
  opportunity_id  TEXT NOT NULL REFERENCES mission_opportunities(id) ON DELETE CASCADE,
  verifier_type   TEXT NOT NULL, -- owner|system|api|manual
  verifier_id     TEXT,
  previous_status TEXT,
  new_status      TEXT NOT NULL, -- pending_review|verified|rejected|expired|archived
  risk_level      TEXT,
  notes           TEXT,
  source_url_checked TEXT,
  tos_checked     INTEGER NOT NULL DEFAULT 0,
  verified_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_verifications_opportunity ON mission_opportunity_verifications(opportunity_id, verified_at DESC);

-- ── Agent matching (4001+ agents, skills, eligibility, cost, automation permission) ──
CREATE TABLE IF NOT EXISTS mission_opportunity_matches (
  id              TEXT PRIMARY KEY,
  opportunity_id  TEXT NOT NULL REFERENCES mission_opportunities(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL REFERENCES mission_agents(id) ON DELETE CASCADE,
  score           INTEGER NOT NULL DEFAULT 0, -- 0-100 match score
  matched_on      TEXT NOT NULL DEFAULT '[]', -- JSON array of reasons e.g. ["skill:writing","country:US","automation:allowed"]
  status          TEXT NOT NULL DEFAULT 'suggested', -- suggested|assigned|rejected|completed
  assigned_at     TEXT,
  completed_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(opportunity_id, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_matches_agent ON mission_opportunity_matches(agent_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_matches_opportunity ON mission_opportunity_matches(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON mission_opportunity_matches(status);

-- ── Source stats materialized (for dashboard, updated incrementally) ──
CREATE TABLE IF NOT EXISTS mission_opportunity_source_stats (
  source_id      TEXT PRIMARY KEY REFERENCES mission_opportunity_sources(id) ON DELETE CASCADE,
  total          INTEGER NOT NULL DEFAULT 0,
  verified       INTEGER NOT NULL DEFAULT 0,
  pending_review INTEGER NOT NULL DEFAULT 0,
  rejected       INTEGER NOT NULL DEFAULT 0,
  expired        INTEGER NOT NULL DEFAULT 0,
  last_updated   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Rate limit buckets (in DB for persistence across restarts, also cached in memory) ──
CREATE TABLE IF NOT EXISTS mission_opportunity_rate_limits (
  bucket_key     TEXT PRIMARY KEY, -- e.g. source_id or api host
  requests_minute TEXT NOT NULL DEFAULT '[]', -- JSON array of timestamps
  requests_daily INTEGER NOT NULL DEFAULT 0,
  daily_reset_at TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Cache for API responses (avoid re-fetching, respect rate limits) ──
CREATE TABLE IF NOT EXISTS mission_opportunity_cache (
  cache_key      TEXT PRIMARY KEY, -- e.g. hash of url+params
  source_id      TEXT REFERENCES mission_opportunity_sources(id) ON DELETE SET NULL,
  response       TEXT NOT NULL, -- JSON
  etag           TEXT,
  expires_at     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON mission_opportunity_cache(expires_at);
