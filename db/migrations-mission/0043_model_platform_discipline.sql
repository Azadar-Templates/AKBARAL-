-- Multi-provider model control, public read-only platform adapters, and
-- fail-closed quality/reputation discipline. No credentials, programs, targets,
-- account records, or findings are seeded here.

CREATE TABLE IF NOT EXISTS model_providers (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  credential_vault_key TEXT NOT NULL,
  models_available_json TEXT NOT NULL DEFAULT '[]',
  default_model TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100 CHECK (priority >= 0),
  cost_per_1k_in REAL NOT NULL DEFAULT 0 CHECK (cost_per_1k_in >= 0),
  cost_per_1k_out REAL NOT NULL DEFAULT 0 CHECK (cost_per_1k_out >= 0),
  max_concurrency INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrency > 0),
  rate_limit_per_min INTEGER NOT NULL DEFAULT 1 CHECK (rate_limit_per_min > 0),
  health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown','ok','rate_limited','unauthorized','quota_exceeded','timeout','error')),
  last_health_check_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  supports_json_schema INTEGER NOT NULL DEFAULT 0 CHECK (supports_json_schema IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_health_events (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES model_providers(id) ON DELETE CASCADE,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','rate_limited','unauthorized','quota_exceeded','timeout','error')),
  latency_ms INTEGER,
  error_class TEXT,
  recovery_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_model_health_provider_time ON model_health_events(provider_id, occurred_at);

CREATE TABLE IF NOT EXISTS model_call_logs (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES model_providers(id),
  provider_key TEXT NOT NULL,
  model TEXT NOT NULL,
  role_key TEXT,
  program_id TEXT,
  target TEXT,
  status TEXT NOT NULL CHECK (status IN ('succeeded','failed','blocked','fallback')),
  fallback_from_provider_id TEXT,
  fallback_reason TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  schema_requested INTEGER NOT NULL DEFAULT 0 CHECK (schema_requested IN (0,1)),
  schema_validated INTEGER NOT NULL DEFAULT 0 CHECK (schema_validated IN (0,1)),
  error_class TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_model_call_logs_time ON model_call_logs(created_at, provider_key);
CREATE INDEX IF NOT EXISTS idx_model_call_logs_program ON model_call_logs(program_id, target, created_at);

CREATE TABLE IF NOT EXISTS model_spend_caps (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL UNIQUE,
  cap_cents INTEGER NOT NULL CHECK (cap_cents >= 0),
  period TEXT NOT NULL DEFAULT 'calendar_month' CHECK (period IN ('calendar_day','calendar_week','calendar_month','lifetime')),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_adapters (
  id TEXT PRIMARY KEY,
  platform_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('web3_contest','web3_bounty','web_bugbounty','github')),
  public_api_base TEXT,
  public_feed_url TEXT,
  auth_required_for_reads INTEGER NOT NULL DEFAULT 0 CHECK (auth_required_for_reads IN (0,1)),
  rate_limit_per_min INTEGER NOT NULL DEFAULT 1 CHECK (rate_limit_per_min > 0),
  submission_style TEXT NOT NULL,
  adapter_status TEXT NOT NULL CHECK (adapter_status IN ('ready_public_source','unavailable_public_source','auth_required','not_implemented')),
  last_sync_status TEXT,
  last_sync_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_sync_events (
  id TEXT PRIMARY KEY,
  adapter_id TEXT NOT NULL REFERENCES platform_adapters(id),
  program_id TEXT,
  target TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok','unavailable','auth_required','rate_limited','not_implemented','blocked')),
  detail TEXT NOT NULL,
  observed_count INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_platform_sync_adapter_time ON platform_sync_events(adapter_id, created_at);

CREATE TABLE IF NOT EXISTS quality_policies (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL UNIQUE REFERENCES bounty_programs(id) ON DELETE CASCADE,
  min_confidence_threshold REAL NOT NULL CHECK (min_confidence_threshold >= 0 AND min_confidence_threshold <= 1),
  require_poc INTEGER NOT NULL CHECK (require_poc IN (0,1)),
  require_evidence_screenshot INTEGER NOT NULL CHECK (require_evidence_screenshot IN (0,1)),
  max_submissions_per_week INTEGER NOT NULL CHECK (max_submissions_per_week >= 0),
  duplicate_window_days INTEGER NOT NULL CHECK (duplicate_window_days >= 0),
  reject_on_weak_evidence INTEGER NOT NULL CHECK (reject_on_weak_evidence IN (0,1)),
  min_cvss_for_submit REAL NOT NULL CHECK (min_cvss_for_submit >= 0 AND min_cvss_for_submit <= 10),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bounty_platform_allocations (
  id TEXT PRIMARY KEY,
  platform_key TEXT NOT NULL REFERENCES platform_adapters(platform_key) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,
  concurrency INTEGER NOT NULL CHECK (concurrency > 0),
  priority INTEGER NOT NULL CHECK (priority IN (1,2)),
  strategy TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform_key, agent_type)
);

CREATE TABLE IF NOT EXISTS bounty_rejection_lessons (
  id TEXT PRIMARY KEY,
  program_id TEXT REFERENCES bounty_programs(id) ON DELETE SET NULL,
  finding_id TEXT REFERENCES bounty_findings(id) ON DELETE SET NULL,
  platform_key TEXT,
  reason_code TEXT NOT NULL,
  reason_detail TEXT NOT NULL,
  fingerprint TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bounty_lessons_reason ON bounty_rejection_lessons(reason_code, created_at);

CREATE TABLE IF NOT EXISTS bounty_platform_feedback (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES bounty_programs(id) ON DELETE CASCADE,
  finding_id TEXT REFERENCES bounty_findings(id) ON DELETE SET NULL,
  platform_key TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted','rejected_invalid','rejected_duplicate','rejected_spam','rejected_other')),
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bounty_feedback_program ON bounty_platform_feedback(program_id, created_at);

CREATE TABLE IF NOT EXISTS bounty_program_risk (
  program_id TEXT PRIMARY KEY REFERENCES bounty_programs(id) ON DELETE CASCADE,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('healthy','caution','restricted')) DEFAULT 'healthy',
  warning_count INTEGER NOT NULL DEFAULT 0,
  submission_rate_multiplier REAL NOT NULL DEFAULT 1 CHECK (submission_rate_multiplier >= 0 AND submission_rate_multiplier <= 1),
  last_reviewed_at TEXT,
  updated_at TEXT NOT NULL
);

-- Additive fields to the existing scope-first control plane.
ALTER TABLE bounty_findings ADD COLUMN confidence_score REAL;
ALTER TABLE bounty_findings ADD COLUMN confidence_breakdown_json TEXT;
ALTER TABLE agent_run_logs ADD COLUMN platform_key TEXT;
CREATE INDEX IF NOT EXISTS idx_agent_run_logs_platform ON agent_run_logs(platform_key, created_at);

-- Capability/provider metadata only. The credential names are vault lookup keys,
-- never credential values.
INSERT INTO model_providers (id,provider_key,display_name,base_url,credential_vault_key,models_available_json,default_model,priority,cost_per_1k_in,cost_per_1k_out,max_concurrency,rate_limit_per_min,health_status,enabled,supports_json_schema,created_at,updated_at) VALUES
 ('mp-google','google','Google AI','https://generativelanguage.googleapis.com/v1beta','model.google.api_key','["gemini-3.5-flash","gemini-3.5-flash-lite"]','gemini-3.5-flash',10,0,0,2,10,'unknown',0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('mp-openai','openai','OpenAI','https://api.openai.com/v1','model.openai.api_key','["gpt-4o-mini","gpt-4o"]','gpt-4o-mini',20,0,0,2,10,'unknown',0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('mp-anthropic','anthropic','Anthropic','https://api.anthropic.com/v1','model.anthropic.api_key','["claude-sonnet"]','claude-sonnet',30,0,0,2,10,'unknown',0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('mp-openrouter','openrouter','OpenRouter','https://openrouter.ai/api/v1','model.openrouter.api_key','["auto"]','auto',40,0,0,2,10,'unknown',0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('mp-groq','groq','Groq','https://api.groq.com/openai/v1','model.groq.api_key','["llama"]','llama',50,0,0,2,10,'unknown',0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('mp-together','together','Together AI','https://api.together.xyz/v1','model.together.api_key','["llama"]','llama',60,0,0,2,10,'unknown',0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('mp-deepseek','deepseek','DeepSeek','https://api.deepseek.com/v1','model.deepseek.api_key','["deepseek-chat"]','deepseek-chat',70,0,0,2,10,'unknown',0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('mp-ollama','ollama','Ollama','http://127.0.0.1:11434/v1','model.ollama.api_key','["local"]','local',80,0,0,1,30,'unknown',0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
 ON CONFLICT(provider_key) DO NOTHING;

INSERT INTO platform_adapters (id,platform_key,display_name,category,public_api_base,public_feed_url,auth_required_for_reads,rate_limit_per_min,submission_style,adapter_status,notes,created_at,updated_at) VALUES
 ('pa-immunefi','immunefi','Immunefi','web3_bounty',NULL,NULL,1,2,'immunefi','unavailable_public_source','No verified unauthenticated public feed configured; no scraper is used.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pa-code4rena','code4rena','Code4rena','web3_contest',NULL,NULL,0,2,'code4rena_markdown','unavailable_public_source','No public source configured in this build.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pa-sherlock','sherlock','Sherlock','web3_contest',NULL,NULL,1,2,'sherlock_markdown','unavailable_public_source','No verified unauthenticated public feed configured.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pa-cantina','cantina','Cantina','web3_contest',NULL,NULL,1,2,'cantina_markdown','unavailable_public_source','No verified unauthenticated public feed configured.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pa-openzeppelin','openzeppelin','OpenZeppelin','web3_bounty',NULL,NULL,0,2,'web3_markdown','unavailable_public_source','No public source configured in this build.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pa-paladin','paladin','Paladin','web3_bounty',NULL,NULL,1,2,'web3_markdown','unavailable_public_source','No verified unauthenticated public feed configured.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pa-hatsfinance','hatsfinance','Hats Finance','web3_bounty',NULL,NULL,0,2,'web3_markdown','unavailable_public_source','No public source configured in this build.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pa-sparbit','sparbit','Spearbit','web3_contest',NULL,NULL,1,2,'spearbit_markdown','unavailable_public_source','Registered under the requested sparbit key; no public source configured.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pa-layer3','layer3','Layer3','web3_bounty',NULL,NULL,0,2,'web3_markdown','unavailable_public_source','No public source configured in this build.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pa-dorahacks','dorahacks','DoraHacks','web3_contest',NULL,NULL,0,2,'web3_markdown','unavailable_public_source','No public source configured in this build.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pa-hackerone','hackerone','HackerOne','web_bugbounty',NULL,NULL,1,2,'hackerone','unavailable_public_source','Authenticated reads are not attempted.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pa-bugcrowd','bugcrowd','Bugcrowd','web_bugbounty',NULL,NULL,1,2,'bugcrowd','unavailable_public_source','Authenticated reads are not attempted.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pa-yeswehack','yeswehack','YesWeHack','web_bugbounty',NULL,NULL,0,2,'yeswehack','unavailable_public_source','No public source configured in this build.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pa-intigriti','intigriti','Intigriti','web_bugbounty',NULL,NULL,1,2,'intigriti','unavailable_public_source','Authenticated reads are not attempted.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pa-patchstack','patchstack','Patchstack','web_bugbounty',NULL,NULL,0,2,'patchstack','unavailable_public_source','No public source configured in this build.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pa-wordfence','wordfence','Wordfence','web_bugbounty',NULL,NULL,0,2,'wordfence','unavailable_public_source','No public source configured in this build.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pa-github','github','GitHub','github','https://api.github.com',NULL,0,10,'github_pr','unavailable_public_source','Existing GitHub workflow is not used by this read-only adapter until a separate scope-approved integration is enabled.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
 ON CONFLICT(platform_key) DO NOTHING;
