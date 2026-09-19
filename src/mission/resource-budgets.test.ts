import { after, before, it } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mission-call-budgets-')), 'mission.db')}`;
const { applyMissionMigrations, missionDb, verifyMissionAudit } = require('./database') as typeof import('./database');
const { currentPolicy, updatePolicy, dailySpendCents, canAgentSpend } = require('./policy') as typeof import('./policy');
const { requestResource, provisionResource, recordResourceUsage } = require('./self-management') as typeof import('./self-management');
const { reserveResourceCall, claimResourceCall, cancelResourceCall, markResourceCallUncertain, settleResourceCall } = require('./resource-calls') as typeof import('./resource-calls');
const { createWallet, credit, debit, getWallet, setWalletBudget, verifyLedger } = require('./treasury') as typeof import('./treasury');
const { heldResourceBudget } = require('./resource-budget-state') as typeof import('./resource-budget-state');
const { getResourceCallBudget, recordResourceCallCost } = require('./resource-budgets') as typeof import('./resource-budgets');
const owner = { actorType: 'owner' as const, actorId: `synthetic-owner-${randomUUID()}` };
let original: ReturnType<typeof currentPolicy>;
before(() => { applyMissionMigrations(); original = currentPolicy(); updatePolicy({ killSwitch: false, maxDailySpendCents: 1000000, maxExpenseCents: 10000, requireApprovalAboveCents: 5000 }, owner.actorId); });
after(() => { updatePolicy(original, owner.actorId); missionDb.close(); });
function fixture(maxCostCents = 40) {
  const agentId = `synthetic-agent-${randomUUID()}`, credentialId = `synthetic-credential-${randomUUID()}`;
  const actor = { actorType: 'agent' as const, actorId: agentId };
  missionDb.run("INSERT INTO mission_agents (id, slug, name, role_key, depth, generation, status, mission_role, origin_platform) VALUES (?, ?, 'Synthetic budget fixture', 'specialist', 0, 'custom', 'active', 'worker', 'mission')", [agentId, agentId]);
  missionDb.run("INSERT INTO mission_credentials (id, provider, label, kind, masked_hint, ciphertext, iv, tag, status) VALUES (?, 'synthetic-budget-provider', 'Nonfunctional fixture', 'api_key', 'fixture', 'fixture', 'fixture', 'fixture', 'active')", [credentialId]);
  const resource = requestResource({ agentId, kind: 'api', provider: 'synthetic-budget-provider', credentialId, limits: { requests: 10 } });
  const resourceId = String(resource.id);
  provisionResource({ id: resourceId, actualCostCents: 0, providerRef: `synthetic-${randomUUID().replace(/[0-9]/g, 'x')}`, evidence: 'Synthetic fixture; no real purchase.', actorId: owner.actorId });
  recordResourceUsage({ id: resourceId, usage: { requests: 0 }, ...owner });
  const wallet = createWallet({ kind: 'agent', agentId, label: 'Synthetic funded wallet', budgetCents: 100 });
  credit({ walletId: wallet.id, amountCents: 100, category: 'transfer', memo: 'Synthetic fixture funds, not real revenue' });
  const input = { resourceId, agentId, ...actor, idempotencyKey: randomUUID(), operationFingerprint: 'b'.repeat(64), units: { requests: 1 }, budget: { walletId: wallet.id, maxCostCents } };
  return { resourceId, walletId: wallet.id, actor, input };
}
const proof = (actualCostCents = 25) => ({ actualCostCents, providerRef: `synthetic-charge-${randomUUID()}`, evidence: 'Synthetic financial receipt, not an external provider charge.' });
function finish(id: string, actor: { actorType: 'owner' | 'agent'; actorId: string }) {
  settleResourceCall(id, actor, { outcome: 'succeeded', actualUsage: { requests: 1 }, providerRef: `synthetic-usage-${randomUUID()}`, evidence: 'Synthetic usage evidence only, no payment proof.' });
}
function failAfter(fragment: string, action: () => unknown) {
  const original = missionDb.run.bind(missionDb);
  missionDb.run = ((sql, params) => { const result = original(sql, params); if (sql.includes(fragment)) throw new Error('synthetic budget write failure'); return result; }) as typeof missionDb.run;
  try { assert.throws(action, /synthetic budget write failure/); } finally { missionDb.run = original; }
}

it('atomically reserves wallet balance and spending authority without moving money', () => {
  const f = fixture(60), before = getWallet(f.walletId)!;
  const row = reserveResourceCall(f.input);
  assert.equal(heldResourceBudget(f.walletId), 60);
  assert.deepEqual(getWallet(f.walletId), before);
  assert.equal(reserveResourceCall(f.input).id, row.id);
  assert.throws(() => reserveResourceCall({ ...f.input, budget: undefined }), /another provider budget/);
  assert.throws(() => reserveResourceCall({ ...f.input, budget: { ...f.input.budget, maxCostCents: 59 } }), /another provider budget/);
  assert.throws(() => reserveResourceCall({ ...f.input, idempotencyKey: randomUUID() }), /budget refused/);
  assert.throws(() => debit({ walletId: f.walletId, amountCents: 50, category: 'transfer' }), /funds are held/);
  assert.equal(canAgentSpend({ walletId: f.walletId, amountCents: 50, category: 'expense' }, currentPolicy(), dailySpendCents(new Date().toISOString())).allowed, false);
  cancelResourceCall(String(row.id), f.actor);
  assert.equal(heldResourceBudget(f.walletId), 0);
  assert.equal(getResourceCallBudget(String(row.id))!.status, 'released');
});

