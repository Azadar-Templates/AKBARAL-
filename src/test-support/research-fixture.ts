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
  close(): Promise<void>;
}

export async function startResearchFixture(options?: {
  failSearch?: boolean;
  noResults?: boolean;
}): Promise<ResearchFixtureServer> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/search') {
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
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          results: [
            {
              title: 'AKBARAL Overview',
              url: `http://127.0.0.1:${(server.address() as { port: number }).port}/source/1`,
              description: 'AKBARAL is a Master AI operating platform with specialist agents.',
            },
            {
              title: 'Agent Orchestration',
              url: `http://127.0.0.1:${(server.address() as { port: number }).port}/source/2`,
              description: 'The platform routes user goals through an AI orchestrator.',
            },
          ],
        }),
      );
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

  process.env.AKBARAL_SEARCH_ENDPOINT = `${baseUrl}/search`;
  process.env.AKBARAL_PAGE_FETCH_ENDPOINT = `${baseUrl}/fetch`;

  return {
    baseUrl,
    port: address.port,
    close(): Promise<void> {
      delete process.env.AKBARAL_SEARCH_ENDPOINT;
      delete process.env.AKBARAL_PAGE_FETCH_ENDPOINT;
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
