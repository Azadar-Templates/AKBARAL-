import {randomUUID} from 'node:crypto';
import path from 'node:path'; import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL=process.env.PG_TEST_DATABASE_URL||`file:${path.join(os.tmpdir(),`registry-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET='synthetic-registry-tests-not-live';
import {before, beforeEach, after, it} from 'node:test'; import assert from 'node:assert/strict';
import {missionDb, applyMissionMigrations} from '../database';
import * as money from '../money';
import {updatePolicy, setKillSwitch} from '../policy';
import {OPPORTUNITY_REGISTRY, rankedOpportunities, permittedAutonomousClasses, infrastructureFor} from './opportunity-registry';
import {autonomousDiscover, discoveryRankingSnapshot, pursuitInfrastructureStatus, canAssignExclusively, servicesForClass} from './autonomous-discovery';
import {OpportunityDiscovery, type InboundOpportunityInput} from './opportunity-discovery';

const owner={kind:'owner' as const, id:'registry-owner'}, agent='registry-agent', other='registry-other';
const keepAlive=setInterval(()=>{},1000);
before(()=>{
  applyMissionMigrations();
  missionDb.run("INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,'fixture-registry@example.test','fixture','owner','active')",[owner.id]);
  for(const id of [agent, other]) missionDb.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES (?,?,'Synthetic fixture','specialist',0,'custom','active','worker','fixture')",[id,id]);
});
beforeEach(()=>{
  setKillSwitch(false, owner.id);
  for(const t of ['mission_discovery_opportunities','mission_customer_requests','mission_customer_events','mission_customer_suppressions','mission_audit']) try{missionDb.run(`DELETE FROM ${t}`);}catch{}
  updatePolicy({currency:'USD', killSwitch:false, autonomousEnabled:true, maxDailySpendCents:100000, maxExpenseCents:10000, requireApprovalAboveCents:5000} as any, owner.id);
  for(const id of [agent, other]) money.setMoneyGrant(owner, id, {spendLimitCents:0,delegationCents:0,canCreate:false,expiresAt:new Date(Date.now()+86400000).toISOString(), status:'active'});
});
after(()=>{ try{missionDb.close();} finally{clearInterval(keepAlive);}});

it('registry is comprehensive, every entry has 14 factual fields, no income guarantee',()=>{
  assert.ok(OPPORTUNITY_REGISTRY.length >= 21, `registry ${OPPORTUNITY_REGISTRY.length} < 21`);
  for(const o of OPPORTUNITY_REGISTRY){
    assert.ok(o.key && o.label);
    assert.ok(o.earningMechanism.length>20);
    assert.ok(o.agentWork.length>20);
    assert.ok(o.customerSource.length>10);
    assert.ok(o.usdPaymentMechanism.length>10);
    assert.ok(o.payoutMethodAndSettlementEvidence.length>20);
    assert.equal(typeof o.autonomousPermitted,'boolean');
    assert.ok(o.autonomousNote.length>10);
    assert.ok(o.humanControlled.length>10);
    assert.ok(o.countryRestrictions.length>5);
    assert.ok(o.apiAutomationAvailability.length>10);
    assert.ok(o.accountRequirements.length>10);
    assert.ok(o.expectedCosts.length>5);
    assert.ok(o.fraudRisks.length>10);
    assert.equal(typeof o.exclusivelyAssignable,'boolean');
    assert.equal(typeof o.paymentVerifiable,'boolean');
    assert.ok(['verified','candidate','restricted'].includes(o.status));
    assert.ok(Array.isArray(o.integrations) && o.integrations.length>=1);
    assert.ok(o.ranking.genuinePaidWork>=1 && o.ranking.genuinePaidWork<=5);
    assert.ok(o.overallScore>=1 && o.overallScore<=5);
    assert.ok(Array.isArray(o.representativePlatforms) && o.representativePlatforms.length>=1);
    for(const p of o.representativePlatforms){
      assert.ok(p.name && p.officialUrl.startsWith('https://'));
      assert.ok(p.evidence.length>10);
    }
    // No platform integration as earning claim — integrations are infrastructure subset
    assert.ok(!o.earningMechanism.toLowerCase().includes('integration is earning'), 'must not claim integration as earning');
  }
  // No listing is a job — registry describes mechanisms, not vacancies
  assert.ok(!OPPORTUNITY_REGISTRY.some(o=> o.earningMechanism.toLowerCase().includes('guaranteed income')));
});

it('ranking is factual: top is paid_research_data / software_development, not microtasks',()=>{
  const ranked = rankedOpportunities();
  assert.equal(ranked[0].key, 'paid_research_data');
  assert.equal(ranked[0].overallScore, 4.7);
  assert.equal(ranked[1].key, 'software_development');
  assert.equal(ranked[1].overallScore, 4.6);
  // microtasks should be near bottom and not permitted
  const micro = OPPORTUNITY_REGISTRY.find(o=>o.key==='microtasks_labeling')!;
  assert.equal(micro.autonomousPermitted,false);
  assert.equal(micro.status,'restricted');
  const scores = ranked.map(o=>o.overallScore);
  const sorted = [...scores].sort((a,b)=>b-a);
  assert.deepEqual(scores, sorted);
});

