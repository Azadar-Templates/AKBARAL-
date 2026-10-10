-- 0049: strip the dead data the bare-bones audit found, and record what the fleet ranks.
--
-- Proofs for every statement here (grep over src/**, scripts/**, mission-dashboard/**, which is
-- what the audit ran; `db/migrations-mission` alone mentions these names, which is a definition,
-- not a read):
--
--   mission_meta                no code reference, 0 rows in a migrated+seeded database.
--                               It was a key/value scratch table from 0001 that nothing ever
--                               adopted. Dropped.
--   agent_run_logs.tokens_used  no code or dashboard reads the column; the queue indexes
--                               (idx_agent_run_logs_queue/_target/_platform) do not cover it, and
--                               no view or trigger mentions it. Dropped.
--   mission_earning_intelligence.avg_settlement_hours
--                               same: unread and unwritten by any code path; idx_intel_key and
--                               idx_intel_cycle do not reference it. Dropped.
--
-- Deliberately NOT dropped, with the rule that stopped it:
--   * mission_kyc_submissions — 0 rows and unread today, but it is identity/KYC material, so it
--     falls under "never drop a table that holds … credentials, or owner identity".
--   * bounty_submissions.platform_response / .submitted_at — no code reads them either, but they
--     are the record of what a venue said back, i.e. audit evidence for a submission. Unread is
--     not the same as unimportant, so they stay.
--   * every table behind the views the owner stripped (knowledge, playbooks, lessons, daily
--     targets, social connections) — the workers and the fleet still read them; only the
--     presentation was clutter, so only the presentation went.

DROP TABLE IF EXISTS mission_meta;
ALTER TABLE agent_run_logs DROP COLUMN tokens_used;
ALTER TABLE mission_earning_intelligence DROP COLUMN avg_settlement_hours;

-- What the fleet needs to match work to a specialist's named specialty: the opportunity class of
-- each ranked item, taken from the verified catalog record rather than guessed at ranking time.
-- Ranking writes it from the verified catalog record. Rows ranked before this migration keep NULL
-- and are therefore refused by the specialty gate until they are re-ranked, which is the fail-closed
-- answer: no class, no assumed fit.
ALTER TABLE mission_specialist_opportunities ADD COLUMN opportunity_class TEXT;

-- The other half of "record what each agent earned": the verified settlement reference that
-- recordOutcome already demands is now kept on the opportunity it belongs to, so an earnings figure
-- can be re-derived from the settlement table instead of from a counter.
ALTER TABLE mission_specialist_opportunities ADD COLUMN payment_reference TEXT;
