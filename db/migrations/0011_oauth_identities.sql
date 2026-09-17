-- 0011: OAuth providers & account linking.
--
-- Two durable pieces:
--   1. oauth_identities — one row per (provider, provider_account_id) with a
--      UNIQUE constraint: a provider identity can belong to exactly one user,
--      which is the basis of linking conflict/takeover protection.
--   2. oauth_states — server-side storage for the OAuth `state` parameter
--      (CSRF protection): stored as a SHA-256 hash, single-use (guarded
--      consumed_at transition), 10-minute TTL, bound to provider + mode +
--      user (link flow) + the exact redirect_uri + the requester IP, and
--      carrying the PKCE code_verifier (never exposed to the browser).

CREATE TABLE IF NOT EXISTS oauth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,                    -- google | github | microsoft | apple
  provider_account_id TEXT NOT NULL,
  email_at_link TEXT,                        -- provider email at link time (audit context)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_identities_user ON oauth_identities(user_id);

CREATE TABLE IF NOT EXISTS oauth_states (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,           -- sha256(state) — raw state never stored
  provider TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'login',        -- login | link
  user_id TEXT,                              -- set for link mode (the initiating session)
  code_verifier TEXT,                        -- PKCE S256 verifier (google, github)
  redirect_uri TEXT NOT NULL,                -- exact callback URI that must match
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states(expires_at);
