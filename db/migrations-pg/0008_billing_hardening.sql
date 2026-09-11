-- ---------------------------------------------------------------------------
-- Milestone 8: billing hardening.
-- Duplicate webhook protection: every provider event id is recorded once;
-- replays are rejected before any side effect (settlement, refunds, credits).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS processed_billing_events (
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT,
  processed_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  PRIMARY KEY (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_paid_at ON invoices(paid_at);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at);
