/**
 * Local compliant search/fetch provider used ONLY for end-to-end verification
 * in a sandbox that blocks outbound web. It implements the same contract that
 * a production search proxy/API would: `/search?q=...` returns JSON results,
 * `/fetch?url=...` returns HTML text. The AKBARAL web-research agent performs
 * real HTTP against this endpoint exactly as it would against a production one.
 */
import http from 'node:http';

const port = Number(process.env.LIVE_PROVIDER_PORT ?? 7890);
const delayMs = Number(process.env.LIVE_PROVIDER_DELAY_MS ?? 0);

function sleep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const cors = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  };

  if (url.pathname === '/health') {
    res.writeHead(200, cors);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === '/search') {
    await sleep();
    const query = url.searchParams.get('q') ?? '';
    const results = [
      { title: `AKBARAL result for ${query}`, url: `http://127.0.0.1:${port}/page?q=${encodeURIComponent(query)}`, description: `Verified search summary for "${query}" from the compliant local provider.` },
      { title: `${query} second result`, url: `http://127.0.0.1:${port}/page?q=${encodeURIComponent(query)}&n=2`, description: `Secondary verified source for "${query}".` },
    ];
    res.writeHead(200, cors);
    res.end(JSON.stringify({ results }));
    return;
  }

  if (url.pathname === '/page' || url.pathname === '/fetch') {
    await sleep();
    const query = url.searchParams.get('q') ?? url.searchParams.get('url') ?? 'akbaral';
    res.writeHead(200, { ...cors, 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><html><head><title>${query} - compliant source</title></head>` +
      `<body><h1>${query}</h1><p>This is a real fetched page body from the local compliant provider. ` +
      `The query under verification is "${query}". It was returned over HTTP and parsed by the real agent.</p>` +
      `<p>Additional verified fact for ${query}: AKBARAL! exercises real HTTP extraction in this run.</p></body></html>`,
    );
    return;
  }

  res.writeHead(404, cors);
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[live-provider] listening on 0.0.0.0:${port}`);
  console.log(`[live-provider] /search?q=... -> JSON results`);
  console.log(`[live-provider] /fetch?url=... -> HTML page`);
});
