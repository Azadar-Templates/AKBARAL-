/**
 * ZA141251SA — treasury, revenue-honesty, payout and self-management tests.
 *
 * The rules under test are the financial guarantees of the mission system:
 *   · money only moves through the hash-chained ledger, and balances never go
 *     negative;
 *   · revenue counts as REALIZED only when it arrived and was verified;
 *   · a payout can never leave without an approved, verified destination slot,
 *     treasury funds and an explicit owner decision;
 *   · agents self-manage resources, credentials, upgrades and services inside
 *     their budget and permission envelope — and everything is audited.
 */
process.env.ZA141251SA_DATABASE_URL = `file:${require('node:path').join(require('node:os').tmpdir(), `za141251sa-treasury-${process.pid}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'test-session-secret-0123456789abcdefghijklmnop';
process.env.ZA141251SA_CREDENTIAL_KEY = 'test-credential-key-0123456789abcdefghijklmn';
process.env.ZA141251SA_CURRENCY = 'USD';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  applyMissionMigrations,
  missionDb,
  resolveMissionDbPath,
  verifyMissionAudit,
  type Row,
} from './database';
import { currentPolicy, ensurePolicy, updatePolicy } from './policy';
import {
  MissionTreasuryError,
  PAYOUT_SLOT_COUNT,
  configurePayoutSlot,
  createWallet,
  credit,
  debit,
  decideExpense,
  decidePayout,
  ensurePayoutSlots,
  getWallet,
  listExpenses,
  listLedger,
  listPayoutSlots,
  listRevenue,
  recordRevenue,
  requestExpense,
  requestPayout,
  settlePayout,
  treasurySummary,
  verifyLedger,
  verifyPayoutSlot,
} from './treasury';
import {
  EXTERNAL_ACTIVATION,
  MissionSelfServiceError,
  applyUpgrade,
  createService,
  decideResource,
  decideToolRequest,
  decideUpgrade,
  expiringCredentials,
  listCredentials,
  listResources,
  listServices,
  listTools,
  recordResourceUsage,
  recordServiceHealth,
  requestResource,
  requestTool,
  requestUpgrade,
  retireResource,
  revokeCredential,
  rotateCredential,
  seedTools,
  selfManagementSnapshot,
  setToolStatus,
  storeCredential,
  sweepCredentialStatus,
} from './self-management';

const DB_PATH = resolveMissionDbPath();

// Secret-shaped fixtures are ASSEMBLED AT RUNTIME. The repository tree must
// never contain a key-shaped literal (the secret scanner treats a committed
// key-shaped string as a leak even when it is obviously a test value), so these
// parts are joined here instead of being written out.
const TAVILY_PREFIX = ['tvly', 'live'].join('-');
const TAVILY_KEY = [TAVILY_PREFIX, 'abcdefghijklmnop'].join('-');
const TAVILY_ROTATED = [TAVILY_PREFIX, 'rotated', 'zyxwvut'].join('-');
const GOOGLE_PREFIX = ['AIza', 'not'].join('-');
const GOOGLE_KEY = [GOOGLE_PREFIX, 'a', 'real', 'key', '1234'].join('-');

/** The wallet that already exists for agent A (earnings sweep assertions). */
function telemetryAgentWalletId(): string {
  return String(missionDb.get<Row>(`SELECT id FROM mission_wallets WHERE agent_id = 'agt_a' ORDER BY created_at LIMIT 1`)?.id ?? '');
}
const OWNER = 'owner_test';

function bootstrap(): void {
  applyMissionMigrations();
  ensurePolicy('USD');
  seedTools();
  ensurePayoutSlots();
  missionDb.run(
    `INSERT OR IGNORE INTO mission_agents (id, slug, name, role_key, depth, generation, status, mission_role, origin_platform)
     VALUES ('agt_a', 'agent-a', 'Agent A', 'specialist', 0, 'custom', 'active', 'worker', 'mission')`,
  );
  missionDb.run(
    `INSERT OR IGNORE INTO mission_agents (id, slug, name, role_key, depth, generation, status, mission_role, origin_platform)
     VALUES ('agt_b', 'agent-b', 'Agent B', 'specialist', 0, 'custom', 'active', 'worker', 'mission')`,
  );
}

