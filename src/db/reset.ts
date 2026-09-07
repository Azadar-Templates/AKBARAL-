import fs from 'node:fs';
import { Database } from './database';
import { applyMigrations } from './migrate';
import { resolveDatabasePath } from './path';
import { env } from '../config/env';

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
    console.log(`[db:reset] removed ${filePath}`);
    console.log(`[db:reset] recreated schema (${applied.join(', ')})`);
    console.log(`[db:reset] database url: ${env.databaseUrl}`);
  } finally {
    database.close();
  }
}

resetDatabase();
