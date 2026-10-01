-- Mission only. No opening cash, credentials, synthetic opportunities, or imported balances.
-- GitHub-issue bounty discovery/execution. Discovery uses GitHub's own public,
-- documented, automation-permitted REST API only — never a bounty marketplace's
-- own website (some, e.g. Algora, prohibit bot access to THEIR service).
CREATE TABLE mission_bounty_opportunities (
  id TEXT PRIMARY KEY, repo_full_name TEXT NOT NULL, issue_number INTEGER NOT NULL,
  issue_url TEXT NOT NULL, title TEXT NOT NULL, labels_json TEXT NOT NULL,
  hinted_amount_cents INTEGER, state TEXT NOT NULL DEFAULT 'discovered', observed_at TEXT NOT NULL,
  UNIQUE(repo_full_name,issue_number)
);
-- Conservative, explicit-deny-list classification of a repo's own published
-- AI-contribution policy. Re-checked before every assignment (stale > 7 days
-- is rejected by the workflow layer, not here).
CREATE TABLE mission_bounty_policy (
  repo_full_name TEXT PRIMARY KEY, ai_contributions_allowed INTEGER NOT NULL,
  disclosure_required INTEGER NOT NULL DEFAULT 1, policy_source TEXT, policy_excerpt TEXT NOT NULL,
  checked_at TEXT NOT NULL
);
-- Deliberately permanent exclusive bindings, matching the Awin assignment model:
-- reassignment requires a separately reviewed migration, revocation must not
-- steal historical work.
CREATE TABLE mission_bounty_assignments (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL UNIQUE REFERENCES mission_agents(id),
  opportunity_id TEXT NOT NULL UNIQUE REFERENCES mission_bounty_opportunities(id),
  money_opportunity_id TEXT NOT NULL REFERENCES mission_money_opportunities(id),
  state TEXT NOT NULL CHECK(state IN ('eligible','revoked')), approved_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE mission_bounty_candidates (
  id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES mission_bounty_assignments(id),
  idempotency_key TEXT NOT NULL UNIQUE, input_hash TEXT NOT NULL,
  repo_full_name TEXT NOT NULL, base_branch TEXT NOT NULL, branch_name TEXT NOT NULL,
  file_path TEXT NOT NULL, file_content TEXT NOT NULL, commit_message TEXT NOT NULL,
  pr_title TEXT NOT NULL, pr_body TEXT NOT NULL, content_hash TEXT NOT NULL,
  approved_hash TEXT, approved_by TEXT,
  state TEXT NOT NULL, external_pr_number INTEGER, external_pr_url TEXT, external_head_sha TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE mission_bounty_events (
  id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, subject_id TEXT NOT NULL, state TEXT NOT NULL,
  evidence_ref TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX mission_bounty_candidate_state ON mission_bounty_candidates(state,updated_at);
-- Conservative global GitHub bounty-workflow request budget across every mission worker/token.
CREATE TABLE mission_bounty_api_requests (id TEXT PRIMARY KEY, started_at TEXT NOT NULL);
CREATE INDEX mission_bounty_api_requests_time ON mission_bounty_api_requests(started_at);
CREATE TABLE mission_bounty_api_cooldown (id TEXT PRIMARY KEY, until_at TEXT NOT NULL);
