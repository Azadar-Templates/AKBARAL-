/**
 * ZA141251SA — private Mission authentication, verified in a REAL browser.
 *
 * Covers the full owner journey and both denial paths through the actual UI
 * (not curl): sign in -> dashboard opens -> hard refresh keeps the session ->
 * logout -> sign in again -> a foreign email is denied -> a wrong password is
 * denied -> the public AKBARAL! tier exposes nothing of the mission.
 *
 * Credentials come from the environment ONLY:
 *   ZA141251SA_OWNER_EMAIL     the single permitted identity
 *   ZA141251SA_OWNER_PASSWORD  the configured owner password
 *
 * The password is never printed, never written to result.json, and cannot
 * appear in a screenshot (the field is type=password, so the UI renders dots).
 * Screenshots and the JSON summary are scrubbed defensively all the same.
 *
 *   ZA141251SA_OWNER_EMAIL=… ZA141251SA_OWNER_PASSWORD=… \
 *     node scripts/testing/mission-auth-verify.mjs
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
const PUBLIC_BASE = process.env.AKBARAL_BASE ?? 'http://127.0.0.1:3000';
const EMAIL = (process.env.ZA141251SA_OWNER_EMAIL ?? '').trim();
const PASSWORD = process.env.ZA141251SA_OWNER_PASSWORD ?? '';
const FOREIGN_EMAIL = process.env.MISSION_FOREIGN_EMAIL ?? 'intruder@example.com';

if (!EMAIL || !PASSWORD) {
  console.error('ZA141251SA_OWNER_EMAIL and ZA141251SA_OWNER_PASSWORD must be supplied through the environment.');
  process.exit(2);
}

/** Never let the secret escape into any artifact, however indirectly. */
const scrub = (value) =>
  String(value ?? '').split(PASSWORD).join('«configured owner password»');

const runtime = (await import('@sparticuz/chromium')).default;
const root = path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '..');
const libs = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-libs-'));
execFileSync('tar', ['-xf', '-', '-C', libs], {
  input: brotliDecompressSync(fs.readFileSync(path.join(root, 'bin/al2023.tar.br'))),
});

const outDir = path.resolve('logs/browser/mission-auth');
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
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: false });

/** Is the private dashboard currently open (i.e. authenticated)? */
const dashboardOpen = () =>
  page.evaluate(() => {
    const app = document.querySelector('#app');
    const login = document.querySelector('#login-panel');
    return {
      app: Boolean(app) && !app.hidden,
      login: Boolean(login) && !login.hidden,
      identity: document.querySelector('#identity')?.textContent?.trim() ?? '',
      sections: Array.from(document.querySelectorAll('#mainnav .navbtn')).length,
    };
  });

const signIn = async (email, password) => {
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('#login-button');
  await page.waitForTimeout(3500);
};

const loginError = () =>
  page.evaluate(() => {
    const box = document.querySelector('#login-error');
    return box && !box.hidden ? (box.textContent ?? '').trim() : '';
  });

// ── 1. the private dashboard loads and starts signed OUT ────────────────────
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2000);
let state = await dashboardOpen();
await shot('01-signed-out');
record(
  'mission preview loads and starts signed out',
  /ZA141251SA/.test(await page.title()) && state.login && !state.app,
  `title="${await page.title()}" identity="${state.identity}"`,
);

// ── 2. a foreign identity is denied (checked BEFORE the owner signs in) ─────
await signIn(FOREIGN_EMAIL, PASSWORD);
state = await dashboardOpen();
let error = await loginError();
await shot('02-foreign-identity-denied');
record(
  'a different email is denied by the identity lock',
  !state.app && state.login && error.length > 0,
  `error="${error}"`,
);

// ── 3. the owner email with a wrong password is denied ──────────────────────
await signIn(EMAIL, 'definitely-not-the-owner-password-2026');
state = await dashboardOpen();
error = await loginError();
await shot('03-wrong-password-denied');
record(
  'the owner email with a wrong password is denied',
  !state.app && state.login && error.length > 0,
  `error="${error}"`,
);

// ── 4. the configured owner signs in ────────────────────────────────────────
await signIn(EMAIL, PASSWORD);
state = await dashboardOpen();
await shot('04-owner-signed-in');
record(
  'the configured owner signs in and the private dashboard opens',
  state.app && !state.login && state.sections === 4,
  `identity="${state.identity}" sections=${state.sections}`,
);

