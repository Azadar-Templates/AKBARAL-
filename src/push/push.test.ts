import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { createApiServer, type ApiServer } from '../app';
import { startModelFixture, type ModelFixtureServer } from '../test-support/model-provider-fixture';
import { db, findTaskById, listNotifications, listActiveDeviceTokens } from '../db';
import { syncAgentRegistry } from '../agents/registry';
import { executionQueue } from '../orchestrator/queue';

/**
 * M12 — mobile push + task notification integration tests.
 *
 * Covers: device registration (auth + validation + persistence + idempotency
 * + ownership transfer), unregistration/revival, in-app notifications on task
 * failure/completion, and honest Expo push dispatch (real HTTP to a local
 * fixture; endpoint failures are logged, never faked, and never affect task
 * execution or the in-app notification).
 */

const suffix = randomBytes(6).toString('hex');
const password = 'correct-horse-battery-staple';

interface PushFixture {
  baseUrl: string;
  requests: Array<Record<string, unknown>>;
  failAll: boolean;
  close(): Promise<void>;
}

/** Expo push-service-compatible fixture: records pushes, answers with tickets. */
async function startPushFixture(): Promise<PushFixture> {
  const requests: Array<Record<string, unknown>> = [];
  const state = { failAll: false };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      let body: unknown = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
      requests.push({ body });
      const messages = Array.isArray(body) ? body : [body];
      res.statusCode = state.failAll ? 500 : 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          data: messages.map(() => (state.failAll ? { status: 'error', message: 'fixture failure' } : { status: 'ok', id: 'fixture-ticket' })),
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    get failAll() {
      return state.failAll;
    },
    set failAll(value: boolean) {
      state.failAll = value;
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  data?: string | null;
}

describe('M12 mobile push + task notifications', () => {
  let api: ApiServer;
  let baseUrl = '';
  let modelFixture: ModelFixtureServer;
  let pushFixture: PushFixture;
  let tokenA = '';
  let userIdA = '';
  let tokenB = '';
  const savedEnv = new Map<string, string | undefined>();

  async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`waitFor timed out waiting for ${label}`);
  }

  function authHeaders(userToken: string): Record<string, string> {
    return { authorization: `Bearer ${userToken}` };
  }

  function registerDevice(userToken: string, token: string, platform = 'android'): Promise<Response> {
    return fetch(`${baseUrl}/api/notifications/device`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(userToken) },
      body: JSON.stringify({ token, platform }),
    });
  }

  function findNotification(userId: string, taskId: string, title: string): NotificationRow | undefined {
    return listNotifications(userId)
      .map((row) => row as unknown as NotificationRow)
      .find((row) => row.type === 'task' && row.title === title && String(row.data ?? '').includes(taskId));
  }

  function lastPushMessages(): Array<Record<string, unknown>> {
    const last = pushFixture.requests[pushFixture.requests.length - 1];
    const body = last?.body;
    return (Array.isArray(body) ? body : [body]) as Array<Record<string, unknown>>;
  }

  before(async () => {
    for (const key of [
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'AKBARAL_SEARCH_ENDPOINT',
      'AKBARAL_PAGE_FETCH_ENDPOINT',
      'AKBARAL_ALLOW_PRIVATE_PROVIDER',
      'AKBARAL_EXPO_PUSH_URL',
    ]) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }

    pushFixture = await startPushFixture();
    process.env.AKBARAL_EXPO_PUSH_URL = pushFixture.baseUrl;

    syncAgentRegistry();
    modelFixture = await startModelFixture('ok');

    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;

    async function register(label: string): Promise<{ id: string; token: string }> {
      const email = `m12-${label}-${suffix}@akbaral.test`;
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: `M12 ${label}` }),
      });
      assert.equal(response.status, 201);
      const body = (await response.json()) as { user: { id: string } };
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(login.status, 200);
      const loginBody = (await login.json()) as { accessToken: string };
      return { id: body.user.id, token: loginBody.accessToken };
    }

    const userA = await register('push-a');
    userIdA = userA.id;
    tokenA = userA.token;
    const userB = await register('push-b');
    tokenB = userB.token;
  });

  after(async () => {
    try {
      executionQueue.stop();
    } catch {
      // already stopped
    }
    await api?.close();
    await modelFixture?.close();
    await pushFixture?.close();
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('requires auth for device registration and rejects invalid tokens', async () => {
    const anonymous = await fetch(`${baseUrl}/api/notifications/device`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'ExpoPushToken[anonymous-attempt-token]' }),
    });
    assert.equal(anonymous.status, 401);

    const tooShort = await registerDevice(tokenA, 'short');
    assert.equal(tooShort.status, 422);
  });

  it('registers a device token and persists it (idempotent per token)', async () => {
    const pushToken = `ExpoPushToken[device-a-${suffix}]`;
    const first = await registerDevice(tokenA, pushToken);
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as { deviceId: string };

    // Same token, same user → no duplicate row, metadata refreshed.
    const again = await registerDevice(tokenA, pushToken, 'ios');
    assert.equal(again.status, 200);
    const againBody = (await again.json()) as { deviceId: string };
    assert.equal(againBody.deviceId, firstBody.deviceId);

    const rows = db.all<{ id: string; user_id: string; token: string; platform: string; revoked_at: string | null }>(
      'SELECT id, user_id, token, platform, revoked_at FROM device_tokens WHERE token = ?',
      [pushToken],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, userIdA);
    assert.equal(rows[0].platform, 'ios', 're-registration refreshes platform metadata');
    assert.equal(rows[0].revoked_at, null);

    const active = listActiveDeviceTokens(userIdA);
    assert.equal(active.filter((row) => row.token === pushToken).length, 1);
  });

  it('transfers device ownership when another user registers the same token', async () => {
    const pushToken = `ExpoPushToken[shared-${suffix}]`;
    const first = await registerDevice(tokenA, pushToken);
    assert.equal(first.status, 200);
    const second = await registerDevice(tokenB, pushToken);
    assert.equal(second.status, 200);

    const rows = db.all<{ user_id: string }>('SELECT user_id FROM device_tokens WHERE token = ?', [pushToken]);
    assert.equal(rows.length, 1, 'no duplicate rows for one physical device');
    assert.notEqual(rows[0].user_id, userIdA, 'token re-owned by the new user');
    assert.equal(listActiveDeviceTokens(userIdA).filter((row) => row.token === pushToken).length, 0);
  });

  it('unregisters a device token (and only for its owner)', async () => {
    const pushToken = `ExpoPushToken[removable-${suffix}]`;
    await registerDevice(tokenA, pushToken);

    // B cannot delete A's token.
    const foreign = await fetch(`${baseUrl}/api/notifications/device/${encodeURIComponent(pushToken)}`, {
      method: 'DELETE',
      headers: authHeaders(tokenB),
    });
    assert.equal(foreign.status, 404);

    const removed = await fetch(`${baseUrl}/api/notifications/device/${encodeURIComponent(pushToken)}`, {
      method: 'DELETE',
      headers: authHeaders(tokenA),
    });
    assert.equal(removed.status, 204);
    assert.equal(listActiveDeviceTokens(userIdA).filter((row) => row.token === pushToken).length, 0);

    const again = await fetch(`${baseUrl}/api/notifications/device/${encodeURIComponent(pushToken)}`, {
      method: 'DELETE',
      headers: authHeaders(tokenA),
    });
    assert.equal(again.status, 404);

    // Re-registering revives the row (revoked_at cleared).
    const revived = await registerDevice(tokenA, pushToken);
    assert.equal(revived.status, 200);
    const rows = db.all<{ revoked_at: string | null }>('SELECT revoked_at FROM device_tokens WHERE token = ?', [pushToken]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].revoked_at, null);
  });

  it('notifies on task failure: in-app row + real Expo push dispatch with deep link', async () => {
    const pushToken = `ExpoPushToken[fail-case-${suffix}]`;
    await registerDevice(tokenA, pushToken);
    const requestsBefore = pushFixture.requests.length;

    // No provider configured → honest failure + automatic refund.
    const failed = await fetch(`${baseUrl}/api/tasks/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(tokenA) },
      body: JSON.stringify({ goal: `m12 push failure case ${suffix}` }),
    });
    assert.equal(failed.status, 202);
    const failedBody = (await failed.json()) as { task: { id: string } };
    const taskId = failedBody.task.id;
    await waitFor(() => findTaskById(taskId)?.status === 'failed', 20_000, 'honest failure');

    // In-app notification row exists for the owner.
    await waitFor(() => findNotification(userIdA, taskId, 'Task failed') !== undefined, 5_000, 'failure notification row');
    const failureNotification = findNotification(userIdA, taskId, 'Task failed');
    assert.ok(failureNotification, 'failure notification exists');
    assert.ok(String(failureNotification?.body ?? '').includes('refunded'), 'failure body mentions the refund');

    // Real push was dispatched to the Expo endpoint with a deep link.
    await waitFor(() => pushFixture.requests.length > requestsBefore, 10_000, 'push dispatch for failure');
    const mine = lastPushMessages().find((message) => message.to === pushToken);
    assert.ok(mine, 'push addressed to the registered device');
    assert.equal(mine?.title, 'Task failed');
    const data = mine?.data as { taskId?: string; deepLink?: string } | undefined;
    assert.equal(data?.taskId, taskId);
    assert.equal(data?.deepLink, `akbaral://tasks/${taskId}`);
  });

  it('notifies on task completion; a failing push endpoint never breaks the task or the in-app row', async () => {
    const pushToken = `ExpoPushToken[success-case-${suffix}]`;
    await registerDevice(tokenA, pushToken);

    // 1) Push endpoint returns HTTP 500 tickets → task still completes and the
    //    in-app notification is still created (push failure is honest, not fatal).
    pushFixture.failAll = true;
    const requestsBefore = pushFixture.requests.length;

    process.env.OPENAI_API_KEY = 'test-fixture-key';
    process.env.OPENAI_BASE_URL = modelFixture.baseUrl;
    let okTaskId = '';
    try {
      const ok = await fetch(`${baseUrl}/api/workflows/agent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(tokenA) },
        body: JSON.stringify({ agent_slug: 'research-researcher-002', goal: `m12 push success case ${suffix}` }),
      });
      assert.equal(ok.status, 202);
      const okBody = (await ok.json()) as { task: { id: string } };
      okTaskId = okBody.task.id;
      await waitFor(() => findTaskById(okTaskId)?.status === 'completed', 60_000, 'successful completion');
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
    }
    assert.equal(findTaskById(okTaskId)?.status, 'completed', 'task completed despite push endpoint errors');
    await waitFor(() => findNotification(userIdA, okTaskId, 'Task completed') !== undefined, 5_000, 'completion notification row despite push errors');
    await waitFor(() => pushFixture.requests.length > requestsBefore, 10_000, 'attempted push dispatch despite errors');

    // 2) Healthy endpoint → ticket delivered.
    pushFixture.failAll = false;
    const requestsBeforeOk = pushFixture.requests.length;
    const failed = await fetch(`${baseUrl}/api/tasks/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(tokenA) },
      body: JSON.stringify({ goal: `m12 push healthy dispatch case ${suffix}` }),
    });
    assert.equal(failed.status, 202);
    const failedBody = (await failed.json()) as { task: { id: string } };
    await waitFor(() => findTaskById(failedBody.task.id)?.status === 'failed', 20_000, 'second honest failure');
    await waitFor(() => pushFixture.requests.length > requestsBeforeOk, 10_000, 'healthy push dispatch');
    assert.ok(lastPushMessages().some((message) => message.to === pushToken), 'healthy dispatch reaches the device');
  });
});
