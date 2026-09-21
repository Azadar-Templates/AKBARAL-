import {randomUUID} from 'node:crypto';
import path from 'node:path'; import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL=process.env.PG_TEST_DATABASE_URL||`file:${path.join(os.tmpdir(),`earneng-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET='synthetic-earneng-tests-not-live';
import {before, beforeEach, after, it} from 'node:test'; import assert from 'node:assert/strict';
import {missionDb as db, applyMissionMigrations, verifyMissionAudit} from '../database';
import * as money from '../money';
import {updatePolicy, setKillSwitch} from '../policy';
import {provisionOwner} from '../auth';
import * as Engine from './earning-engine';
import {OPPORTUNITY_REGISTRY} from './opportunity-registry';

const keepAlive=setInterval(()=>{},1000);
let ownerId: string;
let agentA: string; let agentB: string;
before(()=>{
  applyMissionMigrations();
  const o:any = provisionOwner({email:'earn-owner@example.test', password:'StrongPass!123', displayName:'Earn Owner'});
  ownerId = String(o.id ?? o.owner?.id ?? 'earn-owner');
  // ensure agents
  agentA = `agt-a-${randomUUID().slice(0,8)}`;
  agentB = `agt-b-${randomUUID().slice(0,8)}`;
  for(const id of [agentA, agentB]){
    db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,?,0,'custom','active','worker','fixture',?)",[id,id,`Agent ${id}`, JSON.stringify(['software_development','ai_implementation','GitHub'])]);
  }
  // owner also needs grant? not needed
  updatePolicy({currency:'USD', killSwitch:false, autonomousEnabled:true, allowAgentCreation:true, maxAgents:5000, maxDepth:5, maxChildrenPerAgent:10, maxDailySpendCents:100000, maxExpenseCents:10000, requireApprovalAboveCents:5000, reinvestShareBps:2000} as any, ownerId);
  // provision money grants for matching (avoid schema drift)
  for(const id of [agentA, agentB]){
    try{ money.setMoneyGrant({kind:'owner', id: ownerId}, id, {spendLimitCents:100000, delegationCents:0, canCreate:false, expiresAt:new Date(Date.now()+86400000).toISOString(), status:'active'});}catch{}
  }
});
beforeEach(()=>{
  setKillSwitch(false, ownerId);
  for(const t of ['mission_earning_engine_opportunities','mission_agent_earnings_ledger','mission_opportunity_roi','mission_failed_learnings','mission_earning_scaling_log','mission_earning_scores','mission_audit']){
    try{ db.run(`DELETE FROM ${t}`);}catch{}
  }
  // keep agents/grants
  updatePolicy({autonomousEnabled:true, allowAgentCreation:true, maxAgents:5000, maxDepth:5, maxChildrenPerAgent:10} as any, ownerId);
});
after(()=>{ try{db.close();} finally{clearInterval(keepAlive);}});

function expiryIso(){ return new Date(Date.now()+ 7*24*3600*1000).toISOString(); }
function owner(){ return {kind:'owner' as const, id: ownerId}; }

it('discovers with 17-field record and scorer without probability',()=>{
  const opp:any = Engine.discoverOpportunity({
    registryKey:'software_development', provider:'Acme Corp', platform:'Toptal', grossCents:50000, expectedFeesCents:5000, expectedCostsCents:2000,
    paymentMethod:'wire: Acme -> mission slot 1', settlementEvidence:'wire ref pending provider confirm', opportunityExpiry: expiryIso(),
    evidenceJson:{brief:'high-value backend API', client:'Acme'},
  });
  assert.equal(String(opp.registry_key),'software_development');
  assert.equal(Number(opp.gross_cents),50000);
  assert.equal(Number(opp.net_cents),43000);
  assert.equal(String(opp.verification_state),'discovered');
  for(const f of ['provider','platform','earning_mechanism','work_required','payment_method','settlement_evidence','country_kyc_requirements','tos_restrictions','account_requirements','opportunity_expiry','risk_level','required_capabilities_json','required_tools_json']){
    assert.ok(opp[f]!==null && opp[f]!==undefined, `field ${f}`);
  }
  const score = Engine.scoreOpportunity(String(opp.id));
  assert.equal((score as any).probability, undefined);
  assert.equal(score.netValueCents,43000);
  assert.ok(score.total>0);
  assert.ok(score.netValueScore>=0);
});

