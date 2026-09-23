-- Mission only. No opening cash, credentials, synthetic opportunities, or imported balances.
CREATE TABLE mission_awin_opportunities (
 id TEXT PRIMARY KEY, publisher_id TEXT NOT NULL, advertiser_id TEXT NOT NULL,
 name TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'discovered', observed_at TEXT NOT NULL,
 UNIQUE(publisher_id,advertiser_id)
);
-- Deliberately permanent exclusive bindings, including revoked tombstones. Reassignment
-- requires a separately reviewed migration; revocation must not steal historical earnings.
CREATE TABLE mission_awin_assignments (
 id TEXT PRIMARY KEY, agent_id TEXT NOT NULL UNIQUE REFERENCES mission_agents(id),
 publisher_id TEXT NOT NULL UNIQUE, property_key TEXT NOT NULL UNIQUE,
 opportunity_id TEXT NOT NULL UNIQUE REFERENCES mission_awin_opportunities(id),
 money_opportunity_id TEXT NOT NULL REFERENCES mission_money_opportunities(id),
 destination_url TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('eligible','revoked')),
 property_evidence TEXT NOT NULL, verified_until TEXT NOT NULL, approved_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE mission_awin_publications (
 id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES mission_awin_assignments(id),
 idempotency_key TEXT NOT NULL UNIQUE, input_hash TEXT NOT NULL,
 title TEXT NOT NULL, body TEXT NOT NULL, destination_url TEXT NOT NULL,
 tracking_url TEXT, content_html TEXT, content_hash TEXT, approved_hash TEXT, approved_by TEXT,
 state TEXT NOT NULL, external_id TEXT, publication_url TEXT, updated_at TEXT NOT NULL,
 UNIQUE(assignment_id,external_id)
);
CREATE TABLE mission_awin_commissions (
 publisher_id TEXT NOT NULL, transaction_id TEXT NOT NULL,
 publication_id TEXT NOT NULL REFERENCES mission_awin_publications(id),
 state TEXT NOT NULL, amount_decimal TEXT NOT NULL, currency TEXT NOT NULL,
 payment_id TEXT, evidence_hash TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(publisher_id,transaction_id)
);
CREATE TABLE mission_awin_payouts (
 publisher_id TEXT NOT NULL, payment_id TEXT NOT NULL,
 rail TEXT NOT NULL, receiving_account TEXT NOT NULL, external_id TEXT NOT NULL,
 receipt_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL, net_cents INTEGER,
 reversed_cents INTEGER NOT NULL DEFAULT 0 CHECK(reversed_cents >= 0),
 fingerprint TEXT, updated_at TEXT NOT NULL,
 PRIMARY KEY(publisher_id,payment_id), UNIQUE(rail,receiving_account,external_id)
);
CREATE TABLE mission_awin_events (
 id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, subject_id TEXT NOT NULL, state TEXT NOT NULL,
 evidence_ref TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX mission_awin_payment ON mission_awin_commissions(publisher_id,payment_id);
CREATE INDEX mission_awin_publication_state ON mission_awin_publications(state,updated_at);
-- Conservative global Awin request budget across every mission worker/token.
CREATE TABLE mission_awin_api_requests (id TEXT PRIMARY KEY, started_at TEXT NOT NULL);
CREATE INDEX mission_awin_api_requests_time ON mission_awin_api_requests(started_at);
CREATE TABLE mission_awin_api_cooldown (id TEXT PRIMARY KEY, until_at TEXT NOT NULL);

-- Whitelisted normalized responses, not raw HTTP bodies, PII or credentials.
CREATE TABLE mission_awin_evidence (
 publisher_id TEXT NOT NULL, transaction_id TEXT NOT NULL, evidence_hash TEXT NOT NULL,
 snapshot_json TEXT NOT NULL, observed_at TEXT NOT NULL,
 PRIMARY KEY(publisher_id,transaction_id,evidence_hash)
);
