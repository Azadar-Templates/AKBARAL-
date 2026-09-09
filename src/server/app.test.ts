import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiServer, type ApiServer } from '../app';
import { startResearchFixture, type ResearchFixtureServer } from '../test-support/research-fixture';
import { db, createUser } from '../db';
import { hashPassword } from '../security';

const suffix = randomBytes(6).toString('hex');
const email = `app-${suffix}@akbaral.test`;
const password = 'correct-horse-battery-staple';

describe('HTTP API integration', () => {
  let api: ApiServer;
  let baseUrl = '';
  let accessToken = '';
  let refreshToken = '';
  let fixture: ResearchFixtureServer;
  const tempUsers: string[] = [];

  before(async () => {
    fixture = await startResearchFixture();
    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    for (const id of tempUsers) {
      db.run('DELETE FROM users WHERE id = ?', [id]);
    }
    db.close();
    if (fixture) {
      await fixture.close();
    }
    await api.close();
  });

  it('health check', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status: string };
    assert.equal(body.status, 'ok');
  });

  it('registers, logs in, and reads current user', async () => {
    const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'App Test User' }),
    });
    assert.equal(registerResponse.status, 201);

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginResponse.status, 200);
    const loginBody = (await loginResponse.json()) as { accessToken: string; refreshToken: string; user: { id: string } };
    accessToken = loginBody.accessToken;
    refreshToken = loginBody.refreshToken;
    tempUsers.push(loginBody.user.id);

    const meResponse = await fetch(`${baseUrl}/api/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(meResponse.status, 200);
  });

  it('exposes agents to authenticated users', async () => {
    const response = await fetch(`${baseUrl}/api/agents`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { agents: Array<{ slug: string }> };
    assert.ok(body.agents.some((agent) => agent.slug === 'web-research-001'));
  });

  it('creates a research task, streams it in the background, and returns the final report', async () => {
    const createResponse = await fetch(`${baseUrl}/api/tasks/research`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ goal: 'AKBARAL research via HTTP' }),
    });
    assert.equal(createResponse.status, 202);
    const created = (await createResponse.json()) as { task: { id: string; executionId: string }; freeCredits: number };
    assert.ok(created.task.id);
    assert.equal(created.freeCredits, 4);

    const task = await waitForTask(baseUrl, accessToken, created.task.id);
    assert.equal(task.status, 'completed');
    assert.ok((task.output_data ?? '').includes('AKBARAL'));
    assert.ok(task.logs.length >= 3);
  });

  it('refreshes and logs out a session', async () => {
    const refreshResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    assert.equal(refreshResponse.status, 200);
    const refreshed = (await refreshResponse.json()) as { refreshToken: string };
    assert.ok(refreshed.refreshToken.length > 0);

    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshed.refreshToken }),
    });
    assert.equal(logoutResponse.status, 204);

    const meAfterLogout = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${refreshed.refreshToken}` },
    });
    assert.equal(meAfterLogout.status, 401);

    // The old access token belongs to the now-rotated session and must also be
    // rejected by the session check in requireAuth.
    const meAfterLogoutAccess = await fetch(`${baseUrl}/api/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(meAfterLogoutAccess.status, 401);
  });

  it('serves admin config status without leaking secrets and is admin-only', async () => {
    const adminEmail = `config-admin-${suffix}@akbaral.test`;
    const admin = createUser({
      email: adminEmail,
      name: 'Config Admin',
      role: 'admin',
      passwordHash: await hashPassword(password),
    });
    tempUsers.push(admin.id);
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password }),
    });
    assert.equal(loginResponse.status, 200);
    const loginBody = (await loginResponse.json()) as { accessToken: string };
    const statusResponse = await fetch(`${baseUrl}/api/admin/config/status`, {
      headers: { authorization: `Bearer ${loginBody.accessToken}` },
    });
    assert.equal(statusResponse.status, 200);
    const body = (await statusResponse.json()) as {
      integrations: Array<{ key: string; configured: boolean; requiredEnvVars: string[] }>;
    };
    assert.ok(Array.isArray(body.integrations));
    assert.ok(body.integrations.length >= 15);
    const raw = JSON.stringify(body);
    // No credential values, no bearer tokens, no provider-style opaque secrets.
    for (const needle of ['sk-', 'ghp_', 'AKIA', 'AIza', 'xoxb', 'Bearer ', 'SECRET_MASK']) {
      assert.ok(!raw.includes(needle), `config status leaked a secret-shaped value: ${needle}`);
    }
    const stripe = body.integrations.find((item) => item.key === 'stripe');
    assert.ok(stripe);
    assert.deepEqual(stripe.requiredEnvVars, ['STRIPE_SECRET_KEY']);

    // Non-admin is rejected before the status payload is produced.
    const nonAdminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const nonAdminToken = ((await nonAdminLogin.json()) as { accessToken: string }).accessToken;
    const denied = await fetch(`${baseUrl}/api/admin/config/status`, {
      headers: { authorization: `Bearer ${nonAdminToken}` },
    });
    assert.equal(denied.status, 403);
  });
});

async function waitForTask(baseUrl: string, accessToken: string, taskId: string): Promise<{
  id: string;
  status: string;
  output_data: string | null;
  logs: unknown[];
}> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/tasks/${taskId}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (response.status !== 200) {
      throw new Error(`task fetch failed ${response.status}`);
    }
    const body = (await response.json()) as {
      task: { id: string; status: string; output_data: string | null };
      logs: unknown[];
    };
    if (body.task.status === 'completed' || body.task.status === 'failed') {
      return { ...body.task, logs: body.logs };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`task ${taskId} did not finish in time`);
}
