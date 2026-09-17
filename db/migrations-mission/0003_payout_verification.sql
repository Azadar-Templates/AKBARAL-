-- ZA141251SA mission — payout destination verification (0003)
--
-- Verification is EVIDENCE, not a status flag. A payout destination becomes
-- payable only after the owner has
--   1. configured the destination (provider reference or a masked account, never
--      a raw card/bank number — see payout-verification.ts),
--   2. confirmed every required control check, and
--   3. signed the attestation text, which is stored verbatim.
--
-- Verifications EXPIRE: a destination verified long ago is re-verified rather
-- than trusted forever. Expiry pauses the slot and is audited.
--
-- No money movement is recorded here, and no verification is ever synthesized by
-- the system: only an owner confirmation can produce status 'verified'.

CREATE TABLE IF NOT EXISTS mission_payout_slot_verifications (
  id TEXT PRIMARY KEY,
  slot INTEGER NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  checks TEXT NOT NULL DEFAULT '{}',
  required_checks TEXT NOT NULL DEFAULT '[]',
  evidence_ref TEXT,
  attestation TEXT,
  destination_fingerprint TEXT,
  requested_by TEXT,
  requested_at TEXT,
  verified_by TEXT,
  verified_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  revoked_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payout_verifications_slot ON mission_payout_slot_verifications (slot, status);
CREATE INDEX IF NOT EXISTS idx_payout_verifications_expiry ON mission_payout_slot_verifications (expires_at);
