-- ZA141251SA mission — single-identity lockdown (0006)
--
-- The mission may be operated by ONE configured human identity (the owner
-- email in ZA141251SA_OWNER_EMAIL). Everything else must be refused at the
-- door:
--   · no other mission account may exist in an active state,
--   · no session may survive for an account that is not the configured
--     identity (pre-existing sessions are revoked, not merely ignored),
--   · pre-existing access links are revoked the first time the lockdown is
--     enforced (a token minted before lockdown can never read mission data).
--
-- This table records the enforcement itself so the outcome is auditable and
-- so a CHANGED configured identity re-runs the destructive part exactly once.
-- It stores only the configured email (already an operator-supplied value) —
-- never a password, token hash or secret.

CREATE TABLE IF NOT EXISTS mission_identity_lock (
  id                TEXT PRIMARY KEY,
  locked_email      TEXT NOT NULL,
  enforced_at       TEXT NOT NULL,
  owners_suspended  INTEGER NOT NULL DEFAULT 0,
  sessions_revoked  INTEGER NOT NULL DEFAULT 0,
  links_revoked     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mission_identity_lock_email ON mission_identity_lock (locked_email);
