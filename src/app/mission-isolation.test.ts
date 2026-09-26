/**
 * Regression tests for two defects found on 2026-09-26 by running the real
 * product in a real browser instead of trusting the previous session's report.
 *
 * 1. ZA141251SA ISOLATION BREACH (critical)
 *    `/api/boss/*` reads the PRIVATE mission database and was mounted
 *    unconditionally on the PUBLIC AKBARAL! API, with a guard that failed OPEN
 *    when no dashboard token was configured. `GET /api/boss/overview` through
 *    the public :3000 → :4000 proxy returned the entire private fleet,
 *    treasury and audit totals to an anonymous caller.
 *
 * 2. DEAD BROWSER UI (critical)
 *    `allowedDevOrigins` listed only '*.e2b.app'. Naming any origin replaces
 *    Next's implicit localhost default, so a browser on localhost/127.0.0.1
 *    had /_next/hmr blocked, never finished hydrating, and therefore never
 *    injected public/app.js (it is loaded by <Script strategy="afterInteractive">).
 *    Result: every application screen stayed hidden — a static shell.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('the mission BOSS bridge is disabled unless explicitly enabled AND tokenised', async () => {
  const previousFlag = process.env.AKBARAL_ENABLE_MISSION_BOSS_BRIDGE;
  const previousToken = process.env.ZA141251SA_DASHBOARD_TOKEN;
  const previousLegacy = process.env.MISSION_DASHBOARD_TOKEN;
  const { missionBossBridgeEnabled } = await import('../app');
  try {
    delete process.env.AKBARAL_ENABLE_MISSION_BOSS_BRIDGE;
    delete process.env.ZA141251SA_DASHBOARD_TOKEN;
    delete process.env.MISSION_DASHBOARD_TOKEN;
    assert.equal(missionBossBridgeEnabled(), false, 'default must be OFF');

    process.env.AKBARAL_ENABLE_MISSION_BOSS_BRIDGE = '1';
    assert.equal(missionBossBridgeEnabled(), false, 'opt-in alone must not be enough');

    process.env.ZA141251SA_DASHBOARD_TOKEN = 'short';
    assert.equal(missionBossBridgeEnabled(), false, 'a weak token must not enable it');

    process.env.ZA141251SA_DASHBOARD_TOKEN = 'a'.repeat(48);
    assert.equal(missionBossBridgeEnabled(), true, 'opt-in + strong token enables it');

    delete process.env.AKBARAL_ENABLE_MISSION_BOSS_BRIDGE;
    assert.equal(missionBossBridgeEnabled(), false, 'a token alone must not enable it');
  } finally {
    if (previousFlag === undefined) delete process.env.AKBARAL_ENABLE_MISSION_BOSS_BRIDGE;
    else process.env.AKBARAL_ENABLE_MISSION_BOSS_BRIDGE = previousFlag;
    if (previousToken === undefined) delete process.env.ZA141251SA_DASHBOARD_TOKEN;
    else process.env.ZA141251SA_DASHBOARD_TOKEN = previousToken;
    if (previousLegacy === undefined) delete process.env.MISSION_DASHBOARD_TOKEN;
    else process.env.MISSION_DASHBOARD_TOKEN = previousLegacy;
  }
});

test('the BOSS router guard fails closed (no token configured => not routable)', () => {
  const source = readFileSync(path.join(process.cwd(), 'src', 'routes', 'boss-dashboard.ts'), 'utf8');
  assert.ok(
    !/if\s*\(!missionToken\)\s*\{[^}]*return next\(\)/s.test(source),
    'the guard must never call next() when no token is configured',
  );
  assert.match(source, /timingSafeEqual/, 'token comparison must be constant time');
  assert.match(source, /missionToken\.length < 32/, 'a missing/weak token must be rejected');
});

test('dev-origin allowlist keeps local hosts so the SPA actually boots in a browser', async () => {
  const config = (await import(path.join(process.cwd(), 'next.config.mjs'))).default;
  const origins: string[] = config.allowedDevOrigins ?? [];
  assert.ok(origins.includes('localhost'), 'localhost must stay allowed');
  assert.ok(origins.includes('127.0.0.1'), '127.0.0.1 must stay allowed');
  assert.ok(
    origins.some((entry) => entry.includes('e2b.app')),
    'the sandbox preview host must stay allowed',
  );
});

test('the development start wrapper persists SESSION_SECRET like production does', () => {
  const dev = readFileSync(path.join(process.cwd(), 'scripts', 'start-dev.mjs'), 'utf8');
  assert.match(dev, /ensureSessionSecret/, 'dev must reuse the shared persisted-secret contract');
  const shared = readFileSync(path.join(process.cwd(), 'scripts', 'lib', 'session-secret.mjs'), 'utf8');
  assert.match(shared, /\.session-secret/, 'the secret must be persisted to disk');
});
