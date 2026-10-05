#!/usr/bin/env node
/**
 * Responsive matrix — every page, every width, no screenshots.
 *
 * Two independent gates run over the SAME tree a signed-in person gets,
 * produced by actually mounting the page components (scripts/responsive/):
 *
 *  1. BREAKPOINT STATE — the agent shell must be in the documented state at
 *     each width (drawers closed below 1024, icon rail 1024–1279, three panes
 *     from 1280). Read straight off the rendered attributes.
 *
 *  2. CASCADE SAFETY — the delivered DOM at that width is handed to
 *     scripts/responsive-audit.mjs, which resolves the winning declaration for
 *     every element and reports overflow, unreadable text, untappable targets
 *     and clipped nowrap text.
 *
 * Usage:
 *   node --import ./scripts/responsive/register-hooks.mjs scripts/responsive-matrix.mjs
 *   …   [--widths=320,375,…] [--pages=/chat,/work] [--json] [--skip-cascade]
 */
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { renderPage, PAGE_MODULES } from './responsive/render-page.mjs';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

export const WIDTHS = arg('widths', '320,375,414,640,768,1024,1280,1440,1920').split(',').map(Number);
const PAGES = arg('pages', Object.keys(PAGE_MODULES).join(',')).split(',');
const AS_JSON = process.argv.includes('--json');
const SKIP_CASCADE = process.argv.includes('--skip-cascade');
const OUT_DIR = '.next/responsive-matrix';

/**
 * The documented agent-shell state per width band. Source of truth for both
 * this harness and src/app/responsive-matrix.test.ts.
 */
export function expectedAgentState(width) {
  if (width < 1024) return { rail: 'drawer-closed', panel: 'closed' };
  if (width < 1280) return { rail: 'icons', panel: 'closed' };
  return { rail: 'expanded', panel: 'collapsible' };
}

/** Reads the agent-shell state back out of the rendered document. */
export function readAgentState(doc) {
  const session = doc.querySelector('.session');
  if (!session) return null;
  const railEl = doc.querySelector('.sessionRail');
  const panelEl = doc.querySelector('.sessionPanel');
  return {
    rail: session.getAttribute('data-rail'),
    panel: session.getAttribute('data-panel'),
    hasIconStrip: Boolean(doc.querySelector('.railIcons')),
    railHidden: Boolean(railEl?.hasAttribute('hidden')),
    panelHidden: Boolean(panelEl?.hasAttribute('hidden')),
    hasRailToggle: Boolean(doc.querySelector('.railOpenButton')),
  };
}

/** Elements that must never be able to push the page sideways. */
const LONG_TEXT_PROBE = {
  title: 'A'.repeat(200),
  url: `https://example.test/${'segment-'.repeat(60)}`,
  token: 'x'.repeat(220),
};

