-- ZA141251SA mission — billionaire aspirational daily target per agent (0008)
--
-- Every mission agent has a persistent objective to maximize legitimate,
-- verified real-world earnings toward an owner-defined aspirational target
-- of $1B verified revenue PER DAY PER AGENT.
--
-- This migration:
--  1. Adds per-agent daily target columns to mission_agents
--     (daily_target_cents, daily_target_currency, persistent_objective)
--     with default $1B/day (100_000_000_000 cents = $1,000,000,000).
--  2. Creates mission_agent_daily_targets — per-agent, per-day progress
--     tracking (target, realized verified only, remaining, met flag, met_at).
--     Resets daily via day column (YYYY-MM-DD UTC).
--  3. Initializes existing agents to $1B/day if they have no target.
--  4. Sets global policy daily_revenue_target_cents to $1B/day if currently 0,
--     so fresh deployments start with the owner-defined objective.
--  5. No fake revenue, no guarantees — progress counts ONLY verified received
--     revenue (status='received' + verifier NOT NULL).

-- Per-agent daily target columns (owner-defined aspirational, configurable)
ALTER TABLE mission_agents ADD COLUMN daily_target_cents INTEGER NOT NULL DEFAULT 100000000000;
ALTER TABLE mission_agents ADD COLUMN daily_target_currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE mission_agents ADD COLUMN persistent_objective TEXT NOT NULL DEFAULT 'Maximize legitimate, verified real-world earnings toward $1,000,000,000 verified revenue per day aspirational target — lawful, sustainable, verifiable only, no guarantees, no fabrication. Pursue fastest lawful sustainable verifiable opportunities within capabilities, resources, provider ToS, and platform rules.';

-- Per-agent daily progress (resets every UTC day)
CREATE TABLE IF NOT EXISTS mission_agent_daily_targets (
  agent_id       TEXT NOT NULL REFERENCES mission_agents(id) ON DELETE CASCADE,
  day            TEXT NOT NULL, -- UTC date YYYY-MM-DD
  target_cents   INTEGER NOT NULL,
  realized_cents INTEGER NOT NULL DEFAULT 0,
  remaining_cents INTEGER NOT NULL DEFAULT 0,
  progress_pct   REAL NOT NULL DEFAULT 0,
  met            INTEGER NOT NULL DEFAULT 0,
  met_at         TEXT,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (agent_id, day)
);
CREATE INDEX IF NOT EXISTS idx_agent_daily_targets_day ON mission_agent_daily_targets(day);
CREATE INDEX IF NOT EXISTS idx_agent_daily_targets_agent ON mission_agent_daily_targets(agent_id);

-- Initialize existing agents that have 0 or NULL target to $1B/day
UPDATE mission_agents SET daily_target_cents = 100000000000 WHERE daily_target_cents IS NULL OR daily_target_cents = 0 OR daily_target_cents < 100000000000;
UPDATE mission_agents SET daily_target_currency = 'USD' WHERE daily_target_currency IS NULL OR daily_target_currency = '';
UPDATE mission_agents SET persistent_objective = 'Maximize legitimate, verified real-world earnings toward $1,000,000,000 verified revenue per day aspirational target — lawful, sustainable, verifiable only, no guarantees, no fabrication. Pursue fastest lawful sustainable verifiable opportunities within capabilities, resources, provider ToS, and platform rules.' WHERE persistent_objective IS NULL OR persistent_objective = '';

-- Set global policy daily target to $1B/day if currently unconfigured (0)
-- This is the owner-defined performance objective, not a guarantee.
UPDATE mission_policy SET daily_revenue_target_cents = 100000000000 WHERE daily_revenue_target_cents = 0 OR daily_revenue_target_cents IS NULL;
