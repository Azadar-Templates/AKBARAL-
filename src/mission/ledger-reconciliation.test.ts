import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL=process.env.PG_TEST_DATABASE_URL||`file:${path.join(os.tmpdir(),`ledger-reconciliation-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET='isolated-reconciliation-tests-only-not-a-production-secret';
import { before, beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';
// The synchronous PG bridge unrefs its worker. Keep the test process alive until
// every registered test and teardown finishes; --test-force-exit alone can hide truncation.
const testLiveness = setInterval(() => {}, 1000);
const {applyMissionMigrations,missionDb:db,verifyMissionAudit,nowIso,sha256}=require('./database') as typeof import('./database');
const m=require('./money') as typeof import('./money');
const r=require('./ledger-reconciliation') as typeof import('./ledger-reconciliation');
const {updatePolicy,setKillSwitch}=require('./policy') as typeof import('./policy');
import type { Row } from './database';
import type { MoneyProvider, CashReceipt, PaymentResult } from './money';
const owner={kind:'owner' as const,id:`test-owner-${randomUUID()}`},a=`test-agent-${randomUUID()}`,b=`test-agent-${randomUUID()}`;
let receipt:CashReceipt, sends=0;
let response:PaymentResult;
const provider:MoneyProvider={id:'fixture-only',supports:()=>true,verifyReceipt:async()=>receipt,pay:async()=>{sends++;return response;},lookup:async()=>response};
function addAgent(id:string,parent:string|null=null){db.run("INSERT INTO mission_agents (id,slug,name,role_key,parent_id,depth,generation,status,mission_role,origin_platform) VALUES (?,?,'Synthetic test identity','specialist',?,0,'custom','active','worker','test')",[id,id,parent]);}
function grant(id=a,patch:Partial<Parameters<typeof m.setMoneyGrant>[2]>={}){return m.setMoneyGrant(owner,id,{spendLimitCents:10000,delegationCents:0,canCreate:false,expiresAt:new Date(Date.now()+86400000).toISOString(),status:'active',opportunityId:String(db.get<Row>('SELECT id FROM mission_money_opportunities LIMIT 1')!.id),...patch});}
async function earn(amount=1000,id:string=randomUUID()) {receipt={externalId:id,amountCents:amount,currency:'USD',kind:'earning',agentId:a};return m.verifyMoneyReceipt(owner,provider,id);}
function request(amount=100,key=randomUUID()){return m.requestMoney({kind:'agent',id:a},{kind:'expense',agentId:a,provider:provider.id,destination:'approved-fixture-vendor',category:'hosting',amountCents:amount,maxCostCents:amount,idempotencyKey:key});}
/** A chain-valid entry with a fresh hash, appended out of band and pointing at
 *  nothing: the row itself is internally consistent, so only reference closure
 *  (or the balance column update that accompanies it) can expose it. */
function appendUnexplainedEntry(){
  const last=db.get<Row>('SELECT seq,hash FROM mission_cash_entries ORDER BY seq DESC LIMIT 1')!;
  const account=m.cashAccount('treasury');
  const row={seq:Number(last.seq)+1,id:`ghost-${randomUUID()}`,accountId:'treasury',bucket:'available',delta:7,after:Number(account.available_cents)+7,reference:'unexplained-fixture',prev:String(last.hash),at:nowIso()};
  db.run('INSERT INTO mission_cash_entries (seq,id,account_id,bucket,delta_cents,balance_after,reference,prev_hash,hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[row.seq,row.id,'treasury','available',row.delta,row.after,row.reference,row.prev,sha256(JSON.stringify(row)),row.at]);
  db.run("UPDATE mission_cash_accounts SET available_cents=available_cents+7 WHERE id='treasury'");
}
before(()=>{applyMissionMigrations();db.run("INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,?,'test-only','owner','active')",[owner.id,`${owner.id}@example.test`]);addAgent(a);addAgent(b);});
beforeEach(()=>{
  setKillSwitch(false,owner.id);
  for(const table of ['mission_earning_jobs','mission_money_receipts','mission_cash_liabilities','mission_cash_entries','mission_money_transfers','mission_money_operations','mission_money_grants','mission_money_opportunities','mission_cash_accounts'])db.run(`DELETE FROM ${table}`);
  updatePolicy({killSwitch:false,autonomousEnabled:true,allowAgentCreation:true,maxDailySpendCents:100000,maxExpenseCents:10000,maxPayoutCents:10000,requireApprovalAboveCents:500,currency:'USD'},owner.id);
  m.provisionMoneyAgent(a,owner.id);m.provisionMoneyAgent(b,owner.id);
  m.approveOpportunity(owner,{title:'Synthetic opportunity ONLY for deterministic tests',evidenceUrl:'https://example.test/fixture',activity:'software_development',provider:provider.id});grant();grant(b);
  sends=0;response={state:'completed',providerRef:randomUUID(),actualCents:100};
});
after(()=>{try {db.close();} finally {clearInterval(testLiveness);}});
it('an empty ledger reconciles: zero rows, zero mismatches, nothing held',()=>{
  const report=r.reconcileLedger();
  assert.equal(report.ok,true);assert.equal(report.mismatchCount,0);assert.deepEqual(report.mismatches,[]);
  assert.equal(report.counts.entries,0);assert.equal(report.counts.liveOperations,0);assert.equal(report.counts.receipts,0);
  assert.equal(report.heldCents.accounts,0);assert.equal(report.heldCents.operations,0);
});
it('real verified flows keep the ledger reconciled end to end',async()=>{
  await earn(1000,'payment-one');m.allocateCash(owner,a,400,'allocate');
  const op=request(100);await m.dispatchMoney(owner,provider,String(op.id));
  receipt={externalId:'refund-one',amountCents:40,currency:'USD',kind:'refund',operationId:String(op.id)};
  await m.verifyMoneyReceipt(owner,provider,'refund-one');
  const report=r.reconcileLedger();
  assert.equal(m.verifyCashLedger().ok,true);
  assert.equal(report.ok,true,JSON.stringify(report.mismatches));
  assert.equal(report.counts.entries,9);
  assert.equal(report.counts.receipts,2);assert.equal(report.counts.transfers,1);
  assert.equal(report.counts.liveOperations,0);assert.equal(report.counts.liabilities,0);
  assert.equal(report.heldCents.accounts,0);assert.equal(report.heldCents.operations,0);
  assert.equal(verifyMissionAudit().ok,true);
});
it('a live reservation is fully covered by held cash and still reconciles',async()=>{
  await earn();m.allocateCash(owner,a,400,'fund');request(100);
  const report=r.reconcileLedger();
  assert.equal(report.ok,true,JSON.stringify(report.mismatches));
  assert.equal(report.counts.liveOperations,1);
  assert.equal(report.heldCents.accounts,100);assert.equal(report.heldCents.operations,100);
  assert.equal(m.cashAccount(a).held_cents,100);
});
it('a reversal that claws back nothing records a liability without entries and still reconciles',async()=>{
  await earn(100,'income');m.allocateCash(owner,a,100,'fund');
  const op=request(100);await m.dispatchMoney(owner,provider,String(op.id));
  assert.equal(m.cashAccount(a).available_cents,0);assert.equal(m.cashAccount('treasury').available_cents,0);
  const entriesBefore=db.get<Row>('SELECT COUNT(*) AS n FROM mission_cash_entries')!.n;
  receipt={externalId:'reversal',amountCents:100,currency:'USD',kind:'reversal',originalExternalId:'income'};
  await m.verifyMoneyReceipt(owner,provider,'reversal');
  assert.equal(db.get<Row>('SELECT COUNT(*) AS n FROM mission_cash_entries')!.n,entriesBefore,'a zero-take reversal books no entries');
  const report=r.reconcileLedger();
  assert.equal(report.ok,true,JSON.stringify(report.mismatches));
  assert.equal(report.counts.liabilities,1);
  assert.equal(m.moneyOverview().liabilities[0].remaining_cents,100);
});
it('an out-of-band account edit is reported and fail-closes every money mutation',async()=>{
  await earn();m.allocateCash(owner,a,400,'fund');
  const reserved=request(100),reservedForCancel=request(50);
  const uncertain={...provider,pay:async()=>{sends++;throw Error('network lost after provider accepted');}};
  const unknownOp=request(30);
  await m.dispatchMoney(owner,uncertain,String(unknownOp.id));assert.equal(m.moneyOperation(String(unknownOp.id)).state,'unknown');
  db.run("UPDATE mission_cash_accounts SET available_cents=available_cents+999 WHERE id='treasury'");
  const report=r.reconcileLedger();
  assert.equal(report.ok,false);
  assert.ok(report.mismatches.some(x=>x.code==='account_balance_mismatch'&&x.accountId==='treasury'&&x.expectedCents===600&&x.actualCents===1599));
  assert.equal(m.verifyCashLedger().ok,false);
  assert.throws(()=>m.allocateCash(owner,a,1,'blocked'),/cash_integrity_failed/);
  assert.throws(()=>request(10),/cash_integrity_failed/);
  receipt={externalId:'blocked-earning',amountCents:100,currency:'USD',kind:'earning',agentId:a};
  await assert.rejects(m.verifyMoneyReceipt(owner,provider,'blocked-earning'),/cash_integrity_failed/);
  assert.throws(()=>m.cancelMoney(owner,String(reservedForCancel.id)),/cash_integrity_failed/);
  await assert.rejects(m.dispatchMoney(owner,provider,String(reserved.id)),/cash_integrity_failed/);
  await assert.rejects(m.reconcileMoney(owner,provider,String(unknownOp.id)),/cash_integrity_failed/);
  assert.throws(()=>m.freezeCash(owner,a,false),/cash_integrity_failed/);
  assert.equal(db.get<Row>('SELECT COUNT(*) AS n FROM mission_money_receipts WHERE external_id=?',['blocked-earning'])!.n,0,'nothing was booked while fail-closed');
  assert.equal(sends,1,'no payment was retried while fail-closed');
  // Tightening a restriction stays available even on a broken ledger.
  m.freezeCash(owner,a,true);assert.equal(m.cashAccount(a).frozen,1);
  assert.equal(r.reconcileLedger().ok,false,'the report stays readable while the gate holds');
  assert.equal(verifyMissionAudit().ok,true);
  // Fail-closed recovers the moment the ledger agrees with itself again.
  db.run("UPDATE mission_cash_accounts SET available_cents=available_cents-999 WHERE id='treasury'");
  assert.equal(r.reconcileLedger().ok,true);
  m.freezeCash(owner,a,false); // unfreeze passes the reconciliation gate again
  m.allocateCash(owner,a,1,'recovered');assert.equal(m.cashAccount(a).available_cents,221);
});
it('an edited ledger row is detected even though the account columns still look plausible',async()=>{
  await earn(1000,'payment-one');m.allocateCash(owner,a,400,'allocate');
  db.run('UPDATE mission_cash_entries SET delta_cents=delta_cents+1 WHERE seq=1');
  const report=r.reconcileLedger();
  assert.equal(report.ok,false);
  const codes=report.mismatches.map(x=>x.code);
  assert.ok(codes.includes('ledger_hash_mismatch'),'the stored hash no longer matches the row');
  assert.ok(report.mismatches.filter(x=>x.code==='ledger_balance_drift').length>=3,'the drift propagates through every later a-entry');
  assert.ok(report.mismatches.some(x=>x.code==='account_balance_mismatch'&&x.accountId===a&&x.expectedCents===401&&x.actualCents===400),'account a is one cent over its entry sum');
  const capped=r.reconcileLedger(1);
  assert.equal(capped.mismatches.length,1);assert.equal(capped.mismatchCount,report.mismatchCount);
  assert.throws(()=>request(),/cash_integrity_failed/);
});
it('held cash whose operation left the outstanding set is unexplained',async()=>{
  await earn();m.allocateCash(owner,a,400,'fund');const op=request(100);
  assert.equal(m.cashAccount(a).held_cents,100);
  // Simulate an out-of-band administrative state change: the operation is no
  // longer outstanding, but its hold was never released.
  db.run("UPDATE mission_money_operations SET state='rejected' WHERE id=?",[String(op.id)]);
  const report=r.reconcileLedger();
  assert.equal(m.verifyCashLedger().ok,true,'the chain alone cannot see this');
  assert.equal(report.ok,false);
  assert.ok(report.mismatches.some(x=>x.code==='held_without_operation'&&x.accountId===a&&x.expectedCents===0&&x.actualCents===100));
});
it('an outstanding operation whose reservation vanished is unbacked',async()=>{
  await earn();m.allocateCash(owner,a,400,'fund');const op=request(100);
  await m.dispatchMoney(owner,provider,String(op.id));
  assert.equal(m.cashAccount(a).held_cents,0);
  db.run("UPDATE mission_money_operations SET state='reserved' WHERE id=?",[String(op.id)]);
  const report=r.reconcileLedger();
  assert.equal(report.ok,false);
  assert.ok(report.mismatches.some(x=>x.code==='operation_without_hold'&&x.accountId===a&&x.expectedCents===100&&x.actualCents===0));
});
it('a chain-valid entry pointing at nothing is caught by reference closure, not the chain',async()=>{
  await earn(1000,'payment-one');
  assert.equal(m.verifyCashLedger().ok,true);
  appendUnexplainedEntry();
  assert.equal(m.verifyCashLedger().ok,true,'the forged row hashes and chains correctly');
  const report=r.reconcileLedger();
  assert.equal(report.ok,false);
  assert.ok(report.mismatches.some(x=>x.code==='orphan_ledger_reference'&&x.reference==='unexplained-fixture'));
  assert.throws(()=>request(),/cash_integrity_failed/,'the gate is stricter than the chain check alone');
});
it('reconciliation is deterministic and never mutates the ledger it inspects',async()=>{
  await earn(1000,'payment-one');m.allocateCash(owner,a,400,'allocate');appendUnexplainedEntry();
  const snapshot=()=>JSON.stringify({
    tables:['mission_cash_entries','mission_cash_accounts','mission_money_operations','mission_money_receipts','mission_money_transfers','mission_cash_liabilities'].map(t=>db.all(`SELECT * FROM ${t} ORDER BY 1`)),
  });
  const before=snapshot();
  const first=r.reconcileLedger(),second=r.reconcileLedger();
  assert.equal(first.ok,false);assert.equal(second.ok,false);
  assert.equal(first.mismatchCount,second.mismatchCount);
  assert.deepEqual({...first,checkedAt:''},{...second,checkedAt:''});
  assert.equal(snapshot(),before,'reconciliation is read-only');
});
