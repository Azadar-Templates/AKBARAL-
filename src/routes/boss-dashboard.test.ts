/**
 * BOSS DASHBOARD — HTTP-LEVEL SECURITY REGRESSION TEST
 *
 * Proves the fix for the fail-open `/api/boss/*` auth defect found during the
 * second audit pass: an unauthenticated (or misconfigured) request must never
 * reach the mission database, must never initialize `mission.db`, and must
 * never leak an internal diagnostic. Everything here runs against a
 * disposable, temp-file mission database created just for this test file —
 * never against production, and the real mission is never initialized.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApiServer, type ApiServer } from '../app';

const suffix = randomBytes(6).toString('hex');
const TEST_MISSION_DB = resolve(process.cwd(), `test-boss-auth-${suffix}.db`);
const MISSION_DB_FILES = [TEST_MISSION_DB, `${TEST_MISSION_DB}-shm`, `${TEST_MISSION_DB}-wal`];
const TEST_TOKEN = `boss-dashboard-test-token-${suffix}`;

function missionDbFileExists(): boolean {
  return MISSION_DB_FILES.some((f) => existsSync(f));
}

function cleanupMissionDbFiles(): void {
  for (const f of MISSION_DB_FILES) {
    try {
      if (existsSync(f)) rmSync(f);
    } catch {
      /* best-effort cleanup */
    }
  }
}

