-- 0014: ZA141251SA private agent economy (owner-only subsystem).
--
-- STRICT ISOLATION (by design, enforced in code):
--   * These tables are the agent economy's OWN ledger. No query path joins
--     them to user billing/credits — user funds and agent operating budget
--     never mix.
--   * All access is via /api/economy/* behind requireRole('owner',
--     'super_admin'). Nothing here is exposed to ordinary users.
--   * The 4,001-agent registry is NEVER altered: economy_agent_profiles is an
--     overlay keyed by the registry slug.
--
-- Revenue honesty: only RECEIVED revenue rows count as realized income;
-- every row carries an evidence field. Nothing in this schema can create
-- money out of thin air.

CREATE TABLE economy_policy (
  id TEXT PRIMARY KEY,                        -- singleton row 'global'
  autonomous_enabled INTEGER NOT NULL DEFAULT 0,  -- continuous operation (owner switch)
  kill_switch INTEGER NOT NULL DEFAULT 0,     -- emergency halt, overrides everything
  discovery_enabled INTEGER NOT NULL DEFAULT 0,
  max_concurrent_executions INTEGER NOT NULL DEFAULT 2,
  max_daily_spend_cents INTEGER NOT NULL DEFAULT 500,
  max_opportunity_cost_cents INTEGER NOT NULL DEFAULT 200,
  min_expected_net_cents INTEGER NOT NULL DEFAULT 25,
  min_roi REAL NOT NULL DEFAULT 0.1,
  settlement_threshold_cents INTEGER NOT NULL DEFAULT 1000,
  settlement_destination TEXT NOT NULL DEFAULT 'owner-configured-settlement',
  max_economy_agents INTEGER NOT NULL DEFAULT 50,
  economy_model_key TEXT,
  discovery_categories_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE economy_opportunities (
  id TEXT PRIMARY KEY,
  source_url_hash TEXT NOT NULL UNIQUE,       -- duplicate prevention across discovery runs
  source_url TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  expected_revenue_cents INTEGER NOT NULL DEFAULT 0,
  expected_cost_cents INTEGER NOT NULL DEFAULT 0,
  time_hours REAL NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL DEFAULT 'medium',  -- low | medium | high | prohibited
  platform_rules TEXT,
  probability REAL NOT NULL DEFAULT 0.1,
  expected_net_cents INTEGER NOT NULL DEFAULT 0,
  roi REAL,
  estimate_basis TEXT NOT NULL DEFAULT 'category_default',  -- estimates are ALWAYS labelled
  status TEXT NOT NULL DEFAULT 'discovered', -- discovered|evaluated|authorized|executing|completed|failed|blocked|expired
  policy_decision_json TEXT,
  evidence_json TEXT,
  discovered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  evaluated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE economy_revenue (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT REFERENCES economy_opportunities(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'expected',     -- discovered|expected|pending|received|settled|refunded|disputed
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  evidence TEXT,                              -- REQUIRED before received (never claim revenue without evidence)
  external_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  received_at TEXT,
  settled_at TEXT
);

CREATE TABLE economy_executions (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES economy_opportunities(id) ON DELETE CASCADE,
  agent_slug TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,       -- restart/race-safe: one live execution per opportunity
  status TEXT NOT NULL DEFAULT 'authorized',  -- authorized|running|completed|failed|cancelled|timed_out
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  started_at TEXT,
  timeout_at TEXT,
  completed_at TEXT,
  result_json TEXT,
  verification_json TEXT,
  error_message TEXT,
  cost_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE economy_execution_participants (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES economy_executions(id) ON DELETE CASCADE,
  agent_slug TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'worker',        -- planner | worker | verifier
  cost_share_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE economy_ledger (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  agent_slug TEXT,
  direction TEXT NOT NULL,                    -- credit | debit
  category TEXT NOT NULL,                     -- revenue|api_cost|compute_cost|storage_cost|agent_creation|resource_purchase|settlement
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  purpose TEXT NOT NULL,
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL UNIQUE,                -- idempotent ledger writes: a given reference posts exactly once
  policy_decision TEXT,
  status TEXT NOT NULL DEFAULT 'posted'
);

CREATE TABLE economy_resources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                         -- ai_api|search_api|storage|compute|database|software|domain|other
  provider TEXT NOT NULL,
  description TEXT NOT NULL,
  monthly_cost_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'requested',   -- requested|approved|denied|provisioned|retired
  requested_by_agent TEXT,
  policy_decision TEXT,
  provisioned_at TEXT,
  usage_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE economy_upgrades (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,                       -- model|tool|api|compute|storage
  current_value TEXT NOT NULL,
  candidate_value TEXT NOT NULL,
  benchmark_json TEXT,
  security_check TEXT NOT NULL DEFAULT 'pending',   -- pending|passed|failed
  economic_check TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'proposed',    -- proposed|approved|applied|rolled_back|rejected
  applied_at TEXT,
  rolled_back_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE economy_expansions (
  id TEXT PRIMARY KEY,
  gap TEXT NOT NULL,
  parent_agent_slug TEXT,
  agent_slug TEXT,
  status TEXT NOT NULL DEFAULT 'draft',       -- draft|testing|security_verified|approved|active|rejected
  security_review_json TEXT,
  benchmark_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_at TEXT
);

CREATE TABLE economy_improvements (
  id TEXT PRIMARY KEY,
  area TEXT NOT NULL,                         -- web|app|backend|orchestrator|registry|factory|ux|performance|security|qa|marketing|documentation|support|infrastructure
  title TEXT NOT NULL,
  proposal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',    -- proposed|sandbox_tested|approved|deployed|rejected
  sandbox_result_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE economy_agent_profiles (
  agent_slug TEXT PRIMARY KEY,                -- overlay ONLY; the registry itself is never modified
  parent_agent_slug TEXT,
  objectives TEXT,
  status TEXT NOT NULL DEFAULT 'active',      -- active|paused
  enabled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE economy_events (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  kind TEXT NOT NULL,                         -- discovery|evaluation|authorization|execution|revenue|settlement|resource|upgrade|expansion|improvement|security|system
  actor TEXT NOT NULL DEFAULT 'system',       -- system | <agent_slug> | owner
  summary TEXT NOT NULL,
  details_json TEXT
);

CREATE TABLE economy_settlements (
  id TEXT PRIMARY KEY,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  destination TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_provider', -- pending_provider|completed
  ledger_ref TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT,
  evidence TEXT
);

CREATE INDEX idx_econ_opp_status ON economy_opportunities(status);
CREATE INDEX idx_econ_exec_status ON economy_executions(status);
CREATE INDEX idx_econ_ledger_ts ON economy_ledger(ts);
CREATE INDEX idx_econ_events_ts ON economy_events(ts);
CREATE INDEX idx_econ_revenue_state ON economy_revenue(state);

INSERT OR IGNORE INTO economy_policy (id) VALUES ('global');
