-- ZA141251SA mission — social publishing connections (0002)
--
-- OAuth connections for content-publishing platforms. The access/refresh tokens
-- themselves are NEVER stored here: they live in mission_credentials (AES-256-GCM
-- encrypted with ZA141251SA_CREDENTIAL_KEY). This table only records which
-- platform account is connected, the scopes granted, the credential row holding
-- the token, and enough metadata to detect expiry honestly.
--
-- Tokens are never synthesized: a connection row only ever reaches status
-- 'connected' after a real token exchange with the platform succeeded.

CREATE TABLE IF NOT EXISTS social_connections (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL UNIQUE,
  account_label TEXT,
  scopes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  credential_id TEXT,
  access_env_var TEXT,
  token_type TEXT,
  connected_by TEXT,
  connected_at TEXT,
  expires_at TEXT,
  last_refresh_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_social_connections_status ON social_connections (status);

-- Single-use, short-lived OAuth state (CSRF protection). Mirrors the platform's
-- oauth_states design: the raw state is never stored, only its hash, and a
-- guarded UPDATE makes replay impossible.
CREATE TABLE IF NOT EXISTS social_oauth_states (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  owner_id TEXT,
  code_verifier TEXT,
  redirect_uri TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_social_oauth_states_expiry ON social_oauth_states (expires_at);
