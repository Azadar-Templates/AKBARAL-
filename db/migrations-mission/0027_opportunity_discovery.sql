-- Lawful autonomous opportunity discovery: inbound + permitted feed + public opportunity
-- Every discovered opportunity retains source/evidence, timestamp, provider, eligibility and dedup identity.
-- No discovered lead is revenue; revenue only via verified settlement on customer-work.
CREATE TABLE IF NOT EXISTS mission_discovery_opportunities (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK(source IN ('inbound','permitted_feed','public_opportunity')),
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  service_id TEXT NOT NULL CHECK(service_id IN ('json-validation','html-release-check')),
  brief TEXT NOT NULL,
  configuration_json TEXT NOT NULL,
  quote_cents INTEGER NOT NULL CHECK(quote_cents>0),
  evidence_hash TEXT NOT NULL,
  evidence TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  consent_expires_at TEXT NOT NULL,
  eligibility_json TEXT NOT NULL,
  dedup_hash TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('discovered','qualified','promoted','dismissed')),
  created_at TEXT NOT NULL,
  qualified_at TEXT,
  promoted_request_id TEXT REFERENCES mission_customer_requests(id),
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_discovery_dedup ON mission_discovery_opportunities(dedup_hash);
CREATE INDEX IF NOT EXISTS idx_discovery_source_state ON mission_discovery_opportunities(source, state);
CREATE INDEX IF NOT EXISTS idx_discovery_created ON mission_discovery_opportunities(created_at);
