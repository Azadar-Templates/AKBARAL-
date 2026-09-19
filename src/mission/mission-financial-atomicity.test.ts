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

it('direct resource decisions synchronize the queue and roll both records back on failure', () => {
  const management = require('./self-management') as typeof import('./self-management');
  const resource = management.requestResource({ agentId: agent, kind: 'storage', provider: 'synthetic-provider', monthlyCostCents: 100 });
  const id = String(resource.id);
  const queue = () => missionDb.get<{ status: string }>('SELECT status FROM mission_approvals WHERE subject_type = ? AND subject_id = ?', ['resource', id])!;
  const before = snapshot();
  failAfter('UPDATE mission_resources SET status', () => management.decideResource({ id, decision: 'approved', actorId: owner }));
  assert.deepEqual(snapshot(), before);
  assert.equal(queue().status, 'pending');
  assert.equal(management.decideResource({ id, decision: 'approved', actorId: owner }).status, 'approved');
  assert.equal(queue().status, 'approved');
  assert.throws(() => management.decideResource({ id, decision: 'rejected', actorId: owner }), /resource is approved/);
  const conflicting = management.requestResource({ agentId: agent, kind: 'storage', provider: 'synthetic-provider', monthlyCostCents: 100 });
  missionDb.run("UPDATE mission_approvals SET status = 'rejected' WHERE subject_type = 'resource' AND subject_id = ?", [String(conflicting.id)]);
  assert.throws(() => management.decideResource({ id: String(conflicting.id), decision: 'approved', actorId: owner }), /conflicting/);
});

it('upgrade approval, queue decision, debit and audits are atomic and cannot charge twice', () => {
  const management = require('./self-management') as typeof import('./self-management');
  const row = management.requestUpgrade({ agentId: agent, capability: 'Synthetic approval-sync fixture', requestedCostCents: 100, walletId: wallet }).upgrade;
  const id = String(row.id);
  const queue = () => missionDb.get<{ status: string }>('SELECT status FROM mission_approvals WHERE subject_type = ? AND subject_id = ?', ['upgrade', id])!;
  const before = snapshot();
  failAfter('UPDATE mission_upgrades SET status', () => management.decideUpgrade({ id, decision: 'approved', actorId: owner }));
  assert.deepEqual(snapshot(), before);
  assert.equal(queue().status, 'pending');
  management.decideUpgrade({ id, decision: 'approved', actorId: owner });
  assert.equal(queue().status, 'approved');
  const approved = snapshot();
  assert.throws(() => management.decideUpgrade({ id, decision: 'approved', actorId: owner }), /upgrade is approved/);
  assert.deepEqual(snapshot(), approved);
  assert.equal(verifyLedger().ok, true);
  assert.equal(verifyMissionAudit().ok, true);
});

it('tool decisions synchronize atomically and current blocks cannot be bypassed by pending requests', () => {
  const management = require('./self-management') as typeof import('./self-management');
  management.seedTools();
  const countBefore = missionDb.get<{ n: number }>('SELECT COUNT(*) AS n FROM mission_tool_requests')!.n;
  failAfter('INSERT INTO mission_approvals', () => management.requestTool({ agentId: agent, toolKey: 'gemini_api' }));
  assert.equal(missionDb.get<{ n: number }>('SELECT COUNT(*) AS n FROM mission_tool_requests')!.n, countBefore);
  const row = management.requestTool({ agentId: agent, toolKey: 'gemini_api' });
  const id = String(row.id);
  const queue = () => missionDb.get<{ status: string }>('SELECT status FROM mission_approvals WHERE subject_type = ? AND subject_id = ?', ['tool', id])!;
  const before = snapshot();
  failAfter('UPDATE mission_tool_requests SET status', () => management.decideToolRequest({ id, decision: 'approved', actorId: owner }));
  assert.deepEqual(snapshot(), before);
  assert.equal(queue().status, 'pending');
  management.setToolStatus('gemini_api', 'blocked', owner);
  try {
    assert.throws(() => management.decideToolRequest({ id, decision: 'approved', actorId: owner }), /blocked/);
    assert.equal(queue().status, 'pending');
    management.decideToolRequest({ id, decision: 'rejected', actorId: owner });
    assert.equal(queue().status, 'rejected');
  } finally { management.setToolStatus('gemini_api', 'approved', owner); }
});