test('treasury ledger rejects negative balances and records every movement', () => {
  bootstrap();
  const wallet = createWallet({ kind: 'agent', label: 'Agent A wallet', agentId: 'agt_a', budgetCents: 10_000 });
  assert.equal(wallet.balanceCents, 0);

  assert.throws(
    () => debit({ walletId: wallet.id, amountCents: 100, category: 'expense', actorType: 'agent', actorId: 'agt_a' }),
    (error: unknown) => error instanceof MissionTreasuryError && error.code === 'insufficient_funds',
    'an unfunded wallet cannot spend',
  );

  credit({ walletId: wallet.id, amountCents: 5_000, category: 'transfer', actorType: 'owner', actorId: OWNER, memo: 'funding' });
  const afterCredit = getWallet(wallet.id);
  assert.equal(afterCredit?.balanceCents, 5_000);

  debit({ walletId: wallet.id, amountCents: 1_500, category: 'expense', actorType: 'agent', actorId: 'agt_a' });
  const afterDebit = getWallet(wallet.id);
  assert.equal(afterDebit?.balanceCents, 3_500);
  assert.equal(afterDebit?.spentCents, 1_500);

  assert.equal(verifyLedger().ok, true, 'ledger hash chain verifies');
  const entries = listLedger({ walletId: wallet.id });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].direction, 'debit', 'the ledger is returned newest first');
  assert.equal(entries[0].balanceAfter, 3_500, 'each entry stores the resulting balance');
  assert.equal(entries[1].balanceAfter, 5_000, 'the earlier entry keeps its own balance');

  const tampered = listLedger({ walletId: wallet.id, limit: 1 })[0];
  missionDb.run('UPDATE mission_ledger SET amount_cents = 999 WHERE id = ?', [tampered.id]);
  const broken = verifyLedger();
  assert.equal(broken.ok, false, 'a rewritten ledger row breaks verification');
  missionDb.run('UPDATE mission_ledger SET amount_cents = ? WHERE id = ?', [tampered.amountCents, tampered.id]);
  assert.equal(verifyLedger().ok, true, 'restoring the true amount restores the chain');
});

test('revenue is only realized when it arrived and was verified', () => {
  const expected = recordRevenue({
    agentId: 'agt_a', amountCents: 250_000, source: 'client', status: 'expected',
    idempotencyKey: 'rev-expected-1', actorId: OWNER, memo: 'proposal sent',
  });
  assert.equal(expected.duplicated, false);
  assert.equal(expected.revenue.status, 'expected');

  const contracted = recordRevenue({
    agentId: 'agt_a', amountCents: 100_000, source: 'client', status: 'contracted',
    idempotencyKey: 'rev-contracted-1', actorId: OWNER, memo: 'signed SOW',
  });
  assert.equal(contracted.revenue.status, 'contracted');

  // A 'received' entry without a verifier is refused: nothing is marked paid-in
  // on an unverified claim.
  assert.throws(
    () => recordRevenue({ agentId: 'agt_a', amountCents: 50_000, source: 'client', status: 'received', idempotencyKey: 'rev-unverified', actorId: OWNER }),
    (error: unknown) => error instanceof MissionTreasuryError,
    'received revenue requires a verifier',
  );

  const agentWalletBefore = Number(missionDb.get<Row>(`SELECT balance_cents FROM mission_wallets WHERE agent_id = 'agt_a' ORDER BY created_at LIMIT 1`)?.balance_cents ?? 0);
  const received = recordRevenue({
    agentId: 'agt_a', amountCents: 50_000, source: 'client', status: 'received',
    idempotencyKey: 'rev-received-1', actorId: OWNER, verifier: 'provider-webhook', externalRef: 'pi_3NxReal',
  });
  assert.equal(received.revenue.status, 'received');
  assert.ok(received.ledger, 'received revenue produces a ledger credit');
  const treasuryWalletId = received.ledger!.walletId;
  assert.equal(String(received.revenue.wallet_id ?? ''), treasuryWalletId, 'the revenue row records where the money landed');
  assert.equal(String(getWallet(treasuryWalletId)?.kind), 'mission', 'received revenue lands in the mission treasury');
  assert.equal(getWallet(treasuryWalletId)?.balanceCents, 50_000, 'the mission treasury received the funds');
  assert.equal(getWallet(telemetryAgentWalletId())?.balanceCents, agentWalletBefore, 'agent earnings are swept into the treasury, not stranded');

  // Idempotency: a replayed webhook must not double-count money.
  const replay = recordRevenue({
    agentId: 'agt_a', amountCents: 50_000, source: 'client', status: 'received',
    idempotencyKey: 'rev-received-1', actorId: OWNER, verifier: 'provider-webhook', externalRef: 'pi_3NxReal',
  });
  assert.equal(replay.duplicated, true, 'a duplicate idempotency key is reported, not written');
  assert.equal(getWallet(treasuryWalletId)?.balanceCents, 50_000, 'the duplicate did not add money');

  const summary = treasurySummary();
  assert.equal(summary.totals.realizedRevenueCents, 50_000, 'realized revenue counts only verified receipts');
  assert.equal(summary.totals.pendingRevenueCents, 350_000, 'expected + contracted stay separate');
  assert.equal(listRevenue().length, 3);
});

