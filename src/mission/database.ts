import { financialTransaction } from '../db/financial-transaction';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Database, resolveDbEngine, type DbEngine } from '../db/driver';
import { displayDatabaseTarget } from '../db/display-target';

/**
 * PRIVATE MISSION DATABASE — its own file, its own schema, its own migrations.
 *
 * ISOLATION IS BY CONNECTION AND SCHEMA, NOT BY DRIVER: the mission opens its
 * own connection to ZA141251SA_DATABASE_URL (default ./mission.db) and applies
 * only db/migrations-mission/. Operators must configure a separate database
 * target; sharing the driver does not open the platform default connection.
 * The connection-free driver class (`src/db/driver.ts`) is shared purely so that both engines — SQLite for a single-box
 * deployment, PostgreSQL for a managed/serverless host — behave identically:
 * one bridge, one dialect translation, one transaction implementation.
 *
 * Also note the engine differences that matter for money:
 *   · `rowid` does not exist in PostgreSQL, so the ledger orders itself by an
 *     explicit `seq` column (migration 0004);
 *   · PRAGMA statements are SQLite-only and are filtered out for PostgreSQL;
 *   · table introspection uses each engine's own catalogue.
 */

const DEFAULT_DATABASE_URL = (() => {
  // Honour DATA_DIR so the mission DB lives under the same writable volume
  // as the main DB (/data in production, ./data in dev).
  const dataDir = (process.env.DATA_DIR ?? (process.env.NODE_ENV === 'production' ? '/data' : './data')).trim();
  return `file:${dataDir}/mission.db`;
})();

export interface MissionEnv {
  databaseUrl: string;
  sessionSecret: string | null;
  credentialKey: string | null;
  currency: string;
  bindHost: string;
  port: number;
}

export function missionEnv(): MissionEnv {
  const dataDir = (process.env.DATA_DIR ?? (process.env.NODE_ENV === 'production' ? '/data' : './data')).trim();
  const raw = (process.env.ZA141251SA_DATABASE_URL ?? process.env.MISSION_DATABASE_URL ?? `file:${dataDir}/mission.db`).trim();
  return {
    databaseUrl: raw.length > 0 ? raw : DEFAULT_DATABASE_URL,
    sessionSecret: (process.env.ZA141251SA_SESSION_SECRET ?? '').trim() || null,
    credentialKey: (process.env.ZA141251SA_CREDENTIAL_KEY ?? '').trim() || null,
    currency: (process.env.ZA141251SA_CURRENCY ?? 'USD').trim() || 'USD',
    // Private by default: the dashboard binds loopback unless an operator
    // explicitly opts into a wider bind (behind a tunnel/private network).
    bindHost: (process.env.ZA141251SA_BIND_HOST ?? '127.0.0.1').trim() || '127.0.0.1',
    port: Number(process.env.ZA141251SA_PORT ?? 4200) || 4200,
  };
}

export function resolveMissionDbPath(databaseUrl: string = missionEnv().databaseUrl): string {
  const value = databaseUrl.startsWith('file:') ? databaseUrl.slice('file:'.length) : databaseUrl;
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

export function migrationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'db/migrations-mission'),
    path.resolve(__dirname, '../../../db/migrations-mission'),
    path.resolve(__dirname, '../../../../db/migrations-mission'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`mission migrations directory not found (looked in ${candidates.join(', ')})`);
}

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, SqlValue>;

/** Statements that exist only in SQLite; skipped when the engine is PostgreSQL. */
export function stripSqliteOnlyStatements(sql: string, engine: DbEngine): string {
  if (engine !== 'postgres') return sql;
  return sql
    .split('\n')
    .filter((line) => !/^\s*PRAGMA\b/i.test(line))
    .join('\n');
}

class MissionDatabase {
  private delegate: Database | null = null;
  private engine: DbEngine = 'sqlite';
  private target = '';
  /** Nested transaction depth — outer BEGIN, inner SAVEPOINT (both engines). */
  private depth = 0;
  private savepointSeq = 0;

  /** Connection target. PostgreSQL URLs are returned with credentials stripped. */
  path(): string {
    if (this.engine === 'postgres') return displayDatabaseTarget(this.target);
    return this.target;
  }

  /** The engine this mission will use (resolved from the URL even before connecting). */
  engineName(): DbEngine {
    if (this.delegate) return this.engine;
    return resolveDbEngine(missionEnv().databaseUrl);
  }

