import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  DEPENDENCY_ROWS,
  dependencyMatrix,
  earningPlatformDependencies,
  scanEnvUsage,
  staleMatrixRows,
  undocumentedEnvVars,
} from './dependency-matrix';
import { LEGITIMATE_SOURCES } from '../mission/opportunity-sources';

/**
 * The matrix is only useful if it cannot go stale. These tests are the gate:
 * a new environment variable in the runtime, or a row for a variable nobody
 * reads any more, fails the suite.
 */

const ROOT = path.resolve(process.cwd());

describe('API / provider dependency matrix', () => {
  it('documents every environment variable the runtime actually reads', () => {
    assert.deepEqual(undocumentedEnvVars(ROOT), [], 'add a row to DEPENDENCY_ROWS for each variable listed');
  });

  it('has no row for a variable the runtime no longer reads', () => {
    assert.deepEqual(staleMatrixRows(ROOT), [], 'remove these rows or restore their call sites');
  });

  it('names each call site from the source tree instead of trusting the row', () => {
    const matrix = dependencyMatrix(ROOT, {});
    for (const entry of matrix) {
      assert.ok(entry.usedBy.length > 0, `${entry.envVar} claims no call site`);
      for (const file of entry.usedBy) assert.match(file, /^(src|scripts)\//, `${entry.envVar} points outside the runtime: ${file}`);
    }
  });

  it('answers all eight questions for every dependency', () => {
    for (const row of DEPENDENCY_ROWS) {
      assert.ok(row.provider.length > 2, `${row.envVar}: provider`);
      assert.ok(row.purpose.length > 10, `${row.envVar}: purpose`);
      assert.ok(['AKBARAL!', 'ZA141251SA', 'shared'].includes(row.system), `${row.envVar}: system`);
      assert.ok(['REQUIRED', 'OPTIONAL', 'CREDENTIAL REQUIRED'].includes(row.requirement), `${row.envVar}: requirement`);
      assert.ok(row.credential.length > 2, `${row.envVar}: credential`);
      assert.ok(row.breaksWithout.length > 15, `${row.envVar}: what breaks without it`);
      // A free option is either a concrete free path or an explicit null — never
      // a vague claim that something is "free" with no route to it.
      assert.ok(row.freeOption === null || row.freeOption.length > 3, `${row.envVar}: free option`);
    }
  });

  it('never exposes a value, only whether a name is set', () => {
    const serialized = JSON.stringify(dependencyMatrix(ROOT, { GOOGLE_API_KEY: 'value-must-not-appear', SESSION_SECRET: 'value-must-not-appear' }));
    assert.equal(serialized.includes('value-must-not-appear'), false);
    const google = dependencyMatrix(ROOT, { GOOGLE_API_KEY: 'value-must-not-appear' }).find((row) => row.envVar === 'GOOGLE_API_KEY');
    assert.equal(google?.configured, true);
    assert.equal(dependencyMatrix(ROOT, {}).find((row) => row.envVar === 'GOOGLE_API_KEY')?.configured, false);
  });

  it('keeps the two systems distinguishable and never shares a money credential', () => {
    const mission = DEPENDENCY_ROWS.filter((row) => row.system === 'ZA141251SA');
    assert.ok(mission.length >= 10);
    // The mission's Stripe credentials are separate variables by design.
    assert.ok(mission.some((row) => row.envVar === 'ZA141251SA_STRIPE_SECRET_KEY'));
    assert.equal(DEPENDENCY_ROWS.find((row) => row.envVar === 'STRIPE_SECRET_KEY')?.system, 'AKBARAL!');
    // Mission session and vault secrets are never the AKBARAL! ones.
    for (const name of ['ZA141251SA_SESSION_SECRET', 'ZA141251SA_CREDENTIAL_KEY']) {
      assert.equal(DEPENDENCY_ROWS.find((row) => row.envVar === name)?.requirement, 'REQUIRED');
    }
  });

  it('states the sandbox limitation honestly for every external provider', () => {
    for (const row of DEPENDENCY_ROWS) {
      if (row.requirement !== 'CREDENTIAL REQUIRED') continue;
      // A secret the owner issues locally (webhook HMAC, gateway key) needs no
      // vendor and genuinely can be proven here.
      if (/self-issued|generated locally|local random/i.test(`${row.credential} ${row.freeOption ?? ''}`)) continue;
      assert.notEqual(
        row.sandbox,
        'configurable and testable here',
        `${row.envVar} claims it can be proven here, but a provider call needs outbound network`,
      );
    }
  });

  it('derives earning-platform credentials from the mission registry rather than a copy', () => {
    const derived = earningPlatformDependencies(LEGITIMATE_SOURCES as unknown as Array<Record<string, unknown>>);
    assert.equal(derived.length, LEGITIMATE_SOURCES.length);
    for (const platform of derived) {
      assert.ok(platform.platform.length > 0);
      assert.ok([0, 1, 2].includes(platform.automationAllowed));
      if (platform.automationAllowed === 2) assert.ok(platform.automationNotes.length > 0, `${platform.platform} must say what the condition is`);
    }
    // Platforms that require a key must name the variable, so an owner knows
    // exactly what to supply and the mission can report it as unconfigured.
    const keyed = derived.filter((platform) => platform.envVar);
    assert.ok(keyed.length > 0);
    for (const platform of keyed) assert.match(platform.envVar!, /^[A-Z][A-Z0-9_]+$/);
  });

  it('scans the runtime only — test harnesses are not provider dependencies', () => {
    const scanned = scanEnvUsage(ROOT).map((entry) => entry.envVar);
    for (const harnessOnly of ['TAB_CLICKS', 'E2E_TOKEN', 'JOURNEY_PASSWORD', 'PG_TEST_DATABASE_URL']) {
      assert.equal(scanned.includes(harnessOnly), false, `${harnessOnly} belongs to the test tooling, not the matrix`);
    }
  });
});
