-- 0046: bounty claim eligibility.
--
-- Discovery acceptance is not payability: a lead can be open, labelled, and already handed
-- to another contributor. These columns record the LIVE recheck (who is assigned, whether
-- a maintainer claimed it in prose, whether a competing PR exists, whether payment terms
-- and acceptance criteria are actually stated) so that assignment, execution and submission
-- can each refuse on evidence instead of on a stale label match.
ALTER TABLE mission_bounty_opportunities ADD COLUMN claim_state TEXT;
ALTER TABLE mission_bounty_opportunities ADD COLUMN claim_reason TEXT;
ALTER TABLE mission_bounty_opportunities ADD COLUMN claim_checked_at TEXT;
ALTER TABLE mission_bounty_opportunities ADD COLUMN claim_evidence_json TEXT;
ALTER TABLE mission_bounty_opportunities ADD COLUMN claim_owner_actions_json TEXT;

-- The recheck is a scheduled sweep over open leads; keep that read cheap and ordered.
CREATE INDEX IF NOT EXISTS idx_mission_bounty_claim_check
  ON mission_bounty_opportunities (state, claim_checked_at);
