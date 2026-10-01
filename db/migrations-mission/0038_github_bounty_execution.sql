-- Durable evidence/state for the isolated GitHub bounty solution worker.
-- Archive bytes and generated patches are never stored here; archives live only
-- in ephemeral runner scratch space, while JSON fields are bounded by workflow
-- validation. This migration does not create a payment, payout, or receipt.
CREATE TABLE mission_bounty_execution_jobs (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL UNIQUE REFERENCES mission_bounty_assignments(id),
  input_hash TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('queued','inspecting','generating','verifying','verified','drafted','blocked','failed')),
  issue_snapshot_json TEXT,
  repository_ref TEXT,
  archive_sha256 TEXT,
  inspection_json TEXT,
  proposal_json TEXT,
  verification_json TEXT,
  candidate_id TEXT REFERENCES mission_bounty_candidates(id),
  blocked_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX mission_bounty_execution_state ON mission_bounty_execution_jobs(state,updated_at);
ALTER TABLE mission_bounty_candidates ADD COLUMN execution_job_id TEXT REFERENCES mission_bounty_execution_jobs(id);
CREATE UNIQUE INDEX mission_bounty_candidate_execution_job ON mission_bounty_candidates(execution_job_id) WHERE execution_job_id IS NOT NULL;
