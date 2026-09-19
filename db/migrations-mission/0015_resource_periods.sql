-- Immutable owner-evidenced billing boundaries. No automatic renewals/payments.
CREATE TABLE mission_resource_periods (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES mission_resources(id),
  provider TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  previous_expiry TEXT NOT NULL,
  previous_usage TEXT NOT NULL,
  previous_limits TEXT NOT NULL,
  starting_usage TEXT NOT NULL,
  period_limits TEXT NOT NULL,
  actual_cost_cents INTEGER NOT NULL CHECK (actual_cost_cents >= 0),
  wallet_id TEXT REFERENCES mission_wallets(id),
  currency TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  evidence TEXT NOT NULL,
  ledger_id TEXT REFERENCES mission_ledger(id),
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(resource_id, idempotency_key),
  UNIQUE(provider, provider_ref),
  UNIQUE(resource_id, period_start)
);
CREATE INDEX idx_resource_periods_history ON mission_resource_periods(resource_id, period_start);
