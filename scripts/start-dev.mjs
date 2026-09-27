import { spawn } from 'node:child_process';
import { ensureSessionSecret } from './lib/session-secret.mjs';

import { existsSync as __envFileExists } from 'node:fs';
// Load `.env` exactly like the application does (src/config/env.ts) BEFORE any
// startup decision is made. Without this the wrapper judged SESSION_SECRET,
// DATABASE_URL and the mission variables as "not set" while the child
// processes — which do load .env — saw them, producing contradictory startup
// logs and a per-process session secret. dotenv never overrides a variable the
// host already injected, so real deployments are unaffected.
if (__envFileExists('.env')) {
  const { config: __loadEnvFile } = await import('dotenv');
  __loadEnvFile();
}


/**
 * Development start for the AKBARAL! platform.
 *
 *   api  — Express + SQLite + execution stream on :4000 (internal)
 *   web  — Next.js dev server on :3000 (public; proxies /api, /uploads, /ws)
 *
 * SESSION_SECRET is resolved through the SAME persisted-secret contract the
 * production wrapper uses (scripts/lib/session-secret.mjs). Without this, the
 * development API generated a fresh in-process secret on every restart and
 * every previously issued JWT stopped verifying — logging every developer and
 * every browser session out on each reload.
 */
const children = [];
function launch(name, command, args, env) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: 'inherit' });
  child.name = name;
  children.push(child);
  return child;
}
function shutdown(signal = 'SIGTERM') {
  for (const child of children) {
    if (!child.killed) { try { child.kill(signal); } catch {} }
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const secret = ensureSessionSecret((message) => console.log(`[akbaral] ${message}`));
process.env.SESSION_SECRET = secret.value;

const api = launch('api', 'npx', ['tsx', 'src/index.ts'], {
  PORT: '4000',
  NODE_ENV: 'development',
  SESSION_SECRET: secret.value,
});
const web = launch('web', 'node_modules/.bin/next', ['dev', '-H', '0.0.0.0', '-p', '3000'], { NODE_ENV: 'development' });

api.on('exit', (code) => { shutdown(); process.exit(code ?? 0); });
web.on('exit', (code) => { shutdown(); process.exit(code ?? 0); });
