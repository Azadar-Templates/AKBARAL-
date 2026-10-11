#!/usr/bin/env node
/* ============================================================
 * Compile the mission copy pairs into what the console reads.
 *
 * ONE source of truth: `design-system/mission-copy.pairs.json` maps the English
 * source string (exactly as it is written in mission-dashboard/app.js, index.html,
 * styles.css and src/mission/*.ts — those literals stay put, because they are also
 * the anchors of the console's tests) to the Roman Urdu the owner reads. Nothing
 * else holds translations, so the file is either complete or the build says so.
 *
 * The output `mission-dashboard/copy.js` is generated, like tokens.css and ui.css:
 * it is the same bytes on every run, and `--check` proves the committed copy has
 * not drifted from the pairs file.
 *
 * This script is also the coverage gate. It re-derives the live set with the same
 * `inventory()` the audit used and fails on:
 *   · a source string with no pair           (user-facing copy left in English);
 *   · a pair whose key no longer exists      (a stale translation kept as truth);
 *   · an empty, Devanagari, or markup-bearing value;
 *   · a value whose '#' holes do not match the key's, which would drop a number,
 *     an id or a name on the way into the DOM.
 * Usage: node scripts/mission-copy-build.mjs [--check]
 * ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inventory, normalize } from './mission-copy-inventory.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAIRS = 'design-system/mission-copy.pairs.json';
const OUT = 'mission-dashboard/copy.js';
const DEVANAGARI = /[\u0900-\u097F]/;
const MARKUP = /<\/?[a-zA-Z][^>]*>/;

const pairs = JSON.parse(readFileSync(join(root, PAIRS), 'utf8'));
const rows = inventory(root);
const wanted = new Set();
for (const row of rows) wanted.add(row.key);

const problems = [];
for (const key of wanted) if (typeof pairs[key] !== 'string' || !pairs[key].trim()) problems.push(`no pair for: ${key}`);
for (const key of Object.keys(pairs)) if (!wanted.has(key)) problems.push(`stale pair, no such source string: ${key}`);
for (const [key, value] of Object.entries(pairs)) {
  if (DEVANAGARI.test(value)) problems.push(`Devanagari in the value for: ${key}`);
  if (MARKUP.test(value)) problems.push(`markup in the value for: ${key}`);
  const holes = normalize(key).split('#').length - 1;
  const filled = String(value).split('#').length - 1;
  if (holes !== filled) problems.push(`hole count ${holes} != ${filled} for: ${key}`);
}
if (problems.length) {
  console.error(`mission copy is not complete (${problems.length} problem(s)):`);
  for (const problem of problems.slice(0, 40)) console.error(`  · ${problem}`);
  if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`);
  process.exitCode = 1;
} else {
  const body = Object.entries(pairs)
    .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value).replace(/</g, '\\u003c')}`)
    .join(',\n');
  const text = `/* GENERATED — do not edit. Compiled from ${PAIRS} by scripts/mission-copy-build.mjs.\n *\n * The mission console's dictionary of human-facing copy: English source string → the Roman Urdu\n * the owner reads. Looked up by the console's copy layer in app.js (ur / urHtml). Keys are\n * normalized (every dynamic hole as '#'), which is why this file is data only: the sources keep\n * their own English literals, so no id, class, selector, storage key or test anchor moves when\n * the wording changes. Machine values are absent by construction — the inventory that produced\n * this set excludes anything with a code shape.\n */\nwindow.MISSION_COPY = {\n${body}\n};\n`;
  const file = join(root, OUT);
  if (process.argv[2] === '--check') {
    const current = readFileSync(file, 'utf8');
    if (current !== text) {
      console.error(`${OUT} is stale: run \`node scripts/mission-copy-build.mjs\`.`);
      process.exitCode = 1;
    } else {
      console.log(`${OUT}: in step with ${PAIRS} (${Object.keys(pairs).length} pairs).`);
    }
  } else {
    writeFileSync(file, text);
    console.log(`${OUT}: wrote ${Object.keys(pairs).length} pairs over ${rows.length} sink sites (${wanted.size} distinct keys).`);
  }
}
