-- 0015: ZA141251SA owner ↔ agent mission chat (private, owner-only).
-- PostgreSQL twin. See db/migrations/0015_mission_chat.sql for the documented
-- isolation contract — identical intent, PG dialect.
--
-- STRICT ISOLATION (same rules as 0014):
--   * Owner-only surface: every route lives behind requireRole('owner',
--     'super_admin'). Ordinary users and staff admins get 403 — verified by
--     tests. Nothing here is reachable from public pages or public APIs.
--   * Every message (owner AND agent) is persisted with full audit events
--     (economy_events, kind 'mission_chat_*').
--   * Agent replies are generated through the real model router only; a
--     missing provider fails honestly. Content is secret-redacted before
--     storage and before serving.
--   * The agent's internal system instructions are NEVER included in chat
--     context or responses — only public identity (name, specialization,
--     description, category).

CREATE TABLE mission_chat_messages (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,              -- the authorized owner account
  agent_slug TEXT NOT NULL,                 -- registry agent (never a free-text name)
  direction TEXT NOT NULL CHECK (direction IN ('owner', 'agent')),
  content TEXT NOT NULL,                    -- redacted before storage
  status TEXT NOT NULL DEFAULT 'completed', -- completed | failed
  model_key TEXT,                           -- model that produced an agent reply
  error_code TEXT,                          -- honest failure code when status='failed'
  created_at TEXT NOT NULL
);

CREATE INDEX idx_mission_chat_thread
  ON mission_chat_messages (owner_user_id, agent_slug, created_at);

-- Child-agent hierarchy limits (Section 2 gates): expansions may never
-- recurse deeper than max_agent_depth levels nor give one parent more than
-- max_children_per_agent children. Conservative defaults; owner-tunable.
ALTER TABLE economy_policy ADD COLUMN max_agent_depth INTEGER NOT NULL DEFAULT 2;
ALTER TABLE economy_policy ADD COLUMN max_children_per_agent INTEGER NOT NULL DEFAULT 4;