it('resource counters cannot drop exhausted metrics, decrease usage or accept malformed quota values', () => {
  const management = require('./self-management') as typeof import('./self-management');
  for (const limits of [{ requests: -1 }, { requests: '2' }, [], { requests: NaN }]) {
    assert.throws(() => management.requestResource({ agentId: agent, kind: 'storage', provider: 'synthetic-provider', limits: limits as Record<string, unknown> }), /counter/);
  }
  const resource = management.requestResource({ agentId: agent, kind: 'storage', provider: 'synthetic-provider', limits: { requests: 2 } });
  const id = String(resource.id);
  assert.ok(management.resourceReadiness(id).blockers.includes('quota_usage_unreported:requests'));
  management.recordResourceUsage({ id, usage: { requests: 2 }, actorType: 'agent', actorId: agent });
  const before = snapshot();
  const previous = missionDb.get<{ usage: string }>('SELECT usage FROM mission_resources WHERE id = ?', [id])!.usage;
  failAfter('INSERT INTO mission_audit', () => management.recordResourceUsage({ id, usage: { requests: 3 }, actorType: 'agent', actorId: agent }));
  assert.deepEqual(snapshot(), before);
  assert.equal(missionDb.get<{ usage: string }>('SELECT usage FROM mission_resources WHERE id = ?', [id])!.usage, previous);
  for (const usage of [{ requests: 0 }, { requests: -1 }, { requests: '0' }, [], { requests: Infinity }]) {
    assert.throws(() => management.recordResourceUsage({ id, usage: usage as Record<string, unknown>, actorType: 'owner', actorId: owner }), /counter|cannot decrease/);
  }
  const merged = management.recordResourceUsage({ id, usage: { bytes: 10 }, actorType: 'owner', actorId: owner });
  assert.equal(JSON.parse(String(merged.usage)).requests, 2, 'omitted counters cannot clear an exhausted quota');
  assert.ok(management.resourceReadiness(id).blockers.includes('quota_exhausted:requests'));
  missionDb.run('UPDATE mission_resources SET limits = ? WHERE id = ?', [JSON.stringify({ requests: 'unlimited' }), id]);
  assert.ok(management.resourceReadiness(id).blockers.includes('invalid_usage_or_limits'));
});

it('resource readiness checks actual credential expiry, revocation, provider binding and agent state without a sweep', () => {
  const management = require('./self-management') as typeof import('./self-management');
  const credentialId = `synthetic-metadata-${randomUUID()}`;
  missionDb.run("INSERT INTO mission_credentials (id, provider, label, kind, masked_hint, ciphertext, iv, tag, status) VALUES (?, 'synthetic-provider', 'Synthetic metadata only, not a usable secret', 'api_key', 'fixture', 'fixture', 'fixture', 'fixture', 'active')", [credentialId]);
  const resource = management.requestResource({ agentId: agent, kind: 'api', provider: 'synthetic-provider', credentialId, limits: { requests: 2 } });
  const id = String(resource.id);
  management.provisionResource({ id, actualCostCents: 0, providerRef: `synthetic-${randomUUID().replace(/[0-9]/g, 'x')}`, evidence: 'Synthetic readiness fixture only; no provider purchase.', actorId: owner });
  management.recordResourceUsage({ id, usage: { requests: 0 }, actorType: 'owner', actorId: owner });
  assert.equal(management.resourceReadiness(id).usable, true);
  missionDb.run("UPDATE mission_credentials SET expires_at = '2000-01-01T00:00:00Z' WHERE id = ?", [credentialId]);
  assert.ok(management.resourceReadiness(id).blockers.includes('credential_unavailable_or_expired'));
  missionDb.run("UPDATE mission_credentials SET expires_at = NULL, status = 'revoked' WHERE id = ?", [credentialId]);
  assert.equal(management.resourceReadiness(id).usable, false);
  missionDb.run("UPDATE mission_credentials SET status = 'active', provider = 'other-synthetic-provider' WHERE id = ?", [credentialId]);
  assert.ok(management.resourceReadiness(id).blockers.includes('credential_provider_mismatch'));
  missionDb.run("UPDATE mission_credentials SET provider = 'synthetic-provider' WHERE id = ?", [credentialId]);
  missionDb.run("UPDATE mission_agents SET status = 'paused' WHERE id = ?", [agent]);
  try { assert.ok(management.resourceReadiness(id).blockers.includes('resource_agent_inactive_or_missing')); }
  finally { missionDb.run("UPDATE mission_agents SET status = 'active' WHERE id = ?", [agent]); }
});

