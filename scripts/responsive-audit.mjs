#!/usr/bin/env node
/**
 * Responsive audit — the QA gate for every surface at every width.
 *
 * There is no browser in this environment, so this is not a screenshot pass: it
 * is a real cascade resolution. It boots the delivered document with the real
 * client bundle, applies the delivered stylesheets, resolves every declaration
 * that WINS at a given viewport width (media queries evaluated against that
 * width, specificity + order + !important honoured), and then checks the things
 * a browser would show as broken:
 *
 *   · a width/min-width/padding sum that cannot fit the viewport   → overflow
 *   · text smaller than 11px                                       → unreadable
 *   · an interactive control shorter than 30px                     → untappable
 *   · nowrap text wider than its box, with no overflow handling     → clipped
 *   · an auto-fit grid without a min() guard                        → fixed track overflow
 *
 * Findings name the element and the winning rule, so each one is actionable.
 *
 * Usage: node scripts/responsive-audit.mjs [--json] [--widths 320,390,...]
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';

const repo = process.cwd();
const args = process.argv.slice(2);
const TRACE = args.includes('--trace');
const WHY = (args.find((a) => a.startsWith('--why=')) || '').slice(6);
const WIDTHS = (process.argv.find((a) => a.startsWith('--widths='))?.split('=')[1] || '320,360,375,390,414,768,1024,1280,1440,1920')
  .split(',').map(Number);
const AS_JSON = process.argv.includes('--json');
const SELFTEST = args.includes('--selftest');
const BASE = 16;

/* ---------- CSS: parse into flat rules with a media condition ---------- */
function parseCss(text) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let order = 0;
  const walk = (chunk, media) => {
    let i = 0;
    while (i < chunk.length) {
      const brace = chunk.indexOf('{', i);
      if (brace === -1) break;
      const prelude = chunk.slice(i, brace).trim();
      if (prelude.startsWith('@')) {
        // find the matching close brace for this at-rule
        let depth = 1, j = brace + 1;
        while (j < chunk.length && depth > 0) {
          if (chunk[j] === '{') depth++;
          else if (chunk[j] === '}') depth--;
          j++;
        }
        const body = chunk.slice(brace + 1, j - 1);
        const name = prelude.split(/[\s(]/)[0];
        if (name === '@media') walk(body, mergeMedia(media, prelude.replace('@media', '').trim()));
        else if (name === '@supports' || name === '@layer') walk(body, media);
        i = j;
        continue;
      }
      const close = chunk.indexOf('}', brace);
      if (close === -1) break;
      const decls = chunk.slice(brace + 1, close).split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
        const idx = d.indexOf(':');
        const prop = d.slice(0, idx).trim().toLowerCase();
        let value = d.slice(idx + 1).trim();
        const important = /!important$/i.test(value);
        if (important) value = value.replace(/\s*!important$/i, '');
        return { prop, value, important };
      }).filter((d) => d.prop && d.value);
      if (decls.length) {
        rules.push({ selectors: prelude.split(',').map((s) => s.trim()).filter(Boolean), decls, media, order: order++ });
      }
      i = close + 1;
    }
  };
  walk(css, null);
  return rules;
}
const mergeMedia = (outer, inner) => (outer ? `(${outer}) and (${inner})` : inner);

/* ---------- media evaluation at a viewport width ---------- */
function mediaMatches(cond, width) {
  if (!cond) return true;
  return cond.split(',').some((clause) => {
    const tests = clause.replace(/^\(|\)$/g, '').split(/\)\s*and\s*\(/i);
    return tests.every((t) => {
      const test = t.replace(/[()]/g, '').trim();
      let m = test.match(/^max-width:\s*([\d.]+)px$/i);
      if (m) return width <= Number(m[1]) + 0.5;
      m = test.match(/^min-width:\s*([\d.]+)px$/i);
      if (m) return width >= Number(m[1]) - 0.5;
      m = test.match(/^(max|min)-device-width:\s*([\d.]+)px$/i);
      if (m) return m[1] === 'max' ? width <= Number(m[2]) + 0.5 : width >= Number(m[2]) - 0.5;
      if (/prefers-reduced-motion|hover|pointer|orientation|any-hover/i.test(test)) return true;
      return true; // unknown condition: assume it can apply, never hide a finding
    });
  });
}

/* ---------- specificity ---------- */
function specificity(sel) {
  const s = sel.replace(/\\./g, '');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(\([^)]*\))?/g) || []).length;
  const types = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(\([^)]*\))?/g, ' ').match(/[a-zA-Z][\w-]*/g) || []).length;
  return ids * 10000 + classes * 100 + types;
}

