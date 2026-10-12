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

  // The knobs below exist because a serialized bridge has no second chance: every query in the
  // process goes through this one client, so an unbounded connect, a statement that waits on a lock
  // forever, or an idle-in-transaction session that a pooler will not release is not a slow boot —
  // it is the boot. Measured on 2026-10-12, a container was killed for being "unready" at 38 s
  // while this client was still doing real work; nothing here changes the work, it makes the wait
  // bounded, observable and survivable.
  const intEnv = (name, fallback) => {
    const raw = String(process.env[name] ?? '').trim();
    if (raw.length === 0) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const connectTimeoutMs = intEnv('AKBARAL_PG_CONNECT_TIMEOUT_MS', 30_000) || 30_000;
  const connectAttempts = Math.max(1, intEnv('AKBARAL_PG_CONNECT_ATTEMPTS', 3) || 1);
  const statementTimeoutMs = intEnv('AKBARAL_PG_STATEMENT_TIMEOUT_MS', 300_000);
  const lockTimeoutMs = intEnv('AKBARAL_PG_LOCK_TIMEOUT_MS', 60_000);
  const idleInTransactionMs = intEnv('AKBARAL_PG_IDLE_IN_TRANSACTION_TIMEOUT_MS', 120_000);
  const applicationName = String(process.env.AKBARAL_PG_APPLICATION_NAME ?? 'akbaral').trim() || 'akbaral';

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
    const options = {
      connectionString: normalized,
      // Without this, a black-holed DNS/TCP connect hangs on the kernel's own schedule
      // (minutes), which is longer than any readiness budget a container platform gives.
      connectionTimeoutMillis: connectTimeoutMs,
      // A pooler/idle-reaper sees a healthy keepalive instead of a quiet socket, which is the
      // difference between "connection terminated unexpectedly" at random and a stable session.
      keepAlive: true,
      // Shows up in pg_stat_activity: whose session is this, when the only shared resource in
      // the account is a database. Never contains a credential.
      application_name: applicationName,
    };
    // Bounded retry, because the platform can start this container while a suspended serverless
    // Postgres is still waking. Each attempt is individually bounded above, so the total is
    // bounded too — this is a reschedule of the failure, not an unbounded wait for it.
    let lastError = null;
    for (let attempt = 1; attempt <= connectAttempts; attempt += 1) {
      try {
        client = new Client(options);
        await client.connect();
        break;
      } catch (error) {
        lastError = error;
        try { client?.end(); } catch { /* the connection is the problem, not the cleanup */ }
        client = null;
        if (attempt < connectAttempts) {
          const waitMs = Math.min(5_000, 250 * 2 ** (attempt - 1));
          process.stderr.write(
            `postgres connect attempt ${attempt}/${connectAttempts} failed (${error instanceof Error ? error.message : String(error)}); retrying in ${waitMs} ms\n`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }
    }
    if (!client) throw lastError ?? new Error('postgres connect failed without an error from the driver');
    // Session-level bounds, best effort on purpose: under a transaction-mode pooler these are not
    // guaranteed to pin, and a proxy that rejects one must never turn into a failed boot. The bound
    // that cannot be bypassed is the client-side wait in src/db/driver.ts; these stop a query this
    // process abandoned (or a lock it is stuck on) from outliving it on the server.
    for (const statement of [
      statementTimeoutMs > 0 ? `SET statement_timeout = ${statementTimeoutMs}` : null,
      lockTimeoutMs > 0 ? `SET lock_timeout = ${lockTimeoutMs}` : null,
      idleInTransactionMs > 0 ? `SET idle_in_transaction_session_timeout = ${idleInTransactionMs}` : null,
    ]) {
      if (!statement) continue;
      try {
        await client.query(statement);
      } catch {
        /* the pooler refused it; the client-side deadline still applies */
      }
    }
  } catch (error) {
    fatal(
      `postgres connect failed: ${error instanceof Error ? error.message : String(error)} ` +
        `(after ${connectAttempts} bounded attempt(s), ${connectTimeoutMs} ms each — the database host and port come from ` +
        'ZA141251SA_DATABASE_URL; AKBARAL_PG_CONNECT_ATTEMPTS / AKBARAL_PG_CONNECT_TIMEOUT_MS change this budget)',
    );
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
