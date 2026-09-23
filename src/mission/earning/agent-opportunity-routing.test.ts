import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `agent-routing-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'synthetic-agent-routing-tests-not-live';
import { before, after, it, describe } from 'node:test';
import assert from 'node:assert/strict';
const { applyMissionMigrations, missionDb: db } = require('../database') as typeof import('../database');
const { updatePolicy } = require('../policy') as typeof import('../policy');
const EarningEngine = require('./earning-engine') as typeof import('./earning-engine');
const PlatformDiscovery = require('./platform-discovery') as typeof import('./platform-discovery');
import * as money from '../money';

let ownerId: string;
let agentPK: string;
let agentUS: string;

const keepAlive = setInterval(() => {}, 1000);

before(() => {
  applyMissionMigrations();
  PlatformDiscovery.seedPlatforms();
  const { provisionOwner } = require('../auth') as typeof import('../auth');
  try {
    const o = provisionOwner({ email: `routing-${randomUUID()}@test.local`, password: 'StrongPass!123', displayName: 'Routing Owner' });
    ownerId = o.id ?? (o as { owner?: { id?: string } }).owner?.id;
  } catch {
    const r = db.get('SELECT id FROM mission_owner LIMIT 1');
    if (!r) throw new Error('no mission owner row');
    ownerId = String(r.id);
  }
  updatePolicy({ allowAgentCreation: true, maxAgents: 5000, autonomousEnabled: true }, ownerId);

  // Create two test agents
  agentPK = `agt-pk-${randomUUID().slice(0, 8)}`;
  agentUS = `agt-us-${randomUUID().slice(0, 8)}`;
  for (const id of [agentPK, agentUS]) {
    const caps = JSON.stringify(['software_development', 'ai_implementation', 'freelance', 'paid_research_data', 'GitHub', 'Docker', 'AWS', 'Tavily', 'Brave Search', 'Firecrawl']);
    db.run(
      "INSERT INTO mission_agents (id, slug, name, role_key, depth, generation, status, mission_role, origin_platform, capabilities) VALUES (?,?,?,'worker',0,'custom','active','agent','fixture',?)",
      [id, id, `Agent ${id}`, caps]
    );
    // Provision money grant
    try {
      money.setMoneyGrant({ kind: 'owner', id: ownerId }, id, {
        spendLimitCents: 100000,
        delegationCents: 0,
        canCreate: false,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        status: 'active',
      });
    } catch {}
  }
});

after(() => {
  try { db.close(); } finally { clearInterval(keepAlive); }
});

function expiryIso() { return new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(); }

describe('agent-opportunity routing', () => {
  it('rejects routing to non-existent agent', () => {
    const Routing = require('./agent-opportunity-routing') as typeof import('./agent-opportunity-routing');
    const opp = EarningEngine.discoverOpportunity({
      registryKey: 'paid_research_data',
      provider: 'Research Corp',
      platform: 'Direct Client Research',
      grossCents: 50000,
      expectedFeesCents: 5000,
      expectedCostsCents: 500,
      paymentMethod: 'wire',
      settlementEvidence: 'evidence',
      opportunityExpiry: expiryIso(),
      evidenceJson: {
        lawfulPurposeRef: 'LP-ROUTING-TEST-0001',
        datasetSha256: 'a'.repeat(64),
        evidenceUrl: 'https://evidence.routing-test.com/dataset/lp-routing0001',
        nonSensitiveDataOnly: true,
        dataRightsReviewed: true,
      },
    });

    const result = Routing.routeOpportunityToAgent('nonexistent-agent', String(opp.id), 'PK');
    assert.equal(result.eligible, false);
    assert.match(result.blockers.join(';'), /not found/i);
  });

  it('rejects routing to agent without money grant', () => {
    const Routing = require('./agent-opportunity-routing') as typeof import('./agent-opportunity-routing');
    const unprovisionedAgent = `agt-unprov-${randomUUID().slice(0, 8)}`;
    db.run(
      "INSERT INTO mission_agents (id, slug, name, role_key, depth, generation, status, mission_role, origin_platform, capabilities) VALUES (?,?,?,?,0,'custom','active','worker','fixture',?)",
      [unprovisionedAgent, unprovisionedAgent, 'Unprovisioned Agent', JSON.stringify(['software_development'])]
    );

    const opp = EarningEngine.discoverOpportunity({
      registryKey: 'paid_research_data',
      provider: 'Test Corp 2',
      platform: 'Direct Client Research',
      grossCents: 30000,
      expectedFeesCents: 3000,
      expectedCostsCents: 300,
      paymentMethod: 'wire',
      settlementEvidence: 'evidence',
      opportunityExpiry: expiryIso(),
      evidenceJson: {
        lawfulPurposeRef: 'LP-ROUTING-TEST-0002',
        datasetSha256: 'b'.repeat(64),
        evidenceUrl: 'https://evidence.routing-test.com/dataset/lp-routing0002',
        nonSensitiveDataOnly: true,
        dataRightsReviewed: true,
      },
    });

    const result = Routing.routeOpportunityToAgent(unprovisionedAgent, String(opp.id), 'PK');
    assert.equal(result.eligible, false);
    assert.match(result.blockers.join(';'), /not provisioned|no active money grant/i);
  });

  it('allows routing to provisioned agent for direct_client_research (location-agnostic)', () => {
    const Routing = require('./agent-opportunity-routing') as typeof import('./agent-opportunity-routing');
    const opp = EarningEngine.discoverOpportunity({
      registryKey: 'paid_research_data',
      provider: 'Direct Corp PK',
      platform: 'Direct Client Research',
      grossCents: 60000,
      expectedFeesCents: 6000,
      expectedCostsCents: 600,
      paymentMethod: 'wire',
      settlementEvidence: 'evidence',
      opportunityExpiry: expiryIso(),
      evidenceJson: {
        lawfulPurposeRef: 'LP-ROUTING-TEST-0003',
        datasetSha256: 'c'.repeat(64),
        evidenceUrl: 'https://evidence.routing-test.com/dataset/lp-routing0003',
        nonSensitiveDataOnly: true,
        dataRightsReviewed: true,
      },
    });

    const result = Routing.routeOpportunityToAgent(agentPK, String(opp.id), 'PK');
    // Direct research is location-agnostic, agent is provisioned and has matching skills
    assert.equal(result.countryEligible, true, 'Direct research should be country-eligible');
    assert.equal(result.skillsMatch, true, 'Agent should have matching skills');
  });

  it('findBestAgentsForOpportunity returns candidates sorted by score', () => {
    const Routing = require('./agent-opportunity-routing') as typeof import('./agent-opportunity-routing');
    const opp = EarningEngine.discoverOpportunity({
      registryKey: 'paid_research_data',
      provider: 'Direct Corp Batch',
      platform: 'Direct Client Research',
      grossCents: 45000,
      expectedFeesCents: 4500,
      expectedCostsCents: 450,
      paymentMethod: 'wire',
      settlementEvidence: 'evidence',
      opportunityExpiry: expiryIso(),
      evidenceJson: {
        lawfulPurposeRef: 'LP-ROUTING-TEST-0004',
        datasetSha256: 'd'.repeat(64),
        evidenceUrl: 'https://evidence.routing-test.com/dataset/lp-routing0004',
        nonSensitiveDataOnly: true,
        dataRightsReviewed: true,
      },
    });

    const result = Routing.findBestAgentsForOpportunity(String(opp.id), { ownerCountry: 'PK' });
    assert.ok(result.totalEvaluated >= 2, 'Should evaluate at least 2 agents');
    assert.ok(result.candidates.length > 0, 'Should have at least one candidate');
    // Candidates should be sorted by score descending
    for (let i = 1; i < result.candidates.length; i++) {
      assert.ok(result.candidates[i - 1].score >= result.candidates[i].score, 'Candidates should be sorted by score descending');
    }
  });

  it('batchRouteOpportunities processes multiple opportunities', () => {
    const Routing = require('./agent-opportunity-routing') as typeof import('./agent-opportunity-routing');
    const opp1 = EarningEngine.discoverOpportunity({
      registryKey: 'paid_research_data',
      provider: 'Direct Corp Batch1',
      platform: 'Direct Client Research',
      grossCents: 40000,
      expectedFeesCents: 4000,
      expectedCostsCents: 400,
      paymentMethod: 'wire',
      settlementEvidence: 'evidence',
      opportunityExpiry: expiryIso(),
      evidenceJson: {
        lawfulPurposeRef: 'LP-ROUTING-TEST-0005',
        datasetSha256: 'e'.repeat(64),
        evidenceUrl: 'https://evidence.routing-test.com/dataset/lp-routing0005',
        nonSensitiveDataOnly: true,
        dataRightsReviewed: true,
      },
    });
    const opp2 = EarningEngine.discoverOpportunity({
      registryKey: 'paid_research_data',
      provider: 'Direct Corp Batch2',
      platform: 'Direct Client Research',
      grossCents: 55000,
      expectedFeesCents: 5500,
      expectedCostsCents: 550,
      paymentMethod: 'wire',
      settlementEvidence: 'evidence',
      opportunityExpiry: expiryIso(),
      evidenceJson: {
        lawfulPurposeRef: 'LP-ROUTING-TEST-0006',
        datasetSha256: 'f'.repeat(64),
        evidenceUrl: 'https://evidence.routing-test.com/dataset/lp-routing0006',
        nonSensitiveDataOnly: true,
        dataRightsReviewed: true,
      },
    });

    const results = Routing.batchRouteOpportunities([String(opp1.id), String(opp2.id)], { ownerCountry: 'PK' });
    assert.equal(results.length, 2, 'Should return results for both opportunities');
    for (const r of results) {
      assert.ok(r.opportunityId, 'Should have opportunityId');
      assert.ok(typeof r.candidates === 'number', 'Should have candidate count');
    }
  });

  it('sanctioned country blocks all routing', () => {
    const Routing = require('./agent-opportunity-routing') as typeof import('./agent-opportunity-routing');
    const opp = EarningEngine.discoverOpportunity({
      registryKey: 'paid_research_data',
      provider: 'Direct Corp Sanctioned',
      platform: 'Direct Client Research',
      grossCents: 35000,
      expectedFeesCents: 3500,
      expectedCostsCents: 350,
      paymentMethod: 'wire',
      settlementEvidence: 'evidence',
      opportunityExpiry: expiryIso(),
      evidenceJson: {
        lawfulPurposeRef: 'LP-ROUTING-TEST-0007',
        datasetSha256: '1'.repeat(64),
        evidenceUrl: 'https://evidence.routing-test.com/dataset/lp-routing0007',
        nonSensitiveDataOnly: true,
        dataRightsReviewed: true,
      },
    });

    const result = Routing.routeOpportunityToAgent(agentPK, String(opp.id), 'IR');
    assert.equal(result.countryEligible, false, 'Sanctioned country should not be eligible');
    assert.match(result.blockers.join(';'), /sanction/i);
  });
});
