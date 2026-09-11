-- AKBARAL! / MASTER AI — Phase 1 Database Foundation
--
-- This migration creates the schema required by the platform vision:
--   User Goal -> AI Core/Orchestrator -> Plan -> Specialist Agents ->
--   Tools/APIs -> Execution -> Verification -> Final Result.
--
-- The schema covers users, sessions, API keys, credits/free-task economy,
-- projects/workspaces, agent taxonomy, tasks, task events/logs, agent
-- executions, tool/API integrations, usage tracking and audit/security logs.
--
-- Security rule: no API keys or secrets are stored in plaintext. Credentials
-- are stored as hashes or as encrypted payloads referenced by a key path.
--
-- Tables are ordered so no table references a not-yet-created table.

-- ---------------------------------------------------------------------------
-- Identity & authentication
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  password_hash TEXT,
  email_verified_at TEXT,
  last_login_at TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

CREATE OR REPLACE FUNCTION trg_users_updated_at_fn() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION trg_users_updated_at_fn();

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_revoked_at ON sessions(revoked_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL UNIQUE,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at ON api_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_revoked_at ON api_keys(revoked_at);

CREATE OR REPLACE FUNCTION trg_api_keys_updated_at_fn() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_api_keys_updated_at ON api_keys;
CREATE TRIGGER trg_api_keys_updated_at BEFORE UPDATE ON api_keys
FOR EACH ROW EXECUTE FUNCTION trg_api_keys_updated_at_fn();

-- ---------------------------------------------------------------------------
-- Projects / workspaces
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  settings TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

CREATE OR REPLACE FUNCTION trg_projects_updated_at_fn() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION trg_projects_updated_at_fn();

-- ---------------------------------------------------------------------------
-- Agent taxonomy (supports the planned 30 major categories / 3000+ agents)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_agent_categories_slug ON agent_categories(slug);
CREATE OR REPLACE FUNCTION trg_agent_categories_updated_at_fn() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_categories_updated_at ON agent_categories;
CREATE TRIGGER trg_agent_categories_updated_at BEFORE UPDATE ON agent_categories
FOR EACH ROW EXECUTE FUNCTION trg_agent_categories_updated_at_fn();

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  category_id TEXT REFERENCES agent_categories(id) ON DELETE SET NULL,
  runtime TEXT NOT NULL DEFAULT 'node',
  status TEXT NOT NULL DEFAULT 'active',
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_agents_category_id ON agents(category_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_project_id ON agents(project_id);
CREATE INDEX IF NOT EXISTS idx_agents_owner_id ON agents(owner_id);
CREATE INDEX IF NOT EXISTS idx_agents_slug ON agents(slug);

CREATE OR REPLACE FUNCTION trg_agents_updated_at_fn() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agents_updated_at ON agents;
CREATE TRIGGER trg_agents_updated_at BEFORE UPDATE ON agents
FOR EACH ROW EXECUTE FUNCTION trg_agents_updated_at_fn();

-- ---------------------------------------------------------------------------
-- Tasks & execution state
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  priority INTEGER NOT NULL DEFAULT 0,
  type TEXT,
  input_data TEXT,
  output_data TEXT,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON tasks(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_agent_id ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

CREATE OR REPLACE FUNCTION trg_tasks_updated_at_fn() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON tasks;
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION trg_tasks_updated_at_fn();

-- ---------------------------------------------------------------------------
-- Credits / free-task economy
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS credit_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  free_credits INTEGER NOT NULL DEFAULT 3,
  free_credits_used INTEGER NOT NULL DEFAULT 0,
  paid_credits INTEGER NOT NULL DEFAULT 0,
  bonus_credits INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  last_credit_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_credit_accounts_status ON credit_accounts(status);

CREATE OR REPLACE FUNCTION trg_credit_accounts_updated_at_fn() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credit_accounts_updated_at ON credit_accounts;
CREATE TRIGGER trg_credit_accounts_updated_at BEFORE UPDATE ON credit_accounts
FOR EACH ROW EXECUTE FUNCTION trg_credit_accounts_updated_at_fn();

CREATE TABLE IF NOT EXISTS credit_transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created ON credit_transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_task_id ON credit_transactions(task_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON credit_transactions(type);

-- ---------------------------------------------------------------------------
-- Agent executions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_executions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  input_data TEXT,
  output_data TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_agent_executions_agent_status ON agent_executions(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_executions_task_id ON agent_executions(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_status_created ON agent_executions(status, created_at);

CREATE OR REPLACE FUNCTION trg_agent_executions_updated_at_fn() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_executions_updated_at ON agent_executions;
CREATE TRIGGER trg_agent_executions_updated_at BEFORE UPDATE ON agent_executions
FOR EACH ROW EXECUTE FUNCTION trg_agent_executions_updated_at_fn();

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  execution_id TEXT REFERENCES agent_executions(id) ON DELETE SET NULL,
  level TEXT NOT NULL DEFAULT 'info',
  type TEXT NOT NULL DEFAULT 'status',
  message TEXT NOT NULL,
  data TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_task_events_task_created ON task_events(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_events_execution_id ON task_events(execution_id);
CREATE INDEX IF NOT EXISTS idx_task_events_level ON task_events(level);

CREATE TABLE IF NOT EXISTS agent_execution_logs (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info',
  type TEXT NOT NULL DEFAULT 'log',
  message TEXT NOT NULL,
  data TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_agent_execution_logs_execution_created ON agent_execution_logs(execution_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_execution_logs_level ON agent_execution_logs(level);

-- ---------------------------------------------------------------------------
-- API / tool integrations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tool_integrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  environment TEXT NOT NULL DEFAULT 'development',
  encrypted_config TEXT,
  config_key_ref TEXT,
  scopes TEXT NOT NULL DEFAULT '',
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  last_tested_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_tool_integrations_user_id ON tool_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_tool_integrations_project_id ON tool_integrations(project_id);
CREATE INDEX IF NOT EXISTS idx_tool_integrations_type ON tool_integrations(type);
CREATE INDEX IF NOT EXISTS idx_tool_integrations_status ON tool_integrations(status);

CREATE OR REPLACE FUNCTION trg_tool_integrations_updated_at_fn() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tool_integrations_updated_at ON tool_integrations;
CREATE TRIGGER trg_tool_integrations_updated_at BEFORE UPDATE ON tool_integrations
FOR EACH ROW EXECUTE FUNCTION trg_tool_integrations_updated_at_fn();

CREATE TABLE IF NOT EXISTS agent_integrations (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  integration_id TEXT NOT NULL REFERENCES tool_integrations(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'read',
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  PRIMARY KEY (agent_id, integration_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_integrations_integration_id ON agent_integrations(integration_id);
CREATE INDEX IF NOT EXISTS idx_agent_integrations_scope ON agent_integrations(scope);

-- ---------------------------------------------------------------------------
-- Usage tracking
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  execution_id TEXT REFERENCES agent_executions(id) ON DELETE SET NULL,
  metric TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL,
  metadata TEXT,
  recorded_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_usage_records_user_recorded ON usage_records(user_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_usage_records_project_recorded ON usage_records(project_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_usage_records_task_recorded ON usage_records(task_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_usage_records_agent_recorded ON usage_records(agent_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_usage_records_metric ON usage_records(metric);

-- ---------------------------------------------------------------------------
-- Audit & security logs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  description TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created ON audit_logs(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

CREATE TABLE IF NOT EXISTS security_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  ip_address TEXT,
  user_agent TEXT,
  description TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_security_logs_user_created ON security_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_security_logs_event_type ON security_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_security_logs_severity ON security_logs(severity);
