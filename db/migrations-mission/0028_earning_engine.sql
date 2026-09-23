-- ZA141251SA REAL EARNING ENGINE v1 — HIGH-VALUE USD MODE
-- Production infrastructure for the 17-component core loop. No revenue is created here;
-- tables store factual, auditable state. Verified USD only via payout-verification + receiving rail.

-- Rich high-value opportunities (beyond discovery) with full 17-field record + scoring + lifecycle
CREATE TABLE IF NOT EXISTS mission_earning_engine_opportunities (
  id TEXT PRIMARY KEY,
  registry_key TEXT NOT NULL, -- maps to opportunity-registry.ts key
  provider TEXT NOT NULL,
  platform TEXT NOT NULL,
  earning_mechanism TEXT NOT NULL,
  work_required TEXT NOT NULL,
  gross_cents INTEGER NOT NULL CHECK(gross_cents>0),
  expected_fees_cents INTEGER NOT NULL CHECK(expected_fees_cents>=0),
  expected_costs_cents INTEGER NOT NULL CHECK(expected_costs_cents>=0),
  net_cents INTEGER NOT NULL, -- gross - fees - costs (computed, may be negative)
  payment_method TEXT NOT NULL,
  settlement_evidence TEXT NOT NULL,
  automation_permitted INTEGER NOT NULL CHECK(automation_permitted IN (0,1)),
  human_only_actions TEXT NOT NULL,
  country_kyc_requirements TEXT NOT NULL,
  tos_restrictions TEXT NOT NULL,
  account_requirements TEXT NOT NULL,
  opportunity_expiry TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK(risk_level IN ('low','medium','high','critical')),
  required_capabilities_json TEXT NOT NULL, -- JSON array
  required_tools_json TEXT NOT NULL, -- JSON array subset of 94 integrations
  exclusive_agent_id TEXT REFERENCES mission_agents(id),
  verification_state TEXT NOT NULL CHECK(verification_state IN ('discovered','legitimacy_verified','qualified','assigned','executing','verified','delivered','payment_confirmed','settlement_verified','reinvested','scaled','failed','expired')) DEFAULT 'discovered',
  dedup_hash TEXT NOT NULL UNIQUE,
  evidence_hash TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('registry','platform_seed','permitted_feed','public_verified')),
  score_json TEXT NOT NULL, -- JSON of scoring breakdown
  score REAL NOT NULL,
  locked_by TEXT,
  locked_at TEXT,
  assigned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_earning_engine_score ON mission_earning_engine_opportunities(score DESC);
CREATE INDEX IF NOT EXISTS idx_earning_engine_state ON mission_earning_engine_opportunities(verification_state);
CREATE INDEX IF NOT EXISTS idx_earning_engine_registry ON mission_earning_engine_opportunities(registry_key);
CREATE INDEX IF NOT EXISTS idx_earning_engine_expiry ON mission_earning_engine_opportunities(opportunity_expiry);
CREATE INDEX IF NOT EXISTS idx_earning_engine_locked ON mission_earning_engine_opportunities(locked_by, locked_at);

-- Scoring audit (immutable history)
CREATE TABLE IF NOT EXISTS mission_earning_scores (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES mission_earning_engine_opportunities(id),
  net_value_cents INTEGER NOT NULL,
  payment_verifiability INTEGER NOT NULL,
  work_fit INTEGER NOT NULL,
  automation_permission INTEGER NOT NULL,
  success_evidence INTEGER NOT NULL,
  scalability INTEGER NOT NULL,
  low_operating_cost INTEGER NOT NULL,
  risk_penalty INTEGER NOT NULL,
  total REAL NOT NULL,
  scored_at TEXT NOT NULL
);

-- Agent earnings ledger (per-agent, per-opportunity, verified only)
CREATE TABLE IF NOT EXISTS mission_agent_earnings_ledger (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES mission_agents(id),
  opportunity_id TEXT NOT NULL REFERENCES mission_earning_engine_opportunities(id),
  gross_cents INTEGER NOT NULL,
  fees_cents INTEGER NOT NULL,
  costs_cents INTEGER NOT NULL,
  net_cents INTEGER NOT NULL,
  settlement_ref TEXT,
  verified INTEGER NOT NULL CHECK(verified IN (0,1)) DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_earnings_agent ON mission_agent_earnings_ledger(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_earnings_opportunity ON mission_agent_earnings_ledger(opportunity_id);

-- ROI tracker per opportunity class
CREATE TABLE IF NOT EXISTS mission_opportunity_roi (
  registry_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  total_gross_cents INTEGER NOT NULL DEFAULT 0,
  total_fees_cents INTEGER NOT NULL DEFAULT 0,
  total_costs_cents INTEGER NOT NULL DEFAULT 0,
  total_net_cents INTEGER NOT NULL DEFAULT 0,
  avg_score REAL NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL
);

-- Failed-opportunity learning (immutable)
CREATE TABLE IF NOT EXISTS mission_failed_learnings (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES mission_earning_engine_opportunities(id),
  registry_key TEXT NOT NULL,
  failure_reason TEXT NOT NULL,
  learned_adjustment TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Scaling log (Agent Factory bounded expansion)
CREATE TABLE IF NOT EXISTS mission_earning_scaling_log (
  id TEXT PRIMARY KEY,
  registry_key TEXT NOT NULL,
  source_opportunity_id TEXT NOT NULL REFERENCES mission_earning_engine_opportunities(id),
  new_agent_id TEXT NOT NULL REFERENCES mission_agents(id),
  parent_agent_id TEXT,
  scaling_reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
