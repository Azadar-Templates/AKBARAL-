import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { ExecutionStream } from './execution-stream';
import { createSession, createUser, createAgent, createAgentExecution, createTask, db, listExecutionLogsAfter, appendAgentExecutionLog } from '../db';
import { createApiServer, type ApiServer } from '../app';
import { signAccessToken } from '../security';

describe('SSE-only free-tier mode (AKBARAL_REALTIME_TRANSPORT=sse)', () => {
  // Regression tests for the free-tier realtime transport (SnapDeploy Free
  // Small: the edge proxy does not pass WebSocket upgrades). In SSE-only
  // mode the /ws/executions upgrade path is NOT registered; the identical
  // stream (auth + ownership isolation + payloads) runs over
  // /api/executions/:id/events and the existing client fallback engages.
  // NOTE: this describe must run BEFORE 'execution stream + replay' — that
  // describe's after() closes the shared database handle.
  const SAVED_TRANSPORT: Record<string, string | undefined> = {};
  const sseSuffix = randomBytes(6).toString('hex');

  before(() => {
    SAVED_TRANSPORT.value = process.env.AKBARAL_REALTIME_TRANSPORT;
  });

  after(() => {
    if (SAVED_TRANSPORT.value === undefined) delete process.env.AKBARAL_REALTIME_TRANSPORT;
    else process.env.AKBARAL_REALTIME_TRANSPORT = SAVED_TRANSPORT.value;
  });

  function makeExecution(email: string, tag: string): { executionId: string; token: string } {
    const user = createUser({ email, name: 'SSE-only test' });
    const session = createSession({
      userId: user.id,
      tokenHash: `sse-token-${sseSuffix}-${tag}`,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const token = signAccessToken({ sub: user.id, email: user.email, role: 'user', sid: session.id });
    const agent = createAgent({ name: 'SSE test agent', slug: `sse-agent-${sseSuffix}-${tag}` });
    const task = createTask({ userId: user.id, title: `SSE test ${sseSuffix} ${tag}`, type: 'test' });
    const execution = createAgentExecution({ agentId: agent.id, taskId: task.id, id: `exe_sse_${sseSuffix}_${tag}` });
    return { executionId: execution.id, token };
  }

  it('default mode registers the full WebSocket upgrade path (unchanged behavior)', () => {
    delete process.env.AKBARAL_REALTIME_TRANSPORT;
    const wsServer = http.createServer();
    new ExecutionStream(wsServer);
    assert.ok(wsServer.listenerCount('upgrade') >= 1, 'default mode registers the WebSocket upgrade path');

    process.env.AKBARAL_REALTIME_TRANSPORT = 'ws';
    const explicitWsServer = http.createServer();
    new ExecutionStream(explicitWsServer);
    assert.ok(explicitWsServer.listenerCount('upgrade') >= 1, "explicit 'ws' mode keeps the WebSocket path");
    process.env.AKBARAL_REALTIME_TRANSPORT = undefined;
  });

  it('WebSocket upgrade attempts fail FAST in SSE-only mode (client falls back to SSE, never hangs)', async () => {
    process.env.AKBARAL_REALTIME_TRANSPORT = 'sse';
    const { executionId, token } = makeExecution(`sse-ws-${sseSuffix}@akbaral.test`, 'ws');
    const server = http.createServer();
    new ExecutionStream(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    let client: WebSocket | null = null;
    try {
      const failed = await new Promise<boolean>((resolve) => {
        client = new WebSocket(`ws://127.0.0.1:${port}/ws/executions/${executionId}?token=${encodeURIComponent(token)}`);
        const timer = setTimeout(() => resolve(false), 2000);
        client.once('error', () => { clearTimeout(timer); resolve(true); });
        client.once('close', () => { clearTimeout(timer); resolve(true); });
        client.once('open', () => { clearTimeout(timer); resolve(false); });
      });
      assert.equal(failed, true, 'the upgrade must be refused immediately in SSE-only mode (no open, no hang)');
    } finally {
      try { (client as WebSocket | null)?.terminate(); } catch { /* already closed */ }
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.run('DELETE FROM users WHERE email = ?', [`sse-ws-${sseSuffix}@akbaral.test`]);
    }
  });

  it('a client that subscribes BEFORE the first log still receives logs as they are written (early connector)', async () => {
    // Regression for the free-tier transport: connecting before execution
    // starts is the NORMAL browser flow (the client opens the stream the
    // moment a task is dispatched). The previous tail loop never initialized
    // its cursor when the initial replay was empty — such clients received
    // nothing. This is the exact production SSE-only scenario.
    process.env.AKBARAL_REALTIME_TRANSPORT = 'sse';
    const early = makeExecution(`sse-early-${sseSuffix}@akbaral.test`, 'early');
    const api: ApiServer = createApiServer();
    await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
    try {
      // Subscribe BEFORE any log exists.
      const response = await fetch(`${base}/api/executions/${early.executionId}/events?token=${encodeURIComponent(early.token)}`);
      assert.equal(response.status, 200);
      const reader = response.body!.getReader();
      // Now the execution starts producing logs.
      appendAgentExecutionLog({ executionId: early.executionId, message: 'early-connector log arrives', level: 'info', type: 'log' });
      let received = '';
      const deadline = Date.now() + 5000;
      while (!received.includes('early-connector log arrives') && Date.now() < deadline) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value: undefined }>((resolve) => setTimeout(() => resolve({ done: true, value: undefined }), 2500)),
        ]);
        if (chunk.done) break;
        received += Buffer.from(chunk.value).toString();
      }
      assert.ok(received.includes('early-connector log arrives'), `the log written AFTER subscribing must arrive over SSE (got: ${received.slice(0, 120)})`);
      await reader.cancel().catch(() => undefined);
    } finally {
      api.server.closeAllConnections?.();
      await api.close();
      db.run('DELETE FROM users WHERE email = ?', [`sse-early-${sseSuffix}@akbaral.test`]);
    }
  });

  it('the SSE channel keeps full authentication + ownership isolation and streams real logs', async () => {
    process.env.AKBARAL_REALTIME_TRANSPORT = 'sse';
    const owner = makeExecution(`sse-owner-${sseSuffix}@akbaral.test`, 'owner');
    const foreign = makeExecution(`sse-foreign-${sseSuffix}@akbaral.test`, 'foreign');
    appendAgentExecutionLog({ executionId: owner.executionId, message: 'sse-only regression log line', level: 'info', type: 'log' });

    const api: ApiServer = createApiServer();
    await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
    try {
      // Unauthenticated → 401 (SSE is not an auth bypass).
      const anon = await fetch(`${base}/api/executions/${owner.executionId}/events`);
      assert.equal(anon.status, 401);
      // Another user's token → 403 (tenant isolation on the SSE channel).
      const cross = await fetch(`${base}/api/executions/${owner.executionId}/events?token=${encodeURIComponent(foreign.token)}`);
      assert.equal(cross.status, 403);
      // Owner → 200, event-stream, and the persisted log replays over SSE.
      const response = await fetch(`${base}/api/executions/${owner.executionId}/events?token=${encodeURIComponent(owner.token)}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      let sawLog = false;
      let received = '';
      try {
        const reader = response.body!.getReader();
        while (!sawLog) {
          const { done, value } = await reader.read();
          if (done) break;
          received += Buffer.from(value).toString();
          if (received.includes('sse-only regression log line')) sawLog = true;
        }
        reader.cancel().catch(() => undefined);
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
      assert.ok(sawLog, `the persisted log must stream over SSE (got: ${received.slice(0, 120)})`);
    } finally {
      api.server.closeAllConnections?.();
      await api.close();
      db.run('DELETE FROM users WHERE email = ? OR email = ?', [`sse-owner-${sseSuffix}@akbaral.test`, `sse-foreign-${sseSuffix}@akbaral.test`]);
    }
  });
});

describe('execution stream + replay', () => {
  let executionId = '';
  let userId = '';
  let accessToken = '';
  const suffix = randomBytes(6).toString('hex');

  before(() => {
    const user = createUser({ email: `ws-${suffix}@akbaral.test`, name: 'WS Test User' });
    userId = user.id;
    const session = createSession({
      userId,
      tokenHash: `ws-test-token-${suffix}`,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    accessToken = signAccessToken({ sub: userId, email: user.email, role: 'user', sid: session.id });
    const agent = createAgent({ name: 'WS Test Agent', slug: `ws-agent-${suffix}` });
    const task = createTask({ userId, title: `WS test ${suffix}`, type: 'test' });
    executionId = createAgentExecution({ agentId: agent.id, taskId: task.id, id: `exe_zh-${suffix}` }).id;
  });

  after(() => {
    db.run('DELETE FROM users WHERE email = ? OR email = ?', [`ws-${suffix}@akbaral.test`, `ws-other-${suffix}@akbaral.test`]);
    db.close();
  });

  it('broadcasts logs over WebSocket and persists them for replay', async () => {
    const server = http.createServer();
    const stream = new ExecutionStream(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const port = address.port;

    try {
      // Unauthenticated sockets must be rejected at the upgrade boundary.
      const unauthorized = await new Promise<boolean>((resolve) => {
        const bad = new WebSocket(`ws://127.0.0.1:${port}/ws/executions/${executionId}`);
        const timer = setTimeout(() => resolve(true), 1000);
        bad.once('error', () => { clearTimeout(timer); resolve(true); });
        bad.once('open', () => { clearTimeout(timer); resolve(false); });
      });
      assert.equal(unauthorized, true, 'unauthenticated WebSocket connection must be rejected');

      // Another user's token must not reach another tenant's execution stream.
      const other = createUser({ email: `ws-other-${suffix}@akbaral.test`, name: 'WS Other User' });
      const otherSession = createSession({
        userId: other.id,
        tokenHash: `ws-other-token-${suffix}`,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const otherToken = signAccessToken({ sub: other.id, email: other.email, role: 'user', sid: otherSession.id });
      const crossTenant = await new Promise<boolean>((resolve) => {
        const bad = new WebSocket(`ws://127.0.0.1:${port}/ws/executions/${executionId}?token=${otherToken}`);
        const timer = setTimeout(() => resolve(true), 1000);
        bad.once('error', () => { clearTimeout(timer); resolve(true); });
        bad.once('open', () => { clearTimeout(timer); resolve(false); });
      });
      assert.equal(crossTenant, true, 'cross-tenant WebSocket connection must be rejected');

      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/executions/${executionId}?token=${accessToken}`);
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });

      const received = new Promise<Record<string, unknown>>((resolve, reject) => {
        socket.on('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
        socket.on('error', reject);
      });

      stream.pushLog({ executionId, message: 'hello realtime', level: 'info', type: 'log' });
      const message = await received;
      assert.equal(message.type, 'log');
      assert.equal(message.executionId, executionId);
      assert.equal(message.message, 'hello realtime');

      // Replay persistence: a client reconnecting with an old cursor reads the
      // same persisted log row without needing the live WebSocket.
      const replayed = listExecutionLogsAfter(executionId, '1970-01-01T00:00:00.000Z', 500);
      assert.ok(replayed.some((row) => row.message === 'hello realtime'));

      socket.terminate();
    } finally {
      stream.close();
      const closeServer = server.close.bind(server);
      if (typeof (server as { closeAllConnections?: () => void }).closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise<void>((resolve) => closeServer(() => resolve()));
    }
  });
});
