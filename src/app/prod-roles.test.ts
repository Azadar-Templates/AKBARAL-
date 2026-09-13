import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Contract lock for scripts/start-prod.mjs tier roles (deployment plumbing).
 *
 * AKBARAL_ROLES=both|web|api lets one image run the full stack (default,
 * e.g. Modal/Zeabur single service) or a single tier — the escape hatch for
 * hosts whose free tier caps per-container memory too low for two Node
 * processes. next.config.mjs already routes /api,/uploads,/ws through
 * NEXT_BACKEND_URL, so a split deployment needs env vars only — no image
 * or code divergence.
 */

const source = readFileSync('scripts/start-prod.mjs', 'utf8');

test('AKBARAL_ROLES is honored with a safe default', () => {
  assert.match(source, /AKBARAL_ROLES \?\? 'both'/, 'default must be both (single-container stack, backward compatible)');
  assert.match(source, /\['both', 'web', 'api'\]\.includes\(ROLES\)/, 'invalid roles must fail fast');
  assert.match(source, /invalid AKBARAL_ROLES/, 'invalid role must print an explicit error');
});

test('each tier is independently gated', () => {
  assert.match(source, /ROLES !== 'api'[\s\S]{0,400}?launch\('web'/, "web tier launches unless ROLES==='api'");
  assert.match(source, /ROLES !== 'web'[\s\S]{0,400}?launch\('api'/, "api tier launches unless ROLES==='web'");
});

test('tier ports and production flags are unchanged', () => {
  assert.match(source, /next.*start.*-p.*3000/s, 'web stays on :3000');
  assert.match(source, /dist\/src\/index\.js.*PORT.*4000/s, 'api stays on dist/src/index.js with PORT=4000');
  assert.match(source, /NODE_ENV: 'production'/, 'API keeps NODE_ENV=production (SESSION_SECRET guard stays mandatory)');
});