// ── 5. a hard refresh keeps the session ─────────────────────────────────────
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(3000);
state = await dashboardOpen();
await shot('05-after-refresh');
record(
  'a hard refresh keeps the authenticated session',
  state.app && !state.login,
  `identity="${state.identity}"`,
);

// ── 6. logout ───────────────────────────────────────────────────────────────
// The sign-out control is only rendered once the dashboard has finished its
// first load, so wait for it rather than racing it.
await page.waitForSelector('#signout:not([hidden])', { timeout: 15000 });
await page.click('#signout');
await page.waitForFunction(() => {
  const app = document.querySelector('#app');
  const login = document.querySelector('#login-panel');
  return Boolean(app?.hidden) && Boolean(login) && !login.hidden;
}, undefined, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1000);
state = await dashboardOpen();
// The dashboard keeps its bearer token in sessionStorage (mission-dashboard/app.js).
const tokenCleared = await page.evaluate(() =>
  Object.keys(sessionStorage).filter((key) => sessionStorage.getItem(key)).length === 0 &&
  Object.keys(localStorage).filter((key) => /token|session/i.test(key) && localStorage.getItem(key)).length === 0,
);
await shot('06-after-logout');
record(
  'logout returns to the sign-in panel and clears the session',
  !state.app && state.login && tokenCleared,
  `app=${state.app} login=${state.login} storageCleared=${tokenCleared} identity="${state.identity}"`,
);

// ── 7. the session is dead server-side too (refresh must NOT restore it) ────
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2500);
state = await dashboardOpen();
record('after logout a refresh does not restore the dashboard', !state.app && state.login);

// ── 8. the owner can sign in again ──────────────────────────────────────────
await signIn(EMAIL, PASSWORD);
state = await dashboardOpen();
await shot('07-signed-in-again');
record('the owner can sign in again', state.app && !state.login, `identity="${state.identity}"`);

// ── 9/10. the public AKBARAL! tier exposes nothing of the mission ──────────
// The probe MUST run from the public origin itself: fetching :3000 from the
// mission page is cross-origin and fails on CORS, which would look like a pass
// without proving anything about what the public tier actually serves.
const publicPage = await context.newPage();
await publicPage.goto(PUBLIC_BASE, { waitUntil: 'load' });
await publicPage.waitForTimeout(4000);

const publicProbe = await publicPage.evaluate(async () => {
  const paths = [
    '/api/boss/overview',
    '/api/boss/agents',
    '/api/boss/treasury',
    '/api/boss/scheduler',
    '/api/mission',
    '/api/za141251sa',
    '/api/treasury',
    '/api/wallets',
    '/mission',
  ];
  const out = {};
  for (const target of paths) {
    try {
      const response = await fetch(target, { credentials: 'omit' });
      const body = (await response.text()).slice(0, 400);
      out[target] = {
        status: response.status,
        leaks: response.status === 200 && /mission_|totalAgents|treasury|fleet|walletBalance/i.test(body),
      };
    } catch {
      out[target] = { status: 'network_error', leaks: false };
    }
  }
  return out;
});
const probeSummary = Object.entries(publicProbe)
  .map(([target, value]) => `${target}=${value.status}`)
  .join(' ');
record(
  'the public AKBARAL! tier exposes no mission data (probed same-origin)',
  Object.values(publicProbe).every((value) => value.status !== 'network_error' && !value.leaks),
  probeSummary,
);

const publicMentions = await publicPage.evaluate(() => {
  const text = document.body.innerText || '';
  const links = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
  return {
    text: /ZA141251SA|Mission Control/i.test(text),
    links: links.filter((href) => /mission|za141251sa|:4200/i.test(href)),
  };
});
await publicPage.screenshot({ path: path.join(outDir, '08-public-tier-no-mission.png') });
await publicPage.close();
record(
  'the mission is absent from public navigation and copy',
  !publicMentions.text && publicMentions.links.length === 0,
  `links=${JSON.stringify(publicMentions.links)}`,
);

fs.writeFileSync(
  path.join(outDir, 'result.json'),
  scrub(
    JSON.stringify(
      { base: BASE, publicBase: PUBLIC_BASE, owner: EMAIL, passwordProvidedVia: 'environment', results },
      null,
      2,
    ),
  ),
);

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\nartifacts: ${outDir}\npassed=${results.length - failed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