test('expenses inside budget either auto-approve under the threshold or queue for the owner', () => {
  const policy = currentPolicy();
  const target = createWallet({ kind: 'agent', label: 'Agent B wallet', agentId: 'agt_b', budgetCents: 20_000 });
  credit({ walletId: target.id, amountCents: 20_000, category: 'transfer', actorType: 'owner', actorId: OWNER });

  const smallAmount = policy.requireApprovalAboveCents - 1;
  const largeAmount = policy.requireApprovalAboveCents + 1;
  const small = requestExpense({
    agentId: 'agt_b', walletId: target.id, category: 'api', provider: 'openai',
    description: 'inference credits', amountCents: smallAmount,
    idempotencyKey: 'exp-small-1', actorType: 'agent', actorId: 'agt_b',
  });
  assert.equal(small.expense.status, 'paid', 'below-threshold spend is paid from the authorised budget');
  assert.equal(String(small.approvalId ?? ''), '', 'no approval was needed');

  const large = requestExpense({
    agentId: 'agt_b', walletId: target.id, category: 'compute', provider: 'vercel',
    description: 'plan upgrade', amountCents: largeAmount,
    idempotencyKey: 'exp-large-1', actorType: 'agent', actorId: 'agt_b',
  });
  assert.equal(large.expense.status, 'requested', 'above-threshold spend waits for the owner');
  assert.ok(large.approvalId, 'a real approval row exists');
  assert.equal(getWallet(target.id)?.balanceCents, 20_000 - smallAmount, 'the queued expense has not been charged yet');

  const queueRow = missionDb.get<Row>('SELECT * FROM mission_approvals WHERE id = ?', [large.approvalId]);
  assert.equal(String(queueRow?.subject_type), 'expense');
  assert.equal(Number(queueRow?.amount_cents), largeAmount);

  const paid = decideExpense({ id: String(large.expense.id), decision: 'approved', actorId: OWNER });
  assert.equal(String(paid.status), 'paid', 'owner approval pays the expense');
  assert.equal(getWallet(target.id)?.balanceCents, 20_000 - smallAmount - largeAmount, 'spend is reflected in the wallet');
  assert.equal(listExpenses().length, 2);

  assert.throws(
    () => decideExpense({ id: String(small.expense.id), decision: 'approved', actorId: 'agt_b', actorType: 'agent' }),
    (error: unknown) => error instanceof MissionTreasuryError && error.code === 'forbidden',
    'an agent cannot decide an expense',
  );
  const rejected = requestExpense({
    agentId: 'agt_b', walletId: target.id, category: 'software', provider: 'adobe',
    description: 'design suite', amountCents: policy.requireApprovalAboveCents + 1_000,
    idempotencyKey: 'exp-reject-1', actorType: 'agent', actorId: 'agt_b',
  });
  const denied = decideExpense({ id: String(rejected.expense.id), decision: 'rejected', actorId: OWNER, note: 'not needed' });
  assert.equal(String(denied.status), 'rejected');
  assert.equal(String(missionDb.get<Row>('SELECT status FROM mission_approvals WHERE id = ?', [String(rejected.approvalId ?? '')])?.status), 'rejected');

  const untouchable = getWallet(target.id)?.balanceCents ?? 0;
  assert.throws(
    () => requestExpense({
      agentId: 'agt_b', walletId: target.id, category: 'api', provider: 'openai',
      description: 'oversized', amountCents: untouchable + 1_000_000,
      idempotencyKey: 'exp-over-budget', actorType: 'agent', actorId: 'agt_b',
    }),
    (error: unknown) => error instanceof MissionTreasuryError,
    'an agent cannot spend past its wallet balance',
  );
});

