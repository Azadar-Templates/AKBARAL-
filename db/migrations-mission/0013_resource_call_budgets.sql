-- Reservations are internal exposure limits, not provider payments or revenue.
-- Usage settlement alone must never release an unknown financial obligation.
CREATE TABLE mission_resource_call_budgets (
  call_id TEXT PRIMARY KEY REFERENCES mission_resource_calls(id),
  wallet_id TEXT NOT NULL REFERENCES mission_wallets(id),
  currency TEXT NOT NULL,
  reserved_cents INTEGER NOT NULL CHECK (reserved_cents > 0),
  status TEXT NOT NULL CHECK (status IN ('held', 'released', 'recorded')),
  actual_cents INTEGER CHECK (actual_cents >= 0),
  provider_ref TEXT,
  evidence TEXT,
  ledger_id TEXT REFERENCES mission_ledger(id),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE(wallet_id, provider_ref)
);
CREATE INDEX idx_resource_call_budgets_held ON mission_resource_call_budgets(status, wallet_id);
CREATE INDEX idx_resource_calls_owner_page ON mission_resource_calls(resource_id, created_at, id);
