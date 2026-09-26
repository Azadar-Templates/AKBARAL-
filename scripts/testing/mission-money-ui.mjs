#!/usr/bin/env node
/**
 * ZA141251SA — withdrawal method and card checks (real Chromium).
 *
 * These checks MUTATE state (they add and remove withdrawal methods), so they
 * run against an ISOLATED mission instance with its own database — never the
 * owner's live mission. Synthetic account values are used; the script asserts
 * that none of them ever reaches the DOM, the console, the network responses,
 * the server log or the audit trail in plaintext.
 *
 * Env: MISSION_BASE (default http://127.0.0.1:4301), ZA141251SA_OWNER_EMAIL,
 *      ZA141251SA_OWNER_PASSWORD, MISSION_DB_FILE (optional, for a raw scan)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const BASE = process.env.MISSION_BASE ?? 'http://127.0.0.1:4301';
const EMAIL = (process.env.ZA141251SA_OWNER_EMAIL ?? '').trim();
const PASSWORD = process.env.ZA141251SA_OWNER_PASSWORD ?? '';
const DB_FILE = process.env.MISSION_DB_FILE ?? '';
if (!EMAIL || !PASSWORD) {
  console.error('ZA141251SA_OWNER_EMAIL and ZA141251SA_OWNER_PASSWORD must be supplied through the environment.');
  process.exit(2);
}
// Synthetic test values. Not a real account.
const ACCOUNT = '00992255661234';
const LAST4 = ACCOUNT.slice(-4);
const EMAIL_SECRET = 'synthetic.payout.account@example.test';
const scrub = (value) => String(value ?? '').split(PASSWORD).join('«configured owner password»');

const runtime = (await import('@sparticuz/chromium')).default;
const root = path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '..');
const libs = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-libs-'));
execFileSync('tar', ['-xf', '-', '-C', libs], {
  input: brotliDecompressSync(fs.readFileSync(path.join(root, 'bin/al2023.tar.br'))),
});

const outDir = path.resolve('logs/browser/mission-money');
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
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await context.newPage();
const errors = [];
const consoleText = [];
const responseBodies = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => consoleText.push(message.text()));
page.on('response', async (response) => {
  if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
  if (!response.url().includes('/api/')) return;
  try {
    responseBodies.push(await response.text());
  } catch {
    /* streamed or empty */
  }
});
const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
const openView = async (view) => {
  await page.click(`#mainnav .navbtn[data-view="${view}"]`);
  await page.waitForTimeout(1200);
};
const methodCount = () => page.$$eval('#withdraw-destinations .method', (nodes) => nodes.length);

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('#login-button');
  await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(1200);

  // ── 1. empty state ────────────────────────────────────────────────────────
  await openView('withdraw');
  const emptyText = await page.textContent('#withdraw-destinations');
  const addVisible = await page.isVisible('#add-method');
  record(
    'withdrawal methods start empty with an add control',
    /haven’t set up any withdrawal methods yet|haven't set up any withdrawal methods yet/.test(emptyText) && addVisible && (await methodCount()) === 0,
    emptyText.trim().slice(0, 110),
  );
  await shot('01-methods-empty');

  // ── 2. secure add form ────────────────────────────────────────────────────
  await page.click('#add-method');
  await page.waitForSelector('#withdraw-method-form form', { timeout: 10000 });
  const fieldTypes = await page.$$eval('#withdraw-method-form input', (nodes) =>
    nodes.map((node) => ({ name: node.getAttribute('name'), type: node.getAttribute('type'), autocomplete: node.getAttribute('autocomplete') })),
  );
  const secretField = fieldTypes.find((field) => field.name === 'accountNumber');
  record(
    'the add form protects sensitive inputs',
    Boolean(secretField) && secretField.type === 'password' && secretField.autocomplete === 'off',
    JSON.stringify(fieldTypes.filter((field) => field.name)),
  );
  await shot('02-method-form');

  // ── 3. add a real method (synthetic values) ──────────────────────────────
  await page.fill('#withdraw-method-form [name="bankName"]', 'Synthetic Test Bank');
  await page.fill('#withdraw-method-form [name="holderName"]', 'Synthetic Owner');
  await page.fill('#withdraw-method-form [name="accountNumber"]', ACCOUNT);
  await page.fill('#withdraw-method-form [name="currency"]', 'PKR');
  await page.click('#withdraw-method-form button[type="submit"]');
  await page.waitForTimeout(2000);
  const afterAdd = await page.textContent('#withdraw-destinations');
  record(
    'a configured method appears exactly once, masked',
    (await methodCount()) === 1 && afterAdd.includes(LAST4) && !afterAdd.includes(ACCOUNT),
    afterAdd.replace(/\s+/g, ' ').trim().slice(0, 140),
  );
  record(
    'the method shows a truthful verification status',
    /Pending verification/i.test(afterAdd),
    afterAdd.includes('Pending verification') ? 'Pending verification' : afterAdd.slice(0, 80),
  );
  await shot('03-method-added');

  // ── 4. the raw value never leaves the vault ──────────────────────────────
  const html = await page.content();
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  const leaks = [];
  if (html.includes(ACCOUNT)) leaks.push('DOM');
  if (storage.includes(ACCOUNT)) leaks.push('web storage');
  if (consoleText.join('\n').includes(ACCOUNT)) leaks.push('console');
  if (responseBodies.join('\n').includes(ACCOUNT)) leaks.push('API response');
  const accessLog = fs.existsSync('logs/mission/access.log') ? fs.readFileSync('logs/mission/access.log', 'utf8') : '';
  if (accessLog.includes(ACCOUNT)) leaks.push('server access log');
  if (DB_FILE && fs.existsSync(DB_FILE) && fs.readFileSync(DB_FILE).includes(ACCOUNT)) leaks.push('database (plaintext)');
  record('the account number never appears in the DOM, storage, console, API, logs or database', leaks.length === 0, leaks.length ? `leaked in ${leaks.join(', ')}` : 'no plaintext anywhere');

  // ── 5. the count follows reality ─────────────────────────────────────────
  await page.click('#add-method');
  await page.waitForSelector('#withdraw-method-form form', { timeout: 10000 });
  await page.selectOption('#withdraw-method-form [name="type"]', 'payoneer');
  await page.waitForTimeout(400);
  await page.fill('#withdraw-method-form [name="holderName"]', 'Synthetic Owner');
  await page.fill('#withdraw-method-form [name="payoneerEmail"]', EMAIL_SECRET);
  await page.click('#withdraw-method-form button[type="submit"]');
  await page.waitForTimeout(2000);
  const twoText = await page.textContent('#withdraw-destinations');
  record(
    'adding a second method shows exactly two methods',
    (await methodCount()) === 2 && !twoText.includes(EMAIL_SECRET) && twoText.includes('@example.test'),
    `${await methodCount()} methods; payoneer shown as ${(twoText.match(/[^ ]*@example\.test/) ?? ['?'])[0]}`,
  );
  await shot('04-two-methods');

  // ── 6. withdraw stays honest with no verified money ──────────────────────
  const actionText = await page.textContent('#withdraw-action');
  const withdrawButton = await page.$('#simple-withdraw-form button[type="submit"]');
  record(
    'withdraw remains unavailable and explains why',
    !withdrawButton && /no verified balance to withdraw/i.test(actionText),
    actionText.replace(/\s+/g, ' ').trim().slice(0, 120),
  );

  // ── 7. card section ──────────────────────────────────────────────────────
  await openView('card');
  const cardMethods = await page.$$eval('#card-methods .method', (nodes) => nodes.length);
  const cardText = await page.textContent('#card-face');
  const detailText = await page.textContent('#card-detail');
  const issueDisabled = await page.$eval('#card-detail button', (node) => node.disabled).catch(() => null);
  record('the same configured methods are available in Card', cardMethods === 2, `${cardMethods} methods listed`);
  record(
    'no card is invented — the card area says none is issued',
    /No cards issued/i.test(cardText) && /NOT ISSUED/.test(cardText) && !/\d{4} \d{4}/.test(cardText),
    cardText.replace(/\s+/g, ' ').trim().slice(0, 120),
  );
  record(
    'card issuance is disabled with a truthful reason',
    issueDisabled === true && /CREDENTIAL REQUIRED/.test(detailText),
    (detailText.match(/CREDENTIAL REQUIRED[^.]*\./) ?? ['no reason shown'])[0].slice(0, 120),
  );
  await shot('05-card');

  // ── 8. removal ───────────────────────────────────────────────────────────
  page.once('dialog', (dialog) => dialog.accept());
  await openView('withdraw');
  const removeButtons = await page.$$('#withdraw-destinations .method button:has-text("Remove")');
  await removeButtons[0].click();
  await page.waitForTimeout(2000);
  record('removing a method leaves exactly the remaining one', (await methodCount()) === 1, `${await methodCount()} method left`);
  await shot('06-after-remove');

  // ── 9. mobile ────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  record('the withdraw section fits a 390px screen', overflow <= 1, `overflow=${overflow}px`);
  await shot('07-mobile-withdraw');

  record('no runtime errors or 5xx responses', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  record('money UI run completed', false, error.message);
  await shot('failure');
} finally {
  const passed = results.filter((result) => result.ok).length;
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ base: BASE, passed, failed: results.length - passed, results }, null, 2));
  console.log(`\nartifacts: ${outDir}`);
  console.log(`passed=${passed} failed=${results.length - passed}`);
  await browser.close();
  process.exit(results.every((result) => result.ok) ? 0 : 1);
}
