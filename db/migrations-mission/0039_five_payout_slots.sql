-- Expand owner-controlled, provider-tokenized payout destinations from four
-- to five without introducing card/account credential storage.
PRAGMA foreign_keys = OFF;

CREATE TABLE mission_payout_slots_v2 (
  slot                 INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 5),
  label                TEXT NOT NULL,
  destination_type     TEXT,
  holder_name          TEXT,
  masked_account       TEXT,
  provider_ref         TEXT,
  currency             TEXT NOT NULL DEFAULT 'USD',
  min_payout_cents     INTEGER NOT NULL DEFAULT 0,
  max_payout_cents     INTEGER,
  approval_required    INTEGER NOT NULL DEFAULT 1,
  status               TEXT NOT NULL DEFAULT 'unconfigured',
  configured_at        TEXT,
  verified_at          TEXT,
  verified_by          TEXT,
  notes                TEXT,
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO mission_payout_slots_v2
  (slot, label, destination_type, holder_name, masked_account, provider_ref,
   currency, min_payout_cents, max_payout_cents, approval_required, status,
   configured_at, verified_at, verified_by, notes, updated_at)
SELECT slot, label, destination_type, holder_name, masked_account, provider_ref,
       currency, min_payout_cents, max_payout_cents, approval_required, status,
       configured_at, verified_at, verified_by, notes, updated_at
FROM mission_payout_slots;

DROP TABLE mission_payout_slots;
ALTER TABLE mission_payout_slots_v2 RENAME TO mission_payout_slots;

PRAGMA foreign_keys = ON;
