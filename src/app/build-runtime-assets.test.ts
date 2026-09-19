import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('both package build paths copy PostgreSQL runtime assets after tsc and before Next', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const name of ['build', 'build:webpack']) {
    const steps = scripts[name].split(' && ');
    assert.equal(steps[0], 'tsc -p tsconfig.backend.json', name);
    assert.equal(steps[1], 'node scripts/copy-backend-runtime-assets.mjs', name);
    assert.match(steps[2], /^next build(?: --webpack)?$/, name);
  }
});
