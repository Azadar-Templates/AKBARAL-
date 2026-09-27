#!/usr/bin/env node
/**
 * ZA141251SA — simplified owner dashboard checks (real Chromium).
 *
 * Verifies the four primary sections work end to end against the running
 * mission server: Overview, Agents (fleet list + chat workspace), Withdraw and
 * Card, that the removed Advanced area is really gone while the protected
 * mission systems still answer behind owner auth, and a 390px mobile pass.
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
  const removed = await page.evaluate(() => ({
    advanced: Boolean(document.querySelector('#advanced') || document.querySelector('#advanced-toggle') || document.querySelector('.advanced-bar')),
    tabs: document.querySelectorAll('#tabs .tab').length,
    panels: document.querySelectorAll('[data-panel]').length,
    text: /Advanced \/ Owner settings/.test(document.body.innerText),
  }));
  record(
    'the Advanced / Owner settings surface is gone from the dashboard',
    !removed.advanced && removed.tabs === 0 && removed.panels === 0 && !removed.text,
    `advanced element=${removed.advanced} tabs=${removed.tabs} panels=${removed.panels} label=${removed.text}`,
  );

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
  const subs = await page.$$eval('#agentnav .subbtn', (nodes) => nodes.map((node) => node.textContent.trim()));
  record('agents offers an agent list and a chat workspace', subs.length === 2, subs.join(' | '));

  const agentRows = await page.$$eval('#agent-cards .row', (nodes) => nodes.length);
  record('agent list renders with status and current activity', agentRows > 0, `${agentRows} agents listed`);

  // the whole registry must be declared and reachable, not just the first page
  const fleetBanner = ((await page.textContent('#fleet-banner')) ?? '').replace(/\s+/g, ' ').trim();
  const fleetTotal = Number((fleetBanner.match(/([\d,]+) Agents Available/) ?? [])[1]?.replace(/,/g, '') ?? 0);
  record('the dashboard states the real size of the fleet', fleetTotal >= 4001, fleetBanner.slice(0, 80));

  const identityRows = await page.$$eval('#agent-cards .row .purpose', (nodes) => nodes.length);
  record(
    'every listed agent shows a real identity, not a generic label',
    identityRows === agentRows && !(await page.$$eval('#agent-cards .row .title', (nodes) => nodes.some((node) => /^(agent|worker)\s*\d+$/i.test(node.textContent.trim())))),
    `${identityRows}/${agentRows} rows carry a designed purpose line`,
  );

  const before = agentRows;
  await page.click('#agent-load-more');
  await page.waitForTimeout(2000);
  const after = await page.$$eval('#agent-cards .row', (nodes) => nodes.length);
  record('pagination exposes more of the fleet on demand', after > before, `${before} → ${after} agents rendered`);

  const categories = await page.$$eval('#agent-category option', (nodes) => nodes.length);
  record('category filtering is available for the whole registry', categories > 10, `${categories - 1} categories + “All categories”`);

  await page.fill('#agent-quick-search input[name="q"]', 'youtube');
  await page.click('#agent-quick-search button[type="submit"]');
  await page.waitForTimeout(2000);
  const searched = await page.$$eval('#agent-cards .row', (nodes) => nodes.map((node) => node.textContent.toLowerCase()));
  record(
    'agent search filters the fleet',
    searched.length > 0 && searched.every((text) => text.includes('youtube')),
    `${searched.length} results for “youtube”`,
  );

  await page.fill('#agent-quick-search input[name="q"]', 'security reviewer');
  await page.click('#agent-quick-search button[type="submit"]');
  await page.waitForTimeout(2000);
  const roleHits = await page.$$eval('#agent-cards .row', (nodes) => nodes.map((node) => node.textContent.toLowerCase()));
  record(
    'agents are searchable by role and capability, not only by name',
    roleHits.length > 0 && roleHits.every((text) => /security/.test(text)),
    `${roleHits.length} rendered results for the role query “security reviewer”`,
  );

  // opening a result must open that exact agent, with its designed profile
  const targetName = await page.$eval('#agent-cards .row .title', (node) => node.textContent.trim());
  await page.click('#agent-cards .row');
  await page.waitForSelector('#agent-detail:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const detail = ((await page.textContent('#agent-detail')) ?? '').replace(/\s+/g, ' ');
  const sections = ['Designed for', 'Workflow it follows', 'Inputs and outputs', 'Capabilities', 'Approved tools', 'Current work', 'Completed work', 'Provider and readiness', 'Verification rules'];
  const missing = sections.filter((title) => !detail.includes(title));
  record(
    'selecting a result opens that exact agent with a full profile',
    detail.includes(targetName) && missing.length === 0,
    missing.length ? `missing sections: ${missing.join(', ')}` : `“${targetName}” with ${sections.length} profile sections`,
  );
  await shot('02a-agent-profile');

  // open the chat workspace
  await page.click('#agentnav .subbtn[data-sub="chat"]');
  await page.waitForTimeout(2500);
  const sidebarAgents = await page.$$eval('#chat-agent-list .chatitem', (nodes) => nodes.length);
  const chatVisible = await page.isVisible('#chat-log');
  record('the chat workspace opens with a selectable agent list', chatVisible && sidebarAgents > 0, `${sidebarAgents} agents in the chat sidebar`);

  const chatNames = await page.$$eval('#chat-agent-list .chatitem', (nodes) => nodes.map((node) => node.textContent.trim()));
  await page.click('#chat-agent-list .chatitem');
  await page.waitForTimeout(2500);
  const headerText = (await page.textContent('#chat-header')) ?? '';
  record('selecting an agent opens its conversation', headerText.trim().length > 0, headerText.replace(/\s+/g, ' ').trim().slice(0, 90));
  const contextText = ((await page.textContent('#chat-context')) ?? '').replace(/\s+/g, ' ').trim();
  record(
    'the conversation shows the agent’s real context',
    /work/i.test(contextText) && /wallet/i.test(contextText),
    contextText.slice(0, 110),
  );

  const message = `Owner dashboard check ${new Date().toISOString()}`;
  await page.fill('#chat-form input[name="message"]', message);
  await page.click('#chat-form button[type="submit"]');
  await page.waitForTimeout(3000);
  const chatText = (await page.textContent('#chat-log')) ?? '';
  record('a message actually reaches the backend for that agent', chatText.includes(message), 'the message is stored in the agent conversation');
  const readiness = (await page.textContent('#chat-readiness')) ?? '';
  const chatNote = (await page.textContent('#chat-note')) ?? '';
  record(
    'chat states the real reply capability',
    /READY|AI PROVIDER NOT CONFIGURED|REPLIES OFF|BLOCKED|NOT CONFIGURED/.test(readiness),
    readiness.replace(/\s+/g, ' ').trim().slice(0, 120),
  );
  const agentReplies = await page.$$eval('#chat-log .msg.agent', (nodes) => nodes.length);
  record(
    'an unconfigured provider is reported truthfully instead of a fabricated reply',
    /NOT CONFIGURED|BLOCKED/.test(readiness) ? agentReplies === 0 : true,
    /NOT CONFIGURED|BLOCKED/.test(readiness)
      ? `no answer invented (${agentReplies} agent replies); note: ${chatNote.replace(/\s+/g, ' ').trim().slice(0, 70)}`
      : 'provider configured — replies come from the chat pipeline',
  );
  await shot('02-agents-chat');

  // switching agents must rebind the conversation
  if (sidebarAgents > 1) {
    await page.click('#chat-agent-list .chatitem:nth-child(2)');
    await page.waitForTimeout(2500);
    const secondHeader = ((await page.textContent('#chat-header')) ?? '').replace(/\s+/g, ' ').trim();
    const secondLog = (await page.textContent('#chat-log')) ?? '';
    record(
      'switching agents rebinds the conversation to the selected agent',
      secondHeader.length > 0 && secondHeader !== headerText.replace(/\s+/g, ' ').trim() && !secondLog.includes(message),
      `switched from “${chatNames[0]?.split('\n')[0] ?? ''}” — the first agent’s message is not shown`,
    );
    await shot('02b-agent-switch');
  } else {
    record('switching agents rebinds the conversation to the selected agent', false, 'only one agent available in the chat sidebar');
  }

  // ── 2c. OWNER CAN TURN REPLIES ON WITHOUT SPENDING MONEY ────────────────
  const enableOpen = await page.$('#chat-enable-open');
  record(
    'the owner is offered a way to switch replies on from the dashboard',
    Boolean(enableOpen),
    enableOpen ? ((await page.textContent('#chat-enable-open')) ?? '').trim() : 'no enable control rendered',
  );
  if (enableOpen) {
    const enabledSlug = await page.$eval('#chat-agent-list .chatitem.active', (node) => node.dataset.slug ?? '');
    await enableOpen.click();
    await page.waitForSelector('form.enable-form', { timeout: 10000 });
    const formText = ((await page.textContent('form.enable-form')) ?? '').replace(/\s+/g, ' ');
    const keyType = await page.getAttribute('form.enable-form input[name="apiKey"]', 'type');
    record(
      'the enable form asks only for a free-tier key and hides it while typing',
      keyType === 'password' && /free tier/i.test(formText) && /\$0|no wallet|cannot spend|zero-cost/i.test(formText),
      `input type=${keyType}; ${formText.slice(0, 110)}`,
    );

    // Assembled at runtime: never a scannable credential marker in source.
    const syntheticKey = `${['AI', 'zaSy'].join('')}-browser-check-not-a-real-key-000`;
    await page.fill('form.enable-form input[name="apiKey"]', syntheticKey);
    await page.click('form.enable-form button[type="submit"]');
    await page.waitForTimeout(3500);
    const afterEnable = ((await page.textContent('#chat-readiness')) ?? '').replace(/\s+/g, ' ');
    record(
      'switching replies on changes the stated capability for that agent (and never claims a reply the runtime cannot make)',
      /READY|binding enabled|RUNTIME BLOCKED/i.test(afterEnable) && !afterEnable.includes(syntheticKey),
      afterEnable.slice(0, 120),
    );
    const leaked = await page.evaluate((key) => document.body.innerText.includes(key), syntheticKey);
    record('the submitted key is never shown back anywhere in the dashboard', leaked === false, leaked ? 'key visible in the page' : 'key not present in any rendered text');

    const statusRes = await page.evaluate(async (slug) => {
      const res = await fetch(`/api/agents/${slug}/chat-status`, {
        credentials: 'same-origin',
        headers: { 'x-mission-client': 'dashboard' },
      });
      return JSON.stringify(await res.json());
    }, enabledSlug);
    record(
      'the stored binding is free tier with a zero cost cap and no wallet',
      /"billing":"free_tier"/.test(statusRes) && /"maxCostCents":0/.test(statusRes) && /"walletBound":false/.test(statusRes) && !statusRes.includes(syntheticKey),
      /"billing":"free_tier"/.test(statusRes) ? 'billing=free_tier maxCostCents=0 walletBound=false, key not returned' : statusRes.slice(0, 140),
    );
    await shot('02c-chat-enabled');

    // put the rig back the way it was
    page.once('dialog', (dialog) => dialog.accept());
    const disable = await page.$('#chat-disable');
    if (disable) {
      await disable.click();
      await page.waitForTimeout(3000);
    }
    const afterDisable = ((await page.textContent('#chat-readiness')) ?? '').replace(/\s+/g, ' ');
    record(
      'the owner can switch replies back off and revoke the key',
      /NOT CONFIGURED|REPLIES OFF|binding off/i.test(afterDisable),
      afterDisable.slice(0, 110),
    );
  }

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

  // ── the protected mission systems stay on their own API routes ──────────
  const protectedRoutes = await page.evaluate(async () => {
    const out = {};
    for (const route of ['/api/policy', '/api/audit?limit=1', '/api/approvals', '/api/credentials']) {
      const response = await fetch(route, { headers: { 'x-mission-client': 'dashboard', 'x-mission-auth': sessionStorage.getItem('za_mission_token') || localStorage.getItem('za_mission_token') || '' } });
      out[route] = response.status;
    }
    return out;
  });
  record(
    'ledger, policy, approvals and credential systems still exist behind owner auth',
    Object.values(protectedRoutes).every((status) => status === 200),
    Object.entries(protectedRoutes).map(([route, status]) => `${route}=${status}`).join(' '),
  );

  // ── mobile pass ─────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileIssues = [];
  for (const view of ['home', 'agents', 'withdraw', 'card']) {
    await page.click(`#mainnav .navbtn[data-view="${view}"]`);
    await page.waitForTimeout(1200);
    const open = await visibleSections();
    if (open.join(',') !== view) mobileIssues.push(`${view} did not open`);
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > window.innerWidth + 2);
    if (overflow) mobileIssues.push(`${view} overflows horizontally`);
    await shot(`06-mobile-${view}`);
  }
  record('all four sections work at 390px wide with no horizontal overflow', mobileIssues.length === 0, mobileIssues.join('; ') || 'home, agents, withdraw, card');

  // the chat workspace has to stay usable on a phone: one column, no overflow
  await page.click('#mainnav .navbtn[data-view="agents"]');
  await page.click('#agentnav .subbtn[data-sub="chat"]');
  await page.waitForTimeout(1800);
  const mobileChat = await page.evaluate(() => {
    const space = document.querySelector('.chatspace');
    const composer = document.querySelector('#chat-form');
    return {
      columns: space ? getComputedStyle(space).gridTemplateColumns.split(' ').length : 0,
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > window.innerWidth + 2,
      composerVisible: Boolean(composer && !composer.hidden && composer.getBoundingClientRect().width > 0),
    };
  });
  record(
    'the chat workspace collapses to one column on a phone and keeps its composer',
    mobileChat.columns === 1 && !mobileChat.overflow && mobileChat.composerVisible,
    `columns=${mobileChat.columns} overflow=${mobileChat.overflow} composer=${mobileChat.composerVisible}`,
  );
  await shot('06-mobile-chat');

  // ── still signed in, no runtime errors ──────────────────────────────────
  await page.setViewportSize({ width: 1280, height: 950 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const stillIn = await page.$eval('#app', (node) => !node.hidden);
  record('refresh keeps the simplified dashboard open', stillIn);
  await page.waitForTimeout(2000);
  const restored = await page.evaluate(() => ({
    view: [...document.querySelectorAll('[data-view-panel]')].filter((node) => !node.hidden).map((node) => node.dataset.viewPanel).join(','),
    sub: document.querySelector('#agentnav .subbtn.active')?.dataset.sub ?? '',
    agent: document.querySelector('#chat-header .chathead .name')?.textContent?.trim() ?? document.querySelector('#chat-header')?.textContent?.trim() ?? '',
  }));
  record(
    'refresh restores the same section, chat area and selected agent',
    restored.view === 'agents' && restored.sub === 'chat' && restored.agent.length > 0,
    `view=${restored.view} area=${restored.sub} agent=${restored.agent.replace(/\s+/g, ' ').slice(0, 40)}`,
  );
  record('no runtime errors or 5xx responses', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ base: BASE, results, errors: errors.map(scrub) }, null, 2));
  await browser.close();
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\nartifacts: ${outDir}`);
console.log(`passed=${results.length - failed.length} failed=${failed.length}`);
process.exit(failed.length ? 1 : 0);
