import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL=process.env.PG_TEST_DATABASE_URL||`file:${path.join(os.tmpdir(),`freelancer-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET='fixture-only-freelancer-session-not-live';
import { before,beforeEach,after,it } from 'node:test';
import assert from 'node:assert/strict';
// The synchronous PG bridge unrefs its worker. Keep the test process alive until
// every registered test and teardown finishes; --test-force-exit alone can hide truncation.
const testLiveness = setInterval(() => {}, 1000);
import { FreelancerClient } from './freelancer';
import { freelancerFixture } from './freelancer.fixtures';
const {missionDb:db,applyMissionMigrations,verifyMissionAudit}=require('../database') as typeof import('../database');
const {FreelancerWorkflow,FREELANCER_COMPLIANCE_CHECKS,reserveFreelancerRequest,recordFreelancerCooldown}=require('./freelancer-workflow') as typeof import('./freelancer-workflow');
const m=require('../money') as typeof import('../money');
const {updatePolicy,setKillSwitch}=require('../policy') as typeof import('../policy');
import type { Row } from '../database';
const owner={kind:'owner' as const,id:'fixture-owner'},agent='fixture-agent',other='fixture-other';
let fixture:ReturnType<typeof freelancerFixture>,w:InstanceType<typeof FreelancerWorkflow>;
const tables=['mission_freelancer_payout_items','mission_freelancer_payouts','mission_freelancer_settlement_evidence','mission_freelancer_events','mission_freelancer_work','mission_freelancer_accounts','mission_freelancer_projects','mission_freelancer_api_requests','mission_freelancer_api_cooldown','mission_earning_jobs','mission_money_receipts','mission_cash_liabilities','mission_cash_entries','mission_money_transfers','mission_money_operations','mission_money_grants','mission_money_opportunities','mission_cash_accounts'];
before(()=>{applyMissionMigrations();db.run("INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,'fixture-freelancer@example.test','fixture','owner','active')",[owner.id]);for(const id of [agent,other])db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES (?,?,'Synthetic identity','specialist',0,'custom','active','worker','fixture')",[id,id]);});
beforeEach(()=>{
  setKillSwitch(false,owner.id);for(const table of tables)db.run(`DELETE FROM ${table}`);
  updatePolicy({killSwitch:false,autonomousEnabled:true,currency:'USD',maxDailySpendCents:100000,maxExpenseCents:10000,requireApprovalAboveCents:500},owner.id);
  for(const id of [agent,other])m.setMoneyGrant(owner,id,{spendLimitCents:0,delegationCents:0,canCreate:false,expiresAt:new Date(Date.now()+86400000).toISOString(),status:'active'});
  fixture=freelancerFixture();w=new FreelancerWorkflow(fixture.client);
});
after(()=>{try {db.close();} finally {clearInterval(testLiveness);}});
const authorization=(agentId=agent)=>({agentId,reference:'fixture-only manual eligibility review',expiresAt:new Date(Date.now()+3600000).toISOString(),checks:[...FREELANCER_COMPLIANCE_CHECKS]});
async function assigned(){await w.authorizeAccount(owner,authorization());return w.assign(owner,'2','3','4','fixture-only client scope and AI-permission review');}
async function prepared(){const row=await assigned();const draft=w.draft(owner,String(row.id),'Fixture-only patch / test report. No real paid work.');return w.approve(owner,String(row.id),String(draft.content_hash));}
it('unconfigured lifecycle shows all nine stages and permanently blocked payout/settlement/cash',async()=>{
  const missing=new FreelancerWorkflow(null),view=missing.overview(owner);assert.equal(view.lifecycle.length,9);assert.equal(view.cashBridgeEnabled,false);
  assert.deepEqual(view.blocked,['credentials','payout_adapter_not_configured','independent_usd_settlement_not_configured']);
  await assert.rejects(missing.discover(owner,'software'),/blocked_credentials/);assert.equal(m.ensureCashAccount().available_cents,0);
});
it('owner access, fresh agent authority and full manual compliance review are required',async()=>{
  const actor={kind:'agent' as const,id:agent};assert.throws(()=>w.overview(actor),/owner_required/);await assert.rejects(w.discover(actor,'software'),/owner_required/);
  await assert.rejects(w.assign(owner,'2','3','4','fixture'),/account_authorization_required/);
  await assert.rejects(w.authorizeAccount(owner,{...authorization(),checks:[]}),/compliance_review_required/);
  await assert.rejects(w.authorizeAccount(owner,{...authorization(),expiresAt:new Date(Date.now()+172800000).toISOString()}),/expiry/);
  db.run("UPDATE mission_money_grants SET status='revoked' WHERE agent_id=?",[agent]);await assert.rejects(w.authorizeAccount(owner,authorization()),/authority_inactive/);
});
it('discovery persists provider observations without assigning agents, contracts, or cash',async()=>{
  await w.discover(owner,'software');assert.equal(db.all('SELECT * FROM mission_freelancer_projects').length,1);
  assert.equal(db.all('SELECT * FROM mission_freelancer_work').length,0);assert.equal(db.all('SELECT * FROM mission_money_opportunities').length,0);assert.equal(m.ensureCashAccount().available_cents,0);
});
it('exclusive account ownership persists across workflow restarts and revoked tombstones',async()=>{
  await w.authorizeAccount(owner,authorization());await assert.rejects(new FreelancerWorkflow(fixture.client).authorizeAccount(owner,authorization(other)),/exclusive_account_conflict/);
  w.revokeAccount(owner);await assert.rejects(w.authorizeAccount(owner,authorization()),/exclusive_account_conflict/);
  await assert.rejects(w.assign(owner,'2','3','4','fixture'),/account_authorization_required/);
});
it('assignment requires accepted work and a funded milestone; duplicate concurrent claims cannot duplicate a contract',async()=>{
  await w.authorizeAccount(owner,authorization());fixture.f.bid.award_status='pending';await assert.rejects(w.assign(owner,'2','3','4','fixture'),/accepted_award_required/);
  fixture.f.bid.award_status='awarded';const results=await Promise.allSettled([w.assign(owner,'2','3','4','fixture'),new FreelancerWorkflow(fixture.client).assign(owner,'2','3','4','fixture')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(db.all('SELECT * FROM mission_freelancer_work').length,1);
});
it('draft editing resets approval; wrong hashes, excessive bytes and approved artifact mutations are blocked',async()=>{
  const row=await assigned(),id=String(row.id);const first=w.draft(owner,id,'fixture first');const next=w.draft(owner,id,'fixture second');
  assert.throws(()=>w.approve(owner,id,String(first.content_hash)),/artifact_hash_mismatch/);
  assert.throws(()=>w.draft(owner,id,'界'.repeat(100000)),/artifact_too_large/);
  w.approve(owner,id,String(next.content_hash));assert.throws(()=>w.draft(owner,id,'fixture third'),/immutable_artifact/);
});
it('owner-approved deliverable delivery acknowledges a single provider upload but does not create money',async()=>{
  const row=await prepared(),id=String(row.id);const delivered=await w.deliver(owner,id);assert.equal(delivered.state,'delivered');assert.equal(fixture.f.uploads,1);
  await assert.rejects(new FreelancerWorkflow(fixture.client).deliver(owner,id),/already_claimed/);assert.equal(fixture.f.uploads,1);
  assert.equal(m.ensureCashAccount().available_cents,0);assert.equal(db.all('SELECT * FROM mission_money_receipts').length,0);assert.equal(db.all('SELECT * FROM mission_cash_entries').length,0);
});
it('concurrent delivery claims dispatch once',async()=>{
  const row=await prepared();const results=await Promise.allSettled([w.deliver(owner,String(row.id)),new FreelancerWorkflow(fixture.client).deliver(owner,String(row.id))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(fixture.f.uploads,1);
});
it('lost/mismatched upload responses stay review-only across restart and cannot be approved or sent again',async()=>{
  const row=await prepared(),id=String(row.id);fixture.f.failUpload=true;const result=await w.deliver(owner,id);assert.equal(result.state,'delivery_review_required');
  assert.equal(JSON.stringify(result).includes('sensitive'),false);fixture.f.failUpload=false;
  await assert.rejects(new FreelancerWorkflow(fixture.client).deliver(owner,id),/already_claimed/);
  assert.throws(()=>w.approve(owner,id,String(row.content_hash)),/artifact_hash_mismatch/);await assert.rejects(w.syncMilestone(owner,id),/delivery_not_confirmed/);assert.equal(fixture.f.uploads,1);
});
it('crashed dispatching claims are never reset into a sendable state',async()=>{
  const row=await prepared();db.run("UPDATE mission_freelancer_work SET state='dispatching' WHERE id=?",[row.id]);
  await assert.rejects(new FreelancerWorkflow(fixture.client).deliver(owner,String(row.id)),/already_claimed/);assert.equal(fixture.f.uploads,0);
});
it('changed provider scope or funding blocks delivery without any POST',async()=>{
  const row=await prepared();fixture.f.project.description='Changed scope';assert.equal((await w.deliver(owner,String(row.id))).state,'delivery_review_required');assert.equal(fixture.f.uploads,0);
});
it('kill switch changed during eligibility I/O is rechecked immediately before POST',async()=>{
  const row=await prepared();fixture.f.beforeRead=url=>{if(url.pathname.endsWith('/milestones/'))setKillSwitch(true,owner.id);};
  assert.equal((await w.deliver(owner,String(row.id))).state,'delivery_review_required');assert.equal(fixture.f.uploads,0);
});
it('account revocation during eligibility I/O defeats previously granted approval',async()=>{
  const row=await prepared();fixture.f.beforeRead=url=>{if(url.pathname.endsWith('/milestones/'))w.revokeAccount(owner);};
  assert.equal((await w.deliver(owner,String(row.id))).state,'delivery_review_required');assert.equal(fixture.f.uploads,0);
});
it('expired grants, account approvals and USD policy gates fail closed',async()=>{
  const row=await prepared();db.run("UPDATE mission_freelancer_accounts SET expires_at='2000-01-01T00:00:00.000Z'");await assert.rejects(w.deliver(owner,String(row.id)),/account_authorization_required/);
  await w.authorizeAccount(owner,authorization());db.run("UPDATE mission_money_grants SET expires_at='2000-01-01T00:00:00.000Z' WHERE agent_id=?",[agent]);await assert.rejects(w.deliver(owner,String(row.id)),/authority_inactive/);
  updatePolicy({currency:'EUR'},owner.id);await assert.rejects(w.discover(owner,'software'),/policy_blocked/);assert.equal(fixture.f.uploads,0);
});
it('cleared milestone and subsequent dispute preserve immutable evidence without credit or reversal of fictional cash',async()=>{
  const row=await prepared(),id=String(row.id);await w.deliver(owner,id);fixture.f.milestone.status='cleared';assert.equal((await w.syncMilestone(owner,id)).state,'provider_cleared');
  fixture.f.milestone.status='disputed';assert.equal((await w.syncMilestone(owner,id)).state,'provider_review_required');
  assert.equal(db.all<Row>("SELECT * FROM mission_freelancer_events WHERE work_id=? AND state='provider_cleared'",[id]).length,1);
  assert.equal(m.ensureCashAccount().available_cents,0);assert.equal(db.all('SELECT * FROM mission_money_receipts').length,0);assert.equal(verifyMissionAudit().ok,true);
});
it('evidence remains observable after authority revocation, but cannot authorize another delivery',async()=>{
  const row=await prepared(),id=String(row.id);await w.deliver(owner,id);w.revokeAccount(owner);setKillSwitch(true,owner.id);
  fixture.f.milestone.status='cleared';assert.equal((await w.syncMilestone(owner,id)).state,'provider_cleared');await assert.rejects(w.deliver(owner,id),/policy_blocked/);
});
it('shared request caps and rate-limit cooldowns survive client recreation',()=>{
  for(let i=0;i<20;i++)reserveFreelancerRequest();assert.throws(()=>reserveFreelancerRequest(),/rate_limited/);
  db.run('DELETE FROM mission_freelancer_api_requests');recordFreelancerCooldown(120000);assert.throws(()=>reserveFreelancerRequest(),/rate_limited/);
});

it('frozen agent cash and unresolved treasury liabilities stop authorized delivery',async()=>{
  const row=await prepared();m.freezeCash(owner,agent,true);await assert.rejects(w.deliver(owner,String(row.id)),/agent_frozen/);
  m.freezeCash(owner,agent,false);db.run("INSERT INTO mission_cash_liabilities VALUES ('fixture','fixture',1)");
  await assert.rejects(w.deliver(owner,String(row.id)),/cash_frozen_or_liability/);assert.equal(fixture.f.uploads,0);
});

it('late stale milestone observations cannot overwrite a newer dispute',async()=>{
  const row=await prepared(),id=String(row.id);await w.deliver(owner,id);fixture.f.milestone.status='cleared';
  let arrived!:()=>void,release!:()=>void;
  const entered=new Promise<void>(r=>{arrived=r;}),gate=new Promise<void>(r=>{release=r;});
  const slow=new FreelancerWorkflow(new FreelancerClient({userId:'1',accessToken:'fixture-only-freelancer-token'},{fetch:async(input,init)=>{
    const response=await fixture.fetch(input,init);
    if(String(input).includes('/milestones/')){arrived();await gate;}return response;
  }}));
  const stale=slow.syncMilestone(owner,id);await entered;fixture.f.milestone.status='disputed';await w.syncMilestone(owner,id);release();
  await assert.rejects(stale,/stale_observation/);assert.equal(db.get<Row>('SELECT state FROM mission_freelancer_work WHERE id=?',[id])!.state,'provider_review_required');
});

async function uncertainDelivery() {
  const row=await prepared();let createdAt='';fixture.f.beforeUpload=()=>{createdAt=new Date().toISOString();};fixture.f.failUpload=true;await w.deliver(owner,String(row.id));fixture.f.failUpload=false;
  const proof={userId:'1',projectId:'2',fileId:'5',fromUserId:'1',toUserId:'9',state:'stored' as const,fileName:`delivery-${row.content_hash}.txt`,bytes:Buffer.byteLength(String(row.content)),contentHash:String(row.content_hash),createdAt,verifiedAt:new Date().toISOString()};
  const reader={userId:'1',verify:async()=>structuredClone(proof) as typeof proof|null};
  const recovery=new FreelancerWorkflow(fixture.client,reader);return {row,proof,reader,recovery};
}
it('uncertain uploads recover by actual provider byte-hash readback, never by resending',async()=>{
  const {row,recovery}=await uncertainDelivery();w.revokeAccount(owner);setKillSwitch(true,owner.id);
  assert.equal((await recovery.reconcileDelivery(owner,String(row.id),'5')).state,'delivered');
  assert.equal(fixture.f.uploads,1);assert.equal(m.ensureCashAccount().available_cents,0);
  await assert.rejects(recovery.deliver(owner,String(row.id)),/policy_blocked/);
});
it('unconfigured, absent and mismatched file readback stays blocked with no new POST',async()=>{
  const {row,proof,reader,recovery}=await uncertainDelivery();
  await assert.rejects(w.reconcileDelivery(owner,String(row.id),'5'),/file_readback_not_configured/);
  proof.contentHash='different';await assert.rejects(recovery.reconcileDelivery(owner,String(row.id),'5'),/file_readback_unconfirmed/);
  reader.verify=async()=>null;await assert.rejects(recovery.reconcileDelivery(owner,String(row.id),'5'),/file_readback_unconfirmed/);
  assert.equal(fixture.f.uploads,1);assert.equal(db.get<Row>('SELECT state FROM mission_freelancer_work WHERE id=?',[row.id])!.state,'delivery_review_required');
});
for(const field of ['userId','projectId','fromUserId','toUserId','fileId','fileName'] as const)it(`stored file ${field} must match the exact approved delivery`,async()=>{
  const {row,proof,recovery}=await uncertainDelivery();proof[field]='99';await assert.rejects(recovery.reconcileDelivery(owner,String(row.id),'5'),/file_readback_unconfirmed/);assert.equal(fixture.f.uploads,1);
});
it('old or future files and stale verification cannot stand in for this dispatch',async()=>{
  const {row,proof,recovery}=await uncertainDelivery();proof.createdAt='2000-01-01T00:00:00Z';await assert.rejects(recovery.reconcileDelivery(owner,String(row.id),'5'),/dispatch_window/);
  proof.createdAt=new Date(Date.now()+60000).toISOString();await assert.rejects(recovery.reconcileDelivery(owner,String(row.id),'5'),/dispatch_window/);
  proof.createdAt=new Date().toISOString();proof.verifiedAt='2000-01-01T00:00:00Z';await assert.rejects(recovery.reconcileDelivery(owner,String(row.id),'5'),/stale_readback/);
});
it('a changed approval during file readback cannot be recovered into an authorized delivery',async()=>{
  const {row,proof,reader,recovery}=await uncertainDelivery();reader.verify=async()=>{db.run('UPDATE mission_freelancer_work SET approved_hash=NULL WHERE id=?',[row.id]);return structuredClone(proof);};
  await assert.rejects(recovery.reconcileDelivery(owner,String(row.id),'5'),/delivery_changed/);assert.equal(fixture.f.uploads,1);
});
it('raw readback errors are redacted and file IDs cannot become arbitrary URLs',async()=>{
  const {row,reader,recovery}=await uncertainDelivery();reader.verify=async()=>{throw Error('fixture-sensitive-provider-body');};
  await assert.rejects(recovery.reconcileDelivery(owner,String(row.id),'5'),/freelancer_external_verification_unavailable/);
  await assert.rejects(recovery.reconcileDelivery(owner,String(row.id),'https://example.test'),/invalid_file_id/);assert.equal(fixture.f.uploads,1);
});
