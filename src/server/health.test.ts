import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { createApiServer, type ApiServer } from '../app';
import { db } from '../db';
import { checkMigrationsCurrent } from './health';

/**
 * Milestone 10 — liveness/readiness/metrics verification.
 *
 * The probes and the Prometheus endpoint are exercised against the real
 * in-process API (same middleware stack as production), and the migration
 * check is unit-tested against real directories on disk.
 */

const suffix = randomBytes(6).toString('hex');
const password = 'correct-horse-battery-staple';

describe('Milestone 10: health, readiness and metrics', () => {
  let api: ApiServer;
  let baseUrl = '';
  let adminToken = '';
  let userToken = '';
  let adminId = '';

  before(async () => {
    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;

    const registerAndLogin = async (label: string): Promise<{ id: string; token: string }> => {
      const email = `m10-${label}-${suffix}@akbaral.test`;
      const registered = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: `M10 ${label}` }),
      });
      assert.equal(registered.status, 201);
      const body = (await registered.json()) as { user: { id: string } };
      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(loginResponse.status, 200);
      const loginBody = (await loginResponse.json()) as { accessToken: string };
      return { id: body.user.id, token: loginBody.accessToken };
    };

    const admin = await registerAndLogin('admin');
    adminId = admin.id;
    adminToken = admin.token;
    db.run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminId]);
    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `m10-admin-${suffix}@akbaral.test`, password }),
    });
    adminToken = ((await adminLogin.json()) as { accessToken: string }).accessToken;

    const user = await registerAndLogin('user');
    userToken = user.token;
  });

  after(async () => {
    db.run('DELETE FROM users WHERE email LIKE ?', [`m10-%${suffix}@akbaral.test`]);
    db.close();
    await api.close();
  });

  it('liveness probe actually checks the database (no fake ok)', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status: string; checks: Array<{ name: string; ok: boolean }>; uptimeSeconds: number };
    assert.equal(body.status, 'ok');
    const database = body.checks.find((check) => check.name === 'database');
    assert.ok(database, 'database check present');
    assert.equal(database.ok, true, 'database check actually ran');
    assert.ok(body.uptimeSeconds >= 0);
  });

  it('readiness probe verifies database, migrations, uploads and queue worker', async () => {
    const response = await fetch(`${baseUrl}/api/ready`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status: string; checks: Array<{ name: string; ok: boolean }> };
    assert.equal(body.status, 'ready');
    const names = body.checks.map((check) => check.name).sort();
    assert.deepEqual(names, ['database', 'execution_queue', 'migrations', 'uploads']);
    for (const check of body.checks) {
      assert.ok(check.ok, `${check.name} is ready`);
    }
  });

  it('migration check fails honestly when migrations are pending', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm10-migrations-'));
    try {
      // Empty dir: nothing pending, nothing applied -> current.
      assert.ok(checkMigrationsCurrent(tempDir).ok, 'empty migrations dir is current');

      // A file that was never applied -> pending, not ready.
      fs.writeFileSync(path.join(tempDir, '9999_pending_test.sql'), '-- not applied yet\n');
      const check = checkMigrationsCurrent(tempDir);
      assert.equal(check.ok, false);
      assert.ok(String(check.detail).includes('9999_pending_test.sql'), 'pending file is named');

      // Once "applied" (recorded in _migrations), the check passes again.
      db.run('INSERT INTO _migrations (name, checksum, applied_at) VALUES (?, ?, ?)', [
        '9999_pending_test.sql',
        '0000000000000000000000000000000000000000000000000000000000000000',
        new Date().toISOString(),
      ]);
      try {
        assert.ok(checkMigrationsCurrent(tempDir).ok, 'applied migration is current');
      } finally {
        db.run('DELETE FROM _migrations WHERE name = ?', ['9999_pending_test.sql']);
      }

      // Missing directory -> not ready.
      assert.equal(checkMigrationsCurrent(path.join(tempDir, 'does-not-exist')).ok, false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('exposes Prometheus metrics to admins only, from real measurements', async () => {
    const anon = await fetch(`${baseUrl}/api/metrics`);
    assert.equal(anon.status, 401, 'anonymous is rejected');

    const asUser = await fetch(`${baseUrl}/api/metrics`, { headers: { authorization: `Bearer ${userToken}` } });
    assert.equal(asUser.status, 403, 'non-admin is rejected');

    const asAdmin = await fetch(`${baseUrl}/api/metrics`, { headers: { authorization: `Bearer ${adminToken}` } });
    assert.equal(asAdmin.status, 200);
    assert.match(String(asAdmin.headers.get('content-type')), /text\/plain/);
    const text = await asAdmin.text();

    // Every non-comment, non-empty line must be `name{labels} value`.
    const samples = text
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('#'));
    assert.ok(samples.length >= 10, `a real metric surface is exposed (${samples.length} samples)`);
    for (const line of samples) {
      assert.match(line, /^akbaral_[a-z0-9_]+(\{[^}]*\})? (-?\d+(\.\d+)?)$/, `valid sample: ${line}`);
    }

    // Real measurements, not zeros-by-default: this test run registered two
    // users and the registry has agents.
    assert.match(text, /akbaral_users_total \d+/);
    const usersLine = /akbaral_users_total (\d+)/.exec(text);
    assert.ok(Number(usersLine?.[1]) >= 2, 'user count includes this suite users');
    assert.match(text, /akbaral_agents_total \d+/);
    assert.match(text, /akbaral_process_uptime_seconds \d+(\.\d+)?/);
    assert.match(text, /akbaral_queue_jobs\{status="\w+"\} \d+/);
    assert.match(text, /akbaral_db_size_bytes \d+/);
    assert.ok(Number(/akbaral_db_size_bytes (\d+)/.exec(text)?.[1]) > 0, 'database size is a real measurement');
  });
});
