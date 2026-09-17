-- ZA141251SA mission — idempotency for owner-funded ledger deposits (0005)
--
-- Owner working capital is real money entering a wallet, so a retried HTTP
-- request (a double tap, a proxy retry, a dropped response) must never fund
-- twice. The ledger is append-only and hash-chained; this column records the
-- caller's idempotency key for those deposits and a partial unique index makes
-- a duplicate physically impossible rather than merely checked in code.
--
-- Partial (WHERE idempotency_key IS NOT NULL) so pre-existing rows and
-- non-keyed ledger movements are unaffected.

ALTER TABLE mission_ledger ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_ledger_idempotency
  ON mission_ledger(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
