/** Platform connection facade. Private applications must import ./driver instead. */
import { Database } from './driver';
export * from './driver';

/**
 * Application-wide default connection.
 *
 * `DATABASE_URL` selects the engine:
 *   - `file:./data/akbaral.db` or `:memory:` → SQLite (local dev, tests)
 *   - `postgres://…` / `postgresql://…`    → PostgreSQL (Neon production)
 */
export const db = new Database();
