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

/* ------------------------------------------------------------------ ports
 * The PUBLIC entry point is the Next.js tier: it serves the app and rewrites
 * /api, /uploads and /ws to the API tier (next.config.mjs). So the public port
 * belongs to the web tier, and the API keeps an internal port.
 *
 * Platform hosts (StackHost, Render, Fly, …) inject the port they route
 * traffic to as PORT. Precedence, chosen so no existing deployment changes
 * behaviour:
 *   web — AKBARAL_WEB_PORT, else PORT when it does not collide with the API
 *         port, else 3000
 *   api — AKBARAL_API_PORT, else 4000
 * A PORT that equals the API port therefore keeps its historical meaning
 * (preview/panel scripts export PORT=<api port>) and the web tier stays on
 * 3000, while a platform-injected PORT on any other value moves the public
 * tier as the platform expects.
 */
const portOf = (value) => {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return parsed >= 1 && parsed <= 65535 ? parsed : null;
};
const apiPort = portOf(process.env.AKBARAL_API_PORT) ?? 4000;
const explicitWebPort = portOf(process.env.AKBARAL_WEB_PORT);
const platformPort = portOf(process.env.PORT);
const webPort = explicitWebPort ?? (platformPort !== null && platformPort !== apiPort ? platformPort : 3000);
for (const [name, value] of [['AKBARAL_WEB_PORT', process.env.AKBARAL_WEB_PORT], ['AKBARAL_API_PORT', process.env.AKBARAL_API_PORT], ['PORT', process.env.PORT]]) {
  if (String(value ?? '').trim() !== '' && portOf(value) === null) {
    console.error(`[akbaral] invalid ${name} "${value}" (expected an integer between 1 and 65535)`);
    process.exit(1);
  }
}

// Diagnostics (no side effects): report exactly which ports this process would
// bind, so hosts and operators can verify the contract instead of guessing.
// Exits non-zero for an invalid port, like the real start does.
if (process.argv.includes('--print-ports')) {
  console.log(JSON.stringify({ roles: ROLES, publicPort: webPort, webPort, apiPort }));
  process.exit(0);
}

if (ROLES !== 'api') {
  const web = launch('web', 'node_modules/.bin/next', ['start', '-p', String(webPort), '-H', '0.0.0.0'], { NODE_ENV: 'production' });
  web.on('exit', (code) => {
    console.log(`[akbaral] web exited with code ${code}`);
    shutdown();
    process.exit(code ?? 0);
  });
}
if (ROLES !== 'web') {
  const api = launch('api', 'node', ['dist/src/index.js'], { PORT: String(apiPort), NODE_ENV: 'production' });
  api.on('exit', (code) => {
    console.log(`[akbaral] api exited with code ${code}`);
    shutdown();
    process.exit(code ?? 0);
  });
}
console.log(
  `[akbaral] AKBARAL_ROLES=${ROLES} — ` +
    (ROLES === 'both'
      ? `web :${webPort} (public) + api :${apiPort} (internal)`
      : ROLES === 'web'
        ? `web :${webPort} only (public; backend via NEXT_BACKEND_URL)`
        : `api :${apiPort} only`),
);