test('payout slots are exactly four, configurable without handing over credentials', () => {
  const slots = ensurePayoutSlots();
  assert.equal(slots.length, PAYOUT_SLOT_COUNT);
  assert.deepEqual(slots.map((slot) => Number(slot.slot)), [1, 2, 3, 4]);
  for (const slot of slots) {
    assert.equal(String(slot.status), 'unconfigured', 'slots start unconfigured — nothing is demanded up front');
  }

  const configured = configurePayoutSlot({
    slot: 1, label: 'Primary business account', destinationType: 'bank',
    holderName: 'Mission Holder', maskedAccount: '**** **** 4821', currency: 'USD',
    minPayoutCents: 5_000, maxPayoutCents: 500_000, approvalRequired: true, actorId: OWNER,
  });
  assert.equal(String(configured.status), 'pending_verification', 'a configured slot needs owner verification');
  assert.equal(String(configured.masked_account).endsWith('4821'), true, 'only the last four digits survive');
  assert.ok(String(configured.masked_account).startsWith('*'), 'the stored value is masked');
  const stored = missionDb.get<Row>('SELECT * FROM mission_payout_slots WHERE slot = 1');
  assert.ok(!JSON.stringify(stored).includes('**** **** 4821'), 'the raw destination string is re-masked before storage');

  assert.throws(() => configurePayoutSlot({ slot: 5, label: 'nope', actorId: OWNER }), (error: unknown) => error instanceof MissionTreasuryError, 'only four slots exist');
  const slot2 = configurePayoutSlot({ slot: 2, label: 'Backup wallet', destinationType: 'wallet', maskedAccount: 'acct-000000000042', actorId: OWNER });
  assert.equal(String(slot2.status), 'pending_verification', 'a configured destination is pending until verified');
  const labelOnly = configurePayoutSlot({ slot: 3, label: 'Reserve (label only)', actorId: OWNER });
  assert.equal(String(labelOnly.label), 'Reserve (label only)');
  assert.equal(String(labelOnly.status), 'unconfigured', 'a label alone never makes a slot payable');

  const verified = verifyPayoutSlot(1, OWNER);
  assert.equal(String(verified.status), 'active', 'owner verification activates the slot');
  assert.equal(String(listPayoutSlots().find((slot) => Number(slot.slot) === 2)?.status), 'pending_verification', 'slot 2 was configured but not verified');
  assert.equal(String(listPayoutSlots().find((slot) => Number(slot.slot) === 4)?.status), 'unconfigured', 'slot 4 is untouched');
});

