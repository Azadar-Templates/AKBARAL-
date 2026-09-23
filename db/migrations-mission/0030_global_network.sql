-- ZA141251SA GLOBAL AGENT EARNING NETWORK — durable workers, discovery, allocation, intelligence
-- Extends without resetting existing work; all tables IF NOT EXISTS.

-- Global discovery runs: durable record of each discovery sweep beyond the 57 connectors
CREATE TABLE IF NOT EXISTS mission_global_discovery_runs (
  id TEXT PRIMARY KEY,
  cycle INTEGER NOT NULL,
  discovered_sources INTEGER NOT NULL DEFAULT 0,
  new_platforms INTEGER NOT NULL DEFAULT 0,
  new_opportunities INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')) DEFAULT 'completed',
  detail TEXT, -- JSON: sources scanned, classification summary
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_global_discovery_cycle ON mission_global_discovery_runs(cycle);

-- Allocator assignments: every MATCH→LOCK decision with full scoring breakdown
CREATE TABLE IF NOT EXISTS mission_allocator_assignments (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES mission_earning_engine_opportunities(id),
  agent_id TEXT NOT NULL REFERENCES mission_agents(id),
  score REAL NOT NULL,
  breakdown_json TEXT NOT NULL, -- {capability, value, tools, permissions, history, workload, cost, risk, settlement}
  reasoning TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_allocator_agent ON mission_allocator_assignments(agent_id);
CREATE INDEX IF NOT EXISTS idx_allocator_opp ON mission_allocator_assignments(opportunity_id);

-- Scheduler heartbeats: durable continuous loop state (DISCOVER→...→DISCOVER AGAIN)
CREATE TABLE IF NOT EXISTS mission_scheduler_state (
  id TEXT PRIMARY KEY, -- singleton 'global'
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)) DEFAULT 0,
  last_tick_at TEXT,
  last_cycle INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO mission_scheduler_state (id, enabled, last_tick_at, last_cycle, consecutive_failures, last_error, updated_at)
VALUES ('global', 0, NULL, 0, 0, NULL, datetime('now'));

-- Scheduler ticks: each tick processes retries/expiry/failures/rate-limits safely
CREATE TABLE IF NOT EXISTS mission_scheduler_ticks (
  id TEXT PRIMARY KEY,
  cycle INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  discovered INTEGER NOT NULL DEFAULT 0,
  qualified INTEGER NOT NULL DEFAULT 0,
  matched INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  executing INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  settled INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  retried INTEGER NOT NULL DEFAULT 0,
  expired INTEGER NOT NULL DEFAULT 0,
  rate_limited INTEGER NOT NULL DEFAULT 0,
  detail TEXT, -- JSON summary
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')) DEFAULT 'running'
);
CREATE INDEX IF NOT EXISTS idx_scheduler_ticks_cycle ON mission_scheduler_ticks(cycle);

-- Earning intelligence: persistent per-cycle analytics (never invent probability)
CREATE TABLE IF NOT EXISTS mission_earning_intelligence (
  id TEXT PRIMARY KEY,
  cycle INTEGER NOT NULL,
  registry_key TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  verified_payments INTEGER NOT NULL DEFAULT 0,
  gross_cents INTEGER NOT NULL DEFAULT 0,
  fees_cents INTEGER NOT NULL DEFAULT 0,
  net_cents INTEGER NOT NULL DEFAULT 0,
  avg_score REAL NOT NULL DEFAULT 0,
  avg_settlement_hours REAL,
  failure_reason TEXT,
  computed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intel_key ON mission_earning_intelligence(registry_key);
CREATE INDEX IF NOT EXISTS idx_intel_cycle ON mission_earning_intelligence(cycle);

-- Ensure scheduler tick idempotency guard
CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduler_tick_cycle ON mission_scheduler_ticks(cycle);
