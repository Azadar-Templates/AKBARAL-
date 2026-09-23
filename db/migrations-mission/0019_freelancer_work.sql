-- Mission-only provider evidence/workflow. No provider identities, jobs or money seeded.
CREATE TABLE mission_freelancer_accounts (
 user_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL UNIQUE REFERENCES mission_agents(id),
 state TEXT NOT NULL CHECK(state IN ('authorized','revoked')),
 compliance_ref TEXT NOT NULL, compliance_checks TEXT NOT NULL,
 expires_at TEXT NOT NULL, approved_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE mission_freelancer_projects (
 project_id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, observed_at TEXT NOT NULL
);
CREATE TABLE mission_freelancer_work (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES mission_freelancer_accounts(user_id),
 project_id TEXT NOT NULL UNIQUE, bid_id TEXT NOT NULL UNIQUE, milestone_id TEXT NOT NULL UNIQUE,
 contract_json TEXT NOT NULL, scope_ref TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('authorized','draft','approved','dispatching','delivery_review_required','delivered','provider_cleared','provider_review_required')),
 content TEXT, content_hash TEXT, approved_hash TEXT, approved_by TEXT,
 delivery_json TEXT, milestone_json TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE mission_freelancer_events (
 id TEXT PRIMARY KEY, work_id TEXT NOT NULL, state TEXT NOT NULL,
 evidence_hash TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE mission_freelancer_api_requests (id TEXT PRIMARY KEY, started_at TEXT NOT NULL);
CREATE INDEX mission_freelancer_api_time ON mission_freelancer_api_requests(started_at);
CREATE TABLE mission_freelancer_api_cooldown (id TEXT PRIMARY KEY, until_at TEXT NOT NULL);
