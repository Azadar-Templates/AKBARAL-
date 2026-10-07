-- Read-only head-agent control plane records.
-- These tables are owner-scoped durable facts. The head agent may read and
-- explain them, but there is deliberately no head-agent mutation API.

CREATE TABLE IF NOT EXISTS mission_head_agent_resources (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES mission_owner(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  category        TEXT NOT NULL,
  provider        TEXT,
  expires_at      TEXT,
  cost_cents      INTEGER CHECK (cost_cents IS NULL OR cost_cents >= 0),
  currency        TEXT NOT NULL DEFAULT 'USD',
  cost_status     TEXT NOT NULL CHECK (cost_status IN ('unverified','verified')) DEFAULT 'unverified',
  cost_evidence   TEXT,
  notes           TEXT,
  status          TEXT NOT NULL CHECK (status IN ('active','expiring','expired','paused','unknown')) DEFAULT 'unknown',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_head_resources_owner_expiry
  ON mission_head_agent_resources(owner_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_head_resources_owner_status
  ON mission_head_agent_resources(owner_id, status);

CREATE TABLE IF NOT EXISTS mission_head_agent_alerts (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES mission_owner(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('expiry','approval','provider','payout','system')),
  severity        TEXT NOT NULL CHECK (severity IN ('info','warning','critical')) DEFAULT 'info',
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  subject_type    TEXT,
  subject_id      TEXT,
  due_at          TEXT,
  status          TEXT NOT NULL CHECK (status IN ('open','acknowledged','resolved')) DEFAULT 'open',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_head_alerts_owner_status_due
  ON mission_head_agent_alerts(owner_id, status, due_at);

CREATE TABLE IF NOT EXISTS mission_head_agent_info (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES mission_owner(id) ON DELETE CASCADE,
  topic           TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  source_type     TEXT NOT NULL,
  source_id       TEXT,
  source_label    TEXT,
  source_endpoint TEXT,
  status          TEXT NOT NULL CHECK (status IN ('current','superseded')) DEFAULT 'current',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_head_info_owner_topic
  ON mission_head_agent_info(owner_id, topic, status);