/* ---------- length resolution (px / rem / em / vw / clamp / min / max / calc) ---------- */
function customProps(width) {
  const map = new Map();
  for (const rule of rules) {
    if (!mediaMatches(rule.media, width)) continue;
    if (!rule.selectors.some((sel) => /^(:root|html|body|\*)$/.test(sel.trim()))) continue;
    for (const decl of rule.decls) if (decl.prop.startsWith('--')) map.set(decl.prop, decl.value.trim());
  }
  return map;
}
function substituteVars(value, vars, depth = 0) {
  if (!value || depth > 6) return value;
  return value.replace(/var\((--[\w-]+)(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (_, name, fallback) => {
    const v = vars.get(name);
    return v !== undefined ? substituteVars(v, vars, depth + 1) : (fallback ? substituteVars(fallback, vars, depth + 1) : '');
  });
}
function resolveLength(value, el, width, parentFont) {
  if (!value) return null;
  value = substituteVars(value, customProps(width));
  const v = value.trim().toLowerCase();
  const numeric = (s) => Number(s);
  const unit = (s, font = parentFont) => {
    const m = s.trim().match(/^(-?[\d.]+)(px|rem|em|vw|vh|ch|%|pt)?$/);
    if (!m) return null;
    const n = numeric(m[1]);
    switch (m[2]) {
      case 'px': return n;
      case 'rem': return n * BASE;
      case 'em': return n * (font || BASE);
      case 'vw': return (n * width) / 100;
      case 'vh': return (n * 8) / 100;
      case 'ch': return n * 8;
      case 'pt': return (n * 96) / 72;
      case '%': return null;
      default: return n === 0 ? 0 : null;
    }
  };
  const fn = v.match(/^(clamp|min|max)\((.+)\)$/);
  if (fn) {
    const parts = fn[2].split(/,(?![^(]*\))/).map((p) => unit(p));
    if (parts.some((p) => p === null)) return null;
    if (fn[1] === 'clamp') return Math.min(Math.max(parts[0], parts[1]), parts[2]);
    if (fn[1] === 'min') return Math.min(...parts);
    return Math.max(...parts);
  }
  if (v.startsWith('calc(')) {
    const inner = v.slice(5, -1);
    let total = 0;
    for (const term of inner.split(/\s*\+\s*/)) {
      const neg = term.split(/\s*-\s*/);
      total += (unit(neg[0]) || 0) - (neg.slice(1).reduce((a, t) => a + (unit(t) || 0), 0));
    }
    return total;
  }
  return unit(v);
}

/* ---------- shorthand expansion we care about ---------- */
const LONGHANDS = {
  'padding-left': ['padding', 'padding-inline'],
  'padding-right': ['padding', 'padding-inline'],
  'padding-top': ['padding', 'padding-block'],
  'padding-bottom': ['padding', 'padding-block'],
};
function winning(el, prop, rules, width) {
  let best = null;
  const consider = (decl, spec, ord, sel) => {
    const key = [decl.important ? 1 : 0, spec, ord];
    if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && (key[1] > best.key[1] || (key[1] === best.key[1] && key[2] >= best.key[2])))) {
      best = { value: decl.value, important: decl.important, spec, ord, sel, key };
    }
  };
  for (const rule of rules) {
    if (!mediaMatches(rule.media, width)) continue;
    if (!rule.selectors.some((sel) => matches(el, sel))) continue;
    for (const decl of rule.decls) {
      if (decl.prop === prop) consider(decl, specificity(rule.selectors[0]), rule.order, rule.selectors[0]);
      // expand padding/padding-inline/padding-block shorthands into longhands
      const sources = LONGHANDS[prop] || [];
      if (sources.includes(decl.prop)) {
        const parts = decl.value.split(/\s+/).map((p) => resolveLength(p, el, width));
        if (parts.every((p) => p !== null && p !== undefined)) {
          let value = null;
          if (decl.prop === 'padding') {
            const [t, r = t, b = t, l = r] = parts;
            value = prop === 'padding-left' ? l : prop === 'padding-right' ? r : prop === 'padding-top' ? t : b;
          } else if (decl.prop === 'padding-inline') {
            const [s, e = s] = parts;
            value = prop === 'padding-left' ? s : e;
          } else {
            const [s, e = s] = parts;
            value = prop === 'padding-top' ? s : e;
          }
          if (value !== null) consider({ prop, value: `${value}px`, important: decl.important }, specificity(rule.selectors[0]), rule.order, rule.selectors[0]);
        }
      }
    }
  }
  const inline = el.getAttribute && el.getAttribute('style');
  if (inline) {
    const decl = inline.split(';').map((d) => d.trim()).find((d) => d.toLowerCase().startsWith(`${prop}:`));
    if (decl) consider({ prop, value: decl.slice(decl.indexOf(':') + 1).trim(), important: false }, 100000, 1e9, 'inline style');
  }
  return best;
}
function matches(el, sel) {
  try { return el.matches(sel); } catch { return false; }
}
function chain(el) { const out = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) out.push(n); return out.reverse(); }
const path = (el) => {
  const id = el.id ? `#${el.id}` : '';
  const cls = el.classList.length ? `.${[...el.classList].slice(0, 3).join('.')}` : '';
  const sib = el.parentElement ? [...el.parentElement.children].filter((c) => c.tagName === el.tagName) : [];
  const nth = sib.indexOf(el) > 0 ? `:nth-of-type(${sib.indexOf(el) + 1})` : '';
  const own = `${el.tagName.toLowerCase()}${id}${cls}${nth}`;
  const box = el.closest('section.screen, aside, header, footer, main');
  return box ? `${box.id || [...box.classList].slice(0, 2).join('.') || box.tagName.toLowerCase()} > ${own}` : own;
};