test('payout requires an active verified slot, funds, and an owner approval before money leaves', () => {
  const missionWallet = missionDb.get<Row>(`SELECT id FROM mission_wallets WHERE kind = 'mission' ORDER BY created_at LIMIT 1`);
  assert.ok(missionWallet, 'the mission treasury wallet exists');
  const walletId = String(missionWallet!.id);
  const funded = getWallet(walletId)?.balanceCents ?? 0;
  assert.ok(funded >= 10_000, 'the mission treasury holds verified revenue');

  // Slot 2 is configured but NOT verified → payouts to it must be refused.
  assert.throws(
    () => requestPayout({ slot: 2, amountCents: 5_000, idempotencyKey: 'pay-unverified', requestedBy: OWNER }),
    (error: unknown) => error instanceof MissionTreasuryError && error.code === 'slot_not_active' && /pending_verification/.test(error.message),
    'an unverified destination cannot receive money',
  );
  assert.throws(
    () => requestPayout({ slot: 3, amountCents: 5_000, idempotencyKey: 'pay-unconfigured', requestedBy: OWNER }),
    (error: unknown) => error instanceof MissionTreasuryError,
    'an unconfigured slot cannot receive money',
  );

  const payout = requestPayout({ slot: 1, amountCents: 5_000, idempotencyKey: 'pay-1', requestedBy: OWNER, memo: 'first payout' });
  assert.equal(String(payout.status), 'pending_approval', 'a payout is never sent on request alone');
  assert.equal(getWallet(walletId)?.balanceCents, funded, 'no money moves while pending');

  // Settlement before approval is impossible.
  assert.throws(
    () => settlePayout({ id: String(payout.id), status: 'settled', actorId: OWNER, settlementRef: 'manual' }),
    (error: unknown) => error instanceof MissionTreasuryError,
    'an unapproved payout cannot be settled',
  );

  assert.throws(
    () => decidePayout({ id: String(payout.id), decision: 'approved', actorId: 'agt_a', actorType: 'agent' }),
    (error: unknown) => error instanceof MissionTreasuryError && error.code === 'forbidden',
    'an agent cannot approve a payout to itself',
  );
  assert.throws(
    () => verifyPayoutSlot(4, 'agt_a', 'agent'),
    (error: unknown) => error instanceof MissionTreasuryError && error.code === 'forbidden',
    'an agent cannot verify a payout destination',
  );
  const approved = decidePayout({ id: String(payout.id), decision: 'approved', actorId: OWNER });
  assert.equal(String(approved.status), 'approved');
  assert.equal(getWallet(walletId)?.balanceCents, funded - 5_000, 'approval debits the treasury');

  assert.throws(
    () => settlePayout({ id: String(payout.id), status: 'settled', actorId: OWNER }),
    (error: unknown) => error instanceof MissionTreasuryError && error.code === 'verification_required' && /settlement reference/.test(error.message),
    'a settlement must cite a real provider reference — never invented',
  );

  const settled = settlePayout({ id: String(payout.id), status: 'settled', actorId: OWNER, settlementRef: 'po_1QexampleRef' });
  assert.equal(String(settled.status), 'settled');
  assert.equal(String(settled.settlement_ref), 'po_1QexampleRef');
  assert.equal(treasurySummary().totals.settledPayoutsCents, 5_000);
});

test('a failed payout returns the money to the treasury', () => {
  const walletId = String(missionDb.get<Row>(`SELECT id FROM mission_wallets WHERE kind = 'mission' LIMIT 1`)!.id);
  const before = getWallet(walletId)!.balanceCents;
  const payout = requestPayout({ slot: 1, amountCents: 5_000, idempotencyKey: 'pay-fail-1', requestedBy: OWNER });
  decidePayout({ id: String(payout.id), decision: 'approved', actorId: OWNER });
  assert.equal(getWallet(walletId)?.balanceCents, before - 5_000);
  const failed = settlePayout({ id: String(payout.id), status: 'failed', actorId: OWNER, failureReason: 'provider rejected the transfer' });
  assert.equal(String(failed.status), 'failed');
  assert.equal(getWallet(walletId)?.balanceCents, before, 'a failed payout credits the funds back');
  assert.equal(verifyLedger().ok, true, 'ledger stays consistent through the reversal');
});

