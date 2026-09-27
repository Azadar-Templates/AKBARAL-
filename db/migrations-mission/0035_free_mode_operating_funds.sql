-- ZA141251SA mission — FREE MODE and the verified-revenue operating budget (0035)
--
-- Hard operating rule enforced by this schema and src/mission/operating-funds.ts:
--
--   FREE MODE  →  REAL WORK  →  VERIFIED REVENUE  →  OWNER-APPROVED OPERATING
--   BUDGET  →  APPROVED RESOURCE PURCHASE  →  MORE CAPABILITY
--
-- and never the reverse (owner money → buy everything → hope agents earn).
--
--  1. mission_operating_budget — an owner-approved spending allowance that can
--     only ever be created from money that was RECEIVED and VERIFIED
--     (mission_revenue.status='received' AND verifier IS NOT NULL). It is
--     capped, revocable and audited. No row here = no mission expenditure is
--     possible at all.
--  2. mission_blocked_resources — the honest record of every moment an agent
--     needed a resource it could not have for free. Nothing is silently
--     purchased and nothing is silently dropped: the requirement is recorded
--     with its cost, the opportunity it would have served, and the free
--     alternative that was used instead (if any), so the owner can see exactly
--     what verified revenue would unlock.

CREATE TABLE IF NOT EXISTS mission_operating_budget (
  id                 TEXT PRIMARY KEY,
  amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),
  spent_cents        INTEGER NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'USD',
  -- The verified revenue total that justified this budget, captured at
  -- approval time so an audit can replay the decision.
  backed_by_verified_revenue_cents INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',   -- active|exhausted|revoked
  purpose            TEXT NOT NULL,
  approved_by        TEXT NOT NULL,
  approved_at        TEXT NOT NULL,
  revoked_at         TEXT,
  revoked_reason     TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_mission_operating_budget_status ON mission_operating_budget(status);

CREATE TABLE IF NOT EXISTS mission_blocked_resources (
  id                 TEXT PRIMARY KEY,
  agent_id           TEXT REFERENCES mission_agents(id) ON DELETE SET NULL,
  opportunity_id     TEXT,
  resource_key       TEXT NOT NULL,                    -- stable key, e.g. openai:image_render
  provider           TEXT NOT NULL,
  kind               TEXT NOT NULL,                    -- api|storage|compute|database|tool|domain|other
  purpose            TEXT NOT NULL,
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
  -- blocked_no_verified_funds : FREE MODE, nothing was spent
  -- blocked_free_tier_exhausted: a free allowance ran out, nothing was spent
  -- free_alternative_used     : the agent continued for free (no block at all)
  -- owner_approval_requested  : verified funds exist; the owner must still approve
  -- unblocked                 : an approved purchase satisfied it
  status             TEXT NOT NULL DEFAULT 'blocked_no_verified_funds',
  free_alternative   TEXT,
  detail             TEXT,
  resource_id        TEXT REFERENCES mission_resources(id) ON DELETE SET NULL,
  occurrences        INTEGER NOT NULL DEFAULT 1,
  first_seen_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_blocked_resources_key
  ON mission_blocked_resources(resource_key, COALESCE(agent_id, ''), COALESCE(opportunity_id, ''));
CREATE INDEX IF NOT EXISTS idx_mission_blocked_resources_status ON mission_blocked_resources(status);
