-- Mission only. No opening cash, credentials, synthetic opportunities, or imported balances.
-- Per-opportunity fraud/bait-repo risk screen, run automatically at discovery time,
-- before any candidate is ever prepared. Additive columns only — 0034 already shipped.
ALTER TABLE mission_bounty_opportunities ADD COLUMN risk_state TEXT NOT NULL DEFAULT 'accepted';
ALTER TABLE mission_bounty_opportunities ADD COLUMN risk_reason TEXT;
ALTER TABLE mission_bounty_opportunities ADD COLUMN repo_stars INTEGER;
ALTER TABLE mission_bounty_opportunities ADD COLUMN repo_created_at TEXT;
CREATE INDEX mission_bounty_opportunities_risk ON mission_bounty_opportunities(risk_state);