export async function runMatrix({ widths = WIDTHS, pages = PAGES, skipCascade = SKIP_CASCADE } = {}) {
  const problems = [];
  const states = [];
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  for (const width of widths) {
    const parts = [];
    for (const page of pages) {
      let rendered;
      try {
        rendered = await renderPage({ page, width });
      } catch (cause) {
        problems.push({ kind: 'render-failed', page, width, detail: cause?.message ?? String(cause) });
        continue;
      }
      const { html, document: doc } = rendered;

      // Gate 1 — breakpoint state for the agent shell.
      if (page === '/chat') {
        const state = readAgentState(doc);
        if (state) states.push({ width, ...state });
        if (!state) {
          problems.push({ kind: 'missing-session-grid', page, width, detail: 'no .session element rendered' });
        } else {
          const want = expectedAgentState(width);
          if (state.rail !== want.rail) {
            problems.push({ kind: 'breakpoint-state', page, width, detail: `rail should be "${want.rail}" at ${width}px, is "${state.rail}"` });
          }
          if (want.rail === 'icons' && !state.hasIconStrip) {
            problems.push({ kind: 'breakpoint-state', page, width, detail: `rail should render the icon strip at ${width}px` });
          }
          if (want.rail === 'drawer-closed' && !state.railHidden) {
            problems.push({ kind: 'breakpoint-state', page, width, detail: `closed rail drawer must not occupy the grid at ${width}px` });
          }
          if (want.panel === 'closed' && state.panel !== 'closed') {
            problems.push({ kind: 'breakpoint-state', page, width, detail: `right panel must start closed at ${width}px` });
          }
          if (!state.hasRailToggle) {
            problems.push({ kind: 'breakpoint-state', page, width, detail: 'no rail toggle in the session bar' });
          }
        }
      }

      // Gate 1b — every page must expose a usable escape from a drawer-only nav.
      const usesAppShell = Boolean(doc.querySelector('.shell'));
      if (usesAppShell && width < 1024 && !doc.querySelector('.mobileMenu, .railOpenButton, .railIconButton')) {
        problems.push({ kind: 'no-nav-affordance', page, width, detail: 'no menu/rail control rendered below 1024px' });
      }

      parts.push(`<main data-audit-page="${page}" data-audit-surface="">${html}</main>`);
    }

    if (skipCascade) continue;
    const file = `${OUT_DIR}/w${width}.html`;
    writeFileSync(file, [
      '<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"></head><body>',
      // Long, unbreakable strings parked in the shell so the cascade gate sees
      // the same wrap rules real session titles and pasted URLs hit.
      `<main data-audit-page="/long-text" data-audit-surface=""><div class="session"><header class="sessionBar">` +
      `<h2 class="sessionTitle">${LONG_TEXT_PROBE.title}</h2></header><div class="messages">` +
      `<article class="message" data-role="assistant"><div class="markdown"><p>${LONG_TEXT_PROBE.url}</p>` +
      `<p>${LONG_TEXT_PROBE.token}</p></div></article></div></div></main>`,
      ...parts,
      '</body></html>',
    ].join(''), 'utf8');

    const cssFiles = [
      'public/tokens.css',
      'src/app/app-reset.css',
      ...moduleCssFiles(),
    ].join(',');

    try {
      execFileSync(process.execPath, ['scripts/responsive-audit.mjs', `--widths=${width}`, '--json'], {
        env: { ...process.env, AUDIT_HTML: file, AUDIT_CSS: cssFiles, AUDIT_JS: 'none' },
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (cause) {
      const out = cause.stdout || '';
      let parsed = null;
      try { parsed = JSON.parse(out); } catch { /* fall through to raw */ }
      if (parsed?.findings?.length) {
        for (const finding of parsed.findings) {
          problems.push({ kind: finding.kind, page: pageOf(finding.el), width, detail: `${finding.el} — ${finding.detail}` });
        }
      } else {
        problems.push({ kind: 'cascade-audit-failed', page: 'all', width, detail: (cause.stderr || out || '').slice(0, 400) });
      }
    }
  }
  return { problems, states };
}

const pageOf = (selector) => (selector.match(/data-audit-page="([^"]+)"/) || [])[1] || 'shell';

function moduleCssFiles(dir = 'src/app', found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) moduleCssFiles(full, found);
    else if (entry.name.endsWith('.module.css')) found.push(full);
  }
  return found;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { problems, states } = await runMatrix();
  if (AS_JSON) {
    console.log(JSON.stringify({ widths: WIDTHS, pages: PAGES, problems, states }, null, 2));
  } else {
    console.log(`RESPONSIVE MATRIX — ${PAGES.length} pages × ${WIDTHS.join('/')} px`);
    if (!problems.length) console.log('  no findings');
    const seen = new Map();
    for (const problem of problems) {
      const key = `${problem.kind}|${problem.page}|${problem.detail}`;
      const row = seen.get(key) || { ...problem, widths: [] };
      row.widths.push(problem.width);
      seen.set(key, row);
    }
    for (const row of seen.values()) {
      console.log(`  [${row.kind}] ${row.page} — ${row.detail}`);
      console.log(`        widths: ${row.widths.join(', ')}`);
    }
  }
  process.exit(problems.length ? 1 : 0);
}
