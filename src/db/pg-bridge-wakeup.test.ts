import { after, it } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = ':memory:';
const { Database, db } = require('./database') as typeof import('./database');
after(() => db.close());

interface TestBridge {
  pgClosed: boolean;
  state: Int32Array;
  res: Uint8Array;
  pgBridge(sql: string, params?: unknown[], timeoutMs?: number): { rows: unknown[]; rowCount: number };
  pgConnect(timeoutMs: number): void;
}
function fixture() {
  let terminated = 0;
  const bridge = Object.assign(Object.create(Database.prototype), {
    engine: 'postgres', pgClosed: false,
    worker: { terminate: () => { terminated++; return Promise.resolve(0); } },
    state: new Int32Array(new SharedArrayBuffer(16)),
    req: new Uint8Array(new SharedArrayBuffer(4096)),
    res: new Uint8Array(new SharedArrayBuffer(4096)), dec: new TextDecoder(),
  }) as TestBridge;
  const reply = (status: number, payload: Record<string, unknown>) => {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    bridge.res.set(bytes);
    Atomics.store(bridge.state, 2, bytes.length);
    Atomics.store(bridge.state, 0, status);
  };
  return { bridge, reply, terminated: () => terminated };
}

it('a stale/spurious notification while REQ is pending is not a PostgreSQL timeout', context => {
  const { bridge, reply } = fixture();
  let waits = 0;
  context.mock.method(Atomics, 'wait', () => {
    waits++;
    if (waits === 2) reply(2, { rows: [{ value: 'synthetic reply' }], rowCount: 1 });
    return 'ok';
  });
  assert.deepEqual(bridge.pgBridge('SELECT synthetic'), { rows: [{ value: 'synthetic reply' }], rowCount: 1 });
  assert.equal(waits, 2);
  assert.equal(Atomics.load(bridge.state, 0), 0, 'acknowledge copied response so the worker can sleep');
});

it('ordinary query errors acknowledge the response without poisoning a healthy connection', context => {
  const { bridge, reply } = fixture();
  context.mock.method(Atomics, 'wait', () => { reply(3, { error: 'synthetic SQL refusal' }); return 'ok'; });
  assert.throws(() => bridge.pgBridge('synthetic query'), /synthetic SQL refusal/);
  assert.equal(bridge.pgClosed, false);
  assert.equal(Atomics.load(bridge.state, 0), 0);
});

it('a real pending-query timeout closes the bridge instead of overwriting an uncertain request', () => {
  const { bridge, terminated } = fixture();
  assert.throws(() => bridge.pgBridge('synthetic query with no reply', [], 2), /timed out/);
  assert.equal(bridge.pgClosed, true);
  assert.equal(terminated(), 1);
  assert.throws(() => bridge.pgBridge('must not be sent'), /closed/);
});

it('connection startup passes its deadline to the query handshake', context => {
  const { bridge } = fixture();
  let budget: number | undefined;
  context.mock.method(bridge, 'pgBridge', (_sql: string, _params: unknown[], timeoutMs: number) => {
    budget = timeoutMs;
    return { rows: [{ ready: 1 }], rowCount: 1 };
  });
  bridge.pgConnect(17);
  assert.equal(budget, 17, 'startup must not silently wait the 120-second query default');
});
