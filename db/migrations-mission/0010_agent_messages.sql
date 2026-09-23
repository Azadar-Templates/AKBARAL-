-- Private owner/agent correspondence. Messages never execute financial commands.
CREATE TABLE mission_agent_messages (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  agent_id TEXT NOT NULL REFERENCES mission_agents(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('owner', 'agent')),
  actor_id TEXT NOT NULL,
  body TEXT NOT NULL,
  reply_to TEXT REFERENCES mission_agent_messages(id),
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (agent_id, actor_id, idempotency_key)
);
CREATE INDEX idx_mission_agent_messages_agent_seq ON mission_agent_messages(agent_id, seq);
