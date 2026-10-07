-- Owner-configured bug-bounty system foundation.
-- No programs, targets, credentials, opportunities, or findings are seeded.
-- The registry rows are capability definitions only; they do not create agents
-- or authorize any external request.

CREATE TABLE IF NOT EXISTS bounty_programs (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  program_handle TEXT NOT NULL,
  scope_url TEXT NOT NULL,
  in_scope_assets_json TEXT NOT NULL DEFAULT '[]',
  out_of_scope_json TEXT NOT NULL DEFAULT '[]',
  rate_limit_policy_json TEXT NOT NULL DEFAULT '{}',
  auth_required INTEGER NOT NULL DEFAULT 1 CHECK (auth_required IN (0,1)),
  bounty_range_json TEXT NOT NULL DEFAULT '{}',
  program_terms_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform, program_handle)
);
CREATE INDEX IF NOT EXISTS idx_bounty_programs_active ON bounty_programs(active, updated_at);

CREATE TABLE IF NOT EXISTS scope_allowlist (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES bounty_programs(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('domain','repo','package','API')),
  in_scope INTEGER NOT NULL CHECK (in_scope IN (0,1)),
  auth_required INTEGER NOT NULL DEFAULT 0 CHECK (auth_required IN (0,1)),
  rate_limit_per_min INTEGER,
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(program_id, target)
);
CREATE INDEX IF NOT EXISTS idx_scope_allowlist_lookup ON scope_allowlist(program_id, target, in_scope);

