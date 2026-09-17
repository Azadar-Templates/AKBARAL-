import path from 'node:path';
import { env } from '../config/env';

/**
 * Resolve a `DATABASE_URL`-style SQLite URL to a filesystem path.
 *
 * Supported forms:
 *   - `file:./data/akbaral.db`  (relative to the repository root)
 *   - `file:/absolute/path.db`
 *   - `:memory:`                (SQLite in-memory database)
 */
export function resolveDatabasePath(databaseUrl: string = env.databaseUrl): string {
  const withoutScheme = databaseUrl.startsWith('file:')
    ? databaseUrl.slice('file:'.length)
    : databaseUrl;

  if (withoutScheme === ':memory:') {
    return ':memory:';
  }

  if (path.isAbsolute(withoutScheme)) {
    return withoutScheme;
  }

  return path.resolve(process.cwd(), withoutScheme);
}