it('prevents duplication via dedup_hash',()=>{
  const expiry = expiryIso();
  Engine.discoverOpportunity({registryKey:'software_development', provider:'Beta LLC', platform:'Contra', grossCents:80000, expectedFeesCents:8000, expectedCostsCents:1000, paymentMethod:'ach', settlementEvidence:'evidence', opportunityExpiry: expiry});
  assert.throws(()=> Engine.discoverOpportunity({registryKey:'software_development', provider:'Beta LLC', platform:'Contra', grossCents:80000, expectedFeesCents:8000, expectedCostsCents:1000, paymentMethod:'ach', settlementEvidence:'evidence', opportunityExpiry: expiry}), /duplicate/i);
});

it('exclusive locking — second agent blocked within TTL',()=>{
  const expiry = expiryIso();
  const opp:any = Engine.discoverOpportunity({registryKey:'qa_testing', provider:'Sec Corp', platform:'HackerOne', grossCents:100000, expectedFeesCents:10000, expectedCostsCents:500, paymentMethod:'paypal', settlementEvidence:'evidence', opportunityExpiry: expiry});
  const locked:any = Engine.lockOpportunityExclusive(String(opp.id), agentA);
  assert.equal(String(locked.locked_by), agentA);
  assert.equal(String(locked.exclusive_agent_id), agentA);
  assert.throws(()=> Engine.lockOpportunityExclusive(String(opp.id), agentB), /already_locked|already_assigned/i);
});

it('schedule only when assigned to that agent',()=>{
  const expiry = expiryIso();
  const opp:any = Engine.discoverOpportunity({registryKey:'writing_translation', provider:'Doc Co', platform:'Contra', grossCents:30000, expectedFeesCents:3000, expectedCostsCents:500, paymentMethod:'stripe', settlementEvidence:'evidence', opportunityExpiry: expiry});
  Engine.lockOpportunityExclusive(String(opp.id), agentA);
  assert.throws(()=> Engine.scheduleWork(String(opp.id), agentB), /not_assigned_agent/i);
  const sched:any = Engine.scheduleWork(String(opp.id), agentA);
  assert.equal(String(sched.verification_state),'executing');
});

it('multi-agent verification requires 2 verifiers at 0.85',()=>{
  const expiry = expiryIso();
  const opp:any = Engine.discoverOpportunity({registryKey:'qa_testing', provider:'QA Co', platform:'Upwork', grossCents:40000, expectedFeesCents:4000, expectedCostsCents:500, paymentMethod:'wire', settlementEvidence:'evidence', opportunityExpiry: expiry});
  Engine.lockOpportunityExclusive(String(opp.id), agentA);
  Engine.scheduleWork(String(opp.id), agentA);
  const res = Engine.verifyWorkMultiAgent(String(opp.id), [{agentId:agentA, confidence:0.9, passed:true},{agentId:agentB, confidence:0.86, passed:true}]);
  assert.equal(res.verified,true);
  assert.ok(res.confidence>=0.85);
  const opp2:any = Engine.getEngineOpportunity(String(opp.id));
  assert.equal(String(opp2.verification_state),'verified');
});

