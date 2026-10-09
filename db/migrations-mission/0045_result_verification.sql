-- Independent, evidence-driven result verification for executed earning work.
--
-- WHY THIS EXISTS. Before these tables, the only automatic result verification in
-- the earning loop was `continuous-scheduler.ts` step 5, which called
-- EarningEngine.verifyWorkMultiAgent() with two hard-coded attestations: the
-- producing agent grading itself 0.92/passed and "any other active agent" graded
-- 0.88/passed. Nothing read an artifact, a digest, a delivery, or a reviewer.
-- Because verifyWorkMultiAgent trusts whatever the caller asserts, an opportunity
-- could reach `verified` — and from there feed mission_opportunity_roi,
-- reinvestment and class-scaling decisions — with zero evidence that any real
-- work had been produced. That is a fabricated completion record, so the automatic
-- path now has to derive its verdict from these two tables.
--
-- CONTRACT.
--   mission_execution_evidence   content-addressed facts recorded against the
--                                assignment that produced them (one row per
--                                opportunity + digest; the digest is a sha256, so
--                                an approval always names the exact bytes it
--                                covered).
--   mission_result_verifications one row per (opportunity, verifier, digest-set):
--                                the checks a specific agent ran and what they
--                                concluded. A verdict is only usable if the
--                                verifier is not the producer and the evidence was
--                                observed after the work was assigned.
--
-- `mode` keeps simulation honest: a verification performed by fixture agents is
-- written as 'test_fixture' and can never satisfy a production readiness or
-- revenue claim. It is derived from the agents' own origin_platform, not from a
-- caller's say-so.
--
-- Deliberately additive: no ALTER TABLE, no touched columns, existing rows and the
-- low-level verifyWorkMultiAgent primitive (used by owner-attested settlement
-- tests) keep behaving exactly as before.

CREATE TABLE IF NOT EXISTS mission_execution_evidence (
  id              TEXT PRIMARY KEY,
  opportunity_id  TEXT NOT NULL REFERENCES mission_earning_engine_opportunities(id) ON DELETE CASCADE,
  execution_id    TEXT,
  agent_id        TEXT NOT NULL REFERENCES mission_agents(id),
  kind            TEXT NOT NULL CHECK (kind IN ('artifact','github_pr','github_commit','document','dataset','provider_receipt','owner_attestation')),
  ref             TEXT NOT NULL,
  digest          TEXT NOT NULL,
  size_bytes      INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  meta_json       TEXT NOT NULL DEFAULT '{}',
  observed_at     TEXT NOT NULL,
  UNIQUE (opportunity_id, digest)
);
CREATE INDEX IF NOT EXISTS idx_exec_evidence_opp ON mission_execution_evidence(opportunity_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_exec_evidence_agent ON mission_execution_evidence(agent_id, observed_at);

CREATE TABLE IF NOT EXISTS mission_result_verifications (
  id                 TEXT PRIMARY KEY,
  opportunity_id     TEXT NOT NULL REFERENCES mission_earning_engine_opportunities(id) ON DELETE CASCADE,
  verifier_agent_id  TEXT NOT NULL REFERENCES mission_agents(id),
  producer_agent_id  TEXT NOT NULL REFERENCES mission_agents(id),
  evidence_digest    TEXT NOT NULL,
  checks_json        TEXT NOT NULL,
  passed             INTEGER NOT NULL CHECK (passed IN (0,1)),
  confidence         REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  mode               TEXT NOT NULL CHECK (mode IN ('production','test_fixture')) DEFAULT 'production',
  created_at         TEXT NOT NULL,
  UNIQUE (opportunity_id, verifier_agent_id, evidence_digest)
);
CREATE INDEX IF NOT EXISTS idx_result_verif_opp ON mission_result_verifications(opportunity_id, passed, created_at);
CREATE INDEX IF NOT EXISTS idx_result_verif_mode ON mission_result_verifications(mode, passed);
