import { randomBytes } from 'node:crypto';

/**
 * Generate a compact, URL-safe unique identifier for database rows.
 *
 * The platform uses text primary keys (portable across SQLite and PostgreSQL).
 * IDs are not user-controlled and contain no sensitive data.
 */
export function createId(prefix?: string): string {
  const token = randomBytes(12).toString('base64url');
  return prefix ? `${prefix}_${token}` : token;
}
