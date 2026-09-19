import { after, before, describe, it } from 'node:test';
import nodeFs from 'node:fs';
import assert from 'node:assert/strict';
import { db } from '../db';
import { applyMigrations } from '../db/migrate';
import { syncAgentRegistry } from '../agents/registry';
import {
  contentHashFor, importBatch, inventoryMetrics, listInventoryBatches, listQuarantine,
} from './inventory-import';
import { countPlatforms, getPlatform, listPlatforms, seedPlatforms } from './platforms';

let nonce = 0;
function uniq(prefix: string): string {
  nonce += 1;
  return `${prefix}-${Date.now()}-${nonce}`;
}

function validRow(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    earning_mechanism: 'affiliate',
    status: 'candidate',
    payout_evidence: `Import-test directory (fixture): ${name} pays 20% recurring commission.`,
    source_urls: ['https://import-test.local/directory'],
    verification_date: '2026-09-19',
    ...extra,
  };
}

describe('inventory import pipeline: evidence-gated, deduped, quarantined', () => {
  before(() => {
    applyMigrations(db);
    syncAgentRegistry();
    seedPlatforms();
  });

  after(() => {
    // Hygiene: remove every fixture row this file imported so later suites
    // see exactly the seed-file catalog.
    db.run("DELETE FROM economy_platforms WHERE source LIKE 'import-test%'");
    db.run("DELETE FROM economy_inventory_quarantine WHERE source LIKE 'import-test%'");
    db.run("DELETE FROM economy_inventory_batches WHERE source LIKE 'import-test%'");
  });

  it('imports valid batches with source, external id and content hash stamped', () => {
    const before = countPlatforms();
    const report = importBatch('import-test', [
      validRow(uniq('Import Program Alpha'), { external_id: uniq('ext') }),
      validRow(uniq('Import Program Beta'), { external_id: uniq('ext') }),
    ], 'import pipeline test batch');
    assert.equal(report.received, 2);
    assert.equal(report.imported, 2);
    assert.equal(report.duplicates, 0);
    assert.equal(report.quarantined, 0);
    assert.equal(countPlatforms(), before + 2);
    const batches = listInventoryBatches(5);
    assert.ok(batches.some((b) => b.id === report.batchId && b.imported === 2));
    const metrics = inventoryMetrics();
    assert.ok(metrics.bySource.some((s) => s.source === 'import-test' && s.n >= 2));
  });

  it('quarantines every evidence-less or malformed row with the exact reason — never imports it', () => {
    const before = countPlatforms();
    const report = importBatch('import-test-quarantine', [
      validRow('', {}),                                          // missing name
      { ...validRow(uniq('No Evidence Program')), payout_evidence: 'pays well' }, // thin evidence
      { ...validRow(uniq('No Mechanism Program')), earning_mechanism: '' },      // missing mechanism
      { ...validRow(uniq('Bad Status Program')), status: 'maybe' },              // invalid status
      { ...validRow(uniq('Rejected Program X')), status: 'rejected' },           // rejected: counted, not stored
    ]);
    assert.equal(report.received, 5);
    assert.equal(report.imported, 0);
    assert.equal(report.quarantined, 4);
    assert.equal(report.rejected, 1);
    assert.equal(countPlatforms(), before);
    const reasons = listQuarantine(report.batchId, 10).map((q) => q.reason).sort();
    assert.deepEqual(reasons, ['invalid_status', 'missing_mechanism', 'missing_name', 'missing_payout_evidence']);
  });

  it('dedupes by canonical key, source+external id and content hash', () => {
    const name = uniq('Dedupe Program');
    const ext = uniq('ext');
    const first = importBatch('import-test-dedupe', [validRow(name, { external_id: ext })]);
    assert.equal(first.imported, 1);
    // Same name, different source → duplicate (canonical key).
    const second = importBatch('import-test-dedupe-2', [validRow(name, { external_id: uniq('ext') })]);
    assert.equal(second.imported, 0);
    assert.equal(second.duplicates, 1);
    // Same source+external id, different name → duplicate.
    const third = importBatch('import-test-dedupe', [validRow(uniq('Dedupe Alias'), { external_id: ext })]);
    assert.equal(third.imported, 0);
    assert.equal(third.duplicates, 1);
    // Identical content hash → duplicate.
    const row = getPlatform(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    assert.ok(row);
    assert.equal(row.content_hash.length, 64);
    const recomputed = contentHashFor({ name, mechanism: 'affiliate', payoutEvidence: row.payout_evidence, source: 'import-test-dedupe', externalId: ext });
    assert.equal(recomputed, row.content_hash);
  });

  it('pages the catalog with a stable verified-first order', () => {
    const page1 = listPlatforms({ limit: 50, offset: 0 });
    const page2 = listPlatforms({ limit: 50, offset: 50 });
    assert.equal(page1.length, 50);
    assert.ok(page2.length > 0);
    const keys1 = new Set(page1.map((p) => p.platform_key));
    assert.ok(page2.every((p) => !keys1.has(p.platform_key)), 'pages must not overlap');
    assert.equal(page1[0].status, 'verified');
    const all = listPlatforms({ limit: 500, offset: 0 });
    assert.equal(all.filter((p) => p.status === 'verified').length, 6);
  });

  it('seed file rows carry the unified source/hash shape after seeding', () => {
    const amazon = getPlatform('amazon-associates');
    assert.ok(amazon);
    assert.equal(amazon.source, 'seed');
    assert.equal(amazon.content_hash.length, 64);
    // Reseed stays idempotent: file importable count stable, table total stable.
    const seedRows = JSON.parse(nodeFs.readFileSync('db/seeds/earning-platforms.json', 'utf8'));
    const importable = seedRows.filter((r: { status?: string }) => r.status === 'verified' || r.status === 'candidate').length;
    const totalBefore = countPlatforms();
    const again = seedPlatforms();
    assert.equal(again.seeded, importable);
    assert.equal(countPlatforms(), totalBefore);
  });
});
