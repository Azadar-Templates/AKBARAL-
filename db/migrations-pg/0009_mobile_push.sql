-- 0009: Mobile push notification support (M12).
-- Device tokens registered by the mobile app (expo-notifications). Tokens are
-- per-user, unique, and refreshed on every app login. Push delivery itself is
-- honest: dispatch failures are logged and surfaced, never faked.

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'android',
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id, revoked_at);
