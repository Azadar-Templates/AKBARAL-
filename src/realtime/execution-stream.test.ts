import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { ExecutionStream } from './execution-stream';
import { createUser, createAgent, createAgentExecution, db } from '../db';

describe('execution stream', () => {
  let server: http.Server;
  let stream: ExecutionStream;
  let port = 0;
  let executionId = '';
  const suffix = randomBytes(6).toString('hex');

  before(async () => {
    const user = createUser({ email: `ws-${suffix}@akbaral.test`, name: 'WS Test User' });
    const agent = createAgent({ name: 'WS Test Agent', slug: `ws-agent-${suffix}` });
    executionId = createAgentExecution({ agentId: agent.id, taskId: null }).id;

    server = http.createServer();
    stream = new ExecutionStream(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    port = address.port;

    void user;
  });

  after(async () => {
    stream.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.run('DELETE FROM users WHERE email = ?', [`ws-${suffix}@akbaral.test`]);
    db.close();
  });

  it('broadcasts logs to execution subscribers', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/executions/${executionId}`);

    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    const received = new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.on('message', (data) => {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
      });
      socket.on('error', reject);
    });

    stream.pushLog({ executionId, message: 'hello realtime', level: 'info', type: 'log' });

    const message = await received;
    assert.equal(message.type, 'log');
    assert.equal(message.executionId, executionId);
    assert.equal(message.message, 'hello realtime');
    socket.removeAllListeners();
    socket.terminate();
  });

  it('replays logs after a provided cursor on reconnect', async () => {
    stream.pushLog({
      executionId,
      message: 'first message',
      level: 'info',
      type: 'log',
    });

    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/ws/executions/${executionId}?after=1970-01-01T00:00:00.000Z`,
    );

    // The server replays immediately on connection, so the listener must be
    // registered before the open handshake completes.
    const received = new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.on('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
      socket.on('error', reject);
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    const message = await received;
    // The first persisted log is replayed for a reconnect with an old cursor.
    assert.equal(message.message, 'hello realtime');
    socket.removeAllListeners();
    socket.terminate();
  });
});