describe('boss dashboard: /api/boss fail-closed auth (regression)', () => {
  let api: ApiServer;
  let baseUrl = '';
  const savedEnv = new Map<string, string | undefined>();

  before(async () => {
    for (const key of ['ZA141251SA_DASHBOARD_TOKEN', 'MISSION_DASHBOARD_TOKEN', 'ZA141251SA_DATABASE_URL']) {
      savedEnv.set(key, process.env[key]);
    }
    // Point the mission DB at a disposable temp file unique to this test run.
    // Never the real mission.db, never production.
    process.env.ZA141251SA_DATABASE_URL = `file:${TEST_MISSION_DB}`;
    delete process.env.ZA141251SA_DASHBOARD_TOKEN;
    delete process.env.MISSION_DASHBOARD_TOKEN;
    cleanupMissionDbFiles();

    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await api.close();
    const { missionDb } = await import('../mission/database');
    try {
      missionDb.close();
    } catch {
      /* already closed or never opened */
    }
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    cleanupMissionDbFiles();
  });

  // ── Phase A: dashboard token configuration is entirely absent ──────────
  describe('missing dashboard-token configuration', () => {
    it('rejects a request with no Authorization header: 503, no mission DB created', async () => {
      assert.equal(missionDbFileExists(), false, 'precondition: no mission DB file exists yet');
      const res = await fetch(`${baseUrl}/api/boss/overview`);
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error.code, 'mission_dashboard_not_configured');
      assert.equal(missionDbFileExists(), false, 'an unconfigured dashboard must never create the mission DB');
    });

    it('rejects a request that supplies SOME bearer token: 503, no mission DB created', async () => {
      const res = await fetch(`${baseUrl}/api/boss/overview`, {
        headers: { authorization: 'Bearer anything-at-all' },
      });
      assert.equal(res.status, 503);
      assert.equal(missionDbFileExists(), false, 'a client-supplied token must not matter when nothing is configured');
    });

    it('rejects every route under /api/boss, not just /overview', async () => {
      for (const path of ['/agents', '/agents/some-id', '/treasury', '/scheduler', '/blocked', '/opportunities']) {
        const res = await fetch(`${baseUrl}/api/boss${path}`);
        assert.equal(res.status, 503, `expected 503 for ${path}, got ${res.status}`);
      }
      assert.equal(missionDbFileExists(), false, 'no route under /api/boss may create the mission DB when unconfigured');
    });

    it('never leaks a stack trace or internal detail in the 503 body', async () => {
      const res = await fetch(`${baseUrl}/api/boss/overview`);
      const text = await res.text();
      assert.ok(!/at Object\.|at Module\.|\.ts:\d+:\d+|node_modules/.test(text), 'no stack frame in the response');
      assert.ok(!/mission_agents|mission_wallets|SELECT|no such table/i.test(text), 'no SQL/table detail in the response');
    });
  });

  // ── Phase B: dashboard token IS configured — full auth boundary ────────
  describe('configured dashboard token: auth boundary', () => {
    before(() => {
      process.env.ZA141251SA_DASHBOARD_TOKEN = TEST_TOKEN;
    });
    after(() => {
      delete process.env.ZA141251SA_DASHBOARD_TOKEN;
    });

    it('rejects a request with no Authorization header: 401, no mission DB created', async () => {
      assert.equal(missionDbFileExists(), false, 'precondition still holds: nothing has opened the mission DB yet');
      const res = await fetch(`${baseUrl}/api/boss/overview`);
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error.code, 'unauthorized');
      assert.equal(missionDbFileExists(), false, 'a missing token must not reach the mission DB');
    });

    it('rejects an invalid/wrong token: 401, no mission DB created', async () => {
      const res = await fetch(`${baseUrl}/api/boss/overview`, {
        headers: { authorization: 'Bearer totally-wrong-token' },
      });
      assert.equal(res.status, 401);
      assert.equal(missionDbFileExists(), false, 'a wrong token must not reach the mission DB');
    });

    it('rejects a malformed Authorization header (wrong scheme): 401', async () => {
      const res = await fetch(`${baseUrl}/api/boss/overview`, {
        headers: { authorization: `Basic ${Buffer.from(`user:${TEST_TOKEN}`).toString('base64')}` },
      });
      assert.equal(res.status, 401);
      assert.equal(missionDbFileExists(), false, 'a non-Bearer scheme must not reach the mission DB');
    });

    it('rejects an empty Bearer token: 401', async () => {
      const res = await fetch(`${baseUrl}/api/boss/overview`, { headers: { authorization: 'Bearer ' } });
      assert.equal(res.status, 401);
      assert.equal(missionDbFileExists(), false);
    });

    it('a real AKBARAL! customer session token cannot be used as mission authorization', async () => {
      // Customer authentication must never become mission-owner authorization.
      const email = `boss-auth-${suffix}@akbaral.test`;
      const reg = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'correct-horse-battery-staple', name: 'Boss Auth Test' }),
      });
      assert.equal(reg.status, 201);
      const session = (await reg.json()) as { accessToken: string };
      const customerToken = session.accessToken;

      const res = await fetch(`${baseUrl}/api/boss/overview`, {
        headers: { authorization: `Bearer ${customerToken}` },
      });
      assert.equal(res.status, 401, 'a valid customer JWT must be rejected by the mission dashboard');
      assert.equal(missionDbFileExists(), false, 'a customer token must not reach the mission DB');
    });

    it('the correct mission dashboard token is accepted and reaches the mission DB (legitimate owner path preserved)', async () => {
      assert.equal(missionDbFileExists(), false, 'still nothing created before the first VALID request');

      // The disposable mission DB has no schema yet — apply mission migrations
      // (idempotent, disposable file only) so the legitimate path returns real
      // data instead of failing on a missing table, proving access genuinely
      // works end-to-end, not merely that auth was bypassed.
      const { applyMissionMigrations } = await import('../mission/database');
      applyMissionMigrations();
      assert.equal(missionDbFileExists(), true, 'applying migrations is what creates the file — an explicit, intentional step in this test, not a side effect of an unauthenticated request');

      const res = await fetch(`${baseUrl}/api/boss/overview`, {
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      });
      assert.equal(res.status, 200, 'the correct mission dashboard token must be accepted');
      const body = await res.json();
      assert.equal(body.fleet.totalAgents, 0, 'a freshly migrated, empty mission DB reports zero agents honestly');
    });
  });
});
