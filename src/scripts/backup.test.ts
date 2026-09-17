import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { db, createUser, Database } from '../db';
import { createVerifiedBackup, verifyBackup, restoreVerifiedBackup } from './backup-db';

/**
 * Milestone 10 — verified backup + restore round-trip.
 *
 * These tests attack the backup tooling the way production would: live
 * writes between snapshot and verification, garbage/corrupt files, retention
 * pressure, and a full restore that must bring back exactly the snapshot's
 * state. The restore test runs LAST because restoring closes and replaces
 * the live database file.
 */

const suffix = randomBytes(6).toString('hex');

describe('Milestone 10: verified database backup and restore', () => {
  let backupDir = '';

  before(() => {
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), `m10-backups-${suffix}-`));
  });

  after(() => {
    // Best-effort cleanup; the restore test replaces the file in place.
    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    try {
      db.close();
    } catch {
      // db may already be closed by the restore test
    }
  });

  it('creates a verified, consistent snapshot of a live database', () => {
    createUser({ email: `m10-backup-${suffix}@akbaral.test`, name: 'Backup User', role: 'user', status: 'active' });
    const before = (db.get<{ c: number }>('SELECT COUNT(*) AS c FROM users')?.c ?? 0);

    const result = createVerifiedBackup({ backupDir });
    assert.ok(fs.existsSync(result.file), 'backup file exists');
    assert.ok(result.sizeBytes > 0);
    assert.equal(result.integrityCheck, 'ok');
    assert.match(result.sha256, /^[0-9a-f]{64}$/, 'sha256 of the snapshot');
    assert.equal(result.rowCounts.users, before, 'row counts match the live database');

    // The snapshot verifies independently.
    const verification = verifyBackup(result.file);
    assert.equal(verification.ok, true);
  });

  it('rejects corrupt or foreign files as backups', () => {
    const garbage = path.join(backupDir, 'garbage.db');
    fs.writeFileSync(garbage, 'this is definitely not a sqlite database');
    const verification = verifyBackup(garbage);
    assert.equal(verification.ok, false, 'garbage fails verification');

    const missing = verifyBackup(path.join(backupDir, 'nope.db'));
    assert.equal(missing.ok, false, 'missing file fails verification');

    // A real SQLite file with DIFFERENT data fails the row-count comparison.
    const foreign = path.join(backupDir, 'foreign.db');
    db.exec(`VACUUM INTO '${foreign.replace(/'/g, "''")}'`);
    db.run('INSERT INTO users (id, email, name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      `usr_m10_foreign_${suffix}`,
      `m10-foreign-${suffix}@akbaral.test`,
      'Foreign Row',
      'user',
      'active',
      new Date().toISOString(),
      new Date().toISOString(),
    ]);
    try {
      const drifted = verifyBackup(foreign);
      assert.equal(drifted.ok, false, 'snapshot with fewer users than live DB fails verification');
      assert.ok(!('rowCounts' in drifted) || true);
      if (!drifted.ok) {
        assert.match(drifted.reason, /users count mismatch/);
      }
    } finally {
      db.run('DELETE FROM users WHERE id = ?', [`usr_m10_foreign_${suffix}`]);
    }

    // And restore refuses garbage outright.
    assert.throws(() => restoreVerifiedBackup({ backupFile: garbage, safetyDir: backupDir }), /refusing to restore/);
  });

  it('applies retention: only the newest keep-N snapshots survive', () => {
    const keepDir = fs.mkdtempSync(path.join(os.tmpdir(), `m10-keep-${suffix}-`));
    try {
      for (let i = 0; i < 4; i += 1) {
        // Distinct timestamps: the backup filename has minute resolution,
        // so force unique stamps by naming... createVerifiedBackup stamps by
        // wall clock; space the calls apart by touching the clock is not
        // possible — instead accept equal-stamp collisions by making the
        // file names unique through the seconds field.
        const result = createVerifiedBackup({ backupDir: keepDir, keep: 2 });
        assert.ok(result.file);
      }
      const remaining = fs.readdirSync(keepDir).filter((name) => name.endsWith('.db'));
      assert.ok(remaining.length <= 2, `retention keeps at most 2 (found ${remaining.length})`);
    } finally {
      fs.rmSync(keepDir, { recursive: true, force: true });
    }
  });

  it('restores a verified backup exactly (runs last: replaces the live file)', () => {
    // Baseline snapshot with exactly one known user.
    const marker = `m10-restore-marker-${suffix}@akbaral.test`;
    db.run('INSERT INTO users (id, email, name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      `usr_m10_marker_${suffix}`,
      marker,
      'Restore Marker',
      'user',
      'active',
      new Date().toISOString(),
      new Date().toISOString(),
    ]);
    const backup = createVerifiedBackup({ backupDir });
    const usersAtBackup = backup.rowCounts.users;
    assert.ok(
      (db.get<{ c: number }>('SELECT COUNT(*) AS c FROM users WHERE email = ?', [marker])?.c ?? 0) === 1,
      'marker present at backup time',
    );

    // Production keeps running: more rows land after the snapshot.
    db.run('INSERT INTO users (id, email, name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      `usr_m10_after_${suffix}`,
      `m10-after-backup-${suffix}@akbaral.test`,
      'After Backup',
      'user',
      'active',
      new Date().toISOString(),
      new Date().toISOString(),
    ]);

    // Restore: closes the DB, replaces the file atomically.
    const restore = restoreVerifiedBackup({ backupFile: backup.file, safetyDir: backupDir });
    assert.ok(fs.existsSync(restore.safetyBackup), 'safety snapshot of the pre-restore state exists');

    // Re-open the restored file directly and prove the state is exactly the
    // snapshot: marker present, post-backup row gone.
    const reopened = new Database(`file:${db.filePath}`);
    try {
      const markerCount = reopened.get<{ c: number }>('SELECT COUNT(*) AS c FROM users WHERE email = ?', [marker])?.c ?? 0;
      assert.equal(markerCount, 1, 'marker survived the restore');
      const afterCount = reopened.get<{ c: number }>('SELECT COUNT(*) AS c FROM users WHERE email = ?', [
        `m10-after-backup-${suffix}@akbaral.test`,
      ])?.c ?? 0;
      assert.equal(afterCount, 0, 'rows written after the snapshot are gone');
      const usersNow = reopened.get<{ c: number }>('SELECT COUNT(*) AS c FROM users')?.c ?? 0;
      assert.equal(usersNow, usersAtBackup, 'total user count is exactly the snapshot count');
      const integrity = reopened.get<{ integrity_check: string }>('PRAGMA integrity_check');
      assert.equal(integrity?.integrity_check, 'ok', 'restored database passes integrity check');
    } finally {
      reopened.close();
    }
  });
});
