-- 0014: ZA141251SA private agent economy (owner-only subsystem). PostgreSQL twin.
-- See db/migrations/0014_agent_economy.sql for the documented isolation and
-- revenue-honesty contract — identical intent, PG dialect.

CREATE TABLE economy_policy (
  id TEXT PRIMARY KEY,
  autonomous_enabled INTEGER NOT NULL DEFAULT 0,
  kill_switch INTEGER NOT NULL DEFAULT 0,
  discovery_enabled INTEGER NOT NULL DEFAULT 0,
  max_concurrent_executions INTEGER NOT NULL DEFAULT 2,
  max_daily_spend_cents INTEGER NOT NULL DEFAULT 500,
  max_opportunity_cost_cents INTEGER NOT NULL DEFAULT 200,
  min_expected_net_cents INTEGER NOT NULL DEFAULT 25,
  min_roi DOUBLE PRECISION NOT NULL DEFAULT 0.1,
  settlement_threshold_cents INTEGER NOT NULL DEFAULT 1000,
  settlement_destination TEXT NOT NULL DEFAULT 'owner-configured-settlement',
  max_economy_agents INTEGER NOT NULL DEFAULT 50,
  economy_model_key TEXT,
  discovery_categories_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE economy_opportunities (
  id TEXT PRIMARY KEY,
  source_url_hash TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  expected_revenue_cents INTEGER NOT NULL DEFAULT 0,
  expected_cost_cents INTEGER NOT NULL DEFAULT 0,
  time_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL DEFAULT 'medium',
  platform_rules TEXT,
  probability DOUBLE PRECISION NOT NULL DEFAULT 0.1,
  expected_net_cents INTEGER NOT NULL DEFAULT 0,
  roi DOUBLE PRECISION,
  estimate_basis TEXT NOT NULL DEFAULT 'category_default',
  status TEXT NOT NULL DEFAULT 'discovered',
  policy_decision_json TEXT,
  evidence_json TEXT,
  discovered_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  evaluated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE economy_revenue (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT REFERENCES economy_opportunities(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'expected',
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  evidence TEXT,
  external_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  received_at TEXT,
  settled_at TEXT
);

CREATE TABLE economy_executions (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES economy_opportunities(id) ON DELETE CASCADE,
  agent_slug TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'authorized',
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
  role TEXT NOT NULL DEFAULT 'worker',
  cost_share_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE economy_ledger (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  agent_slug TEXT,
  direction TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  purpose TEXT NOT NULL,
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL UNIQUE,
  policy_decision TEXT,
  status TEXT NOT NULL DEFAULT 'posted'
);

CREATE TABLE economy_resources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  description TEXT NOT NULL,
  monthly_cost_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'requested',
  requested_by_agent TEXT,
  policy_decision TEXT,
  provisioned_at TEXT,
  usage_json TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE economy_upgrades (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  current_value TEXT NOT NULL,
  candidate_value TEXT NOT NULL,
  benchmark_json TEXT,
  security_check TEXT NOT NULL DEFAULT 'pending',
  economic_check TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'proposed',
  applied_at TEXT,
  rolled_back_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE economy_expansions (
  id TEXT PRIMARY KEY,
  gap TEXT NOT NULL,
  parent_agent_slug TEXT,
  agent_slug TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  security_review_json TEXT,
  benchmark_json TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  decided_at TEXT
);

CREATE TABLE economy_improvements (
  id TEXT PRIMARY KEY,
  area TEXT NOT NULL,
  title TEXT NOT NULL,
  proposal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  sandbox_result_json TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE economy_agent_profiles (
  agent_slug TEXT PRIMARY KEY,
  parent_agent_slug TEXT,
  objectives TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  enabled_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE economy_events (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  kind TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  summary TEXT NOT NULL,
  details_json TEXT
);

CREATE TABLE economy_settlements (
  id TEXT PRIMARY KEY,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  destination TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_provider',
  ledger_ref TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  completed_at TEXT,
  evidence TEXT
);

CREATE INDEX idx_econ_opp_status ON economy_opportunities(status);
CREATE INDEX idx_econ_exec_status ON economy_executions(status);
CREATE INDEX idx_econ_ledger_ts ON economy_ledger(ts);
CREATE INDEX idx_econ_events_ts ON economy_events(ts);
CREATE INDEX idx_econ_revenue_state ON economy_revenue(state);

INSERT INTO economy_policy (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;
