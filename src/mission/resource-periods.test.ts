import { before, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mission-period-')), 'mission.db')}`;
const { missionDb, applyMissionMigrations, verifyMissionAudit } = require('./database') as typeof import('./database');
const { currentPolicy, updatePolicy } = require('./policy') as typeof import('./policy');
const { requestResource, provisionResource, recordResourceUsage, retireResource, resourceReadiness } = require('./self-management') as typeof import('./self-management');
const { createWallet, getWallet, credit, verifyLedger } = require('./treasury') as typeof import('./treasury');
const { recordResourcePeriod, listResourcePeriods } = require('./resource-periods') as typeof import('./resource-periods');
const { reserveResourceCall, claimResourceCall, settleResourceCall, cancelResourceCall } = require('./resource-calls') as typeof import('./resource-calls');
const { recordResourceCallCost } = require('./resource-budgets') as typeof import('./resource-budgets');
const owner = { actorType: 'owner' as const, actorId: `synthetic-owner-${randomUUID()}` };
const ref = () => `synthetic-${randomUUID().replace(/[0-9]/g, 'x')}`;
let original: ReturnType<typeof currentPolicy>;
before(() => { applyMissionMigrations(); original = currentPolicy(); updatePolicy({ killSwitch: false, maxDailySpendCents: 1000000, maxExpenseCents: 1000, requireApprovalAboveCents: 50 }, owner.actorId); });
after(() => { updatePolicy(original, owner.actorId); missionDb.close(); });
function fixture(reserve = false) {
  const agentId = `synthetic-period-agent-${randomUUID()}`, credentialId = `synthetic-period-credential-${randomUUID()}`;
  missionDb.run("INSERT INTO mission_agents (id, slug, name, role_key, depth, generation, status, mission_role, origin_platform) VALUES (?, ?, 'Synthetic period agent', 'specialist', 0, 'custom', 'active', 'worker', 'mission')", [agentId, agentId]);
  missionDb.run("INSERT INTO mission_credentials (id, provider, label, kind, masked_hint, ciphertext, iv, tag, status) VALUES (?, 'synthetic-period-provider', 'Synthetic metadata only', 'api_key', 'fixture', 'fixture', 'fixture', 'fixture', 'active')", [credentialId]);
  const expiry = new Date(Date.now() - 3600000).toISOString();
  const resource = requestResource({ agentId, provider: 'synthetic-period-provider', kind: 'api', credentialId, monthlyCostCents: 10, expiresAt: expiry, limits: { requests: 10 } });
  const resourceId = String(resource.id), provisioningRef = ref();
  provisionResource({ id: resourceId, actualCostCents: 0, providerRef: provisioningRef, evidence: 'Synthetic provisioning fixture, no real purchase.', actorId: owner.actorId });
  recordResourceUsage({ id: resourceId, usage: { requests: 3 }, ...owner });
  const wallet = createWallet({ kind: reserve ? 'reserve' : 'agent', agentId: reserve ? undefined : agentId, label: 'Synthetic period funding wallet', budgetCents: 100 });
  credit({ walletId: wallet.id, amountCents: 100, category: 'transfer', memo: 'Synthetic test funds, not earned income' });
  const input = { idempotencyKey: randomUUID(), expectedExpiresAt: expiry, periodStart: new Date(Date.now() - 60000).toISOString(), periodEnd: new Date(Date.now() + 86400000).toISOString(), limits: { requests: 20 }, startingUsage: { requests: 2 }, actualCostCents: 5, currency: 'USD', walletId: wallet.id, providerRef: ref(), evidence: 'Synthetic owner billing-period evidence, not an external provider receipt.' };
  return { agentId, resourceId, provisioningRef, walletId: wallet.id, input };
}
function resource(id: string) { return missionDb.get<{ expires_at: string; usage: string; limits: string }>('SELECT expires_at, usage, limits FROM mission_resources WHERE id = ?', [id])!; }
function readyCall(f: ReturnType<typeof fixture>, budget = false) {
  missionDb.run('UPDATE mission_resources SET expires_at = ? WHERE id = ?', [new Date(Date.now() + 86400000).toISOString(), f.resourceId]);
  const actor = { actorType: 'agent' as const, actorId: f.agentId };
  const call = reserveResourceCall({ resourceId: f.resourceId, agentId: f.agentId, ...actor, idempotencyKey: randomUUID(), operationFingerprint: 'f'.repeat(64), units: { requests: 1 }, ...(budget ? { budget: { walletId: f.walletId, maxCostCents: 20 } } : {}) });
  return { call, actor, expire: () => missionDb.run('UPDATE mission_resources SET expires_at = ? WHERE id = ?', [f.input.expectedExpiresAt, f.resourceId]) };
}
const usageProof = () => ({ outcome: 'succeeded' as const, actualUsage: { requests: 1 }, providerRef: ref(), evidence: 'Synthetic prior-period usage evidence only.' });

it('records a current evidenced period, preserves old usage and debits only funded private accounting', () => {
  const f = fixture(), before = resource(f.resourceId);
  const result = recordResourcePeriod(f.resourceId, f.input, owner);
  assert.equal(result.externalPaymentExecuted, false); assert.equal(result.providerVerified, false);
  assert.equal(getWallet(f.walletId)!.balanceCents, 95);
  assert.equal(resource(f.resourceId).usage, '{"requests":2}');
  assert.equal(resource(f.resourceId).expires_at, f.input.periodEnd);
  const history = listResourcePeriods(f.resourceId, owner).periods;
  assert.equal(history[0].previous_usage, before.usage); assert.equal(history[0].previous_limits, before.limits);
  assert.ok(!JSON.stringify(history).includes('request_fingerprint'));
  assert.equal(recordResourcePeriod(f.resourceId, f.input, owner).duplicate, true);
  assert.equal(getWallet(f.walletId)!.balanceCents, 95);
  assert.throws(() => recordResourcePeriod(f.resourceId, { ...f.input, actualCostCents: 4 }, owner), /different evidence/);
  assert.equal(resourceReadiness(f.resourceId).usable, true);
});

it('rejects agent authority, foreign wallets, stale/overlapping/future periods and guessed starting usage', () => {
  const f = fixture(), other = fixture();
  const agent = { actorType: 'agent' as const, actorId: f.agentId };
  assert.throws(() => recordResourcePeriod(f.resourceId, f.input, agent), /trusted owner/);
  assert.throws(() => listResourcePeriods(f.resourceId, agent), /trusted owner/);
  assert.throws(() => recordResourcePeriod(f.resourceId, { ...f.input, walletId: other.walletId }, owner), /assignment/);
  assert.throws(() => recordResourcePeriod(f.resourceId, { ...f.input, startingUsage: {} }, owner), /every new period counter/);
  assert.throws(() => recordResourcePeriod(f.resourceId, { ...f.input, expectedExpiresAt: 'stale' }, owner), /expiry/);
  for (const times of [{ periodStart: new Date(Date.now() - 7200000).toISOString() }, { periodStart: new Date(Date.now() + 100000).toISOString() }, { periodEnd: new Date(Date.now() - 1000).toISOString() }]) assert.throws(() => recordResourcePeriod(f.resourceId, { ...f.input, ...times }, owner), /current, non-overlapping/);
  assert.equal(getWallet(f.walletId)!.balanceCents, 100);
});

it('pending quota calls and settled-but-unpriced calls cannot be erased by a new period', () => {
  for (const state of ['reserved', 'dispatched', 'financial'] as const) {
    const f = fixture(), pending = readyCall(f, state === 'financial');
    if (state !== 'reserved') claimResourceCall(String(pending.call.id), pending.actor);
    if (state === 'financial') settleResourceCall(String(pending.call.id), pending.actor, usageProof());
    pending.expire();
    assert.throws(() => recordResourcePeriod(f.resourceId, f.input, owner), /outstanding quota and financial holds/);
    if (state === 'reserved') cancelResourceCall(String(pending.call.id), owner);
    if (state === 'dispatched') settleResourceCall(String(pending.call.id), owner, usageProof());
    if (state === 'financial') recordResourceCallCost(f.resourceId, String(pending.call.id), owner, { actualCostCents: 0, providerRef: ref(), evidence: 'Synthetic adapter had no external charge.' });
    recordResourcePeriod(f.resourceId, f.input, owner);
  }
});

it('old settled receipts remain immutable and cannot add prior-period usage into a renewed period', () => {
  const f = fixture(), pending = readyCall(f), proof = usageProof();
  claimResourceCall(String(pending.call.id), pending.actor); settleResourceCall(String(pending.call.id), pending.actor, proof); pending.expire();
  recordResourcePeriod(f.resourceId, f.input, owner);
  settleResourceCall(String(pending.call.id), owner, proof);
  assert.equal(resource(f.resourceId).usage, '{"requests":2}');
  assert.equal(listResourcePeriods(f.resourceId, owner).periods[0].previous_usage, '{"requests":4}');
});

it('rolls back period history, quota reset, wallet debit and audit on late write failures', () => {
  const f = fixture(), before = resource(f.resourceId), wallet = getWallet(f.walletId);
  const counts = () => ['mission_ledger', 'mission_audit', 'mission_resource_periods'].map(table => Number(missionDb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n));
  const originalCounts = counts(), run = missionDb.run.bind(missionDb);
  missionDb.run = ((sql, params) => { const result = run(sql, params); if (sql.includes('UPDATE mission_resources SET expires_at')) throw new Error('synthetic late period failure'); return result; }) as typeof missionDb.run;
  try { assert.throws(() => recordResourcePeriod(f.resourceId, f.input, owner), /synthetic late period failure/); } finally { missionDb.run = run; }
  assert.deepEqual(resource(f.resourceId), before); assert.deepEqual(getWallet(f.walletId), wallet); assert.deepEqual(counts(), originalCounts);
  recordResourcePeriod(f.resourceId, f.input, owner);
  assert.equal(verifyLedger().ok, true); assert.equal(verifyMissionAudit().ok, true);
});

it('a financial reference cannot be reused across provisioning, renewal and metered usage', () => {
  const f = fixture();
  assert.throws(() => recordResourcePeriod(f.resourceId, { ...f.input, providerRef: f.provisioningRef }, owner), /already recorded/);
  recordResourcePeriod(f.resourceId, f.input, owner);
  const other = fixture();
  assert.throws(() => recordResourcePeriod(other.resourceId, { ...other.input, providerRef: f.input.providerRef }, owner), /already recorded/);
  const newResource = requestResource({ agentId: other.agentId, provider: 'synthetic-period-provider', kind: 'api' });
  assert.throws(() => provisionResource({ id: String(newResource.id), actualCostCents: 0, providerRef: f.input.providerRef, evidence: 'Synthetic duplicate billing receipt', actorId: owner.actorId }), /already recorded/);
  const pending = readyCall(other, true);
  claimResourceCall(String(pending.call.id), pending.actor); settleResourceCall(String(pending.call.id), pending.actor, usageProof());
  assert.throws(() => recordResourceCallCost(other.resourceId, String(pending.call.id), owner, { actualCostCents: 0, providerRef: f.input.providerRef, evidence: 'Synthetic duplicate billing receipt' }), /already recorded/);
  const paidReference = ref();
  recordResourceCallCost(other.resourceId, String(pending.call.id), owner, { actualCostCents: 0, providerRef: paidReference, evidence: 'Synthetic adapter no-charge evidence' }); pending.expire();
  assert.throws(() => recordResourcePeriod(other.resourceId, { ...other.input, providerRef: paidReference }, owner), /already recorded/);
});

it('requires funded policy authority but can use a private reserve without creating income', () => {
  const f = fixture(true);
  const revenueCount = Number(missionDb.get<{ n: number }>('SELECT COUNT(*) AS n FROM mission_revenue')!.n);
  assert.throws(() => recordResourcePeriod(f.resourceId, { ...f.input, actualCostCents: 11 }, owner), /approved resource quote/);
  assert.throws(() => recordResourcePeriod(f.resourceId, { ...f.input, currency: 'EUR' }, owner), /currency/);
  recordResourcePeriod(f.resourceId, f.input, owner);
  assert.equal(getWallet(f.walletId)!.balanceCents, 95);
  assert.equal(Number(missionDb.get<{ n: number }>('SELECT COUNT(*) AS n FROM mission_revenue')!.n), revenueCount);
  const retired = fixture(); retireResource(retired.resourceId, owner.actorId);
  assert.throws(() => recordResourcePeriod(retired.resourceId, retired.input, owner), /non-retired/);
});

it('period cursors are bounded and scoped; explicit free periods do not create debit entries', () => {
  const f = fixture(), other = fixture();
  const first = recordResourcePeriod(f.resourceId, { ...f.input, actualCostCents: 0, walletId: undefined }, owner);
  assert.equal(getWallet(f.walletId)!.balanceCents, 100);
  assert.equal(listResourcePeriods(f.resourceId, owner).periods[0].ledger_id, null);
  assert.equal(listResourcePeriods(f.resourceId, owner, { before: first.periodId }).periods.length, 0);
  assert.throws(() => listResourcePeriods(other.resourceId, owner, { before: first.periodId }), /does not belong/);
  assert.throws(() => listResourcePeriods(f.resourceId, owner, { limit: 101 }), /limit/);
});
