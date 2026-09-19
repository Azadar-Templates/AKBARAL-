-- Approval is not provisioning. Preserve old rows, but require evidence before
-- presenting legacy status-only resources as usable infrastructure.
ALTER TABLE mission_resources ADD COLUMN funding_wallet_id TEXT REFERENCES mission_wallets(id);
ALTER TABLE mission_resources ADD COLUMN provisioning_ref TEXT;
ALTER TABLE mission_resources ADD COLUMN provisioned_cost_cents INTEGER;
ALTER TABLE mission_resources ADD COLUMN provisioned_at TEXT;
UPDATE mission_resources SET status = 'needs_verification' WHERE status = 'active';
