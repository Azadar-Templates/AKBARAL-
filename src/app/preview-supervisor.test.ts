import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Regression lock for the preview supervisor's orphan-clearing contract.
 *
 * Live-testing (2026-09-12) found a crash loop: killTree's pattern
 * 'tsx src/index.ts' matched only the npm launcher, NOT the real api
 * server, whose actual cmdline is
 *   node --require …/tsx/dist/preflight.cjs --import …/loader.mjs src/index.ts
 * The orphaned server kept :4000, so every supervisor respawn died with
 * EADDRINUSE. This test pins the corrected patterns against the REAL
 * process cmdlines, and guards that no pattern can kill the supervisor
 * itself or that a respawn can race an orphan still holding a port.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const supervisorPath = join(repoRoot, 'scripts', 'preview', 'start-preview.mjs');
const source = readFileSync(supervisorPath, 'utf8');

function killPatterns(): string[] {
  const match = source.match(/const patterns = \[([\s\S]*?)\];/);
  assert.ok(match, 'killTree patterns array must exist in start-preview.mjs');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** pkill -f treats the pattern as a regex matched against the full cmdline. */
const matches = (cmdline: string, pattern: string) => new RegExp(pattern).test(cmdline);

const REAL_SERVER_CMDLINES: Array<[string, string]> = [
  [
    'api server (real process, not the npm wrapper)',
    '/usr/local/bin/node --require /app/node_modules/tsx/dist/preflight.cjs --import file:///app/node_modules/tsx/dist/loader.mjs src/index.ts',
  ],
  ['api launcher (npm exec wrapper)', 'npm exec tsx src/index.ts'],
  ['next dev wrapper', '/usr/local/bin/node /app/node_modules/.bin/next dev -H 0.0.0.0 -p 3000'],
  ['next-server (real web process)', 'next-server (v16.3.4)'],
  ['start-dev orchestrator', 'node scripts/start-dev.mjs'],
  ['gemini fixture server', 'node scripts/preview/gemini-fixture-server.mjs'],
];

test('killTree patterns match every real preview process cmdline', () => {
  const patterns = killPatterns();
  assert.ok(patterns.length > 0, 'patterns array must not be empty');
  for (const [name, cmdline] of REAL_SERVER_CMDLINES) {
    assert.ok(
      patterns.some((pattern) => matches(cmdline, pattern)),
      `no kill pattern matches the ${name} cmdline: "${cmdline}"`,
    );
  }
});

test('no kill pattern matches the supervisor itself (self-kill guard)', () => {
  const patterns = killPatterns();
  const supervisorCmdline = 'node scripts/preview/start-preview.mjs';
  for (const pattern of patterns) {
    assert.ok(
      !matches(supervisorCmdline, pattern),
      `pattern '${pattern}' would kill the supervisor itself`,
    );
  }
});

test('the historically broken pattern is gone (orphan regression)', () => {
  const patterns = killPatterns();
  for (const pattern of patterns) {
    assert.ok(
      !pattern.includes('tsx src/index.ts'),
      `pattern '${pattern}' only matches the npm wrapper, not the real api server`,
    );
  }
});

test('respawn waits for the preview ports to be free before spawning', () => {
  const restartPath = source.match(
    /stack unhealthy [\s\S]{0,400}?killTree\(\);[^\n]*\s*await waitForPortsFree\(\);\s*ensureDatabase\(\);\s*spawnTree\(\);/,
  );
  assert.ok(
    !!restartPath,
    'unhealthy-restart path must run killTree → waitForPortsFree → spawnTree (prevents EADDRINUSE crash loops)',
  );
  const coldStartPath = source.match(
    /— cold start[\s\S]{0,400}?killTree\(\);[^\n]*\s*await waitForPortsFree\(\);\s*ensureDatabase\(\);\s*spawnTree\(\);/,
  );
  assert.ok(
    !!coldStartPath,
    'cold-start path must run killTree → waitForPortsFree → spawnTree (clears orphaned half-dead stacks)',
  );
});
