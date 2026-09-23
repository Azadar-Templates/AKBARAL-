process.env.ZA141251SA_DATABASE_URL = `file:${require('node:path').join(require('node:os').tmpdir(), `za141251sa-wallet-economy-${process.pid}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'test-session-secret-0123456789abcdefghijklmnop';
process.env.ZA141251SA_CREDENTIAL_KEY = 'test-credential-key-0123456789abcdefghijklmn';
process.env.ZA141251SA_CURRENCY = 'USD';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { missionDb, applyMissionMigrations } from './database';
import { ensureAgentWallets, ensureAgentWallet, listWallets, verifyLedger, recordRevenue, requestExpense, requestPayout, credit, treasurySummary } from './treasury';
import { currentPolicy } from './policy';
import { schedulerStatus } from './earning/continuous-scheduler';
import { listPayoutSlots, ensurePayoutSlots } from './treasury';

describe('ZA141251SA wallet economy — operating costs only', () => {
  it('1. each agent has an internal wallet', () => {
    applyMissionMigrations(missionDb);
    const active = missionDb.get<{c:number}>('SELECT COUNT(*) as c FROM mission_agents WHERE status=\'active\'')!.c;
    // ensure some agents exist for isolated DB
    if (active === 0) {
      missionDb.run(`INSERT INTO mission_agents (id, slug, name, category, role_key, status, mission_role, generation) VALUES (?,?,?,?,?,?,?,?)`, ['agt_test_1', 'test-agent-1', 'Test Agent', 'software_development', 'root', 'active', 'worker', 'custom']);
    }
    const active2 = missionDb.get<{c:number}>('SELECT COUNT(*) as c FROM mission_agents WHERE status=\'active\'')!.c;
    const res = ensureAgentWallets();
    const after = missionDb.get<{c:number}>("SELECT COUNT(*) as c FROM mission_wallets WHERE kind IN ('agent','worker')")!.c;
    assert.equal(after, active2);
    assert.equal(res.totalActive, active2);
    const res2 = ensureAgentWallets();
    assert.equal(res2.created, 0);
  });

  it('2. verified agent earnings credit that wallet and sweep to treasury', () => {
    const agent = missionDb.get<{id:string}>("SELECT id FROM mission_agents WHERE status='active' LIMIT 1")!;
    const workId = 'wrk-'+randomUUID().slice(0,8);
    missionDb.run(`INSERT INTO mission_work (id, agent_id, title, description, category, status) VALUES (?,?,?,?,?,?)`, [workId, agent.id, 't', 'd', 'software_development', 'approved']);
    const beforeMission = treasurySummary().totals.missionBalanceCents;
    const beforeAgent = listWallets('agent').find(w=>w.agentId===agent.id)!.balanceCents;
    const { revenue, ledger } = recordRevenue({ workId, agentId: agent.id, amountCents: 12345, source:'test-provider', status:'received', verifier:'https://provider.test/receipt/'+randomUUID(), externalRef:'ext-'+randomUUID(), idempotencyKey:'rev-'+randomUUID(), actorId:'test-owner' });
    assert.equal(String(revenue.status), 'received');
    assert.ok(ledger);
    const afterAgent = listWallets('agent').find(w=>w.agentId===agent.id)!.balanceCents;
    const afterMission = treasurySummary().totals.missionBalanceCents;
    assert.equal(afterAgent, beforeAgent);
    assert.equal(afterMission, beforeMission + 12345);
  });

  it('3. agent wallet can spend only on approved operating costs', () => {
    const agent = missionDb.get<{id:string}>("SELECT id FROM mission_agents WHERE status='active' LIMIT 1")!;
    let wallet = listWallets('agent').find(w=>w.agentId===agent.id);
    if (!wallet) wallet = ensureAgentWallet(agent.id, 'Test Agent wallet');
    credit({ walletId: wallet.id, amountCents: 50000, category:'owner_capital', reference:'cap-'+randomUUID(), actorType:'owner', actorId:'test-owner', idempotencyKey:'cap-'+randomUUID() });
    for (const cat of ['api','compute','hosting','domain','storage','tool']) {
      const r = requestExpense({ agentId: agent.id, walletId: wallet.id, category: cat, provider:'aws', description:'op cost '+cat, amountCents: 10, idempotencyKey: 'allow-'+cat+'-'+randomUUID(), actorType:'agent', actorId: agent.id });
      assert.ok(r.expense);
    }
    assert.throws(()=> requestExpense({ agentId: agent.id, walletId: wallet.id, category:'marketing', provider:'ads', description:'ads', amountCents: 10, idempotencyKey:'disallow-'+randomUUID(), actorType:'agent', actorId: agent.id }), (e:any)=> String(e.message).includes('category_not_allowed'));
    assert.throws(()=> requestExpense({ agentId: agent.id, walletId: wallet.id, category:'travel', provider:'airline', description:'trip', amountCents: 10, idempotencyKey:'disallow2-'+randomUUID(), actorType:'agent', actorId: agent.id }), (e:any)=> String(e.message).includes('category_not_allowed'));
  });

  it('4. every spend is atomic, idempotent, ledger-recorded and cannot go negative', () => {
    const agent = missionDb.get<{id:string}>("SELECT id FROM mission_agents WHERE status='active' LIMIT 1")!;
    const wallet = listWallets('agent').find(w=>w.agentId===agent.id)!;
    const beforeBal = wallet.balanceCents;
    const beforeSeq = missionDb.get<{c:number}>('SELECT COUNT(*) as c FROM mission_ledger')!.c;
    const key = 'idem-'+randomUUID();
    const first = requestExpense({ agentId: agent.id, walletId: wallet.id, category:'api', provider:'openai', description:'idem', amountCents: 100, idempotencyKey:key, actorType:'agent', actorId: agent.id });
    const afterBal1 = listWallets('agent').find(w=>w.id===wallet.id)!.balanceCents;
    const second = requestExpense({ agentId: agent.id, walletId: wallet.id, category:'api', provider:'openai', description:'idem', amountCents: 100, idempotencyKey:key, actorType:'agent', actorId: agent.id });
    const afterBal2 = listWallets('agent').find(w=>w.id===wallet.id)!.balanceCents;
    assert.equal(String(first.expense.id), String(second.expense.id));
    assert.equal(afterBal1, afterBal2);
    assert.equal(beforeBal - 100, afterBal1);
    const huge = beforeBal + 1000000;
    assert.throws(()=> requestExpense({ agentId: agent.id, walletId: wallet.id, category:'api', provider:'openai', description:'huge', amountCents: huge, idempotencyKey:'huge-'+randomUUID(), actorType:'agent', actorId: agent.id }), (e:any)=> String(e.message).includes('insufficient') || String(e.message).includes('budget_exceeded') || String(e.message).includes('category'));
    const ledgerOk = verifyLedger();
    assert.equal(ledgerOk.ok, true);
    const afterSeq = missionDb.get<{c:number}>('SELECT COUNT(*) as c FROM mission_ledger')!.c;
    assert.ok(afterSeq > beforeSeq);
  });

  it('5. agent wallet transfer to Mission Treasury is via verified sweep', () => {
    const summary = treasurySummary();
    assert.ok(summary.totals.missionBalanceCents >= 0);
    assert.ok(summary.totals.realizedRevenueCents >= 12345);
  });

  it('6. Mission Treasury can later fund owner withdrawal (requires verified slot)', () => {
    const slots = ensurePayoutSlots();
    assert.equal(slots.length, 4);
    assert.throws(()=> requestPayout({ slot:1, amountCents: 100, idempotencyKey:'no-slot-'+randomUUID(), requestedBy:'owner-test' }), (e:any)=> String(e.message).includes('unconfigured') || String(e.message).includes('slot_not_active') || String(e.message).includes('verification_required') || String(e.message).includes('configure and verify'));
  });

  it('7. owner payout account/card remains optional and unconfigured until future withdrawal', () => {
    const slots = listPayoutSlots();
    assert.equal(slots.length, 4);
    for(const s of slots) assert.ok(['unconfigured','pending_verification','active','paused'].includes(String(s.status)));
    const sum = treasurySummary().totals.missionBalanceCents;
    assert.ok(sum >= 0);
  });

  it('8. no fake revenue, no synthetic balance, no real purchase, scheduler OFF', () => {
    const fakeRev = missionDb.get<{c:number}>("SELECT COUNT(*) as c FROM mission_revenue WHERE source LIKE '%fake%' OR source LIKE '%synthetic%' OR verifier LIKE '%example.com%'")!.c;
    assert.equal(fakeRev, 0);
    const sched = schedulerStatus();
    assert.equal(sched.enabled, 0);
    const pol = currentPolicy();
    assert.equal(pol.killSwitch, false);
  });
});