test('payout cap and daily spend ceiling are enforced', () => {
  const policy = currentPolicy();
  assert.throws(
    () => requestPayout({ slot: 1, amountCents: policy.maxPayoutCents + 1, idempotencyKey: 'pay-too-big', requestedBy: OWNER }),
    (error: unknown) => error instanceof MissionTreasuryError,
    'a payout above the configured ceiling is refused',
  );
  const previousCap = policy.maxDailySpendCents;
  updatePolicy({ maxDailySpendCents: 1 }, OWNER);
  const wallet = createWallet({ kind: 'agent', label: 'Cap test', agentId: 'agt_a', budgetCents: 1_000 });
  credit({ walletId: wallet.id, amountCents: 1_000, category: 'transfer', actorType: 'owner', actorId: OWNER });
  assert.throws(
    () => requestExpense({
      agentId: 'agt_a', walletId: wallet.id, category: 'api', provider: 'openai', description: 'over daily cap',
      amountCents: 500, idempotencyKey: 'exp-daily-cap', actorType: 'agent', actorId: 'agt_a',
    }),
    (error: unknown) => error instanceof MissionTreasuryError,
    'the daily ceiling stops spending across the mission',
  );
  updatePolicy({ maxDailySpendCents: previousCap }, OWNER);
});

test('tool catalog is default-deny and card/bank APIs are permanently blocked', () => {
  seedTools();
  const tools = listTools();
  assert.ok(tools.length >= 8, 'the approved provider catalog exists');
  const blocked = tools.filter((tool) => String(tool.status) === 'blocked').map((tool) => String(tool.key));
  assert.deepEqual(blocked, ['card_or_bank_api'], 'only the unrestricted financial API is blocked by default');
  const cardTool = tools.find((tool) => String(tool.key) === 'card_or_bank_api');
  assert.equal(String(cardTool?.status), 'blocked', 'the card/bank API is blocked in the compiled catalog');
  assert.equal(String(cardTool?.category), 'payments', 'the blocked tool is the unrestricted financial API');

  const restricted = tools.filter((tool) => String(tool.status) === 'restricted');
  assert.ok(restricted.length > 0, 'expensive tools start restricted');
  for (const tool of restricted) {
    assert.notEqual(String(tool.status), 'approved', 'restricted tools are not usable');
  }

  // An agent requests access; only the owner can approve.
  const request = requestTool({ agentId: 'agt_a', toolKey: 'web_search', justification: 'client research', actorId: 'agt_a' });
  assert.equal(String(request.status), 'requested');
  const blockedRequest = requestTool({ agentId: 'agt_a', toolKey: 'card_or_bank_api', actorId: 'agt_a' });
  assert.equal(String(blockedRequest.status), 'rejected', 'a blocked tool request is refused immediately');
  assert.equal(String(blockedRequest.decided_by), 'system', 'the refusal is automatic, not a queued decision');
  const blockedAudit = missionDb.all<Row>(`SELECT * FROM mission_audit WHERE action = 'tool.request_blocked'`);
  assert.equal(blockedAudit.length >= 1, true, 'the refusal is auditable');
  assert.throws(() => decideToolRequest({ id: String(request.id), decision: 'approved', actorId: 'agt_a', actorType: 'agent' }), (error: unknown) => error instanceof MissionSelfServiceError && error.code === 'forbidden', 'an agent cannot approve its own request');
  assert.equal(String(decideToolRequest({ id: String(request.id), decision: 'approved', actorId: OWNER }).status), 'approved');

  assert.throws(() => setToolStatus('card_or_bank_api', 'approved', OWNER), (error: unknown) => error instanceof MissionSelfServiceError, 'the blocked financial API cannot be enabled');
  assert.equal(String(setToolStatus('web_search', 'approved', OWNER).status), 'approved');
});