it('permitted autonomous classes require paymentVerifiable and service mapping',()=>{
  const permitted = permittedAutonomousClasses();
  // after legitimate expansion (ai_implementation, automation_services, consulting_advisory) permitted grows from 7 to ~10
  assert.ok(permitted.length >= 5 && permitted.length <= 12, `permitted ${permitted.length} out of 5-12`);
  for(const o of permitted){
    assert.equal(o.autonomousPermitted,true);
    assert.equal(o.paymentVerifiable,true);
    assert.notEqual(o.status,'restricted');
  }
  // services mapping exists for these
  for(const o of permitted){
    const svcs = servicesForClass(o.key);
    if(['paid_research_data','software_development','qa_testing','writing_translation','seo_marketing','bug_bounties','contests_challenges'].includes(o.key)){
      assert.ok(svcs.length>0, `${o.key} should map to service`);
    }
  }
  // freelance_client_work is NOT autonomous (owner must publish)
  assert.equal(OPPORTUNITY_REGISTRY.find(o=>o.key==='freelance_client_work')!.autonomousPermitted,false);
});

it('infrastructure mapping uses 94+ integrations as tools, not claims',()=>{
  const infra = pursuitInfrastructureStatus();
  assert.equal(infra.totalClasses, OPPORTUNITY_REGISTRY.length);
  assert.ok(infra.permittedAutonomousCount >=5);
  assert.ok(infra.verifiedMoneyGate.includes('payout-verification'));
  assert.ok(infra.humanControlled.includes('owner-only'));
  assert.ok(infra.integrationsAsInfrastructure.includes('94+'));
  // check one key
  const sw = infrastructureFor('software_development');
  assert.ok(sw.includes('GitHub'));
  assert.ok(sw.includes('Docker'));
});

it('autonomousDiscover filters to permitted service-mapped classes only',()=>{
  const disc = new OpportunityDiscovery();
  const base = ():InboundOpportunityInput=> ({
    serviceId:'json-validation', brief:'Synthetic research task — not real customer', configuration:{required:['id'],uniqueKey:'id'}, quoteCents:400,
    customerRef:`c-${randomUUID().slice(0,6)}@example.test`, sourceRef:`src-${randomUUID()}`, observedAt:new Date().toISOString(), consentExpiresAt:new Date(Date.now()+3600000).toISOString(),
    provider:'direct', explicitRequestReviewed:true, contactPermissionReviewed:true, lawfulPurposeReviewed:true, dataRightsReviewed:true, nonSensitiveDataOnly:true, automationPermissionReviewed:true
  });
  const opp1 = disc.ingestInbound({...base(), serviceId:'json-validation'}) as any;
  const opp2 = disc.ingestInbound({...base(), serviceId:'html-release-check', configuration: null, brief:'Synthetic html check'}) as any;
  // Agent autonomous discover should see both (both map to permitted classes)
  const agentRes: any = autonomousDiscover({kind:'agent', id: agent}, 20);
  assert.ok(agentRes.qualifyingCount >=1);
  assert.ok(agentRes.permittedKeys.includes('paid_research_data') || agentRes.permittedKeys.includes('software_development'));
  assert.equal(agentRes.permitted,true);
  // Should not fabricate revenue
  assert.ok(!agentRes.opportunities.some((o:any)=> o.revenue));
  // Owner sees ranking
  const ownerRes: any = autonomousDiscover(owner, 5);
  assert.ok(ownerRes.ranking.length>=3);
  assert.ok(ownerRes.ranking[0].overallScore >= ownerRes.ranking[1].overallScore);
});

it('canAssignExclusively enforces one-agent exclusive and qualified state',()=>{
  const disc = new OpportunityDiscovery();
  const input: InboundOpportunityInput = {
    serviceId:'json-validation', brief:'Exclusive assignment test', configuration:{required:['id'],uniqueKey:'id'}, quoteCents:400,
    customerRef:`ex-${randomUUID().slice(0,6)}@example.test`, sourceRef:`ex-${randomUUID()}`, observedAt:new Date().toISOString(), consentExpiresAt:new Date(Date.now()+3600000).toISOString(),
    provider:'direct', explicitRequestReviewed:true, contactPermissionReviewed:true, lawfulPurposeReviewed:true, dataRightsReviewed:true, nonSensitiveDataOnly:true, automationPermissionReviewed:true
  };
  const opp = disc.ingestInbound(input) as any;
  // Not qualified yet
  assert.equal(canAssignExclusively(opp.id).ok,false);
  disc.qualify(owner, opp.id);
  assert.equal(canAssignExclusively(opp.id).ok,true);
  // After promote, not assignable again
  disc.promote(owner, opp.id);
  assert.equal(canAssignExclusively(opp.id).ok,false);
  assert.match(canAssignExclusively(opp.id).reason ?? '', /already_promoted|not_qualified/);
  // Verify exclusive: second promote throws duplicate
  const opp2 = disc.ingestInbound({...input, sourceRef:`ex2-${randomUUID()}`, customerRef:`ex2-${randomUUID().slice(0,6)}@example.test`}) as any;
  disc.qualify(owner, opp2.id);
  const req = disc.promote(owner, opp2.id);
  assert.ok(req.id);
  assert.throws(()=> disc.promote(owner, opp2.id), /duplicate|not_qualified/);
});

it('discovery ranking snapshot is factual, no guaranteed income',()=>{
  const snap = discoveryRankingSnapshot(3);
  assert.equal(snap.length,3);
  assert.equal(snap[0].key,'paid_research_data');
  assert.ok(!JSON.stringify(snap).toLowerCase().includes('guaranteed'));
  assert.ok(snap.every((s:any)=> s.overallScore && s.status));
});
