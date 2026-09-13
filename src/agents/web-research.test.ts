import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractText, createResearchReport, searchWeb, fetchPage, sanitizeQuery, __resetSearchRateLimitForTests } from './web-research';
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

  it('does not let AKBARAL_ALLOW_PRIVATE_PROVIDER open arbitrary private source URLs', async () => {
    // The trusted internal provider flag relaxes only URLs on the provider's own
    // host; a different private host must still be refused.
    await assert.rejects(() => fetchPage('http://10.0.0.1/private'), /private host|trusted provider host|SSRF/);
    await assert.rejects(() => fetchPage('http://169.254.169.254/latest'), /private host|trusted provider host|SSRF/);
  });

  // ── PHASE 2 hardening ────────────────────────────────────────────────────

  it('sanitizes queries: strips control characters, collapses whitespace, caps length', async () => {
    const noisy = 'AKBARAL\u0000\u0007research\t query\n with   spaces';
    assert.equal(sanitizeQuery(noisy), 'AKBARAL research query with spaces');
    assert.equal(sanitizeQuery('x'.repeat(1000)).length, 400);
    await assert.rejects(() => searchWeb('   \u0000\u0001  ', 5), /query must not be empty/i);
    // A sanitized query still reaches the provider and returns results.
    const results = await searchWeb('  AKBARAL  research  ', 5);
    assert.ok(results.length >= 1);
  });

  it('retries a transient 5xx search failure exactly once, then succeeds', async () => {
    const flaky = await startResearchFixture({ failFirstSearchWith: 503 });
    try {
      const results = await searchWeb('retry me', 5);
      assert.ok(results.length >= 1, 'second attempt succeeded');
      assert.equal(flaky.searchRequestCount(), 2, 'exactly two attempts (1 fail + 1 retry)');
    } finally {
      await flaky.close();
    }
  });

  it('does NOT retry a client 4xx search failure (fails after one attempt)', async () => {
    const gone = await startResearchFixture({ alwaysSearchStatus: 404 });
    try {
      await assert.rejects(() => searchWeb('missing resource', 5), /status 404/);
      assert.equal(gone.searchRequestCount(), 1, 'client error is terminal — no retry');
    } finally {
      await gone.close();
    }
  });

  it('enforces the production HTTPS transport policy for the search endpoint', async () => {
    const env = process.env as Record<string, string | undefined>;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousEndpoint = process.env.AKBARAL_SEARCH_ENDPOINT;
    const previousAllow = process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER;
    env.NODE_ENV = 'production';
    process.env.AKBARAL_SEARCH_ENDPOINT = 'http://public-search.example.com/search';
    delete process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER; // production default: unset
    try {
      // Public http:// endpoint + production + no trusted-private flag → refused
      // BEFORE any network call.
      await assert.rejects(() => searchWeb('anything', 5), /HTTPS in production/i);
    } finally {
      if (previousNodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = previousNodeEnv;
      if (previousEndpoint === undefined) delete env.AKBARAL_SEARCH_ENDPOINT;
      else env.AKBARAL_SEARCH_ENDPOINT = previousEndpoint;
      if (previousAllow === undefined) delete env.AKBARAL_ALLOW_PRIVATE_PROVIDER;
      else env.AKBARAL_ALLOW_PRIVATE_PROVIDER = previousAllow;
    }
  });

  it('rate-limits outbound search calls (sliding window, env-tunable)', async () => {
    const previousLimit = process.env.AKBARAL_SEARCH_RATE_LIMIT;
    process.env.AKBARAL_SEARCH_RATE_LIMIT = '2';
    __resetSearchRateLimitForTests();
    try {
      const first = await searchWeb('rate one', 5);
      const second = await searchWeb('rate two', 5);
      assert.ok(first.length >= 1 && second.length >= 1);
      await assert.rejects(() => searchWeb('rate three', 5), /rate limit/i);
    } finally {
      if (previousLimit === undefined) delete process.env.AKBARAL_SEARCH_RATE_LIMIT;
      else process.env.AKBARAL_SEARCH_RATE_LIMIT = previousLimit;
      __resetSearchRateLimitForTests();
    }
  });

  it('drops non-http(s) search results (javascript:, relative, odd schemes) from any provider', async () => {
    const hostile = await startResearchFixture({ includeNonHttpResults: true });
    try {
      const results = await searchWeb('filter me', 5);
      assert.ok(results.length >= 1, 'good results survive');
      for (const result of results) {
        assert.match(result.url, /^https?:\/\//i, `only http(s) URLs survive: ${result.url}`);
      }
      assert.ok(!results.some((r) => r.title.includes('Injection')), 'javascript: URL dropped');
      assert.ok(!results.some((r) => r.title.includes('Relative')), 'relative URL dropped');
      assert.ok(!results.some((r) => r.title.includes('Weird')), 'odd scheme dropped');
    } finally {
      await hostile.close();
    }
  });
});
