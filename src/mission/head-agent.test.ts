import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.ZA141251SA_DATABASE_URL = `file:${path.join(os.tmpdir(), `mission-head-agent-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'head-agent-test-session-secret-0123456789';
process.env.ZA141251SA_CREDENTIAL_KEY = 'head-agent-test-credential-key-0123456789';
process.env.ZA141251SA_CURRENCY = 'USD';

import { applyMissionMigrations, missionDb, nowIso } from './database';
import { createMissionServer } from './server';
import { login, provisionOwner } from './auth';
import { ensurePolicy } from './policy';

const ownerEmail = 'head-agent-owner@test.invalid';
const ownerPassword = 'head-agent-owner-password';
let server: ReturnType<typeof createMissionServer>;
let baseUrl = '';
let token = '';
let ownerId = '';

async function request(route: string, init: RequestInit = {}): Promise<{ status: number; body: any; text: string }> {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body, text };
}

function ownerRequest(route: string, init: RequestInit = {}): Promise<{ status: number; body: any; text: string }> {
  return request(route, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
}

test.before(async () => {
  applyMissionMigrations();
  ensurePolicy('USD');
  const owner = provisionOwner({ email: ownerEmail, password: ownerPassword });
  ownerId = owner.id;
  token = login({ email: ownerEmail, password: ownerPassword }).token;
  const timestamp = nowIso();
  missionDb.run(
    `INSERT INTO mission_head_agent_resources (id, owner_id, label, category, provider, expires_at, cost_cents, currency, cost_status, notes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['har_test_resource', ownerId, 'Read-only test resource', 'compute', 'test-provider', new Date(Date.now() + 2 * 86400000).toISOString(), 500, 'USD', 'unverified', 'Fixture only', 'active', timestamp, timestamp],
  );
  missionDb.run(
    `INSERT INTO mission_head_agent_alerts (id, owner_id, kind, severity, title, message, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['hal_test_alert', ownerId, 'system', 'info', 'Test alert', 'Fixture alert; no action is available.', 'open', timestamp, timestamp],
  );
  missionDb.run(
    `INSERT INTO mission_head_agent_info (id, owner_id, topic, title, body, source_type, source_id, source_label, source_endpoint, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['hin_test_info', ownerId, 'test', 'Test information', 'Fixture information.', 'test', 'hin_test_info', 'Test source', '/api/mission/head-agent/info', timestamp, timestamp],
  );
  missionDb.run(
    `INSERT INTO mission_approvals (id, subject_type, subject_id, action, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    ['hap_test_approval', 'resource', 'har_test_resource', 'resource.approve', timestamp],
  );
  server = createMissionServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  missionDb.close();
});

test('head-agent routes are owner-only and chat is read-only', async () => {
  for (const route of [
    '/api/mission/head-agent/overview',
    '/api/mission/head-agent/agents',
    '/api/mission/head-agent/approvals',
    '/api/mission/head-agent/earnings',
    '/api/mission/head-agent/resources',
    '/api/mission/head-agent/notifications',
    '/api/mission/head-agent/info',
  ]) {
    assert.equal((await request(route)).status, 401, route);
  }
  assert.equal((await request('/api/mission/head-agent/chat', { method: 'POST', body: JSON.stringify({ question: 'what is pending?' }) })).status, 401);

  const before = missionDb.get<{ count: number }>('SELECT COUNT(*) AS count FROM mission_audit')?.count;
  const overview = await ownerRequest('/api/mission/head-agent/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.body.readOnly, true);
  assert.equal(overview.body.resources[0].cost.status, 'unverified');
  assert.equal(overview.body.resources[0].cost.cents, 500);
  assert.equal(overview.body.approvals[0].status, 'pending');

  const chat = await ownerRequest('/api/mission/head-agent/chat', { method: 'POST', body: JSON.stringify({ question: 'Which approvals are pending?' }) });
  assert.equal(chat.status, 200);
  assert.equal(chat.body.readOnly, true);
  assert.match(chat.body.answer, /pending/i);
  assert.ok(chat.body.citations.some((entry: any) => entry.recordId === 'hap_test_approval'));
  const after = missionDb.get<{ count: number }>('SELECT COUNT(*) AS count FROM mission_audit')?.count;
  assert.equal(after, before, 'read-only overview and chat do not append audit events');
});

test('the unauthenticated dashboard shell contains no private mission identifier', async () => {
  const html = await request('/');
  assert.equal(html.status, 200);
  assert.doesNotMatch(html.text, /ZA141251SA/);
  const app = await request('/app.js');
  assert.equal(app.status, 200);
  assert.doesNotMatch(app.text, /ZA141251SA/);
});
