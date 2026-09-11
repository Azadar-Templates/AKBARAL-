-- ---------------------------------------------------------------------------
-- Milestone 7: Agent World + Marketplace
-- Real agent reviews (1-5) powering honest marketplace aggregates.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  UNIQUE(user_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_reviews_user_id ON agent_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_reviews_agent_id ON agent_reviews(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_reviews_created_at ON agent_reviews(created_at);

CREATE OR REPLACE FUNCTION trg_agent_reviews_updated_at_fn() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_reviews_updated_at ON agent_reviews;
CREATE TRIGGER trg_agent_reviews_updated_at BEFORE UPDATE ON agent_reviews
FOR EACH ROW EXECUTE FUNCTION trg_agent_reviews_updated_at_fn();

CREATE INDEX IF NOT EXISTS idx_agent_marketplace_install_count ON agent_marketplace(install_count);
CREATE INDEX IF NOT EXISTS idx_agent_orders_created_at ON agent_orders(created_at);
