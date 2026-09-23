-- Verified cash is intentionally NOT seeded from the legacy owner-reported ledger.
-- All monetary amounts are integer minor units. Reservations are durable cash movements.
CREATE TABLE mission_cash_accounts (
 id TEXT PRIMARY KEY, agent_id TEXT UNIQUE REFERENCES mission_agents(id), currency TEXT NOT NULL,
 available_cents INTEGER NOT NULL DEFAULT 0 CHECK (available_cents >= 0),
 held_cents INTEGER NOT NULL DEFAULT 0 CHECK (held_cents >= 0),
 frozen INTEGER NOT NULL DEFAULT 0 CHECK (frozen IN (0,1))
);
CREATE TABLE mission_cash_entries (
 seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL REFERENCES mission_cash_accounts(id),
 bucket TEXT NOT NULL CHECK (bucket IN ('available','held')), delta_cents INTEGER NOT NULL,
 balance_after INTEGER NOT NULL CHECK (balance_after >= 0), reference TEXT NOT NULL,
 prev_hash TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE mission_money_opportunities (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, evidence_url TEXT NOT NULL, activity TEXT NOT NULL,
 provider TEXT NOT NULL, approved_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'approved', created_at TEXT NOT NULL
);
CREATE TABLE mission_money_grants (
 agent_id TEXT PRIMARY KEY REFERENCES mission_agents(id), parent_id TEXT REFERENCES mission_agents(id),
 status TEXT NOT NULL DEFAULT 'active', opportunity_id TEXT REFERENCES mission_money_opportunities(id),
 spend_limit_cents INTEGER NOT NULL DEFAULT 0 CHECK (spend_limit_cents >= 0),
 delegation_cents INTEGER NOT NULL DEFAULT 0 CHECK (delegation_cents >= 0),
 can_create INTEGER NOT NULL DEFAULT 0 CHECK (can_create IN (0,1)),
 expires_at TEXT NOT NULL, granted_by TEXT NOT NULL
);
CREATE TABLE mission_money_operations (
 id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('expense','withdrawal')), account_id TEXT NOT NULL REFERENCES mission_cash_accounts(id),
 agent_id TEXT REFERENCES mission_agents(id), provider TEXT NOT NULL, destination TEXT NOT NULL,
 category TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
 max_cost_cents INTEGER NOT NULL CHECK (max_cost_cents >= amount_cents), currency TEXT NOT NULL,
 state TEXT NOT NULL CHECK (state IN ('approval_required','reserved','dispatching','pending','unknown','completed','failed','rejected')),
 approved_by TEXT, provider_ref TEXT, actual_cents INTEGER, refunded_cents INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX mission_money_provider_ref ON mission_money_operations(provider, provider_ref);
CREATE TABLE mission_money_receipts (
 provider TEXT NOT NULL, external_id TEXT NOT NULL, fingerprint TEXT NOT NULL, kind TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK (amount_cents > 0), agent_id TEXT, operation_id TEXT, created_at TEXT NOT NULL,
 PRIMARY KEY (provider, external_id)
);
CREATE TABLE mission_money_transfers (
 idempotency_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE mission_earning_jobs (
 id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES mission_agents(id), opportunity_id TEXT NOT NULL REFERENCES mission_money_opportunities(id),
 idempotency_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL DEFAULT 'queued', provider_ref TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE mission_cash_liabilities (
 provider TEXT NOT NULL, external_id TEXT NOT NULL, remaining_cents INTEGER NOT NULL CHECK (remaining_cents >= 0),
 PRIMARY KEY(provider,external_id)
);
-- Old balances may have been owner-attested; they are never verified opening cash.
UPDATE mission_wallets SET status='frozen' WHERE balance_cents > 0 AND status='active';
ALTER TABLE mission_money_operations ADD COLUMN destination_hash TEXT;
ALTER TABLE mission_earning_jobs ADD COLUMN cost_operation_id TEXT REFERENCES mission_money_operations(id);
