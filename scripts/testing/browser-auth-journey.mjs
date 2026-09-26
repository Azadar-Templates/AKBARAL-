#!/usr/bin/env node
/**
 * AKBARAL! — REAL BROWSER authentication + surface journey.
 *
 * Drives a real Chromium (the pinned @sparticuz/chromium runtime, because the
 * sandbox has no Playwright CDN access) against the RUNNING stack on :3000 and
 * asserts what a human actually gets:
 *
 *   landing → sign up → (session) → dashboard → MASTER → hard refresh →
 *   sign out → sign in again → every application screen renders
 *
 * Nothing here is mocked: the browser talks to the Next tier on :3000, which
 * proxies /api to the Express tier on :4000, which talks to the real SQLite
 * database. Screenshots of every step land in logs/browser/<run>/.
 *
 * Usage: node scripts/testing/browser-auth-journey.mjs [--base http://127.0.0.1:3000]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const BASE = (() => {
  const index = process.argv.indexOf('--base');
  return index >= 0 ? process.argv[index + 1] : 'http://127.0.0.1:3000';
})();
const RUN = process.env.BROWSER_RUN_DIR || path.resolve('logs/browser', String(Date.now()));
fs.mkdirSync(RUN, { recursive: true });

const results = [];
let failures = 0;
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function launch() {
  const runtime = (await import('@sparticuz/chromium')).default;
  const packageRoot = path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '..');
  const libs = fs.mkdtempSync(path.join(os.tmpdir(), 'akbaral-browser-libs-'));
  execFileSync('tar', ['-xf', '-', '-C', libs], {
    input: brotliDecompressSync(fs.readFileSync(path.join(packageRoot, 'bin/al2023.tar.br'))),
  });
  return chromium.launch({
    executablePath: await runtime.executablePath(),
    headless: true,
    env: { PATH: process.env.PATH ?? '', HOME: os.tmpdir(), LD_LIBRARY_PATH: path.join(libs, 'lib') },
  });
}

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(RUN, `${name}.png`), fullPage: false });
};

/** Which SPA screen is on screen right now (the shell toggles [data-screen]). */
async function activeScreen(page) {
  return page.evaluate(() => {
    const visible = Array.from(document.querySelectorAll('.screen')).filter((node) => !node.hidden);
    return visible.map((node) => (node.id || '').replace('screen-', '')).join(',');
  });
}

async function sessionTokens(page) {
  return page.evaluate(() => ({
    access: localStorage.getItem('ak_access'),
    refresh: localStorage.getItem('ak_refresh'),
    keys: Object.keys(localStorage),
  }));
}

const stamp = Date.now();
const EMAIL = process.env.JOURNEY_EMAIL || `browser.journey.${stamp}@akbaral.test`;
const PASSWORD = process.env.JOURNEY_PASSWORD || 'Str0ng-Passw0rd-2026!';
const NAME = 'Browser Journey';

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);

const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
// Sandbox egress is allowlisted (GitHub/npm only), so the Google Fonts
// stylesheet legitimately fails here. It is a non-blocking, media="print"
// link — recorded, but it is an environment fact, not a product defect.
const externalFailures = [];
page.on('requestfailed', (request) => {
  if (!request.url().startsWith(BASE)) externalFailures.push(`${request.url()} (${request.failure()?.errorText})`);
});
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const text = message.text();
  if (/ERR_CONNECTION_CLOSED|ERR_NAME_NOT_RESOLVED|_next\/hmr/.test(text)) return; // external/dev-only
  consoleErrors.push(`console: ${text}`);
});
const apiCalls = [];
page.on('response', (response) => {
  const url = response.url();
  if (url.includes('/api/')) apiCalls.push(`${response.status()} ${response.request().method()} ${new URL(url).pathname}`);
});