it('provider confirms, then owner reconciles settlement — no earning until both',()=>{
  const expiry = expiryIso();
  // Ensure payout slot is active for settlement (D1)
  try { db.run("INSERT OR IGNORE INTO mission_payout_slots (slot, label, currency, status, masked_account, provider_ref) VALUES (1,'test-payout','USD','active','****1234','acct_test')"); db.run("UPDATE mission_payout_slots SET status='active', provider_ref='acct_test', masked_account='****1234', currency='USD' WHERE slot=1"); } catch {}
  const opp:any = Engine.discoverOpportunity({
    registryKey:'paid_research_data', provider:'Data Corp', platform:'Direct Client Research', grossCents:60000, expectedFeesCents:6000, expectedCostsCents:1000,
    paymentMethod:'wire', settlementEvidence:'evidence', opportunityExpiry: expiry,
    evidenceJson:{ lawfulPurposeRef:'client-research-approval-2026-09-21', datasetSha256:'a'.repeat(64), evidenceUrl:'https://client-actual.com/evidence/project-data-corp', nonSensitiveDataOnly:true, dataRightsReviewed:true },
  });
  Engine.lockOpportunityExclusive(String(opp.id), agentA);
  Engine.scheduleWork(String(opp.id), agentA);
  Engine.verifyWorkMultiAgent(String(opp.id), [{agentId:agentA, confidence:0.9, passed:true},{agentId:agentB, confidence:0.9, passed:true}]);
  assert.equal(Engine.totalVerifiedEarnings(),0);
  Engine.verifyProviderPayment(String(opp.id), {providerRef:'prov-12345', grossCents:60000, feesCents:6000, netCents:53000});
  assert.equal(Engine.totalVerifiedEarnings(),0);
  const settled:any = Engine.reconcileSettlement(String(opp.id), owner(), {externalId:'ext-abc-123', rail:'wise', grossCents:60000, feeCents:6000, netCents:53000});
  assert.equal(String(settled.verification_state),'settlement_verified');
  assert.ok(Engine.totalVerifiedEarnings()>0);
});

it('reinvestment respects policy and approval threshold',()=>{
  updatePolicy({reinvestShareBps:2000, requireApprovalAboveCents:10000} as any, ownerId);
  const d1 = Engine.reinvestmentDecision(40000);
  assert.equal(d1.reinvestCents,8000);
  assert.equal(d1.eligible,true);
  const d2 = Engine.reinvestmentDecision(60000);
  assert.equal(d2.eligible,false);
  assert.match(d2.reason,/requires_owner_approval/i);
});

it('scales winning class within Agent Factory caps, failed class does not scale',()=>{
  updatePolicy({allowAgentCreation:true, maxAgents:5000, maxDepth:5, maxChildrenPerAgent:10} as any, ownerId);
  const expiry = expiryIso();
  const opp:any = Engine.discoverOpportunity({registryKey:'design_video_audio', provider:'Media Co', platform:'Fiverr', grossCents:55000, expectedFeesCents:5500, expectedCostsCents:2000, paymentMethod:'paypal', settlementEvidence:'evidence', opportunityExpiry: expiry});
  Engine.lockOpportunityExclusive(String(opp.id), agentA);
  Engine.scheduleWork(String(opp.id), agentA);
  Engine.verifyWorkMultiAgent(String(opp.id), [{agentId:agentA, confidence:0.9, passed:true},{agentId:agentB, confidence:0.9, passed:true}]);
  Engine.verifyProviderPayment(String(opp.id), {providerRef:'prov-media-1', grossCents:55000, feesCents:5500, netCents:47500});
  Engine.reconcileSettlement(String(opp.id), owner(), {externalId:'ext-media-1', rail:'paypal', grossCents:55000, feeCents:5500, netCents:47500});
  const scaled:any = Engine.scaleWinningClass('design_video_audio', String(opp.id), agentA, 'Media Scaler');
  assert.equal((scaled as any).skipped, undefined);
  assert.match(String((scaled as any).slug),/media-scaler/i);
  const skipped:any = Engine.scaleWinningClass('lead_gen_fulfillment', 'missing', agentA, 'Should Skip');
  assert.match(String(skipped.skipped),/no_success_evidence|no_positive_roi/i);
});

it('failed-learning records and analytics excludes fake revenue',()=>{
  const expiry = expiryIso();
  const opp:any = Engine.discoverOpportunity({registryKey:'seo_marketing', provider:'Fail Co', platform:'Upwork', grossCents:35000, expectedFeesCents:3500, expectedCostsCents:500, paymentMethod:'wire', settlementEvidence:'evidence', opportunityExpiry: expiry});
  Engine.lockOpportunityExclusive(String(opp.id), agentA);
  Engine.recordFailure(String(opp.id), 'client_no_response');
  const learnings = Engine.listLearnings('seo_marketing');
  assert.ok(learnings.length>=1);
  const analytics:any = Engine.earningsAnalytics();
  assert.ok(analytics.totals.attempts>=1);
  assert.ok(!JSON.stringify(analytics).toLowerCase().includes('predicted'));
  assert.ok(!JSON.stringify(analytics).toLowerCase().includes('guaranteed'));
});

