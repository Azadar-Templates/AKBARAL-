#!/usr/bin/env node
/**
 * axe-core over the REAL mounted pages, in jsdom.
 *
 * Honest scope, stated up front: jsdom has no layout engine, so colour-contrast
 * and any rule that needs geometry are not evaluated here — they are covered by
 * scripts/responsive-audit.mjs, which resolves the cascade itself. What this
 * catches is structure: roles, names, labels, landmarks, duplicate ids, tab
 * order wiring. A real browser pass remains owner-verified.
 *
 * Usage: npx tsx --import ./scripts/responsive/register-hooks.mjs scripts/axe-jsdom.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { renderPage, PAGE_MODULES } from './responsive/render-page.mjs';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core'), 'utf8');

const WIDTH = Number((process.argv.find((a) => a.startsWith('--width=')) || '').slice(8) || 1440);
const PAGES = (process.argv.find((a) => a.startsWith('--pages=')) || '').slice(8).split(',').filter(Boolean)
  || [];
const targets = PAGES.length ? PAGES : Object.keys(PAGE_MODULES);

let serious = 0;
let total = 0;

for (const page of targets) {
  let window;
  try {
    ({ window } = await renderPage({ page, width: WIDTH }));
  } catch (cause) {
    console.log(`${page}: RENDER FAILED — ${cause?.message ?? cause}`);
    serious += 1;
    continue;
  }
  window.eval(axeSource);
  const results = await window.axe.run(window.document, {
    resultTypes: ['violations'],
    // No layout in jsdom: geometry rules would report noise, not truth.
    rules: { 'color-contrast': { enabled: false } },
  });
  const bad = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  total += results.violations.length;
  serious += bad.length;
  console.log(`${page}: ${results.violations.length} violation(s), ${bad.length} serious/critical`);
  for (const violation of bad) {
    console.log(`   [${violation.impact}] ${violation.id} — ${violation.help} (${violation.nodes.length} node(s))`);
    for (const node of violation.nodes.slice(0, 3)) console.log(`       ${node.target.join(' ')}`);
  }
}

console.log(serious
  ? `AXE_JSDOM: ${serious} serious/critical violation(s) across ${targets.length} pages`
  : `AXE_JSDOM: no serious/critical violations across ${targets.length} pages (${total} minor)`);
process.exit(serious ? 1 : 0);
