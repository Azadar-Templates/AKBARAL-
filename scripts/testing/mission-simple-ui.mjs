#!/usr/bin/env node
/**
 * ZA141251SA — simplified owner dashboard checks (real Chromium).
 *
 * Verifies the four primary sections work end to end against the running
 * mission server: Overview, Agents + chat, Withdraw, Card — plus the
 * collapsed Advanced area that still contains the full mission systems, and a
 * mobile-width pass over all four.
 *
 * Env: MISSION_BASE, ZA141251SA_OWNER_EMAIL, ZA141251SA_OWNER_PASSWORD
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

const outDir = path.resolve('logs/browser/mission-simple');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail: scrub(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${scrub(detail)}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: await runtime.executablePath(),
  headless: true,
  env: { PATH: process.env.PATH ?? '', HOME: os.tmpdir(), LD_LIBRARY_PATH: path.join(libs, 'lib') },
});
const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('response', (response) => {
  if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
});
const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });

const visibleSections = () =>
  page.$$eval('[data-view-panel]', (nodes) => nodes.filter((node) => !node.hidden).map((node) => node.getAttribute('data-view-panel')));

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('#login-button');
  await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(1500);

  // ── navigation is four sections only ────────────────────────────────────
  const navLabels = await page.$$eval('#mainnav .navbtn', (nodes) => nodes.map((node) => node.textContent.trim()));
  record('primary navigation has exactly 4 sections', navLabels.length === 4, navLabels.join(' | '));
  const advancedHidden = await page.$eval('#advanced', (node) => node.hidden);
  record('advanced controls are collapsed by default', advancedHidden === true);

  // ── 1. OVERVIEW ─────────────────────────────────────────────────────────
  const tiles = await page.$$eval('#home-money .tile', (nodes) =>
    nodes.map((node) => ({ label: node.querySelector('.label')?.textContent ?? '', value: node.querySelector('.value')?.textContent ?? '' })),
  );
  const hasBalance = tiles.some((tile) => /verified available/i.test(tile.label) && /\d/.test(tile.value));
  const hasEarned = tiles.some((tile) => /verified earned/i.test(tile.label));
  const hasAgents = tiles.some((tile) => /active agents/i.test(tile.label) && /\d/.test(tile.value));
  const hasWork = tiles.some((tile) => /work in progress/i.test(tile.label));
  const activityCount = await page.$$eval('#home-activity .row, #home-activity .empty', (nodes) => nodes.length);
  record(
    'overview shows balance, earnings, agents, work',
    hasBalance && hasEarned && hasAgents && hasWork,
    tiles.map((tile) => `${tile.label}=${tile.value}`).join('; '),
  );
  record('overview shows recent activity and alerts area', activityCount > 0);
  await shot('01-overview');

  // ── 2. AGENTS + CHAT ────────────────────────────────────────────────────
  await page.click('#mainnav .navbtn[data-view="agents"]');
  await page.waitForTimeout(1500);
  record('agents section opens alone', (await visibleSections()).join(',') === 'agents');
  const agentRows = await page.$$eval('#agent-cards .row', (nodes) => nodes.length);
  record('agent list renders with status and current activity', agentRows > 0, `${agentRows} agents listed`);

  const firstAgent = await page.$eval('#agent-cards .row .title', (node) => node.textContent.trim());
  await page.click('#agent-cards .row');
  await page.waitForSelector('#agent-detail:not([hidden])', { timeout: 15000 });
  await page.waitForSelector('#chat-log', { timeout: 15000 });
  record('an agent opens with detail and chat', true, `opened “${firstAgent}”`);

  const message = `Owner dashboard check ${new Date().toISOString()}`;
  await page.fill('#chat-form input[name="message"]', message);
  await page.click('#chat-form button[type="submit"]');
  await page.waitForTimeout(2000);
  const chatText = await page.textContent('#chat-log');
  record('owner can send a command/message to an agent', chatText.includes(message), 'message appears in the agent conversation');
  const chatNote = (await page.textContent('#chat-note')) ?? '';
  const readiness = (await page.textContent('#chat-readiness')) ?? '';
  record(
    'chat states the real reply capability',
    /READY|AI PROVIDER NOT CONFIGURED|BLOCKED/.test(readiness),
    readiness.replace(/\s+/g, ' ').trim().slice(0, 120),
  );
  record(
    'an unconfigured provider is reported truthfully instead of a fabricated reply',
    /AI PROVIDER NOT CONFIGURED/.test(readiness) ? !/\bagent\b · /.test(chatText.replace(message, '')) : true,
    /AI PROVIDER NOT CONFIGURED/.test(readiness) ? 'no answer invented while the provider is unconfigured' : 'provider configured — replies come from the chat pipeline',
  );
  const agentState = (await page.textContent('.agent-state')) ?? '';
  record(
    'the agent shows its real current work, history and capabilities',
    /Current work/.test(agentState) && /Completed work/.test(agentState) && /Capabilities/.test(agentState),
    agentState.replace(/\s+/g, ' ').trim().slice(0, 110),
  );
  await shot('02-agents-chat');

  // ── 3. WITHDRAW ─────────────────────────────────────────────────────────
  await page.click('#mainnav .navbtn[data-view="withdraw"]');
  await page.waitForTimeout(1500);
  record('withdraw section opens alone', (await visibleSections()).join(',') === 'withdraw');
  const withdrawTiles = await page.$$eval('#withdraw-tiles .tile', (nodes) =>
    nodes.map((node) => `${node.querySelector('.label')?.textContent}=${node.querySelector('.value')?.textContent}`),
  );
  const separation = withdrawTiles.some((tile) => /verified available/i.test(tile)) && withdrawTiles.some((tile) => /expected/i.test(tile));
  record('withdraw separates verified money from expected money', separation, withdrawTiles.join('; '));
  const actionText = await page.textContent('#withdraw-action');
  const hasForm = (await page.$('#simple-withdraw-form')) !== null;
  record('withdraw offers a button or explains why not', hasForm || actionText.trim().length > 20, hasForm ? 'withdraw form shown' : actionText.trim().slice(0, 90));
  const methods = await page.$$eval('#withdraw-destinations .method', (nodes) => nodes.length);
  const methodsText = (await page.textContent('#withdraw-destinations')) ?? '';
  const addButton = await page.isVisible('#add-method');
  record(
    'withdrawal methods reflect reality and can be added',
    addButton && (methods > 0 ? !/haven/.test(methodsText) : /haven’t set up any withdrawal methods yet|haven't set up any withdrawal methods yet/.test(methodsText)),
    `${methods} configured method${methods === 1 ? '' : 's'}; add control ${addButton ? 'present' : 'MISSING'}`,
  );
  const destinations = await page.$$eval('#withdraw-destinations .method, #withdraw-destinations .empty', (nodes) => nodes.length);
  const history = await page.$$eval('#withdraw-history .row, #withdraw-history .empty', (nodes) => nodes.length);
  record('withdraw shows destinations and withdrawal history', destinations > 0 && history > 0, `${destinations} destination rows, ${history} history rows`);
  await shot('03-withdraw');

  // ── 4. CARD ─────────────────────────────────────────────────────────────
  await page.click('#mainnav .navbtn[data-view="card"]');
  await page.waitForTimeout(1200);
  record('card section opens alone', (await visibleSections()).join(',') === 'card');
  const cardText = await page.textContent('#card-face');
  const cardDetail = await page.textContent('#card-detail');
  const cardCount = await page.$$eval('#card-face .cardface', (nodes) => nodes.length);
  const issuedCards = await page.$$eval('#card-face .cardface.issued', (nodes) => nodes.length);
  record(
    'the card area shows only real cards',
    issuedCards === 0 ? /No cards issued/i.test(cardText) && /NOT ISSUED/.test(cardText) : issuedCards === cardCount,
    `${issuedCards} issued card${issuedCards === 1 ? '' : 's'} rendered`,
  );
  record('card explains what a real card needs', /provider/i.test(cardDetail) && /CREDENTIAL REQUIRED|connected/i.test(cardDetail), cardDetail.replace(/\s+/g, ' ').trim().slice(0, 90));
  const cardMethodsVisible = await page.isVisible('#card-add-method');
  record('the card section exposes the same withdrawal methods', cardMethodsVisible, 'add-method control present in Card');
  await shot('04-card');

  // ── advanced still holds the full mission systems ───────────────────────
  await page.click('#advanced-toggle');
  await page.waitForTimeout(2500);
  const advancedTabs = await page.$$eval('#tabs .tab', (nodes) => nodes.map((node) => node.textContent.trim()));
  const advancedVisible = await page.$eval('#advanced', (node) => !node.hidden);
  record('advanced area still exposes every original system', advancedVisible && advancedTabs.length === 11, advancedTabs.join(' | '));
  await shot('05-advanced');
  await page.click('#advanced-toggle');
  await page.waitForTimeout(500);

  // ── mobile pass ─────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileIssues = [];
  for (const view of ['home', 'agents', 'withdraw', 'card']) {
    await page.click(`#mainnav .navbtn[data-view="${view}"]`);
    await page.waitForTimeout(1200);
    const open = await visibleSections();
    if (open.join(',') !== view) mobileIssues.push(`${view} did not open`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    if (overflow) mobileIssues.push(`${view} overflows horizontally`);
    await shot(`06-mobile-${view}`);
  }
  record('all four sections work at 390px wide with no horizontal overflow', mobileIssues.length === 0, mobileIssues.join('; ') || 'home, agents, withdraw, card');

  // ── still signed in, no runtime errors ──────────────────────────────────
  await page.setViewportSize({ width: 1280, height: 950 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const stillIn = await page.$eval('#app', (node) => !node.hidden);
  record('refresh keeps the simplified dashboard open', stillIn);
  record('no runtime errors or 5xx responses', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ base: BASE, results, errors: errors.map(scrub) }, null, 2));
  await browser.close();
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\nartifacts: ${outDir}`);
console.log(`passed=${results.length - failed.length} failed=${failed.length}`);
process.exit(failed.length ? 1 : 0);
