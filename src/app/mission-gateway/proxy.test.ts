import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const here = path.resolve(process.cwd(), 'src/app/mission-gateway');
const route = fs.readFileSync(path.join(here, '[[...path]]/route.ts'), 'utf8');
const shell = fs.readFileSync(path.join(here, '../_components/app-shell.tsx'), 'utf8');

test('mission proxy is owner-gated before upstream access', () => {
  assert.match(route, /ownerAuthorized\(request\)/);
  assert.match(route, /if \(!auth\.ok\) return refusal\(auth\.status\)/);
  assert.match(route, /verifyAccessToken/);
  assert.match(route, /activeSessionExists/);
  assert.match(route, /payload\.role !== 'owner' && payload\.role !== 'super_admin'/);
  assert.match(route, /127\.0\.0\.1/);
  assert.match(route, /cache-control.*no-store/);
});

test('proxy does not forward the public cookie or authorization and has honest upstream failure handling', () => {
  assert.match(route, /function forwardedHeaders/);
  assert.doesNotMatch(route, /headers\.set\(['"]cookie/);
  assert.doesNotMatch(route, /headers\.set\(['"]authorization['"].*request/);
  assert.match(route, /MISSION_SESSION_ENV/);
  assert.match(route, /status: 502/);
  assert.match(route, /mission service is unavailable/);
});

test('proxy preserves method, query and response streaming for mission paths', () => {
  assert.match(route, /upstreamPath\(path, request\)/);
  assert.match(route, /request\.nextUrl\.search/);
  assert.match(route, /method: request\.method/);
  assert.match(route, /new Response\(upstream\.body/);
  assert.match(route, /return new Response\(upstream\.body, \{ status: upstream\.status, headers: responseHeaders \}\)/); // SSE and all non-asset bodies stream unchanged
});

test('only the mission prefix gets an owner console entry point', () => {
  assert.match(shell, /href="\/mission-gateway\/"/);
  assert.match(shell, /canOwner \? <Link href="\/mission-gateway\//);
  assert.match(shell, /aria-current=\{pathname\.startsWith\('\/mission-gateway'\)/);
  assert.doesNotMatch(shell, /Mission Control.*NAV_GROUPS/);
});
