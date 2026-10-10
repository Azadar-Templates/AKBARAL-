-- 0047: prepared (not granted) scoped contracts, per agent class.
--
-- WHY A SEPARATE TABLE. `mission_agent_contracts` is the live authority: `grant()` in
-- src/mission/money.ts reads the newest row for an agent and denies `agent_contract_inactive`
-- for anything that is not an active, unexpired contract. Writing a "pending" row there would
-- therefore DISABLE the agent's money grant the moment it was proposed — a prepared contract
-- must never be able to break the thing it is preparing. Proposals live here until an owner
-- approves one, and only approval inserts the active row.
CREATE TABLE IF NOT EXISTS mission_agent_contract_proposals (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL REFERENCES mission_agents(id) ON DELETE CASCADE,
  agent_class         TEXT NOT NULL,
  purpose             TEXT NOT NULL,
  -- Frozen at proposal time, so what the owner approves is exactly what activation grants.
  permissions_json    TEXT NOT NULL DEFAULT '[]',
  resource_limits_json TEXT NOT NULL DEFAULT '{}',
  budget_cents        INTEGER NOT NULL DEFAULT 0 CHECK (budget_cents >= 0),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','withdrawn','expired')),
  eligibility_json    TEXT NOT NULL DEFAULT '{}',
  requested_by        TEXT NOT NULL,
  requested_at        TEXT NOT NULL,
  reviewed_by         TEXT,
  reviewed_at         TEXT,
  review_note         TEXT,
  -- A proposal that is never reviewed must stop being actionable rather than lingering.
  expires_at          TEXT NOT NULL,
  contract_id         TEXT REFERENCES mission_agent_contracts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_mission_contract_proposals_agent ON mission_agent_contract_proposals(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_mission_contract_proposals_class ON mission_agent_contract_proposals(agent_class, status, requested_at);
