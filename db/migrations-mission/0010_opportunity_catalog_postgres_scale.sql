-- ZA141251SA mission — opportunity catalog PostgreSQL scale upgrade (0010)
-- Upgrades production catalog to PostgreSQL-compatible architecture for 100M+ scale
-- Adds content_hash for aggressive deduplication, requirements field, first_seen/last_seen explicit,
-- additional indexes for 100M+ queries, and ingestion state for resumable pagination.

-- ── New columns for aggressive deduplication and richer metadata ──
-- content_hash = SHA256(normalized title + description) for detecting duplicate content across URLs
-- requirements = JSON/text describing skills, eligibility, KYC, account rules in structured form
-- first_seen = explicit first time we saw this opportunity (created_at is also first_seen but keep explicit for PG)
-- last_seen = explicit last time we saw it (already have last_seen_at, but add alias for clarity)

-- SQLite ALTER TABLE ADD COLUMN is idempotent via IF NOT EXISTS emulation — we use try via CREATE and ignore if exists
-- For Postgres, ADD COLUMN IF NOT EXISTS is native, but our translation layer handles simple ADD COLUMN

-- Add content_hash (nullable for existing rows, will be backfilled)
ALTER TABLE mission_opportunities ADD COLUMN content_hash TEXT;
ALTER TABLE mission_opportunities ADD COLUMN requirements TEXT;
ALTER TABLE mission_opportunities ADD COLUMN first_seen_at TEXT;

-- Backfill first_seen_at from created_at where null
UPDATE mission_opportunities SET first_seen_at = created_at WHERE first_seen_at IS NULL;

-- Index for content_hash for aggressive deduplication
CREATE INDEX IF NOT EXISTS idx_opportunities_content_hash ON mission_opportunities(content_hash);

-- Additional composite indexes for 100M+ scale queries — PostgreSQL will use these for filtered pagination
-- These are compatible with both SQLite and Postgres (SQLite will use them, Postgres will benefit more)
CREATE INDEX IF NOT EXISTS idx_opportunities_status_category_created ON mission_opportunities(status, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_status_type_created ON mission_opportunities(status, opportunity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_platform_status ON mission_opportunities(platform, status);
CREATE INDEX IF NOT EXISTS idx_opportunities_source_status ON mission_opportunities(source_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_verified_at ON mission_opportunities(last_verified_at DESC) WHERE last_verified_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_first_seen ON mission_opportunities(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_payout_currency ON mission_opportunities(payout_currency);
CREATE INDEX IF NOT EXISTS idx_opportunities_automation ON mission_opportunities(automation_permission);

-- Partial indexes for common dashboard queries (PostgreSQL supports WHERE, SQLite also supports partial indexes since 3.8.0)
CREATE INDEX IF NOT EXISTS idx_opportunities_verified_status ON mission_opportunities(status) WHERE status = 'verified';
CREATE INDEX IF NOT EXISTS idx_opportunities_pending_status ON mission_opportunities(status) WHERE status = 'pending_review';

-- ── Ingestion state for resumable, cursor-based pagination at 100M+ scale ──
CREATE TABLE IF NOT EXISTS mission_opportunity_ingestion_state (
  source_id      TEXT PRIMARY KEY REFERENCES mission_opportunity_sources(id) ON DELETE CASCADE,
  cursor         TEXT, -- opaque pagination cursor (page number, next URL, or timestamp)
  last_page      INTEGER NOT NULL DEFAULT 0,
  total_fetched  INTEGER NOT NULL DEFAULT 0,
  total_new      INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  last_run_at    TEXT,
  next_run_at    TEXT, -- for scheduling resumable ingestion
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Opportunity content hash tracking for dedup across platforms ──
CREATE TABLE IF NOT EXISTS mission_opportunity_content_hashes (
  content_hash   TEXT PRIMARY KEY,
  first_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  count          INTEGER NOT NULL DEFAULT 1,
  example_opportunity_id TEXT REFERENCES mission_opportunities(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_content_hashes_count ON mission_opportunity_content_hashes(count DESC);

-- ── PostgreSQL-specific optimizations (will be ignored on SQLite via translation, but kept for documentation) ──
-- For Postgres production, these would be created manually or via separate migration:
--   CREATE EXTENSION IF NOT EXISTS pg_trgm; -- for LIKE search optimization
--   CREATE INDEX CONCURRENTLY idx_opportunities_title_trgm ON mission_opportunities USING gin (title gin_trgm_ops);
--   CREATE INDEX CONCURRENTLY idx_opportunities_skills_gin ON mission_opportunity_skills USING gin (skill);
--   BRIN index for time-series created_at (efficient for 100M+ append-only)
--   CREATE INDEX CONCURRENTLY idx_opportunities_created_brin ON mission_opportunities USING brin (created_at);
--   Partitioning by category or created_at month for 100M+ (requires PG 11+ declarative partitioning)
--   ALTER TABLE mission_opportunities PARTITION BY LIST (category); -- example

-- Update source stats to include content hash tracking
-- No data migration needed, just ensure stats table exists (already created in 0009)

-- Ensure ingestion queue has index for resumable cursor
CREATE INDEX IF NOT EXISTS idx_ingestion_queue_cursor ON mission_opportunity_ingestion_queue(cursor) WHERE cursor IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_queue_next_retry ON mission_opportunity_ingestion_queue(next_retry_at) WHERE next_retry_at IS NOT NULL;

-- Ensure rate limit table has index for daily reset
CREATE INDEX IF NOT EXISTS idx_rate_limits_daily_reset ON mission_opportunity_rate_limits(daily_reset_at) WHERE daily_reset_at IS NOT NULL;
