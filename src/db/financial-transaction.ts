/**
 * Serialize each private treasury's read/check/write decisions. SQLite uses
 * BEGIN IMMEDIATE in the shared driver; PostgreSQL needs an explicit lock
 * before reading balances (READ COMMITTED alone permits double allocation).
 * Different lock namespaces never combine mission and platform money.
 * Only synchronous local DB work belongs here: never await a provider call.
 */
interface FinancialDatabase {
  readonly engine: 'sqlite' | 'postgres';
  transaction<T>(callback: () => T): T;
  get<T>(sql: string): T | undefined;
}

export function financialTransaction<T>(database: FinancialDatabase, scope: 'economy' | 'mission', work: () => T): T {
  return database.transaction(() => {
    if (database.engine === 'postgres') {
      database.get(`SELECT pg_advisory_xact_lock(141251, ${scope === 'economy' ? 1 : 2})`);
    }
    const value = work();
    if (value && typeof (value as { then?: unknown }).then === 'function') {
      throw new Error('financial transactions must be synchronous; call providers outside the transaction');
    }
    return value;
  });
}
