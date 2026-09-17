/**
 * AKBARAL! / MASTER AI — PostgreSQL backup & restore (production: Neon).
 *
 * The SQLite path (backup-db.ts) uses VACUUM INTO — a database-internal,
 * transactionally consistent snapshot. PostgreSQL's equivalent operational
 * standard is pg_dump: an online, consistent logical snapshot that can be
 * restored onto any PostgreSQL server. This module wraps pg_dump/psql with:
 *
 *   - credentials passed ONLY through the child environment (never argv,
 *     never logs — argv is visible in `ps` output on shared hosts)
 *   - plain SQL output (gzip-compressible, human-auditable, restorable
 *     with a single psql call — no custom-format tooling needed)
 *   - post-dump verification: the dump must contain COPY data for the
 *     core tables and a sane byte size before it is reported as good
 *     (no unverified backup is ever declared successful)
 *
 * Usage:
 *   node dist/src/scripts/backup-pg.js  [backupDir] [keep]
 *   node dist/src/scripts/restore-pg.js <dump.sql[.gz]>
 *
 * Requires postgresql-client in the runtime image (see Dockerfile).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { db } from '../db';

const VERIFIED_TABLES = ['users', 'tasks', 'agents', 'invoices', 'credit_transactions', 'projects', 'plans'];

/** Split a DATABASE_URL into child-process env vars (never argv). */
function pgEnv(databaseUrl: string): Record<string, string> {
  const parsed = new URL(databaseUrl);
  const env: Record<string, string> = {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGDATABASE: parsed.pathname.replace(/^\//, '') || 'postgres',
    PGUSER: decodeURIComponent(parsed.username || 'postgres'),
    PGPASSWORD: decodeURIComponent(parsed.password || ''),
    PGSSLMODE: 'require',
  };
  const sslmode = parsed.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

export function createVerifiedPgBackup(options: { backupDir: string; keep?: number; databaseUrl: string }): {
  file: string;
  sizeBytes: number;
  sha256: string;
  tablesVerified: string[];
} {
  fs.mkdirSync(options.backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(options.backupDir, `akbaral-pg-${stamp}.sql`);

  // pg_dump: online, consistent, plain SQL.
  const dump = spawnSync(
    'pg_dump',
    ['--no-owner', '--no-privileges', '--file', file, '--dbname', 'dbname=akbaral'],
    { env: { ...process.env, ...pgEnv(options.databaseUrl) }, encoding: 'utf8' },
  );
  if (dump.status !== 0 || !fs.existsSync(file)) {
    throw new Error(`pg_dump failed: ${String(dump.stderr || dump.error).slice(0, 300)}`);
  }

  const sql = fs.readFileSync(file, 'utf8');
  const tablesVerified = VERIFIED_TABLES.filter((t) => new RegExp(`COPY [^\\n]*\\b${t}\\b`, 'i').test(sql));
  const missing = VERIFIED_TABLES.filter((t) => !tablesVerified.includes(t));
  if (missing.length > 0) {
    throw new Error(`backup verification failed: no COPY data for ${missing.join(', ')} (dump may be partial)`);
  }

  const sizeBytes = fs.statSync(file).size;
  if (sizeBytes < 1024) {
    throw new Error('backup verification failed: dump suspiciously small');
  }
  const sha256 = createHash('sha256').update(sql).digest('hex');

  // Retention (same policy as the SQLite path).
  const keep = options.keep ?? 30;
  const dumps = fs
    .readdirSync(options.backupDir)
    .filter((f) => f.startsWith('akbaral-pg-') && f.endsWith('.sql'))
    .sort();
  for (const old of dumps.slice(0, Math.max(0, dumps.length - keep))) {
    fs.rmSync(path.join(options.backupDir, old), { force: true });
  }

  return { file, sizeBytes, sha256, tablesVerified };
}

export function restorePgBackup(options: { dumpFile: string; databaseUrl: string }): {
  restoredFrom: string;
  preRestoreSafetyFile: string;
} {
  if (!fs.existsSync(options.dumpFile)) {
    throw new Error(`dump file not found: ${options.dumpFile}`);
  }

  // Safety snapshot of the CURRENT database before overwriting it.
  const safetyDir = path.join(path.dirname(options.dumpFile), 'pre-restore');
  const safety = createVerifiedPgBackup({ backupDir: safetyDir, keep: 5, databaseUrl: options.databaseUrl });

  const restore = spawnSync(
    'psql',
    ['--dbname', 'dbname=akbaral', '--file', options.dumpFile, '--quiet', '--set', 'ON_ERROR_STOP=1'],
    { env: { ...process.env, ...pgEnv(options.databaseUrl) }, encoding: 'utf8' },
  );
  if (restore.status !== 0) {
    throw new Error(
      `restore failed (a pre-restore safety snapshot was taken at ${safety.file}): ${String(restore.stderr || restore.error).slice(0, 300)}`,
    );
  }

  return { restoredFrom: options.dumpFile, preRestoreSafetyFile: safety.file };
}

// ---------------------------------------------------------------------------
// CLI: node dist/src/scripts/backup-pg.js [backupDir] [keep]
// ---------------------------------------------------------------------------
const isDirectRun = process.argv[1] !== undefined && /backup-pg\.(ts|js)$/.test(process.argv[1]);
if (isDirectRun) {
  try {
    if (db.engine !== 'postgres') {
      throw new Error('backup-pg requires DATABASE_URL to be a postgres:// URL');
    }
    const backupDir = process.argv[2] ?? 'backups';
    const keep = Number(process.argv[3] ?? 30);
    const result = createVerifiedPgBackup({
      backupDir,
      keep: Number.isFinite(keep) ? keep : 30,
      databaseUrl: process.env.DATABASE_URL ?? '',
    });
    console.log(
      `[akbaral] pg backup OK: ${result.file} (${result.sizeBytes} bytes, sha256 ${result.sha256.slice(0, 16)}…, ` +
        `verified COPY data for ${result.tablesVerified.length} core tables)`,
    );
    db.close();
    process.exit(0);
  } catch (error) {
    console.error(`[akbaral] pg backup FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
