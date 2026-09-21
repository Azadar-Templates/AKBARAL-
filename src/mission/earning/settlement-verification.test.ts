import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = `file:${path.join(os.tmpdir(), `mission-settle-${randomUUID()}.db`)}`;
import { before, after, it, describe } from 'node:test';
import assert from 'node:assert/strict';
const { applyMissionMigrations, missionDb } = require('../database') as typeof import('../database');
const EarningEngine = require('./earning-engine') as typeof import('./earning-engine');
const SettlementVerify = require('./settlement-verification') as typeof import('./settlement-verification');

let owner:any, ownerId:string, agentA:string, agentB:string;
function expiryIso(){ return new Date(Date.now()+ 7*24*3600*1000).toISOString(); }

before(()=> {
  applyMissionMigrations();
  const { provisionOwner } = require('../auth') as typeof import('../auth');
  const { updatePolicy } = require('../policy') as typeof import('../policy');
  try { const o = provisionOwner({email:`settle-${randomUUID()}@test.local`, password:'StrongPass!123', displayName:'Settle'}); owner = o; ownerId = o.id ?? o.owner?.id; } catch { const r = missionDb.get('SELECT id FROM mission_owner LIMIT 1'); ownerId = String(r.id); owner = {id:ownerId}; }
  updatePolicy({allowAgentCreation:true, maxAgents:5000}, ownerId);
  // ensure 2 agents
  const idA = `agt_settle_a_${randomUUID().slice(0,6)}`; const idB = `agt_settle_b_${randomUUID().slice(0,6)}`;
  missionDb.run("INSERT OR IGNORE INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,?,0,'custom','active','worker','mission','[]')", [idA, `settle-a-${idA.slice(-4)}`, 'Settle A','specialist']);
  missionDb.run("INSERT OR IGNORE INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,?,0,'custom','active','worker','mission','[]')", [idB, `settle-b-${idB.slice(-4)}`, 'Settle B','specialist']);
  const { setMoneyGrant } = require('../money') as typeof import('../money');
  for (const id of [idA, idB]) {
    try { setMoneyGrant({kind:'owner', id: ownerId} as any, id, {spendLimitCents:100000, delegationCents:0, canCreate:false, expiresAt:new Date(Date.now()+86400000).toISOString(), status:'active'}); } catch {}
  }
  agentA = idA; agentB = idB;
  // minimal treasury wallet + payout slot active for settlement detail flag
  const { createWallet, configurePayoutSlot } = require('../treasury') as typeof import('../treasury');
  const { confirmPayoutVerification, PAYOUT_VERIFICATION_CHECKS } = require('../payout-verification') as typeof import('../payout-verification');
  try { createWallet({kind:'mission', label:'t-settle-treasury', currency:'USD'}); } catch {}
  try { configurePayoutSlot({slot:1, providerRef:`acct_settle_${randomUUID().slice(0,8)}`, minPayoutCents:0, maxPayoutCents:100000, currency:'USD', actorId:ownerId}); confirmPayoutVerification({slot:1, ownerId, checks: Object.fromEntries(PAYOUT_VERIFICATION_CHECKS.map((c:any)=> [c.key, true])), attestation:'Synthetic attestation for settlement verification test only — no real destination.'}); } catch {}
});

after(()=> missionDb.close());

