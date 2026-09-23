-- ZA141251SA mission — human action tasks (0033)
-- When an agent encounters a human-only action (KYC, captcha, ToS acceptance,
-- account creation, payment setup, etc.), it creates a task here.
-- The agent is blocked until the owner resolves the task.
-- No agent can pretend to have completed a human-only action.

CREATE TABLE IF NOT EXISTS mission_human_action_tasks (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES mission_agents(id) ON DELETE CASCADE,
  opportunity_id  TEXT,
  action_type     TEXT NOT NULL, -- kyc_verification, captcha, account_creation, etc.
  reason          TEXT NOT NULL,
  platform_url    TEXT,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending|completed|expired|cancelled
  notes           TEXT,
  created_at      TEXT NOT NULL,
  completed_at    TEXT,
  completed_by    TEXT,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_human_action_agent ON mission_human_action_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_human_action_status ON mission_human_action_tasks(status);
CREATE INDEX IF NOT EXISTS idx_human_action_pending ON mission_human_action_tasks(agent_id, status) WHERE status = 'pending';
