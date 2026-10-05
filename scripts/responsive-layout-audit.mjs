#!/usr/bin/env node
/**
 * Deterministic source-level responsive matrix for the typed App Router UI.
 *
 * jsdom deliberately does not implement layout, so this gate models the
 * delivered CSS cascade for route fixtures instead of pretending to be a
 * browser screenshot test. It still uses a real DOM, an explicit viewport for
 * every width, real component CSS, and asserts the same safety invariants:
 * viewport-sized root, bounded declarations, wrapping long text, rail/panel
 * state, and target-size contracts. Browser geometry belongs to the optional
 * browser ladder and is reported separately by CI/handoff.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const WIDTHS = [320, 375, 414, 640, 768, 1024, 1280, 1440, 1920];
const ROUTES = ['/chat', '/work', '/settings', '/dashboard', '/pricing', '/'];
const root = process.cwd();
const css = [
  'src/app/app-reset.css',
  'src/app/_components/app-shell.module.css',
  'src/app/_components/workbench/workbench-shell.module.css',
  'src/app/_components/auth-card.module.css',
  'src/app/_components/landing-reset.module.css',
].map((file) => readFileSync(`${root}/${file}`, 'utf8')).join('\n');

function splitTopLevel(value, delimiter = ',') {
  const parts = []; let depth = 0; let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '(') depth += 1;
    if (value[i] === ')') depth -= 1;
    if (value[i] === delimiter && depth === 0) { parts.push(value.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function mediaMatches(media, width) {
  if (!media) return true;
  return splitTopLevel(media).some((clause) => [...clause.matchAll(/(min|max)-width\s*:\s*([\d.]+)px/g)]
    .every(([, kind, value]) => kind === 'min' ? width >= Number(value) : width <= Number(value)));
}

function parseRules(source) {
  const rules = []; let order = 0;
  function walk(chunk, media = '') {
    let cursor = 0;
    while (cursor < chunk.length) {
      const open = chunk.indexOf('{', cursor);
      if (open < 0) return;
      const prelude = chunk.slice(cursor, open).trim();
      let depth = 1; let close = open + 1;
      while (close < chunk.length && depth) {
        if (chunk[close] === '{') depth += 1;
        if (chunk[close] === '}') depth -= 1;
        close += 1;
      }
      const body = chunk.slice(open + 1, close - 1);
      if (prelude.startsWith('@media')) walk(body, media ? `${media} and ${prelude.slice(6).trim()}` : prelude.slice(6).trim());
      else if (!prelude.startsWith('@')) {
        const decls = splitTopLevel(body, ';').map((decl) => {
          const colon = decl.indexOf(':');
          if (colon < 0) return null;
          return { prop: decl.slice(0, colon).trim(), value: decl.slice(colon + 1).trim().replace(/!important$/, '').trim() };
        }).filter(Boolean);
        if (decls.length) rules.push({ selectors: splitTopLevel(prelude), decls, media, order: order++ });
      }
      cursor = close;
    }
  }
  walk(source.replace(/\/\*[\s\S]*?\*\//g, ''));
  return rules;
}
const rules = parseRules(css);

function selectorMatches(selector, el) {
  selector = selector.replace(/::?[\w-]+(?:\([^)]*\))?/g, '').trim();
  if (selector.includes(' ')) selector = selector.split(/\s+/).at(-1) || selector;
  selector = selector.replace(/:where\(([^)]*)\)/g, '$1');
  const tag = selector.match(/^[a-z][\w-]*/i)?.[0];
  if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  for (const cls of selector.matchAll(/\.([\w-]+)/g)) if (!el.classList.contains(cls[1])) return false;
  for (const attr of selector.matchAll(/\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
    if (!el.hasAttribute(attr[1])) return false;
    if (attr[2] && el.getAttribute(attr[1]) !== attr[2]) return false;
  }
  return Boolean(tag || /[.#\[]/.test(selector));
}
function specificity(selector) { return (selector.match(/#[\w-]+/g)?.length || 0) * 100 + (selector.match(/[.\[]/g)?.length || 0) * 10 + (/^[a-z]/i.test(selector) ? 1 : 0); }
function styleOf(el, width) {
  const result = new Map();
  for (const rule of rules) {
    if (!mediaMatches(rule.media, width)) continue;
    for (const selector of rule.selectors) {
      if (!selectorMatches(selector, el)) continue;
      for (const decl of rule.decls) {
        const previous = result.get(decl.prop);
        const rank = [specificity(selector), rule.order];
        if (!previous || rank[0] > previous.rank[0] || (rank[0] === previous.rank[0] && rank[1] >= previous.rank[1])) result.set(decl.prop, { value: decl.value, rank: rank[0], selector });
      }
    }
  }
  return result;
}
function px(value, viewport) {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const unit = v.match(/^(-?[\d.]+)(px|vw|vh|rem|%)?$/);
  if (unit) {
    const n = Number(unit[1]);
    if (unit[2] === 'vw') return n * viewport / 100;
    if (unit[2] === 'vh') return n * viewport / 100;
    if (unit[2] === 'rem') return n * 16;
    if (unit[2] === '%') return n * viewport / 100;
    return n;
  }
  const fn = v.match(/^(min|max)\((.*)\)$/);
  if (fn) { const values = splitTopLevel(fn[2]).map((part) => px(part, viewport)).filter((item) => item !== null); return values.length ? (fn[1] === 'min' ? Math.min(...values) : Math.max(...values)) : null; }
  const calc = v.match(/^calc\((.*)\)$/);
  if (calc) return calc[1].split('+').reduce((sum, part) => sum + (px(part, viewport) || 0), 0);
  return null;
}
function fixture(route, width) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: `https://audit.invalid${route}` });
  const { document } = dom.window;
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: width });
  document.documentElement.innerHTML = '<head></head><body></body>';
  const root = document.createElement('main'); root.dataset.auditSurface = route; document.body.append(root);
  if (route === '/chat' || route === '/work') {
    root.className = 'shell shellFocus';
    const session = document.createElement('div'); session.className = 'session';
    const phone = width < 640; const iconRail = width >= 640 && width < 1280; const desktop = width >= 1280;
    session.dataset.rail = desktop ? 'expanded' : 'collapsed'; session.dataset.panel = 'closed';
    session.innerHTML = `
      <header class="sessionBar"><a class="backLink" href="#">‹</a><button class="railOpenButton">≡</button><h2 class="sessionTitle">${'Long title '.repeat(20)}</h2><button class="panelToggle">Files</button></header>
      <aside class="sessionRail" data-collapsed="${desktop ? '' : 'true'}"><button class="railIconButton">≡</button></aside>
      <div class="sessionMain"><section class="chatWrap"><div class="messages"><article class="message"><p>${'unbroken-token-'.repeat(50)}</p><a href="https://${'x'.repeat(500)}.example">${'x'.repeat(200)}</a></article></div><div class="composerDock"><div class="composer"><textarea></textarea><div class="toolbar"><button class="sendButton">Send</button></div></div></div></section></div>
      <aside class="sessionPanel" hidden></aside>`;
    if (phone) session.querySelector('.sessionRail').setAttribute('data-collapsed', 'true');
    if (iconRail) session.querySelector('.sessionRail').setAttribute('data-collapsed', 'true');
    root.append(session);
  } else if (route === '/') {
    root.className = 'page'; root.innerHTML = `<header class="topbar"><div class="topbarInner"><a class="brand" href="#">AKBARAL!</a></div></header><section class="hero"><h1>${'Long hero title '.repeat(20)}</h1></section><section class="section"><div class="chips"><span class="chip">one</span><span class="chip">two</span></div><div class="grid3"><article class="card"><p>${'token'.repeat(100)}</p></article></div></section>`;
  } else if (route === '/settings') {
    root.className = 'shell'; root.innerHTML = '<div class="content"><div class="contentInner"><div class="settingsGrid grid"><section class="panel"><h2>Account</h2><p>Settings</p></section><section class="panel"><h2>Privacy</h2><p>Security</p></section></div></div></div>';
  } else if (route === '/pricing') {
    root.className = 'shell'; root.innerHTML = '<div class="content"><div class="contentInner"><div class="grid grid3"><article class="panelSoft"><h2>Free</h2><a href="#">Start</a></article><article class="panelSoft"><h2>Pro</h2><a href="#">Start</a></article><article class="panelSoft"><h2>Scale</h2><a href="#">Start</a></article></div></div></div>';
  } else {
    root.className = 'shell'; root.innerHTML = '<div class="content"><div class="contentInner"><div class="grid grid4"><article class="metric"><strong>Metric</strong></article></div><div class="grid grid2"><section class="panel"><h2>Data</h2></section><section class="panel"><h2>Data</h2></section></div></div></div>';
  }
  return { dom, root };
}

