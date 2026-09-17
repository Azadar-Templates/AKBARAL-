-- ZA141251SA mission — explicit ledger sequence (0004)
--
-- The ledger hash chain used to depend on SQLite's implicit `rowid` for
-- ordering (previous-hash lookup and chain verification). That made the chain
-- engine-specific and left the ordering implicit. `seq` makes it explicit and
-- portable, so the same treasury can run on PostgreSQL without changing the
-- tamper-evidence guarantee.
--
-- The backfill for existing rows is performed in code (see applyMissionMigrations)
-- because it needs the engine's insertion order, which only the SQLite engine can
-- expose via rowid; a fresh PostgreSQL database has nothing to backfill.

ALTER TABLE mission_ledger ADD COLUMN seq INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_ledger_seq ON mission_ledger(seq);
