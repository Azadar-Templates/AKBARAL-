-- ZA141251SA PLATFORM CONNECTORS + DURABLE DISCOVERY
-- Classification of every integration/platform and lifecycle for newly discovered earning sources
-- Never auto-enable unsafe/restricted source

CREATE TABLE IF NOT EXISTS mission_platforms (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('EARNING_SOURCE','INFRASTRUCTURE','PAYMENT_RAIL','TOOL','RESTRICTED_HUMAN_ONLY','NOT_AN_EARNING_SOURCE')),
  opportunity_class TEXT, -- FK to opportunity-registry key when kind=EARNING_SOURCE or RESTRICTED_HUMAN_ONLY
  api_permitted INTEGER NOT NULL CHECK(api_permitted IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('DISCOVERED','QUALIFIED','POLICY_REVIEW','PAYMENT_VERIFICATION_READY','PERMITTED','ACTIVE','RESTRICTED','BLOCKED')) DEFAULT 'DISCOVERED',
  evidence TEXT NOT NULL, -- JSON: official docs, payout terms, ToS excerpt
  official_url TEXT,
  payout_verifiable INTEGER NOT NULL CHECK(payout_verifiable IN (0,1)) DEFAULT 0,
  requires_owner_account INTEGER NOT NULL CHECK(requires_owner_account IN (0,1)) DEFAULT 1,
  human_only_actions TEXT NOT NULL DEFAULT '[]', -- JSON array
  discovered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_platforms_kind ON mission_platforms(kind);
CREATE INDEX IF NOT EXISTS idx_platforms_status ON mission_platforms(status);
CREATE INDEX IF NOT EXISTS idx_platforms_class ON mission_platforms(opportunity_class);

CREATE TABLE IF NOT EXISTS mission_platform_discovery_log (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES mission_platforms(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_platform_log_platform ON mission_platform_discovery_log(platform_id);

-- Seed is handled in code; table starts empty and is populated via applyMissionMigrations + platform-discovery seed
