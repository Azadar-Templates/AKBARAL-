import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = `file:${path.join(os.tmpdir(), `mission-eligibility-${randomUUID()}.db`)}`;
import { before, after, it, describe } from 'node:test';
import assert from 'node:assert/strict';
const { applyMissionMigrations } = require('../database') as typeof import('../database');
const { currentPolicy, updatePolicy } = require('../policy') as typeof import('../policy');
const Eligibility = require('./opportunity-eligibility') as typeof import('./opportunity-eligibility');
const EarningEngine = require('./earning-engine') as typeof import('./earning-engine');
const PlatformDiscovery = require('./platform-discovery') as typeof import('./platform-discovery');

let ownerId: string;
before(()=> {
  applyMissionMigrations();
  PlatformDiscovery.seedPlatforms();
  const { provisionOwner } = require('../auth') as typeof import('../auth');
  try { const o = provisionOwner({email:`elig-${randomUUID()}@test.local`, password:'StrongPass!123', displayName:'Elig'}); ownerId = o.id ?? o.owner?.id; } catch { const { missionDb } = require('../database'); const r = missionDb.get('SELECT id FROM mission_owner LIMIT 1'); ownerId = String(r.id); }
  updatePolicy({allowAgentCreation:true, maxAgents:5000}, ownerId);
});
after(()=> { const { missionDb } = require('../database') as typeof import('../database'); missionDb.close(); });

function expiryIso(){ return new Date(Date.now()+ 7*24*3600*1000).toISOString(); }

describe('opportunity eligibility + activation gating', ()=> {
  it('direct_client_research is eligible (no account required)', ()=> {
    const dec = Eligibility.eligibilityDecision('paid_research_data', 'direct_client_research') as any;
    // payout slot not yet active is only soft blocker — still eligible for assignment
    assert.equal(dec.eligible, true);
    assert.equal(dec.autonomousPermitted, true);
  });
  it('restricted class is blocked and requires owner action', ()=> {
    // lead_gen_fulfillment is restricted
    const dec = Eligibility.eligibilityDecision('lead_gen_fulfillment', 'upwork') as any;
    assert.equal(dec.eligible, false);
    assert.match(String(dec.blockers.join(';')), /restricted/);
  });
  it('human-only platform not eligible without permit', ()=> {
    const plat = PlatformDiscovery.discoverPlatform({id:'eligibility-test-human', label:'Elig Human Store', kind:'RESTRICTED_HUMAN_ONLY', officialUrl:'https://example.com/shop', evidence:'Official payout verified shopify store payout', payoutVerifiable:true, apiPermitted:false, humanOnlyActions:['store ownership/KYC']}) as any;
    void plat;
    const dec = Eligibility.eligibilityDecision('consulting_advisory', 'eligibility-test-human') as any;
    assert.equal(dec.eligible, false);
    assert.match(String(dec.blockers.join(';')), /PERMITTED|RESTRICTED|human/i);
  });
  it('kill switch blocks eligibility', ()=> {
    const { setKillSwitch } = require('../policy') as typeof import('../policy');
    setKillSwitch(true, ownerId);
    const dec = Eligibility.eligibilityDecision('paid_research_data', 'direct_client_research') as any;
    assert.equal(dec.eligible, false);
    assert.match(dec.reason, /kill_switch/);
    setKillSwitch(false, ownerId);
  });
  it('listEligible filters an inserted opportunity', ()=> {
    const opp:any = EarningEngine.discoverOpportunity({registryKey:'paid_research_data', provider:'Elig Corp', platform:'Direct Client Research', grossCents:50000, expectedFeesCents:5000, expectedCostsCents:500, paymentMethod:'wire', settlementEvidence:'evidence', opportunityExpiry: expiryIso()});
    const { eligible, blocked } = Eligibility.listEligibleOpportunities(20) as any;
    // Our opp is paid_research_data + direct_client_research → should be eligible
    const found = eligible.some((r:any)=> String(r.id)===String(opp.id));
    assert.equal(found, true);
    void blocked;
  });
  it('canAssignExclusivelyWithGate respects humanOnly', ()=> {
    const opp:any = EarningEngine.discoverOpportunity({registryKey:'lead_gen_fulfillment', provider:'Blocked Lead', platform:'Upwork', grossCents:40000, expectedFeesCents:4000, expectedCostsCents:500, paymentMethod:'paypal', settlementEvidence:'evidence', opportunityExpiry: expiryIso()});
    const res = Eligibility.canAssignExclusivelyWithGate(String(opp.id)) as any;
    assert.equal(res.assignable, false);
  });
});
