import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { env } from '../config/env';
import { resolveDatabasePath } from './path';
import { displayDatabaseTarget } from './display-target';

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

/**
 * SQLite `INTEGER` is a 64-bit signed integer; PostgreSQL `INTEGER` is 32-bit
 * (max 2,147,483,647). Every schema in this repository stores money as integer
 * cents, so a column that is perfectly legal on SQLite overflows on PostgreSQL:
 * the mission migration that writes a $1,000,000,000 daily target
 * (100,000,000,000 cents) failed the whole mission schema with
 * `integer out of range`, which meant the private tier could not run on managed
 * PostgreSQL (Neon) at all.
 *
 * DDL column types are therefore widened to `BIGINT`, which is the faithful
 * equivalent of SQLite's INTEGER. Only CREATE TABLE / ALTER TABLE statements are
 * rewritten, so casts and expressions elsewhere keep their exact meaning.
 */
function widenIntegerColumnsForPg(sql: string): string {
  if (!/\b(CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(sql)) return sql;
  // Only rewrite INTEGER where it is a COLUMN TYPE (followed by a column
  // constraint, a comma or the end of the column list), never the
  // `INTEGER PRIMARY KEY AUTOINCREMENT` identity form — that is key semantics,
  // not a width, and must keep failing loudly instead of changing meaning.
  return sql.replace(
    /\bINTEGER\b(?!\s+PRIMARY\s+KEY\s+AUTOINCREMENT)(?=\s*(?:,|\)|NOT\s+NULL|NULL|DEFAULT|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|GENERATED|COLLATE|$))/gi,
    'BIGINT',
  );
}

