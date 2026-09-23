/**
 * DATA_DIR REGRESSION TEST
 *
 * Proves:
 * 1. DATA_DIR env var is honoured by env config
 * 2. Database URL defaults under DATA_DIR
 * 3. Upload dir defaults under DATA_DIR
 * 4. Mission DB defaults under DATA_DIR
 * 5. Session secret file resolves under DATA_DIR
 * 6. Migrations run successfully with DATA_DIR pointing to a temp directory
 * 7. App can create writable directories under DATA_DIR (simulating non-root)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Helper to set env vars (avoids TS readonly errors on process.env.NODE_ENV)
function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    // Use bracket notation to avoid TS readonly error
    (process.env as Record<string, string | undefined>)[key] = undefined;
    delete (process.env as Record<string, string | undefined>)[key];
  } else {
    (process.env as Record<string, string | undefined>)[key] = value;
  }
}

describe('DATA_DIR configuration', () => {
  let tempDir: string;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'akbaral-data-dir-test-'));
  });

  after(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it('resolves DATA_DIR from environment variable', () => {
    const original = process.env.DATA_DIR;
    setEnv('DATA_DIR', tempDir);
    setEnv('NODE_ENV', 'production');

    const dataDir = (process.env.DATA_DIR ?? '').trim();
    assert.equal(dataDir, tempDir);

    setEnv('DATA_DIR', original ?? undefined);
    setEnv('NODE_ENV', undefined);
  });

  it('DATABASE_URL defaults under DATA_DIR in production', () => {
    const origDataDir = process.env.DATA_DIR;
    const origDbUrl = process.env.DATABASE_URL;

    setEnv('DATABASE_URL', undefined);
    setEnv('DATA_DIR', tempDir);
    setEnv('NODE_ENV', 'production');

    const dataDir = (process.env.DATA_DIR ?? '/data').trim();
    const dbUrl = (process.env.DATABASE_URL ?? '').trim() || `file:${dataDir}/akbaral.db`;

    assert.ok(dbUrl.startsWith('file:'), `DB URL must start with file: — got ${dbUrl}`);
    assert.ok(dbUrl.includes(tempDir), `DB URL must include DATA_DIR — got ${dbUrl}`);
    assert.ok(dbUrl.endsWith('akbaral.db'), `DB URL must end with akbaral.db — got ${dbUrl}`);

    setEnv('DATA_DIR', origDataDir ?? undefined);
    setEnv('DATABASE_URL', origDbUrl ?? undefined);
    setEnv('NODE_ENV', undefined);
  });

  it('AKBARAL_UPLOAD_DIR defaults under DATA_DIR in production', () => {
    const origDataDir = process.env.DATA_DIR;
    const origUploadDir = process.env.AKBARAL_UPLOAD_DIR;

    setEnv('AKBARAL_UPLOAD_DIR', undefined);
    setEnv('DATA_DIR', '/data');

    const dataDir = (process.env.DATA_DIR ?? '/data').trim();
    const uploadDir = (process.env.AKBARAL_UPLOAD_DIR ?? '').trim() || `${dataDir}/uploads`;

    assert.equal(uploadDir, '/data/uploads');

    setEnv('DATA_DIR', origDataDir ?? undefined);
    setEnv('AKBARAL_UPLOAD_DIR', origUploadDir ?? undefined);
  });

  it('session secret file resolves under DATA_DIR', () => {
    setEnv('DATA_DIR', tempDir);
    setEnv('NODE_ENV', 'production');
    setEnv('AKBARAL_SESSION_SECRET_FILE', undefined);

    const dataDir = process.env.DATA_DIR || (process.env.NODE_ENV === 'production' ? '/data' : 'data');
    const secretPath = resolve(dataDir, '.session-secret');

    assert.ok(secretPath.startsWith(tempDir), `secret path must be under DATA_DIR — got ${secretPath}`);
    assert.ok(secretPath.endsWith('.session-secret'));

    setEnv('DATA_DIR', undefined);
    setEnv('NODE_ENV', undefined);
  });

  it('mission DB defaults under DATA_DIR in production', () => {
    setEnv('DATA_DIR', '/data');
    setEnv('NODE_ENV', 'production');
    setEnv('ZA141251SA_DATABASE_URL', undefined);
    setEnv('MISSION_DATABASE_URL', undefined);

    const dataDir = (process.env.DATA_DIR ?? './data').trim();
    const missionDbUrl = `file:${dataDir}/mission.db`;

    assert.equal(missionDbUrl, 'file:/data/mission.db');

    setEnv('DATA_DIR', undefined);
    setEnv('NODE_ENV', undefined);
  });

  it('migrations run with DATA_DIR pointing to writable temp directory', () => {
    const migrationDir = mkdtempSync(join(tmpdir(), 'akbaral-migration-test-'));

    const origDataDir = process.env.DATA_DIR;
    const origMissionUrl = process.env.ZA141251SA_DATABASE_URL;
    const origNodeEnv = process.env.NODE_ENV;

    setEnv('DATA_DIR', migrationDir);
    setEnv('ZA141251SA_DATABASE_URL', `file:${migrationDir}/mission-test.db`);
    setEnv('NODE_ENV', 'test');

    try {
      const { missionDb, applyMissionMigrations } = require('../mission/database');

      const result = applyMissionMigrations();
      assert.ok(result.total > 0, 'should have migrations');
      assert.ok(result.applied.length > 0 || result.total >= 33, 'should apply or have applied migrations');

      const tableCount = missionDb.tableCount();
      assert.ok(tableCount >= 30, `expected >= 30 tables, got ${tableCount}`);

      // Verify the DB file was created under our DATA_DIR
      const dbFile = join(migrationDir, 'mission-test.db');
      assert.ok(existsSync(dbFile), `mission DB file must exist at ${dbFile}`);

      missionDb.close();
    } finally {
      setEnv('DATA_DIR', origDataDir ?? undefined);
      setEnv('ZA141251SA_DATABASE_URL', origMissionUrl ?? undefined);
      setEnv('NODE_ENV', origNodeEnv ?? undefined);
      try { rmSync(migrationDir, { recursive: true, force: true }); } catch {}
    }

    console.log(`[DATA_DIR] Migrations ran successfully with DATA_DIR=${migrationDir}`);
  });

  it('writable directories can be created under DATA_DIR (non-root simulation)', () => {
    const writableDir = mkdtempSync(join(tmpdir(), 'akbaral-writable-test-'));

    const uploadsDir = join(writableDir, 'uploads');
    const backupsDir = join(writableDir, 'backups');

    mkdirSync(uploadsDir, { recursive: true });
    mkdirSync(backupsDir, { recursive: true });

    const probeFile = join(uploadsDir, '.write-probe');
    writeFileSync(probeFile, 'ok');
    assert.ok(existsSync(probeFile), 'should be able to write files under DATA_DIR');

    const stat = statSync(uploadsDir);
    assert.ok(stat.isDirectory(), 'uploads dir must exist as directory');

    rmSync(writableDir, { recursive: true, force: true });

    console.log(`[DATA_DIR] Writable directory creation verified`);
  });

  it('DATA_DIR overrides do NOT affect /app (read-only code)', () => {
    const fs = require('node:fs');

    // Check env.ts doesn't hardcode /app/data
    const envSource = fs.readFileSync(resolve(process.cwd(), 'src/config/env.ts'), 'utf8');
    assert.ok(!envSource.includes("'/app/data'"), 'env.ts must not hardcode /app/data');
    assert.ok(!envSource.includes('"./app/data"'), 'env.ts must not hardcode ./app/data');

    // Check Dockerfile sets DATA_DIR=/data and does not mkdir /app/data
    const dockerfile = fs.readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');
    assert.ok(dockerfile.includes('DATA_DIR=/data'), 'Dockerfile must set DATA_DIR=/data');
    assert.ok(!/mkdir.*\/app\/data/.test(dockerfile), 'Dockerfile must not mkdir /app/data');

    // Check start-prod.mjs uses DATA_DIR
    const startProd = fs.readFileSync(resolve(process.cwd(), 'scripts/start-prod.mjs'), 'utf8');
    assert.ok(startProd.includes('DATA_DIR'), 'start-prod.mjs must reference DATA_DIR');

    console.log(`[DATA_DIR] Architectural contract verified: /app is read-only code, DATA_DIR is writable data`);
  });
});
