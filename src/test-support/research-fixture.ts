import http from 'node:http';

/**
 * Local HTTP research fixture used only by tests.
 *
 * A real HTTP server that speaks the same search/page-fetch protocol the agent
 * uses in production (DuckDuckGo-shaped search response or JSON search results
 * plus HTML page bodies). This lets the agent's real HTTP + HTML-extraction
 * path be verified in an environment where external web access is blocked.
 */

export interface ResearchFixtureServer {
  baseUrl: string;
  port: number;
  searchRequestCount: () => number;
  close(): Promise<void>;
}

export async function startResearchFixture(options?: {
  failSearch?: boolean;
  noResults?: boolean;
  failFirstSearchWith?: number;
  alwaysSearchStatus?: number;
  includeNonHttpResults?: boolean;
}): Promise<ResearchFixtureServer> {
  let searchRequestCount = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/search') {
      searchRequestCount += 1;
      if (options?.alwaysSearchStatus) {
        res.statusCode = options.alwaysSearchStatus;
        res.setHeader('content-type', 'text/plain');
        res.end(`search failed with ${options.alwaysSearchStatus}`);
        return;
      }
      if (options?.failFirstSearchWith && searchRequestCount === 1) {
        res.statusCode = options.failFirstSearchWith;
        res.setHeader('content-type', 'text/plain');
        res.end(`transient failure ${options.failFirstSearchWith}`);
        return;
      }
      if (options?.failSearch) {
        res.statusCode = 500;
        res.setHeader('content-type', 'text/plain');
        res.end('search unavailable');
        return;
      }
      if (options?.noResults) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ results: [] }));
        return;
      }
      const port = (server.address() as { port: number }).port;
      const goodResults = [
        {
          title: 'AKBARAL Overview',
          url: `http://127.0.0.1:${port}/source/1`,
          description: 'AKBARAL is a Master AI operating platform with specialist agents.',
        },
        {
          title: 'Agent Orchestration',
          url: `http://127.0.0.1:${port}/source/2`,
          description: 'The platform routes user goals through an AI orchestrator.',
        },
      ];
      if (options?.includeNonHttpResults) {
        // Malicious/malformed entries a hostile provider might return.
        goodResults.push(
          { title: 'Script Injection', url: 'javascript:alert(1)', description: 'must be dropped' },
          { title: 'Relative Path', url: '/relative/source', description: 'must be dropped' },
          { title: 'Weird Scheme', url: 'httpx://evil.example/x', description: 'must be dropped' },
        );
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ results: goodResults }));
      return;
    }
    if (url.pathname === '/fetch') {
      if (options?.failSearch) {
        res.statusCode = 504;
        res.end('source fetch unavailable');
        return;
      }
      res.setHeader('content-type', 'text/html');
      const title = url.searchParams.get('url')?.includes('/source/2') ? 'Agent Orchestration' : 'AKBARAL Overview';
      res.end(
        `<!doctype html><html><head><title>${title}</title></head><body>` +
          `<p>${title} This page contains multiple sentences. The platform uses these to build a research report and verify sources before presenting the final result.</p>` +
          `<p>Users can submit goals, specialist agents gather data, and the orchestrator verifies the output.</p>` +
          `</body></html>`,
      );
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // Save the prior values so closing a NESTED fixture restores the enclosing
  // fixture's configuration instead of wiping it.
  const previous = {
    searchEndpoint: process.env.AKBARAL_SEARCH_ENDPOINT,
    pageFetchEndpoint: process.env.AKBARAL_PAGE_FETCH_ENDPOINT,
    allowPrivateProvider: process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER,
  };

  process.env.AKBARAL_SEARCH_ENDPOINT = `${baseUrl}/search`;
  process.env.AKBARAL_PAGE_FETCH_ENDPOINT = `${baseUrl}/fetch`;
  // Test-only: allow the local trusted fixture to act as the search/fetch proxy.
  process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = '1';

  return {
    baseUrl,
    port: address.port,
    searchRequestCount: () => searchRequestCount,
    close(): Promise<void> {
      const restore = (key: string, value: string | undefined): void => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      };
      restore('AKBARAL_SEARCH_ENDPOINT', previous.searchEndpoint);
      restore('AKBARAL_PAGE_FETCH_ENDPOINT', previous.pageFetchEndpoint);
      restore('AKBARAL_ALLOW_PRIVATE_PROVIDER', previous.allowPrivateProvider);
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
