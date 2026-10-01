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

let lastSortableMs = 0;
let sortableCounter = 0;

/**
 * Generate a unique identifier that also sorts in creation order as plain text.
 *
 * Append-only streams (execution logs) are tailed with a keyset cursor of
 * `(created_at, id)`. `created_at` only has millisecond resolution, so several
 * rows written inside the same millisecond tie on the first key and the id has
 * to break the tie *in insertion order* — a random token would order those rows
 * arbitrarily and a reader resuming from the cursor would replay or skip them.
 *
 * Layout: `<prefix>_<48-bit ms, base36, zero padded><per-ms counter, base36,
 * zero padded>_<random>`. The time+counter block is fixed width, so byte-wise
 * (and SQL `>`) comparison equals chronological comparison. The random suffix
 * keeps ids unguessable and unique across processes.
 */
export function createSortableId(prefix?: string): string {
  const now = Date.now();
  if (now === lastSortableMs) {
    sortableCounter += 1;
  } else {
    lastSortableMs = now;
    sortableCounter = 0;
  }
  const time = now.toString(36).padStart(10, '0');
  const counter = sortableCounter.toString(36).padStart(4, '0');
  const token = randomBytes(9).toString('base64url');
  const body = `${time}${counter}_${token}`;
  return prefix ? `${prefix}_${body}` : body;
}
