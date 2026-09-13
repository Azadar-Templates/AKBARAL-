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

// NODE_ENV=production on the API too: the development flag would relax the
// mandatory-SESSION_SECRET startup guard (production hardening, Milestone 10).
//
// AKBARAL_ROLES selects which tiers run in this container (deployment
// plumbing for hosts with small per-container memory limits, e.g. the
// Zeabur free plan):
//   both (default) — the normal single-container production stack (Modal etc.)
//   web            — only the Next.js tier (:3000); proxy /api,/uploads,/ws to
//                    another container via NEXT_BACKEND_URL (next.config.mjs)
//   api            — only the API/Express tier (:4000)
const ROLES = (process.env.AKBARAL_ROLES ?? 'both').toLowerCase();
if (!['both', 'web', 'api'].includes(ROLES)) {
  console.error(`[akbaral] invalid AKBARAL_ROLES "${ROLES}" (expected both|web|api)`);
  process.exit(1);
}
if (ROLES !== 'api') {
  const web = launch('web', 'node_modules/.bin/next', ['start', '-p', '3000'], { NODE_ENV: 'production' });
  web.on('exit', (code) => {
    console.log(`[akbaral] web exited with code ${code}`);
    shutdown();
    process.exit(code ?? 0);
  });
}
if (ROLES !== 'web') {
  const api = launch('api', 'node', ['dist/src/index.js'], { PORT: '4000', NODE_ENV: 'production' });
  api.on('exit', (code) => {
    console.log(`[akbaral] api exited with code ${code}`);
    shutdown();
    process.exit(code ?? 0);
  });
}
console.log(`[akbaral] AKBARAL_ROLES=${ROLES} — ${ROLES === 'both' ? 'api :4000 + web :3000' : ROLES === 'web' ? 'web :3000 only (backend via NEXT_BACKEND_URL)' : 'api :4000 only'}`);