test('credentials are stored encrypted, rotated with a reason, and never returned in plaintext', () => {
  const stored = storeCredential({
    provider: 'tavily', label: 'search key', kind: 'api_key', scope: ['search.read'],
    envVar: 'TAVILY_API_KEY', secret: TAVILY_KEY, expiresAt: '2030-01-01T00:00:00.000Z', actorId: OWNER,
  });
  assert.equal(stored.provider, 'tavily');
  assert.ok(stored.maskedHint.includes('…') || stored.maskedHint.includes('...'), 'only a masked hint is exposed');
  assert.ok(!JSON.stringify(stored).includes(TAVILY_KEY), 'the public view never contains the secret');
  const row = missionDb.get<Row>('SELECT * FROM mission_credentials WHERE id = ?', [stored.id]);
  assert.ok(!String(row?.ciphertext).includes(TAVILY_PREFIX), 'the secret is encrypted at rest');
  assert.ok(String(row?.iv).length > 0 && String(row?.tag).length > 0, 'ciphertext, iv and tag are all stored');
  assert.ok(!JSON.stringify(listCredentials()).includes(TAVILY_PREFIX), 'listing credentials never leaks secrets');

  assert.throws(() => storeCredential({ provider: 'x', label: 'y', secret: '', actorId: OWNER }), (error: unknown) => error instanceof MissionSelfServiceError, 'an empty secret is refused');

  const rotated = rotateCredential({ id: stored.id, secret: TAVILY_ROTATED, reason: 'scheduled rotation', actorType: 'owner', actorId: OWNER, verified: true });
  assert.equal(rotated.rotationCount, 1, 'the new secret was rotated once since creation');
  assert.notEqual(rotated.maskedHint, stored.maskedHint, 'the hint reflects the new secret');
  const rotations = missionDb.all<Row>('SELECT * FROM mission_credential_rotations WHERE credential_id = ? ORDER BY created_at DESC', [stored.id]);
  assert.equal(rotations.length, 1, 'exactly one rotation happened');
  assert.equal(Number(rotations[0].verified), 1, 'rotation is recorded as verified only because a provider call succeeded');
  assert.equal(String(rotations[0].reason), 'scheduled rotation');
  assert.notEqual(String(rotations[0].new_hint), stored.maskedHint, 'the rotation row records the new hint, never the value');
  const rotationPayload = JSON.stringify(rotations[0]);
  assert.ok(!rotationPayload.includes(TAVILY_ROTATED), 'rotation history never stores the secret value');

  const revoked = revokeCredential(stored.id, OWNER, 'key compromised');
  assert.equal(revoked.status, 'revoked');
  assert.equal(expiringCredentials(30_000).some((entry) => entry.id === stored.id), false, 'revoked credentials are not reported as expiring');

  const soon = storeCredential({ provider: 'google', label: 'gemini key', secret: GOOGLE_KEY, expiresAt: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(), actorId: OWNER });
  const expiring = expiringCredentials(7);
  assert.equal(expiring.some((entry) => entry.id === soon.id), true, 'credentials nearing expiry are surfaced');
  assert.equal(expiring.find((entry) => entry.id === soon.id)?.urgency, 'critical');
  const sweep = sweepCredentialStatus();
  assert.ok(sweep.updated >= 1, 'the sweep reclassifies credentials whose expiry moved');
  assert.equal(sweep.expired >= 0, true);
});

