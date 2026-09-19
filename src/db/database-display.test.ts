import { it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { missionDb } from '../mission/database';
import { displayDatabaseTarget } from './display-target';

// Synthetic, unreachable loopback URL; never a provider/production credential.
function fixtureUrl(): string {
  const url = new URL('postgresql://127.0.0.1:1/private');
  url.username = 'synthetic-display-user';
  url.password = 'synthetic-userinfo-secret';
  url.searchParams.set('password', 'synthetic-query-secret');
  url.searchParams.set('sslmode', 'disable');
  url.hash = 'synthetic-fragment-secret';
  return url.toString();
}

function assertRedacted(output: string): void {
  for (const value of ['synthetic-display-user', 'synthetic-userinfo-secret', 'synthetic-query-secret', 'synthetic-fragment-secret']) {
    assert.equal(output.includes(value), false, `diagnostic must not contain ${value}`);
  }
}

it('private bootstrap never logs connection credentials, including on connection failure', () => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/mission-init.ts'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: ':memory:', ZA141251SA_DATABASE_URL: fixtureUrl(),
      ZA141251SA_OWNER_EMAIL: '', ZA141251SA_OWNER_PASSWORD: '' },
  });
  assert.equal(child.error, undefined, 'loopback refusal must finish without a timeout');
  assert.equal(child.status, 1, 'bootstrap must not claim success for the unavailable database');
  assert.match(child.stdout, /database/);
  assertRedacted(child.stdout + child.stderr);
});

it('mission database diagnostics omit credentials in query parameters and fragments', () => {
  // Exercise the public diagnostic without connecting to any database.
  const instance = Object.assign(Object.create(Object.getPrototypeOf(missionDb)), {
    engine: 'postgres', target: fixtureUrl(),
  }) as typeof missionDb;
  assertRedacted(instance.path());
  assert.equal(instance.path(), 'postgresql://127.0.0.1:1/private');
});

it('shared driver diagnostics omit connection credentials without changing the connection target', () => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', '-e', `
    let connectionTarget;
    const RealWorker = require('node:worker_threads').Worker;
    require('node:worker_threads').Worker = class {
      constructor(workerPath, options) {
        if (require('node:path').basename(String(workerPath)) !== 'pg-worker.mjs') return new RealWorker(workerPath, options);
        connectionTarget = options.workerData.connectionString;
      }
      unref() {}
      postMessage() {}
      terminate() { return Promise.resolve(0); }
    };
    const { Database } = require('./src/db/driver.ts');
    Database.prototype.pgConnect = function () {};
    const db = new Database(process.env.SYNTHETIC_DISPLAY_URL);
    if (connectionTarget !== process.env.SYNTHETIC_DISPLAY_URL) throw new Error('connection target was changed');
    console.log(db.filePath);
    db.close();
  `], { cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: ':memory:', SYNTHETIC_DISPLAY_URL: fixtureUrl() } });
  assert.equal(child.status, 0, child.stderr);
  assertRedacted(child.stdout);
  assert.equal(child.stdout.trim(), 'postgresql://127.0.0.1:1/private');
});

it('display formatting preserves SQLite paths and memory targets', () => {
  for (const value of [':memory:', 'file:./private.db', '/private/with spaces.db']) {
    assert.equal(displayDatabaseTarget(value), value);
  }
});

it('display formatting handles encoded userinfo and IPv6 without exposing URL options', () => {
  const url = new URL('postgres://[::1]:5432/private');
  url.username = 'synthetic-display-user';
  url.password = 'synth: p@ ss?';
  url.searchParams.set('arbitrary_future_auth_option', 'synthetic-query-secret');
  assert.equal(displayDatabaseTarget(url.toString()), 'postgres://[::1]:5432/private');
});

it('malformed PostgreSQL targets fail redaction closed rather than echoing input', () => {
  for (const value of ['postgresql://' + 'synthetic-display-user:synthetic-userinfo-secret@[invalid', 'postgres:synthetic-userinfo-secret']) {
    assertRedacted(displayDatabaseTarget(value));
    assert.equal(displayDatabaseTarget(value), '[redacted PostgreSQL target]');
  }
});
