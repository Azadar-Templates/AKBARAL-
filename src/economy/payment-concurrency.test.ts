import path from 'node:path';
import os from 'node:os';
process.env.DATABASE_URL = `file:${path.join(os.tmpdir(), `akbaral-financial-race-${process.pid}.db`)}`;
import { spawn, type ChildProcess } from 'node:child_process';
import { before, after, it } from 'node:test';
import assert from 'node:assert/strict';
const { createAgent, createUser, db } = require('../db') as typeof import('../db');
const { applyMigrations } = require('../db/migrate') as typeof import('../db/migrate');
const { insertExecution, insertOpportunity } = require('../db/economy-repositories') as typeof import('../db/economy-repositories');
const { insertDelivery } = require('../workforce/repositories') as typeof import('../workforce/repositories');
const { agentAccountFor, proposeReinvestment, recordLedgerRevenue } = require('./treasury') as typeof import('./treasury');

const slug = 'financial-race-fixture';
let owner: string, deliveryId: string;
before(() => {
  applyMigrations(db);
  createAgent({ name: 'Synthetic concurrency fixture', slug });
  owner = createUser({ email: 'race@example.test', name: 'Test owner' }).id;
  const opportunity = insertOpportunity({ sourceUrlHash: 'fixture-race', sourceUrl: 'https://example.test/race', category: 'research', title: 'Synthetic concurrency fixture', expectedRevenueCents: 0, expectedCostCents: 0, timeHours: 1, riskLevel: 'low', probability: 0, estimateBasis: 'test only' });
  const execution = insertExecution({ opportunityId: opportunity.id, agentSlug: slug, timeoutMs: 1000 });
  deliveryId = insertDelivery({ executionId: execution.id, opportunityId: opportunity.id, agentSlug: slug, title: 'Synthetic delivery', evidence: 'fixture only', verified: true }).id;
});
after(() => db.close());

interface WorkerResult { ok: boolean; error?: string }
async function race(calls: Array<{ method: string; args: unknown[] }>): Promise<WorkerResult[]> {
  const children: ChildProcess[] = [];
  try {
    const workers = await Promise.all(calls.map(async (call) => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
        import * as treasuryModule from './src/economy/treasury.ts';
        const treasury = treasuryModule.default ?? treasuryModule;
        process.on('message', ({method, args}) => {
          try { treasury[method](...args); process.send({ok:true}); }
          catch(error) { process.send({ok:false, error:error.message}); }
          finally { process.disconnect(); }
        });
        process.send('ready');
      `], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      children.push(child);
      let stderr = '';
      child.stderr!.on('data', (chunk) => { stderr += chunk; });
      await new Promise<void>((resolve, reject) => {
        child.once('message', () => resolve());
        child.once('error', reject);
        child.once('exit', (code) => { if (code) reject(new Error(stderr)); });
      });
      return { child, call };
    }));
    return await Promise.all(workers.map(({ child, call }) => new Promise<WorkerResult>((resolve, reject) => {
      child.once('message', (result) => resolve(result as WorkerResult));
      child.once('error', reject);
      child.send(call);
    })));
  } finally { for (const child of children) child.kill(); }
}

it('two separate SQLite processes cannot both claim the same delivery payment', { timeout: 15000 }, async () => {
  const input = { deliveryId, amountCents: 500, evidence: 'synthetic concurrency fixture; no real payment', recordedBy: owner };
  const result = await race([1, 2].map(() => ({ method: 'recordDeliveryPayment', args: [input] })));
  assert.equal(result.filter(row => row.ok).length, 1, JSON.stringify(result));
  assert.match(result.find(row => !row.ok)!.error!, /exactly once/);
  assert.equal(agentAccountFor(slug).realizedRevenueCents, 500);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM economy_delivery_payments')!.n, 1);
});

it('two separate SQLite processes cannot approve allocations exceeding the same surplus', { timeout: 15000 }, async () => {
  recordLedgerRevenue({ agentSlug: slug, amountCents: 500, evidence: 'synthetic concurrency fixture; no actual receipt' });
  const proposals = ['race-one', 'race-two'].map(idempotencyKey => proposeReinvestment({ agentSlug: slug, amountCents: 800, purpose: 'synthetic allocation', proposedBy: owner, idempotencyKey }).reinvestment);
  const result = await race(proposals.map(row => ({ method: 'decideReinvestment', args: [row.id, 'approve', owner] })));
  assert.equal(result.filter(row => row.ok).length, 1, JSON.stringify(result));
  assert.match(result.find(row => !row.ok)!.error!, /realized balance/);
  assert.equal(agentAccountFor(slug).availableCents, 200);
  assert.deepEqual(db.all<{ status: string }>('SELECT status FROM economy_reinvestments ORDER BY status').map(row => row.status), ['executed', 'rejected']);
});
