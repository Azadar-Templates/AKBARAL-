// Gemini-protocol fixture speaking the CURRENT official contract:
//   POST {base}/v1beta/models/{model}:generateContent  (x-goog-api-key header)
import http from 'node:http';

const ANSWER = `## AKBARAL! in 5 bullet points

- **One intelligence system**: AKBARAL! is an autonomous operating system for work — a MASTER orchestrator that understands a goal, plans the mission and dispatches real specialist agents.
- **4,001 specialist agents**: a genuine registry across 80 disciplines — research, engineering, design, data, business and automation — each with a real contract, tools and verification.
- **Verified results only**: every task passes verification before completion; nothing unverified is ever returned as a success.
- **Honest by design**: free task credits are consumed only on success and refunded on failure; missing providers are reported honestly, never faked.
- **Real execution**: durable queue, real model providers, real tools, live execution logs, full usage and cost accounting.`;

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = req.url ?? '';
    console.log(`[gemini-fixture] ${req.method} ${url} x-goog-api-key=${req.headers['x-goog-api-key'] ? 'present' : 'ABSENT'}`);
    if (url.includes('key=')) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { message: 'API key must not travel in the URL' } }));
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      candidates: [{ content: { parts: [{ text: ANSWER }], role: 'model' }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 420, candidatesTokenCount: 280, totalTokenCount: 700 },
      modelVersion: 'gemini-3.8-flash',
    }));
  });
});
const FIXTURE_PORT = Number(process.env.PREVIEW_FIXTURE_PORT ?? process.env.PORT ?? 32911);
server.listen(FIXTURE_PORT, '127.0.0.1', () => console.log(`gemini fixture on :${FIXTURE_PORT}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
