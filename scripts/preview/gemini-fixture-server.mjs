// Gemini-protocol fixture speaking the CURRENT official contract:
//   POST {base}/v1beta/models/{model}:generateContent  (x-goog-api-key header)
//
// PREVIEW-ONLY stand-in for Google: the Arena sandbox blocks external egress,
// so the preview stack points GOOGLE_BASE_URL at this server (see
// scripts/preview/start-preview.mjs — nothing here pretends to be
// production). It answers the real protocol; production uses GOOGLE_API_KEY.
//
// Two honest shapes, chosen from the actual prompt:
//   · website goals  → a COMPLETE HTML document (the website-builder
//                      deliverable shape the workflow captures as a versioned
//                      project artifact). This is what a real provider returns
//                      for "build me a website", and it lets the preview
//                      exercise artifact capture, the canvas preview, export
//                      and version history for real.
//   · every other goal → a markdown specialist answer.
import http from 'node:http';

const MARKDOWN_ANSWER = `## AKBARAL! in 5 bullet points

- **One intelligence system**: AKBARAL! is an autonomous operating system for work — a MASTER orchestrator that understands a goal, plans the mission and dispatches real specialist agents.
- **4,001 specialist agents**: a genuine registry across 80 disciplines — research, engineering, design, data, business and automation — each with a real contract, tools and verification.
- **Verified results only**: every task passes verification before completion; nothing unverified is ever returned as a success.
- **Honest by design**: free task credits are consumed only on success and refunded on failure; missing providers are reported honestly, never faked.
- **Real execution**: durable queue, real model providers, real tools, live execution logs, full usage and cost accounting.`;

const WEBSITE_PATTERN = /(website|web site|landing page|build a site|webpage|web page|homepage)/i;

/** The website-builder deliverable shape: one complete, self-contained HTML
 *  document (no external assets — the preview canvas renders it offline). */
function websiteDocument(goal) {
  const subject = String(goal || 'AKBARAL! project')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  const title = subject.replace(/[^a-z0-9 ]/gi, '').trim() || 'AKBARAL! Project';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { --ink:#12121a; --muted:#5c5c6b; --accent:#5b5bd6; --bg:#fafafc; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:var(--ink); background:var(--bg); line-height:1.6; }
  header { padding:64px 24px 48px; text-align:center; background:linear-gradient(180deg,#f0f0fb,#fafafc); }
  h1 { margin:0 0 12px; font-size:clamp(2rem,5vw,3rem); letter-spacing:-0.02em; }
  header p { margin:0 auto; max-width:56ch; color:var(--muted); }
  main { max-width:960px; margin:0 auto; padding:48px 24px 72px; }
  .grid { display:grid; gap:20px; grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr)); }
  .card { border:1px solid #e6e6ef; border-radius:14px; padding:22px; background:#fff; }
  .card h2 { margin:0 0 8px; font-size:1.05rem; }
  .card p { margin:0; color:var(--muted); font-size:.95rem; }
  .cta { display:inline-block; margin-top:28px; padding:14px 26px; border-radius:10px; background:var(--accent); color:#fff; text-decoration:none; font-weight:600; }
  footer { padding:28px 24px 48px; text-align:center; color:var(--muted); font-size:.85rem; }
</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  <p>A complete page produced by the AKBARAL! website-builder pipeline for the goal: “${subject}”.</p>
  <a class="cta" href="#highlights">Explore</a>
</header>
<main>
  <section class="grid" id="highlights">
    <article class="card"><h2>Built for the goal</h2><p>This document is the real deliverable of the MASTER workflow run — captured as a versioned project artifact.</p></article>
    <article class="card"><h2>Responsive by default</h2><p>Fluid type, wrapped grids and a layout that holds from a 390px phone to a wide desktop canvas.</p></article>
    <article class="card"><h2>Self-contained</h2><p>No external assets: styles are inline so the preview canvas renders it without any network access.</p></article>
    <article class="card"><h2>Verifiable</h2><p>Every step of the run passed output verification before this page was returned.</p></article>
  </section>
</main>
<footer>AKBARAL! · one intelligence, every solution</footer>
</body>
</html>`;
}

/** Pull the user prompt out of the Gemini generateContent request body. */
function goalFrom(raw) {
  try {
    const body = JSON.parse(raw);
    const parts = body?.contents?.flatMap((entry) => entry?.parts ?? []) ?? [];
    return parts.map((part) => String(part?.text ?? '')).join('\n');
  } catch {
    return '';
  }
}

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
    const goal = goalFrom(raw);
    const answer = WEBSITE_PATTERN.test(goal) ? websiteDocument(goal) : MARKDOWN_ANSWER;
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      candidates: [{ content: { parts: [{ text: answer }], role: 'model' }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 420, candidatesTokenCount: 280, totalTokenCount: 700 },
      modelVersion: 'gemini-3.8-flash',
    }));
  });
});
const FIXTURE_PORT = Number(process.env.PREVIEW_FIXTURE_PORT ?? process.env.PORT ?? 32911);
server.listen(FIXTURE_PORT, '127.0.0.1', () => console.log(`gemini fixture on :${FIXTURE_PORT}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
