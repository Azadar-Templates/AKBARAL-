-- Autonomous multi-agent verification: routine quality review without owner for normal jobs.
-- Preserves all verified-money safeguards: no alternate cash path, spending caps, payout gates remain.

-- Verifications for each produced artifact: independent agents check quality/security/compliance.
CREATE TABLE IF NOT EXISTS mission_customer_verifications (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES mission_customer_requests(id) ON DELETE CASCADE,
  verifier_agent_id TEXT NOT NULL REFERENCES mission_agents(id),
  status TEXT NOT NULL CHECK(status IN ('approved','rejected','escalated')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  checks_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(request_id, verifier_agent_id)
);

-- Track which agent produced the artifact and whether the request is eligible for autonomous approval.
-- Existing requests remain eligible where non-sensitive; new column defaults preserve historical behavior.
ALTER TABLE mission_customer_requests ADD COLUMN producer_agent_id TEXT REFERENCES mission_agents(id);
ALTER TABLE mission_customer_requests ADD COLUMN autonomous_eligible INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mission_customer_requests ADD COLUMN requires_owner_review INTEGER NOT NULL DEFAULT 0;

-- Policy extension: autonomous verification threshold and delivery automation flags are
-- stored as JSON in mission_policy.provider_activation if needed; defaults are hardcoded
-- to 2 verifiers and no automated delivery, so no policy column is required.
