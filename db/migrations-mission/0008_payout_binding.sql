-- Preserve the exact source and destination approved for each payout.
-- Legacy rows remain NULL: approval must refuse an unbound old request;
-- failed legacy reservations may be refunded only from their actual ledger leg.
ALTER TABLE mission_payouts ADD COLUMN source_wallet_id TEXT REFERENCES mission_wallets(id);
ALTER TABLE mission_payouts ADD COLUMN destination_fingerprint TEXT;
ALTER TABLE mission_payouts ADD COLUMN destination_snapshot TEXT;
