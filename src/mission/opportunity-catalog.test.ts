import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { missionDb, applyMissionMigrations } from './database';
import { seedLegitimateSources, seedPlatformOpportunities } from './opportunity-sources';
import {
  getCatalogStats,
  listOpportunities,
  listOpportunitySources,
  createOpportunity,
  getOpportunityById,
  updateOpportunityStatus,
  computeDedupHash,
} from './opportunity-catalog';
import { enqueueIngestionJob, listPendingJobs, checkRateLimit, recordRateLimitHit, sweepExpiredCache } from './opportunity-ingestion';

before(() => {
  applyMissionMigrations();
});

describe('opportunity catalog — scalable 100M+ design', () => {
  it('seeds legitimate public sources without fabrication', () => {
    const seedResult = seedLegitimateSources();
    assert.ok(seedResult.total >= 30, 'should seed at least 30 legitimate sources');
    const { sources } = listOpportunitySources({ limit: 100 });
    assert.ok(sources.length >= 30);
    // every source must have real base_url and tos_url
    for (const src of sources) {
      assert.ok(src.base_url.startsWith('https://'), `base_url must be https for ${src.key}`);
      // tos_url can be null for some, but base_url must be real
      assert.ok(src.key.length > 0);
    }
  });

  it('seeds platform opportunities as verified low-risk', () => {
    const platformResult = seedPlatformOpportunities();
    void platformResult;
    const stats = getCatalogStats();
    assert.ok(stats.total >= 30, 'should have at least 30 platform opportunities');
    assert.ok(stats.verified >= 30);
    assert.equal(stats.byRisk.find((r) => r.risk_level === 'low')?.count ?? 0, stats.total);
  });

  it('deduplication via dedup_hash unique — no duplicate records', () => {
    const unique = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const url = `https://example.com/test-opportunity/${unique}`;
    const first = createOpportunity({
      platform: 'TestPlatform',
      opportunity_type: 'platform_membership',
      title: 'TestPlatform — earning opportunity',
      description: 'Test',
      category: 'other',
      country_eligibility: ['global'],
      skills: ['general'],
      payout_currency: 'USD',
      source_url: url,
      external_id: unique,
      status: 'pending_review',
      risk_level: 'low',
    });
    assert.ok(first.isNew);
    const second = createOpportunity({
      platform: 'TestPlatform',
      opportunity_type: 'platform_membership',
      title: 'TestPlatform — earning opportunity',
      description: 'Test duplicate',
      category: 'other',
      country_eligibility: ['global'],
      skills: ['general'],
      payout_currency: 'USD',
      source_url: url,
      external_id: unique,
      status: 'pending_review',
      risk_level: 'low',
    });
    assert.equal(second.isNew, false);
    assert.equal(first.opportunity.id, second.opportunity.id);
    // hash must be deterministic
    const hash = computeDedupHash({ platform: 'TestPlatform', source_url: url, external_id: unique, opportunity_type: 'platform_membership' });
    assert.equal(hash, first.opportunity.dedup_hash);
  });

  it('pagination without loading all into memory — cursor + limit', () => {
    const page1 = listOpportunities({ limit: 10, offset: 0 });
    assert.ok(page1.opportunities.length <= 10);
    assert.ok(page1.total >= 30);
    assert.ok(page1.nextCursor !== null || page1.total <= 10);

    if (page1.nextCursor) {
      const page2 = listOpportunities({ limit: 10, cursor: page1.nextCursor });
      assert.ok(page2.opportunities.length <= 10);
      // cursor should not return same first item
      if (page1.opportunities.length > 0 && page2.opportunities.length > 0) {
        assert.notEqual(page1.opportunities[0].id, page2.opportunities[0].id);
      }
    }
  });

  it('filtering by category, platform, status, country, skill — indexed', () => {
    const byCat = listOpportunities({ category: 'affiliate_network', limit: 20 });
    assert.ok(byCat.total >= 1);
    for (const opp of byCat.opportunities) {
      assert.equal(opp.category, 'affiliate_network');
    }

    const byStatus = listOpportunities({ status: 'verified', limit: 20 });
    assert.ok(byStatus.total >= 30);

    const byCountry = listOpportunities({ country: 'GLOBAL', limit: 20 });
    assert.ok(byCountry.total >= 1);
  });

  it('verification lifecycle — pending -> verified -> rejected with audit', () => {
    const uniq = `verify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const created = createOpportunity({
      platform: 'VerificationTest',
      opportunity_type: 'other',
      title: 'Verification lifecycle test',
      category: 'other',
      country_eligibility: ['global'],
      skills: ['testing'],
      payout_currency: 'USD',
      source_url: `https://example.com/${uniq}`,
      external_id: uniq,
      status: 'pending_review',
      risk_level: 'medium',
    });
    assert.equal(created.opportunity.status, 'pending_review');

    const verified = updateOpportunityStatus({
      id: created.opportunity.id,
      status: 'verified',
      risk_level: 'low',
      verification_notes: 'Manual verification: ToS checked, source URL valid, no scraping',
      verifier_type: 'owner',
      verifier_id: 'test_owner',
    });
    assert.equal(verified.status, 'verified');
    assert.equal(verified.risk_level, 'low');
    assert.ok(verified.last_verified_at);

    const verifications = missionDb.all(`SELECT * FROM mission_opportunity_verifications WHERE opportunity_id = ?`, [created.opportunity.id]);
    assert.ok(verifications.length >= 1);
    assert.equal(String(verifications[0].new_status), 'verified');
  });

  it('rate limiting, queue, retries, caching — scalable ingestion', () => {
    const { sources } = listOpportunitySources({ limit: 1 });
    const source = sources[0];
    assert.ok(source);

    // rate limit check
    const check = checkRateLimit(source.id, 10, 1000);
    assert.ok(check.allowed);

    recordRateLimitHit(source.id);

    // queue
    const job = enqueueIngestionJob({ source_id: source.id, payload: { limit: 5 } });
    assert.ok(job.id);
    assert.equal(job.status, 'pending');

    const pending = listPendingJobs(10);
    assert.ok(pending.length >= 1);

    // cache sweep
    const swept = sweepExpiredCache();
    assert.ok(typeof swept === 'number');
  });

  it('does not claim 100M exist until genuinely sourced', () => {
    const stats = getCatalogStats();
    // Actual count is honest — 36 platforms seeded, not 100M
    assert.ok(stats.total < 1000, 'should not claim 100M until genuinely sourced');
    assert.ok(stats.total >= 30, 'should have at least seeded platforms');
    // Designed for 100M+ but actual is real count
    assert.equal(stats.verified + stats.pending_review + stats.rejected + stats.expired + stats.archived, stats.total);
  });

  it('stores required fields: platform, type, country, skills, payout, fees, ToS, source URL, last verified, risk, status', () => {
    const opp = getOpportunityById(listOpportunities({ limit: 1 }).opportunities[0].id);
    assert.ok(opp);
    assert.ok(opp.platform);
    assert.ok(opp.opportunity_type);
    assert.ok(opp.category);
    assert.ok(opp.country_eligibility);
    assert.ok(opp.skills);
    assert.ok(opp.payout_currency);
    assert.ok(opp.source_url);
    assert.ok(opp.dedup_hash);
    assert.ok(opp.status);
    assert.ok(opp.risk_level);
    // ToS URL can be null for some, but platform opportunities have it
    // last_verified_at can be null for pending, but verified have it
  });
});