export function translateSqlForPg(sql: string): string {
  let out = widenIntegerColumnsForPg(transformScalarMaxMin(sql));

  out = out.replace(
    /strftime\(\s*'%Y-%m-%dT%H:%M:%fZ'\s*,\s*'now'\s*\)/g,
    `to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  );

  // SQLite datetime() → PostgreSQL. Timestamps are stored as ISO-8601 TEXT
  // everywhere in this codebase, so the result must stay TEXT in exactly the
  // same format or `created_at >= datetime(…)` comparisons silently change
  // meaning. Four real forms exist in this repository (literal offset,
  // parameterised offset, bare now, and datetime(column)).
  const PG_UTC_TEXT = `to_char(%s, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  const utcText = (expression: string) => PG_UTC_TEXT.replace('%s', expression);
  out = out.replace(
    /datetime\(\s*'now'\s*,\s*'-'\s*\|\|\s*\?\s*\|\|\s*' days'\s*\)/gi,
    utcText("(now() at time zone 'utc') - ((?)::text || ' days')::interval"),
  );
  out = out.replace(
    /datetime\(\s*'now'\s*,\s*'([+-]\s*\d+\s+\w+)'\s*\)/gi,
    (_m, offset: string) => utcText(`(now() at time zone 'utc') + interval '${String(offset).replace(/\s+/g, ' ').trim()}'`),
  );
  out = out.replace(/datetime\(\s*'now'\s*\)/gi, utcText("now() at time zone 'utc'"));
  out = out.replace(/datetime\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/gi, (_m, column: string) => utcText(`(${column})::timestamp`));

  out = out.replace(
    /json_extract\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*,\s*'\$\.[A-Za-z0-9_]+'\s*\)/g,
    (_m, column) => {
      const key = /'\$\.[A-Za-z0-9_]+'/.exec(_m)?.[0] ?? "''";
      const prop = key.slice(3, -1);
      // The JSON key MUST be single-quoted: PostgreSQL reads double-quoted
      // tokens as identifiers (column references), so `->>"key"` fails with
      // 'column "key" does not exist'. `prop` is regex-constrained to
      // [A-Za-z0-9_]+, so single-quoting it is injection-safe.
      return `(${column}::json->>'${prop}')`;
    },
  );

  // A statement may legitimately start with comments (migration files document
  // every insert). Skip them before deciding whether this is an upsert, or the
  // rewrite silently does not happen and PostgreSQL reports
  // `syntax error at or near "OR"`.
  const leadingTrivia = /^(?:\s|--[^\n]*\n?|\/\*[\s\S]*?\*\/)*/.exec(out)?.[0] ?? '';
  const statementBody = out.slice(leadingTrivia.length);
  if (/^INSERT OR IGNORE INTO/i.test(statementBody)) {
    const rewritten = statementBody
      .replace(/^INSERT OR IGNORE INTO/i, 'INSERT INTO')
      .replace(/;\s*$/, '');
    out = `${leadingTrivia}${rewritten} ON CONFLICT DO NOTHING`;
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


/**
 * Split a SQL script into individual statements.
 *
 * `exec()` is handed whole migration files, but every dialect rule in
 * `translateSqlForPg` is written for ONE statement (`INSERT OR IGNORE` →
 * `ON CONFLICT DO NOTHING`, DDL integer widening, …). Passing a whole file
 * through those rules silently skipped every statement except the first, which
 * is why a mission migration containing `INSERT OR IGNORE` failed on
 * PostgreSQL with `syntax error at or near "OR"`.
 *
 * Quoted strings (with '' escapes), quoted identifiers, line comments and
 * block comments are respected, so a semicolon inside any of them never splits
 * a statement.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let inIdentifier = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += next;
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (!inString && !inIdentifier && ch === '-' && next === '-') {
      current += ch + next;
      i += 1;
      inLineComment = true;
      continue;
    }
    if (!inString && !inIdentifier && ch === '/' && next === '*') {
      current += ch + next;
      i += 1;
      inBlockComment = true;
      continue;
    }
    if (!inIdentifier && ch === "'") {
      inString = !inString;
      current += ch;
      continue;
    }
    if (!inString && ch === '"') {
      inIdentifier = !inIdentifier;
      current += ch;
      continue;
    }
    if (ch === ';' && !inString && !inIdentifier) {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

/** Translate a whole SQL script statement by statement. */
export function translateScriptForPg(sql: string): string {
  return splitSqlStatements(sql)
    .map((statement) => translateSqlForPg(statement))
    .filter((statement) => statement.trim().length > 0)
    .join(';\n') + ';';
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
      this.filePath = displayDatabaseTarget(databaseUrl); // diagnostics never retain URL credentials
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

    if (Atomics.load(this.state, 0) === 6) {
      this.pgClosed = true;
      this.worker.terminate().catch(() => {});
      throw new Error('postgres worker failed before request dispatch');
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
    const deadline = performance.now() + timeoutMs;
    let status = Atomics.load(state, 0);
    while (status === 1) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        // The request may already have executed. Do not overwrite/retry it or
        // allow a late reply to be mistaken for the next query's response.
        this.pgClosed = true;
        this.worker.terminate().catch(() => {});
        throw new Error(`postgres query timed out after ${timeoutMs}ms; connection closed, outcome may be uncertain`);
      }
      // An old response's notify can arrive after the next request is posted.
      // Notification is not completion: wait for the protocol state to change.
      Atomics.wait(state, 0, 1, remaining);
      status = Atomics.load(state, 0);
    }

    const len = Atomics.load(this.state, 2);
    const parsed = JSON.parse(this.dec.decode(this.res.subarray(0, len))) as {
      rows?: Array<Record<string, unknown>>;
      rowCount?: number;
      error?: string;
    };
    if (status === 6) {
      this.pgClosed = true;
      this.worker.terminate().catch(() => {});
    } else {
      // We have copied/decoded the response. Let the worker sleep until the
      // next request rather than spinning on a completed state.
      Atomics.store(state, 0, 0);
    }
    if (status === 6 || parsed.error) {
      throw new Error(parsed.error ?? 'postgres bridge failed');
    }
    return { rows: parsed.rows ?? [], rowCount: parsed.rowCount ?? 0 };
  }

  private pgConnect(timeoutMs: number): void {
    // One request waits for connection startup within the caller's deadline.
    // A failed handshake is never retried over a possibly pending request.
    try {
      this.pgBridge('SELECT 1 AS ready', [], timeoutMs);
    } catch (error) {
      this.pgClosed = true;
      this.worker?.terminate().catch(() => {});
      throw new Error(`postgres connection failed: ${error instanceof Error ? error.message : String(error)}`);
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
      // translation still applies (e.g. the _migrations applied_at default),
      // and it must apply to EVERY statement in the script, not just the first.
      this.pgBridge(translateScriptForPg(sql));
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
        // The worker may be asleep in Atomics.wait, unable to service a
        // parentPort callback. Termination also closes its PostgreSQL socket.
        this.worker?.terminate().catch(() => {});
      }
      return;
    }
    if (this.connection?.isOpen) {
      this.connection.close();
    }
  }
}
