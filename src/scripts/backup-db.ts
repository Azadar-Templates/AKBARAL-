/**
 * AKBARAL! / MASTER AI — safe SQLite backup tooling (Milestone 10).
 *
 * The previous scripts/backup.sh copied the database file with `cp` while
 * the server could be mid-transaction — a backup that can be silently
 * corrupt. These functions use SQLite's own online backup mechanism
 * (`VACUUM INTO`), which produces a transactionally consistent snapshot
 * even while the database is in use, then VERIFY the result (integrity
 * check + row-count comparison against the live database) before declaring
 * success. No unverified backup is ever reported as good.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { db, Database } from '../db';

export interface BackupResult {
  file: string;
  sizeBytes: number;
  sha256: string;
  integrityCheck: string;
  rowCounts: Record<string, number>;
}

/** Tables whose row counts are compared between live database and backup. */
const VERIFIED_TABLES = ['users', 'tasks', 'agents', 'invoices', 'credit_transactions', 'projects'] as const;

function sqliteStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function liveRowCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of VERIFIED_TABLES) {
    counts[table] = db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)?.c ?? 0;
  }
  return counts;
}

/**
 * Create a verified, consistent backup of the configured database into
 * `backupDir` and apply a retention policy (keep the newest `keep` files).
 */
export function createVerifiedBackup(options: { backupDir: string; keep?: number }): BackupResult {
  const backupDir = path.resolve(options.backupDir);
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `akbaral-${stamp}.db`);

  // Online-safe snapshot: VACUUM INTO runs a consistent copy including all
  // committed transactions (WAL content included) while writers continue.
  db.exec(`VACUUM INTO ${sqliteStringLiteral(target)}`);

  // Verify BEFORE reporting success: open the snapshot independently and
  // prove integrity plus identical row counts.
  const verification = verifyBackup(target);
  if (!verification.ok) {
    try {
      fs.unlinkSync(target);
    } catch {
      // leave the artifact for inspection if deletion fails
    }
    throw new Error(`backup verification failed for ${target}: ${verification.reason}`);
  }

  const sizeBytes = fs.statSync(target).size;
  const sha256 = hashFile(target);

  // Retention: keep only the newest `keep` akbaral-*.db backups.
  const keep = options.keep ?? 30;
  const backups = fs
    .readdirSync(backupDir)
    .filter((name) => /^akbaral-\d{4}-\d{2}-\d{2}T.*\.db$/.test(name))
    .sort();
  for (const stale of backups.slice(0, Math.max(0, backups.length - keep))) {
    try {
      fs.unlinkSync(path.join(backupDir, stale));
    } catch {
      // retention is best-effort; never fail a good backup over pruning
    }
  }

  return {
    file: target,
    sizeBytes,
    sha256,
    integrityCheck: 'ok',
    rowCounts: verification.rowCounts,
  };
}

export function verifyBackup(file: string): { ok: true; rowCounts: Record<string, number> } | { ok: false; reason: string } {
  if (!fs.existsSync(file)) {
    return { ok: false, reason: 'file does not exist' };
  }
  const integrity = verifyBackupIntegrity(file);
  if (!integrity.ok) {
    return integrity;
  }
  // Drift detection (backup time): the snapshot must match the live
  // database it was just taken from.
  const live = liveRowCounts();
  for (const table of VERIFIED_TABLES) {
    if (integrity.rowCounts[table] !== live[table]) {
      return { ok: false, reason: `${table} count mismatch: backup=${integrity.rowCounts[table]} live=${live[table]}` };
    }
  }
  return { ok: true, rowCounts: integrity.rowCounts };
}

/**
 * Integrity-only verification (restore time): proves the snapshot is a
 * structurally valid, complete database WITHOUT comparing it to the live
 * database — at restore time the live database has legitimately diverged
 * from the snapshot (that is the whole reason for restoring).
 */
