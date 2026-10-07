-- Scale-safe bounty executor state. This migration does not create accounts,
-- credits, settlement records, or upstream GitHub mutations.
ALTER TABLE mission_bounty_opportunities ADD COLUMN issue_body TEXT NOT NULL DEFAULT '';

-- One durable leased run per assignment. Historical runs may complete/release;
-- the partial indexes enforce one active issue per agent and one active agent per
-- issue while allowing an agent to receive a later issue after release/completion.
CREATE TABLE mission_bounty_runs (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL UNIQUE REFERENCES mission_bounty_assignments(id),
  opportunity_id TEXT NOT NULL UNIQUE REFERENCES mission_bounty_opportunities(id),
  agent_id TEXT NOT NULL REFERENCES mission_agents(id),
  state TEXT NOT NULL CHECK(state IN ('assigned','running','blocked','completed','released')),
  lease_expires_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  released_at TEXT,
  reason TEXT,
  execution_job_id TEXT REFERENCES mission_bounty_execution_jobs(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX mission_bounty_active_run_agent
  ON mission_bounty_runs(agent_id) WHERE state IN ('assigned','running');
CREATE UNIQUE INDEX mission_bounty_active_run_opportunity
  ON mission_bounty_runs(opportunity_id) WHERE state IN ('assigned','running');
CREATE INDEX mission_bounty_runs_state ON mission_bounty_runs(state,updated_at);
CREATE INDEX mission_bounty_runs_lease ON mission_bounty_runs(state,lease_expires_at);
