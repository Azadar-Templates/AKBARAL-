/**
 * AKBARAL! / MASTER AI — backup restore CLI (Milestone 10).
 *
 * Usage: node dist/src/scripts/restore-db.js <backup-file.db> [safetyDir]
 *
 * Refuses to restore anything that fails verification (integrity check +
 * row-count comparison). Takes a safety snapshot of the current database
 * before replacing it. The process must be restarted after a restore.
 */
import { restoreVerifiedBackup } from './backup-db';
import { db } from '../db';

const backupFile = process.argv[2];
if (!backupFile) {
  console.error('[akbaral] usage: restore-db <backup-file.db> [safetyDir]');
  process.exit(2);
}

try {
  const result = restoreVerifiedBackup({ backupFile, safetyDir: process.argv[3] ?? 'backups/pre-restore' });
  console.log(
    `[akbaral] restore OK from ${result.restoredFrom} (safety snapshot: ${result.safetyBackup}; ` +
      `rows ${JSON.stringify(result.rowCounts)}). Restart the server now.`,
  );
  process.exit(0);
} catch (error) {
  console.error(`[akbaral] restore FAILED: ${error instanceof Error ? error.message : String(error)}`);
  try {
    db.close();
  } catch {
    // already closed by the restore attempt
  }
  process.exit(1);
}
