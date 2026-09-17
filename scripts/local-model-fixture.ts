#!/usr/bin/env node
/**
 * AKBARAL! — LOCAL MODEL STUB (development / offline previews only).
 *
 * Speaks the OpenAI-compatible `/v1/chat/completions` protocol so the whole
 * platform can be exercised on a machine with no external AI credentials:
 *
 *   npm run fixture:model            # listens on :4999
 *   export OPENAI_API_KEY=local-stub-key
 *   export OPENAI_BASE_URL=http://127.0.0.1:4999/v1
 *   export AKBARAL_ALLOW_PRIVATE_PROVIDER=1
 *
 * Routing (by system prompt) mirrors the repo's own test fixture
 * (src/test-support/model-provider-fixture.ts) so the REAL pipeline runs
 * end to end: goal analysis → specialist execution → output verification →
 * synthesis → versioned website-artifact capture.
 *
 * HONESTY CONTRACT — this stub is a development stand-in for a language
 * model, nothing else. Every other layer (planner, specialist registry,
 * queue, verification, artifact capture/versioning, credits and refunds) is
 * production code. The documents it returns carry a visible footer stating
 * that a local stub produced them, so a preview deliverable can never be
 * mistaken for real model output. Real deployments set a provider key
 * (GOOGLE_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY) and never start this;
 * `src/test-support/model-provider-fixture.ts` remains the test-only fixture.
 */
import http from 'node:http';

const PORT = Number(process.env.FIXTURE_PORT ?? 4999);
const HOST = process.env.FIXTURE_HOST ?? '0.0.0.0';

const STUB_NOTE =
  'Local model stub — every other layer is the real AKBARAL! pipeline. ' +
  'Connect an AI provider key for production deliverables.';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The working calculator used when the goal asks for one. */
function calculatorMarkup(): string {
  return `<section class="calc" aria-label="Calculator">
    <h2>Calculator</h2>
    <output class="display" id="display" aria-live="polite">0</output>
    <div class="keys" id="keys">
      <button data-k="clear" type="button">C</button>
      <button data-k="back" type="button">&#9003;</button>
      <button data-k="%" class="op" type="button">%</button>
      <button data-k="/" class="op" type="button">&divide;</button>
      <button data-k="7" type="button">7</button>
      <button data-k="8" type="button">8</button>
      <button data-k="9" type="button">9</button>
      <button data-k="*" class="op" type="button">&times;</button>
      <button data-k="4" type="button">4</button>
      <button data-k="5" type="button">5</button>
      <button data-k="6" type="button">6</button>
      <button data-k="-" class="op" type="button">&minus;</button>
      <button data-k="1" type="button">1</button>
      <button data-k="2" type="button">2</button>
      <button data-k="3" type="button">3</button>
      <button data-k="+" class="op" type="button">+</button>
      <button data-k="0" type="button">0</button>
      <button data-k="." type="button">.</button>
      <button data-k="=" class="eq" type="button">=</button>
    </div>
    <script>
      (function () {
        var expression = '';
        var display = document.getElementById('display');
        function render() { display.textContent = expression === '' ? '0' : expression; }
        function evaluate() {
          if (!expression.trim() || !/^[0-9+\\-*/.%() ]+$/.test(expression)) return 'Error';
          try {
            var value = Function('"use strict";return (' + expression + ')')();
            return Number.isFinite(value) ? String(Math.round(value * 1e10) / 1e10) : 'Error';
          } catch (error) { return 'Error'; }
        }
        document.getElementById('keys').addEventListener('click', function (event) {
          var key = event.target.getAttribute('data-k');
          if (!key) return;
          if (key === 'clear') { expression = ''; render(); return; }
          if (key === 'back') { expression = expression.slice(0, -1); render(); return; }
          if (key === '=') { expression = evaluate(); render(); return; }
          expression += key;
          render();
        });
      })();
    </script>
  </section>`;
}

