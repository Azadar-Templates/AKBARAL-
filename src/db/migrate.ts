import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Database } from './database';

export const MIGRATIONS_DIR = path.resolve(process.cwd(), 'db', 'migrations');
const args = process.argv.slice(2);
const statusOnly = args.includes('--status');

interface MigrationRecord {
  name: string;
  checksum: string;
  applied_at: string;
}

function ensureMigrationTable(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function listMigrationFiles(): string[] {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  return files;
}

export function applyMigrations(database: Database): string[] {
  ensureMigrationTable(database);

  const applied = new Map(
    database
      .all<MigrationRecord>('SELECT name, checksum, applied_at FROM _migrations ORDER BY name')
      .map((row) => [row.name, row]),
  );

  const appliedNow: string[] = [];

  for (const file of listMigrationFiles()) {
    const existing = applied.get(file);

    if (existing) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const fileChecksum = checksum(sql);
      if (existing.checksum !== fileChecksum) {
        throw new Error(
          `migration ${file} was applied with a different checksum; ` +
            `the migration file appears to have been modified after deployment. ` +
            'Create a new migration instead of editing an applied one.',
        );
      }
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const fileChecksum = checksum(sql);

    database.transaction((tx) => {
      tx.exec(sql);
      tx.run('INSERT INTO _migrations (name, checksum) VALUES (?, ?)', [file, fileChecksum]);
    });

    appliedNow.push(file);
  }

  return appliedNow;
}

export function printStatus(database: Database): void {
  ensureMigrationTable(database);
  const appliedRecords = database.all<MigrationRecord>(
    'SELECT name, checksum, applied_at FROM _migrations ORDER BY name',
  );
  const appliedNames = new Set(appliedRecords.map((row) => row.name));
  const files = listMigrationFiles();

  console.log(`migration directory: ${MIGRATIONS_DIR}`);
  console.log(`database:            ${database.filePath}`);
  console.log('');
  console.log('applied migrations:');

  for (const record of appliedRecords) {
    console.log(`  [applied] ${record.name} (${record.applied_at})`);
  }

  console.log('');
  console.log('pending migrations:');
  const pending = files.filter((file) => !appliedNames.has(file));
  if (pending.length === 0) {
    console.log('  (none)');
  } else {
    for (const file of pending) {
      console.log(`  [pending] ${file}`);
    }
  }
}

export function runMigrate(): void {
  const database = new Database();
  try {
    if (statusOnly) {
      printStatus(database);
      return;
    }

    const appliedNow = applyMigrations(database);
    if (appliedNow.length === 0) {
      console.log(`[db:migrate] database is up to date (${database.filePath})`);
      return;
    }

    for (const name of appliedNow) {
      console.log(`[db:migrate] applied ${name}`);
    }
    console.log(`[db:migrate] total applied this run: ${appliedNow.length}`);
  } finally {
    database.close();
  }
}

if (require.main === module) {
  runMigrate();
}
