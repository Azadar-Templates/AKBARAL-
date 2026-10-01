-- Mission only. Passive GitHub PR review/check monitoring for already-submitted
-- bounty candidates. These fields record GitHub-observed status; they neither
-- approve a PR nor create a payment, balance, or settlement.
ALTER TABLE mission_bounty_candidates ADD COLUMN review_state TEXT NOT NULL DEFAULT 'not_observed';
ALTER TABLE mission_bounty_candidates ADD COLUMN checks_state TEXT NOT NULL DEFAULT 'not_observed';
ALTER TABLE mission_bounty_candidates ADD COLUMN review_summary_json TEXT;
ALTER TABLE mission_bounty_candidates ADD COLUMN last_reviewed_at TEXT;
CREATE INDEX mission_bounty_candidates_review_queue ON mission_bounty_candidates(state, last_reviewed_at);

-- Independent self-pacing for passive read-only PR monitoring. It is separate
-- from discovery so the scheduler never needs an owner request to notice a
-- review, merge, close, or observed check result.
CREATE TABLE mission_bounty_review_scheduler_state (
  id TEXT PRIMARY KEY,
  last_attempted_at TEXT,
  last_result TEXT
);
INSERT INTO mission_bounty_review_scheduler_state (id, last_attempted_at, last_result)
VALUES ('global', NULL, NULL);