  private open(): Database {
    if (this.delegate) return this.delegate;
    const env = missionEnv();
    this.engine = resolveDbEngine(env.databaseUrl);
    if (this.engine === 'sqlite') {
      this.target = resolveMissionDbPath(env.databaseUrl);
      fs.mkdirSync(path.dirname(this.target), { recursive: true });
    } else {
      this.target = env.databaseUrl;
    }
    this.delegate = new Database(env.databaseUrl, { timeoutMs: 15_000 });
    if (this.engine === 'sqlite') {
      // WAL + a busy timeout: the dashboard, the CLI and the scheduler may touch
      // the file at the same time. (PostgreSQL needs none of this.)
      this.delegate.exec('PRAGMA journal_mode = WAL;');
      this.delegate.exec('PRAGMA busy_timeout = 5000;');
    }
    return this.delegate;
  }

  close(): void {
    if (this.delegate) {
      this.delegate.close();
      this.delegate = null;
      this.depth = 0;
    }
  }

  /** Execute one or more statements with no parameters (migrations, DDL). */
  exec(sql: string): void {
    this.open().exec(stripSqliteOnlyStatements(sql, this.engine));
  }

  run(sql: string, params: SqlValue[] = []): { changes: number; lastInsertRowid: number | bigint } {
    const result = this.open().run(sql, params as SqlValue[]);
    return { changes: Number(result.changes ?? 0), lastInsertRowid: Number(result.lastInsertRowid ?? 0) };
  }

  get<T = Row>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.open().get<T>(sql, params as SqlValue[]);
  }

  all<T = Row>(sql: string, params: SqlValue[] = []): T[] {
    return this.open().all<T>(sql, params as SqlValue[]);
  }

  /**
   * Run `fn` in a transaction. Nested calls use SAVEPOINTs, so higher-level units
   * of work (creating an agent, recording revenue) compose smaller transactional
   * helpers without "transaction within a transaction" failures — an inner
   * failure rolls back only the inner work and still surfaces as an error.
   * Works identically on both engines.
   */
  transaction<T>(fn: () => T): T {
    const db = this.open();
    if (this.depth > 0) {
      const savepoint = `mission_sp_${(this.savepointSeq += 1)}`;
      db.exec(`SAVEPOINT ${savepoint}`);
      this.depth += 1;
      try {
        const result = fn();
        db.exec(`RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        try {
          db.exec(`ROLLBACK TO ${savepoint}`);
          db.exec(`RELEASE ${savepoint}`);
        } catch {
          /* rollback best-effort */
        }
        throw error;
      } finally {
        this.depth -= 1;
      }
    }
    this.depth = 1;
    try {
      return financialTransaction(db, 'mission', fn);
    } finally {
      this.depth = 0;
    }
  }

  /** Number of tables in the mission schema (health/diagnostics). */
  tableCount(): number {
    const db = this.open();
    if (this.engine === 'postgres') {
      const row = db.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      return Number(row?.count ?? 0);
    }
    const row = db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'`);
    return Number(row?.count ?? 0);
  }

  tableExists(name: string): boolean {
    return this.open().tableExists(name);
  }
}

export const missionDb = new MissionDatabase();

/** Apply every mission migration in order; idempotent. */
export function applyMissionMigrations(target = missionDb): { applied: string[]; total: number } {
  const dir = migrationsDir();
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  target.exec(
    `CREATE TABLE IF NOT EXISTS mission_migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     )`,
  );
  const applied: string[] = [];
  for (const file of files) {
    const already = target.get<{ name: string }>('SELECT name FROM mission_migrations WHERE name = ?', [file]);
    if (already) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    target.transaction(() => {
      target.exec(sql);
      target.run('INSERT INTO mission_migrations (name) VALUES (?)', [file]);
    });
    applied.push(file);
  }
  backfillLedgerSequence(target);
  return { applied, total: files.length };
}

/**
 * One-off backfill for ledgers written before `seq` existed (migration 0004).
 *
 * Only SQLite can expose the true insertion order of those rows (rowid), so the
 * backfill runs there and is skipped — safely, because there is nothing to
 * backfill — on a fresh PostgreSQL database. Rows are re-hashed after the
 * sequence is assigned so the chain reflects the real order.
 */
export function backfillLedgerSequence(target = missionDb): { backfilled: number } {
  const engine = target.engineName();
  const pending = target.get<{ count: number }>('SELECT COUNT(*) AS count FROM mission_ledger WHERE seq IS NULL');
  if (Number(pending?.count ?? 0) === 0) return { backfilled: 0 };
  const ordering = engine === 'postgres' ? 'created_at ASC, id ASC' : 'rowid ASC';
  const rows = target.all<Row>(`SELECT * FROM mission_ledger WHERE seq IS NULL ORDER BY ${ordering}`);
  let previousHash = '';
  const previous = target.get<Row>('SELECT hash FROM mission_ledger WHERE seq IS NOT NULL ORDER BY seq DESC LIMIT 1');
  previousHash = previous?.hash ? String(previous.hash) : '';
  let nextSeq = Number(target.get<{ max: number | null }>('SELECT MAX(seq) AS max FROM mission_ledger')?.max ?? 0);
  let backfilled = 0;
  target.transaction(() => {
    for (const row of rows) {
      nextSeq += 1;
      const payload = [
        String(row.id),
        String(row.wallet_id),
        String(row.direction),
        Number(row.amount_cents),
        String(row.category),
        row.reference ? String(row.reference) : '',
        Number(row.balance_after),
        previousHash,
        String(row.created_at),
      ].join('|');
      const hash = sha256(payload);
      target.run('UPDATE mission_ledger SET seq = ?, prev_hash = ?, hash = ? WHERE id = ?', [nextSeq, previousHash || null, hash, String(row.id)]);
      previousHash = hash;
      backfilled += 1;
    }
  });
  return { backfilled };
}

export function missionId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Append-only, hash-chained audit trail
// ─────────────────────────────────────────────────────────────────────────────

export interface AuditInput {
  actorType: 'owner' | 'agent' | 'system' | 'provider';
  actorId?: string | null;
  action: string;
  subjectType?: string | null;
  subjectId?: string | null;
  detail?: Record<string, unknown> | null;
}

const SECRET_KEY_PATTERN = /(password|secret|token|api[_-]?key|credential|authorization|private[_-]?key|card|cvv|iban|account[_-]?number)/i;

/**
 * Redact anything secret-shaped before it reaches the audit trail. Audit rows
 * are immutable, so a leaked secret there would be unremovable: redaction
 * happens on the way in, never on the way out.
 */
export function redactForAudit(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => redactForAudit(entry, depth + 1));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : redactForAudit(entry, depth + 1);
    }
    return output;
  }
  if (typeof value === 'string') {
    if (value.length > 4000) return `${value.slice(0, 4000)}…[truncated]`;
    return value;
  }
  return value;
}

