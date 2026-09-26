-- ZA141251SA mission — withdrawal method secrets and real card records (0034)
--
-- WITHDRAWAL METHODS
-- A withdrawal method is an owner-configured payout destination. The public
-- description (label, holder, MASKED account, currency) stays in
-- mission_payout_slots, exactly as before. Anything the owner types that is
-- actually sensitive (full account number, IBAN, routing/SWIFT, wallet email)
-- is encrypted with the mission vault key (AES-256-GCM) and stored ONLY here,
-- as one opaque ciphertext blob. Nothing in this table is ever returned by an
-- HTTP route: the dashboard sees the masked description only.
--
-- CARDS
-- A card row may only be created when a real card provider confirms issuance
-- and returns its own reference. There is no "pending fake card": if no
-- provider issued a card, this table is empty and the dashboard says so.

CREATE TABLE IF NOT EXISTS mission_withdrawal_secrets (
  slot            INTEGER PRIMARY KEY REFERENCES mission_payout_slots(slot) ON DELETE CASCADE,
  ciphertext      TEXT NOT NULL,
  iv              TEXT NOT NULL,
  tag             TEXT NOT NULL,
  hint            TEXT NOT NULL,             -- e.g. "…1234"; never the full value
  fields          TEXT NOT NULL,             -- JSON list of encrypted field NAMES only
  fingerprint     TEXT NOT NULL,             -- sha256 of the encrypted payload
  created_at      TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mission_cards (
  id              TEXT PRIMARY KEY,
  slot            INTEGER NOT NULL,          -- 1..4, one card per card slot
  label           TEXT NOT NULL,
  provider        TEXT NOT NULL,             -- real provider name, e.g. stripe
  provider_ref    TEXT NOT NULL,             -- provider's own card id
  brand           TEXT,
  last4           TEXT NOT NULL,             -- only the last four digits are ever stored
  currency        TEXT NOT NULL DEFAULT 'USD',
  status          TEXT NOT NULL,             -- provider-reported status (active|inactive|cancelled)
  funding_wallet  TEXT,
  issued_at       TEXT NOT NULL,
  issued_by       TEXT NOT NULL,
  evidence        TEXT NOT NULL,             -- provider confirmation reference
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_cards_slot ON mission_cards(slot);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_cards_provider_ref ON mission_cards(provider, provider_ref);
