/**
 * ZA141251SA — reinvestment + fixed daily revenue target tests.
 *
 * The rule under test: every figure must come from a real ledger movement or a
 * verified revenue row. A configured share moves real minor units out of the
 * treasury; an unconfigured policy moves nothing; and target progress counts
 * only revenue that arrived AND was verified.
 */
process.env.ZA141251SA_DATABASE_URL = `file:${require('node:path').join(require('node:os').tmpdir(), `za141251sa-reinvest-${process.pid}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'test-session-secret-0123456789abcdefghijklmnop';
process.env.ZA141251SA_CREDENTIAL_KEY = 'test-credential-key-0123456789abcdefghijklmn';
process.env.ZA141251SA_CURRENCY = 'USD';

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyMissionMigrations, missionDb, type Row } from './database';
import { currentPolicy, ensurePolicy, updatePolicy } from './policy';
import {
  allocateReinvestment,
  createWallet,
  getWallet,
  credit,
  dailyTargetStatus,
  ensureReinvestmentWallet,
  listLedger,
  recordRevenue,
  reinvestmentSummary,
  sweepDailyTarget,
  treasurySummary,
  verifyLedger,
} from './treasury';
import { verifyMissionAudit } from './database';

applyMissionMigrations();
ensurePolicy('USD');

const ACTOR = 'owner-test';
let revenueCounter = 0;
const nextKey = () => `idem-${++revenueCounter}-${Date.now()}`;

function treasuryWalletId(): string {
  return (missionDb.get<Row>("SELECT id FROM mission_wallets WHERE kind = 'mission' ORDER BY created_at LIMIT 1")?.id ?? createWallet({ kind: 'mission', label: 'Mission treasury' }).id) as string;
}

test('a 0 bps policy allocates nothing — the default invents no money', () => {
  const treasuryId = treasuryWalletId();
  credit({ walletId: treasuryId, amountCents: 10_000, category: 'owner_capital' });
  const before = treasurySummary().totals.totalBalanceCents;
  const revenue = recordRevenue({
    amountCents: 5_000,
    source: 'client',
    status: 'received',
    verifier: 'owner-attestation:invoice-1',
    idempotencyKey: nextKey(),
    actorId: ACTOR,
  });
  assert.equal(revenue.duplicated, false);
  // Idempotency is per key: replaying the SAME key returns the same row.
  const replayed = recordRevenue({
    amountCents: 5_000,
    source: 'client',
    status: 'received',
    verifier: 'owner-attestation:invoice-1',
    idempotencyKey: String(revenue.revenue.idempotency_key),
    actorId: ACTOR,
  });
  assert.equal(replayed.duplicated, true, 'a replayed idempotency key must not record a second revenue');
  assert.equal(String(replayed.revenue.id), String(revenue.revenue.id));
  const summary = reinvestmentSummary();
  assert.equal(summary.shareBps, 0);
  assert.equal(summary.allocatedCents, 0);
  assert.equal(summary.balanceCents, 0);
  assert.deepEqual(summary.entries, []);
  assert.equal(treasurySummary().totals.totalBalanceCents > before, true, 'the received revenue itself still lands in the treasury');
});

test('a configured share moves exactly that share, to the minor unit, out of the treasury', () => {
  updatePolicy({ reinvestShareBps: 2500 }, ACTOR); // 25 %
  assert.equal(currentPolicy().reinvestShareBps, 2500);
  const treasuryId = treasuryWalletId();
  const treasuryBefore = getWallet(treasuryId)!.balanceCents;
  const reserveBefore = reinvestmentSummary().balanceCents;
  const revenue = recordRevenue({
    amountCents: 4_001,
    source: 'client',
    status: 'received',
    verifier: 'stripe:pi_test_1',
    idempotencyKey: nextKey(),
    actorId: ACTOR,
  });
  const expectedShare = Math.floor((4_001 * 2500) / 10_000); // 1000
  assert.ok(revenue.reinvestment, 'an allocation entry is expected');
  assert.equal(revenue.reinvestment!.amountCents, expectedShare);
  const summary = reinvestmentSummary();
  assert.equal(summary.allocatedCents, expectedShare);
  assert.equal(summary.wallet?.balanceCents, expectedShare);
  assert.equal(summary.sharePercent, 25);
  // Treasury keeps the remainder: in = 4,001, out = 1,000. The reserve gains
  // exactly the share — both are read from their own ledger balances.
  assert.equal(getWallet(treasuryId)!.balanceCents, treasuryBefore + 4_001 - expectedShare);
  assert.equal(reinvestmentSummary().balanceCents, reserveBefore + expectedShare);

  // The allocation is a real ledger pair (debit + credit) with the same reference.
  const rows = listLedger({ limit: 100 }).filter((entry) => entry.category === 'reinvestment');
  assert.equal(rows.length, 2, 'one debit out of the treasury and one credit into the reserve');
  assert.equal(rows.reduce((total, entry) => total + (entry.direction === 'credit' ? entry.amountCents : -entry.amountCents), 0), 0, 'the allocation pair nets to zero');
  assert.equal(rows.every((entry) => entry.reference === String(revenue.revenue.id)), true, 'the allocation is traceable to the revenue row');
});