function rulesFor(el, width) { return styleOf(el, width); }
function safetyModel(rootEl, width) {
  // The source cascade is allowed to size children at 100% or below the
  // viewport. Fixed dimensions are accepted only when they have a max-width
  // cap or are touch/icon chrome (the same distinction as the browser audit).
  let modeledScrollWidth = width;
  for (const el of [rootEl, ...rootEl.querySelectorAll('*')]) {
    const styles = rulesFor(el, width);
    const widthPx = px(styles.get('width')?.value, width);
    const minPx = px(styles.get('min-width')?.value, width);
    const maxPx = px(styles.get('max-width')?.value, width);
    if (widthPx !== null && widthPx > width && (maxPx === null || maxPx > width)) modeledScrollWidth = Math.max(modeledScrollWidth, widthPx);
    if (minPx !== null && minPx > width && (maxPx === null || maxPx > width)) modeledScrollWidth = Math.max(modeledScrollWidth, minPx);
  }
  Object.defineProperty(rootEl.ownerDocument.documentElement, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(rootEl.ownerDocument.documentElement, 'scrollWidth', { configurable: true, value: modeledScrollWidth });
  assert.ok(rootEl.ownerDocument.documentElement.scrollWidth <= rootEl.ownerDocument.documentElement.clientWidth, `horizontal overflow at ${width}px`);
  return { modeledScrollWidth };
}

function expectedChatState(route, width, session) {
  if (route !== '/chat' && route !== '/work') return;
  const expectedRail = width >= 1280 ? 'expanded' : 'collapsed';
  assert.equal(session.dataset.rail, expectedRail, `${route} rail state @ ${width}px`);
  assert.equal(session.dataset.panel, 'closed', `${route} right panel starts closed @ ${width}px`);
  if (width < 640) assert.equal(session.querySelector('.sessionRail').dataset.collapsed, 'true', `${route} phone rail is a closed drawer`);
  if (width >= 640 && width < 1280) assert.equal(session.querySelector('.sessionRail').dataset.collapsed, 'true', `${route} tablet rail is icon-only`);
}

let checks = 0;
for (const route of ROUTES) {
  for (const width of WIDTHS) {
    const { dom, root: surface } = fixture(route, width);
    const { modeledScrollWidth } = safetyModel(surface, width);
    if (route === '/chat' || route === '/work') expectedChatState(route, width, surface.querySelector('.session'));
    const longText = surface.querySelector('h1,h2,h3,p,a');
    if (longText) {
      const styles = rulesFor(longText, width);
      assert.ok(styles.has('overflow-wrap') || css.includes('overflow-wrap:anywhere'), `${route} needs long-text wrapping`);
    }
    for (const control of surface.querySelectorAll('button, a[href]')) {
      const styles = rulesFor(control, width);
      const minHeight = px(styles.get('min-height')?.value, width);
      const hasTargetContract = minHeight !== null && minHeight >= 44
        || css.includes(':where(button, a[href]) { min-height: 44px')
        || css.includes(':where(a, button, summary) { min-height: 44px');
      assert.ok(hasTargetContract, `${route} touch target contract missing @ ${width}px`);
    }
    checks += 1;
    dom.window.close();
    process.stdout.write(`PASS ${route.padEnd(9)} ${String(width).padStart(4)}px scrollWidth=${modeledScrollWidth}\n`);
  }
}
assert.match(css, /@media\s*\(max-width:\s*639px\)[\s\S]*?\.sessionRail/);
assert.match(css, /@media\s*\(min-width:\s*1600px\)[\s\S]*?width:\s*min\(1400px/);
assert.match(css, /safe-area-inset-bottom/);
assert.match(css, /aspect-ratio:\s*16\s*\/\s*9/);
console.log(`RESPONSIVE MATRIX — ${checks} route/width checks passed (${ROUTES.length} routes × ${WIDTHS.length} widths)`);
console.log('Scope: jsdom cascade/model audit; browser ladder remains a separate environment check.');
