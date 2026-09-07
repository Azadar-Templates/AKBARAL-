import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractText, createResearchReport, searchWeb } from './web-research';
import { startResearchFixture, type ResearchFixtureServer } from '../test-support/research-fixture';

describe('web research agent', () => {
  let fixture: ResearchFixtureServer;

  before(async () => {
    fixture = await startResearchFixture();
  });

  after(async () => {
    await fixture.close();
  });

  it('extracts readable text from HTML', () => {
    const text = extractText('<html><head><title>x</title><style>h1{}</style></head><body><h1> Hello </h1><p>World</p><script>alert(1)</script></body></html>');
    assert.ok(text.includes('Hello'));
    assert.ok(text.includes('World'));
  });

  it('searches a real HTTP endpoint', async () => {
    const results = await searchWeb('AKBARAL', 5);
    assert.equal(results.length, 2);
    assert.ok(results[0].url.includes('/source/1'));
  });

  it('produces a verified research report with sources and facts', async () => {
    const report = await createResearchReport('AKBARAL', 5, 3);
    assert.equal(report.query, 'AKBARAL');
    assert.ok(report.sources.length >= 1);
    assert.ok(report.verifiedSources >= 1);
    assert.ok(report.facts.length >= 1);
    assert.ok(report.summary.includes('AKBARAL'));
  });

  it('fails loudly when the search provider is unavailable', async () => {
    const badFixture = await startResearchFixture({ failSearch: true });
    try {
      await assert.rejects(() => searchWeb('anything', 5), /status/);
      await assert.rejects(() => createResearchReport('anything', 5, 2));
    } finally {
      await badFixture.close();
    }
  });
});
