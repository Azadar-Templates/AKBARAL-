import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { ExecutionStream } from './execution-stream';
import { createUser, createAgent, createAgentExecution, db, listExecutionLogsAfter } from '../db';

describe('execution stream + replay', () => {
  let executionId = '';
  const suffix = randomBytes(6).toString('hex');

  before(() => {
    const user = createUser({ email: `ws-${suffix}@akbaral.test`, name: 'WS Test User' });
    const agent = createAgent({ name: 'WS Test Agent', slug: `ws-agent-${suffix}` });
    executionId = createAgentExecution({ agentId: agent.id, taskId: null, id: `exe_zh-${suffix}` }).id;
    void user;
  });

  after(() => {
    db.run('DELETE FROM users WHERE email = ?', [`ws-${suffix}@akbaral.test`]);
    db.close();
  });

  it('broadcasts logs over WebSocket and persists them for replay', async () => {
    const server = http.createServer();
    const stream = new ExecutionStream(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const port = address.port;

    try {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/executions/${executionId}`);
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
