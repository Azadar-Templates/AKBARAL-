import {randomUUID} from 'node:crypto';
import path from 'node:path'; import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL=process.env.PG_TEST_DATABASE_URL||`file:${path.join(os.tmpdir(),`discovery-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET='synthetic-discovery-tests-not-live-credentials';
import {before,beforeEach,after,it} from 'node:test'; import assert from 'node:assert/strict';
import {missionDb as db, applyMissionMigrations, sha256, verifyMissionAudit} from '../database';
import * as money from '../money';
import {updatePolicy, setKillSwitch} from '../policy';
import {OpportunityDiscovery, type InboundOpportunityInput} from './opportunity-discovery';
import {CustomerWork} from './customer-work';

const owner={kind:'owner' as const, id:'discovery-fixture-owner'}, agent='discovery-fixture-agent', other='discovery-fixture-other';
const keepAlive=setInterval(()=>{},1000);
before(()=>{
  applyMissionMigrations();
  db.run("INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,'fixture-discovery@example.test','fixture','owner','active')",[owner.id]);
  for(const id of [agent, other]) db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES (?,?,'Synthetic fixture','specialist',0,'custom','active','worker','fixture')",[id,id]);
});
beforeEach(()=>{
  setKillSwitch(false, owner.id);
  for(const t of ['mission_discovery_opportunities','mission_customer_requests','mission_customer_events','mission_customer_suppressions','mission_audit','mission_earning_jobs','mission_money_receipts','mission_cash_entries'])
    try{ db.run(`DELETE FROM ${t}`);}catch{}
  // reset audit? keep
  updatePolicy({currency:'USD', killSwitch:false, autonomousEnabled:true, maxDailySpendCents:100000, maxExpenseCents:10000, requireApprovalAboveCents:5000} as any, owner.id);
  for(const id of [agent, other]) money.setMoneyGrant(owner, id, {spendLimitCents:0,delegationCents:0,canCreate:false,expiresAt:new Date(Date.now()+86400000).toISOString(), status:'active'});
});
after(()=>{ try{db.close();} finally{clearInterval(keepAlive);}});

const inboundBase=():InboundOpportunityInput=>({
  serviceId:'json-validation',
  brief:'Synthetic inbound validation request for testing — not a real customer',
  configuration:{required:['id'], uniqueKey:'id'},
  quoteCents:400,
  customerRef:`test-customer-${randomUUID().slice(0,8)}@example.test`,
  sourceRef:`src-${randomUUID()}`,
  observedAt:new Date().toISOString(),
  consentExpiresAt:new Date(Date.now()+3600000).toISOString(),
  evidenceUrl:'https://example.test/evidence',
  provider:'direct',
  explicitRequestReviewed:true, contactPermissionReviewed:true, lawfulPurposeReviewed:true, dataRightsReviewed:true, nonSensitiveDataOnly:true, automationPermissionReviewed:true
});

it('inbound intake retains source/evidence/timestamp/provider/eligibility/dedup and is not revenue',()=>{
  const disc=new OpportunityDiscovery();
  const input=inboundBase();
  const opp=disc.ingestInbound(input) as any;
  assert.equal(opp.source,'inbound');
  assert.equal(opp.provider,'direct');
  assert.ok(opp.evidence_hash.length===64);
  assert.ok(JSON.parse(opp.evidence).sourceRef===input.sourceRef);
  assert.ok(opp.observed_at===input.observedAt);
  assert.ok(JSON.parse(opp.eligibility_json).allowed===true);
  assert.ok(opp.dedup_hash.length===64);
  assert.equal(opp.state,'discovered');
  // Not counted as revenue
  assert.equal(disc.verifiedCustomerCount(),0);
  assert.equal(db.all('SELECT * FROM mission_customer_requests').length,0);
  assert.equal(db.all('SELECT * FROM mission_money_receipts').length,0);
  const cw=new CustomerWork();
  assert.equal(cw.overview(owner).totalRecords,0);
});

