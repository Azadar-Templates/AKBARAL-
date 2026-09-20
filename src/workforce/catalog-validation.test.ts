import { it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DATABASE_URL = `file:${path.join(os.tmpdir(), `catalog-validation-${process.pid}.db`)}`;
const { db } = require('../db') as typeof import('../db');
const { applyMigrations } = require('../db/migrate') as typeof import('../db/migrate');
const { seedPlatforms, countPlatforms } = require('./platforms') as typeof import('./platforms');
const fixture = path.join(os.tmpdir(), `catalog-validation-${process.pid}.json`);
after(() => { db.close(); fs.rmSync(fixture, { force: true }); });
it('catalog import refuses unknown, missing, rejected and malformed statuses rather than silently creating candidates', () => {
  applyMigrations(db);
  fs.writeFileSync(fixture, JSON.stringify([
    { name: 'Synthetic candidate fixture', status: 'candidate' },
    { name: 'Synthetic unreviewed fixture', status: 'unreviewed' },
    { name: 'Synthetic missing status fixture' },
    { name: 'Synthetic rejected fixture', status: 'rejected' },
    null,
    { name: 42, status: 'verified' },
  ]));
  const result = seedPlatforms(fixture);
  assert.equal(result.seeded, 1);
  assert.equal(result.skipped_rejected, 5);
  assert.equal(countPlatforms(), 1);
  assert.equal(db.get<{ status: string }>('SELECT status FROM economy_platforms')!.status, 'candidate');
  fs.writeFileSync(fixture, JSON.stringify({ rows: [] }));
  assert.throws(() => seedPlatforms(fixture), /must be an array/);
  assert.equal(countPlatforms(), 1);
});
