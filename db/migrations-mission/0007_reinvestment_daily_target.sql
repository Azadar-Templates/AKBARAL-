-- ZA141251SA mission — reinvestment + fixed daily revenue target (0007)
--
-- Two real-money settings the owner controls, both defaulting to OFF (0) so a
-- fresh deployment never invents an allocation:
--
--   reinvest_share_bps        the share of every VERIFIED received revenue that
--                             is moved into the reinvestment wallet instead of
--                             being swept to the treasury. Basis points
--                             (0..10000): 2500 = 25 %. The move is a real
--                             ledger transfer, not a label.
--
--   daily_revenue_target_cents the fixed daily realized-revenue target the
--                             mission reports progress against. 0 = no target.
--                             Progress counts ONLY revenue with status
--                             'received' (verified), never expected/contracted.
--
-- mission_daily_target_days records the first day a target was MET, so the
-- event is auditable and reported exactly once per day.

ALTER TABLE mission_policy ADD COLUMN reinvest_share_bps INTEGER NOT NULL DEFAULT 0;
-- BIGINT (not INTEGER): this holds an aspirational target in CENTS. PostgreSQL's
-- INTEGER is 32-bit (max 2,147,483,647 = $21.4M) while SQLite's is 64-bit, so an
-- INTEGER column here made migration 0008's $1B/day value fail on PostgreSQL with
-- "integer out of range" and blocked the entire mission plane on Neon.
ALTER TABLE mission_policy ADD COLUMN daily_revenue_target_cents BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS mission_daily_target_days (
  day            TEXT PRIMARY KEY,          -- UTC date, YYYY-MM-DD
  target_cents   INTEGER NOT NULL,
  realized_cents INTEGER NOT NULL,
  met            INTEGER NOT NULL DEFAULT 0,
  met_at         TEXT,
  updated_at     TEXT NOT NULL
);