try {
  /* 1 — landing ------------------------------------------------------- */
  await page.goto(`${BASE}/#/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const title = await page.title();
  const brandOk = await page.evaluate(() => document.body.innerText.includes('AKBARAL!'));
  const noBadBrand = await page.evaluate(() => !/AKBARAL\s+AI/i.test(document.body.innerText));
  record('landing renders', title.includes('AKBARAL!'), `title="${title}"`);
  record('landing shows the AKBARAL! brand', brandOk);
  record('brand is never written as "AKBARAL AI"', noBadBrand);
  await shot(page, '01-landing');

  /* 2 — sign up ------------------------------------------------------- */
  await page.goto(`${BASE}/#/register`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  record('sign-up screen renders', (await activeScreen(page)).includes('auth'), await activeScreen(page));
  await shot(page, '02-signup');
  await page.fill('#auth-name', NAME);
  await page.fill('#auth-email', EMAIL);
  await page.fill('#auth-password', PASSWORD);
  await page.click('#auth-submit');
  await page.waitForTimeout(3500);
  // The product deliberately does NOT auto-sign-in after registration: it
  // confirms the account and switches to the sign-in card with the same
  // credentials. Assert exactly that, then sign in for real.
  const signupFeedback = await page.evaluate(() => document.querySelector('#auth-feedback')?.textContent?.trim() || '');
  record(
    'sign up creates the account and hands over to sign-in',
    /account created/i.test(signupFeedback) && (await page.evaluate(() => location.hash)) === '#/login',
    `feedback="${signupFeedback}"`,
  );
  await shot(page, '03-after-signup');

  await page.fill('#auth-email', EMAIL);
  await page.fill('#auth-password', PASSWORD);
  await page.click('#auth-submit');
  await page.waitForTimeout(4000);
  const afterSignup = await activeScreen(page);
  const tokensAfterSignup = await sessionTokens(page);
  record(
    'first sign-in enters the application with a real session',
    Boolean(tokensAfterSignup.access) && !afterSignup.includes('auth'),
    `screen=${afterSignup} hash=${await page.evaluate(() => location.hash)}`,
  );
  await shot(page, '03b-after-first-signin');

  /* 3 — dashboard ----------------------------------------------------- */
  await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const dashScreen = await activeScreen(page);
  record('dashboard renders for a signed-in user', dashScreen.includes('dashboard'), dashScreen);
  await shot(page, '04-dashboard');

  /* 4 — MASTER -------------------------------------------------------- */
  await page.goto(`${BASE}/#/master`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const masterScreen = await activeScreen(page);
  record('MASTER renders', masterScreen.includes('master'), masterScreen);
  await shot(page, '05-master');

  /* 5 — hard refresh keeps the session -------------------------------- */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const afterReload = await activeScreen(page);
  const tokensAfterReload = await sessionTokens(page);
  record(
    'hard refresh keeps the session (no bounce to sign-in)',
    Boolean(tokensAfterReload.access) && !afterReload.includes('auth'),
    `screen=${afterReload}`,
  );
  await shot(page, '06-after-refresh');

  /* 6 — every application screen -------------------------------------- */
  const screens = [
    ['agents', 'agents'],
    ['marketplace', 'marketplace'],
    ['factory', 'factory'],
    ['projects', 'workspace'],
    ['automations', 'automations'],
    ['crm', 'crm'],
    ['billing', 'billing'],
    ['settings', 'settings'],
  ];
  for (const [hash, expected] of screens) {
    await page.goto(`${BASE}/#/${hash}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    const current = await activeScreen(page);
    record(`#/${hash} renders`, current.includes(expected), current);
    await shot(page, `07-${hash}`);
  }

  /* 7 — logout -------------------------------------------------------- */
  await page.goto(`${BASE}/#/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const logout = await page.$('#logout-btn, [data-action="logout"], button:has-text("Sign out")');
  if (logout) {
    await logout.click();
  } else {
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button,a')).find((node) =>
        /sign out|log ?out/i.test(node.textContent || ''),
      );
      if (button) button.click();
    });
  }
  await page.waitForTimeout(2500);
  const tokensAfterLogout = await sessionTokens(page);
  record('logout clears the session token', !tokensAfterLogout.access, `keys=${tokensAfterLogout.keys.join('|')}`);
  await shot(page, '08-after-logout');

  /* 8 — protected route while signed out ------------------------------ */
  await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const guarded = await activeScreen(page);
  record('signed-out visit to #/dashboard is redirected to sign-in', guarded.includes('auth'), guarded);

  /* 9 — sign in again -------------------------------------------------- */
  await page.goto(`${BASE}/#/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.fill('#auth-email', EMAIL);
  await page.fill('#auth-password', PASSWORD);
  await shot(page, '09-signin');
  await page.click('#auth-submit');
  await page.waitForTimeout(3500);
  const afterLogin = await activeScreen(page);
  const tokensAfterLogin = await sessionTokens(page);
  record(
    'sign in again enters the application',
    Boolean(tokensAfterLogin.access) && !afterLogin.includes('auth'),
    `screen=${afterLogin}`,
  );
  await shot(page, '10-after-signin');

  /* 10 — mobile viewport ---------------------------------------------- */
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`${BASE}/#/`, { waitUntil: 'domcontentloaded' });
  await mobilePage.waitForTimeout(2000);
  const overflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  record('mobile 390px has no horizontal overflow', overflow <= 1, `overflow=${overflow}px`);
  await mobilePage.screenshot({ path: path.join(RUN, '11-mobile-landing.png'), fullPage: false });
  await mobile.close();

  record('no uncaught page errors during the journey', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
  console.log(
    `note: ${externalFailures.length} external resource request(s) failed because the sandbox blocks outbound egress: ` +
      `${[...new Set(externalFailures.map((entry) => new URL(entry.split(' ')[0]).host))].join(', ') || 'none'}`,
  );
} catch (error) {
  record('journey completed without throwing', false, error instanceof Error ? error.message : String(error));
  await shot(page, 'zz-failure');
} finally {
  fs.writeFileSync(
    path.join(RUN, 'result.json'),
    JSON.stringify({ base: BASE, email: EMAIL, results, apiCalls, consoleErrors, externalFailures }, null, 2),
  );
  await browser.close();
}

console.log(`\nartifacts: ${RUN}`);
console.log(`passed=${results.length - failures} failed=${failures}`);
process.exit(failures === 0 ? 0 : 1);