describe('independent USD settlement verification', ()=> {
  it('requires owner, rail, externalId and verified state', ()=> {
    const opp:any = EarningEngine.discoverOpportunity({registryKey:'paid_research_data', provider:'Settle Corp', platform:'Direct Client Research', grossCents:60000, expectedFeesCents:6000, expectedCostsCents:1000, paymentMethod:'wise', settlementEvidence:'evidence', opportunityExpiry: expiryIso(), evidenceJson:{ lawfulPurposeRef:'client-research-approval-2026-09-21-settle1', datasetSha256:'a'.repeat(64), evidenceUrl:'https://client-actual.com/evidence/settle-corp', nonSensitiveDataOnly:true, dataRightsReviewed:true }});
    assert.throws(()=> SettlementVerify.verifySettlementAgainstProvider({opportunityId:String(opp.id), rail:'wise', externalId:'ext-1', grossCents:60000, feeCents:6000, netCents:53000, actor:{kind:'owner', id:ownerId}}), /not_verified_state/);
  });

  it('verifies independently and is idempotent per opp+rail+externalId', ()=> {
    const opp:any = EarningEngine.discoverOpportunity({registryKey:'paid_research_data', provider:'Settle2', platform:'Direct Client Research', grossCents:55000, expectedFeesCents:5500, expectedCostsCents:800, paymentMethod:'stripe', settlementEvidence:'evidence', opportunityExpiry: expiryIso(), evidenceJson:{ lawfulPurposeRef:'client-research-approval-2026-09-21-settle2', datasetSha256:'b'.repeat(64), evidenceUrl:'https://client-actual.com/evidence/settle2', nonSensitiveDataOnly:true, dataRightsReviewed:true }});
    EarningEngine.lockOpportunityExclusive(String(opp.id), agentA);
    EarningEngine.scheduleWork(String(opp.id), agentA);
    EarningEngine.verifyWorkMultiAgent(String(opp.id), [{agentId:agentA, confidence:0.91, passed:true},{agentId:agentB, confidence:0.91, passed:true}]);
    EarningEngine.verifyProviderPayment(String(opp.id), {providerRef:'prov-settle-1', grossCents:55000, feesCents:5500, netCents:48700});
    const r1 = SettlementVerify.verifySettlementAgainstProvider({opportunityId:String(opp.id), rail:'stripe', externalId:'ext-stripe-'+randomUUID().slice(0,8), providerRef:'prov-settle-1', grossCents:55000, feeCents:5500, netCents:48700, actor:{kind:'owner', id:ownerId}}) as any;
    assert.equal(r1.verified, true);
    assert.ok(r1.settlementId);
    // Idempotent replay returns same id
    const r2 = SettlementVerify.verifySettlementAgainstProvider({opportunityId:String(opp.id), rail:'stripe', externalId: r1.externalId, providerRef:'prov-settle-1', grossCents:55000, feeCents:5500, netCents:48700, actor:{kind:'owner', id:ownerId}}) as any;
    assert.equal(r2.settlementId, r1.settlementId);
  });

  it('rejects unsupported rail and synthetic without providerRef', ()=> {
    const opp:any = EarningEngine.discoverOpportunity({registryKey:'paid_research_data', provider:'Settle3', platform:'Direct Client Research', grossCents:50000, expectedFeesCents:5000, expectedCostsCents:500, paymentMethod:'wise', settlementEvidence:'evidence', opportunityExpiry: expiryIso(), evidenceJson:{ lawfulPurposeRef:'client-research-approval-2026-09-21-settle3', datasetSha256:'c'.repeat(64), evidenceUrl:'https://client-actual.com/evidence/settle3', nonSensitiveDataOnly:true, dataRightsReviewed:true }});
    EarningEngine.lockOpportunityExclusive(String(opp.id), agentA);
    EarningEngine.scheduleWork(String(opp.id), agentA);
    EarningEngine.verifyWorkMultiAgent(String(opp.id), [{agentId:agentA, confidence:0.9, passed:true},{agentId:agentB, confidence:0.9, passed:true}]);
    EarningEngine.verifyProviderPayment(String(opp.id), {providerRef:'prov-settle-3', grossCents:50000, feesCents:5000, netCents:44500});
    assert.throws(()=> SettlementVerify.verifySettlementAgainstProvider({opportunityId:String(opp.id), rail:'fake_rail', externalId:'ext-1', grossCents:50000, feeCents:5000, netCents:44500, actor:{kind:'owner', id:ownerId}}), /unsupported_rail/);
    // synthetic-like externalId without providerRef when opportunity still in payment_confirmed
    assert.throws(()=> SettlementVerify.verifySettlementAgainstProvider({opportunityId:String(opp.id), rail:'wise', externalId:'test-synthetic-fake', grossCents:50000, feeCents:5000, netCents:44500, actor:{kind:'owner', id:ownerId}}), /synthetic_id_requires_provider_ref/);
  });

  it('settlementIsIndependentlyVerified helper', ()=> {
    const opp:any = EarningEngine.discoverOpportunity({registryKey:'paid_research_data', provider:'Settle4', platform:'Direct Client Research', grossCents:40000, expectedFeesCents:4000, expectedCostsCents:500, paymentMethod:'paypal', settlementEvidence:'evidence', opportunityExpiry: expiryIso(), evidenceJson:{ lawfulPurposeRef:'client-research-approval-2026-09-21-settle4', datasetSha256:'d'.repeat(64), evidenceUrl:'https://client-actual.com/evidence/settle4', nonSensitiveDataOnly:true, dataRightsReviewed:true }});
    assert.equal(SettlementVerify.settlementIsIndependentlyVerified(String(opp.id)), false);
    EarningEngine.lockOpportunityExclusive(String(opp.id), agentA);
    EarningEngine.scheduleWork(String(opp.id), agentA);
    EarningEngine.verifyWorkMultiAgent(String(opp.id), [{agentId:agentA, confidence:0.9, passed:true},{agentId:agentB, confidence:0.9, passed:true}]);
    EarningEngine.verifyProviderPayment(String(opp.id), {providerRef:'prov-settle-4', grossCents:40000, feesCents:4000, netCents:35500});
    SettlementVerify.verifySettlementAgainstProvider({opportunityId:String(opp.id), rail:'paypal', externalId:'ext-paypal-'+randomUUID().slice(0,6), grossCents:40000, feeCents:4000, netCents:35500, actor:{kind:'owner', id:ownerId}});
    assert.equal(SettlementVerify.settlementIsIndependentlyVerified(String(opp.id)), true);
  });

  it('never credits ledger without verification — totalVerified stays 0 until settlement', ()=> {
    const before = EarningEngine.totalVerifiedEarnings();
    const opp:any = EarningEngine.discoverOpportunity({registryKey:'paid_research_data', provider:'Settle5', platform:'Direct Client Research', grossCents:30000, expectedFeesCents:3000, expectedCostsCents:300, paymentMethod:'wise', settlementEvidence:'evidence', opportunityExpiry: expiryIso(), evidenceJson:{ lawfulPurposeRef:'client-research-approval-2026-09-21-settle5', datasetSha256:'e'.repeat(64), evidenceUrl:'https://client-actual.com/evidence/settle5', nonSensitiveDataOnly:true, dataRightsReviewed:true }});
    EarningEngine.lockOpportunityExclusive(String(opp.id), agentA);
    EarningEngine.scheduleWork(String(opp.id), agentA);
    EarningEngine.verifyWorkMultiAgent(String(opp.id), [{agentId:agentA, confidence:0.9, passed:true},{agentId:agentB, confidence:0.9, passed:true}]);
    assert.equal(EarningEngine.totalVerifiedEarnings(), before);
    EarningEngine.verifyProviderPayment(String(opp.id), {providerRef:'prov-settle-5', grossCents:30000, feesCents:3000, netCents:26700});
    assert.equal(EarningEngine.totalVerifiedEarnings(), before);
  });
});