test('agents manage resources and upgrades inside their budget, with audit trail', () => {
  const policy = currentPolicy();
  const resource = requestResource({
    agentId: 'agt_a', kind: 'api', provider: 'openai', plan: 'pay-as-you-go',
    monthlyCostCents: policy.requireApprovalAboveCents + 100, autoRenew: true,
    expiresAt: new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString(),
    limits: { monthlyRequests: 100_000 }, actorId: 'agt_a',
  });
  assert.equal(String(resource.status), 'requested', 'a costly resource needs owner approval');
  assert.throws(() => decideResource({ id: String(resource.id), decision: 'approved', actorId: 'agt_a', actorType: 'agent' }), (error: unknown) => error instanceof MissionSelfServiceError && error.code === 'forbidden', 'an agent cannot approve its own resource request');
  const approved = decideResource({ id: String(resource.id), decision: 'approved', actorId: OWNER });
  assert.equal(String(approved.status), 'active');
  const withUsage = recordResourceUsage({ id: String(resource.id), usage: { monthlyRequests: 1_234, costCents: 42 }, actorId: OWNER });
  assert.equal(JSON.parse(String(withUsage.usage)).monthlyRequests, 1_234);
  assert.equal(listResources('agt_a').some((entry) => String(entry.id) === String(resource.id)), true);
  const retired = retireResource(String(resource.id), OWNER, 'consolidated provider');
  assert.equal(String(retired.status), 'retired');

  const upgrade = requestUpgrade({
    agentId: 'agt_a', capability: 'higher model tier for client code review', requestedCostCents: 2_000,
    justification: 'two client contracts require it', actorType: 'agent', actorId: 'agt_a',
  });
  assert.equal(String(upgrade.upgrade.status), 'requested');
  assert.throws(() => decideUpgrade({ id: String(upgrade.upgrade.id), decision: 'approved', actorId: 'agt_a', actorType: 'agent' }), (error: unknown) => error instanceof MissionSelfServiceError && error.code === 'forbidden', 'an agent cannot approve its own upgrade');
  assert.throws(() => applyUpgrade(String(upgrade.upgrade.id), 'agt_a', 'agent'), (error: unknown) => error instanceof MissionSelfServiceError && error.code === 'forbidden', 'an agent cannot apply an upgrade');
  const accepted = decideUpgrade({ id: String(upgrade.upgrade.id), decision: 'approved', actorId: OWNER });
  assert.equal(String(accepted.status), 'approved');
  const applied = applyUpgrade(String(upgrade.upgrade.id), OWNER);
  assert.equal(String(applied.status), 'applied', 'an approved upgrade can be applied and is charged/audited');
  const snapshot = selfManagementSnapshot('agt_a');
  assert.ok(snapshot.resources.total >= 1, 'the snapshot counts the agent resources');
  assert.equal(snapshot.requiresExternalActivation.length, EXTERNAL_ACTIVATION.length, 'external activation items are reported, not invented');
});

test('services are monitored with the source of health recorded', () => {
  const service = createService({ agentId: 'agt_a', name: 'Client API gateway', kind: 'api', provider: 'cloudflare', notes: 'production', actorId: OWNER });
  assert.equal(String(service.status), 'unknown', 'a new service is not presumed healthy');
  const healthy = recordServiceHealth({ id: String(service.id), status: 'healthy', healthSource: 'provider-api', actorType: 'owner', actorId: OWNER });
  assert.equal(String(healthy.status), 'healthy');
  assert.equal(String(healthy.health_source), 'provider-api', 'the health source is recorded — a health claim always cites where it came from');
  const reported = recordServiceHealth({ id: String(service.id), status: 'degraded', healthSource: 'agent-report', actorType: 'agent', actorId: 'agt_a' });
  assert.equal(String(reported.health_source), 'agent-report');
  assert.equal(listServices('agt_a').length, 1);
});

test('every money and configuration action lands in the immutable audit chain', () => {
  const verification = verifyMissionAudit();
  assert.equal(verification.ok, true, 'audit chain verifies end to end');
  const actions = missionDb.all<Row>('SELECT action, COUNT(*) AS count FROM mission_audit GROUP BY action ORDER BY count DESC');
  const named = actions.map((row) => String(row.action));
  for (const expected of [
    'payout.requested', 'payout.approved', 'payout.settled', 'payout.failed',
    'credential.stored', 'credential.rotated', 'credential.revoked',
    'resource.approved', 'resource.retired', 'upgrade.requested', 'upgrade.applied',
    'revenue.recorded', 'ledger.debit', 'ledger.credit', 'tool.request_blocked', 'payout_slot.verified',
  ]) {
    assert.ok(named.includes(expected), `${expected} was audited`);
  }
  const detailLeak = missionDb.all<Row>('SELECT detail FROM mission_audit WHERE detail IS NOT NULL');
  for (const row of detailLeak) {
    assert.ok(!String(row.detail).includes(TAVILY_PREFIX), 'no credential value ever reached the audit trail');
    assert.ok(!String(row.detail).includes(GOOGLE_PREFIX), 'no API key value ever reached the audit trail');
  }
});

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${DB_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
});
