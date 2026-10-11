/**
 * ZA141251SA mission migrations — the boot step. `npm run mission:migrate`
 *
 * Why this exists as its own entry: the mission schema used to be applied only as a
 * side effect of `mission:serve` / `mission:init` / a worker starting up. In a
 * deployment where those are gated off, the mission database simply never migrated,
 * and nothing said so — production sat at 45 of 49 files while the container reported
 * a clean boot. A start-up contract that no one can run is not a contract, so:
 *
 *   · `scripts/start-prod.mjs` runs THIS file on every start, before the mission server
 *     is launched and before either public tier binds, and treats a non-zero exit as a
 *     failed boot;
 *   · it is also runnable by hand and in the runtime image, where `npm run mission:*`
 *     used to die because the image ships `dist/` and no `src/`.
 *
 * It applies exactly `db/migrations-mission/` to the database `ZA141251SA_DATABASE_URL`
 * names (default `file:$DATA_DIR/mission.db`), one file per transaction, recording only
 * what committed. A failure exits non-zero with the message it came with. It writes no
 * revenue, no accounts and no provider credentials: schema and the idempotent seeds the
 * migrations themselves carry, nothing else.
 */
import { applyMissionMigrations, missionDb, type Row } from '../src/mission/database';

function foreignKeyState(): string {
  try {
    if (missionDb.engineName() === 'sqlite') {
      const bad = missionDb.all<Row>('PRAGMA foreign_key_check');
      return bad.length === 0 ? 'clean (foreign_key_check: 0 rows)' : `VIOLATIONS: ${bad.length}`;
    }
    const bad = missionDb.all<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE contype = 'f' AND NOT convalidated`,
    );
    return bad.length === 0 ? 'clean (no unvalidated foreign keys)' : `VIOLATIONS: ${bad.map((r) => r.conname).join(', ')}`;
  } catch (error) {
    // The check is diagnostics, never a gate: an engine that will not answer it is
    // reported as such rather than guessed at.
    return `unavailable (${error instanceof Error ? error.message : String(error)})`;
  }
}

function ledgerCount(): number | null {
  try {
    return Number(missionDb.get<{ count: number }>('SELECT COUNT(*) AS count FROM mission_migrations')?.count ?? 0);
  } catch {
    // Not 0. A ledger that cannot be read is not an empty ledger, and reporting 0 here
    // would tell an operator that nothing had ever been applied.
    return null;
  }
}

function ledgerLabel(value: number | null): string {
  return value === null ? 'unreadable (the database did not answer)' : String(value);
}

function main(): void {
  const before = ledgerCount();
  const fkBefore = foreignKeyState();
  process.stdout.write(
    `[mission-migrate] engine ${missionDb.engineName()} target ${missionDb.path()} ` +
      `— ledger before: ${ledgerLabel(before)}; foreign keys before: ${fkBefore}\n`,
  );
  let applied: string[];
  let total: number;
  try {
    ({ applied, total } = applyMissionMigrations(missionDb));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Reported from the ledger itself, not from what this run hoped to do: a dead
    // connection has no "failing file", and this line must not imply one.
    const now = ledgerCount();
    const state =
      now === null
        ? 'the ledger could not be read at all, so nothing this run did is confirmed'
        : `the ledger now holds ${now} row(s); the file that failed is not recorded and nothing after it was applied`;
    process.stderr.write(
      `[mission-migrate] FAILED on ${missionDb.engineName()} (${missionDb.path()}): ${message}\n` +
        `[mission-migrate] ${state}. Boot must not continue past this line.\n`,
    );
    try {
      missionDb.close();
    } catch {
      /* the connection may already be gone */
    }
    process.exit(1);
  }
  const after = ledgerCount();
  const fkAfter = foreignKeyState();
  if (applied.length === 0) {
    process.stdout.write(`[mission-migrate] up to date — all ${total} migration files are applied; nothing to do.\n`);
  } else {
    for (const file of applied) process.stdout.write(`[mission-migrate] applied ${file}\n`);
    process.stdout.write(`[mission-migrate] applied ${applied.length} of ${total} files in this run.\n`);
  }
  process.stdout.write(
    `[mission-migrate] ledger after: ${after === null ? 'unreadable' : `${after}/${total}`}; foreign keys after: ${fkAfter}` +
      `${after !== null && after < total ? ' — INCOMPLETE: some files are still unrecorded' : ''}\n`,
  );
  missionDb.close();
}

try {
  main();
} catch (error) {
  // Any throw that is not the migration loop itself (an unreadable directory, a dead
  // connection) is still a failed boot, and it must say so instead of exiting 0.
  process.stderr.write(`[mission-migrate] FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
}
