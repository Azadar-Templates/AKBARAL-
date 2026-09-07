import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { env } from '../config/env';
import { resolveDatabasePath } from './path';

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export type SqlValue = SQLInputValue;

/**
 * Thin, typed wrapper around Node's built-in SQLite driver.
 *
 * The connection is intentionally tiny and transparent so production later can
 * swap it for PostgreSQL through a dedicated repository layer. All SQL in the
 * project goes through this wrapper to make querying consistent and testable.
 */
export class Database {
  readonly filePath: string;
  private readonly connection: DatabaseSync;

  constructor(databaseUrl: string = env.databaseUrl, options?: { timeoutMs?: number }) {
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

  get isOpen(): boolean {
    return this.connection.isOpen;
  }

  get isTransaction(): boolean {
    return this.connection.isTransaction;
  }

  exec(sql: string): void {
    this.connection.exec(sql);
  }

  run(sql: string, params: SqlValue[] = []): RunResult {
    return this.connection.prepare(sql).run(...params) as unknown as RunResult;
  }

  get<T>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.connection.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, params: SqlValue[] = []): T[] {
    return this.connection.prepare(sql).all(...params) as T[];
  }

  transaction<T>(callback: (db: Database) => T): T {
    if (this.isTransaction) {
      return callback(this);
    }

    this.connection.exec('BEGIN IMMEDIATE;');
    try {
      const result = callback(this);
      this.connection.exec('COMMIT;');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK;');
      throw error;
    }
  }

  tableExists(name: string): boolean {
    const row = this.get<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      [name],
    );
    return Boolean(row);
  }

  close(): void {
    if (this.connection.isOpen) {
      this.connection.close();
    }
  }
}

/**
 * Application-wide default connection.
 *
 * `DATABASE_URL` is read from the environment, so tests simply set
 * `DATABASE_URL=file:./test.db` before spawning the process.
 */
export const db = new Database();
