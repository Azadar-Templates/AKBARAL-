import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { env } from '../config/env';
import { resolveDatabasePath } from './path';

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export type SqlValue = SQLInputValue;

export type DbEngine = 'sqlite' | 'postgres';

/** A PostgreSQL URL selects the PostgreSQL engine; anything else is SQLite. */
export function resolveDbEngine(databaseUrl: string): DbEngine {
  return /^postgres(ql)?:\/\//i.test(databaseUrl) ? 'postgres' : 'sqlite';
}

const REQ_CAPACITY = 8 * 1024 * 1024;
const RES_CAPACITY = 64 * 1024 * 1024;
const PG_CONNECT_TIMEOUT_MS = 30_000;
const PG_QUERY_TIMEOUT_MS = 120_000;

/**
 * Translate the repository layer's portable SQL dialect into PostgreSQL.
 *
 * The repositories were written against SQLite with a small, well-defined
 * set of constructs. Rather than editing call sites across the codebase,
 * the handful of dialect differences are translated here — in ONE place,
 * fully unit-testable, applied only on the PostgreSQL path:
 *
 *   1. `?` placeholders → `$1..$n` (string-literal aware)
 *   2. strftime('%Y-%m-%dT%H:%M:%fZ','now') → to_char(now() AT TIME ZONE
 *      'utc', ...) — byte-identical ISO-8601 output (ms precision)
 *   3. json_extract(col, '$.key') → col::json->>'key'
 *   4. INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
 *   5. knowledge_fts MATCH ? → GIN tsvector websearch match
 */
/** SQLite's scalar two-argument max(a, b)/min(a, b) becomes GREATEST/LEAST. */
function transformScalarMaxMin(sql: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      const start = i;
      i += 1;
      while (i < sql.length && sql[i] !== "'") i += 1;
      i += 1;
      out.push(sql.slice(start, i));
      continue;
    }
    const rest = sql.slice(i);
    const m = /^\b(MAX|MIN)\(/i.exec(rest);
    if (!m) {
      out.push(ch);
      i += 1;
      continue;
    }
    const fn = m[1].toUpperCase();
    let depth = 0;
    let j = i + m[0].length - 1;
    let end = -1;
    while (j < sql.length) {
      if (sql[j] === '(') depth += 1;
      else if (sql[j] === ')') {
        depth -= 1;
        if (depth === 0) { end = j; break; }
      }
      j += 1;
    }
    if (end === -1) {
      out.push(ch);
      i += 1;
      continue;
    }
    const inner = sql.slice(i + m[0].length, end);
    const args: string[] = [];
    let depthA = 0;
    let cur = '';
    for (const c of inner) {
      if (c === '(') depthA += 1;
      if (c === ')') depthA -= 1;
      if (c === ',' && depthA === 0) { args.push(cur); cur = ''; continue; }
      cur += c;
    }
    args.push(cur);
    if (args.length > 1) {
      out.push(`${fn === 'MAX' ? 'GREATEST' : 'LEAST'}(${args.map((a) => a.trim()).join(', ')})`);
    } else {
      out.push(sql.slice(i, end + 1));
    }
    i = end + 1;
  }
  return out.join('');
}

