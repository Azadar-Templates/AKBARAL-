/**
 * Before/after section heights for the mission console strip.
 *
 * The owner asked for the height of every section that changed, measured rather than described. This
 * script renders the pre-strip console (from `git show <ref>:mission-dashboard/…`) and the current one
 * side by side in real Chromium, at the same viewport and against the *same* stubbed API, then reports
 * the scroll height of each section with its collapsed blocks closed and open.
 *
 * The payload is a thin identical stub on purpose: it isolates layout weight — headings, tables,
 * forms, duplicated badges — from data volume, which is what a strip changes. Populated heights on
 * real database rows are measured by `npm run mission:browser-check`, which writes
 * `logs/browser/<run>/section-heights-*.json`.
 *
 *   npx tsx scripts/mission-dashboard-heights.ts [--ref HEAD] [--viewport 1440x1000]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';

const argv = process.argv.slice(2);
const refOf = (name: string, fallback: string): string => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const REF = refOf('ref', 'HEAD');
const [VIEWPORT_WIDTH, VIEWPORT_HEIGHT] = (refOf('viewport', '1440x1000')).split('x').map(Number);
const THREE_SCREENS = 3 * VIEWPORT_HEIGHT;
const DASHBOARD_FILES = ['index.html', 'app.js', 'styles.css'];

/** The same thin answer for both versions, so a difference is layout and not data. */
const STUB_OWNER = { id: 'own_stub', email: 'owner@stub.test', role: 'owner' };
function stubPayload(requestPath: string): unknown {
  // Both versions must be able to answer "who is signed in", or the owner-only sections stay hidden
  // and the measurement is of a locked console. The session endpoints are answered identically.
  if (/^\/api\/(session\/me|session|me)$/.test(requestPath)) return { owner: STUB_OWNER, vaultConfigured: true };
  if (requestPath === '/api/session/login') return { token: 'synthetic-stub-session-token', owner: STUB_OWNER };
  if (requestPath === '/api/overview') {
    return {
      generatedAt: '2026-10-10T05:00:00Z', currency: 'USD', cards: [],
      agents: { total: 12, registry: 12, custom: 0 }, treasury: { currency: 'USD', totals: { totalBalanceCents: 0 }, wallets: [] },
      policy: { maxDepth: 2, prohibitions: [] }, approvals: { pending: 0 }, upgrades: { requested: 0 }, targets: [],
      revenue: { windows: { lifetimeCents: 0, todayCents: 0, last30DaysCents: 0 }, contractedCents: 0, expectedCents: 0, bySource: [], recent: [] },
      expenses: { paidCents: 0, pendingCents: 0, byCategory: [] }, costs: { monthlyCommittedCents: 0, spendTodayCents: 0, dailyCapCents: 0, byCategory: [] },
      audit: { ok: true, rows: 0 }, integrity: { ledger: { ok: true, rows: 0 } },
      honesty: { realizedRevenueOnly: true, noFabrication: 'verified only', externalActivationPending: [] },
      fleet: { registered: 12, withPlatform: 3, ready: 0, blocked: 1, needsOwnerAction: 3, earnedCents: 0, settledProofs: 0, nextAction: 'authorize a GitHub credential' },
    };
  }
  return { ok: true, note: 'stub payload, identical for both versions', currency: 'USD' };
}

