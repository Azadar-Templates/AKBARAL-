import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { createApiServer, type ApiServer } from '../app';
import { db } from '../db';
import { buildInfo, checkMigrationsCurrent, resetBuildInfoCache } from './health';
import { executionQueue } from '../orchestrator/queue';

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
    await api.close();
    db.close();
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

  it('liveness reports the build identity of the RUNNING process', async () => {
    // Deployment identity must be answerable over HTTP: before this, nothing
    // told an operator which commit a live host was serving.
    const response = await fetch(`${baseUrl}/api/health`);
    const body = (await response.json()) as { build?: { commit: string; version: string; builtAt: string | null; source: string } };
    assert.ok(body.build, '/api/health exposes a build object');
    assert.equal(typeof body.build.commit, 'string');
    assert.equal(typeof body.build.version, 'string');
    assert.ok(['image-stamp', 'env', 'unknown'].includes(body.build.source), `source is explainable (${body.build.source})`);
    assert.deepEqual(
      Object.keys(body.build).sort(),
      ['builtAt', 'commit', 'source', 'version'],
      'build payload carries exactly the four non-sensitive fields',
    );
    const serialised = JSON.stringify(body.build);
    assert.ok(!/SECRET|KEY|TOKEN|PASSWORD|postgres:|\/home\/|\/app\//i.test(serialised), 'no secret or filesystem detail leaks through the build payload');
  });

  it('readiness reports the same build identity', async () => {
    const response = await fetch(`${baseUrl}/api/ready`);
    const body = (await response.json()) as { build?: { commit: string } };
    assert.ok(body.build, '/api/ready exposes the build object too');
    assert.equal(body.build.commit, buildInfo().commit, 'both probes report one identity');
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

  it('a stopped execution poller is not ready even when its statistics remain readable', async () => {
    executionQueue.stop();
    try {
      assert.equal(executionQueue.isStarted, false);
      assert.equal(executionQueue.stats().activeWorkers, 0, 'an idle/stopped count is not liveness');
      const response = await fetch(`${baseUrl}/api/ready`);
      assert.equal(response.status, 503);
      const body = await response.json() as { status: string; checks: Array<{ name: string; ok: boolean }> };
      assert.equal(body.status, 'not_ready');
      assert.equal(body.checks.find(check => check.name === 'execution_queue')?.ok, false);
      assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200, 'HTTP/database liveness remains distinct');
    } finally {
      executionQueue.start();
    }
    assert.equal(executionQueue.isStarted, true);
    assert.equal((await fetch(`${baseUrl}/api/ready`)).status, 200, 'idle running poller is ready again');
  });

  it('unavailable queue statistics fail readiness closed', async context => {
    context.mock.method(executionQueue, 'stats', () => { throw new Error('synthetic queue statistics unavailable'); });
    const response = await fetch(`${baseUrl}/api/ready`);
    assert.equal(response.status, 503);
    const body = await response.json() as { checks: Array<{ name: string; ok: boolean }> };
    assert.equal(body.checks.find(check => check.name === 'execution_queue')?.ok, false);
  });

  it('the migration probe selects the actual database engine directory', context => {
    const seen: string[] = [];
    const exists = fs.existsSync;
    context.mock.method(fs, 'existsSync', (target: fs.PathLike) => { seen.push(String(target)); return exists(target); });
    assert.equal(checkMigrationsCurrent().ok, true);
    assert.ok(seen.includes(path.resolve(process.cwd(), 'db', db.engine === 'postgres' ? 'migrations-pg' : 'migrations')));
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

describe('build identity resolution (deployment provenance)', () => {
  after(() => resetBuildInfoCache());

  it('prefers an explicit image version from the environment', () => {
    const info = buildInfo({ env: { ...process.env, AKBARAL_IMAGE_VERSION: '810f900d1bc291662ff6180e31cf009f5312dd19' }, cwd: process.cwd() });
    assert.equal(info.commit, '810f900d1bc291662ff6180e31cf009f5312dd19');
    assert.equal(info.source, 'env');
  });

  it('reads the image stamp the Dockerfile writes (/app/.image-version equivalent)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akbaral-stamp-'));
    fs.writeFileSync(path.join(dir, '.image-version'), 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n');
    try {
      const info = buildInfo({ env: { ...process.env, AKBARAL_IMAGE_VERSION: '' }, cwd: dir });
      assert.equal(info.commit, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
      assert.equal(info.source, 'image-stamp');
      assert.ok(info.builtAt && !Number.isNaN(Date.parse(info.builtAt)), 'build timestamp comes from the real stamp file');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('says "unknown" honestly instead of guessing when no stamp exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akbaral-nostamp-'));
    try {
      const info = buildInfo({ env: { ...process.env, AKBARAL_IMAGE_VERSION: '' }, cwd: dir });
      // /app/.image-version may exist in a container; both outcomes are honest,
      // never fabricated.
      assert.ok(['unknown', 'image-stamp'].includes(info.source));
      if (info.source === 'unknown') {
        assert.equal(info.commit, 'unknown');
        assert.equal(info.builtAt, null);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never reports a placeholder stamp as a real commit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akbaral-unknown-'));
    fs.writeFileSync(path.join(dir, '.image-version'), 'unknown\n');
    try {
      const info = buildInfo({ env: { ...process.env, AKBARAL_IMAGE_VERSION: '' }, cwd: dir });
      assert.notEqual(info.source, 'image-stamp', 'the Dockerfile default ARG value is not a commit');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
