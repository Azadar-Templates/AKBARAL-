import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL=`file:${path.join(os.tmpdir(),`stripe-cash-${randomUUID()}.db`)}`;
import { it, before, after } from 'node:test';
import assert from 'node:assert/strict';
const {MissionStripe}=require('./money-stripe') as typeof import('./money-stripe');
const {applyMissionMigrations,missionDb}=require('./database') as typeof import('./database');
const {ensureCashAccount}=require('./money') as typeof import('./money');
import type { Row } from './database';
before(()=>{applyMissionMigrations();ensureCashAccount();});after(()=>missionDb.close());
function harness(patch:Record<string,any>={}) {
 const calls:Array<{path:string;init?:RequestInit}>=[];
 const account={id:'acct_fixture',charges_enabled:true,payouts_enabled:true,details_submitted:true,settings:{payouts:{schedule:{interval:'manual'}}}};
 const payout={id:'po_fixture',livemode:true,metadata:{mission:'ZA141251SA',mission_operation:'pay_fixture'},amount:100,currency:'usd',destination:'ba_fixture',status:'paid',balance_transaction:'txn_out'};
 const map:Record<string,any>={account,'balance_transactions/txn_income':{id:'txn_income',type:'charge',status:'available',net:1000,currency:'usd',source:'ch_fixture'},'charges/ch_fixture':{balance_transaction:'txn_income',paid:true,captured:true,livemode:true,refunded:false,disputed:false,amount_refunded:0,metadata:{mission:'ZA141251SA',mission_agent_id:'agent_fixture'}},balance:{livemode:true,available:[{currency:'usd',amount:1000}]},'accounts/acct_fixture/external_accounts/ba_fixture':{id:'ba_fixture',object:'bank_account',status:'verified',currency:'usd'},payouts:payout,'payouts/po_fixture':payout,'balance_transactions/txn_out':{id:'txn_out',source:'po_fixture',status:'available',net:-100,currency:'usd'},...patch};
 const transport=(async(url:any,init?:RequestInit)=>{const path=String(url).replace('https://api.stripe.com/v1/','');calls.push({path,init});assert.equal(new URL(url).origin,'https://api.stripe.com');return new Response(JSON.stringify(map[path]??{}),{status:200});}) as typeof fetch;
 return {client:new MissionStripe('sk_live_isolated_fixture','acct_fixture',transport),calls};
}
const op:Row={id:'pay_fixture',kind:'withdrawal',amount_cents:100,max_cost_cents:100,currency:'USD',destination:'ba_fixture',provider_ref:'po_fixture'};
it('rejects test credentials and absent live account binding',()=>{
 assert.throws(()=>new MissionStripe('sk_test_not_real','acct_fixture'),/not_configured/);assert.throws(()=>new MissionStripe('sk_live_fixture',''),/not_configured/);
});
it('verifies available net receipts in the dedicated live account',async()=>{
 const {client}=harness();const r=await client.verifyReceipt('txn_income');assert.equal(r.amountCents,1000);assert.equal(r.agentId,'agent_fixture');assert.equal(client.supports('expense'),false);
});
it('rejects wrong account, automatic payouts, nonmission charges and refunded charges',async()=>{
 for(const patch of [{account:{id:'acct_customer'}},{account:{id:'acct_fixture',charges_enabled:true,payouts_enabled:true,details_submitted:true}}, {'charges/ch_fixture':{paid:true,captured:true,livemode:true,metadata:{mission:'AKBARAL'}}},{'charges/ch_fixture':{paid:true,captured:true,livemode:true,refunded:true,metadata:{mission:'ZA141251SA'}}}]){
  await assert.rejects(harness(patch).client.verifyReceipt('txn_income'));
 }
});
it('does not credit pending balance transactions',async()=>{
 await assert.rejects(harness({'balance_transactions/txn_income':{id:'txn_income',status:'pending',net:1000,currency:'usd'}}).client.verifyReceipt('txn_income'),/not_available/);
});
it('uses stable provider idempotency and binds destination, amount, currency and operation',async()=>{
 const {client,calls}=harness();let authorized=0;const r=await client.pay(op,()=>authorized++);
 assert.equal(authorized,1);assert.equal(r.state,'completed');assert.equal(r.actualCents,100);
 const post=calls.find(c=>c.init?.method==='POST')!;assert.equal((post.init!.headers as Record<string,string>)['Idempotency-Key'],'za141251sa:pay_fixture');
 assert.equal(new URLSearchParams(String(post.init!.body)).get('destination'),'ba_fixture');assert.equal(post.init?.redirect,'error');
});
it('rechecks authorization immediately before send; freeze produces no POST',async()=>{
 const {client,calls}=harness();await assert.rejects(client.pay(op,()=>{throw Error('frozen');}),/frozen/);assert.equal(calls.filter(c=>c.init?.method==='POST').length,0);
});
it('never marks pending payout completed and rejects an unmatched provider response',async()=>{
 const pending={id:'po_fixture',livemode:true,metadata:{mission:'ZA141251SA',mission_operation:'pay_fixture'},amount:100,currency:'usd',destination:'ba_fixture',status:'pending'};
 assert.equal((await harness({payouts:pending}).client.pay(op,()=>{})).state,'pending');
 await assert.rejects(harness({payouts:{...pending,amount:101}}).client.pay(op,()=>{}),/mismatch/);
});
it('lookup is read-only and absence never releases funds',async()=>{
 const {client,calls}=harness({'payouts?limit=100':{data:[],has_more:false}});
 await assert.rejects(client.lookup({...op,provider_ref:null}),/uncertain/);assert.equal(calls.some(c=>c.init?.method==='POST'),false);
});
it('provider errors are redacted, never echoed with SDK payloads or secrets',async()=>{
 const client=new MissionStripe('sk_live_fixture','acct_fixture',(async()=>new Response('secret-provider-diagnostic',{status:500})) as typeof fetch);
 await assert.rejects(client.verifyReceipt('txn_income'),error=>String(error).includes('provider_response_unverified')&&!String(error).includes('secret-provider'));
});
