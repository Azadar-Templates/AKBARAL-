import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL=process.env.PG_TEST_DATABASE_URL||`file:${path.join(os.tmpdir(),`mission-cash-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET='isolated-cash-tests-only-not-a-production-secret';
import { before, beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';
const {applyMissionMigrations,missionDb:db,verifyMissionAudit}=require('./database') as typeof import('./database');
const m=require('./money') as typeof import('./money');
const {updatePolicy,setKillSwitch}=require('./policy') as typeof import('./policy');
const {configurePayoutSlot}=require('./treasury') as typeof import('./treasury');
const {confirmPayoutVerification,PAYOUT_VERIFICATION_CHECKS}=require('./payout-verification') as typeof import('./payout-verification');
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
before(()=>{applyMissionMigrations();db.run("INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,?,'test-only','owner','active')",[owner.id,`${owner.id}@example.test`]);addAgent(a);addAgent(b);});
beforeEach(()=>{
  setKillSwitch(false,owner.id);
  for(const table of ['mission_earning_jobs','mission_money_receipts','mission_cash_liabilities','mission_cash_entries','mission_money_transfers','mission_money_operations','mission_money_grants','mission_money_opportunities','mission_cash_accounts'])db.run(`DELETE FROM ${table}`);
  updatePolicy({killSwitch:false,autonomousEnabled:true,allowAgentCreation:true,maxDailySpendCents:100000,maxExpenseCents:10000,maxPayoutCents:10000,requireApprovalAboveCents:500,currency:'USD'},owner.id);
  m.provisionMoneyAgent(a,owner.id);m.provisionMoneyAgent(b,owner.id);
  m.approveOpportunity(owner,{title:'Synthetic opportunity ONLY for deterministic tests',evidenceUrl:'https://example.test/fixture',activity:'software_development',provider:provider.id});grant();grant(b);
  sends=0;response={state:'completed',providerRef:randomUUID(),actualCents:100};
});
after(()=>db.close());
it('starts at zero; neither owner notes nor legacy wallets supply real cash',()=>{
  assert.equal(m.ensureCashAccount().available_cents,0);assert.equal(m.cashAccount(a).available_cents,0);
  assert.throws(()=>request(),/insufficient_real_funds/);
});
it('credits only provider-confirmed net earnings; duplicate receipt is globally idempotent',async()=>{
  await earn(1000,'payment-one');assert.equal(m.cashAccount('treasury').available_cents,1000);assert.equal(m.cashAccount(a).available_cents,0);
  assert.equal((await m.verifyMoneyReceipt(owner,provider,'payment-one')).duplicated,true);
  assert.equal(m.cashAccount('treasury').available_cents,1000);assert.equal(m.verifyCashLedger().ok,true);
  receipt.amountCents=1001;await assert.rejects(m.verifyMoneyReceipt(owner,provider,'payment-one'),/receipt_conflict/);
});
it('rejects pending/unverified receipts, mismatched IDs and currency',async()=>{
  await assert.rejects(m.verifyMoneyReceipt(owner,{...provider,verifyReceipt:async()=>{throw Error('not available');}},'pending'));
  receipt={externalId:'other',amountCents:100,currency:'USD',kind:'earning',agentId:a};await assert.rejects(m.verifyMoneyReceipt(owner,provider,'expected'),/receipt_identity/);
  receipt.externalId='expected';receipt.currency='EUR';await assert.rejects(m.verifyMoneyReceipt(owner,provider,'expected'),/currency_mismatch/);
  assert.equal(m.ensureCashAccount().available_cents,0);
});
it('allocation conserves verified funds and binds the idempotency key',async()=>{
  await earn();m.allocateCash(owner,a,400,'allocate');m.allocateCash(owner,a,400,'allocate');
  assert.equal(m.cashAccount(a).available_cents,400);assert.equal(m.cashAccount('treasury').available_cents,600);
  assert.throws(()=>m.allocateCash(owner,b,400,'allocate'),/idempotency_conflict/);
  assert.throws(()=>m.allocateCash(owner,a,601,'too-much'),/invalid_minor_units/);
  assert.equal(m.verifyCashLedger().ok,true);
});
it('reservations prevent overspend and only provider completion records external spending',async()=>{
  await earn();m.allocateCash(owner,a,100,'fund');const op=request();assert.equal(op.state,'reserved');
  assert.equal(m.cashAccount(a).available_cents,0);assert.equal(m.cashAccount(a).held_cents,100);
  assert.throws(()=>request(),/insufficient_real_funds/);
  await m.dispatchMoney(owner,provider,String(op.id));assert.equal(sends,1);assert.equal(m.cashAccount(a).held_cents,0);
  assert.equal(m.moneyOperation(String(op.id)).state,'completed');
  await assert.rejects(m.dispatchMoney(owner,provider,String(op.id)),/reconcile_only/);assert.equal(sends,1);
});
it('failed provider payment returns its reservation exactly once',async()=>{
  await earn();m.allocateCash(owner,a,100,'fund');const op=request();response={state:'failed',providerRef:'failure-proof'};
  await m.dispatchMoney(owner,provider,String(op.id));await m.reconcileMoney(owner,provider,String(op.id));
  assert.equal(m.cashAccount(a).available_cents,100);assert.equal(m.cashAccount(a).held_cents,0);
});
it('timeout after a send keeps funds held; reconciliation never submits another payment',async()=>{
  await earn();m.allocateCash(owner,a,100,'fund');const op=request();
  const uncertain={...provider,pay:async()=>{sends++;throw Error('network lost after provider accepted');}};
  await m.dispatchMoney(owner,uncertain,String(op.id));assert.equal(m.moneyOperation(String(op.id)).state,'unknown');assert.equal(m.cashAccount(a).held_cents,100);
  await assert.rejects(m.dispatchMoney(owner,provider,String(op.id)),/reconcile_only/);
  await m.reconcileMoney(owner,provider,String(op.id));assert.equal(sends,1);assert.equal(m.cashAccount(a).held_cents,0);
});
it('provider results exceeding reserved cost stay unknown and do not fabricate a balance',async()=>{
  await earn();m.allocateCash(owner,a,100,'fund');const op=request();response.actualCents=101;
  await m.dispatchMoney(owner,provider,String(op.id));assert.equal(m.moneyOperation(String(op.id)).state,'unknown');assert.equal(m.cashAccount(a).held_cents,100);
});
it('partial refunds require provider verification, original payment binding, and cannot exceed debit',async()=>{
  await earn();m.allocateCash(owner,a,100,'fund');const op=request();await m.dispatchMoney(owner,provider,String(op.id));
  receipt={externalId:'refund-1',amountCents:40,currency:'USD',kind:'refund',operationId:String(op.id)};
  await m.verifyMoneyReceipt(owner,provider,'refund-1');await m.verifyMoneyReceipt(owner,provider,'refund-1');assert.equal(m.cashAccount(a).available_cents,40);
  receipt={...receipt,externalId:'refund-2',amountCents:61};await assert.rejects(m.verifyMoneyReceipt(owner,provider,'refund-2'),/invalid_refund/);
});
it('chargeback freezes the mission, records liability, and never makes cash negative',async()=>{
  await earn(100,'income');m.allocateCash(owner,a,100,'fund');const op=request();await m.dispatchMoney(owner,provider,String(op.id));
  receipt={externalId:'reversal',amountCents:100,currency:'USD',kind:'reversal',originalExternalId:'income'};
  await m.verifyMoneyReceipt(owner,provider,'reversal');assert.equal(m.cashAccount(a).available_cents,0);
  assert.equal(m.moneyOverview().liabilities[0].remaining_cents,100);assert.equal(m.moneyOverview().killSwitch,true);
  assert.throws(()=>m.freezeCash(owner,a,false),/liability/);
  await earn(150,'recovery');assert.equal(m.cashAccount('treasury').available_cents,50);assert.equal(m.moneyOverview().liabilities[0].remaining_cents,0);
});
it('owner approvals do not bypass limits, freeze, or agent revocation',async()=>{
  await earn();m.allocateCash(owner,a,1000,'fund');const op=request(600);assert.equal(op.state,'approval_required');
  assert.throws(()=>m.decideMoney({kind:'agent',id:a},String(op.id),true),/owner_required/);
  setKillSwitch(true,owner.id);assert.throws(()=>m.decideMoney(owner,String(op.id),true),/kill_switch/);setKillSwitch(false,owner.id);
  grant(a,{spendLimitCents:500});assert.throws(()=>m.decideMoney(owner,String(op.id),true),/agent_spending_limit/);
  grant();m.decideMoney(owner,String(op.id),true);grant(a,{status:'revoked'});
  await assert.rejects(m.dispatchMoney(owner,provider,String(op.id)),/authority_inactive/);assert.equal(sends,0);
});
it('zero budget means no financial authority, never unlimited spending',async()=>{
  await earn();m.allocateCash(owner,a,100,'fund');grant(a,{spendLimitCents:0});assert.throws(()=>request(),/spending_limit/);
  assert.throws(()=>m.requestMoney({kind:'agent',id:b},{kind:'expense',agentId:a,provider:provider.id,destination:'x',category:'api',amountCents:1,maxCostCents:1,idempotencyKey:'cross-agent'}),/forbidden/);
});
it('child authority uses explicit finite delegation, inherits revocation, and starts unfunded',()=>{
  const child=`child-${randomUUID()}`;addAgent(child,a);
  assert.throws(()=>m.provisionMoneyAgent(child,a,a,10),/delegation_denied/);
  grant(a,{canCreate:true,delegationCents:50});const g=m.provisionMoneyAgent(child,a,a,30);
  assert.equal(g.spend_limit_cents,30);assert.equal(g.can_create,0);assert.equal(m.grant(a).delegation_cents,20);assert.equal(m.cashAccount(child).available_cents,0);
  grant(a,{status:'revoked'});assert.throws(()=>m.grant(child),/authority_inactive/);
});
it('withdrawals require owner approval and a verified bound destination; pending is not completed',async()=>{
  await earn();configurePayoutSlot({slot:1,providerRef:'ba_fixture',currency:'USD',minPayoutCents:0,maxPayoutCents:10000,actorId:owner.id});
  confirmPayoutVerification({slot:1,ownerId:owner.id,checks:Object.fromEntries(PAYOUT_VERIFICATION_CHECKS.map(c=>[c.key,true])),attestation:'Synthetic payout destination for automated tests only; no real bank account.'});
  const op=m.requestMoney(owner,{kind:'withdrawal',provider:provider.id,destination:'ba_fixture',category:'withdrawal',amountCents:100,maxCostCents:100,idempotencyKey:'withdrawal'});
  assert.equal(op.state,'approval_required');await assert.rejects(m.dispatchMoney(owner,provider,String(op.id)),/reconcile_only/);
  m.decideMoney(owner,String(op.id),true);response={state:'pending',providerRef:'provider-payout'};await m.dispatchMoney(owner,provider,String(op.id));assert.equal(m.moneyOperation(String(op.id)).state,'pending');
  response={state:'completed',providerRef:'provider-payout',actualCents:100};setKillSwitch(true,owner.id);await m.reconcileMoney(owner,provider,String(op.id));assert.equal(m.moneyOperation(String(op.id)).state,'completed');assert.equal(m.cashAccount('treasury').available_cents,900);
});
it('rejecting approval does not reserve or spend funds',async()=>{
  await earn();m.allocateCash(owner,a,600,'fund');const op=request(600);m.decideMoney(owner,String(op.id),false);assert.equal(m.cashAccount(a).available_cents,600);assert.equal(m.cashAccount(a).held_cents,0);
});
it('concurrent asynchronous dispatch claims send only once',async()=>{
  await earn();m.allocateCash(owner,a,100,'fund');const op=request();
  const results=await Promise.allSettled([m.dispatchMoney(owner,provider,String(op.id)),m.dispatchMoney(owner,provider,String(op.id))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(sends,1);assert.equal(m.verifyCashLedger().ok,true);
});
it('rollback includes balance, hash chain and audit after injected failure',async()=>{
  await earn();const original=db.run.bind(db),before=m.cashAccount('treasury').available_cents;
  db.run=((sql,params)=>{const result=original(sql,params);if(sql.includes('INSERT INTO mission_cash_entries'))throw Error('injected cash failure');return result;}) as typeof db.run;
  try{assert.throws(()=>m.allocateCash(owner,a,100,'rollback'),/injected/);}finally{db.run=original;}
  assert.equal(m.cashAccount('treasury').available_cents,before);assert.equal(m.cashAccount(a).available_cents,0);assert.equal(m.verifyCashLedger().ok,true);assert.equal(verifyMissionAudit().ok,true);
});
it('tampered cached balances fail ledger verification and block spending',async()=>{
  await earn();m.allocateCash(owner,a,100,'fund');db.run('UPDATE mission_cash_accounts SET available_cents=999 WHERE id=?',[a]);assert.equal(m.verifyCashLedger().ok,false);assert.throws(()=>request(),/integrity/);
});
it('earning flow waits for real payment and paid work can fund continued work',async()=>{
  const job=m.queueEarning(owner,a,'job-one');let calls=0;
  receipt={externalId:'earning-job-proof',amountCents:200,currency:'USD',kind:'earning',agentId:a};
  const earning={id:provider.id,execute:async()=>{calls++;return {paymentReference:receipt.externalId};},lookup:async()=>({paymentReference:receipt.externalId})};
  const done=await m.runEarning(owner,earning,provider,String(job.id));assert.equal(done.state,'completed');assert.equal(calls,1);
  m.allocateCash(owner,a,100,'earned-funding');const cost=request();await m.dispatchMoney(owner,provider,String(cost.id));
  const next=m.queueEarning(owner,a,'continued-work',String(cost.id));assert.equal(next.state,'queued');
});
it('missing opportunities and missing connectors remain blocked, not fabricated',async()=>{
  grant(a,{opportunityId:undefined});assert.throws(()=>m.queueEarning(owner,a,'unassigned'),/no_real_opportunity/);
  grant();m.queueEarning(owner,a,'assigned');assert.deepEqual(await m.moneyWorkerTick(owner,[],[]),{blocked:'earning_connector_not_configured'});
});
it('owner standing allocation automatically funds agents from verified cash, never from a target',async()=>{
  grant(a,{autoAllocateCents:200});await m.moneyWorkerTick(owner,[],[]);assert.equal(m.cashAccount(a).available_cents,0);
  await earn(1000);await m.moneyWorkerTick(owner,[],[]);await m.moneyWorkerTick(owner,[],[]);
  assert.equal(m.cashAccount(a).available_cents,200);assert.equal(m.cashAccount('treasury').available_cents,800);
});
it('owner can cancel only unsent reservations, including during a freeze',async()=>{
  await earn();m.allocateCash(owner,a,100,'fund');const op=request();setKillSwitch(true,owner.id);
  m.cancelMoney(owner,String(op.id));assert.equal(m.cashAccount(a).available_cents,100);assert.equal(m.cashAccount(a).held_cents,0);
  assert.throws(()=>m.cancelMoney(owner,String(op.id)),/cannot_cancel/);
});
it('provisions 4,001+ distinct cash sub-ledgers without manufacturing opportunities or money',{skip:!!process.env.PG_TEST_DATABASE_URL},()=>{
  db.transaction(()=>{for(let n=0;n<4001;n++)addAgent(`fleet-${n}-${process.pid}`);});
  const fleet=m.bootstrapMoneyAgents(owner);assert.ok(fleet.agents>=4001);assert.ok(fleet.unassigned>=4001);
  assert.equal(db.get<Row>('SELECT SUM(available_cents) AS n FROM mission_cash_accounts')!.n,0);assert.equal(m.verifyCashLedger().ok,true);
});
it('receipt balance coverage is checked again atomically after provider lookup',async()=>{
  const snapshot:CashReceipt={externalId:'balance-one',kind:'earning',currency:'USD',amountCents:100,agentId:a,availableBalanceCents:100};
  const bounded={...provider,verifyReceipt:async(id:string)=>({...snapshot,externalId:id})};
  await m.verifyMoneyReceipt(owner,bounded,'balance-one');
  await assert.rejects(m.verifyMoneyReceipt(owner,bounded,'balance-two'),/balance_requires_reconciliation/);
  snapshot.availableBalanceCents=200;
  assert.equal((await m.verifyMoneyReceipt(owner,bounded,'balance-one')).duplicated,true);
  assert.equal(m.cashAccount('treasury').available_cents,100);
});
it('provider recovery services only that provider liability before spendable cash',async()=>{
  await earn(100,'liability-income');m.allocateCash(owner,a,100,'fund');await m.dispatchMoney(owner,provider,String(request().id));
  receipt={externalId:'liability-reversal',kind:'reversal',amountCents:100,currency:'USD',originalExternalId:'liability-income'};
  await m.verifyMoneyReceipt(owner,provider,receipt.externalId);
  receipt={externalId:'liability-recovery',kind:'earning',amountCents:150,currency:'USD',agentId:a,availableBalanceCents:50};
  await m.verifyMoneyReceipt(owner,provider,receipt.externalId);
  assert.equal(m.cashAccount('treasury').available_cents,50);assert.equal(m.moneyOverview().liabilities[0].remaining_cents,0);
});
it('provisioning inactive registry identities never reactivates their authority',()=>{
  const id=`inactive-${randomUUID()}`;addAgent(id);db.run("UPDATE mission_agents SET status='paused' WHERE id=?",[id]);
  m.provisionMoneyAgent(id,owner.id);assert.equal(m.cashAccount(id).available_cents,0);assert.throws(()=>m.grant(id),/authority_inactive/);
});
it('worker reconciles delivered earnings read-only during freeze and opportunity revocation',async()=>{
  const job=m.queueEarning(owner,a,'awaiting');let sends=0,paid=false;
  const earning={id:provider.id,execute:async()=>{sends++;return {paymentReference:'awaiting-proof'};},lookup:async()=>({paymentReference:'awaiting-proof'})};
  const payments={...provider,verifyReceipt:async()=>{if(!paid)throw Error('not yet available');return {externalId:'awaiting-proof',amountCents:200,currency:'USD',kind:'earning' as const,agentId:a};}};
  assert.equal((await m.runEarning(owner,earning,payments,String(job.id))).state,'awaiting_payment');
  m.revokeOpportunity(owner,String(m.grant(a).opportunity_id));setKillSwitch(true,owner.id);paid=true;
  await m.moneyWorkerTick(owner,[payments],[earning]);
  assert.equal(db.get<Row>('SELECT state FROM mission_earning_jobs WHERE id=?',[job.id])!.state,'completed');assert.equal(sends,1);assert.equal(m.cashAccount('treasury').available_cents,200);
});
it('already received money can verify one earning job, never finance duplicate job completion',async()=>{
  await earn(100,'already-credited');const job=m.queueEarning(owner,a,'receipt-bound-job');
  const earning={id:provider.id,execute:async()=>({paymentReference:'already-credited'}),lookup:async()=>({paymentReference:'already-credited'})};
  assert.equal((await m.runEarning(owner,earning,provider,String(job.id))).state,'completed');
  const another=m.queueEarning(owner,a,'same-receipt-other-job');assert.equal((await m.runEarning(owner,earning,provider,String(another.id))).state,'awaiting_payment');
  assert.equal(m.cashAccount('treasury').available_cents,100);
});
it('earning adapters get a final send gate and cannot dispatch after a kill switch',async()=>{
  const job=m.queueEarning(owner,a,'freeze-before-work');let sent=0;
  const earning={id:provider.id,execute:async(_job:Row,_opp:Row,_signal:AbortSignal,authorize:()=>void)=>{setKillSwitch(true,owner.id);authorize();sent++;return {paymentReference:'not-sent'};},lookup:async()=>{throw Error('no delivery');}};
  assert.equal((await m.runEarning(owner,earning,provider,String(job.id))).state,'unknown');assert.equal(sent,0);
});
it('agent cash views and pagination cannot include another account',async()=>{
  await earn();m.allocateCash(owner,a,100,'fund');request();
  assert.equal(m.agentMoneyOverview(b).operations.length,0);assert.equal(m.listMoneyOperations('',1,b).length,0);
  assert.equal(m.listMoneyOperations('',1,a).length,1);assert.equal(m.listCashEntries(0,100,b).length,0);
  assert.throws(()=>m.listMoneyOperations('',1001),/pagination/);
});
it('bounded scheduler rotates unsupported jobs instead of starving a configured agent',async()=>{
  const unsupported=m.approveOpportunity(owner,{title:'Synthetic unsupported job fixture',evidenceUrl:'https://example.test/unsupported',activity:'software_development',provider:'not-configured'});
  grant(b,{opportunityId:String(unsupported.id)});
  for(let n=0;n<21;n++)m.queueEarning(owner,b,`unsupported-${n}`);
  const target=m.queueEarning(owner,a,'eligible-after-unsupported');let executed=0;
  receipt={externalId:'eligible-payment',kind:'earning',currency:'USD',amountCents:100,agentId:a};
  const earning={id:provider.id,execute:async()=>{executed++;return {paymentReference:receipt.externalId};},lookup:async()=>({paymentReference:receipt.externalId})};
  await m.moneyWorkerTick(owner,[provider],[earning]);await m.moneyWorkerTick(owner,[provider],[earning]);
  assert.equal(executed,1);assert.equal(db.get<Row>('SELECT state FROM mission_earning_jobs WHERE id=?',[target.id])!.state,'completed');
});
