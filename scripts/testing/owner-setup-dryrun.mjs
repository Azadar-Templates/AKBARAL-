#!/usr/bin/env node
/**
 * Dry-run of the one-time owner-password setup page against a THROWAWAY mission
 * instance (its own database, its own port, a throwaway identity). This proves
 * the page works end to end before the real one-time link is handed to the
 * mission owner — the real database is never touched and the real password is
 * never involved.
 *
 * Usage: node scripts/testing/owner-setup-dryrun.mjs <baseUrl> <setupUrl>
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);

const base = process.argv[2];
const setupUrl = process.argv[3];
if (!base || !setupUrl) {
  console.error('usage: owner-setup-dryrun.mjs <baseUrl> <setupUrl>');
  process.exit(2);
}

const EXPECTED = [
  'Owner password set',
  'Owner signs in',
  'Session survives a full page reload',
  'Sign-out invalidates the session',
  'A different email is refused',
  'A wrong password is refused',
];

const runtime = (await import('@sparticuz/chromium')).default;
const root = path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '..');
const libs = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-libs-'));
execFileSync('tar', ['-xf', '-', '-C', libs], {
  input: brotliDecompressSync(fs.readFileSync(path.join(root, 'bin/al2023.tar.br'))),
});

const browser = await chromium.launch({
  executablePath: await runtime.executablePath(),
  headless: true,
  env: { PATH: process.env.PATH ?? '', HOME: os.tmpdir(), LD_LIBRARY_PATH: path.join(libs, 'lib') },
});
const page = await browser.newPage();
const failures = [];

try {
  await page.goto(setupUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#setup-panel:not([hidden])', { timeout: 15000 });

  // A throwaway password for a throwaway identity on a throwaway database.
  const password = `dryrun-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  await page.fill('#new-password', password);
  await page.fill('#confirm-password', password);
  await page.click('#setup-button');

  await page.waitForFunction(
    () => {
      const note = document.querySelector('#progress-note');
      return Boolean(note && note.textContent && /All checks passed|failed|could not/i.test(note.textContent));
    },
    undefined,
    { timeout: 45000 },
  );

  const items = await page.$$eval('#checklist li', (nodes) =>
    nodes.map((node) => ({ text: node.textContent ?? '', className: node.className })),
  );
  const note = await page.textContent('#progress-note');

  for (const label of EXPECTED) {
    const item = items.find((entry) => entry.text.includes(label));
    if (!item) failures.push(`missing check: ${label}`);
    else if (!item.text.startsWith('PASS')) failures.push(`check not green: ${item.text}`);
  }
  if (!/All checks passed/i.test(note ?? '')) failures.push(`summary not green: ${note}`);

  // The consumed link must not be replayable.
  const replay = await page.evaluate(async (url) => {
    const token = (/token=([^&]+)/.exec(url) ?? [])[1] ?? '';
    const response = await fetch('/api/owner-setup/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password: 'replay-attempt-password-123456' }),
    });
    return response.status;
  }, setupUrl);
  if (replay === 200) failures.push(`consumed link was replayable (status ${replay})`);

  for (const item of items) console.log(item.text);
  console.log('summary:', note);
  console.log('replay status:', replay);
} finally {
  await browser.close();
}

if (failures.length) {
  for (const failure of failures) console.error('FAIL', failure);
  process.exit(1);
}
console.log('dry run: all setup-page checks green');
