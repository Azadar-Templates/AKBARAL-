import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Contract lock for scripts/start-prod.mjs tier roles and ports (deployment
 * plumbing).
 *
 * AKBARAL_ROLES=both|web|api lets one image run the full stack (default,
 * e.g. Modal/Zeabur single service) or a single tier — the escape hatch for
 * hosts whose free tier caps per-container memory too low for two Node
 * processes. next.config.mjs already routes /api,/uploads,/ws through
 * NEXT_BACKEND_URL, so a split deployment needs env vars only — no image
 * or code divergence.
 *
 * Ports: the PUBLIC entry point is the Next.js tier (it serves the app and
 * proxies /api,/uploads,/ws to the API tier), so platform hosts that inject
 * the port they route traffic to as PORT must see the WEB tier on that port
 * while the API stays internal. The precedence below is asserted by EXECUTING
 * the real script's `--print-ports` mode (no servers are started), not by
 * matching its text:
 *
 *   AKBARAL_WEB_PORT wins; else PORT (the port the platform routes traffic to);
 *   else 3000. The API keeps AKBARAL_API_PORT, else 4000 — and only when that
 *   would collide with the resolved public port does it step to the next free
 *   port (4001), so the platform's injected port is ALWAYS served by the web tier.
 *
 * Contract change (2026-09-22, Blitz): PORT=<api port> used to keep the web tier
 * on 3000. Blitz injects PORT=4000, which left the public port unserved and the
 * app stuck on "Starting up" with no output. PORT now always moves the web tier
 * and the API steps aside on collision instead.
 */

const source = readFileSync('scripts/start-prod.mjs', 'utf8');

/** Run the real script's diagnostics mode with an isolated port environment. */
function printPorts(env: Record<string, string>): { status: number; body: Record<string, unknown>; stderr: string } {
  const result = spawnSync(process.execPath, ['scripts/start-prod.mjs', '--print-ports'], {
    env: { ...process.env, PORT: '', AKBARAL_WEB_PORT: '', AKBARAL_API_PORT: '', ...env },
    encoding: 'utf8',
  });
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse((result.stdout ?? '').trim().split('\n').at(-1) ?? '{}');
  } catch {
    body = {};
  }
  return { status: result.status ?? 1, body, stderr: result.stderr ?? '' };
}

test('AKBARAL_ROLES is honored with a safe default', () => {
  assert.match(source, /AKBARAL_ROLES \?\? 'both'/, 'default must be both (single-container stack, backward compatible)');
  assert.match(source, /\['both', 'web', 'api'\]\.includes\(ROLES\)/, 'invalid roles must fail fast');
  assert.match(source, /invalid AKBARAL_ROLES/, 'invalid role must print an explicit error');
});

test('each tier is independently gated', () => {
  assert.match(source, /ROLES !== 'api'[\s\S]{0,600}?launch\('web'/, "web tier launches unless ROLES==='api'");
  assert.match(source, /ROLES !== 'web'[\s\S]{0,400}?launch\('api'/, "api tier launches unless ROLES==='web'");
});

test('the tiers stay wired to the resolved ports and production flags', () => {
  assert.match(source, /launch\('web'[\s\S]{0,200}?'-p', String\(webPort\)/, 'web must bind the resolved public port');
  assert.match(source, /launch\('web'[\s\S]{0,200}?'-H', '0\.0\.0\.0'/, 'web must bind all interfaces so the platform proxy can reach it');
  assert.match(source, /dist\/src\/index\.js'[\s\S]{0,80}?PORT: String\(apiPort\)/, 'api keeps dist/src/index.js on the resolved (internal) port');
  assert.match(source, /NODE_ENV: 'production'/, 'API keeps NODE_ENV=production (SESSION_SECRET guard stays mandatory)');
});

test('default ports are unchanged for every existing deployment', () => {
  const bare = printPorts({});
  assert.equal(bare.status, 0, `--print-ports must succeed (stderr: ${bare.stderr.slice(0, 120)})`);
  assert.equal(bare.body.webPort, 3000, 'with no port env the web tier stays on 3000');
  assert.equal(bare.body.apiPort, 4000, 'with no port env the API stays on 4000');

  // Blitz (2026-09-22) injects PORT=4000, its own default. The public tier must
  // serve that port, so the API steps to 4001 rather than the web tier refusing
  // to move — the previous behaviour left the injected port unserved and Blitz
  // stuck on "Starting up" with no application output at all.
  const blitzStyle = printPorts({ PORT: '4000' });
  assert.equal(blitzStyle.status, 0);
  assert.equal(blitzStyle.body.webPort, 4000, 'PORT=<api port> must move the PUBLIC tier so the injected port is served');
  assert.equal(blitzStyle.body.publicPort, 4000, 'the reported public port is the web tier');
  assert.equal(blitzStyle.body.apiPort, 4001, 'the API steps off its default instead of colliding with the public port');
});

test('a platform-injected PORT moves the PUBLIC tier only', () => {
  for (const injected of ['8080', '3000', '5000']) {
    const run = printPorts({ PORT: injected });
    assert.equal(run.status, 0, `PORT=${injected} must be accepted`);
    assert.equal(run.body.webPort, Number(injected), `the public (web) tier must bind the platform port ${injected}`);
    assert.equal(run.body.publicPort, Number(injected), 'the reported public port is the web tier');
    assert.equal(run.body.apiPort, 4000, 'the API stays internal on 4000');
  }
});

test('explicit overrides win, and an impossible port refuses to start', () => {
  assert.equal(printPorts({ AKBARAL_WEB_PORT: '4321' }).body.webPort, 4321, 'AKBARAL_WEB_PORT names the public port');
  assert.equal(printPorts({ PORT: '8080', AKBARAL_WEB_PORT: '9090' }).body.webPort, 9090, 'an explicit web port beats an injected PORT');
  assert.equal(printPorts({ AKBARAL_API_PORT: '5000' }).body.apiPort, 5000, 'AKBARAL_API_PORT moves the internal API port');
  assert.equal(printPorts({ AKBARAL_API_PORT: '5000' }).body.webPort, 3000, 'moving the API leaves the public default alone');

  for (const bad of ['not-a-port', '0', '70000', '-1']) {
    const run = printPorts({ PORT: bad });
    assert.equal(run.status, 1, `PORT=${bad} must refuse to start`);
    assert.match(run.stderr, /invalid PORT/, 'the refusal must name the offending variable');
  }
});
