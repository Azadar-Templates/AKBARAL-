-- Explicit owner opt-in. Existing conversations are not replayed or billed.
CREATE TABLE mission_agent_chat_configs (
  agent_id TEXT PRIMARY KEY REFERENCES mission_agents(id),
  config TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE mission_agent_chat_jobs (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE REFERENCES mission_agent_messages(id),
  agent_id TEXT NOT NULL REFERENCES mission_agents(id),
  config_snapshot TEXT NOT NULL,
  message_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'blocked', 'needs_review', 'superseded')),
  call_id TEXT UNIQUE REFERENCES mission_resource_calls(id),
  reply_message_id TEXT UNIQUE REFERENCES mission_agent_messages(id),
  reason TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  resolved_at TEXT
);
CREATE INDEX idx_agent_chat_jobs_queue ON mission_agent_chat_jobs(status, created_at, id);