export function appendMissionAudit(input: AuditInput, target = missionDb): { id: string; seq: number; hash: string } {
  return target.transaction(() => {
    const previous = target.get<{ seq: number; hash: string }>('SELECT seq, hash FROM mission_audit ORDER BY seq DESC LIMIT 1');
    const seq = Number(previous?.seq ?? 0) + 1;
    const id = missionId('aud');
    const createdAt = nowIso();
    const detail = input.detail ? JSON.stringify(redactForAudit(input.detail)) : null;
    const payload = [
      seq,
      id,
      input.actorType,
      input.actorId ?? '',
      input.action,
      input.subjectType ?? '',
      input.subjectId ?? '',
      detail ?? '',
      previous?.hash ?? '',
      createdAt,
    ].join('|');
    const hash = sha256(payload);
    target.run(
      `INSERT INTO mission_audit (id, seq, actor_type, actor_id, action, subject_type, subject_id, detail, prev_hash, hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, seq, input.actorType, input.actorId ?? null, input.action, input.subjectType ?? null, input.subjectId ?? null, detail, previous?.hash ?? null, hash, createdAt],
    );
    return { id, seq, hash };
  });
}

export interface AuditVerification {
  ok: boolean;
  rows: number;
  brokenAtSeq: number | null;
  detail: string;
}

/** Recompute the chain: proves no audit row was altered, removed or reordered. */
export function verifyMissionAudit(target = missionDb): AuditVerification {
  const rows = target.all<{
    id: string; seq: number; actor_type: string; actor_id: string | null; action: string;
    subject_type: string | null; subject_id: string | null; detail: string | null;
    prev_hash: string | null; hash: string; created_at: string;
  }>('SELECT * FROM mission_audit ORDER BY seq ASC');
  let previousHash = '';
  let expectedSeq = 1;
  for (const row of rows) {
    if (Number(row.seq) !== expectedSeq) {
      return { ok: false, rows: rows.length, brokenAtSeq: Number(row.seq), detail: `sequence gap: expected ${expectedSeq}, found ${row.seq}` };
    }
    const payload = [
      row.seq,
      row.id,
      row.actor_type,
      row.actor_id ?? '',
      row.action,
      row.subject_type ?? '',
      row.subject_id ?? '',
      row.detail ?? '',
      previousHash,
      row.created_at,
    ].join('|');
    const recomputed = sha256(payload);
    if (recomputed !== row.hash) {
      return { ok: false, rows: rows.length, brokenAtSeq: Number(row.seq), detail: 'hash mismatch — the row was modified after it was written' };
    }
    if ((row.prev_hash ?? '') !== previousHash) {
      return { ok: false, rows: rows.length, brokenAtSeq: Number(row.seq), detail: 'previous-hash link is broken' };
    }
    previousHash = row.hash;
    expectedSeq += 1;
  }
  return { ok: true, rows: rows.length, brokenAtSeq: null, detail: `${rows.length} audit rows verified end to end` };
}
