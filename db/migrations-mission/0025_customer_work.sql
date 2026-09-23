-- Customer acquisition/fulfillment, NOT an alternative money ledger or seeded leads.
CREATE TABLE mission_customer_requests (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, service_id TEXT NOT NULL,
 origin TEXT NOT NULL CHECK(origin IN ('direct','fiverr','upwork','contra')),
 customer_ref TEXT NOT NULL, source_ref TEXT NOT NULL, observed_at TEXT NOT NULL,
 review_ref TEXT NOT NULL, consent_expires_at TEXT NOT NULL,
 brief TEXT NOT NULL, configuration_json TEXT NOT NULL, scope_text TEXT NOT NULL, scope_hash TEXT NOT NULL,
 quote_cents INTEGER NOT NULL CHECK(quote_cents>0),
 state TEXT NOT NULL CHECK(state IN ('inquiry','bound','produced','approved','stopped')),
 response_hash TEXT, response TEXT, agent_id TEXT REFERENCES mission_agents(id),
 connector TEXT CHECK(connector IN ('fiverr','upwork','contra')), work_id TEXT, bound_client_ref TEXT, identity_review_ref TEXT,
 input_hash TEXT, artifact TEXT, artifact_hash TEXT, quality_ref TEXT,
 created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0,
 UNIQUE(origin,source_ref), UNIQUE(connector,work_id)
);
CREATE TABLE mission_customer_suppressions (
 origin TEXT NOT NULL, customer_ref TEXT NOT NULL, reason_ref TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(origin,customer_ref)
);
CREATE TABLE mission_customer_events (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES mission_customer_requests(id),
 stage TEXT NOT NULL, evidence_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
