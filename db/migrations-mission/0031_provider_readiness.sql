-- ZA141251SA PROVIDER READINESS + EXECUTION PIPELINE — closes GAP-2..4
-- All tables IF NOT EXISTS; no reset; strict isolation (mission DB only).

-- Provider capability / readiness registry: unified view over credentials/health/ToS/payout rail
CREATE TABLE IF NOT EXISTS mission_provider_readiness (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL UNIQUE, -- matches mission_platforms.id or tool key
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('EARNING_SOURCE','INFRASTRUCTURE','PAYMENT_RAIL','TOOL','RESTRICTED_HUMAN_ONLY','NOT_AN_EARNING_SOURCE','BLOCKED')),
  credential_env TEXT, -- e.g. FREELANCER_OAUTH_TOKEN, UPWORK_PAT
  requires_owner_account INTEGER NOT NULL CHECK(requires_owner_account IN (0,1)) DEFAULT 1,
  payout_verifiable INTEGER NOT NULL CHECK(payout_verifiable IN (0,1)) DEFAULT 0,
  api_permitted INTEGER NOT NULL CHECK(api_permitted IN (0,1)) DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('not_configured','configured','ready','blocked','restricted','degraded')) DEFAULT 'not_configured',
  health_json TEXT NOT NULL DEFAULT '{}', -- {lastCheck, ok, latencyMs, providerCode, detail}
  owner_actions_json TEXT NOT NULL DEFAULT '[]', -- JSON array of human steps still required
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provider_readiness_status ON mission_provider_readiness(status);
CREATE INDEX IF NOT EXISTS idx_provider_readiness_kind ON mission_provider_readiness(kind);

-- Provider failure classification (circuit breaker / backoff persistence across restarts)
CREATE TABLE IF NOT EXISTS mission_provider_failures (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES mission_provider_readiness(provider_id),
  failure_code TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('rate_limit','transient','auth','payment','toS_block','unreachable','validation')),
  detail TEXT,
  retry_after TEXT,
  backoff_ms INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provider_failures_provider ON mission_provider_failures(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_failures_category ON mission_provider_failures(category);

-- Connector execution contracts: input/output schema, idempotency, rate-limit, retries, backoff, error map
CREATE TABLE IF NOT EXISTS mission_connector_contracts (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL UNIQUE, -- matches mission_platforms.id
  execution_input_schema TEXT NOT NULL DEFAULT '{}',
  execution_output_schema TEXT NOT NULL DEFAULT '{}',
  idempotency_key_template TEXT NOT NULL DEFAULT 'exec:{opportunityId}:{agentId}',
  rate_limit_per_min INTEGER NOT NULL DEFAULT 10,
  max_retries INTEGER NOT NULL DEFAULT 3,
  backoff_base_ms INTEGER NOT NULL DEFAULT 60000,
  provider_error_map TEXT NOT NULL DEFAULT '{}', -- JSON: providerCode -> category
  audit_events TEXT NOT NULL DEFAULT '[]', -- JSON array of audit action names
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connector_contracts_connector ON mission_connector_contracts(connector_id);

-- Durable earning executions: execution→verification→settlement with retry/backoff/idempotency
CREATE TABLE IF NOT EXISTS mission_earning_executions (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES mission_earning_engine_opportunities(id),
  agent_id TEXT NOT NULL REFERENCES mission_agents(id),
  connector_id TEXT NOT NULL, -- denormalized from opportunity platform/provider
  idempotency_key TEXT NOT NULL UNIQUE,
  input_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL CHECK(state IN ('pending','running','verifying','verified','provider_confirmed','settlement_verified','failed','retry_scheduled','cancelled')) DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  last_error TEXT,
  last_error_category TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_earning_executions_opportunity ON mission_earning_executions(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_earning_executions_agent ON mission_earning_executions(agent_id);
CREATE INDEX IF NOT EXISTS idx_earning_executions_state ON mission_earning_executions(state);
CREATE INDEX IF NOT EXISTS idx_earning_executions_next_retry ON mission_earning_executions(next_retry_at);

-- Settlement verifications: independent USD verification (owner + provider ref, no synthetic)
CREATE TABLE IF NOT EXISTS mission_settlement_verifications (
  id TEXT PRIMARY KEY,
  execution_id TEXT REFERENCES mission_earning_executions(id),
  opportunity_id TEXT NOT NULL REFERENCES mission_earning_engine_opportunities(id),
  rail TEXT NOT NULL CHECK(rail IN ('bank','stripe','paypal','payoneer','wise','ach','sepa','wire')),
  external_id TEXT NOT NULL,
  provider_ref TEXT,
  verified INTEGER NOT NULL CHECK(verified IN (0,1)) DEFAULT 0,
  verification_detail TEXT NOT NULL DEFAULT '{}', -- JSON: rail, checks, evidence
  created_at TEXT NOT NULL,
  verified_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_opp_rail_ext ON mission_settlement_verifications(opportunity_id, rail, external_id);
CREATE INDEX IF NOT EXISTS idx_settlement_verified ON mission_settlement_verifications(verified);

-- Ensure provider_readiness seeded marker
INSERT OR IGNORE INTO mission_provider_readiness (id, provider_id, label, kind, credential_env, requires_owner_account, payout_verifiable, api_permitted, status, health_json, owner_actions_json, updated_at)
VALUES ('seed_guard', 'seed_guard', 'Seed guard', 'TOOL', NULL, 0, 0, 0, 'ready', '{}', '[]', datetime('now'));
DELETE FROM mission_provider_readiness WHERE provider_id='seed_guard';
