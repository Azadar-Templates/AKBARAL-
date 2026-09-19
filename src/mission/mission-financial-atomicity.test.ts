import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `mission-financial-${process.pid}.db`)}`;
import { before, after, it } from 'node:test';
import assert from 'node:assert/strict';
// Delayed loading is intentional: choose the test DB before any config imports.
const { applyMissionMigrations, missionDb, verifyMissionAudit } = require('./database') as typeof import('./database');
const { updatePolicy, currentPolicy, setKillSwitch } = require('./policy') as typeof import('./policy');
const { createWallet, listWallets, getWallet, credit, debit, recordRevenue, requestExpense, decideExpense, configurePayoutSlot, requestPayout, decidePayout, settlePayout, verifyLedger } = require('./treasury') as typeof import('./treasury');
const { confirmPayoutVerification, PAYOUT_VERIFICATION_CHECKS } = require('./payout-verification') as typeof import('./payout-verification');
const owner = `fixture-${randomUUID()}`, agent = `agent-${randomUUID()}`;
let treasury: string, wallet: string;
let policy: ReturnType<typeof currentPolicy>;
function attest() {
  confirmPayoutVerification({ slot: 1, ownerId: owner, checks: Object.fromEntries(PAYOUT_VERIFICATION_CHECKS.map(check => [check.key, true])), attestation: 'Synthetic owner attestation for atomicity testing only; no actual payment destination.' });
}
before(() => {
  applyMissionMigrations();
  policy = currentPolicy();
  updatePolicy({ maxDailySpendCents: 1000000, maxExpenseCents: 100000, maxPayoutCents: 100000, requireApprovalAboveCents: 50, reinvestShareBps: 2500, killSwitch: false }, owner);
  missionDb.run("INSERT INTO mission_agents (id, slug, name, role_key, depth, generation, status, mission_role, origin_platform) VALUES (?, ?, 'Synthetic finance fixture', 'specialist', 0, 'custom', 'active', 'worker', 'mission')", [agent, agent]);
  treasury = (listWallets('mission')[0] ?? createWallet({ kind: 'mission', label: 'Synthetic test treasury' })).id;
  wallet = createWallet({ kind: 'agent', agentId: agent, label: 'Synthetic test earning wallet', budgetCents: 100000 }).id;
  credit({ walletId: treasury, amountCents: 20000, category: 'transfer', memo: 'synthetic fixture only' });
  credit({ walletId: wallet, amountCents: 5000, category: 'transfer', memo: 'synthetic fixture only' });
  configurePayoutSlot({ slot: 1, providerRef: 'acct_synthetic_atomic_fixture', minPayoutCents: 0, maxPayoutCents: 100000, currency: 'USD', actorId: owner });
  attest();
});
after(() => { updatePolicy(policy, owner); missionDb.close(); });
function snapshot() {
  return { wallets: missionDb.all('SELECT id, balance_cents, spent_cents FROM mission_wallets ORDER BY id'), counts: ['mission_ledger', 'mission_revenue', 'mission_audit', 'mission_expenses', 'mission_payouts'].map(table => missionDb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n) };
}
function failAfter(fragment: string, action: () => unknown, occurrence = 1) {
  const original = missionDb.run.bind(missionDb);
  let hits = 0;
  missionDb.run = ((sql, params) => { const result = original(sql, params); if (sql.includes(fragment) && ++hits === occurrence) throw new Error('injected mission write failure'); return result; }) as typeof missionDb.run;
  try { assert.throws(action, /injected mission write failure/); } finally { missionDb.run = original; }
}
function revenue() { return { walletId: wallet, agentId: agent, amountCents: 1000, source: 'synthetic-fixture', status: 'received' as const, verifier: 'synthetic owner receipt', idempotencyKey: randomUUID(), externalRef: randomUUID() }; }
function payout(amountCents = 100) { return requestPayout({ slot: 1, amountCents, idempotencyKey: randomUUID(), requestedBy: owner }); }

it('rolls a wallet credit, its ledger and audit back as one unit', () => {
  const before = snapshot();
  failAfter('INSERT INTO mission_audit', () => credit({ walletId: wallet, amountCents: 100, category: 'transfer' }));
  assert.deepEqual(snapshot(), before);
});
it('rolls all received-revenue sweep and reinvestment legs back on a middle-leg failure', () => {
  const input = revenue(), before = snapshot();
  failAfter('INSERT INTO mission_ledger', () => recordRevenue(input), 3);
  assert.deepEqual(snapshot(), before);
  const result = recordRevenue(input);
  assert.equal(result.duplicated, false);
  assert.ok(result.reinvestment);
  assert.equal(recordRevenue(input).duplicated, true);
  assert.equal(verifyLedger().ok, true);
  assert.equal(verifyMissionAudit().ok, true);
});
it('rejects an invalid revenue destination without persisting a stranded revenue row', () => {
  const before = snapshot();
  assert.throws(() => recordRevenue({ ...revenue(), walletId: 'missing-wallet' }), /wallet not found/);
  assert.deepEqual(snapshot(), before);
});
it('binds receipt and ledger idempotency keys to their original amount and wallet', () => {
  const input = { walletId: wallet, amountCents: 10, category: 'transfer', idempotencyKey: randomUUID() };
  const first = credit(input), second = credit(input);
  assert.deepEqual(second, first, 'replay returns the same typed ledger entry, not a raw snake_case row');
  assert.throws(() => credit({ ...input, amountCents: 11 }), /different movement/);
  assert.throws(() => debit(input), /different movement/);
  const receipt = revenue();
  recordRevenue(receipt);
  assert.throws(() => recordRevenue({ ...receipt, idempotencyKey: randomUUID() }), /receipt already recorded/);
  assert.throws(() => recordRevenue({ ...receipt, amountCents: 1001 }), /another receipt/);
});
it('rejects fractional and unsafe money instead of silently rounding it', () => {
  for (const amountCents of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => credit({ walletId: wallet, amountCents, category: 'transfer' }), /positive integer/);
    assert.throws(() => recordRevenue({ ...revenue(), amountCents }), /amount must be positive/);
    assert.throws(() => requestPayout({ slot: 1, amountCents, idempotencyKey: randomUUID() }), /amount must be positive/);
  }
});
it('rechecks expense policy at approval and atomically records payment', () => {
  const row = requestExpense({ agentId: agent, walletId: wallet, amountCents: 100, provider: 'fixture', description: 'synthetic expense', category: 'api', idempotencyKey: randomUUID() }).expense;
  setKillSwitch(true, owner);
  assert.throws(() => decideExpense({ id: String(row.id), decision: 'approved', actorId: owner }), /kill_switch/);
  setKillSwitch(false, owner);
  const before = snapshot();
  failAfter('UPDATE mission_expenses SET status', () => decideExpense({ id: String(row.id), decision: 'approved', actorId: owner }));
  assert.deepEqual(snapshot(), before);
  assert.equal(decideExpense({ id: String(row.id), decision: 'approved', actorId: owner }).status, 'paid');
  assert.throws(() => decideExpense({ id: String(row.id), decision: 'approved', actorId: owner }), /already paid/);
});
it('rolls payout reservation and approval back when the status write fails', () => {
  const row = payout(), before = snapshot();
  failAfter('UPDATE mission_payouts SET status', () => decidePayout({ id: String(row.id), decision: 'approved', actorId: owner }));
  assert.deepEqual(snapshot(), before);
  assert.equal(missionDb.get<{ status: string }>('SELECT status FROM mission_payouts WHERE id = ?', [String(row.id)])!.status, 'pending_approval');
});
it('refunds the exact original wallet once, with atomic rollback after a late failure', () => {
  const row = payout();
  decidePayout({ id: String(row.id), decision: 'approved', actorId: owner });
  const decoy = createWallet({ kind: 'mission', label: 'Another synthetic treasury' });
  missionDb.run("UPDATE mission_wallets SET created_at = '9999-01-01T00:00:00.000Z' WHERE id = ?", [decoy.id]);
  assert.equal(listWallets('mission')[0].id, decoy.id, 'the wrong wallet would be selected by an unbound refund');
  const before = snapshot(), sourceBalance = getWallet(treasury)!.balanceCents;
  const fail = () => settlePayout({ id: String(row.id), status: 'failed', failureReason: 'synthetic provider failure evidence', actorId: owner });
  failAfter('UPDATE mission_payouts SET status', fail);
  assert.deepEqual(snapshot(), before);
  fail();
  assert.equal(getWallet(treasury)!.balanceCents, sourceBalance + Number(row.amount_cents));
  assert.equal(getWallet(decoy.id)!.balanceCents, 0);
  assert.throws(fail, /payout is failed/);
  missionDb.run("UPDATE mission_wallets SET created_at = '1900-01-01T00:00:00.000Z' WHERE id = ?", [decoy.id]);
});
it('binds pending payouts to their destination and checks expiry without a background sweep', () => {
  const row = payout();
  configurePayoutSlot({ slot: 1, providerRef: 'acct_synthetic_changed', actorId: owner });
  attest();
  assert.throws(() => decidePayout({ id: String(row.id), decision: 'approved', actorId: owner }), /destination changed/);
  const next = payout();
  missionDb.run("UPDATE mission_payout_slot_verifications SET expires_at = '2000-01-01T00:00:00.000Z' WHERE slot = 1 AND status = 'verified'");
  assert.throws(() => decidePayout({ id: String(next.id), decision: 'approved', actorId: owner }), /expired/);
  assert.throws(() => payout(), /expired/);
  attest();
});
it('requires nonblank, immutable and non-reused settlement references', () => {
  const a = payout(), b = payout();
  for (const row of [a, b]) decidePayout({ id: String(row.id), decision: 'approved', actorId: owner });
  assert.throws(() => settlePayout({ id: String(a.id), status: 'settled', settlementRef: '   ', actorId: owner }), /reference/);
  const reference = `synthetic-${randomUUID()}`;
  settlePayout({ id: String(a.id), status: 'sent', settlementRef: reference, actorId: owner });
  assert.throws(() => settlePayout({ id: String(a.id), status: 'settled', settlementRef: 'another-reference', actorId: owner }), /cannot change/);
  assert.throws(() => settlePayout({ id: String(b.id), status: 'settled', settlementRef: reference, actorId: owner }), /another payout/);
  settlePayout({ id: String(a.id), status: 'settled', settlementRef: reference, actorId: owner });
  assert.equal(verifyLedger().ok, true);
  assert.equal(verifyMissionAudit().ok, true);
});
it('does not let agent requests spend treasury funds or another agent wallet', () => {
  const request = { agentId: agent, amountCents: 10, provider: 'fixture', description: 'synthetic unauthorized expense', category: 'api', idempotencyKey: randomUUID() };
  const before = snapshot();
  assert.throws(() => requestExpense({ ...request, walletId: treasury }), /not assigned/);
  assert.throws(() => requestExpense({ ...request, walletId: wallet, agentId: 'another-agent' }), /not assigned/);
  assert.deepEqual(snapshot(), before);
});
it('rechecks payout kill switch and cap at approval and refuses unbound legacy requests', () => {
  const row = payout();
  setKillSwitch(true, owner);
  assert.throws(() => decidePayout({ id: String(row.id), decision: 'approved', actorId: owner }), /kill switch/);
  setKillSwitch(false, owner);
  updatePolicy({ maxPayoutCents: 99 }, owner);
  assert.throws(() => decidePayout({ id: String(row.id), decision: 'approved', actorId: owner }), /limits/);
  updatePolicy({ maxPayoutCents: 100000 }, owner);
  missionDb.run('UPDATE mission_payouts SET destination_fingerprint = NULL WHERE id = ?', [String(row.id)]);
  assert.throws(() => decidePayout({ id: String(row.id), decision: 'approved', actorId: owner }), /unbound/);
});
it('refuses implicit currency conversion on revenue and payouts', () => {
  const foreign = createWallet({ kind: 'worker', currency: 'EUR', label: 'Synthetic foreign currency wallet' });
  const before = snapshot();
  assert.throws(() => recordRevenue({ ...revenue(), walletId: foreign.id }), /currencies/);
  assert.deepEqual(snapshot(), before);
  configurePayoutSlot({ slot: 1, currency: 'EUR', providerRef: 'acct_synthetic_eur', actorId: owner });
  attest();
  assert.throws(() => payout(), /currency differs/);
});

it('resource approval is not provisioning, and funded evidence commits exactly once', () => {
  const management = require('./self-management') as typeof import('./self-management');
  const resource = management.requestResource({ agentId: agent, kind: 'compute', provider: 'synthetic-provider', monthlyCostCents: 10, actorId: owner });
  assert.equal(resource.status, 'approved');
  assert.equal(management.resourceReadiness(String(resource.id)).usable, false);
  const input = { id: String(resource.id), walletId: treasury, actualCostCents: 10, providerRef: `fixture-${randomUUID().replace(/[0-9]/g, 'x')}`, evidence: 'Synthetic provisioning fixture; no actual provider contacted.', actorId: owner };
  assert.throws(() => management.provisionResource({ ...input, actualCostCents: 11 }), /approved quote/);
  assert.throws(() => management.provisionResource({ ...input, evidence: '' }), /evidence/);
  assert.throws(() => management.provisionResource({ ...input, providerRef: 'private_key=not-a-provider-reference' }), /instruments or credentials/);
  const before = snapshot(), balance = getWallet(treasury)!.balanceCents;
  failAfter('UPDATE mission_resources SET status', () => management.provisionResource(input));
  assert.deepEqual(snapshot(), before);
  assert.equal(management.provisionResource(input).status, 'active');
  assert.equal(getWallet(treasury)!.balanceCents, balance - 10);
  assert.throws(() => management.provisionResource(input), /already provisioned/);
  assert.equal(management.resourceReadiness(String(resource.id)).usable, true);
  const another = management.requestResource({ agentId: agent, kind: 'compute', provider: 'synthetic-provider', monthlyCostCents: 10 });
  assert.throws(() => management.provisionResource({ ...input, id: String(another.id) }), /already recorded/);
});
it('resource readiness checks credentials, quota and expiry live, without a sweep', () => {
  const management = require('./self-management') as typeof import('./self-management');
  const resource = management.requestResource({ agentId: agent, kind: 'api', provider: 'fixture', monthlyCostCents: 0, limits: { requests: 2 } });
  management.provisionResource({ id: String(resource.id), actualCostCents: 0, providerRef: `fixture-${randomUUID().replace(/[0-9]/g, 'x')}`, evidence: 'Synthetic API provisioning evidence; not a real account.', actorId: owner });
  assert.ok(management.resourceReadiness(String(resource.id)).blockers.includes('credential_not_configured'));
  assert.throws(() => management.recordResourceUsage({ id: String(resource.id), usage: { requests: 2 }, actorType: 'agent', actorId: 'wrong-agent' }), /another agent/);
  management.recordResourceUsage({ id: String(resource.id), usage: { requests: 2 }, actorType: 'agent', actorId: agent });
  assert.ok(management.resourceReadiness(String(resource.id)).blockers.includes('quota_exhausted:requests'));
  missionDb.run("UPDATE mission_resources SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", [String(resource.id)]);
  assert.ok(management.resourceReadiness(String(resource.id)).blockers.includes('resource_expired'));
});
it('an above-threshold owner-approved upgrade charges atomically and cannot apply without funds', () => {
  const management = require('./self-management') as typeof import('./self-management');
  const row = management.requestUpgrade({ agentId: agent, walletId: wallet, capability: 'synthetic test capability', requestedCostCents: 100 }).upgrade;
  const before = snapshot(), balance = getWallet(wallet)!.balanceCents;
  failAfter('UPDATE mission_upgrades SET status', () => management.decideUpgrade({ id: String(row.id), decision: 'approved', actorId: owner }));
  assert.deepEqual(snapshot(), before);
  assert.equal(management.decideUpgrade({ id: String(row.id), decision: 'approved', actorId: owner }).status, 'approved');
  assert.equal(getWallet(wallet)!.balanceCents, balance - 100);
  assert.throws(() => management.decideUpgrade({ id: String(row.id), decision: 'approved', actorId: owner }), /upgrade is approved/);
  assert.equal(verifyLedger().ok, true);
  assert.equal(verifyMissionAudit().ok, true);
});

it('mission message and audit writes roll back together and paginated replies remain scoped', () => {
  const messaging = require('./messaging') as typeof import('./messaging');
  const input = { agentId: agent, actorType: 'owner' as const, actorId: owner, body: 'Synthetic owner message; no tools or payments may be executed from chat.', idempotencyKey: randomUUID() };
  const before = snapshot();
  failAfter('INSERT INTO mission_audit', () => messaging.appendAgentMessage(input));
  assert.deepEqual(snapshot(), before);
  assert.equal(messaging.listAgentMessages(agent).messages.length, 0);
  const first = messaging.appendAgentMessage(input);
  assert.equal(messaging.appendAgentMessage(input).duplicate, true);
  assert.throws(() => messaging.appendAgentMessage({ ...input, body: 'different message' }), /different content/);
  assert.throws(() => messaging.appendAgentMessage({ ...input, actorType: 'agent', actorId: 'wrong-agent' }), /identity/);
  assert.throws(() => messaging.appendAgentMessage({ ...input, idempotencyKey: randomUUID(), replyTo: 'other-thread-message' }), /reply target/);
  const reply = messaging.appendAgentMessage({ ...input, actorType: 'agent', actorId: agent, body: 'Synthetic agent reply, not automatically generated.', replyTo: String(first.message.id), idempotencyKey: randomUUID() });
  const page = messaging.listAgentMessages(agent, Number(first.message.seq));
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].id, reply.message.id);
  assert.equal(page.automaticReplies, false);
});