/** A complete, self-contained HTML document for the requested goal. */
function deliverableFor(goal: string): string {
  const wantsCalculator = /calculat|arithmetic|sum|math/i.test(goal);
  const title = goal.trim().slice(0, 90) || 'AKBARAL! application';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
         background: radial-gradient(120% 90% at 15% 0%, #12121c, #07070a 55%);
         color: #f0f0f2; font-family: Inter, system-ui, -apple-system, sans-serif; }
  .app { width: min(520px, 100%); padding: 26px; border-radius: 18px;
         border: 1px solid rgba(226,226,234,.12); background: rgba(12,12,17,.72);
         box-shadow: 0 30px 80px rgba(0,0,0,.55); }
  .eyebrow { margin: 0 0 6px; font-size: 11px; letter-spacing: .22em; text-transform: uppercase; color: #9790f2; }
  h1 { margin: 0 0 8px; font-size: 1.32rem; line-height: 1.32; }
  .goal { margin: 0 0 18px; color: #a9a9b4; font-size: .9rem; line-height: 1.6; }
  .calc h2 { margin: 0 0 12px; font-size: .82rem; letter-spacing: .18em; text-transform: uppercase; color: #8fc7de; }
  .display { display: block; padding: 14px; border-radius: 12px; text-align: right;
             font-size: 1.9rem; font-variant-numeric: tabular-nums; min-height: 62px;
             background: rgba(4,4,7,.75); border: 1px solid rgba(226,226,234,.08); }
  .keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
  button { padding: 13px 0; border-radius: 11px; border: 1px solid rgba(226,226,234,.1);
           background: rgba(226,226,234,.05); color: inherit; font: inherit; font-size: 1rem; cursor: pointer; }
  button:hover { border-color: rgba(151,144,242,.55); }
  button.op { color: #9790f2; }
  button.eq { background: linear-gradient(150deg, #7378e8, #9790f2); color: #0b0b0d; font-weight: 700; }
  .todo { margin: 0; padding-left: 18px; color: #c9c9d2; font-size: .88rem; line-height: 1.75; }
  footer { margin-top: 20px; padding-top: 12px; border-top: 1px solid rgba(226,226,234,.08);
           font-size: .68rem; line-height: 1.5; color: #7b7b86; }
</style>
</head>
<body>
  <main class="app">
    <p class="eyebrow">AKBARAL! deliverable</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="goal">Requested through the MASTER pipeline and captured as this project's versioned artifact.</p>
    ${wantsCalculator ? calculatorMarkup() : '<ul class="todo"><li>Application shell rendered from the request.</li><li>Responsive layout, dark surface, no external dependencies.</li><li>Replace the local model stub with a provider key for production content.</li></ul>'}
    <footer>${escapeHtml(STUB_NOTE)}</footer>
  </main>
</body>
</html>`;
}

const ANALYSIS = {
  intents: [
    {
      key: 'application-build',
      label: 'Build the requested application',
      categorySlug: 'web-development',
      roleKeys: ['strategist', 'builder', 'validator'],
      confidence: 0.92,
    },
  ],
  deliverables: ['working application document', 'implementation notes'],
  constraints: ['self-contained', 'responsive'],
  complexity: 'standard',
  clarifyingQuestions: [],
};

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      body = {};
    }
    const messages = Array.isArray(body.messages)
      ? (body.messages as Array<{ role?: string; content?: string }>)
      : [];
    const system = messages.find((message) => message.role === 'system')?.content ?? '';
    const user = messages.find((message) => message.role === 'user')?.content ?? '';

    let content: string;
    if (system.includes('goal analyzer')) {
      content = JSON.stringify(ANALYSIS);
    } else if (system.includes('output verifier')) {
      content = JSON.stringify({ verdict: 'pass', issues: [] });
    } else if (system.includes('synthesizer')) {
      content = JSON.stringify({
        executiveSummary:
          'The requested application was produced as a complete HTML document, verified by the output verifier and captured as the project’s versioned website artifact.',
        nextSteps: ['Open the deliverable in the preview', 'Export or download the .html artifact'],
      });
    } else {
      // Specialist step: return a complete HTML document so the workflow's
      // artifact capture has a genuine deliverable to version.
      const goalMatch = /USER GOAL:?\s*([\s\S]*)/.exec(user);
      const goal = (goalMatch?.[1] ?? user ?? 'AKBARAL! application').trim().slice(0, 240);
      content = deliverableFor(goal);
    }

    console.log(`[fixture] ${req.url} → ${system.includes('goal analyzer') ? 'analysis' : system.includes('output verifier') ? 'verdict' : system.includes('synthesizer') ? 'summary' : 'deliverable document'}`);

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-local-stub',
        object: 'chat.completion',
        model: 'local-stub',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 640 },
      }),
    );
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[fixture] local model stub listening on http://${HOST}:${PORT}/v1`);
  console.log('[fixture] development stub only — set a real provider key for production inference');
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
