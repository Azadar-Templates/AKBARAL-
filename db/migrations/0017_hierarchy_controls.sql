-- 0017: hierarchy + spending controls for the private agent economy.
--
-- WHAT THIS ADDS (and why):
--   The hierarchy gates in 0015 enforced depth and children-per-parent at the
--   moment an expansion is created. Three controls were still missing for a
--   system that may run hundreds of delegated agents unsupervised:
--
--     1. RATE + COST ACCOUNTABILITY. A parent could spawn its allowed children
--        as fast as calls arrived, each spawn free of charge. spawning now
--        costs the parent budget and is rate-limited per hour.
--     2. SUBTREE CONTROL. Pausing one agent said nothing about its
--        descendants. An owner needs to pause/resume ONE AGENT or a WHOLE
--        HIERARCHY, and to be able to stop all autonomous work at once.
--     3. SPEND / WITHDRAWAL / PROVIDER FREEZES. The kill switch stops
--        everything; these are the narrower brakes an operator needs while
--        investigating — stop buying, stop moving money out, stop reaching
--        providers — without losing the audit trail.
--
-- EVERY decision this schema supports is written down: economy_delegations
-- stores one row per spawn attempt (authorized OR rejected, with the exact
-- checks that produced the verdict), so "why did this agent exist?" always has
-- an answer traceable to agent → parent → decision.
--
-- ISOLATION IS UNCHANGED: these tables belong to the private economy, are
-- reachable only through /api/economy/* behind requireRole('owner',
-- 'super_admin'), and never join user billing data.

ALTER TABLE economy_policy ADD COLUMN spawn_rate_per_hour INTEGER NOT NULL DEFAULT 6;
ALTER TABLE economy_policy ADD COLUMN spawn_cost_cents INTEGER NOT NULL DEFAULT 50;
ALTER TABLE economy_policy ADD COLUMN freeze_spending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE economy_policy ADD COLUMN freeze_withdrawals INTEGER NOT NULL DEFAULT 0;
ALTER TABLE economy_policy ADD COLUMN provider_access_revoked INTEGER NOT NULL DEFAULT 0;

-- Per-agent budget accounting. budget_cents is what the owner has authorised
-- this agent to spend in total; spend_cents is what it has actually spent
-- (debits already posted in economy_ledger). A spawn debits the parent.
ALTER TABLE economy_agent_profiles ADD COLUMN budget_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE economy_agent_profiles ADD COLUMN spend_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE economy_agent_profiles ADD COLUMN paused_at TEXT;
ALTER TABLE economy_agent_profiles ADD COLUMN paused_reason TEXT;

CREATE TABLE economy_delegations (
  id TEXT PRIMARY KEY,
  parent_agent_slug TEXT,                     -- NULL = root-level agent (no parent)
  child_agent_slug TEXT,                      -- NULL on a rejected attempt
  gap TEXT,
  decision TEXT NOT NULL,                     -- authorized | rejected
  reason TEXT NOT NULL,
  checks_json TEXT NOT NULL,                  -- every gate and its verdict
  depth INTEGER NOT NULL DEFAULT 0,
  spawn_cost_cents INTEGER NOT NULL DEFAULT 0,
  rate_used_in_window INTEGER NOT NULL DEFAULT 0,
  actor TEXT NOT NULL DEFAULT 'system',       -- system | owner | <agent_slug>
  decided_at TEXT NOT NULL
);

CREATE INDEX idx_econ_delegations_parent ON economy_delegations(parent_agent_slug);
CREATE INDEX idx_econ_delegations_child ON economy_delegations(child_agent_slug);
CREATE INDEX idx_econ_delegations_decided ON economy_delegations(decided_at);
