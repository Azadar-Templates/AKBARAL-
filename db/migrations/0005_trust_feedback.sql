-- AKBARAL! / MASTER AI — Phase 5 trust, feedback and moderation.
--
-- Adds real, user-owned feedback/ratings used for task quality, bug reports,
-- feature requests, abuse reports and admin review. It never seeds fake
-- ratings/reviews; every row comes from an actual user action.

CREATE TABLE IF NOT EXISTS task_ratings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  execution_id TEXT REFERENCES agent_executions(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_ratings_user_id ON task_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_task_ratings_task_id ON task_ratings(task_id);
CREATE INDEX IF NOT EXISTS idx_task_ratings_created_at ON task_ratings(created_at);

CREATE TRIGGER IF NOT EXISTS trg_task_ratings_updated_at
AFTER UPDATE ON task_ratings
FOR EACH ROW
BEGIN
  UPDATE task_ratings SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('bug','feature','feedback','abuse')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | under_review | resolved | dismissed
  admin_note TEXT,
  resolved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback(type);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);

CREATE TRIGGER IF NOT EXISTS trg_feedback_updated_at
AFTER UPDATE ON feedback
FOR EACH ROW
BEGIN
  UPDATE feedback SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
