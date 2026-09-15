import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * PRIVATE MISSION DATABASE — its own file, its own schema, its own migrations.
 *
 * Deliberately independent of the AKBARAL! platform database layer: this module
 * never imports `src/db`, so a mission query can never read or write a customer
 * table (and vice versa). The only supported connection string is
 * ZA141251SA_DATABASE_URL (default: ./mission.db).
 *
 * Isolation rules enforced here:
 *   · the schema lives in db/migrations-mission/ (never db/migrations/);
 *   · migrations are applied by this module only;
 *   · money columns are integer minor units, and balances are checked >= 0 by
 *     the schema itself.
 */

const DEFAULT_DATABASE_URL = 'file:./mission.db';

export interface MissionEnv {
  databaseUrl: string;
  sessionSecret: string | null;
  credentialKey: string | null;
  currency: string;
  bindHost: string;
  port: number;
}

export function missionEnv(): MissionEnv {
  const raw = (process.env.ZA141251SA_DATABASE_URL ?? process.env.MISSION_DATABASE_URL ?? DEFAULT_DATABASE_URL).trim();
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

class MissionDatabase {
  private handle: DatabaseSync | null = null;
  private filePath = '';
  private depth = 0;
  private savepointSeq = 0;

  path(): string {
    return this.filePath;
  }

  private open(): DatabaseSync {
    if (this.handle) return this.handle;
    const env = missionEnv();
    this.filePath = resolveMissionDbPath(env.databaseUrl);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.handle = new DatabaseSync(this.filePath);
    this.handle.exec('PRAGMA journal_mode = WAL;');
    this.handle.exec('PRAGMA foreign_keys = ON;');
    this.handle.exec('PRAGMA busy_timeout = 5000;');
    return this.handle;
  }

  close(): void {
    if (this.handle) {
      this.handle.close();
      this.handle = null;
    }
  }

  exec(sql: string): void {
    this.open().exec(sql);
  }

  run(sql: string, params: SqlValue[] = []): { changes: number; lastInsertRowid: number | bigint } {
    const result = this.open().prepare(sql).run(...(params as never[]));
    return { changes: Number(result.changes ?? 0), lastInsertRowid: Number(result.lastInsertRowid ?? 0) };
  }

  get<T = Row>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.open().prepare(sql).get(...(params as never[])) as T | undefined;
  }

  all<T = Row>(sql: string, params: SqlValue[] = []): T[] {
    return this.open().prepare(sql).all(...(params as never[])) as T[];
  }

  /**
   * Run `fn` in a transaction. Nested calls are supported through SAVEPOINTs,
   * so higher-level units of work (creating an agent, recording revenue) can
   * compose smaller transactional helpers without "transaction within a
   * transaction" failures — an inner failure rolls back only the inner work and
   * still surfaces as an error.
   */
  transaction<T>(fn: () => T): T {
    const handle = this.open();
    if (this.depth > 0) {
      const savepoint = `mission_sp_${(this.savepointSeq += 1)}`;
      handle.exec(`SAVEPOINT ${savepoint}`);
      this.depth += 1;
      try {
        const result = fn();
        handle.exec(`RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        try {
          handle.exec(`ROLLBACK TO ${savepoint}`);
          handle.exec(`RELEASE ${savepoint}`);
        } catch {
          /* rollback best-effort */
        }
        throw error;
      } finally {
        this.depth -= 1;
      }
    }
    handle.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try {
      const result = fn();
      handle.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        handle.exec('ROLLBACK');
      } catch {
        /* rollback best-effort */
      }
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  /** Number of tables in the mission database (health/diagnostics). */
  tableCount(): number {
    const row = this.get<{ count: number }>("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'");
    return Number(row?.count ?? 0);
  }

  tableExists(name: string): boolean {
    const row = this.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [name],
    );
    return Boolean(row);
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
  return { applied, total: files.length };
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
