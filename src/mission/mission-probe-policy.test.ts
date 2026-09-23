import { it } from 'node:test';
import assert from 'node:assert/strict';
import { assertMissionProbeDatabase, missionProbeSpendPolicy } from '../../scripts/testing/mission-probe-policy';
import type { MissionPolicy } from './policy';
const original = { killSwitch: false, maxDailySpendCents: 10000, maxExpenseCents: 2000, requireApprovalAboveCents: 2000 } as MissionPolicy;
it('retained fixture headroom includes historical spend and outstanding provider holds', () => {
  const patch = missionProbeSpendPolicy(original, 8550, 40);
  assert.equal(original.maxDailySpendCents - 8550 - 40 < 1500, true, 'reproduces the exhausted retained fixture');
  assert.equal(patch.maxDailySpendCents, 10090);
  assert.equal(patch.maxDailySpendCents! - 8550 - 40, 1500);
  assert.equal(original.maxDailySpendCents, 10000, 'never mutates the captured restoration policy');
});
it('synthetic probes require explicit matching PostgreSQL test targets without echoing credentials', () => {
  for (const [url, test] of [['postgres://production', undefined], ['postgres://production', 'postgres://fixture'], ['file:test.db', 'file:test.db']]) assert.throws(() => assertMissionProbeDatabase(url!, test), /explicit PG_TEST_DATABASE_URL fixture/);
  assert.doesNotThrow(() => assertMissionProbeDatabase('postgres://fixture', 'postgres://fixture'));
});
it('probe budgets reject invalid or unsupported retained history instead of silently clamping', () => {
  for (const value of [-1, Infinity, 0.5, 100000000, Number.MAX_SAFE_INTEGER]) assert.throws(() => missionProbeSpendPolicy(original, value, 0), /supported synthetic probe budget/);
});
