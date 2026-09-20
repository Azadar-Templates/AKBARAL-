import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL=process.env.PG_TEST_DATABASE_URL||`file:${path.join(os.tmpdir(),`freelancer-settlement-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET='fixture-only-freelancer-session-not-live';
import { before,beforeEach,after,it } from 'node:test';
import assert from 'node:assert/strict';
// The synchronous PG bridge unrefs its worker. Keep the test process alive until
// every registered test and teardown finishes; --test-force-exit alone can hide truncation.
const testLiveness = setInterval(() => {}, 1000);
import { FreelancerClient } from './freelancer';
import type { FreelancerRemittance, FreelancerUsdSettlement, FreelancerUsdReversal, FreelancerRemittanceReader, FreelancerUsdReceiver } from './freelancer-settlement-contracts';
const {FreelancerSettlementWorkflow}=require('./freelancer-settlement') as typeof import('./freelancer-settlement');
import { freelancerFixture } from './freelancer.fixtures';
const {missionDb:db,applyMissionMigrations,verifyMissionAudit}=require('../database') as typeof import('../database');
const {FreelancerWorkflow,FREELANCER_COMPLIANCE_CHECKS}=require('./freelancer-workflow') as typeof import('./freelancer-workflow');
const m=require('../money') as typeof import('../money');
const {updatePolicy,setKillSwitch}=require('../policy') as typeof import('../policy');
import type { Row } from '../database';
const owner={kind:'owner' as const,id:'fixture-owner'},agent='fixture-agent',other='fixture-other';
let fixture:ReturnType<typeof freelancerFixture>,w:InstanceType<typeof FreelancerWorkflow>;
let bridge:InstanceType<typeof FreelancerSettlementWorkflow>,remittance:FreelancerRemittance,settlement:FreelancerUsdSettlement,reversal:FreelancerUsdReversal,reader:FreelancerRemittanceReader,receiver:FreelancerUsdReceiver;
let beforeReceiving:(()=>void|Promise<void>)|undefined,reads=0;
const tables=['mission_freelancer_payout_items','mission_freelancer_payouts','mission_freelancer_settlement_evidence','mission_freelancer_events','mission_freelancer_work','mission_freelancer_accounts','mission_freelancer_projects','mission_freelancer_api_requests','mission_freelancer_api_cooldown','mission_earning_jobs','mission_money_receipts','mission_cash_liabilities','mission_cash_entries','mission_money_transfers','mission_money_operations','mission_money_grants','mission_money_opportunities','mission_cash_accounts'];
before(()=>{applyMissionMigrations();db.run("INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,'fixture-freelancer@example.test','fixture','owner','active')",[owner.id]);for(const id of [agent,other])db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES (?,?,'Synthetic identity','specialist',0,'custom','active','worker','fixture')",[id,id]);});
beforeEach(()=>{
  setKillSwitch(false,owner.id);for(const table of tables)db.run(`DELETE FROM ${table}`);
  updatePolicy({killSwitch:false,autonomousEnabled:true,currency:'USD',maxDailySpendCents:100000,maxExpenseCents:10000,requireApprovalAboveCents:500},owner.id);
  for(const id of [agent,other])m.setMoneyGrant(owner,id,{spendLimitCents:0,delegationCents:0,canCreate:false,expiresAt:new Date(Date.now()+86400000).toISOString(),status:'active'});
  fixture=freelancerFixture();w=new FreelancerWorkflow(fixture.client);beforeReceiving=undefined;reads=0;
  remittance={userId:'1',payoutId:'fixture-payout',state:'paid',currency:'USD',complete:true,netCents:2250,evidenceRef:'fixture-remittance',verifiedAt:new Date().toISOString(),lines:[{projectId:'2',bidId:'3',milestoneId:'4',currency:'USD',grossCents:2500,feeCents:250,netCents:2250}]};
  settlement={rail:'fixture-bank',receivingAccount:'fixture-mission-account',externalId:'fixture-transfer',source:'freelancer',userId:'1',payoutId:remittance.payoutId,state:'settled',direction:'credit',currency:'USD',missionOwnershipVerified:true,grossCents:2250,feeCents:50,netCents:2200,availableBalanceCents:100000,evidenceRef:'fixture-bank-evidence',verifiedAt:new Date().toISOString()};
  reversal={rail:settlement.rail,receivingAccount:settlement.receivingAccount,originalExternalId:settlement.externalId,reversalExternalId:'fixture-return',source:'freelancer',userId:'1',payoutId:remittance.payoutId,state:'settled',direction:'debit',currency:'USD',missionOwnershipVerified:true,amountCents:2200,evidenceRef:'fixture-reversal',verifiedAt:new Date().toISOString()};
  reader={userId:'1',verify:async()=>structuredClone(remittance)};
  receiver={rail:settlement.rail,receivingAccount:settlement.receivingAccount,verify:async()=>{reads++;const copy=structuredClone(settlement);await beforeReceiving?.();return copy;},verifyReversal:async()=>structuredClone(reversal)};
  bridge=new FreelancerSettlementWorkflow(fixture.client,reader,receiver);
});
after(()=>{try {db.close();} finally {clearInterval(testLiveness);}});
const authorization=(agentId=agent)=>({agentId,reference:'fixture-only manual eligibility review',expiresAt:new Date(Date.now()+3600000).toISOString(),checks:[...FREELANCER_COMPLIANCE_CHECKS]});
async function assigned(){await w.authorizeAccount(owner,authorization());return w.assign(owner,'2','3','4','fixture-only client scope and AI-permission review');}
async function prepared(){const row=await assigned();const draft=w.draft(owner,String(row.id),'Fixture-only patch / test report. No real paid work.');return w.approve(owner,String(row.id),String(draft.content_hash));}

async function cleared(){const row=await prepared();await w.deliver(owner,String(row.id));fixture.f.milestone.status='cleared';return w.syncMilestone(owner,String(row.id));}
const reconcile=()=>bridge.reconcilePayout(owner,'fixture-payout','fixture-transfer');
const reverse=()=>bridge.reconcileReversal(owner,'fixture-payout','fixture-return');
const balance=()=>Number(m.ensureCashAccount().available_cents);
const state=()=>db.get<Row>('SELECT state FROM mission_freelancer_payouts WHERE payout_id=?',['fixture-payout'])?.state;
it('unconfigured settlement stages stay blocked and cannot be enabled by payout flags',async()=>{
  const off=new FreelancerSettlementWorkflow(null);assert.equal(off.status(owner).cashBridgeEnabled,false);
  await assert.rejects(off.reconcilePayout(owner,'fixture','fixture'),/payout_adapter_not_configured/);
  await assert.rejects(new FreelancerSettlementWorkflow(fixture.client,reader).reconcilePayout(owner,'fixture','fixture'),/settlement_not_configured/);
  assert.equal(balance(),0);
});
it('all payout, historical authorization and reversal commands are owner-only',async()=>{
  const actor={kind:'agent' as const,id:agent};assert.throws(()=>bridge.status(actor),/owner_required/);
  await assert.rejects(bridge.observePayout(actor,'fixture'),/owner_required/);
  await assert.rejects(bridge.reconcilePayout(actor,'fixture','fixture'),/owner_required/);
  await assert.rejects(bridge.reconcileReversal(actor,'fixture','fixture'),/owner_required/);
  assert.throws(()=>bridge.authorizeHistoricalWork(actor,'fixture'),/owner_required/);
});
it('provider-paid remittance alone is immutable evidence, never cash',async()=>{
  await cleared();const result=await bridge.observePayout(owner,'fixture-payout');assert.equal(result.state,'observed');
  assert.equal(balance(),0);assert.equal(reads,0);assert.equal(db.all('SELECT * FROM mission_money_receipts').length,0);
});
it('independent USD settlement credits only net funds once, atomically with payout/work binding',async()=>{
  const row=await cleared();assert.deepEqual(await reconcile(),{duplicated:false});assert.equal(balance(),2200);assert.equal(state(),'booked');
  assert.equal(m.cashAccount(agent).available_cents,0);assert.equal(db.all('SELECT * FROM mission_freelancer_payout_items').length,1);
  assert.equal(db.get<Row>('SELECT work_id FROM mission_freelancer_payout_items')!.work_id,row.id);
  assert.deepEqual(await reconcile(),{duplicated:true});assert.equal(balance(),2200);assert.equal(m.verifyCashLedger().ok,true);assert.equal(verifyMissionAudit().ok,true);
});
it('concurrent settlement reconciliation and restarted instances cannot duplicate cash',async()=>{
  await cleared();const results=await Promise.all([reconcile(),new FreelancerSettlementWorkflow(fixture.client,reader,receiver).reconcilePayout(owner,'fixture-payout','fixture-transfer')]);
  assert.equal(results.filter(r=>!r.duplicated).length,1);assert.equal(balance(),2200);assert.equal(db.all('SELECT * FROM mission_earning_jobs').length,1);
});
it('already-earned settlement remains receivable after account revocation and kill switch, without spending authority',async()=>{
  await cleared();w.revokeAccount(owner);setKillSwitch(true,owner.id);await reconcile();assert.equal(balance(),2200);
  assert.throws(()=>m.allocateCash(owner,agent,1,'fixture'),/kill_switch/);
});
it('work delivery and explicit historical provenance are required before credit',async()=>{
  const row=await prepared();fixture.f.milestone.status='cleared';await assert.rejects(reconcile(),/blocked_or_uncertain/);assert.equal(reads,0);
  fixture.f.milestone.status='frozen';await w.deliver(owner,String(row.id));fixture.f.milestone.status='cleared';await w.syncMilestone(owner,String(row.id));
  db.run('UPDATE mission_freelancer_work SET money_opportunity_id=NULL WHERE id=?',[row.id]);await assert.rejects(reconcile(),/blocked_or_uncertain/);
  bridge.authorizeHistoricalWork(owner,String(row.id));await reconcile();assert.equal(balance(),2200);
});
it('pending payout and pending receiving movements cannot be admitted; lookup may later verify settlement',async()=>{
  await cleared();remittance.state='pending';await assert.rejects(reconcile(),/blocked_or_uncertain/);assert.equal(reads,0);assert.equal(balance(),0);
  remittance.state='paid';settlement.state='pending';await assert.rejects(reconcile(),/blocked_or_uncertain/);assert.equal(balance(),0);
  settlement.state='settled';await reconcile();assert.equal(balance(),2200);assert.equal(fixture.f.uploads,1);
});
const sourceFailures:Record<string,(p:FreelancerRemittance)=>void>={
  'wrong account':p=>{p.userId='99';},'wrong payout':p=>{p.payoutId='other';},'non USD':p=>{p.currency='EUR';},
  'partial itemization':p=>{p.complete=false;},'duplicate milestones':p=>{p.lines.push({...p.lines[0]});},
  'unattributed line':p=>{p.lines[0].projectId='99';},'gross mismatch':p=>{p.lines[0].grossCents=2600;p.lines[0].feeCents=350;},
  'invalid fees':p=>{p.lines[0].feeCents=-1;},'inexact minor units':p=>{p.lines[0].feeCents=250.1;},
  'invalid total':p=>{p.netCents=1;},'foreign line':p=>{p.lines[0].currency='EUR';},'stale source proof':p=>{p.verifiedAt='2000-01-01T00:00:00Z';},
  'too many items':p=>{p.lines=Array.from({length:11},(_,i)=>({...p.lines[0],milestoneId:String(i+100)}));p.netCents=24750;},
};
for(const [name,mutate] of Object.entries(sourceFailures))it(`blocks remittance ${name}`,async()=>{
  await cleared();mutate(remittance);await assert.rejects(reconcile(),/blocked_or_uncertain/);assert.equal(balance(),0);assert.equal(reads,0);
});
const receivingFailures:Record<string,(p:FreelancerUsdSettlement)=>void>={
  'ownership unverified':p=>{p.missionOwnershipVerified=false;},'foreign currency':p=>{p.currency='EUR';},'wrong source':p=>{p.source='other' as 'freelancer';},
  'wrong direction':p=>{p.direction='debit' as 'credit';},'wrong rail':p=>{p.rail='other';},'wrong account':p=>{p.receivingAccount='other';},
  'wrong external movement':p=>{p.externalId='other';},'wrong provider user':p=>{p.userId='99';},'wrong payout':p=>{p.payoutId='other';},
  'amount difference':p=>{p.grossCents=2249;},'unverified fee':p=>{p.feeCents=0;},'unavailable funds':p=>{p.availableBalanceCents=2199;},
  'stale proof':p=>{p.verifiedAt='2000-01-01T00:00:00Z';},'future proof':p=>{p.verifiedAt=new Date(Date.now()+60000).toISOString();},
};
for(const [name,mutate] of Object.entries(receivingFailures))it(`blocks receiving ${name} without partial cash/job writes`,async()=>{
  await cleared();mutate(settlement);await assert.rejects(reconcile(),/blocked_or_uncertain/);assert.equal(balance(),0);
  assert.equal(db.all('SELECT * FROM mission_earning_jobs').length,0);assert.equal(db.all('SELECT * FROM mission_freelancer_payout_items').length,0);assert.equal(db.all('SELECT * FROM mission_money_receipts').length,0);
});
it('proof mutation after provider reads does not alter the credited snapshot',async()=>{
  await cleared();beforeReceiving=()=>{settlement.netCents=99999;};await reconcile();assert.equal(balance(),2200);
});
it('work changed or disputed while receiving verification is pending cannot credit cash',async()=>{
  const row=await cleared();beforeReceiving=async()=>{fixture.f.milestone.status='disputed';await w.syncMilestone(owner,String(row.id));};
  await assert.rejects(reconcile(),/blocked_or_uncertain/);assert.equal(balance(),0);
});
it('new foreign-currency treasury policy cannot bypass USD-only admission',async()=>{
  await cleared();updatePolicy({currency:'EUR'},owner.id);db.run("UPDATE mission_cash_accounts SET currency='EUR'");await assert.rejects(reconcile(),/blocked_or_uncertain/);assert.equal(balance(),0);
});
it('changed post-booking financial evidence freezes cash without inventing a reversal',async()=>{
  await cleared();await reconcile();settlement.netCents=2199;settlement.feeCents=51;
  await assert.rejects(reconcile(),/blocked_or_uncertain/);assert.equal(state(),'review');assert.equal(balance(),2200);assert.equal(m.ensureCashAccount().frozen,1);
  assert.equal(db.all('SELECT * FROM mission_money_receipts').length,1);assert.equal(db.all('SELECT * FROM mission_cash_liabilities').length,0);
});
it('post-booking disputed or missing milestone evidence enters review instead of erasing received funds',async()=>{
  const row=await cleared();await reconcile();fixture.f.milestone.status='disputed';await w.syncMilestone(owner,String(row.id));
  assert.equal(state(),'review');assert.equal(m.ensureCashAccount().frozen,1);assert.equal(balance(),2200);
  fixture.f.milestone.status='cleared';fixture.f.milestone.transaction_id=99;await assert.rejects(w.syncMilestone(owner,String(row.id)));assert.equal(balance(),2200);
});
it('external adapter failure messages are redacted and booked cash is frozen for review',async()=>{
  await cleared();await reconcile();receiver.verify=async()=>{throw Error('fixture-sensitive-credential-body');};
  await assert.rejects(reconcile(),e=>e instanceof Error&&e.message==='freelancer_settlement_blocked_or_uncertain');assert.equal(balance(),2200);assert.equal(m.ensureCashAccount().frozen,1);
});
it('the same work cannot be booked through a second provider payout or receiving movement',async()=>{
  await cleared();await reconcile();remittance.payoutId='fixture-other-payout';settlement.payoutId=remittance.payoutId;settlement.externalId='fixture-other-movement';
  await assert.rejects(bridge.reconcilePayout(owner,remittance.payoutId,settlement.externalId),/blocked_or_uncertain/);assert.equal(balance(),2200);
});
it('aliases for an already-bound receiving transfer cannot duplicate cash',async()=>{
  await cleared();await reconcile();remittance.payoutId='fixture-alias';settlement.payoutId=remittance.payoutId;
  await assert.rejects(bridge.reconcilePayout(owner,'fixture-alias','fixture-transfer'),/blocked_or_uncertain/);assert.equal(balance(),2200);
});
it('independently verified partial reversals are idempotent and cumulatively bounded',async()=>{
  await cleared();await reconcile();reversal.amountCents=100;await reverse();assert.equal(balance(),2100);
  assert.equal((await reverse()).duplicated,true);assert.equal(balance(),2100);
  reversal.reversalExternalId='fixture-other-return';reversal.amountCents=2101;
  await assert.rejects(bridge.reconcileReversal(owner,'fixture-payout','fixture-other-return'),/blocked_or_uncertain/);assert.equal(balance(),2100);
  reversal.amountCents=2100;await bridge.reconcileReversal(owner,'fixture-payout','fixture-other-return');assert.equal(balance(),0);assert.equal(state(),'reversed');assert.equal(m.verifyCashLedger().ok,true);
});
it('a confirmed reversal cannot consume held funds and records a nonnegative liability',async()=>{
  await cleared();await reconcile();m.allocateCash(owner,agent,2200,'fixture-allocation');
  m.setMoneyGrant(owner,agent,{spendLimitCents:2200,delegationCents:0,canCreate:false,expiresAt:new Date(Date.now()+3600000).toISOString(),status:'active'});
  const op=m.requestMoney({kind:'agent',id:agent},{kind:'expense',agentId:agent,provider:'fixture-vendor',destination:'fixture-approved-vendor',category:'hosting',amountCents:100,maxCostCents:100,idempotencyKey:'fixture-hold'});
  assert.equal(op.state,'reserved');await reverse();assert.equal(m.cashAccount(agent).held_cents,100);assert.equal(m.cashAccount(agent).available_cents,0);
  assert.equal(m.moneyOverview().liabilities[0].remaining_cents,100);assert.equal(m.moneyOverview().killSwitch,true);assert.equal(m.verifyCashLedger().ok,true);
});
it('pending, unrelated and overlarge reversal claims cannot debit cash',async()=>{
  await cleared();await reconcile();reversal.state='pending';await assert.rejects(reverse(),/blocked_or_uncertain/);assert.equal(balance(),2200);
  reversal.state='settled';reversal.originalExternalId='other';await assert.rejects(reverse(),/blocked_or_uncertain/);assert.equal(balance(),2200);
});
it('reversal evidence changes conflict with the original receipt instead of debiting twice',async()=>{
  await cleared();await reconcile();reversal.amountCents=100;await reverse();reversal.amountCents=101;
  await assert.rejects(reverse(),/blocked_or_uncertain/);assert.equal(balance(),2100);assert.equal(m.verifyCashLedger().ok,true);
});
it('a duplicate read with insufficient independent receiving funds freezes the existing cash balance',async()=>{
  await cleared();await reconcile();settlement.availableBalanceCents=2199;
  await assert.rejects(reconcile(),/blocked_or_uncertain/);assert.equal(balance(),2200);assert.equal(m.ensureCashAccount().frozen,1);
});
it('verification timeout aborts the trusted read and late completion cannot write cash or payout evidence',async(t)=>{
  let entered!:()=>void,resolve!: (proof:FreelancerRemittance)=>void,signal:AbortSignal|undefined;
  const waiting=new Promise<void>(r=>{entered=r;});
  reader.verify=async(_input,s)=>{signal=s;entered();return new Promise(r=>{resolve=r;});};
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=bridge.observePayout(owner,'fixture-payout');await waiting;t.mock.timers.tick(30001);
  await assert.rejects(pending,/payout_verification_blocked/);assert.equal(signal!.aborted,true);
  resolve(remittance);await Promise.resolve();await Promise.resolve();assert.equal(balance(),0);assert.equal(state(),undefined);
});
it('exception-throwing provider proof getters cannot leak secrets or book cash',async()=>{
  await cleared();receiver.verify=async()=>Object.defineProperty({...settlement},'currency',{get(){throw Error('fixture-sensitive-credential-body');}});
  await assert.rejects(reconcile(),e=>e instanceof Error&&e.message==='freelancer_settlement_blocked_or_uncertain');assert.equal(balance(),0);
});
it('the incoming transfer cannot itself be presented as a separate reversal movement',async()=>{
  await cleared();await reconcile();await assert.rejects(bridge.reconcileReversal(owner,'fixture-payout','fixture-transfer'),/distinct_reversal_movement/);assert.equal(balance(),2200);
});
it('owner revocation during receiving verification prevents any cash write',async()=>{
  await cleared();beforeReceiving=()=>{db.run("UPDATE mission_owner SET status='revoked' WHERE id=?",[owner.id]);};
  try {await assert.rejects(reconcile(),/owner_required/);assert.equal(balance(),0);}
  finally {db.run("UPDATE mission_owner SET status='active' WHERE id=?",[owner.id]);}
});

it('a complete two-contract USD remittance credits the aggregate net once and binds every work item',async()=>{
  await cleared();
  // A second synthetic provider project, not a generated production opportunity.
  const multiplex=new FreelancerClient({userId:'1',accessToken:'fixture-only-freelancer-token'},{fetch:async(input,init)=>{
    const url=new URL(String(input));const second=url.pathname.includes('/projects/12/')||url.searchParams.get('projects[]')==='12';
    if(!second)return fixture.fetch(input,init);
    url.pathname=url.pathname.replace('/projects/12/','/projects/2/');
    for(const [key,value] of [...url.searchParams])if(['12','13','14'].includes(value))url.searchParams.set(key,String(Number(value)-10));
    const response=await fixture.fetch(url,init),body=await response.json();
    const rewrite=(value:unknown,key=''):unknown=>{
      if(Array.isArray(value))return value.map(x=>rewrite(x));
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k==='4'?'14':k,rewrite(v,k)]));
      return ['id','project_id','bid_id','transaction_id'].includes(key)&&typeof value==='number'&&[2,3,4,5].includes(value)?value+10:value;
    };
    return new Response(JSON.stringify(rewrite(body)),{headers:{'content-type':'application/json'}});
  }});
  const secondWork=new FreelancerWorkflow(multiplex);fixture.f.milestone.status='frozen';
  const row=await secondWork.assign(owner,'12','13','14','fixture second contract review');
  const draft=secondWork.draft(owner,String(row.id),'Fixture-only second software patch. Not actual paid work.');secondWork.approve(owner,String(row.id),String(draft.content_hash));
  await secondWork.deliver(owner,String(row.id));fixture.f.milestone.status='cleared';await secondWork.syncMilestone(owner,String(row.id));
  remittance.lines.push({...remittance.lines[0],projectId:'12',bidId:'13',milestoneId:'14'});remittance.netCents=4500;
  settlement.grossCents=4500;settlement.netCents=4450;
  const batch=new FreelancerSettlementWorkflow(multiplex,reader,receiver);await batch.reconcilePayout(owner,'fixture-payout','fixture-transfer');
  assert.equal(balance(),4450);assert.equal(db.all('SELECT * FROM mission_freelancer_payout_items').length,2);assert.equal(fixture.f.uploads,2);assert.equal(m.verifyCashLedger().ok,true);
});