it('refuses missing authority, foreign wallets, zero caps and approval-required exposure', () => {
  const a = fixture(), b = fixture();
  assert.throws(() => reserveResourceCall({ ...a.input, budget: b.input.budget }), /assigned agent/);
  for (const maxCostCents of [0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => reserveResourceCall({ ...a.input, budget: { ...a.input.budget, maxCostCents } }), /positive integer/);
  setWalletBudget({ walletId: a.walletId, budgetCents: 0, actorId: owner.actorId });
  assert.throws(() => reserveResourceCall(a.input), /explicit positive/);
  setWalletBudget({ walletId: a.walletId, budgetCents: 100, actorId: owner.actorId });
  const previous = currentPolicy();
  updatePolicy({ requireApprovalAboveCents: 40 }, owner.actorId);
  try { assert.throws(() => reserveResourceCall(a.input), /owner approval required/); } finally { updatePolicy(previous, owner.actorId); }
  assert.equal(missionDb.all('SELECT id FROM mission_resource_calls WHERE resource_id = ?', [a.resourceId]).length, 0);
});

it('rechecks changed wallet authority at dispatch and releases only the unstarted hold', () => {
  const f = fixture(), row = reserveResourceCall(f.input);
  setWalletBudget({ walletId: f.walletId, budgetCents: 20, actorId: owner.actorId });
  assert.throws(() => claimResourceCall(String(row.id), f.actor), /budget refused/);
  assert.equal(getResourceCallBudget(String(row.id))!.status, 'released');
  assert.equal(missionDb.get<{ status: string }>('SELECT status FROM mission_resource_calls WHERE id = ?', [row.id])!.status, 'cancelled');
});

it('retains exposure across midnight, uncertain provider results and quota-only reconciliation', () => {
  const f = fixture(), row = reserveResourceCall(f.input);
  missionDb.run("UPDATE mission_resource_call_budgets SET created_at = '2000-01-01T00:00:00Z' WHERE call_id = ?", [row.id]);
  claimResourceCall(String(row.id), f.actor);
  markResourceCallUncertain(String(row.id), f.actor);
  assert.throws(() => recordResourceCallCost(f.resourceId, String(row.id), owner, proof(0)), /actual provider usage/);
  finish(String(row.id), owner);
  assert.equal(heldResourceBudget(f.walletId), 40);
  assert.throws(() => cancelResourceCall(String(row.id), owner), /unstarted/);
  const receipt = proof(0);
  recordResourceCallCost(f.resourceId, String(row.id), owner, receipt);
  assert.equal(heldResourceBudget(f.walletId), 0);
  assert.equal(getWallet(f.walletId)!.balanceCents, 100);
});

it('records explicit owner financial evidence once, separate from usage and external payment execution', () => {
  const f = fixture(), row = reserveResourceCall(f.input);
  claimResourceCall(String(row.id), f.actor); finish(String(row.id), f.actor);
  const receipt = proof();
  assert.throws(() => recordResourceCallCost(f.resourceId, String(row.id), f.actor, receipt), /trusted owner/);
  assert.throws(() => recordResourceCallCost('wrong-resource', String(row.id), owner, receipt), /not found/);
  const result = recordResourceCallCost(f.resourceId, String(row.id), owner, receipt);
  assert.equal(result.externalPaymentExecuted, false);
  assert.equal(getWallet(f.walletId)!.balanceCents, 75);
  assert.equal(getWallet(f.walletId)!.spentCents, 25);
  assert.equal(recordResourceCallCost(f.resourceId, String(row.id), owner, receipt).budget.ledger_id, result.budget.ledger_id);
  assert.equal(getWallet(f.walletId)!.balanceCents, 75);
  assert.throws(() => recordResourceCallCost(f.resourceId, String(row.id), owner, { ...receipt, actualCostCents: 24 }), /cannot be changed/);
  const second = reserveResourceCall({ ...f.input, idempotencyKey: randomUUID() });
  claimResourceCall(String(second.id), f.actor); finish(String(second.id), f.actor);
  assert.throws(() => recordResourceCallCost(f.resourceId, String(second.id), owner, receipt), /already recorded/);
  recordResourceCallCost(f.resourceId, String(second.id), owner, proof(0));
  assert.equal(verifyLedger().ok, true);
  assert.equal(verifyMissionAudit().ok, true);
});

it('rolls back failed reservations and late financial writes without losing holds or charges', () => {
  const f = fixture();
  failAfter('INSERT INTO mission_resource_call_budgets', () => reserveResourceCall(f.input));
  assert.equal(heldResourceBudget(f.walletId), 0);
  assert.equal(missionDb.all('SELECT id FROM mission_resource_calls WHERE resource_id = ?', [f.resourceId]).length, 0);
  const row = reserveResourceCall(f.input);
  claimResourceCall(String(row.id), f.actor); finish(String(row.id), f.actor);
  const before = getWallet(f.walletId);
  failAfter('UPDATE mission_resource_call_budgets SET ledger_id', () => recordResourceCallCost(f.resourceId, String(row.id), owner, proof()));
  assert.deepEqual(getWallet(f.walletId), before);
  assert.equal(heldResourceBudget(f.walletId), 40);
  recordResourceCallCost(f.resourceId, String(row.id), owner, proof());
});

it('does not discard actual overages or debit unfunded exposure', () => {
  const f = fixture(10), row = reserveResourceCall(f.input);
  claimResourceCall(String(row.id), f.actor); finish(String(row.id), f.actor);
  assert.throws(() => recordResourceCallCost(f.resourceId, String(row.id), owner, proof(101)), /insufficient wallet balance/);
  assert.equal(heldResourceBudget(f.walletId), 10);
  recordResourceCallCost(f.resourceId, String(row.id), owner, proof(70));
  assert.equal(getWallet(f.walletId)!.spentCents, 70);
});

it('protects held wallet and global daily capacity even when cash balance is sufficient', () => {
  const f = fixture(60), row = reserveResourceCall(f.input);
  credit({ walletId: f.walletId, amountCents: 100, category: 'transfer' });
  assert.throws(() => debit({ walletId: f.walletId, amountCents: 50, category: 'expense' }), /spend capacity is held/);
  const previous = currentPolicy();
  updatePolicy({ maxDailySpendCents: dailySpendCents(new Date().toISOString()) + heldResourceBudget() }, owner.actorId);
  try {
    const other = fixture();
    assert.throws(() => reserveResourceCall(other.input), /daily_spend_cap/);
    assert.throws(() => debit({ walletId: other.walletId, amountCents: 1, category: 'expense' }), /spend capacity is held/);
  } finally { updatePolicy(previous, owner.actorId); cancelResourceCall(String(row.id), f.actor); }
});

it('keeps reserved exposure distinct from actual spending and rejects mixed-currency capacity', () => {
  const f = fixture(), row = reserveResourceCall(f.input);
  const daily = dailySpendCents(new Date().toISOString());
  const decision = canAgentSpend({ walletId: f.walletId, amountCents: 1, category: 'expense' }, currentPolicy(), daily);
  assert.equal(decision.dailySpentCents, daily);
  assert.ok(decision.dailyReservedCents! >= 40);
  const previous = currentPolicy();
  updatePolicy({ currency: 'EUR' }, owner.actorId);
  try {
    const changed = canAgentSpend({ walletId: f.walletId, amountCents: 1, category: 'expense' }, currentPolicy(), daily);
    assert.ok(changed.reasons.includes('held_provider_currency_conflict'));
    assert.throws(() => claimResourceCall(String(row.id), f.actor), /currency/);
  } finally { updatePolicy(previous, owner.actorId); }
  assert.equal(heldResourceBudget(f.walletId), 0);
});

// PGlite is one embedded backend, not independent-session concurrency proof.
if (!process.env.PG_TEST_DATABASE_URL) it('independent SQLite workers cannot spend the same held wallet capacity twice', { timeout: 15000 }, async () => {
  const f = fixture(60);
  type Result = { phase: string; ok: boolean; code?: string };
  const workers = [f.input, { ...f.input, idempotencyKey: randomUUID() }].map(input => fork(path.resolve('scripts/testing/resource-call-racer.ts'), [], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, QUOTA_RACE_FIXTURE: JSON.stringify(input) },
  }));
  const ready = workers.map(worker => new Promise<void>((resolve, reject) => {
    worker.on('message', (message: Result) => { if (message.phase === 'ready') resolve(); });
    worker.once('error', reject); worker.once('exit', () => reject(new Error('budget racer exited before ready')));
  }));
  const result = Promise.all(workers.map(worker => new Promise<Result>((resolve, reject) => {
    worker.on('message', (message: Result) => { if (message.phase === 'result') resolve(message); });
    worker.once('error', reject); worker.once('exit', () => reject(new Error('budget racer exited without result')));
  })));
  void result.catch(() => {});
  try {
    await Promise.all(ready);
    workers.forEach(worker => worker.send('go'));
    const results = await result;
    assert.equal(results.filter(row => row.ok).length, 1, JSON.stringify(results));
    assert.equal(results.find(row => !row.ok)!.code, 'resource_budget');
    assert.equal(heldResourceBudget(f.walletId), 60);
    const row = missionDb.get<{ id: string }>('SELECT id FROM mission_resource_calls WHERE resource_id = ?', [f.resourceId])!;
    cancelResourceCall(row.id, f.actor);
  } finally { workers.forEach(worker => { if (worker.exitCode === null) worker.kill(); }); }
});
