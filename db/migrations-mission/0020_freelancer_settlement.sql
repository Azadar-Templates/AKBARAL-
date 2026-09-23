-- Read-only payout evidence and independently verified receiving cash only.
-- No seeds, balance migration, live adapter activation or worker enablement.
ALTER TABLE mission_freelancer_work ADD COLUMN money_opportunity_id TEXT REFERENCES mission_money_opportunities(id);
CREATE TABLE mission_freelancer_payouts (
 user_id TEXT NOT NULL, payout_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('observed','pending','unknown','booked','review','reversed')),
 remittance_json TEXT NOT NULL, remittance_hash TEXT NOT NULL,
 rail TEXT, receiving_account TEXT, external_id TEXT, receipt_id TEXT UNIQUE,
 settlement_json TEXT, settlement_hash TEXT, net_cents INTEGER,
 reversed_cents INTEGER NOT NULL DEFAULT 0 CHECK(reversed_cents>=0), updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id,payout_id), UNIQUE(rail,receiving_account,external_id)
);
CREATE TABLE mission_freelancer_payout_items (
 work_id TEXT PRIMARY KEY REFERENCES mission_freelancer_work(id),
 user_id TEXT NOT NULL, payout_id TEXT NOT NULL,
 FOREIGN KEY(user_id,payout_id) REFERENCES mission_freelancer_payouts(user_id,payout_id)
);
CREATE TABLE mission_freelancer_settlement_evidence (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payout_id TEXT NOT NULL,
 stage TEXT NOT NULL, evidence_hash TEXT NOT NULL, snapshot_json TEXT NOT NULL, observed_at TEXT NOT NULL
);
