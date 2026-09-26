#!/usr/bin/env node
/**
 * ZA141251SA — dashboard stability probe.
 *
 * Signs in through the real UI and then WATCHES the dashboard for a dwell
 * period (default 60s), sampling visibility once a second and recording every
 * console message, page error, failed request, HTTP >= 400 response and frame
 * navigation. If the dashboard closes on its own, the timeline shows exactly
 * what happened immediately before it.
 *
 * Env:
 *   MISSION_BASE                 base url (default http://127.0.0.1:4200)
 *   ZA141251SA_OWNER_EMAIL       owner identity
 *   ZA141251SA_OWNER_PASSWORD    owner password (never printed; scrubbed)
 *   DWELL_SECONDS                how long to watch after sign-in (default 60)
 *   TAB_CLICKS                   1 to click through every dashboard tab
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const BASE = process.env.MISSION_BASE ?? 'http://127.0.0.1:4200';
const EMAIL = (process.env.ZA141251SA_OWNER_EMAIL ?? '').trim();
const PASSWORD = process.env.ZA141251SA_OWNER_PASSWORD ?? '';
const DWELL = Number(process.env.DWELL_SECONDS ?? 60);
const TAB_CLICKS = process.env.TAB_CLICKS === '1';
// Emulates an embedded preview re-creating the frame: every web-storage area
// is wiped before a reload, leaving only the HttpOnly session cookie.
const WIPE_STORAGE = process.env.WIPE_STORAGE === '1';

if (!EMAIL || !PASSWORD) {
  console.error('ZA141251SA_OWNER_EMAIL and ZA141251SA_OWNER_PASSWORD must be supplied through the environment.');
  process.exit(2);
}

const scrub = (value) => String(value ?? '').split(PASSWORD).join('«configured owner password»');

const runtime = (await import('@sparticuz/chromium')).default;
const root = path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '..');
const libs = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-libs-'));
execFileSync('tar', ['-xf', '-', '-C', libs], {
  input: brotliDecompressSync(fs.readFileSync(path.join(root, 'bin/al2023.tar.br'))),
});

const outDir = path.resolve('logs/browser/mission-stability');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const started = Date.now();
const stamp = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
const timeline = [];
const note = (kind, detail) => {
  const entry = { at: stamp(), kind, detail: scrub(detail) };
  timeline.push(entry);
  console.log(`[${entry.at}] ${kind}: ${entry.detail}`);
};

const browser = await chromium.launch({
  executablePath: await runtime.executablePath(),
  headless: true,
  env: { PATH: process.env.PATH ?? '', HOME: os.tmpdir(), LD_LIBRARY_PATH: path.join(libs, 'lib') },
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

page.on('console', (message) => {
  if (['error', 'warning'].includes(message.type())) note(`console.${message.type()}`, message.text());
});
page.on('pageerror', (error) => note('pageerror', error.message));
page.on('requestfailed', (request) => note('requestfailed', `${request.method()} ${request.url()} — ${request.failure()?.errorText}`));
page.on('response', (response) => {
  if (response.status() >= 400) note('http', `${response.status()} ${response.request().method()} ${response.url()}`);
});
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) note('navigated', frame.url());
});
page.on('websocket', (ws) => note('websocket', ws.url()));

const uiState = () =>
  page.evaluate(() => {
    const app = document.querySelector('#app');
    const login = document.querySelector('#login-panel');
    return {
      app: Boolean(app) && !app.hidden,
      login: Boolean(login) && !login.hidden,
      identity: document.querySelector('#identity')?.textContent?.trim() ?? '',
      views: document.querySelectorAll('#mainnav .navbtn').length,
      tiles: document.querySelectorAll('[data-view-panel]:not([hidden]) .tile').length,
      tabs: document.querySelectorAll('#tabs .tab').length,
      cards: document.querySelectorAll('#overview .card, #overview .stat, [data-panel="overview"] .card').length,
      token: Boolean(sessionStorage.getItem('za_mission_token')),
      cookies: document.cookie.length,
      banner: document.querySelector('#banner')?.textContent?.trim() ?? '',
    };
  });

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail: scrub(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${scrub(detail)}` : ''}`);
};

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-panel:not([hidden])', { timeout: 15000 });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('#login-button');
  await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
  note('signed-in', JSON.stringify(await uiState()));
  record('owner login', true);

  // ── dwell: watch the dashboard for as long as a person would ──────────────
  let closedAt = null;
  let samples = 0;
  for (let second = 0; second < DWELL; second += 1) {
    await page.waitForTimeout(1000);
    const state = await uiState();
    samples += 1;
    if (!state.app && !closedAt) {
      closedAt = stamp();
      note('DASHBOARD CLOSED', JSON.stringify(state));
      await page.screenshot({ path: path.join(outDir, 'closed.png') });
    }
    if (second % 10 === 9) note('sample', JSON.stringify(state));
  }
  const afterDwell = await uiState();
  record(
    `dashboard stays visible for ${DWELL}s`,
    !closedAt && afterDwell.app && !afterDwell.login,
    closedAt ? `closed at ${closedAt}` : `still open after ${samples} samples, identity="${afterDwell.identity}"`,
  );
  record(
    'dashboard data loads',
    afterDwell.views === 4 && afterDwell.tiles >= 4,
    `views=${afterDwell.views} tiles=${afterDwell.tiles}`,
  );

  // ── the four primary sections ─────────────────────────────────────────────
  if (TAB_CLICKS && afterDwell.app) {
    const views = await page.$$eval('#mainnav .navbtn', (nodes) => nodes.map((node) => node.getAttribute('data-view')));
    const viewFailures = [];
    for (const view of views) {
      await page.click(`#mainnav .navbtn[data-view="${view}"]`);
      await page.waitForTimeout(900);
      const state = await uiState();
      if (!state.app) {
        viewFailures.push(`${view} closed the dashboard`);
        break;
      }
      const shown = await page
        .$$eval('[data-view-panel]', (nodes) => nodes.filter((node) => !node.hidden).map((node) => node.getAttribute('data-view-panel')))
        .catch(() => []);
      if (shown.length !== 1 || shown[0] !== view) viewFailures.push(`${view} not shown alone (${shown.join(',') || 'none'})`);
    }
    record('primary sections remain usable', viewFailures.length === 0, viewFailures.join('; ') || `${views.length} sections opened`);
    await page.click('#mainnav .navbtn[data-view="home"]');
    await page.waitForTimeout(600);
  }

  // ── advanced tabs ─────────────────────────────────────────────────────────
  if (TAB_CLICKS && afterDwell.app) {
    const advancedHidden = await page.$eval('#advanced', (node) => node.hidden).catch(() => true);
    if (advancedHidden) {
      await page.click('#advanced-toggle');
      await page.waitForTimeout(2500);
    }
    const tabs = await page.$$eval('#tabs .tab', (nodes) => nodes.map((node) => node.getAttribute('data-tab')));
    let tabFailures = [];
    for (const tab of tabs) {
      await page.click(`#tabs .tab[data-tab="${tab}"]`);
      await page.waitForTimeout(1200);
      const state = await uiState();
      if (!state.app) {
        tabFailures.push(`${tab} closed the dashboard`);
        break;
      }
      const visible = await page.$eval(`[data-panel="${tab}"]`, (node) => !node.hidden).catch(() => false);
      if (!visible) tabFailures.push(`${tab} panel not shown`);
    }
    record('mission tabs remain usable', tabFailures.length === 0, tabFailures.join('; ') || `${tabs.length} tabs opened`);
  }

  // ── hard refresh ──────────────────────────────────────────────────────────
  if (WIPE_STORAGE) {
    await page.evaluate(() => {
      try { sessionStorage.clear(); } catch { /* ignore */ }
      try { localStorage.clear(); } catch { /* ignore */ }
    });
    note('storage wiped', 'emulating a re-created preview frame (cookie only)');
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const afterReload = await uiState();
  record(
    WIPE_STORAGE ? 'dashboard recovers after the frame loses web storage' : 'hard refresh keeps the dashboard',
    afterReload.app && !afterReload.login,
    `identity="${afterReload.identity}"`,
  );

  // ── stays authenticated after a further wait ─────────────────────────────
  await page.waitForTimeout(15000);
  const afterWait = await uiState();
  record('session still authenticated 15s after refresh', afterWait.app, `identity="${afterWait.identity}"`);
  await page.screenshot({ path: path.join(outDir, 'after-dwell.png') });

  // ── explicit logout, then log in again ───────────────────────────────────
  if (afterWait.app) {
    await page.waitForSelector('#signout:not([hidden])', { timeout: 10000 });
    await page.click('#signout');
    await page
      .waitForFunction(() => {
        const app = document.querySelector('#app');
        const login = document.querySelector('#login-panel');
        return Boolean(app?.hidden) && Boolean(login) && !login.hidden;
      }, undefined, { timeout: 15000 })
      .catch(() => {});
    const loggedOut = await uiState();
    record('logout on the owner’s click', !loggedOut.app && loggedOut.login && !loggedOut.token, JSON.stringify(loggedOut));

    await page.fill('#email', EMAIL);
    await page.fill('#password', PASSWORD);
    await page.click('#login-button');
    await page.waitForSelector('#app:not([hidden])', { timeout: 20000 }).catch(() => {});
    const again = await uiState();
    record('login again', again.app, `identity="${again.identity}"`);
  }
} finally {
  fs.writeFileSync(
    path.join(outDir, 'result.json'),
    JSON.stringify({ base: BASE, dwellSeconds: DWELL, results, timeline }, null, 2),
  );
  await browser.close();
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\nartifacts: ${outDir}`);
console.log(`passed=${results.length - failed.length} failed=${failed.length}`);
process.exit(failed.length ? 1 : 0);
