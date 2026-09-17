/**
 * PostgreSQL integration harness for AKBARAL!.
 *
 * Spins up @electric-sql/pglite behind its socket server (a real PostgreSQL
 * engine speaking the real wire protocol, in-process) and exports the
 * DATABASE_URL for integration runs. This lets the full PostgreSQL engine
 * path — the SharedArrayBuffer sync bridge, dialect translation, pg
 * migrations — be tested end-to-end locally before ever touching Neon.
 *
 * Usage:  node scripts/pg-test-server.mjs --run <cmd>   (start, run cmd, stop)
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';

const port = Number(process.env.PG_TEST_PORT || 5433);
// Persist to disk so migrate → seed → audit → tests share one database
// across separate command runs (like a real server would).
const dataDir = process.env.PG_TEST_DATA_DIR || '.pglite-test';
const db = await PGlite.create(dataDir);
const server = new PGLiteSocketServer({ db, port, maxConnections: 16 });
await server.start();

const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
console.log(`[pg-test] pglite socket server listening on :${port} (real wire protocol)`);

const idx = process.argv.indexOf('--run');
const cmd = process.argv.slice(idx + 1);
if (idx !== -1 && cmd.length > 0) {
  console.log(`[pg-test] running: ${cmd.join(' ')}`);
  // Asynchronous spawn: this process's event loop must stay alive to serve
  // the pglite wire protocol while the child runs (spawnSync would deadlock
  // the in-process server against the child's first query).
  const child = spawn(cmd[0], cmd.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, PG_TEST_DATABASE_URL: url },
  });
  const code = await new Promise((resolve) => {
    child.on('exit', (c) => resolve(c ?? 1));
    child.on('error', () => resolve(1));
  });
  await server.stop();
  await db.close().catch(() => {});
  process.exit(code);
}

console.log(`[pg-test] DATABASE_URL=${url}`);
console.log('[pg-test] (foreground; ctrl-c to stop)');
await new Promise(() => {});
