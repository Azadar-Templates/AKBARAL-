-- A missing deadline on a previously dispatched call is deliberately ambiguous.
-- Readiness blocks it until owner reconciliation; no usage is guessed/released.
ALTER TABLE mission_resource_calls ADD COLUMN deadline_at TEXT;
