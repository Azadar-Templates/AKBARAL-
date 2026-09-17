/**
 * AKBARAL! — PostgreSQL worker for the synchronous database bridge.
 *
 * The application's repository layer is deliberately synchronous (matching
 * the SQLite driver it was born with). PostgreSQL's node driver is async,
 * so the pg client lives in THIS worker thread and the main thread blocks
 * on a SharedArrayBuffer + Atomics handshake until the result is written.
 * Every query is fully serialized — the same one-at-a-time semantics the
 * SQLite engine has always had (transactions keep their atomicity).
 *
 * Protocol (SharedArrayBuffer state machine):
 *   state[0]: 0 IDLE · 1 REQ_READY · 2 DONE · 3 ERROR · 6 FATAL (worker dead)
 *   state[1]: request byte length      state[2]: response byte length
 *   reqBuf:  main → worker JSON {sql, params}   (8 MiB cap)
 *   resBuf:  worker → main JSON {rows, rowCount} (64 MiB cap; larger
 *            results throw a clear error rather than corrupting silently)
 *
 * Payloads keep SQLite-compatible row shapes: BYTEA buffers are base64
 * wrapped as {__buf__} in both directions. No credentials are ever logged.
 */
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { normalizeSslMode } from './pg-connection.mjs';

const STATE_IDLE = 0;
const STATE_REQ = 1;
const STATE_DONE = 2;
const STATE_ERROR = 3;
const STATE_FATAL = 6;

if (!isMainThread && parentPort && workerData) {
  const { state, reqBuf, resBuf, connectionString } = workerData;
  const stateArr = new Int32Array(state);
  const req = new Uint8Array(reqBuf);
  const res = new Uint8Array(resBuf);
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const fatal = (message) => {
    const bytes = enc.encode(JSON.stringify({ error: message }));
    res.set(bytes);
    Atomics.store(stateArr, 2, bytes.length);
    Atomics.store(stateArr, 0, STATE_FATAL);
    Atomics.notify(stateArr, 0);
  };

  let client;
  try {
    const pg = await import('pg');
    // Row-shape parity with SQLite: node-postgres returns BIGINT (int8) as a
    // string by default; the repository layer expects numbers (COUNT(*),
    // identity columns). Values beyond Number.MAX_SAFE_INTEGER stay strings.
    pg.types.setTypeParser(20, (v) => {
      const n = Number(v);
      return Number.isSafeInteger(n) ? n : v;
    });
    const { Client } = pg;
    // SSL hardening: upgrade remote sslmode (Neon default 'require') to an
    // EXPLICIT verify-full — same behavior under pg 8.x, no deprecation
    // warning, and refuses plaintext/unverified remote connections. The
    // normalized string is never logged.
    const { connectionString: normalized } = normalizeSslMode(connectionString);
    client = new Client({ connectionString: normalized });
    await client.connect();
  } catch (error) {
    fatal(`postgres connect failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1); // eslint-disable-line n/no-process-exit
  }

  parentPort.on('message', (msg) => {
    if (msg && msg.cmd === 'close') {
      client.end().catch(() => {});
      setTimeout(() => process.exit(0), 100); // eslint-disable-line n/no-process-exit
    }
  });

  for (;;) {
    Atomics.wait(stateArr, 0, STATE_IDLE);
    if (Atomics.load(stateArr, 0) !== STATE_REQ) continue;

    let payload;
    try {
      const len = Atomics.load(stateArr, 1);
      payload = JSON.parse(dec.decode(req.subarray(0, len)));
    } catch (error) {
      const bytes = enc.encode(JSON.stringify({ error: `bridge decode failed: ${String(error)}` }));
      res.set(bytes);
      Atomics.store(stateArr, 2, bytes.length);
      Atomics.store(stateArr, 0, STATE_ERROR);
      Atomics.notify(stateArr, 0);
      continue;
    }

    let result;
    try {
      const params = (payload.params ?? []).map((p) =>
        p && typeof p === 'object' && p.__buf__ ? Buffer.from(p.__buf__, 'base64') : p,
      );
      // Empty parameter lists use the simple query protocol so that
      // multi-statement scripts (migrations) execute in one call.
      const outcome = await client.query(
        params.length > 0 ? { text: payload.sql, values: params } : payload.sql,
      );
      const rows = Array.isArray(outcome) ? outcome[outcome.length - 1]?.rows ?? [] : outcome.rows ?? [];
      const rowCount = Array.isArray(outcome)
        ? outcome.reduce((n, r) => n + (r.rowCount ?? 0), 0)
        : outcome.rowCount ?? 0;
      // Normalize pg row values to JSON-safe, SQLite-shaped values.
      const safeRows = rows.map((row) => {
        const out = {};
        for (const [k, v] of Object.entries(row)) {
          out[k] = Buffer.isBuffer(v) ? { __buf__: v.toString('base64') } : v;
        }
        return out;
      });
      result = { rows: safeRows, rowCount };
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) };
    }

    const bytes = enc.encode(JSON.stringify(result));
    if (bytes.length > res.byteLength) {
      const err = enc.encode(
        JSON.stringify({
          error: `postgres bridge result too large (${bytes.length} bytes > ${res.byteLength} cap); narrow the query`,
        }),
      );
      res.set(err);
      Atomics.store(stateArr, 2, err.length);
      Atomics.store(stateArr, 0, STATE_ERROR);
      Atomics.notify(stateArr, 0);
      continue;
    }
    res.set(bytes);
    Atomics.store(stateArr, 2, bytes.length);
    Atomics.store(stateArr, 0, result.error ? STATE_ERROR : STATE_DONE);
    Atomics.notify(stateArr, 0);
  }
}
