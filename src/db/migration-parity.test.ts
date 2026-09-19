import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { listMigrationFiles, resolveMigrationsDir } from './migrate';
import { translateSqlForPg } from './database';

describe('platform migration dialect parity', () => {
  it('ships every platform migration for both SQLite and PostgreSQL', () => {
    assert.deepEqual(
      listMigrationFiles(resolveMigrationsDir('postgres')),
      listMigrationFiles(resolveMigrationsDir('sqlite')),
      'a SQLite-only migration leaves Neon deployments behind; add its PostgreSQL twin',
    );
  });

  it('keeps workforce migration DDL equivalent across dialects', () => {
    // These additive migrations use only portable DDL and timestamp defaults.
    // Older migrations intentionally differ (FTS/triggers) and are integration-tested.
    const normalize = (sql: string): string => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
    for (const file of listMigrationFiles().filter((name) => /^(001[89]|002[01])_/.test(name))) {
      const sqlite = readFileSync(path.join(resolveMigrationsDir('sqlite'), file), 'utf8');
      const postgres = readFileSync(path.join(resolveMigrationsDir('postgres'), file), 'utf8');
      assert.equal(normalize(postgres), normalize(translateSqlForPg(sqlite)), file);
    }
  });
});
