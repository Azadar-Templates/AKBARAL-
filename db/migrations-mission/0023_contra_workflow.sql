-- Private, approval-gated paid work. No accounts, earnings or live adapters seeded.
CREATE TABLE mission_contra_accounts (
 account_id TEXT PRIMARY KEY,
 agent_id TEXT NOT NULL UNIQUE REFERENCES mission_agents(id),
 state TEXT NOT NULL CHECK(state IN ('authorized','revoked')),
 expires_at TEXT NOT NULL, review_ref TEXT NOT NULL, approved_by TEXT NOT NULL UNIQUE,
 authority_hash TEXT NOT NULL
);
CREATE TABLE mission_contra_work (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES mission_contra_accounts(account_id),
 project_id TEXT NOT NULL UNIQUE, agreement_id TEXT NOT NULL UNIQUE, agreement_hash TEXT NOT NULL,
 payment_id TEXT UNIQUE,
 client_id TEXT NOT NULL, scope_hash TEXT NOT NULL, gross_cents INTEGER NOT NULL CHECK(gross_cents>0),
 independent_net_cents INTEGER CHECK(independent_net_cents>0),
 opportunity_id TEXT NOT NULL REFERENCES mission_money_opportunities(id),
 state TEXT NOT NULL CHECK(state IN ('authorized','draft','approved','awaiting_manual_delivery','delivered','provider_confirmed','review')),
 content TEXT, content_hash TEXT, approved_hash TEXT, quality_ref TEXT, approved_by TEXT,
 delivery_intent_at TEXT, submission_id TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE mission_contra_payouts (
 payout_id TEXT PRIMARY KEY, work_id TEXT NOT NULL UNIQUE REFERENCES mission_contra_work(id),
 state TEXT NOT NULL CHECK(state IN ('observed','booked','review','reversed')),
 remittance_hash TEXT NOT NULL, receipt_id TEXT UNIQUE,
 rail TEXT, receiving_account TEXT, external_id TEXT,
 settlement_hash TEXT, net_cents INTEGER CHECK(net_cents>0),
 reversed_cents INTEGER NOT NULL DEFAULT 0 CHECK(reversed_cents>=0),
 UNIQUE(rail,receiving_account,external_id)
);
CREATE TABLE mission_contra_events (
 id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, stage TEXT NOT NULL,
 evidence_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