/* ---------- the audit ---------- */
const rules = parseCss(readFileSync(`${repo}/public/tokens.css`, 'utf8') + '\n' + readFileSync(`${repo}/public/styles.css`, 'utf8'));
const appJs = readFileSync(`${repo}/public/app.js`, 'utf8');
const WEB = process.env.AUDIT_BASE || 'http://127.0.0.1:3000';
const screens = process.argv.find((a) => a.startsWith('--screens='))?.split('=')[1]?.split(',');

let html;
try { html = await (await fetch(`${WEB}/`)).text(); } catch { html = readFileSync(`${repo}/.next/server/app/index.html`, 'utf8'); }

const dom = new JSDOM(html, { url: `${WEB}/`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
const { window } = dom, doc = window.document;
window.fetch = (i, init = {}) => { const raw = typeof i === 'string' ? i : i.url; return fetch(raw.startsWith('/') ? `${WEB}${raw}` : raw, init); };
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.scrollTo = () => {}; window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
window.XMLHttpRequest = class { open() {} send() {} setRequestHeader() {} addEventListener() {} };
window.eval(appJs);
await new Promise((r) => setTimeout(r, 1200));
doc.dispatchEvent(new window.Event('DOMContentLoaded'));
window.dispatchEvent(new window.Event('load'));
await new Promise((r) => setTimeout(r, 1500));

const findings = [];
const hidden = (el) => chain(el).some((n) => n.hasAttribute('hidden'));
const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [tabindex]:not([tabindex="-1"])';

for (const width of WIDTHS) {
  const fontOf = (el, memo = new Map()) => {
    if (memo.has(el)) return memo.get(el);
    const own = winning(el, 'font-size', rules, width);
    let font = own ? resolveLength(own.value, el, width, el.parentElement ? fontOf(el.parentElement, memo) : BASE) : null;
    if (font === null) font = el.parentElement ? fontOf(el.parentElement, memo) : BASE;
    memo.set(el, font);
    return font;
  };
  const contentWidth = (el) => {
    let w = width;
    for (const node of chain(el).slice(0, -1)) {
      for (const side of ['padding-left', 'padding-right']) {
        const d = winning(node, side, rules, width);
        if (d) { const px = resolveLength(d.value, node, width); if (px !== null) w -= px; }
      }
      const border = winning(node, 'border', rules, width);
      const bw = winning(node, `border-${sideOf(node)}`, rules, width);
      if (border || bw) w -= 1;
    }
    return w;
  };
  const sideOf = () => 'left';

  // Screens plus every dialog surface: a modal has to survive a 320px phone too.
  const surfaces = [...doc.querySelectorAll('section.screen'), ...doc.querySelectorAll('[role="dialog"]')];
if (SELFTEST) {
  // Plant four regressions and prove the audit reports every one of them.
  const planted = `
    #audit-selftest-wide { width: 900px; }
    #audit-selftest-tiny { font-size: 9px; }
    #audit-selftest-small { height: 22px; }
    #audit-selftest-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); }`;
  const extra = parseCss(planted).map((r) => ({ ...r, order: rules.length + r.order }));
  rules.push(...extra);
  const host = doc.querySelector('section.screen') || doc.body;
  host.insertAdjacentHTML('beforeend',
    '<div id="audit-selftest-wide"></div><span id="audit-selftest-tiny">tiny</span>' +
    '<button id="audit-selftest-small" type="button">x</button><div id="audit-selftest-grid"></div>');
}
  for (const surface of surfaces) {
   const wasHidden = surface.hasAttribute('hidden');
   surface.hidden = false;
   for (const el of [surface, ...surface.querySelectorAll('*')]) {
    if (hidden(el)) continue;
    if (el.closest('.sr-only, [aria-hidden="true"].sr-only')) continue;
    const tag = el.tagName.toLowerCase();
    const isHiddenVisually = ['script', 'style', 'meta', 'link', 'title', 'noscript'].includes(tag);
    if (isHiddenVisually) continue;

    // 1 · width / min-width / padding sums that cannot fit
    const minW = winning(el, 'min-width', rules, width);
    const minPx = minW ? resolveLength(minW.value, el, width) : null;
    const maxW = winning(el, 'max-width', rules, width);
    const maxPx = maxW ? resolveLength(maxW.value, el, width) : null;
    const hasFluidCap = maxPx !== null && maxPx <= width;
    if (minPx !== null && minPx > width && !hasFluidCap) {
      findings.push({ width, kind: 'overflow', el: path(el), detail: `min-width:${minW.value} (${minPx}px) > viewport`, rule: minW.sel });
    }
    const ownW = winning(el, 'width', rules, width);
    const ownPx = ownW ? resolveLength(ownW.value, el, width) : null;
    if (ownPx !== null && ownPx > width && !hasFluidCap) {
      findings.push({ width, kind: 'overflow', el: path(el), detail: `width:${ownW.value} (${ownPx}px) > viewport`, rule: ownW.sel });
    }
    const pl = winning(el, 'padding-left', rules, width), pr = winning(el, 'padding-right', rules, width);
    const plPx = pl ? resolveLength(pl.value, el, width) : 0, prPx = pr ? resolveLength(pr.value, el, width) : 0;
    if ((plPx || 0) + (prPx || 0) > width) {
      findings.push({ width, kind: 'overflow', el: path(el), detail: `padding ${plPx}+${prPx}px exceeds viewport`, rule: pl?.sel || pr?.sel });
    }

    // 2 · unreadable text
    const text = (el.textContent || '').trim();
    if (text && el.children.length === 0) {
      const font = fontOf(el);
      if (font !== null && font > 0 && font < 11) {
        findings.push({ width, kind: 'tiny-text', el: path(el), detail: `font-size ${font.toFixed(1)}px`, rule: winning(el, 'font-size', rules, width)?.sel });
      }
      // 3 · clipped nowrap text
      const ws = winning(el, 'white-space', rules, width);
      if (ws && /nowrap/.test(ws.value)) {
        const avail = contentWidth(el);
        const approx = text.length * font * 0.52;
        const overflowHandled = ['overflow', 'overflow-x', 'text-overflow'].some((p) => {
          const d = winning(el, p, rules, width);
          return d && /auto|scroll|ellipsis|hidden|clip/.test(d.value);
        });
        if (approx > avail && !overflowHandled) {
          findings.push({ width, kind: 'clipped', el: path(el), detail: `nowrap text ~${Math.round(approx)}px in ${Math.round(avail)}px, no overflow handling`, rule: ws.sel });
        }
      }
    }

    // 4 · untappable controls
    if (el.matches(INTERACTIVE)) {
      const disp = winning(el, 'display', rules, width)?.value?.trim();
      const isInlineTextLink = tag === 'a'
        && (!disp || disp === 'inline')
        && !winning(el, 'height', rules, width)
        && !winning(el, 'min-height', rules, width)
        && !winning(el, 'padding', rules, width)
        && !winning(el, 'padding-top', rules, width);
      if (isInlineTextLink) continue; // links inside prose are exempt from target-size rules
      const h = winning(el, 'height', rules, width);
      const mh = winning(el, 'min-height', rules, width);
      const hPx = h ? resolveLength(h.value, el, width) : null;
      const mhPx = mh ? resolveLength(mh.value, el, width) : null;
      const eff = mhPx ?? hPx;
      const pt = winning(el, 'padding-top', rules, width), pb = winning(el, 'padding-bottom', rules, width);
      const boxed = (resolveLength(pt?.value, el, width) || 0) + (resolveLength(pb?.value, el, width) || 0) + fontOf(el) * 1.2;
      const tallChild = [...el.children].some((child) => {
        const ch = winning(child, 'height', rules, width);
        const cm = winning(child, 'min-height', rules, width);
        const px = resolveLength(ch?.value, child, width) ?? resolveLength(cm?.value, child, width);
        return px !== null && px >= 30;
      });
      const size = tallChild ? 40 : (eff ?? boxed);
      if (size < 30 && !el.closest('.skip-link')) {
        findings.push({ width, kind: 'small-target', el: path(el), detail: `${Math.round(size)}px tall`, rule: (mh || h)?.sel });
      }
    }

    // 5 · a provider row whose logo + name cannot fit its own box
    if (el.classList.contains('oauth-btn')) {
      const font = fontOf(el) || 14;
      const label = el.querySelector('.oauth-label')?.textContent?.trim() || '';
      const mark = resolveLength(winning(el.querySelector('.oauth-mark'), 'width', rules, width)?.value, el, width) || 20;
      const gap = resolveLength(winning(el, 'gap', rules, width)?.value, el, width) || 12;
      const pl = resolveLength(winning(el, 'padding-left', rules, width)?.value, el, width) || 0;
      const pr = resolveLength(winning(el, 'padding-right', rules, width)?.value, el, width) || 0;
      const need = mark + gap + label.length * font * 0.52 + pl + pr;
      const avail = contentWidth(el);
      if (need > avail + 1) {
        findings.push({ width, kind: 'provider-row', el: path(el), detail: `“${label}” needs ~${Math.round(need)}px in ${Math.round(avail)}px`, rule: 'provider row' });
      }
    }

    // 6 · grid tracks without a min() guard
    const gtc = winning(el, 'grid-template-columns', rules, width);
    if (gtc && /repeat\(auto-(fit|fill),\s*minmax\((?!min\()/.test(gtc.value)) {
      findings.push({ width, kind: 'grid-guard', el: path(el), detail: gtc.value.slice(0, 60), rule: gtc.sel });
    }
   }
   surface.hidden = wasHidden;
  }
}

/* ---------- report ---------- */
if (WHY) {
  const [sel, prop = 'height'] = WHY.split('|');
  const w = WIDTHS[0];
  const hits = [...doc.querySelectorAll(sel)];
  console.log(`WHY — ${sel} · ${prop} @ ${w}px  (${hits.length} element${hits.length === 1 ? '' : 's'})`);
  for (const el of hits.slice(0, 6)) {
    const decl = winning(el, prop, rules, w);
    const raw = decl ? `${decl.value}${decl.important ? ' !important' : ''}  [${decl.sel}]` : '—';
    const subs = decl ? substituteVars(decl.value, customProps(w)) : '';
    console.log(`  ${path(el)}\n    raw: ${raw}\n    substituted: ${subs || '—'}  →  ${resolveLength(decl?.value, el, w) ?? 'unresolved'}`);
  }
  process.exit(0);
}

const groups = new Map();
for (const f of findings) {
  const key = `${f.kind}|${f.el}|${f.detail.replace(/\(?\d+px\)?/g, 'Npx')}`;
  const g = groups.get(key) || { ...f, widths: [] };
  g.widths.push(f.width);
  groups.set(key, g);
}
const rows = [...groups.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.el.localeCompare(b.el));
if (AS_JSON) {
  console.log(JSON.stringify({ widths: WIDTHS, findings: rows }, null, 2));
} else {
  console.log(`RESPONSIVE AUDIT — ${WIDTHS.join(' / ')} px`);
  if (!rows.length) console.log('  no findings');
  for (const r of rows) {
    console.log(`  [${r.kind}] ${r.el} — ${r.detail}`);
    console.log(`        widths: ${r.widths.join(', ')}${r.rule ? `   rule: ${r.rule}` : ''}`);
  }
}
if (SELFTEST) {
  const wanted = ['overflow', 'tiny-text', 'small-target', 'grid-guard'];
  const found = wanted.filter((kind) => rows.some((r) => r.kind === kind && /audit-selftest/.test(r.el)));
  const ok = found.length === wanted.length;
  console.log(`SELF-TEST — planted regressions detected: ${found.length}/${wanted.length}${ok ? '  ✓ the gate can fail' : '  ✗ MISSED: ' + wanted.filter((k) => !found.includes(k)).join(', ')}`);
  process.exit(ok ? 0 : 1);
}
process.exit(rows.length ? 1 : 0);
