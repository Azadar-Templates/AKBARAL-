import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
process.env.ZA141251SA_DATABASE_URL=process.env.MONEY_CONCURRENCY_DATABASE_URL||`file:${path.join(os.tmpdir(),`cash-race-${randomUUID()}.db`)}`;
import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
const {missionDb:db,applyMissionMigrations,verifyMissionAudit}=require('./database') as typeof import('./database');
const m=require('./money') as typeof import('./money');
const {updatePolicy,setKillSwitch}=require('./policy') as typeof import('./policy');
import type {Row} from './database';
const owner={kind:'owner' as const,id:`race-owner-${randomUUID()}`},agent=`race-agent-${randomUUID()}`;
before(()=>{
 applyMissionMigrations();
 db.run("INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,?,'test-only','owner','active')",[owner.id,`${owner.id}@example.test`]);
 db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES (?,?,'Race test fixture','specialist',0,'custom','active','worker','test')",[agent,agent]);
 setKillSwitch(false,owner.id);updatePolicy({autonomousEnabled:true,allowAgentCreation:true,maxDailySpendCents:10000,maxExpenseCents:1000,requireApprovalAboveCents:1000},owner.id);
 m.provisionMoneyAgent(agent,owner.id);
 const opp=m.approveOpportunity(owner,{title:'Race fixture only',evidenceUrl:'https://example.test/race',activity:'software_development',provider:'race-fixture-only'});
 m.setMoneyGrant(owner,agent,{spendLimitCents:10000,delegationCents:100,canCreate:true,expiresAt:new Date(Date.now()+86400000).toISOString(),status:'active',opportunityId:String(opp.id)});
});
after(()=>db.close());
async function race(action:string,id='') {
 const children=[0,1].map(()=>fork(path.resolve('scripts/testing/mission-money-racer.ts'),[],{execArgv:['--import','tsx'],env:process.env,stdio:['ignore','ignore','pipe','ipc']}));
 const results=children.map(child=>new Promise<{ok:boolean;sends:number}>((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill();reject(Error('race timeout'));},30000);
  child.on('message',(msg:any)=>{if('ok' in msg){clearTimeout(timer);resolve(msg);}});child.on('error',reject);child.on('exit',code=>{if(code)reject(Error(`race worker exited ${code}`));});
 }));
 await Promise.all(children.map(child=>new Promise<void>(resolve=>child.once('message',()=>resolve()))));
 children.forEach((child,n)=>child.send({action,id,key:`${action}-${n}-${randomUUID()}`,actor:owner,agentId:agent}));
 return Promise.all(results);
}
it('cross-process duplicate payment evidence credits cash once',async()=>{
 const result=await race('receipt','race-income');assert.equal(result.every(r=>r.ok),true);assert.equal(m.cashAccount('treasury').available_cents,100);
});
it('cross-process competing allocations cannot overdraw treasury',async()=>{
 const result=await race('allocate');assert.equal(result.filter(r=>r.ok).length,1);assert.equal(m.cashAccount('treasury').available_cents,0);assert.equal(m.cashAccount(agent).available_cents,100);
});
it('cross-process competing reservations cannot spend the same cash twice',async()=>{
 const result=await race('reserve');assert.equal(result.filter(r=>r.ok).length,1);assert.equal(m.cashAccount(agent).available_cents,0);assert.equal(m.cashAccount(agent).held_cents,100);
});
it('cross-process dispatch claim permits exactly one provider invocation',async()=>{
 const op=db.get<Row>("SELECT id FROM mission_money_operations WHERE agent_id=? AND state='reserved'",[agent])!;
 const result=await race('dispatch',String(op.id));assert.equal(result.filter(r=>r.ok).length,1);assert.equal(result.reduce((n,r)=>n+r.sends,0),1);
 assert.equal(m.cashAccount(agent).held_cents,0);assert.equal(m.verifyCashLedger().ok,true);assert.equal(verifyMissionAudit().ok,true);
});

it('cross-process child delegation consumes a finite parent budget without orphan identities',async()=>{
 const result=await race('delegate');assert.equal(result.filter(r=>r.ok).length,1);
 assert.equal(m.grant(agent).delegation_cents,40);
 assert.equal(db.get<Row>('SELECT COUNT(*) AS n FROM mission_agents WHERE parent_id=?',[agent])!.n,1);
});
it('cross-process earning delivery claims execute once',async()=>{
 const job=m.queueEarning(owner,agent,'race-job');const result=await race('earning',String(job.id));
 assert.equal(result.reduce((n,r)=>n+r.sends,0),1);assert.equal(m.cashAccount('treasury').available_cents,100);
});
it('cross-process delivered-payment reconciliation credits once without redelivery',async()=>{
 const job=m.queueEarning(owner,agent,'race-delivered');db.run("UPDATE mission_earning_jobs SET state='awaiting_payment',provider_ref='race-delivered-income' WHERE id=?",[job.id]);
 const result=await race('earning-payment',String(job.id));assert.equal(result.every(r=>r.ok),true);
 assert.equal(m.cashAccount('treasury').available_cents,200);assert.equal(m.verifyCashLedger().ok,true);assert.equal(verifyMissionAudit().ok,true);
});
