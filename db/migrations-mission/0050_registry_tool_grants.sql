-- ZA141251SA REGISTRY TOOL GRANTS — a read-only export of which tools the platform
-- registry has attached to each imported specialist, kept as metadata in the mission
-- database so the fleet's capability surface is auditable without a live join.
--
-- WHY THIS EXISTS. `npm run mission:sync-registry` copied agent *identity* (slug,
-- name, category, capabilities) and nothing else, so the mission side could never
-- answer "what is this agent wired to do" without querying the platform database at
-- runtime — which the isolation rule forbids (`src/mission/database.ts` header,
-- NO LIVE JOIN: this command is the only bridge and it is run explicitly). Production
-- measured 4,001 agents and 7,203 `agent_tools` rows on the platform side and no
-- mission table that could hold the second number at all. The sync therefore could not
-- report tool grants even when it wanted to: there was nowhere to put them.
--
-- WHAT THIS TABLE IS AND IS NOT.
--   · It is an EXPORT of a grant, not a grant. It records what the platform says it
--     attached, with `source` naming where the row came from, so an operator can trace
--     it back. Writing a row here authorizes nothing.
--   · The mission's own tool gate stays exactly where it was: `mission_tools.status`
--     (deny by default, `src/mission/self-management.ts`) is still the only thing that
--     lets a mission agent use a tool, and this migration inserts nothing into it. An
--     exported grant with no approved `mission_tools` row means "the platform has this
--     attached", never "the mission may run it".
--   · `agent_tools.config` is deliberately NOT copied. That column holds per-tool
--     configuration, which on this platform can carry endpoints and credential
--     references; the sync is a metadata export, so the config is skipped and counted,
--     with the reason printed, rather than silently dropped or silently copied.
--   · No foreign key reaches into a platform table. `agent_id` points at
--     `mission_agents`, the mission's own row, so a shared PostgreSQL schema cannot
--     couple the two systems and a platform rename cannot orphan these rows quietly.

CREATE TABLE IF NOT EXISTS mission_agent_tools (
  agent_id    TEXT NOT NULL REFERENCES mission_agents(id) ON DELETE CASCADE,
  tool_key    TEXT NOT NULL,
  tool_name   TEXT NOT NULL,
  kind        TEXT,
  permission  TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'akbaral-registry',
  exported_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, tool_key)
);

-- The read path is "which agents hold this tool" (fleet capability roll-ups) as much as
-- "which tools does this agent hold", so both directions need an index.
CREATE INDEX IF NOT EXISTS idx_mission_agent_tools_tool_key ON mission_agent_tools(tool_key);
CREATE INDEX IF NOT EXISTS idx_mission_agent_tools_agent_id ON mission_agent_tools(agent_id);
