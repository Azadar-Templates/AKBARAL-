#!/usr/bin/env node
/* ============================================================
 * The mission console's human-facing copy, enumerated at the DOM sinks.
 *
 * WHY A SCRIPT AND NOT A HAND LIST. The translation file is only trustworthy if
 * "every user-facing string" is a checkable set rather than an impression. So the
 * set is derived the same way every time — and the same way the runtime resolves
 * copy — by reading the exact places a string can reach the owner:
 *   · mission-dashboard/app.js  → the `text:` / `label:` / `title:` / `placeholder:`
 *     / `alt:` props of el(…), and the `content` argument of the small helpers that
 *     feed them (pill, emptyState, notice, banner, confirm…), plus every
 *     `X.textContent = '…'` assignment;
 *   · mission-dashboard/index.html → every static text node, and the `placeholder`,
 *     `title` and `aria-label` attributes;
 *   · mission-dashboard/styles.css → `content: '…'` strings, which are text the
 *     owner reads;
 *   · src/mission/**\/\*.ts (non-test) → the message argument of every HttpProblem,
 *     MissionAuthError, MoneyError and the four label fields the console prints from
 *     the readiness report (label / action / verify / how), because the console shows
 *     those verbatim.
 * Machine values are NOT part of the set, by construction: a string is only counted
 * when it is prose (letters + a space) and carries no code shape. Codes, ids,
 * selectors, table names, env vars, file paths, URLs and `file:line` citations are
 * therefore never requested for translation.
 *
 * Usage: node scripts/mission-copy-inventory.mjs [--json|--scaffold|--count]
 * ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CODE_SHAPE = /[{}<>|\\`]|https?:\/\/|\bSELECT\b|\bFROM\b|\bWHERE\b|\.tsx?\b|\.mjs\b|\.css\b|\.sql\b|\/api\/|--[A-Z][A-Z_]+|^[A-Z][A-Z0-9_]{2,}$|#\w+|data-\w+|\b(?:pending|completed|cancelled|expired)$|_\w{3,}|\w+_\w+/;
const PROSE = /[A-Za-zÀ-ÿ][a-zà-ÿ]{2,}\s+[A-Za-zÀ-ÿ]/;
// A one-word label is copy too — the nav tabs, the table heads and the buttons are mostly this.
// Capitalised and lowercase-only is the tell: an all-caps or snake_case token is a machine value.
const LABEL = /^[A-ZÀ-Þ][a-zà-ÿ]{2,}$/;

/** The one normalization the runtime uses too: every dynamic hole becomes '#'. */
export function normalize(text) {
  return String(text)
    .replace(/\$\{[^{}]*\}/g, '#')
    .replace(/\b\d+(?:[.,]\d+)?\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}
export function isCopy(text) {
  const t = String(text ?? '').trim();
  if (t.length < 2) return false;
  if (!PROSE.test(t) && !LABEL.test(t)) return false;
  const shapeless = t.replace(/\$\{[^{}]*\}/g, '').replace(/\b\d+(?:[.,]\d+)?\b/g, '');
  if (CODE_SHAPE.test(shapeless)) return false;
  return true;
}

export function inventory(root = '.') {
  const rows = [];
  const seen = new Set();
  const add = (file, line, raw, site) => {
    const text = String(raw ?? '').trim();
    if (!isCopy(text)) return;
    const key = normalize(text);
    if (seen.has(`${file}:${key}`)) return;
    seen.add(`${file}:${key}`);
    rows.push({ file, line, site, key, text });
  };

  const app = readFileSync(`${root}/mission-dashboard/app.js`, 'utf8').split('\n');
  const PROP = /\b(text|label|title|placeholder|alt|caption|heading|hint|note|confirm|question)\s*:\s*'((?:[^'\\]|\\.)+)'/g;
  const HELPER = /\b(?:pill|emptyState|notice|banner|toast|say|confirmText|badge|fieldLabel|renderNotice|showQueueConfirmation)\(\s*(?:'[\w-]+'\s*,\s*)?'((?:[^'\\]|\\.)+)'/g;
  // The same sinks in their template-literal form: the console builds most of its dynamic
  // sentences with backticks, and `${…}` normalizes to a '#' hole exactly like a number.
  const PROP_TPL = /\b(?:text|label|title|placeholder|alt|caption|heading|hint|note|confirm|question)\s*:\s*`([^`\n]+)`/g;
  const HELPER_TPL = /\b(?:pill|emptyState|notice|banner|toast|say|confirmText|badge|fieldLabel|renderNotice|showQueueConfirmation)\(\s*(?:'[\w-]+'\s*,\s*)?`([^`\n]+)`/g;
  const ASSIGN_TPL = /\.textContent\s*=\s*(?:ur\(\s*)?`([^`\n]+)`/g;
  // `(?:ur\(\s*)?` reads through the console's own copy layer: a literal the runtime wraps for
  // translation is still the same source string, and the pairs file is keyed by that literal.
  const ASSIGN = /\.textContent\s*=\s*(?:ur\(\s*)?'((?:[^'\\]|\\.)+)'/g;
  const HTMLCHUNK = /html:\s*`([^`]*)`/g;
  app.forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const re of [PROP, HELPER, ASSIGN, PROP_TPL, HELPER_TPL, ASSIGN_TPL]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        // PROP carries the prop name in group 1 and the string in group 2; the rest carry only the string.
        const text = re === PROP ? m[2] : m[1];
        if (text) add('mission-dashboard/app.js', index + 1, text, 'prop');
      }
    }
    HTMLCHUNK.lastIndex = 0;
    let hm;
    while ((hm = HTMLCHUNK.exec(line))) {
      for (const t of hm[1].matchAll(/>([^<>{}]+)</g)) add('mission-dashboard/app.js', index + 1, t[1], 'html-chunk');
    }
  });

  const html = readFileSync(`${root}/mission-dashboard/index.html`, 'utf8');
  const head = html.slice(0, html.indexOf('<body>') + 6);
  const offset = head.split('\n').length;
  const bodyHtml = html
    .slice(head.length)
    .replace(/<script[\s\S]*?<\/script>|<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, ' '));
  // One pass over the whole body, NOT line by line: a static paragraph that wraps
  // across lines is ONE text node in the DOM, and a translation table that is keyed
  // per source line could never be looked up at runtime. Matching `>…<` on the joined
  // body yields exactly the nodes a TreeWalker sees (an inline <code> splits a
  // paragraph the same way on both sides), so inventory key == runtime key.
  const decode = (t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  const lineOf = (index) => offset + bodyHtml.slice(0, index).split('\n').length - 1;
  for (const t of bodyHtml.matchAll(/>([^<>]+)</g)) {
    const raw = decode(t[1]);
    // Re-escape nothing; a node that literally contains markup is not prose copy.
    if (/[<>]/.test(raw)) continue;
    add('mission-dashboard/index.html', lineOf(t.index), raw, 'text-node');
  }
  bodyHtml.split('\n').forEach((line, index) => {
    for (const a of line.matchAll(/\b(placeholder|title|aria-label)="([^"]+)"/g)) {
      add('mission-dashboard/index.html', offset + index, decode(a[2]), `${a[1]}=`);
    }
  });

  const css = readFileSync(`${root}/mission-dashboard/styles.css`, 'utf8').split('\n');
  css.forEach((line, index) => {
    for (const c of line.matchAll(/content:\s*'([^']+)'/g)) add('mission-dashboard/styles.css', index + 1, c[1].replace(/[^\w\s.,:;!?()'"-]/g, ' '), 'content:');
  });

  const serverFiles = [
    'src/mission/server.ts', 'src/mission/auth.ts', 'src/mission/human-action-gate.ts', 'src/mission/human-action-queue.ts',
    'src/mission/head-agent.ts', 'src/mission/policy.ts', 'src/mission/self-management.ts', 'src/mission/social.ts',
    'src/mission/money.ts', 'src/mission/earning/fleet-readiness.ts', 'src/mission/earning/agent-class-contracts.ts',
    'src/mission/earning/registry.ts', 'src/mission/earning/opportunities.ts',
  ];
  for (const file of serverFiles) {
    let lines;
    try { lines = readFileSync(`${root}/${file}`, 'utf8').split('\n'); } catch { continue; }
    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const re of [
        /HttpProblem\(\s*\d+\s*,\s*'((?:[^'\\]|\\.)+)'/g,
        /MissionAuthError\(\s*\d+\s*,\s*'((?:[^'\\]|\\.)+)'/g,
        /new MoneyError\([^,]+,\s*'((?:[^'\\]|\\.)+)'/g,
        /\b(?:label|action|verify|how)\s*:\s*'((?:[^'\\]|\\.)+)'/g,
      ]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line))) add(file, index + 1, m[1], 'server');
      }
    });
  }
  return rows;
}

// The CLI only: importing `inventory` for the build script or a test must not print a report.
if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  const mode = process.argv[2] ?? '--list';
  const rows = inventory('.');
  const uniq = new Map();
  for (const r of rows) if (!uniq.has(r.key)) uniq.set(r.key, r);
  if (mode === '--json') console.log(JSON.stringify(rows, null, 1));
  else if (mode === '--scaffold') {
    const out = {};
    for (const r of rows) if (!(r.key in out)) out[r.key] = '';
    writeFileSync('/tmp/mission-copy-scaffold.json', JSON.stringify(out, null, 1) + '\n');
    console.log(`scaffold: ${Object.keys(out).length} keys → /tmp/mission-copy-scaffold.json`);
  } else if (mode === '--count') {
    console.log(`sink sites: ${rows.length}; distinct copy keys: ${uniq.size}`);
  } else {
    console.log(`distinct: ${uniq.size}`);
    for (const r of uniq.values()) console.log(`\t${r.key}`);
  }
}
