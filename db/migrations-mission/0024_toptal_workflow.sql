-- Private, approval-gated paid work. No accounts, earnings or live adapters seeded.
CREATE TABLE mission_toptal_accounts (
 account_id TEXT PRIMARY KEY,
 agent_id TEXT NOT NULL UNIQUE REFERENCES mission_agents(id),
 state TEXT NOT NULL CHECK(state IN ('authorized','revoked')),
 expires_at TEXT NOT NULL, review_ref TEXT NOT NULL, approved_by TEXT NOT NULL UNIQUE,
 authority_hash TEXT NOT NULL
);
CREATE TABLE mission_toptal_work (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES mission_toptal_accounts(account_id),
 period_id TEXT NOT NULL UNIQUE, engagement_id TEXT NOT NULL, agreement_id TEXT NOT NULL, agreement_hash TEXT NOT NULL,
 rate_cents INTEGER NOT NULL CHECK(rate_cents>0), authorized_minutes INTEGER NOT NULL CHECK(authorized_minutes>0),
 period_start TEXT NOT NULL, period_end TEXT NOT NULL,
 timesheet_id TEXT UNIQUE, timesheet_hash TEXT,
 payment_id TEXT UNIQUE,
 client_id TEXT NOT NULL, scope_hash TEXT NOT NULL, gross_cents INTEGER NOT NULL DEFAULT 0 CHECK(gross_cents>=0),
 talent_net_cents INTEGER CHECK(talent_net_cents>0),
 opportunity_id TEXT NOT NULL REFERENCES mission_money_opportunities(id),
 state TEXT NOT NULL CHECK(state IN ('authorized','draft','approved','awaiting_manual_delivery','delivered','provider_confirmed','review')),
 content TEXT, content_hash TEXT, approved_hash TEXT, quality_ref TEXT, approved_by TEXT,
 delivery_intent_at TEXT, submission_id TEXT, version INTEGER NOT NULL DEFAULT 0,
 UNIQUE(account_id,engagement_id,period_start,period_end)
);
CREATE TABLE mission_toptal_payouts (
 payout_id TEXT PRIMARY KEY, work_id TEXT NOT NULL UNIQUE REFERENCES mission_toptal_work(id),
 state TEXT NOT NULL CHECK(state IN ('observed','booked','review','reversed')),
 remittance_hash TEXT NOT NULL, receipt_id TEXT UNIQUE,
 rail TEXT, receiving_account TEXT, external_id TEXT,
 settlement_hash TEXT, net_cents INTEGER CHECK(net_cents>0),
 reversed_cents INTEGER NOT NULL DEFAULT 0 CHECK(reversed_cents>=0),
 UNIQUE(rail,receiving_account,external_id)
);
CREATE TABLE mission_toptal_events (
 id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, stage TEXT NOT NULL,
 evidence_hash TEXT NOT NULL, created_at TEXT NOT NULL
);

-- Immutable verified human intervals prevent billing the same person's time twice.
-- BIGINT is required for epoch milliseconds on native PostgreSQL.
CREATE TABLE mission_toptal_time (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES mission_toptal_accounts(account_id),
 work_id TEXT NOT NULL REFERENCES mission_toptal_work(id),
 start_ms BIGINT NOT NULL, end_ms BIGINT NOT NULL CHECK(end_ms>start_ms)
);
CREATE INDEX mission_toptal_time_overlap ON mission_toptal_time(account_id,start_ms,end_ms);