it('owner credential rebinding is provider/expiry guarded, optimistic, atomic and never spends or resets quotas', () => {
  const management = require('./self-management') as typeof import('./self-management');
  const makeCredential = (provider: string) => {
    const id = `synthetic-binding-${randomUUID()}`;
    missionDb.run("INSERT INTO mission_credentials (id, provider, label, kind, masked_hint, ciphertext, iv, tag, status) VALUES (?, ?, 'Synthetic metadata only', 'api_key', 'fixture', 'fixture', 'fixture', 'fixture', 'active')", [id, provider]);
    return id;
  };
  const first = makeCredential('synthetic-provider'), second = makeCredential('synthetic-provider'), other = makeCredential('different-synthetic-provider');
  const resource = management.requestResource({ agentId: agent, provider: 'synthetic-provider', kind: 'api', limits: { requests: 1 } });
  const id = String(resource.id);
  management.recordResourceUsage({ id, usage: { requests: 1 }, actorType: 'owner', actorId: owner });
  const input = { id, credentialId: first, expectedCredentialId: null, reason: 'Synthetic owner replacement review; no external activation.', actorId: owner, actorType: 'owner' as const };
  assert.throws(() => management.bindResourceCredential({ ...input, actorType: 'agent' }), /cannot bind/);
  assert.throws(() => management.bindResourceCredential({ ...input, credentialId: other }), /another provider/);
  missionDb.run("UPDATE mission_credentials SET expires_at = '2000-01-01T00:00:00Z' WHERE id = ?", [first]);
  assert.throws(() => management.bindResourceCredential(input), /expired/);
  missionDb.run('UPDATE mission_credentials SET expires_at = NULL WHERE id = ?', [first]);
  const before = snapshot();
  failAfter('INSERT INTO mission_audit', () => management.bindResourceCredential(input));
  assert.deepEqual(snapshot(), before);
  assert.equal(missionDb.get<{ credential_id: string | null }>('SELECT credential_id FROM mission_resources WHERE id = ?', [id])!.credential_id, null);
  const bound = management.bindResourceCredential(input);
  assert.equal(bound.credential_id, first);
  assert.equal(bound.status, 'approved', 'binding is not provisioning');
  assert.equal(JSON.parse(String(bound.usage)).requests, 1);
  const afterBinding = snapshot();
  management.bindResourceCredential(input);
  assert.deepEqual(snapshot(), afterBinding, 'repeating the same binding adds no audit or money movement');
  assert.deepEqual(afterBinding.wallets, before.wallets);
  assert.throws(() => management.bindResourceCredential({ ...input, credentialId: second }), /binding changed/);
  assert.equal(management.bindResourceCredential({ ...input, credentialId: second, expectedCredentialId: first }).credential_id, second);
  assert.ok(management.resourceReadiness(id).blockers.includes('quota_exhausted:requests'));
});

it('sweeping historical payout attestations cannot pause a newly reverified destination', () => {
  const verification = require('./payout-verification') as typeof import('./payout-verification');
  for (const invalidation of ['expiry', 'destination'] as const) {
    attest();
    const old = verification.payoutSlotVerificationStatus(1).verification!;
    missionDb.run("UPDATE mission_payout_slot_verifications SET created_at = '1970-01-01T00:00:00Z' WHERE id = ?", [old.id]);
    if (invalidation === 'expiry') missionDb.run("UPDATE mission_payout_slot_verifications SET expires_at = '2000-01-01T00:00:00Z' WHERE id = ?", [old.id]);
    else missionDb.run("UPDATE mission_payout_slot_verifications SET destination_fingerprint = 'synthetic-obsolete-destination' WHERE id = ?", [old.id]);
    attest();
    assert.equal(verification.payoutSlotVerificationStatus(1).payable, true);
    const sweep = verification.sweepPayoutVerifications();
    assert.equal(verification.payoutSlotVerificationStatus(1).payable, true, `old ${invalidation} must not disable fresh owner verification`);
    assert.ok(!sweep.paused.includes(1));
    assert.equal(missionDb.get<{ status: string }>('SELECT status FROM mission_payout_slot_verifications WHERE id = ?', [old.id])!.status, 'expired');
  }
  const latest = verification.payoutSlotVerificationStatus(1).verification!;
  missionDb.run("UPDATE mission_payout_slot_verifications SET expires_at = '2000-01-01T00:00:00Z' WHERE id = ?", [latest.id]);
  try {
    assert.ok(verification.sweepPayoutVerifications().paused.includes(1), 'expiry of the current verification still pauses the slot');
    assert.equal(verification.payoutSlotVerificationStatus(1).payable, false);
  } finally {
    missionDb.run("UPDATE mission_payout_slot_verifications SET created_at = '1970-01-01T00:00:00Z' WHERE id = ?", [latest.id]);
    attest();
  }
  assert.equal(verifyMissionAudit().ok, true);
});
