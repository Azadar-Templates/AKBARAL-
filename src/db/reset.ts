import fs from 'node:fs';
import { Database } from './database';
import { applyMigrations } from './migrate';
import { resolveDatabasePath } from './path';

/**
 * SQLite development reset.
 *
 * Deletes the local database file (and its WAL/SHM sidecars), then applies all
 * migrations from scratch. Intended for development; do not run against a
 * production database.
 */
function resetDatabase(): void {
  const filePath = resolveDatabasePath();
  if (filePath === ':memory:') {
    throw new Error('cannot reset an in-memory database');
  }

  for (const file of [filePath, `${filePath}-wal`, `${filePath}-shm`, `${filePath}-journal`]) {
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
    }
  }

  const database = new Database();
  try {
    const applied = applyMigrations(database);
    // Log the resolved file path only; never echo DATABASE_URL (it may contain
    // a custom user/password in future connection formats).
    console.log(`[db:reset] removed ${filePath}`);
    console.log(`[db:reset] recreated schema (${applied.join(', ')})`);
  } finally {
    database.close();
  }
}

resetDatabase();
