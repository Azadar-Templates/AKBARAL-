import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `akbaral-money-${process.pid}.db`)}`;
import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
const { createAgent, createUser, db } = require('../db') as typeof import('../db');
const { applyMigrations } = require('../db/migrate') as typeof import('../db/migrate');
const { insertExecution, insertOpportunity, updateEconomyPolicy } = require('../db/economy-repositories') as typeof import('../db/economy-repositories');
const { insertDelivery } = require('../workforce/repositories') as typeof import('../workforce/repositories');
const { agentAccountFor, recordLedgerRevenue, recordDeliveryPayment, proposeReinvestment, decideReinvestment, proposeTreasuryTransfer, decideTreasuryTransfer, requestResource, confirmResourceProvisioned } = require('./treasury') as typeof import('./treasury');

const slug = `atomic-${randomUUID()}`;
let owner: string, opportunity: string, execution: string;
let savedPolicy: Record<string, number>;
before(() => {
  applyMigrations(db);
  savedPolicy = db.get<Record<string, number>>("SELECT max_daily_spend_cents, freeze_spending, freeze_withdrawals, kill_switch FROM economy_policy WHERE id = 'global'")!;
  updateEconomyPolicy({ max_daily_spend_cents: 100000, freeze_spending: 0, freeze_withdrawals: 0, kill_switch: 0 });
  createAgent({ name: 'Synthetic atomicity fixture', slug });
  owner = createUser({ email: `${slug}@example.test`, name: 'Synthetic test owner' }).id;
  opportunity = insertOpportunity({ sourceUrlHash: slug, sourceUrl: `https://example.test/${slug}`, category: 'research', title: 'Synthetic test work', expectedRevenueCents: 0, expectedCostCents: 0, timeHours: 1, riskLevel: 'low', probability: 0, estimateBasis: 'test only' }).id;
  execution = insertExecution({ opportunityId: opportunity, agentSlug: slug, timeoutMs: 1000 }).id;
});
after(() => {
  updateEconomyPolicy(savedPolicy);
  // `economy_ledger` is deliberately absent: migration 0022 makes money history
  // append-only at the database layer (trg_ledger_no_delete). This file already
  // runs against its own private database file, so the retained fixture rows
  // cannot contaminate anything.
  db.run('DELETE FROM economy_reinvestments WHERE agent_slug = ?', [slug]);
  db.run('DELETE FROM economy_transfers WHERE source_agent_slug = ?', [slug]);
  db.run('DELETE FROM economy_revenue WHERE opportunity_id = ?', [opportunity]);
  db.run('DELETE FROM economy_opportunities WHERE id = ?', [opportunity]);
  db.run('DELETE FROM agents WHERE slug = ?', [slug]);
  db.run('DELETE FROM users WHERE id = ?', [owner]);
  db.close();
});
function delivery() { return insertDelivery({ executionId: execution, opportunityId: opportunity, agentSlug: slug, title: 'Synthetic delivery', evidence: 'unit-test fixture, not customer work', verified: true }); }
function receipt() { return { opportunityId: opportunity, agentSlug: slug, amountCents: 1000, evidence: 'synthetic fixture, no actual payment', externalRef: randomUUID() }; }
function snapshot() {
  return { balance: agentAccountFor(slug), revenue: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM economy_revenue WHERE opportunity_id = ?', [opportunity])!.n,
    payments: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM economy_delivery_payments p JOIN economy_deliveries d ON p.delivery_id = d.id WHERE d.opportunity_id = ?', [opportunity])!.n };
}
function failAfterWrite(fragment: string, action: () => unknown) {
  const original = db.run.bind(db);
  db.run = ((sql, params) => { const value = original(sql, params); if (sql.includes(fragment)) throw new Error('injected crash after write'); return value; }) as typeof db.run;
  try { assert.throws(action, /injected crash/); } finally { db.run = original; }
}

describe('private economy financial atomicity (both engines)', () => {
  it('rolls revenue and ledger back together after an injected ledger failure', () => {
    const before = snapshot();
    failAfterWrite('INSERT INTO economy_ledger', () => recordLedgerRevenue(receipt()));
    assert.deepEqual(snapshot(), before);
  });
  it('rolls delivery claim, revenue and credit back after the last write fails', () => {
    const row = delivery(), before = snapshot();
    const input = { deliveryId: row.id, amountCents: 1000, evidence: 'synthetic receipt only', recordedBy: owner };
    failAfterWrite('INSERT INTO economy_delivery_payments', () => recordDeliveryPayment(input));
    assert.deepEqual(snapshot(), before);
    assert.equal(recordDeliveryPayment(input).posted, true);
    assert.throws(() => recordDeliveryPayment(input), /exactly once/);
    assert.equal(snapshot().balance.availableCents, before.balance.availableCents + 1000);
  });
  it('refuses using one external receipt for two deliveries', () => {
    const externalRef = randomUUID();
    const pay = (id: string) => recordDeliveryPayment({ deliveryId: id, amountCents: 100, externalRef, evidence: 'synthetic receipt only', recordedBy: owner });
    pay(delivery().id);
    const before = snapshot();
    assert.throws(() => pay(delivery().id), /reference already recorded/);
    assert.deepEqual(snapshot(), before);
  });
  it('rolls a reinvestment debit and final state back when its audit write fails', () => {
    const row = proposeReinvestment({ agentSlug: slug, amountCents: 100, purpose: 'synthetic allocation', idempotencyKey: randomUUID(), proposedBy: owner }).reinvestment;
    const before = snapshot();
    failAfterWrite('INSERT INTO audit_logs', () => decideReinvestment(row.id, 'approve', owner));
    assert.deepEqual(snapshot(), before);
    assert.equal(db.get<{ status: string }>('SELECT status FROM economy_reinvestments WHERE id = ?', [row.id])!.status, 'proposed');
    decideReinvestment(row.id, 'approve', owner);
    decideReinvestment(row.id, 'approve', owner);
    assert.equal(agentAccountFor(slug).availableCents, before.balance.availableCents - 100);
  });
  it('rechecks competing allocations against the remaining balance and preserves final rejection', () => {
    const amount = agentAccountFor(slug).availableCents;
    const propose = () => proposeReinvestment({ agentSlug: slug, amountCents: amount, purpose: 'competing synthetic allocation', idempotencyKey: randomUUID(), proposedBy: owner }).reinvestment;
    const a = propose(), b = propose();
    decideReinvestment(a.id, 'approve', owner);
    assert.throws(() => decideReinvestment(b.id, 'approve', owner), /insufficient|realized balance/);
    assert.equal(agentAccountFor(slug).availableCents, 0);
    assert.equal(db.get<{ status: string }>('SELECT status FROM economy_reinvestments WHERE id = ?', [b.id])!.status, 'rejected');
  });
  it('rechecks the withdrawal freeze at transfer approval, not only at proposal', () => {
    recordLedgerRevenue(receipt());
    const row = proposeTreasuryTransfer({ sourceAgentSlug: slug, amountCents: 100, reason: 'synthetic transfer', idempotencyKey: randomUUID(), proposedBy: owner }).transfer;
    const prior = db.get<{ freeze_withdrawals: number }>("SELECT freeze_withdrawals FROM economy_policy WHERE id = 'global'")!.freeze_withdrawals;
    updateEconomyPolicy({ freeze_withdrawals: 1 });
    try { assert.throws(() => decideTreasuryTransfer(row.id, 'approve', owner), /frozen/i); }
    finally { updateEconomyPolicy({ freeze_withdrawals: prior }); }
    assert.equal(db.get<{ status: string }>('SELECT status FROM economy_transfers WHERE id = ?', [row.id])!.status, 'proposed');
  });
  it('refuses invalid money and resource price escalation without posting expenses', () => {
    for (const amountCents of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => recordLedgerRevenue({ ...receipt(), amountCents }), /integer cents/);
    const row = requestResource({ kind: 'ai_api', provider: 'fixture', description: 'synthetic resource; no provider call', monthlyCostCents: 10 });
    assert.equal(row.decision.status, 'approved');
    assert.throws(() => confirmResourceProvisioned(row.resourceId, 'synthetic proof', 11), /approved resource budget/);
    assert.equal(db.get<{ status: string }>('SELECT status FROM economy_resources WHERE id = ?', [row.resourceId])!.status, 'approved');
    db.run('DELETE FROM economy_resources WHERE id = ?', [row.resourceId]);
  });
});
