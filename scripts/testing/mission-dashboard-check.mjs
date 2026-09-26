/**
 * ZA141251SA private dashboard — real-browser smoke test.
 *
 * Signs the configured owner in through the mission UI (never the public
 * AKBARAL! app) and screenshots each private view. Credentials come from the
 * environment only; nothing is written to the repository.
 *
 *   ZA141251SA_OWNER_EMAIL=… ZA141251SA_OWNER_PASSWORD=… \
 *   node scripts/testing/mission-dashboard-check.mjs
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
const EMAIL = process.env.ZA141251SA_OWNER_EMAIL ?? '';
const PASSWORD = process.env.ZA141251SA_OWNER_PASSWORD ?? '';
if (!EMAIL || !PASSWORD) {
  console.error('ZA141251SA_OWNER_EMAIL and ZA141251SA_OWNER_PASSWORD are required.');
  process.exit(2);
}

const runtime = (await import('@sparticuz/chromium')).default;
const root = path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '..');
const libs = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-libs-'));
execFileSync('tar', ['-xf', '-', '-C', libs], {
  input: brotliDecompressSync(fs.readFileSync(path.join(root, 'bin/al2023.tar.br'))),
});

const outDir = path.resolve('logs/browser/mission');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: await runtime.executablePath(),
  headless: true,
  env: { PATH: process.env.PATH ?? '', HOME: os.tmpdir(), LD_LIBRARY_PATH: path.join(libs, 'lib') },
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(outDir, '01-login.png') });
record('mission login screen renders', /ZA141251SA/.test(await page.title()), await page.title());

await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('#login-button');
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(outDir, '02-dashboard.png'), fullPage: true });
const signedIn = await page.evaluate(() => {
  const app = document.querySelector('#app');
  return Boolean(app) && !app.hidden;
});
record('owner signs in to the private dashboard', signedIn);

for (const [tab, file] of [
  ['agents', '03-agents'],
  ['money', '04-verified-cash'],
  ['treasury', '05-treasury'],
  ['approvals', '06-approvals'],
  ['audit', '07-audit'],
]) {
  const link = page.locator(`button[data-tab="${tab}"]`).first();
  if ((await link.count()) === 0) {
    record(`${tab} view`, false, 'no navigation control found');
    continue;
  }
  await link.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, `${file}.png`), fullPage: true });
  record(`${tab} view renders`, true);
}

fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ base: BASE, results }, null, 2));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\nartifacts: ${outDir}\npassed=${results.length - failed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
