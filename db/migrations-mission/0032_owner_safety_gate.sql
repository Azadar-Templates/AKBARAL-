-- ZA141251SA OWNER-SAFETY / LIABILITY GATE — immutable authorization trail + violations
-- Append-only, hash-chained, fail-closed. No data reset.

CREATE TABLE IF NOT EXISTS mission_authorization_trail (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  prev_hash TEXT,
  hash TEXT NOT NULL,
  task_id TEXT, -- mission_earning_executions.id or mission_work.id or external task ref
  agent_id TEXT REFERENCES mission_agents(id),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('owner','agent','system','provider')),
  actor_id TEXT,
  connector_id TEXT, -- platform-connectors id, may be null for generic tasks
  action TEXT NOT NULL, -- e.g. execution.start, verification.claim, settlement.request, kyc.submit, purchase.request
  payload_hash TEXT, -- sha256(JSON.stringify(redacted payload))
  decision TEXT NOT NULL CHECK(decision IN ('allowed','denied','owner_action_required')),
  violation_code TEXT, -- null when allowed
  reasons_json TEXT NOT NULL DEFAULT '[]',
  provider_response_hash TEXT,
  verification_ref TEXT,
  settlement_ref TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_trail_seq ON mission_authorization_trail(seq);
CREATE INDEX IF NOT EXISTS idx_auth_trail_agent ON mission_authorization_trail(agent_id);
CREATE INDEX IF NOT EXISTS idx_auth_trail_task ON mission_authorization_trail(task_id);
CREATE INDEX IF NOT EXISTS idx_auth_trail_connector ON mission_authorization_trail(connector_id);
CREATE INDEX IF NOT EXISTS idx_auth_trail_decision ON mission_authorization_trail(decision);

CREATE TABLE IF NOT EXISTS mission_safety_violations (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  prev_hash TEXT,
  hash TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES mission_agents(id),
  violation_code TEXT NOT NULL CHECK(violation_code IN ('fake_identity','kyc_fabrication','kyc_aml_bypass','sanctions','impersonation','fraudulent_job','unauthorized_purchase','legal_obligation','prohibited_activity','spam','hidden_failure','false_verification','unauthorized_transfer','account_access','credential_leak','policy_violation_continuation','unauthorized_activity','unknown_scope')),
  detail TEXT,
  trail_id TEXT REFERENCES mission_authorization_trail(id),
  blocked_action TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_safety_violations_agent ON mission_safety_violations(agent_id);
CREATE INDEX IF NOT EXISTS idx_safety_violations_code ON mission_safety_violations(violation_code);

-- KYC document guard: agents may never write to this table directly; only owner via gate
CREATE TABLE IF NOT EXISTS mission_kyc_submissions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES mission_owner(id),
  connector_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  document_hash TEXT NOT NULL, -- hash of redacted doc reference, not the doc itself
  status TEXT NOT NULL CHECK(status IN ('pending_owner_review','verified','rejected')) DEFAULT 'pending_owner_review',
  trail_id TEXT REFERENCES mission_authorization_trail(id),
  created_at TEXT NOT NULL
);
