import type { MissionPolicy } from '../../src/mission/policy';

/** Synthetic money probes must opt into the exact test database, not a runtime. */
export function assertMissionProbeDatabase(url: string, testUrl: string | undefined): void {
  if (!testUrl || url !== testUrl || !/^postgres(ql)?:\/\//i.test(url)) throw new Error('mission probe requires ZA141251SA_DATABASE_URL to match the explicit PG_TEST_DATABASE_URL fixture; never run synthetic money probes on production');
}

/** Retained fixtures accumulate actual test ledger spend. Authorize only this
 * synthetic run's headroom; never delete old ledger rows or weaken real gates. */
export function missionProbeSpendPolicy(policy: MissionPolicy, dailySpent: number, held: number): Partial<MissionPolicy> {
  const needed = dailySpent + held + 1500;
  if (![dailySpent, held, needed].every(value => Number.isSafeInteger(value) && value >= 0) || needed > 100000000) throw new Error('retained test fixture exceeds the supported synthetic probe budget');
  return { killSwitch: false, maxDailySpendCents: Math.max(policy.maxDailySpendCents, needed), maxExpenseCents: Math.max(policy.maxExpenseCents, 1500), requireApprovalAboveCents: Math.max(policy.requireApprovalAboveCents, 1501) };
}