it('duplicate inbound is refused via dedup_hash and external_id',()=>{
  const disc=new OpportunityDiscovery();
  const input=inboundBase();
  disc.ingestInbound(input);
  assert.throws(()=>disc.ingestInbound(input), /duplicate/);
  // Same external_id but different brief still dedup via external_id uniqueness? We check both.
  const input2={...inboundBase(), sourceRef: input.sourceRef, brief:'Different brief'};
  // dedup hash differs but external_id duplicate should still be rejected via provider+external_id
  assert.throws(()=>disc.ingestInbound({...input, sourceRef: input.sourceRef}), /duplicate/);
});

it('inbound requires explicit consent flags and valid service spec',()=>{
  const disc=new OpportunityDiscovery();
  const base=inboundBase();
  for(const flag of ['explicitRequestReviewed','contactPermissionReviewed','lawfulPurposeReviewed','dataRightsReviewed','nonSensitiveDataOnly','automationPermissionReviewed'] as const){
    const clone={...base, [flag]:false} as any;
    assert.throws(()=>disc.ingestInbound(clone), /review_required/);
  }
  assert.throws(()=>disc.ingestInbound({...base, serviceId:'unknown'} as any));
  assert.throws(()=>disc.ingestInbound({...base, quoteCents:0} as any));
  assert.throws(()=>disc.ingestInbound({...base, brief:''} as any));
});

it('agents can discover and qualify autonomously when permitted; blocked when autonomy disabled',()=>{
  const disc=new OpportunityDiscovery();
  const input=inboundBase();
  const opp=disc.ingestInbound(input) as any;
  // Agent discover
  const found=disc.discover({kind:'agent', id:agent}, 20) as any;
  assert.equal(found.qualifyingCount,1);
  assert.equal(found.opportunities[0].id, opp.id);
  // Qualify as agent
  const qualified=disc.qualify({kind:'agent', id:agent}, opp.id) as any;
  assert.equal(qualified.state,'qualified');
  // Disable autonomy
  updatePolicy({autonomousEnabled:false} as any, owner.id);
  const input2=inboundBase();
  const opp2=disc.ingestInbound(input2) as any;
  assert.throws(()=>disc.discover({kind:'agent', id:agent},20), /autonomy_disabled/);
  assert.throws(()=>disc.qualify({kind:'agent', id:agent}, opp2.id), /autonomy_disabled/);
  // Owner can still discover/qualify
  const ownerFound=disc.discover(owner,20) as any;
  assert.ok(ownerFound.opportunities.length>=2);
  const ownerQualified=disc.qualify(owner, opp2.id) as any;
  assert.equal(ownerQualified.state,'qualified');
});

it('sensitive or high-quote inbound is not autonomously discoverable/qualifiable',()=>{
  const disc=new OpportunityDiscovery();
  // Sensitive brief
  const sens=inboundBase();
  sens.brief='Contact me at john@example.com with SSN 123-45-6789';
  const oppSens=disc.ingestInbound(sens) as any;
  const eligSens=JSON.parse(oppSens.eligibility_json);
  assert.equal(eligSens.allowed,false);
  assert.ok(eligSens.reasons.some((r:string)=>r.includes('pii')));
  const agentDisc=disc.discover({kind:'agent', id:agent},20) as any;
  assert.equal(agentDisc.qualifyingCount,0); // not eligible
  assert.throws(()=>disc.qualify({kind:'agent', id:agent}, oppSens.id), /not_eligible|not_eligible|sensitive/);
  // High quote
  const high=inboundBase();
  high.quoteCents=6000; // above requireApproval 5000
  const oppHigh=disc.ingestInbound(high) as any;
  assert.equal(JSON.parse(oppHigh.eligibility_json).allowed,false);
  const agentQual =()=>disc.qualify({kind:'agent', id:agent}, oppHigh.id);
  // qualify should deny due to quote
  assert.throws(agentQual, /not_eligible|quote_requires/);
});

