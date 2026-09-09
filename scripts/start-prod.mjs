import { spawn } from 'node:child_process';

/**
 * Production start for the AKBARAL platform.
 *
 * - Express API + SQLite + execution stream run on :4000.
 * - Next.js 16 App Router serves the premium AKBARAL homepage and SPA on :3000.
 * - `next.config.mjs` rewrites `/api/*` and `/uploads/*` to the API server, so
 *   the existing authentication, MASTER AI, agents, factory, marketplace,
 *   workspace, CRM, billing, feedback, admin and security routes stay real.
 */
const children = [];

function launch(name, command, args, env) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: 'inherit' });
  child.name = name;
  children.push(child);
  return child;
}

function shutdown(signal = 'SIGTERM') {
  console.log(`[akbaral] start wrapper received ${signal}`);
  for (const child of children) {
    if (!child.killed) {
      try { child.kill(signal); } catch {}
    }
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const api = launch('api', 'node', ['dist/src/index.js'], { PORT: '4000', NODE_ENV: 'development' });
const web = launch('web', 'node_modules/.bin/next', ['start', '-p', '3000'], { NODE_ENV: 'production' });

api.on('exit', (code) => {
  console.log(`[akbaral] api exited with code ${code}`);
  shutdown();
  process.exit(code ?? 0);
});
web.on('exit', (code) => {
  console.log(`[akbaral] web exited with code ${code}`);
  shutdown();
  process.exit(code ?? 0);
});