export function verifyBackupIntegrity(file: string): { ok: true; rowCounts: Record<string, number> } | { ok: false; reason: string } {
  if (!fs.existsSync(file)) {
    return { ok: false, reason: 'file does not exist' };
  }
  let raw: Database | null = null;
  try {
    // Open the snapshot independently (read path: no writers on the copy).
    raw = new Database(`file:${path.resolve(file)}`);
    const integrity = raw.get<{ integrity_check: string }>('PRAGMA integrity_check');
    if (integrity?.integrity_check !== 'ok') {
      return { ok: false, reason: `integrity_check: ${integrity?.integrity_check ?? 'unknown'}` };
    }
    const rowCounts: Record<string, number> = {};
    for (const table of VERIFIED_TABLES) {
      const row = raw.get<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`);
      if (!row) {
        return { ok: false, reason: `cannot count ${table}` };
      }
      rowCounts[table] = row.c;
    }
    return { ok: true, rowCounts };
  } catch (error) {
    // Not a database, unreadable, corrupt header — anything that cannot be
    // opened and proven is NOT a restorable backup.
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    try {
      raw?.close();
    } catch {
      // already closed / never opened
    }
  }
}

function hashFile(file: string): string {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

/**
 * Restore a verified backup over the configured database.
 *
 * Safety order: verify the backup first (never restore a corrupt file),
 * take a safety snapshot of the current database, then atomically replace
 * the live file. The caller should restart the process afterwards so all
 * prepared statements are rebuilt against the restored file.
 */
export function restoreVerifiedBackup(options: { backupFile: string; safetyDir: string }): {
  restoredFrom: string;
  safetyBackup: string;
  rowCounts: Record<string, number>;
} {
  const backupFile = path.resolve(options.backupFile);
  // Integrity-only verification: the live database has moved on since the
  // snapshot was taken; only the snapshot's own validity matters here.
  const verification = verifyBackupIntegrity(backupFile);
  if (!verification.ok) {
    throw new Error(`refusing to restore unverified backup: ${verification.reason}`);
  }

  // Safety snapshot of the current database before overwriting it.
  const safetyDir = path.resolve(options.safetyDir);
  fs.mkdirSync(safetyDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safetyBackup = path.join(safetyDir, `pre-restore-${stamp}.db`);
  db.exec(`VACUUM INTO ${sqliteStringLiteral(safetyBackup)}`);

  // Resolve the live database file from the active connection's pragma.
  const liveFileRow = db.get<{ file: string }>('PRAGMA database_list');
  const liveFile = liveFileRow?.file;
  if (!liveFile || !path.isAbsolute(liveFile)) {
    throw new Error(`cannot resolve live database file (got ${String(liveFile)})`);
  }

  // Copy into a sibling temp file, then rename over the live file so a
  // crash mid-copy never leaves a half-written database in place.
  const tempTarget = `${liveFile}.restore-${process.pid}.tmp`;
  fs.copyFileSync(backupFile, tempTarget);
  db.close();
  fs.renameSync(tempTarget, liveFile);
  // Defensive: if the previous database ever ran in WAL mode, stale
  // sidecar files must not be replayed over the restored snapshot.
  for (const sidecar of [`${liveFile}-wal`, `${liveFile}-shm`]) {
    try {
      fs.unlinkSync(sidecar);
    } catch {
      // absent (normal case: journal_mode=delete)
    }
  }

  return { restoredFrom: backupFile, safetyBackup, rowCounts: verification.rowCounts };
}

// ---------------------------------------------------------------------------
// CLI entrypoint: node dist/src/scripts/backup-db.js [backupDir] [keep]
// ---------------------------------------------------------------------------

const isDirectRun = process.argv[1] !== undefined && /backup-db\.(ts|js)$/.test(process.argv[1]);
if (isDirectRun) {
  try {
    const backupDir = process.argv[2] ?? 'backups';
    const keep = Number(process.argv[3] ?? 30);
    const result = createVerifiedBackup({ backupDir, keep: Number.isFinite(keep) ? keep : 30 });
    console.log(
      `[akbaral] backup OK: ${result.file} (${result.sizeBytes} bytes, sha256 ${result.sha256.slice(0, 16)}…, ` +
        `integrity ok, rows ${JSON.stringify(result.rowCounts)})`,
    );
    db.close();
    process.exit(0);
  } catch (error) {
    console.error(`[akbaral] backup FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