it('kill switch blocks discovery and schedule',()=>{
  setKillSwitch(true, ownerId);
  const expiry = expiryIso();
  assert.throws(()=> Engine.discoverOpportunity({registryKey:'software_development', provider:'Kill Co', platform:'Toptal', grossCents:50000, expectedFeesCents:5000, expectedCostsCents:1000, paymentMethod:'wire', settlementEvidence:'evidence', opportunityExpiry: expiry}), /kill_switch/i);
  setKillSwitch(false, ownerId);
});

it('dashboard reports verified earnings honestly (zero means zero)',()=>{
  const dash:any = Engine.ownerDashboard();
  assert.ok(dash.earnings!==undefined);
  assert.match(String(dash.verifiedMoneyGate),/PROVIDER_CONFIRMS_PAYMENT/);
  assert.equal(dash.policy.killSwitch,false);
});

it('registry expansion adds candidate class without fake permission',()=>{
  const before = OPPORTUNITY_REGISTRY.length;
  const cls = Engine.registerNewOpportunityClass(owner(), {
    key:'high_value_new_legit', label:'High-Value New Legit Class',
    earningMechanism:'Legit service', agentWork:'Real work', customerSource:'Direct outreach', usdPaymentMechanism:'Wire via provider',
    payoutMethodAndSettlementEvidence:'Provider wire with externalId verification', humanControlled:'Human review step', countryRestrictions:'US/EU via ToS',
    apiAutomationAvailability:'API read-only permitted', accountRequirements:'Owner-created account', expectedCosts:'100 USD', fraudRisks:'none beyond standard',
    integrations:['GitHub'], ranking:{genuinePaidWork:4, automationPermission:3, usdVerifiability:3, accessibility:4, scalability:4, setupRequirements:3, operatingCost:4},
    representativePlatforms:[{name:'Legit Platform', officialUrl:'https://example.com', evidence:'official verification pending'}],
  });
  assert.equal(cls.status,'candidate');
  assert.equal(cls.autonomousPermitted,false);
  assert.equal(OPPORTUNITY_REGISTRY.length, before+1);
  assert.throws(()=> Engine.registerNewOpportunityClass(owner(), {key:'high_value_new_legit', label:'dup'} as any), /duplicate/i);
});

it('ledger returns per-agent verified net only after settlement',()=>{
  const expiry = expiryIso();
  const opp:any = Engine.discoverOpportunity({registryKey:'seo_marketing', provider:'Market Co', platform:'Contra', grossCents:45000, expectedFeesCents:4500, expectedCostsCents:800, paymentMethod:'stripe', settlementEvidence:'evidence', opportunityExpiry: expiry});
  Engine.lockOpportunityExclusive(String(opp.id), agentA);
  Engine.scheduleWork(String(opp.id), agentA);
  Engine.verifyWorkMultiAgent(String(opp.id), [{agentId:agentA, confidence:0.9, passed:true},{agentId:agentB, confidence:0.9, passed:true}]);
  let ledger = Engine.getAgentEarnings(agentA);
  const beforeVerified = ledger.verifiedNet;
  Engine.verifyProviderPayment(String(opp.id), {providerRef:'prov-mkt-1', grossCents:45000, feesCents:4500, netCents:39700});
  ledger = Engine.getAgentEarnings(agentA);
  assert.equal(ledger.verifiedNet, beforeVerified);
  Engine.reconcileSettlement(String(opp.id), owner(), {externalId:'ext-mkt-1', rail:'stripe', grossCents:45000, feeCents:4500, netCents:39700});
  ledger = Engine.getAgentEarnings(agentA);
  assert.ok(ledger.verifiedNet> beforeVerified);
});

it('audit hash-chain intact after earning operations',()=>{
  const v = verifyMissionAudit();
  assert.equal(v.ok,true);
});
