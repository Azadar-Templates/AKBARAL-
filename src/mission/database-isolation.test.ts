import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(run: (directory: string) => void): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-isolation-'));
  try { run(directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function child(directory: string, databaseUrl: string, args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', ...args], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 15_000,
    env: {
      ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl,
      ZA141251SA_DATABASE_URL: `file:${path.join(directory, 'private.db')}`,
      ZA141251SA_OWNER_EMAIL: '', ZA141251SA_OWNER_PASSWORD: '',
      ZA141251SA_SESSION_SECRET: '', ZA141251SA_CREDENTIAL_KEY: '',
    },
  });
}

it('standalone mission bootstrap works when the customer database cannot be opened', () => fixture(directory => {
  const blocker = path.join(directory, 'not-a-directory');
  fs.writeFileSync(blocker, 'customer database path is deliberately unavailable');
  const result = child(directory, `file:${path.join(blocker, 'customer.db')}`, ['scripts/mission-init.ts']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /audit chain\.+\s+verified/);
  assert.match(result.stdout, /ledger chain\.+\s+verified/);
  assert.ok(fs.existsSync(path.join(directory, 'private.db')));
  assert.equal(fs.readFileSync(blocker, 'utf8'), 'customer database path is deliberately unavailable');
}));

it('importing the private server and migrating never creates a customer database', () => fixture(directory => {
  const customer = path.join(directory, 'customer', 'must-not-exist.db');
  const result = child(directory, `file:${customer}`, ['-e', `
    require('./src/mission/server.ts');
    const { applyMissionMigrations, missionDb } = require('./src/mission/database.ts');
    const result = applyMissionMigrations();
    if (result.total < 15) throw new Error('mission migrations missing');
    missionDb.close();
  `]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.dirname(customer)), false, 'no customer connection side effects');
}));

it('a private SQLite mission never starts a configured customer PostgreSQL worker', () => fixture(directory => {
  const result = child(directory, 'postgres://127.0.0.1:1/customer-unavailable', ['-e', `
    const RealWorker = require('node:worker_threads').Worker;
    require('node:worker_threads').Worker = class {
      constructor(workerPath, options) {
        if (require('node:path').basename(String(workerPath)) === 'pg-worker.mjs') throw new Error('customer PostgreSQL worker was started');
        return new RealWorker(workerPath, options);
      }
    };
    require('./src/mission/server.ts');
    const { applyMissionMigrations, missionDb } = require('./src/mission/database.ts');
    applyMissionMigrations();
    missionDb.close();
  `]);
  assert.equal(result.status, 0, result.stderr);
}));