CREATE TABLE IF NOT EXISTS scope_gate_events (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  target TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allowed','blocked')),
  reason TEXT NOT NULL,
  agent_type TEXT,
  run_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scope_gate_events_target ON scope_gate_events(program_id, target, created_at);

CREATE TABLE IF NOT EXISTS agent_registry (
  type TEXT PRIMARY KEY,
  capability_description TEXT NOT NULL,
  input_schema_json TEXT NOT NULL,
  output_schema_json TEXT NOT NULL,
  required_tools_json TEXT NOT NULL DEFAULT '[]',
  max_concurrency INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrency > 0),
  rate_limit_per_min INTEGER NOT NULL DEFAULT 30 CHECK (rate_limit_per_min > 0),
  cooldown_ms INTEGER NOT NULL DEFAULT 0 CHECK (cooldown_ms >= 0),
  timeout_ms INTEGER NOT NULL DEFAULT 300000 CHECK (timeout_ms > 0),
  cost_budget_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_budget_cents >= 0),
  quality_gate_required INTEGER NOT NULL DEFAULT 1 CHECK (quality_gate_required IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_run_logs (
  id TEXT PRIMARY KEY,
  agent_type TEXT NOT NULL REFERENCES agent_registry(type),
  program_id TEXT NOT NULL REFERENCES bounty_programs(id),
  target TEXT NOT NULL,
  start_at TEXT,
  end_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','gated','rejected','done','failed','blocked','cancelled')),
  tool_calls_json TEXT NOT NULL DEFAULT '[]',
  tokens_used INTEGER,
  cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  output_ref TEXT,
  output_json TEXT,
  error TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_run_logs_queue ON agent_run_logs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_run_logs_target ON agent_run_logs(program_id, target, created_at);

CREATE TABLE IF NOT EXISTS bounty_findings (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES bounty_programs(id),
  target TEXT NOT NULL,
  vulnerability_class TEXT NOT NULL,
  code_location_pattern TEXT NOT NULL,
  finding_fingerprint TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence TEXT NOT NULL,
  reproduction TEXT,
  impact TEXT,
  severity TEXT,
  cvss_vector TEXT,
  cvss_score REAL,
  cvss_justification TEXT,
  state TEXT NOT NULL CHECK (state IN ('candidate','gated','rejected','approved','submitted','duplicate')) DEFAULT 'candidate',
  report_json TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bounty_findings_pipeline ON bounty_findings(program_id, target, state, updated_at);

CREATE TABLE IF NOT EXISTS quality_gate_reviews (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES bounty_findings(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('pass','reject')),
  reasons_json TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quality_gate_finding ON quality_gate_reviews(finding_id, created_at);

CREATE TABLE IF NOT EXISTS knowledge_base_entries (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES bounty_programs(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('scope_history','architecture','finding','lesson','reference')),
  finding_fingerprint TEXT,
  content_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bounty_kb_lookup ON knowledge_base_entries(program_id, target, entry_type, finding_fingerprint);

CREATE TABLE IF NOT EXISTS bounty_run_stage_states (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES bounty_findings(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','running','gated','rejected','done','blocked')),
  agent_type TEXT NOT NULL REFERENCES agent_registry(type),
  run_id TEXT REFERENCES agent_run_logs(id),
  detail TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(finding_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_bounty_stage_finding ON bounty_run_stage_states(finding_id, updated_at);

CREATE TABLE IF NOT EXISTS bounty_submissions (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES bounty_findings(id),
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  report_content_hash TEXT NOT NULL,
  platform_response TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('pending','submitted','blocked','failed')) DEFAULT 'pending',
  submitted_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bounty_submissions_one_approval ON bounty_submissions(finding_id);
CREATE INDEX IF NOT EXISTS idx_bounty_submissions_finding ON bounty_submissions(finding_id, created_at);

-- Capability definitions for the fourteen bounded agents. These rows are not
-- fabricated workforce members and do not grant external permissions.
INSERT INTO agent_registry (type, capability_description, input_schema_json, output_schema_json, required_tools_json, max_concurrency, cost_budget_cents, quality_gate_required, active, created_at, updated_at) VALUES
 ('code_analyst','Maps authorized source, entry points, trust boundaries, and security-relevant sinks using local source input.','{"source":"string","files":"array"}','{"codeMap":"array","entryPoints":"array","trustBoundaries":"array"}','["repo_read","pattern_match"]',2,0,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('security_auditor','Finds candidate vulnerability classes in supplied authorized source with evidence locations.','{"source":"string","target":"string"}','{"findings":"array"}','["pattern_match","static_analysis"]',2,0,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('exploit_validator','Checks a supplied safe local reproduction result without exfiltration or destructive execution.','{"observed":"string","expected":"string","harness":"object"}','{"reproducible":"boolean","steps":"array","evidence":"string"}','["local_harness"]',1,0,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('test_engineer','Produces bounded regression or fuzz test plans against supplied target code.','{"source":"string","finding":"object"}','{"testFiles":"array","commands":"array","expected":"string"}','["test_generator","local_harness"]',2,0,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('research_agent','Maps owner-supplied references and advisories to the authorized target; no invented prior art.','{"references":"array","technology":"string"}','{"references":"array","gaps":"array"}','["reference_reader"]',2,0,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('bug_bounty_rules','Checks a finding against the configured program scope, terms, severity and report requirements.','{"program":"object","finding":"object"}','{"compliant":"boolean","checks":"array","gaps":"array"}','["scope_reader","rules_reader"]',2,0,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('patch_developer','Prepares a private patch draft and regression test from supplied authorized source.','{"source":"string","finding":"object","patch":"object"}','{"diff":"string","tests":"array","draftOnly":"boolean"}','["repo_read","patch_writer","test_generator"]',1,0,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('code_reviewer','Independently reviews a supplied patch draft for correctness, regressions and coverage.','{"source":"string","diff":"string","tests":"array"}','{"approved":"boolean","findings":"array","coverage":"array"}','["diff_reader","test_reader"]',1,0,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('report_writer','Writes a factual structured report from an evidence-complete finding.','{"finding":"object","rules":"object"}','{"report":"object","contentHash":"string"}','["report_template"]',2,0,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('browser_monitor','Processes owner-supplied authorized platform observations for scope or listing changes.','{"observations":"array"}','{"feed":"array","requiresOwnerReview":"boolean"}','["platform_observation_reader"]',1,0,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('git_agent','Prepares a branch/commit/PR plan without pushing, forking, or opening anything.','{"repo":"string","patch":"object"}','{"plan":"object","push":"boolean"}','["git_plan"]',1,0,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('orchestrator','Coordinates bounded stage transitions and rejects any transition missing its quality gate.','{"finding":"object","stages":"array"}','{"pipeline":"array","blocked":"boolean"}','["pipeline_state_reader"]',1,0,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('memory_knowledge_base','Stores or retrieves owner-approved private architecture, findings, scope history and lessons.','{"operation":"string","entry":"object"}','{"entries":"array","written":"boolean"}','["knowledge_base"]',1,0,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('quality_gate','Rejects weak, duplicate, out-of-scope, unsupported or unjustified findings before submission.','{"finding":"object","program":"object"}','{"decision":"string","reasons":"array","checks":"object"}','["scope_reader","dedup_reader","cvss_calculator"]',1,0,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
 ON CONFLICT(type) DO NOTHING;