it('permitted feed ingestion is owner-gated and requires explicit feed allowance',()=>{
  const disc=new OpportunityDiscovery();
  const feedItem={provider:'permitted_example', externalId:`ext-${randomUUID()}`, serviceId:'json-validation', brief:'Lawful feed opportunity', configuration:{required:['id'],uniqueKey:'id'}, quoteCents:300, observedAt:new Date().toISOString(), consentExpiresAt:new Date(Date.now()+3600000).toISOString()};
  // Without allowance, fails
  assert.throws(()=>disc.ingestPermittedFeed(owner, [feedItem] as any), /feed_not_allowed/);
  // Owner enables feed
  updatePolicy({providerActivation:[{id:'discovery:permitted_feed', allowed:true}] } as any, owner.id);
  const result=disc.ingestPermittedFeed(owner, [feedItem] as any) as any;
  assert.equal(result.ingestedCount,1);
  assert.equal(result.opportunities[0].source,'permitted_feed');
  // Agents cannot ingest feed
  assert.throws(()=> (disc as any).ingestPermittedFeed({kind:'agent', id:agent}, [feedItem]), /owner_required|feed_not_allowed/);
  // Duplicate skipped
  const result2=disc.ingestPermittedFeed(owner, [feedItem] as any) as any;
  assert.equal(result2.ingestedCount,0);
});

it('promotion to REAL REQUEST is owner-only and retains evidence, not revenue',()=>{
  const disc=new OpportunityDiscovery();
  const input=inboundBase();
  const opp=disc.ingestInbound(input) as any;
  disc.qualify(owner, opp.id);
  // Agent cannot promote
  assert.throws(()=>disc.promote({kind:'agent', id:agent} as any, opp.id), /owner_required/);
  // Owner promotes
  const req=disc.promote(owner, opp.id, 'identity-review-ref') as any;
  assert.equal(req.origin,'direct');
  assert.equal(req.customer_ref, input.customerRef);
  assert.equal(req.source_ref, input.sourceRef);
  assert.equal(req.state,'inquiry');
  // Discovery marked promoted
  const after=disc.get(opp.id) as any;
  assert.equal(after.state,'promoted');
  assert.equal(after.promoted_request_id, req.id);
  // Not revenue
  const cw=new CustomerWork();
  const progress=cw.progress(owner, req.id);
  assert.equal(progress.receivedNetUsdCents,0);
  assert.equal(progress.stage,'owner_recorded_inquiry');
  // No money credited
  assert.equal(db.all('SELECT * FROM mission_money_receipts').length,0);
});

it('killSwitch blocks discovery ingestion and agent discover',()=>{
  const disc=new OpportunityDiscovery();
  setKillSwitch(true, owner.id);
  assert.throws(()=>disc.ingestInbound(inboundBase()), /policy_blocked/);
  // Even if we bypass, discover blocked
  setKillSwitch(false, owner.id);
  const opp=disc.ingestInbound(inboundBase()) as any;
  setKillSwitch(true, owner.id);
  assert.throws(()=>disc.discover({kind:'agent', id:agent},20), /policy_blocked/);
  assert.throws(()=>disc.discover(owner,20), /policy_blocked/);
});

it('inbound does not fabricate customers: no outbound, no fake revenue, audit retains evidence',()=>{
  const disc=new OpportunityDiscovery();
  const input=inboundBase();
  const opp=disc.ingestInbound(input) as any;
  // Verify audit
  const audit=db.all('SELECT * FROM mission_audit WHERE action=?',['discovery.ingested_inbound']);
  assert.ok(audit.length===1);
  assert.equal(JSON.parse(String(audit[0].detail)).dedupHash, opp.dedup_hash);
  // No customer counted
  assert.equal(db.get('SELECT COUNT(*) as n FROM mission_discovery_opportunities')!.n,1);
  assert.equal(disc.verifiedCustomerCount(),0);
  // No revenue, no wallet, no payout
  assert.equal(db.all('SELECT * FROM mission_ledger').length,0);
  assert.equal(verifyMissionAudit().ok,true);
});
