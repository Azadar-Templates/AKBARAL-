-- Mission only. No opening cash, credentials, synthetic opportunities, or imported balances.
-- Self-paced gate so the continuous scheduler tick can safely call the GitHub
-- bounty discovery/policy/assign sweep every tick without ever depending on a
-- human/owner request and without exceeding GitHub's rate limits.
CREATE TABLE mission_bounty_scheduler_state (
  id TEXT PRIMARY KEY,
  last_attempted_at TEXT,
  last_result TEXT
);
INSERT INTO mission_bounty_scheduler_state (id, last_attempted_at, last_result) VALUES ('global', NULL, NULL);