export function translateSqlForPg(sql: string): string {
  let out = transformScalarMaxMin(sql);

  out = out.replace(
    /strftime\(\s*'%Y-%m-%dT%H:%M:%fZ'\s*,\s*'now'\s*\)/g,
    `to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  );

  out = out.replace(
    /json_extract\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*,\s*'\$\.[A-Za-z0-9_]+'\s*\)/g,
    (_m, column) => {
      const key = /'\$\.[A-Za-z0-9_]+'/.exec(_m)?.[0] ?? "''";
      const prop = key.slice(3, -1);
      return `(${column}::json->>${JSON.stringify(prop)})`;
    },
  );

  if (/^\s*INSERT OR IGNORE INTO/i.test(out)) {
    out = out.replace(/^\s*INSERT OR IGNORE INTO/i, 'INSERT INTO');
    out = out.replace(/;\s*$/, '');
    out = `${out} ON CONFLICT DO NOTHING`;
  }

  out = out.replace(
    /knowledge_fts MATCH \?/g,
    `fts.tsv @@ websearch_to_tsquery('simple', ?)`,
  );

  if (/^\s*PRAGMA/i.test(out)) {
    throw new Error('PRAGMA statements are SQLite-only and blocked on the PostgreSQL engine');
  }

  return out;
}

/** Rewrite `?` placeholders as `$1..$n`, skipping single-quoted strings. */
export function placeholdersToPg(sql: string): string {
  let out = '';
  let inString = false;
  let n = 0;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      inString = !inString;
      out += ch;
    } else if (ch === '?' && !inString) {
      n += 1;
      out += `$${n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Serialize parameter values for the worker bridge (buffers → base64). */
function encodeParams(params: SqlValue[]): unknown[] {
  return params.map((p) =>
    Buffer.isBuffer(p) || p instanceof Uint8Array
      ? { __buf__: Buffer.from(p).toString('base64') }
      : (p as unknown),
  );
}

/** Decode bridge rows back into SQLite-compatible shapes. */
function decodeRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && (v as { __buf__?: string }).__buf__
        ? Buffer.from((v as { __buf__: string }).__buf__, 'base64')
        : v;
  }
  return out as T;
}

/**
 * Thin, typed wrapper around the database driver.
 *
 * SQLite (file:/…memory:) and PostgreSQL (postgres://…) share one API:
 * every repository in the project goes through this wrapper, which is what
 * makes the engine swap transparent. The synchronous contract is preserved
 * on both engines — the PostgreSQL client runs in a worker thread behind a
 * SharedArrayBuffer handshake, giving the same one-query-at-a-time
 * semantics (and therefore the same transaction atomicity) as SQLite.
 */
export class Database {
  readonly filePath: string;
  readonly engine: DbEngine;
  private readonly connection?: DatabaseSync;
  private readonly worker?: Worker;
  private readonly state?: Int32Array;
  private readonly req?: Uint8Array;
  private readonly res?: Uint8Array;
  private readonly dec = new TextDecoder();
  private pgClosed = false;
  private inTransaction = false;

  constructor(databaseUrl: string = env.databaseUrl, options?: { timeoutMs?: number }) {
    this.engine = resolveDbEngine(databaseUrl);

    if (this.engine === 'postgres') {
      this.filePath = databaseUrl.replace(/\/\/[^@]*@/, '//***@'); // never keep credentials
      const sab = new SharedArrayBuffer(4 * 4);
      const reqSab = new SharedArrayBuffer(REQ_CAPACITY);
      const resSab = new SharedArrayBuffer(RES_CAPACITY);
      this.state = new Int32Array(sab);
      this.req = new Uint8Array(reqSab);
      this.res = new Uint8Array(resSab);

      // CJS-compatible worker path: src/db in dev (tsx), dist/src/db in prod.
      const workerPath = path.join(__dirname, 'pg-worker.mjs');
      this.worker = new Worker(workerPath, {
        workerData: {
          state: sab,
          reqBuf: reqSab,
          resBuf: resSab,
          connectionString: databaseUrl,
        },
      });
      this.worker.unref?.();
      this.pgConnect(options?.timeoutMs ?? PG_CONNECT_TIMEOUT_MS);
      return;
    }

    this.filePath = resolveDatabasePath(databaseUrl);

    if (this.filePath !== ':memory:') {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    }

    this.connection = new DatabaseSync(this.filePath, {
      enableForeignKeyConstraints: true,
      timeout: options?.timeoutMs ?? 5000,
    });

    this.connection.exec('PRAGMA busy_timeout = 5000;');
  }

  // -- PostgreSQL engine internals ------------------------------------------

  private pgBridge(sql: string, params: SqlValue[] = [], timeoutMs = PG_QUERY_TIMEOUT_MS): { rows: Array<Record<string, unknown>>; rowCount: number } {
    if (!this.worker || !this.state || !this.req || !this.res) {
      throw new Error('postgres engine not initialized');
    }
    if (this.pgClosed) {
      throw new Error('postgres connection is closed');
    }

    const payload = JSON.stringify({ sql, params: encodeParams(params) });
    const bytes = Buffer.from(payload, 'utf8');
    if (bytes.length > this.req.byteLength) {
      throw new Error(`postgres bridge request too large (${bytes.length} bytes); batch the write`);
    }
    this.req.set(bytes);

    Atomics.store(this.state, 1, bytes.length);
    Atomics.store(this.state, 0, 1);
    Atomics.notify(this.state, 0);

    const state = this.state;
    const woke = Atomics.wait(state, 0, 1, timeoutMs);
    const status = Atomics.load(state, 0);
    if (woke === 'timed-out' || status === 1) {
      throw new Error(`postgres query timed out after ${timeoutMs}ms`);
    }

    const len = Atomics.load(this.state, 2);
    const parsed = JSON.parse(this.dec.decode(this.res.subarray(0, len))) as {
      rows?: Array<Record<string, unknown>>;
      rowCount?: number;
      error?: string;
    };
    if (status === 6 || parsed.error) {
      throw new Error(parsed.error ?? 'postgres bridge failed');
    }
    return { rows: parsed.rows ?? [], rowCount: parsed.rowCount ?? 0 };
  }

  private pgConnect(timeoutMs: number): void {
    // The worker connects on boot; a first trivial query doubles as the
    // readiness handshake (it can only answer once the client is live).
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        this.pgBridge('SELECT 1 AS ready');
        return;
      } catch (error) {
        const fatal = this.state ? Atomics.load(this.state, 0) === 6 : false;
        if (fatal || Date.now() > deadline) {
          this.worker?.terminate().catch(() => {});
          throw new Error(
            `postgres connection failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const st = this.state!;
        Atomics.wait(st, 0, 1, Math.min(250, Math.max(deadline - Date.now(), 1)));
      }
    }
  }

  // -- Shared API ------------------------------------------------------------

  get isOpen(): boolean {
    return this.engine === 'postgres' ? !this.pgClosed : (this.connection?.isOpen ?? false);
  }

  get isTransaction(): boolean {
    return this.engine === 'postgres' ? this.inTransaction : (this.connection?.isTransaction ?? false);
  }

  exec(sql: string): void {
    if (this.engine === 'postgres') {
      // No placeholder rewrite here (exec has no parameters) — but dialect
      // translation still applies (e.g. the _migrations applied_at default).
      this.pgBridge(translateSqlForPg(sql));
      return;
    }
    this.connection!.exec(sql);
  }

  run(sql: string, params: SqlValue[] = []): RunResult {
    if (this.engine === 'postgres') {
      const translated = placeholdersToPg(translateSqlForPg(sql));
      const { rowCount } = this.pgBridge(translated, params);
      return { changes: rowCount, lastInsertRowid: 0 };
    }
    return this.connection!.prepare(sql).run(...params) as unknown as RunResult;
  }

  get<T>(sql: string, params: SqlValue[] = []): T | undefined {
    if (this.engine === 'postgres') {
      const translated = placeholdersToPg(translateSqlForPg(sql));
      const { rows } = this.pgBridge(translated, params);
      return rows.length > 0 ? decodeRow<T>(rows[0]) : undefined;
    }
    return this.connection!.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, params: SqlValue[] = []): T[] {
    if (this.engine === 'postgres') {
      const translated = placeholdersToPg(translateSqlForPg(sql));
      const { rows } = this.pgBridge(translated, params);
      return rows.map((row) => decodeRow<T>(row));
    }
    return this.connection!.prepare(sql).all(...params) as T[];
  }

  transaction<T>(callback: (db: Database) => T): T {
    if (this.isTransaction) {
      return callback(this);
    }

    if (this.engine === 'postgres') {
      this.pgBridge('BEGIN');
      this.inTransaction = true;
      try {
        const result = callback(this);
        this.pgBridge('COMMIT');
        this.inTransaction = false;
        return result;
      } catch (error) {
        this.inTransaction = false;
        try {
          this.pgBridge('ROLLBACK');
        } catch {
          // Connection-level failure: the queue's recovery path reconciles.
        }
        throw error;
      }
    }

    this.connection!.exec('BEGIN IMMEDIATE;');
    try {
      const result = callback(this);
      this.connection!.exec('COMMIT;');
      return result;
    } catch (error) {
      this.connection!.exec('ROLLBACK;');
      throw error;
    }
  }

  tableExists(name: string): boolean {
    if (this.engine === 'postgres') {
      const row = this.get<{ reg: string | null }>(
        `SELECT to_regclass($1) AS reg`,
        [`public.${name}`],
      );
      return Boolean(row?.reg);
    }
    const row = this.get<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      [name],
    );
    return Boolean(row);
  }

  close(): void {
    if (this.engine === 'postgres') {
      if (!this.pgClosed) {
        this.pgClosed = true;
        try {
          this.worker?.postMessage({ cmd: 'close' });
        } catch {
          // Worker already gone.
        }
      }
      return;
    }
    if (this.connection?.isOpen) {
      this.connection.close();
    }
  }
}

/**
 * Application-wide default connection.
 *
 * `DATABASE_URL` selects the engine:
 *   - `file:./data/akbaral.db` or `:memory:` → SQLite (local dev, tests)
 *   - `postgres://…` / `postgresql://…`    → PostgreSQL (Neon production)
 */
export const db = new Database();
