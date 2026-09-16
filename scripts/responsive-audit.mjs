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
const propsCache = new Map();
const winCache = new WeakMap();
function resetCaches() { propsCache.clear(); }
function customProps(width) {
  const cached = propsCache.get(width);
  if (cached) return cached;
  const map = new Map();
  for (const rule of rules) {
    if (!mediaMatches(rule.media, width)) continue;
    if (!rule.selectors.some((sel) => /^(:root|html|body|\*)$/.test(sel.trim()))) continue;
    for (const decl of rule.decls) if (decl.prop.startsWith('--')) map.set(decl.prop, decl.value.trim());
  }
  propsCache.set(width, map);
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


/* ---------- colour: contrast is part of legibility ---------- */
const NAMED = { transparent: { r: 0, g: 0, b: 0, a: 0 }, white: { r: 255, g: 255, b: 255, a: 1 }, black: { r: 0, g: 0, b: 0, a: 1 } };
function parseColor(value, vars) {
  if (!value) return null;
  let v = substituteVars(value, vars).trim().toLowerCase();
  if (NAMED[v]) return { ...NAMED[v] };
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }
  }
  m = v.match(/^color-mix\(in srgb,\s*([\s\S]+?)\s+(\d+(?:\.\d+)?)%,?\s*([\s\S]+?)\s+(\d+(?:\.\d+)?)%?\)$/);
  if (m) {
    const c1 = parseColor(m[1], vars), c2 = parseColor(m[3], vars);
    if (c1 && c2) {
      const p1 = Number(m[2]) / 100, p2 = Number(m[4]) / 100;
      const total = p1 + p2 || 1;
      return {
        r: (c1.r * p1 + c2.r * p2) / total,
        g: (c1.g * p1 + c2.g * p2) / total,
        b: (c1.b * p1 + c2.b * p2) / total,
        a: (c1.a * p1 + c2.a * p2) / total,
      };
    }
  }
  return null;
}
const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});
function luminance(c) {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}
function contrast(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
/** The painted backdrop behind an element: ancestor fills + gradients over the obsidian field. */
function backdrop(el, width, vars) {
  const chain = [];
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(n);
  chain.reverse();
  let base = parseColor('#070a08', vars) || { r: 7, g: 10, b: 8, a: 1 };
  for (const node of chain) {
    const fill = winning(node, 'background-color', rules, width);
    const fillColor = fill ? parseColor(fill.value, vars) : null;
    if (fillColor && fillColor.a > 0.001) base = over(fillColor, base);
    const paint = winning(node, 'background', rules, width) || winning(node, 'background-image', rules, width);
    if (!paint) continue;
    const stops = [...substituteVars(paint.value, vars).matchAll(/(#[0-9a-fA-F]{3,6}\b|rgba?\([^)]*\)|\btransparent\b)/g)]
      .map((mm) => parseColor(mm[1], vars)).filter(Boolean);
    if (!stops.length) continue;
    const avg = stops.reduce((acc, c) => ({ r: acc.r + c.r / stops.length, g: acc.g + c.g / stops.length, b: acc.b + c.b / stops.length, a: acc.a + c.a / stops.length }), { r: 0, g: 0, b: 0, a: 0 });
    if (avg.a > 0.001) base = over(avg, base);
  }
  return base;
}

function winning(el, prop, rules, width) {
  let perEl = winCache.get(el);
  if (!perEl) { perEl = new Map(); winCache.set(el, perEl); }
  const key = `${prop}@${width}`;
  if (perEl.has(key)) return perEl.get(key);
  const result = winningRaw(el, prop, rules, width);
  perEl.set(key, result);
  return result;
}

/* ---------- shorthand expansion we care about ---------- */
const LONGHANDS = {
  'padding-left': ['padding', 'padding-inline'],
  'padding-right': ['padding', 'padding-inline'],
  'padding-top': ['padding', 'padding-block'],
  'padding-bottom': ['padding', 'padding-block'],
};
function winningRaw(el, prop, rules, width) {
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
// The audit engine is asset-agnostic so the same invariants (overflow, font
// size, tap targets, nowrap clipping) can be checked on any delivered surface:
// the public AKBARAL! web app by default, the private ZA141251SA mission console
// with AUDIT_CSS/AUDIT_JS/AUDIT_HTML pointed at mission-dashboard/.
const cssFiles = (process.env.AUDIT_CSS || 'public/tokens.css,public/styles.css').split(',').map((file) => file.trim()).filter(Boolean);
const rules = parseCss(cssFiles.map((file) => readFileSync(`${repo}/${file}`, 'utf8')).join('\n'));
const appJs = readFileSync(`${repo}/${process.env.AUDIT_JS || 'public/app.js'}`, 'utf8');
const HTML_FILE = process.env.AUDIT_HTML || '';
const WEB = process.env.AUDIT_BASE || 'http://127.0.0.1:3000';
const screens = process.argv.find((a) => a.startsWith('--screens='))?.split('=')[1]?.split(',');

let html;
if (HTML_FILE) {
  html = readFileSync(`${repo}/${HTML_FILE}`, 'utf8');
} else {
  try { html = await (await fetch(`${WEB}/`)).text(); } catch { html = readFileSync(`${repo}/.next/server/app/index.html`, 'utf8'); }
}

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

  resetCaches();
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

    // 6 · text nobody can read: WCAG AA contrast against the real painted backdrop
    const directText = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim().length > 0);
    if (directText) {
      const varsHere = customProps(width);
      const fg = parseColor(winning(el, 'color', rules, width)?.value, varsHere);
      if (fg && fg.a > 0.05) {
        const back = backdrop(el, width, varsHere);
        const size = fontOf(el) ?? BASE;
        const weight = winning(el, 'font-weight', rules, width)?.value || '';
        const large = size >= 24 || (size >= 18.66 && /^(bold|[6-9]00)$/.test(weight.trim()));
        const need = large ? 3 : 4.5;
        const got = contrast(over(fg, back), back);
        if (got < need - 0.02) {
          findings.push({
            width, kind: 'contrast', el: path(el),
            detail: `${got.toFixed(2)}:1 needs ${need}:1 at ${size.toFixed(1)}px`,
            rule: winning(el, 'color', rules, width)?.sel,
          });
        }
      }
    }

    // 7 · a control nobody can see until they hover it (dead on touch + keyboard)
    if (el.matches('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [tabindex]:not([tabindex="-1"])')) {
      const op = winning(el, 'opacity', rules, width);
      const vis = winning(el, 'visibility', rules, width);
      const opacity = op && /^[\d.]+$/.test(op.value.trim()) ? Number(op.value.trim()) : 1;
      const hiddenVis = vis && vis.value.trim() === 'hidden';
      const caretReveal = el.closest('label') && /(clip-path|sr-only|visually-hidden)/.test(el.parentElement?.className || '');
      if ((opacity < 0.1 || hiddenVis) && !caretReveal) {
        findings.push({
          width, kind: 'hover-only', el: path(el),
          detail: `focusable control renders ${hiddenVis ? 'visibility:hidden' : `opacity ${opacity}`} in its resting state`,
          rule: (op || vis)?.sel,
        });
      }
    }

    // 8 · a control anchored outside the box it is anchored to
    const position = winning(el, 'position', rules, width)?.value?.trim();
    if (position === 'absolute' || position === 'fixed') {
      let box = position === 'fixed' ? null : el.parentElement;
      for (let n = el.parentElement; n && n.nodeType === 1 && position !== 'fixed'; n = n.parentElement) {
        const pos = winning(n, 'position', rules, width)?.value?.trim();
        if (pos && pos !== 'static') { box = n; break; }
      }
      const left = resolveLength(winning(el, 'left', rules, width)?.value, el, width);
      const right = resolveLength(winning(el, 'right', rules, width)?.value, el, width);
      const w = resolveLength(winning(el, 'width', rules, width)?.value, el, width)
        ?? resolveLength(winning(el, 'min-width', rules, width)?.value, el, width);
      const containerW = position === 'fixed' ? width : (box ? contentWidth(box) : width);
      const interactive = el.matches('button, a, input, select, textarea, [role]') || directText;
      if (interactive && w !== null && containerW !== null) {
        const rightEdge = left !== null ? left + w : right !== null ? containerW - right : null;
        if (rightEdge !== null && rightEdge > containerW + 2) {
          findings.push({ width, kind: 'anchored-overflow', el: path(el), detail: `${Math.round(rightEdge)}px of ${Math.round(containerW)}px box`, rule: (winning(el, 'left', rules, width) || winning(el, 'right', rules, width))?.sel });
        }
        const leftEdge = right !== null ? containerW - right - w : left;
        if (leftEdge !== null && leftEdge < -2) {
          findings.push({ width, kind: 'anchored-overflow', el: path(el), detail: `starts ${Math.round(leftEdge)}px outside its ${Math.round(containerW)}px box`, rule: winning(el, 'right', rules, width)?.sel });
        }

        // …and the flow it floats over must reserve a lane for it, or a centred
        // value slides underneath the control (see the password reveal control).
        const anchorSide = right !== null ? 'right' : left !== null ? 'left' : null;
        const offset = right !== null ? right : left;
        const topOffset = resolveLength(winning(el, 'top', rules, width)?.value, el, width);
        const sizeOnAxis = resolveLength(winning(el, 'width', rules, width)?.value, el, width);
        const parked = anchorSide !== null && offset !== null && offset < -500;
        if (anchorSide && offset !== null && sizeOnAxis !== null && !parked) {
          const need = offset + sizeOnAxis;
          const flow = el.parentElement;
          const siblings = flow ? [...flow.children].filter((n) => n !== el && !n.contains(el) && !el.contains(n)) : [];
          const band = topOffset !== null && topOffset < 40 ? siblings.slice(0, 2) : siblings.slice(-1);
          for (const node of band.flatMap((n) => [n, ...n.querySelectorAll('input, textarea, select, h1, h2, h3, p')])) {
            if (!node.matches('input, textarea, select, h1, h2, h3, p')) continue;
            const textish = node.matches('input, textarea, select')
              || [...node.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
            if (!textish) continue;
            const pad = resolveLength(winning(node, `padding-${anchorSide}`, rules, width)?.value, node, width) ?? 0;
            if (pad + 0.5 < need) {
              const label = node.tagName.toLowerCase() + (node.id ? '#' + node.id : '');
              findings.push({
                width, kind: 'control-clearance', el: path(el),
                detail: `floats ${Math.round(need)}px in from the ${anchorSide} edge; ${label} keeps only ${Math.round(pad)}px padding there`,
              });
            }
          }
        }
      }
    }

    // 9 · grid tracks without a min() guard
    const gtc = winning(el, 'grid-template-columns', rules, width);
    if (gtc && /repeat\(auto-(fit|fill),\s*minmax\((?!min\()/.test(gtc.value)) {
      findings.push({ width, kind: 'grid-guard', el: path(el), detail: gtc.value.slice(0, 60), rule: gtc.sel });
    }
   }
   surface.hidden = wasHidden;
  }
}

/* ---------- report ---------- */
if (args.includes('--clearance')) {
  const w = WIDTHS[0];
  const num = (v) => (v === null || v === undefined ? null : Math.round(v));
  console.log(`CLEARANCE REPORT @ ${w}px — floating controls and the lane reserved for them`);
  for (const el of doc.querySelectorAll('*')) {
    const position = winning(el, 'position', rules, w)?.value?.trim();
    if (position !== 'absolute' && position !== 'fixed') continue;
    if (!el.matches('button, a[href], input, select, textarea, [role="button"], [role="tab"]')) continue;
    // The containing block is the nearest positioned ancestor (jsdom has no layout,
    // so offsetParent is always null and would wrongly resolve to the document).
    let box = el.parentElement;
    for (let n = el.parentElement; n && n.nodeType === 1; n = n.parentElement) {
      const pos = winning(n, 'position', rules, w)?.value?.trim();
      if (pos && pos !== 'static') { box = n; break; }
    }
    if (!box) continue;
    const right = resolveLength(winning(el, 'right', rules, w)?.value, el, w);
    const left = resolveLength(winning(el, 'left', rules, w)?.value, el, w);
    const top = resolveLength(winning(el, 'top', rules, w)?.value, el, w);
    const width = resolveLength(winning(el, 'width', rules, w)?.value, el, w);
    const height = resolveLength(winning(el, 'height', rules, w)?.value, el, w);
    const anchorAxis = right !== null ? 'right' : left !== null ? 'left' : 'none';
    const parked = left !== null && (left < -500 || left > width + 500);
    const need = anchorAxis === 'right'
      ? num((right ?? 0) + (width ?? 0))
      : anchorAxis === 'left' ? num((left ?? 0) + (width ?? 0)) : null;
    console.log(`  ${path(el)}  ${position}${parked ? '  (parked off-canvas until focused)' : ''}`);
    console.log(`      in ${path(box)} · anchors: top=${num(top)} ${anchorAxis}=${num(right ?? left)}  size: ${num(width)}x${num(height)}`);
    if (need === null || parked) continue;
    // Only content sharing the control's band can collide with it: the first
    // block for a top-anchored control, the last for a bottom-anchored one.
    const flow = el.parentElement || box;
    const candidates = [...flow.children].filter((n) => n !== el && !n.contains(el) && !el.contains(n));
    const band = top !== null && top < 40 ? candidates.slice(0, 2) : candidates.slice(-1);
    let warned = 0;
    for (const n of band) {
      for (const node of [n, ...n.querySelectorAll('h1, h2, h3, p, span, input, textarea, select')]) {
        const isForm = node.matches('input, textarea, select');
        const isText = !isForm && /^(H[1-6]|P|SPAN|B|SMALL|DIV)$/.test(node.tagName)
          && [...node.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
        if (!isForm && !isText) continue;
        const pad = resolveLength(winning(node, `padding-${anchorAxis}`, rules, w)?.value, node, w) ?? 0;
        if (pad < need) {
          console.log(`      ! ${node.tagName.toLowerCase()}${node.id ? '#' + node.id : ''} padding-${anchorAxis}=${num(pad)}px < needed ${need}px`);
          warned += 1;
        }
      }
    }
    if (!warned) console.log(`      ok — ${need}px lane reserved on the ${anchorAxis} edge`);
  }
  process.exit(0);
}

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
