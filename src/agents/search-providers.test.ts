import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  SEARCH_PROVIDER_SPECS,
  buildProviderRequest,
  isRetryableProviderError,
  normalizeProviderResults,
  resolveSearchProvider,
  runProviderSearch,
  searchProviderEnvKeys,
  searchProviderStatus,
  SearchProviderNotConfiguredError,
} from './search-providers';
import { createResearchReport, searchWeb, activeSearchProviderLabel } from './web-research';

/**
 * Production search-provider contract tests.
 *
 * Everything runs against a REAL local HTTP server that speaks each
 * commercial provider's documented protocol, so the adapter's transport
 * (method, headers, body, credential placement) and response parsing are
 * exercised end-to-end without any external network access and without a
 * single real credential. Secret values used here are stub strings; the
 * assertions prove they never leak into URLs, results or error messages.
 */

const STUB_KEY = 'stub-key-must-never-leak-1234567890';

interface RecordedRequest {
  path: string;
  method: string;
  query: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface ProviderFixture {
  baseUrl: string;
  requests: RecordedRequest[];
  /** Force the next responses to fail with a status (consumed once). */
  failNextWith: (status: number) => void;
  close(): Promise<void>;
}

type ProviderName = 'tavily' | 'brave' | 'serper' | 'google_cse';

function providerPayload(provider: ProviderName): Record<string, unknown> {
  switch (provider) {
    case 'tavily':
      return {
        results: [
          { title: 'AKBARAL Platform', url: 'https://example.com/akbaral', content: 'AKBARAL is a master AI operating platform.' },
          { title: 'Agent Registry', url: 'https://example.com/agents', content: 'Four thousand specialist agents.' },
          { title: 'Hostile', url: 'javascript:alert(1)', content: 'must be dropped' },
          { title: 'Relative', url: '/relative/path', content: 'must be dropped' },
        ],
      };
    case 'brave':
      return {
        web: {
          results: [
            { title: 'Brave Result One', url: 'https://example.com/one', description: 'First brave result.' },
            { title: 'Brave Result Two', url: 'https://example.com/two', description: 'Second brave result.' },
          ],
        },
      };
    case 'serper':
      return {
        organic: [
          { title: 'Serper Result One', link: 'https://example.com/s1', snippet: 'Serper snippet one.' },
          { title: 'Serper Result Two', link: 'https://example.com/s2', snippet: 'Serper snippet two.' },
        ],
      };
    case 'google_cse':
      return {
        items: [
          { title: 'CSE Result One', link: 'https://example.com/c1', snippet: 'CSE snippet one.' },
          { title: 'CSE Result Two', link: 'https://example.com/c2', snippet: 'CSE snippet two.' },
        ],
      };
  }
}

async function startProviderFixture(): Promise<ProviderFixture> {
  const requests: RecordedRequest[] = [];
  let failures = 0;
  let failureStatus = 503;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        path: url.pathname,
        method: req.method ?? 'GET',
        query: Object.fromEntries(url.searchParams.entries()),
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      if (failures > 0) {
        failures -= 1;
        res.statusCode = failureStatus;
        res.setHeader('content-type', 'application/json');
        // Deliberately echo whatever credential arrived: a real provider body
        // can do this, and the platform must never surface it to a user.
        res.end(JSON.stringify({ error: 'provider failure', received: req.headers.authorization ?? req.headers['x-api-key'] ?? null }));
        return;
      }
      const provider: ProviderName = url.pathname.includes('customsearch')
        ? 'google_cse'
        : url.pathname.includes('/res/v1/web/search')
          ? 'brave'
          : url.pathname.includes('serper') || req.headers['x-api-key']
            ? 'serper'
            : 'tavily';
      if (url.pathname === '/fetch') {
        res.setHeader('content-type', 'text/html');
        res.end(
          '<!doctype html><html><head><title>Source Page</title></head><body>' +
            '<p>This fetched page contains several complete sentences that are long enough to be extracted as verified research facts by the agent.</p>' +
            '<p>The orchestrator only reports facts that were actually retrieved from a reachable source document.</p>' +
            '</body></html>',
        );
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(providerPayload(provider)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    failNextWith(status) {
      failureStatus = status;
      failures += 1;
    },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

const PROVIDER_ENV_KEYS = [
  'AKBARAL_SEARCH_PROVIDER',
  'AKBARAL_SEARCH_ENDPOINT',
  'AKBARAL_PAGE_FETCH_ENDPOINT',
  'AKBARAL_ALLOW_PRIVATE_PROVIDER',
  'TAVILY_API_KEY',
  'TAVILY_BASE_URL',
  'BRAVE_SEARCH_API_KEY',
  'BRAVE_SEARCH_BASE_URL',
  'SERPER_API_KEY',
  'SERPER_BASE_URL',
  'GOOGLE_CSE_API_KEY',
  'GOOGLE_CSE_ID',
  'GOOGLE_CSE_BASE_URL',
  'OPENAI_API_KEY',
];

let savedEnv: Record<string, string | undefined> = {};

function clearProviderEnv(): void {
  for (const key of PROVIDER_ENV_KEYS) {
    delete process.env[key];
  }
}

describe('production search providers', () => {
  let fixture: ProviderFixture;

  before(async () => {
    fixture = await startProviderFixture();
  });

  after(async () => {
    await fixture.close();
  });

  beforeEach(() => {
    savedEnv = {};
    for (const key of PROVIDER_ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    clearProviderEnv();
    // The local fixture is a trusted internal provider for the duration of a test.
    process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = '1';
    fixture.requests.length = 0;
  });

  const restore = (): void => {
    clearProviderEnv();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
  };

  // ── provider selection ────────────────────────────────────────────────────

  it('selects a keyed provider automatically once its credential exists', () => {
    try {
      assert.equal(resolveSearchProvider().kind, 'duckduckgo', 'keyless default when nothing is configured');
      assert.equal(resolveSearchProvider().keyless, true);

      process.env.SERPER_API_KEY = STUB_KEY;
      assert.equal(resolveSearchProvider().kind, 'serper');

      // Tavily outranks Serper in the documented auto-detect order.
      process.env.TAVILY_API_KEY = STUB_KEY;
      assert.equal(resolveSearchProvider().kind, 'tavily');

      // An explicit operator choice always wins.
      process.env.AKBARAL_SEARCH_PROVIDER = 'serper';
      assert.equal(resolveSearchProvider().kind, 'serper');
    } finally {
      restore();
    }
  });

  it('keeps an explicit endpoint override ahead of auto-detected keys', () => {
    try {
      process.env.AKBARAL_SEARCH_ENDPOINT = `${fixture.baseUrl}/search`;
      process.env.TAVILY_API_KEY = STUB_KEY;
      assert.equal(resolveSearchProvider().kind, 'endpoint');

      // …and an explicit provider beats the endpoint override.
      process.env.AKBARAL_SEARCH_PROVIDER = 'tavily';
      assert.equal(resolveSearchProvider().kind, 'tavily');
    } finally {
      restore();
    }
  });

  it('fails honestly when the selected provider has no credential (never a silent fallback)', () => {
    try {
      process.env.AKBARAL_SEARCH_PROVIDER = 'tavily';
      assert.throws(
        () => resolveSearchProvider(),
        (error: unknown) =>
          error instanceof SearchProviderNotConfiguredError &&
          error.code === 'provider_not_configured' &&
          error.requiredEnvKeys.includes('TAVILY_API_KEY'),
      );

      process.env.AKBARAL_SEARCH_PROVIDER = 'google_cse';
      process.env.GOOGLE_CSE_API_KEY = STUB_KEY;
      // Half-configured: the engine id is still missing.
      assert.throws(() => resolveSearchProvider(), /GOOGLE_CSE_ID/);
    } finally {
      restore();
    }
  });

  it('rejects an unknown provider name with the supported list, and validates the endpoint choice', () => {
    try {
      process.env.AKBARAL_SEARCH_PROVIDER = 'not-a-provider';
      assert.throws(() => resolveSearchProvider(), /is not a supported provider[\s\S]*duckduckgo/);

      process.env.AKBARAL_SEARCH_PROVIDER = 'endpoint';
      assert.throws(() => resolveSearchProvider(), /requires AKBARAL_SEARCH_ENDPOINT/);
    } finally {
      restore();
    }
  });

  // ── transports ────────────────────────────────────────────────────────────

  it('Tavily: posts the query with a Bearer header (credential never in the URL)', async () => {
    try {
      process.env.AKBARAL_SEARCH_PROVIDER = 'tavily';
      process.env.TAVILY_API_KEY = STUB_KEY;
      process.env.TAVILY_BASE_URL = fixture.baseUrl;

      const results = await searchWeb('akbaral platform', 5);
      const request = fixture.requests.at(-1)!;
      assert.equal(request.method, 'POST');
      assert.equal(request.path, '/search');
      assert.equal(request.headers.authorization, `Bearer ${STUB_KEY}`);
      assert.ok(!request.path.includes(STUB_KEY) && !JSON.stringify(request.query).includes(STUB_KEY));
      assert.deepEqual(JSON.parse(request.body), {
        query: 'akbaral platform',
        max_results: 5,
        search_depth: 'basic',
        include_answer: false,
      });

      assert.equal(results.length, 2, 'hostile javascript:/relative entries are dropped');
      assert.deepEqual(results[0], {
        title: 'AKBARAL Platform',
        url: 'https://example.com/akbaral',
        description: 'AKBARAL is a master AI operating platform.',
      });
    } finally {
      restore();
    }
  });

  it('Brave: GET with the subscription header and provider-specific parsing', async () => {
    try {
      process.env.AKBARAL_SEARCH_PROVIDER = 'brave';
      process.env.BRAVE_SEARCH_API_KEY = STUB_KEY;
      process.env.BRAVE_SEARCH_BASE_URL = fixture.baseUrl;

      const results = await searchWeb('brave query', 3);
      const request = fixture.requests.at(-1)!;
      assert.equal(request.method, 'GET');
      assert.equal(request.path, '/res/v1/web/search');
      assert.equal(request.query.q, 'brave query');
      assert.equal(request.query.count, '3');
      assert.equal(request.headers['x-subscription-token'], STUB_KEY);
      assert.equal(results[0].title, 'Brave Result One');
      assert.equal(results[0].description, 'First brave result.');
    } finally {
      restore();
    }
  });

  it('Serper: POST with the X-API-KEY header and organic-results mapping', async () => {
    try {
      process.env.AKBARAL_SEARCH_PROVIDER = 'serper';
      process.env.SERPER_API_KEY = STUB_KEY;
      process.env.SERPER_BASE_URL = fixture.baseUrl;

      const results = await searchWeb('serper query', 4);
      const request = fixture.requests.at(-1)!;
      assert.equal(request.method, 'POST');
      assert.equal(request.headers['x-api-key'], STUB_KEY);
      assert.deepEqual(JSON.parse(request.body), { q: 'serper query', num: 4 });
      assert.equal(results[1].url, 'https://example.com/s2');
      assert.equal(results[1].description, 'Serper snippet two.');
    } finally {
      restore();
    }
  });

  it('Google Programmable Search: documented key/cx params with items mapping', async () => {
    try {
      process.env.AKBARAL_SEARCH_PROVIDER = 'google_cse';
      process.env.GOOGLE_CSE_API_KEY = STUB_KEY;
      process.env.GOOGLE_CSE_ID = 'stub-engine-id';
      process.env.GOOGLE_CSE_BASE_URL = fixture.baseUrl;

      const results = await searchWeb('cse query', 2);
      const request = fixture.requests.at(-1)!;
      assert.equal(request.method, 'GET');
      assert.equal(request.path, '/customsearch/v1');
      assert.equal(request.query.key, STUB_KEY);
      assert.equal(request.query.cx, 'stub-engine-id');
      assert.equal(request.query.q, 'cse query');
      assert.equal(results[0].title, 'CSE Result One');
    } finally {
      restore();
    }
  });

  // ── credential hygiene ────────────────────────────────────────────────────

  it('never leaks a credential into an error message, even when the provider echoes it back', async () => {
    try {
      process.env.AKBARAL_SEARCH_PROVIDER = 'tavily';
      process.env.TAVILY_API_KEY = STUB_KEY;
      process.env.TAVILY_BASE_URL = fixture.baseUrl;

      // The fixture answers 401 with a body that echoes the credential it
      // received. Neither the key nor the raw body may reach the caller, and a
      // 401 must not be retried.
      fixture.failNextWith(401);
      const before = fixture.requests.length;
      await assert.rejects(
        () => searchWeb('secret handling', 3),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.ok(!message.includes(STUB_KEY), `error must not echo the key: ${message}`);
          assert.ok(!message.includes('provider failure'), `raw provider body must not be echoed: ${message}`);
          assert.match(message, /Tavily search failed/);
          return true;
        },
      );
      assert.equal(fixture.requests.length - before, 1, '401 is permanent — no retry');

      // A successful response body is mapped to results only — no raw provider
      // payload (which could contain request echoes) is returned.
      const provider = resolveSearchProvider();
      const results = await runProviderSearch(provider, 'mapping', 5, { attempts: 1 });
      for (const result of results) {
        assert.ok(!JSON.stringify(result).includes(STUB_KEY));
      }
    } finally {
      restore();
    }
  });

  it('reports provider status with environment-variable names and booleans only', () => {
    try {
      process.env.TAVILY_API_KEY = STUB_KEY;
      const status = searchProviderStatus();
      assert.equal(status.active.kind, 'tavily');
      assert.equal(status.active.credentialsConfigured, true);
      const serialized = JSON.stringify(status);
      assert.ok(!serialized.includes(STUB_KEY), 'status payload must never contain a value');
      assert.deepEqual(status.active.requiredEnvVars, ['TAVILY_API_KEY']);
      assert.equal(status.supported.length, SEARCH_PROVIDER_SPECS.length);
      assert.ok(searchProviderEnvKeys().includes('BRAVE_SEARCH_API_KEY'));
    } finally {
      restore();
    }
  });

  // ── failure semantics ─────────────────────────────────────────────────────

  it('retries a transient provider outage once and fails after a permanent one', async () => {
    try {
      process.env.AKBARAL_SEARCH_PROVIDER = 'tavily';
      process.env.TAVILY_API_KEY = STUB_KEY;
      process.env.TAVILY_BASE_URL = fixture.baseUrl;

      fixture.failNextWith(503);
      const before = fixture.requests.length;
      const results = await runProviderSearch(resolveSearchProvider(), 'retry me', 3);
      assert.equal(results.length, 2, 'the retry succeeded');
      assert.equal(fixture.requests.length - before, 2, 'exactly one retry');

      // 401 is permanent: no retry budget is burned.
      assert.equal(isRetryableProviderError(Object.assign(new Error('401'), { status: 401 })), false);
      assert.equal(
        isRetryableProviderError({ message: 'x', status: 401 } as unknown),
        false,
        'a non-Error object is not treated as retryable',
      );
      assert.equal(isRetryableProviderError(new Error('request failed with status 503')), true);
    } finally {
      restore();
    }
  });

  it('refuses a private provider host unless the operator explicitly trusted one (SSRF)', async () => {
    try {
      process.env.AKBARAL_SEARCH_PROVIDER = 'tavily';
      process.env.TAVILY_API_KEY = STUB_KEY;
      process.env.TAVILY_BASE_URL = 'http://169.254.169.254';
      delete process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER;
      assert.throws(() => buildProviderRequest(resolveSearchProvider(), 'q', 3), /private host|SSRF|refused/i);
    } finally {
      restore();
    }
  });

  it('drops malformed provider payloads instead of inventing results', () => {
    assert.deepEqual(normalizeProviderResults('tavily', {}, 5), []);
    assert.deepEqual(normalizeProviderResults('brave', { web: {} }, 5), []);
    assert.deepEqual(normalizeProviderResults('serper', { organic: [] }, 5), []);
    assert.deepEqual(
      normalizeProviderResults('google_cse', { items: [{ title: 'No URL', snippet: 'x' }] }, 5),
      [],
      'an entry without an http(s) URL is not a result',
    );
  });

  // ── the agent path end-to-end ─────────────────────────────────────────────

  it('runs the full research path through a real provider transport and reports the active provider', async () => {
    try {
      process.env.AKBARAL_SEARCH_PROVIDER = 'brave';
      process.env.BRAVE_SEARCH_API_KEY = STUB_KEY;
      process.env.BRAVE_SEARCH_BASE_URL = fixture.baseUrl;
      process.env.AKBARAL_PAGE_FETCH_ENDPOINT = `${fixture.baseUrl}/fetch`;

      assert.equal(activeSearchProviderLabel(), 'Brave Search');

      const report = await createResearchReport('AKBARAL platform', 5, 2);
      assert.equal(report.provider, 'Brave Search');
      assert.ok(report.sources.length >= 1, 'sources came from the provider');
      assert.ok(report.verifiedSources >= 1, 'at least one source was actually fetched and verified');
      assert.ok(report.facts.length >= 1, 'facts were extracted from the fetched page');
      assert.match(report.summary, /Verified with \d+ source/);
      // The search request really happened over HTTP.
      assert.ok(fixture.requests.some((request) => request.path === '/res/v1/web/search'));
    } finally {
      restore();
    }
  });

  it('distinguishes a genuine empty result set from an unrecognized provider response', async () => {
    let mode: 'empty' | 'unrecognized' = 'empty';
    const stub = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(mode === 'empty' ? JSON.stringify({ results: [] }) : JSON.stringify({ error: 'blocked by quota' }));
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const port = (stub.address() as { port: number }).port;
    try {
      process.env.AKBARAL_SEARCH_PROVIDER = 'tavily';
      process.env.TAVILY_API_KEY = STUB_KEY;
      process.env.TAVILY_BASE_URL = `http://127.0.0.1:${port}`;

      // Documented shape + empty array = an honest "no matches" answer…
      assert.deepEqual(await searchWeb('nothing', 5), []);
      // …but the research agent still refuses to present a result with no source.
      await assert.rejects(() => createResearchReport('nothing', 5, 1), /no search results found/);

      // A payload that is not the documented shape must fail loudly: a block
      // page or a renamed field can never be mistaken for "no matches".
      mode = 'unrecognized';
      await assert.rejects(() => searchWeb('blocked', 5), /unrecognized response/);
    } finally {
      await new Promise<void>((resolve) => stub.close(() => resolve()));
      restore();
    }
  });
});
