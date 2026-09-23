import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `ledger-isolation-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'synthetic-ledger-isolation-tests-not-live';
import { before, after, it, describe } from 'node:test';
import assert from 'node:assert/strict';

const { applyMissionMigrations, missionDb: missionDb } = require('../database') as typeof import('../database');
const { updatePolicy } = require('../policy') as typeof import('../policy');

let ownerId: string;
const keepAlive = setInterval(() => {}, 1000);

before(() => {
  applyMissionMigrations();
  const { provisionOwner } = require('../auth') as typeof import('../auth');
  try {
    const o = provisionOwner({ email: `isolation-${randomUUID()}@test.local`, password: 'StrongPass!123', displayName: 'Isolation Owner' });
    ownerId = o.id ?? (o as { owner?: { id?: string } }).owner?.id;
  } catch {
    const r = missionDb.get('SELECT id FROM mission_owner LIMIT 1');
    if (!r) throw new Error('no mission owner row');
    ownerId = String(r.id);
  }
  updatePolicy({ allowAgentCreation: true, maxAgents: 5000, autonomousEnabled: true }, ownerId);
});

after(() => {
  try { missionDb.close(); } finally { clearInterval(keepAlive); }
});

describe('ledger isolation — mission vs platform money', () => {
  it('mission database is separate from platform database', () => {
    // missionDb should not have access to platform tables
    const platformTables = missionDb.all("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','credit_accounts','subscriptions','invoices','billing_events')");
    assert.equal(platformTables.length, 0, 'Mission DB should not contain platform billing tables');
  });

  it('mission earning engine does not import from platform db', () => {
    // This is a structural test — verify the earning engine only uses missionDb
    const fs = require('fs');
    const enginePath = require('path').join(__dirname, 'earning-engine.ts');
    const engineCode = fs.readFileSync(enginePath, 'utf8');

    // Should NOT import from platform db
    assert.ok(!engineCode.includes("from '../db'"), 'Earning engine should not import from platform db');
    assert.ok(!engineCode.includes("from '../../db'"), 'Earning engine should not import from platform db');
    // Should use missionDb
    assert.ok(engineCode.includes('missionDb'), 'Earning engine should use missionDb');
  });

  it('treasury does not import from platform db', () => {
    const fs = require('fs');
    const treasuryPath = require('path').join(__dirname, '..', 'treasury.ts');
    const treasuryCode = fs.readFileSync(treasuryPath, 'utf8');

    assert.ok(!treasuryCode.includes("from '../db'"), 'Treasury should not import from platform db');
    assert.ok(treasuryCode.includes('missionDb'), 'Treasury should use missionDb');
  });

  it('money module does not import from platform db', () => {
    const fs = require('fs');
    const moneyPath = require('path').join(__dirname, '..', 'money.ts');
    const moneyCode = fs.readFileSync(moneyPath, 'utf8');

    assert.ok(!moneyCode.includes("from '../db'"), 'Money module should not import from platform db');
  });

  it('owner analytics marks mission revenue as excluded from platform', () => {
    const fs = require('fs');
    const analyticsPath = require('path').join(__dirname, '..', '..', 'business', 'owner-analytics.ts');
    const analyticsCode = fs.readFileSync(analyticsPath, 'utf8');

    assert.ok(analyticsCode.includes('missionRevenue'), 'Owner analytics should reference mission revenue');
    assert.ok(analyticsCode.includes('excluded'), 'Owner analytics should mark mission revenue as excluded');
  });

  it('settlement verification does not fabricate payments', () => {
    const Settlement = require('./settlement-verification') as typeof import('./settlement-verification');
    const EarningEngine = require('./earning-engine') as typeof import('./earning-engine');

    // Create a valid opportunity
    const opp = EarningEngine.discoverOpportunity({
      registryKey: 'paid_research_data',
      provider: 'Isolation Test Corp',
      platform: 'Direct Client Research',
      grossCents: 70000,
      expectedFeesCents: 7000,
      expectedCostsCents: 700,
      paymentMethod: 'wire',
      settlementEvidence: 'evidence',
      opportunityExpiry: new Date(Date.now() + 7 * 86400000).toISOString(),
      evidenceJson: {
        lawfulPurposeRef: 'LP-ISOLATION-TEST-0001',
        datasetSha256: 'a'.repeat(64),
        evidenceUrl: 'https://evidence.isolation-test.com/dataset/lp-isolation0001',
        nonSensitiveDataOnly: true,
        dataRightsReviewed: true,
      },
    });

    // Attempt settlement with synthetic externalId — should fail
    // First it will fail because state is 'discovered' not 'verified' — that's correct behavior
    assert.throws(
      () => Settlement.verifySettlementAgainstProvider({
        opportunityId: String(opp.id),
        rail: 'bank',
        externalId: 'synthetic-fake-id',
        grossCents: 70000,
        feeCents: 7000,
        netCents: 62300,
        actor: { kind: 'owner', id: ownerId },
      }),
      /synthetic|invalid|not_verified/i,
      'Synthetic external IDs or unverified opportunities should be rejected'
    );
  });

  it('settlement requires supported rail', () => {
    const Settlement = require('./settlement-verification') as typeof import('./settlement-verification');
    const EarningEngine = require('./earning-engine') as typeof import('./earning-engine');

    const opp = EarningEngine.discoverOpportunity({
      registryKey: 'paid_research_data',
      provider: 'Rail Test Corp',
      platform: 'Direct Client Research',
      grossCents: 50000,
      expectedFeesCents: 5000,
      expectedCostsCents: 500,
      paymentMethod: 'wire',
      settlementEvidence: 'evidence',
      opportunityExpiry: new Date(Date.now() + 7 * 86400000).toISOString(),
      evidenceJson: {
        lawfulPurposeRef: 'LP-ISOLATION-TEST-0002',
        datasetSha256: 'b'.repeat(64),
        evidenceUrl: 'https://evidence.isolation-test.com/dataset/lp-isolation0002',
        nonSensitiveDataOnly: true,
        dataRightsReviewed: true,
      },
    });

    assert.throws(
      () => Settlement.verifySettlementAgainstProvider({
        opportunityId: String(opp.id),
        rail: 'crypto',
        externalId: 'ext-test-1234',
        grossCents: 50000,
        feeCents: 5000,
        netCents: 44500,
        actor: { kind: 'owner', id: ownerId },
      }),
      /unsupported_rail/i,
      'Unsupported rail should be rejected'
    );
  });

  it('only verified earnings enter totalVerifiedEarnings', () => {
    const EarningEngine = require('./earning-engine') as typeof import('./earning-engine');
    // Before any real verified earnings, total should be 0
    assert.equal(EarningEngine.totalVerifiedEarnings(), 0, 'No verified earnings should exist');
  });

  it('opportunity scores/estimates are never counted as revenue', () => {
    const EarningEngine = require('./earning-engine') as typeof import('./earning-engine');

    // Discover a high-value opportunity
    EarningEngine.discoverOpportunity({
      registryKey: 'software_development',
      provider: 'Score Test Corp',
      platform: 'Toptal',
      grossCents: 500000, // $5000
      expectedFeesCents: 50000,
      expectedCostsCents: 5000,
      paymentMethod: 'wire',
      settlementEvidence: 'evidence',
      opportunityExpiry: new Date(Date.now() + 7 * 86400000).toISOString(),
    });

    // The opportunity's gross/net are ESTIMATES, not revenue
    // totalVerifiedEarnings should still be 0 since no settlement occurred
    assert.equal(EarningEngine.totalVerifiedEarnings(), 0, 'Discovered opportunities should not count as verified earnings');
  });
});
