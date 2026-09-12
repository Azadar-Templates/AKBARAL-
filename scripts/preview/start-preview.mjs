#!/usr/bin/env node
/**
 * AKBARAL! — persistent preview supervisor for the Arena sandbox.
 *
 * WHY THIS EXISTS (preview lifecycle, September 2026 incident):
 *   The Arena sandbox is PAUSED between active turns (microVM suspend).
 *   Processes are NOT killed — they are frozen with the VM and resume
 *   intact (verified: identical PIDs serving requests across a pause
 *   window, kernel uptime missing exactly the paused minutes). While the
 *   sandbox is paused the preview ports are unreachable and the platform
 *   serves its own "Something went wrong. Please try again." page. No
 *   in-sandbox mechanism can serve HTTP during a pause; the sandbox wakes
 *   when the user sends the next message, and the preview heals with it.
 *
 *   What this supervisor DOES fix — every in-sandbox failure mode:
 *     - crashed or missing web/api/fixture children (restarts them),
 *     - cold starts after a workspace restore (ensures DB, then boots),
 *     - deterministic binding (web on 0.0.0.0, api on 0.0.0.0),
 *   and it is IDEMPOTENT: if a healthy stack is already running it adopts
 *   it instead of spawning port conflicts.
 *
 * Honest scope note: the local Gemini-protocol fixture is the PREVIEW's
 * stand-in for Google ONLY because the sandbox blocks external egress.
 * Production (Modal) uses the real GOOGLE_API_KEY from the
 * `akbaral-production` secret — nothing here fakes production behavior.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const STATE_DIR = join(ROOT, 'data', 'preview');
const LOG = join(STATE_DIR, 'preview.log');
const STATUS = join(STATE_DIR, 'status.json');
const FIXTURE_PORT = Number(process.env.PREVIEW_FIXTURE_PORT ?? 32911);
const WEB_PORT = Number(process.env.PREVIEW_WEB_PORT ?? 3000);
const API_PORT = Number(process.env.PREVIEW_API_PORT ?? 4000);

const ENV = {
  ...process.env,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ?? 'preview-local-key',
  GOOGLE_BASE_URL: process.env.GOOGLE_BASE_URL ?? `http://127.0.0.1:${FIXTURE_PORT}/v1beta`,
  AKBARAL_ALLOW_PRIVATE_PROVIDER: '1',
  AKBARAL_SEARCH_ENDPOINT: process.env.AKBARAL_SEARCH_ENDPOINT ?? 'http://127.0.0.1:9/search',
  PORT: String(API_PORT),
  NODE_ENV: 'development',
};

function log(line) {
  const entry = `[${new Date().toISOString()}] ${line}`;
  console.log(entry);
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(LOG, `${entry}\n`);
  } catch {}
}

function writeStatus(state) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATUS, JSON.stringify({ ...state, at: new Date().toISOString() }, null, 2));
  } catch {}
}

async function healthy(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function stackHealthy() {
  const web = await healthy(`http://127.0.0.1:${WEB_PORT}/`);
  const api = await healthy(`http://127.0.0.1:${API_PORT}/api/health`);
  return { web, api, ok: web && api };
}

function ensureDatabase() {
  const dbPath = join(ROOT, 'data', 'akbaral.db');
  if (existsSync(dbPath)) return;
  log('cold start: database missing — migrating + seeding (one time, ~30s)');
  execFileSync('npx', ['tsx', 'src/db/migrate.ts'], { cwd: ROOT, env: { ...ENV, DATABASE_URL: 'file:./data/akbaral.db' }, stdio: 'inherit' });
  execFileSync('npx', ['tsx', 'src/db/seed.ts'], { cwd: ROOT, env: { ...ENV, DATABASE_URL: 'file:./data/akbaral.db' }, stdio: 'inherit' });
}

let children = [];
let restarts = 0;

function spawnTree() {
  children = [];
  const fixture = spawn('node', ['scripts/preview/gemini-fixture-server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(FIXTURE_PORT) },
    stdio: 'inherit',
    detached: false,
  });
  fixture.on('exit', (code) => log(`fixture exited (code ${code})`));
  children.push(fixture);

  const stack = spawn('node', ['scripts/start-dev.mjs'], {
    cwd: ROOT,
    env: { ...ENV },
    stdio: 'inherit',
    detached: false,
  });
  stack.on('exit', (code) => log(`web+api stack exited (code ${code})`));
  children.push(stack);
}

function killTree() {
  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {}
    }
  }
  children = [];
}

async function main() {
  log('preview supervisor starting');
  writeStatus({ state: 'starting', webPort: WEB_PORT, apiPort: API_PORT, restarts });

  // Idempotent: adopt a healthy already-running stack.
  const existing = await stackHealthy();
  if (existing.ok) {
    log(`adopted already-healthy stack (web :${WEB_PORT}, api :${API_PORT}) — monitoring, no respawn`);
  } else {
    log(`stack not healthy (web=${existing.web} api=${existing.api}) — cold start`);
    ensureDatabase();
    spawnTree();
  }

  let failures = 0;
  let lastOk = Date.now();
  const MONITOR_MS = 5000;
  const RESTART_AFTER_FAILURES = 3;

  const monitor = setInterval(async () => {
    const state = await stackHealthy();
    if (state.ok) {
      failures = 0;
      lastOk = Date.now();
      writeStatus({ state: 'healthy', webPort: WEB_PORT, apiPort: API_PORT, restarts, lastOk: new Date(lastOk).toISOString() });
      return;
    }
    failures += 1;
    writeStatus({ state: `degraded (web=${state.web} api=${state.api}, failures=${failures})`, webPort: WEB_PORT, apiPort: API_PORT, restarts });
    if (failures >= RESTART_AFTER_FAILURES) {
      restarts += 1;
      failures = 0;
      log(`stack unhealthy ${RESTART_AFTER_FAILURES}x — restarting (restart #${restarts})`);
      killTree();
      await new Promise((r) => setTimeout(r, 2000));
      ensureDatabase();
      spawnTree();
    }
  }, MONITOR_MS);

  const shutdown = () => {
    log('supervisor stopping — shutting children down gracefully');
    clearInterval(monitor);
    killTree();
    writeStatus({ state: 'stopped', webPort: WEB_PORT, apiPort: API_PORT, restarts });
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  log(`supervisor fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