test('an allocation is idempotent: the same revenue can never be reinvested twice', () => {
  const treasuryId = treasuryWalletId();
  const revenue = recordRevenue({
    amountCents: 1_000,
    source: 'client',
    status: 'received',
    verifier: 'stripe:pi_test_2',
    idempotencyKey: nextKey(),
    actorId: ACTOR,
  });
  const before = reinvestmentSummary().balanceCents;
  const again = allocateReinvestment({ revenueId: String(revenue.revenue.id), amountCents: 1_000, treasuryWalletId: treasuryId, actorId: ACTOR });
  assert.equal(again, null, 'a second allocation for the same revenue is refused');
  assert.equal(reinvestmentSummary().balanceCents, before);
});

test('a share smaller than one minor unit allocates nothing (no invented rounding)', () => {
  updatePolicy({ reinvestShareBps: 1 }, ACTOR); // 0.01 %
  const treasuryId = treasuryWalletId();
  const before = reinvestmentSummary().balanceCents;
  const entry = allocateReinvestment({ revenueId: 'rev_manual_small', amountCents: 10, treasuryWalletId: treasuryId, actorId: ACTOR });
  assert.equal(entry, null);
  assert.equal(reinvestmentSummary().balanceCents, before);
  updatePolicy({ reinvestShareBps: 2500 }, ACTOR);
});

test('expected and contracted revenue never count toward the daily target', () => {
  updatePolicy({ dailyRevenueTargetCents: 100_000 }, ACTOR);
  const day = dailyTargetStatus().day;
  const realizedBefore = dailyTargetStatus(day).realizedCents;

  recordRevenue({ amountCents: 50_000, source: 'client', status: 'expected', verifier: 'owner-attestation:quote-1', idempotencyKey: nextKey(), actorId: ACTOR });
  recordRevenue({ amountCents: 70_000, source: 'client', status: 'contracted', verifier: 'owner-attestation:contract-1', idempotencyKey: nextKey(), actorId: ACTOR });

  const status = dailyTargetStatus(day);
  assert.equal(status.realizedCents, realizedBefore, 'expected/contracted must not move realized progress');
  assert.equal(status.expectedCents >= 50_000, true);
  assert.equal(status.contractedCents >= 70_000, true);
  assert.equal(status.met, false, 'an unverified pipeline is not an achievement');
  assert.equal(status.label_kind, 'target');
});

test("un verified revenue can never be recorded as received (so it can never count)", () => {
  assert.throws(
    () => recordRevenue({ amountCents: 1, source: 'client', status: 'received', idempotencyKey: nextKey(), actorId: ACTOR }),
    /verifier/,
  );
});

test('the daily target reports progress, meets once, and audits the achievement once', () => {
  const day = dailyTargetStatus().day;
  const statusBefore = dailyTargetStatus(day);
  const needed = Math.max(1, statusBefore.targetCents - statusBefore.realizedCents);
  recordRevenue({
    amountCents: needed,
    source: 'client',
    status: 'received',
    verifier: 'stripe:pi_test_target',
    idempotencyKey: nextKey(),
    actorId: ACTOR,
  });

  const met = sweepDailyTarget(ACTOR);
  assert.equal(met.met, true, `expected target met: realized=${met.realizedCents} target=${met.targetCents}`);
  assert.equal(met.progressPct >= 100, true);
  assert.equal(met.remainingCents, 0);
  assert.ok(met.metAt, 'the met event carries a timestamp');
  const firstMetAt = met.metAt;

  // A second sweep must not re-announce the achievement.
  const again = sweepDailyTarget(ACTOR);
  assert.equal(again.metAt, firstMetAt, 'the met timestamp is immutable');
  const announcements = missionDb.get<Row>("SELECT COUNT(*) AS count FROM mission_audit WHERE action = 'target.daily_met'")!;
  assert.equal(Number(announcements.count), 1);

  const dayRow = missionDb.get<Row>('SELECT * FROM mission_daily_target_days WHERE day = ?', [day])!;
  assert.equal(Number(dayRow.met), 1);
  assert.equal(Number(dayRow.realized_cents), met.realizedCents);
});

test('with no target configured the board says so instead of showing a fake percentage', () => {
  updatePolicy({ dailyRevenueTargetCents: 0 }, ACTOR);
  const status = dailyTargetStatus();
  assert.equal(status.configured, false);
  assert.equal(status.progressPct, 0);
  assert.equal(status.remainingCents, 0);
  assert.equal(status.met, false);
  updatePolicy({ dailyRevenueTargetCents: 100_000 }, ACTOR);
});

test('the ledger and the audit chain verify after every movement above', () => {
  const ledger = verifyLedger();
  assert.equal(ledger.ok, true, ledger.detail);
  const audit = verifyMissionAudit();
  assert.equal(audit.ok, true);
  const treasury = treasurySummary();
  assert.equal(treasury.wallets.length > 0, true);
  // The reserve wallet is a derived account: its balance equals its own ledger sum.
  const reserve = ensureReinvestmentWallet();
  const ledgerSum = listLedger({ walletId: reserve.id, limit: 1000 }).reduce(
    (total, entry) => total + (entry.direction === 'credit' ? entry.amountCents : -entry.amountCents),
    0,
  );
  assert.equal(reserve.balanceCents, ledgerSum, 'a wallet balance is always the sum of its own ledger rows');
});