function materialize(version: string, ref: string | null, root: string): void {
  const target = path.join(root, version, 'mission-dashboard');
  fs.mkdirSync(target, { recursive: true });
  for (const file of DASHBOARD_FILES) {
    const text = ref === null
      ? fs.readFileSync(path.join('mission-dashboard', file), 'utf8')
      : execFileSync('git', ['show', `${ref}:mission-dashboard/${file}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    // The console references its assets absolutely; per-version prefixes keep both copies servable
    // from one origin without editing the markup, which would change what is being measured.
    const rewritten = text.replace(/(href|src)="\/(app\.js|styles\.css|manifest\.webmanifest)"/g, `$1="/${version}/$2"`);
    fs.writeFileSync(path.join(target, file), rewritten);
  }
}

async function launchChromium(): Promise<any> {
  const { chromium } = await import('@playwright/test');
  if (process.env.MISSION_BROWSER_NPM_RUNTIME === 'true') {
    const runtime = (await import('@sparticuz/chromium' as never)).default as { executablePath: () => Promise<string> };
    const packageRoot = path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '..');
    const libs = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-heights-libs-'));
    execFileSync('tar', ['-xf', '-', '-C', libs], { input: brotliDecompressSync(fs.readFileSync(path.join(packageRoot, 'bin/al2023.tar.br'))) });
    return chromium.launch({
      executablePath: await runtime.executablePath(), headless: true,
      env: { PATH: process.env.PATH ?? '', HOME: os.tmpdir(), FONTCONFIG_PATH: process.env.FONTCONFIG_PATH ?? '', LD_LIBRARY_PATH: path.join(libs, 'lib') },
    });
  }
  return chromium.launch({ headless: true, ...(process.env.MISSION_BROWSER_EXECUTABLE ? { executablePath: process.env.MISSION_BROWSER_EXECUTABLE } : {}) });
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-dashboard-heights-'));
  materialize('before', REF, root);
  materialize('after', null, root);
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      unmatched.push(`${request.method} ${url.pathname}`);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(stubPayload(url.pathname)));
      return;
    }
    // The console references its assets absolutely (/app.js), so a version-prefixed request lands in
    // that version's dashboard directory.
    const requested = url.pathname.replace(/^\/+/, '');
    const candidates = [path.join(root, requested), path.join(root, requested.replace(/^([^/]+)\//, '$1/mission-dashboard/'))];
    const file = candidates.find(candidate => candidate.startsWith(root) && fs.existsSync(candidate));
    if (!file) { unmatched.push(`MISS ${url.pathname}`); response.writeHead(404); response.end('no'); return; }
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/javascript';
    response.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
    response.end(fs.readFileSync(file));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const browser = await launchChromium();
  const results: Record<string, Record<string, number>> = {};
  const pageErrors: string[] = [];
  const unmatched: string[] = [];
  const diagnostics: Record<string, Record<string, unknown>> = {};
  try {
    for (const version of ['before', 'after']) {
      const context = await browser.newContext({ viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } });
      const page = await context.newPage();
      page.on('pageerror', (error: Error) => pageErrors.push(`${version}: ${error.message}`));
      page.setDefaultTimeout(20000);
      await page.goto(`http://127.0.0.1:${port}/${version}/mission-dashboard/index.html`, { waitUntil: 'domcontentloaded' });
      // Sign in through the real form so the measured surface is the console, not the login panel.
      await page.locator('#email').fill('owner@stub.test');
      await page.locator('#password').fill('synthetic-stub-password');
      await page.locator('#login-button').click();
      try {
        await page.waitForSelector('#app:not([hidden])', { timeout: 8000 });
      } catch (error) {
        // Say what the console actually reported instead of leaving the next reader to guess: the
        // login form's own error line, plus any page error and any request the stub refused.
        const loginError = await page.locator('#login-error').textContent().catch(() => null);
        throw new Error(`${version}: the console never reached the signed-in shell (login error: ${JSON.stringify(loginError)}; page errors: ${JSON.stringify(pageErrors.slice(0, 3))}; requests: ${JSON.stringify(unmatched.slice(0, 5))})`);
      }
      await page.waitForTimeout(1200);
      // Passed as source rather than as a closure: the script is transpiled for Node, and a bundled
      // helper that does not exist in the browser would break evaluation before it measured anything.
      const script = `(async () => {
        const sections = ${JSON.stringify(SECTIONS[version])};
        const out = {};
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        for (const section of sections) {
          const button = document.querySelector('#tabs [data-tab="' + section + '"]') || document.querySelector('[data-tab="' + section + '"]');
          if (!button) continue;
          button.dispatchEvent(new Event('click', { bubbles: true }));
          await sleep(700);
          for (const details of Array.from(document.querySelectorAll('details'))) details.open = false;
          const panel = document.querySelector('[data-panel="' + section + '"]') || document.body;
          out[section + ':closed'] = panel.scrollHeight;
          const blocks = Array.from(panel.querySelectorAll('details.sub'));
          if (blocks.length === 0) { await sleep(200); out[section + ':full'] = panel.scrollHeight; }
          for (const details of blocks) {
            details.open = true;
            await sleep(400);
            out[section + ':' + (details.getAttribute('data-view') || 'block')] = panel.scrollHeight;
            details.open = false;
          }
        }
        return { heights: out, diagnostic: {
          banner: (document.querySelector('#banner')?.textContent || '').slice(0, 160),
          identity: (document.querySelector('#identity')?.textContent || '').slice(0, 80),
          buttons: Array.from(document.querySelectorAll('#tabs [data-tab]')).map(node => node.getAttribute('data-tab') + (node.hidden ? '(hidden)' : '')),
        } };
      })()`;
      const measured = await page.evaluate(script) as { heights: Record<string, number>; diagnostic: Record<string, unknown> };
      results[version] = measured.heights;
      diagnostics[version] = measured.diagnostic;
      await context.close();
    }
  } finally {
    await browser.close().catch(() => undefined);
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }

  const lines: string[] = [];
  lines.push(`sign-in diagnostic ${JSON.stringify(diagnostics)}`);
  lines.push(`measured at ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}, stub payload identical for both versions, three-screen limit ${THREE_SCREENS}px`);
  for (const version of ['before', 'after']) {
    for (const [key, px] of Object.entries(results[version])) lines.push(`${version.padEnd(7)} ${key.padEnd(28)} ${String(px).padStart(6)}px`);
  }
  const after = Object.values(results.after);
  const before = Object.values(results.before);
  assert.ok(after.length >= 4, `the current console must expose all four sections to the measurement, saw ${after.length}`);
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const max = (values: number[]) => values.reduce((tallest, value) => Math.max(tallest, value), 0);
  lines.push(`tallest state before ${max(before)}px, after ${max(after)}px; total rendered height before ${sum(before)}px, after ${sum(after)}px (${before.length ? Math.round((1 - sum(after) / sum(before)) * 100) : 0}% less)`);
  for (const [key, px] of Object.entries(results.after)) assert.ok(px <= THREE_SCREENS, `after-strip ${key} is ${px}px, over the ${THREE_SCREENS}px three-screen budget`);
  const evidenceDir = path.resolve('logs/mission-dashboard-heights');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const outFile = path.join(evidenceDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }, ref: REF, synthetic: true, pageErrors, diagnostics, results, summary: lines }, null, 2));
  process.stdout.write(`${lines.join('\n')}\nevidence: ${outFile}\n`);
  assert.deepEqual(pageErrors, [], 'the console must not throw while rendering either version');
}

const SECTIONS: Record<string, string[]> = {
  // The pre-strip console had 19 top-level panels; the four that matter for this comparison are the
  // ones that survived as sections, plus the panels that were folded or deleted, so each new section
  // can be read against everything it replaced.
  before: ['overview', 'bounties', 'approvals', 'earnings', 'money', 'treasury', 'withdraw', 'policy', 'audit', 'agents', 'tools', 'knowledge', 'playbooks', 'lessons', 'guide', 'head-chat', 'customer-work', 'resources-expiry', 'publishing'],
  after: ['overview', 'bounties', 'approvals', 'money'],
};

main().catch((error) => { process.stderr.write(`${(error as Error).stack ?? error}\n`); process.exitCode = 1; });
