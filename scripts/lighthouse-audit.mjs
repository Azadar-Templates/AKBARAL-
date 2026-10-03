#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';

const root = process.cwd();
const port = Number(process.env.LIGHTHOUSE_PORT || 3200);
const url = process.env.LIGHTHOUSE_URL || `http://127.0.0.1:${port}/#/`;
const threshold = Number(process.env.LIGHTHOUSE_THRESHOLD || 0.9);
const categories = ['performance', 'accessibility', 'best-practices', 'seo'];

async function resolveChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (existsSync('/tmp/chromium')) {
    const chromium = await import('@sparticuz/chromium');
    const libPath = '/tmp/al2023/lib';
    if (!existsSync(libPath)) {
      await chromium.inflate(path.join(root, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br'));
    }
    chromium.setupLambdaEnvironment(libPath);
    return '/tmp/chromium';
  }
  return undefined;
}

async function waitForServer(target, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(target);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`production server did not become ready at ${target}`);
}

const ownsServer = !process.env.LIGHTHOUSE_URL;
const server = ownsServer
  ? spawn(process.execPath, [path.join(root, 'scripts/start-prod.mjs')], {
      cwd: root,
      env: {
        ...process.env,
        AKBARAL_WEB_PORT: String(port),
        AKBARAL_API_PORT: process.env.AKBARAL_API_PORT || '4000',
        DATABASE_URL: process.env.DATABASE_URL || 'file:./data/akbaral.db',
        BACKUP_DIR: process.env.BACKUP_DIR || './data/backups',
      },
      stdio: 'inherit',
    })
  : undefined;

try {
  await waitForServer(url);
  const chromePath = await resolveChromium();
  const chrome = await launch({
    chromePath,
    chromeFlags: [
      '--headless',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
  try {
    const result = await lighthouse(url, {
      port: chrome.port,
      output: ['json', 'html'],
      logLevel: 'error',
      onlyCategories: categories,
    });
    if (!result) throw new Error('Lighthouse returned no result');

    const scores = Object.fromEntries(categories.map((key) => [key, Math.round((result.lhr.categories[key]?.score ?? 0) * 100)]));
    const summary = {
      url,
      generatedAt: new Date().toISOString(),
      scores,
      thresholds: Object.fromEntries(categories.map((key) => [key, Math.round(threshold * 100)])),
      failingAudits: Object.values(result.lhr.audits)
        .filter((audit) => audit.score !== null && audit.score < 0.9 && audit.details?.type !== 'notApplicable')
        .map((audit) => ({ id: audit.id, title: audit.title, score: audit.score, displayValue: audit.displayValue ?? null }))
        .slice(0, 30),
    };

    const outputDir = path.join(root, process.env.LIGHTHOUSE_OUTPUT_DIR || 'artifacts/phase2a');
    mkdirSync(outputDir, { recursive: true });
    const reports = Array.isArray(result.report) ? result.report : [result.report];
    writeFileSync(path.join(outputDir, 'lighthouse-report.json'), String(reports[0] ?? ''));
    writeFileSync(path.join(outputDir, 'lighthouse-report.html'), String(reports[1] ?? ''));
    writeFileSync(path.join(outputDir, 'lighthouse-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));

    const below = categories.filter((key) => (result.lhr.categories[key]?.score ?? 0) < threshold);
    if (below.length) throw new Error(`Lighthouse categories below ${Math.round(threshold * 100)}: ${below.join(', ')}`);
  } finally {
    await chrome.kill();
  }
} finally {
  if (server && !server.killed) server.kill('SIGTERM');
}
