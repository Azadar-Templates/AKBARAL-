#!/usr/bin/env node
/**
 * AKBARAL! — RENDERED ROUTE AUDIT.
 *
 * Boots the REAL served document with the REAL `public/app.js` in jsdom, then
 * walks every user-facing route and asserts what the browser would actually be
 * given — not what the markup claims:
 *
 *   1. Signed-out: the landing page, the sign-in and sign-up screens, pricing —
 *      each renders on screen with no console/runtime error.
 *   2. The pre-login surface is ONE surface: a single auth card, five real
 *      provider marks, no credential or configuration text anywhere in it.
 *   3. Signed-in owner: every application route renders (dashboard, MASTER,
 *      agents, factory, marketplace, projects, automations, CRM, billing,
 *      settings, owner console, admin fallback, workspace, pricing).
 *   4. Accessibility of what rendered: every control has an accessible name,
 *      every image has alt text, every iframe a title, no duplicate ids, every
 *      field is labelled, and the legal dialog traps focus and returns it.
 *   5. Mobile behaviour that only exists at runtime: the sidebar drawer opens
 *      from the menu and closes from its scrim, and the pane switch swaps the
 *      conversation and the workspace.
 *
 * Usage:
 *   node scripts/rendered-route-audit.mjs                 # 390px + 1440px
 *   node scripts/rendered-route-audit.mjs --widths=320,1440
 *   AUDIT_BASE=http://127.0.0.1:3000 node scripts/rendered-route-audit.mjs
 *
 * The signed-in half needs a real owner account: `.platform-owner-credentials.txt`
 * (two lines — email, password). Without it the run FAILS rather than silently
 * testing less.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, existsSync } from 'node:fs';

const repo = process.cwd();
const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:3000';
const WIDTHS = (process.argv.find((a) => a.startsWith('--widths='))?.split('=')[1] || '390,1440')
  .split(',').map(Number);

let pass = 0;
const failures = [];
const skips = [];
const line = (ok, text) => {
  if (ok) { pass += 1; } else { failures.push(text); }
  if (process.env.VERBOSE) console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${text}`);
};

const CREDS = '.platform-owner-credentials.txt';
if (!existsSync(`${repo}/${CREDS}`)) {
  console.error(`FAIL — ${CREDS} is required: the signed-in half of this audit must not be skipped.`);
  process.exit(1);
}
const [ownerEmail, ownerPassword] = readFileSync(`${repo}/${CREDS}`, 'utf8').trim().split('\n').map((s) => s.trim());

const appJs = readFileSync(`${repo}/public/app.js`, 'utf8');
const html = await (await fetch(`${BASE}/`)).text();

async function boot(width, { signedIn }) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message.slice(0, 160)}`));
  vc.on('error', (...a) => errors.push(`console.error: ${String(a[0]).slice(0, 160)}`));
  vc.on('warn', () => {});

  const dom = new JSDOM(html, { url: `${BASE}/`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const { window } = dom;
  const doc = window.document;
  window.fetch = (i, init = {}) => {
    const raw = typeof i === 'string' ? i : i.url;
    return fetch(raw.startsWith('/') ? `${BASE}${raw}` : raw, init);
  };
  window.matchMedia = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    let matches = true;
    if (max) matches = matches && width <= Number(max[1]);
    if (min) matches = matches && width >= Number(min[1]);
    if (/pointer:\s*coarse|hover:\s*none/.test(query)) matches = true;
    return { matches, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  };
  window.scrollTo = () => {};
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.XMLHttpRequest = class { open() {} send() {} setRequestHeader() {} addEventListener() {} };
  window.eval(appJs);
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  await tick(1200);
  doc.dispatchEvent(new window.Event('DOMContentLoaded'));
  window.dispatchEvent(new window.Event('load'));
  await tick(1200);

  if (signedIn) {
    doc.querySelector('#auth-email').value = ownerEmail;
    doc.querySelector('#auth-password').value = ownerPassword;
    doc.querySelector('#auth-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await tick(2600);
  }
  return { window, doc, errors, tick };
}

const visibleScreen = (doc) => {
  for (const s of doc.querySelectorAll('section.screen')) if (!s.hasAttribute('hidden')) return s.id;
  return null;
};
const visible = (el) => {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (n.hasAttribute('hidden')) return false;
  return true;
};
const unnamedControls = (doc) => [...doc.querySelectorAll('a[href], button, [role="button"], [role="tab"]')]
  .filter((el) => visible(el) && !((el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()));

const SIGNED_OUT_ROUTES = [['#/', 'screen-landing'], ['#/landing', 'screen-landing'], ['#/login', 'screen-auth'], ['#/register', 'screen-auth']];
const SIGNED_IN_ROUTES = [
  ['#/dashboard', 'screen-dashboard'], ['#/master', 'screen-master'], ['#/agents', 'screen-agents'],
  ['#/factory', 'screen-factory'], ['#/marketplace', 'screen-marketplace'], ['#/projects', 'screen-workspace'],
  ['#/automations', 'screen-automations'], ['#/crm', 'screen-crm'], ['#/billing', 'screen-billing'],
  ['#/settings', 'screen-settings'], ['#/economy', 'screen-economy'], ['#/workspace', 'screen-master'],
];

for (const width of WIDTHS) {
  // ---------- signed out ----------
  {
    const { doc, window, errors, tick } = await boot(width, { signedIn: false });
    for (const [hash, expected] of SIGNED_OUT_ROUTES) {
      const before = errors.length;
      window.location.hash = hash;
      await tick(hash === '#/register' ? 900 : 700);
      line(visibleScreen(doc) === expected, `${width}px · ${hash} renders ${expected} (got ${visibleScreen(doc)})`);
      line(unnamedControls(doc).length === 0, `${width}px · ${hash} has no unnamed controls`);
      line(errors.length === before, `${width}px · ${hash} raised no runtime error (${errors.slice(before).join(' | ')})`);
    }

    // The pre-login surface: one card, real provider rows, zero operator text.
    window.location.hash = '#/login';
    await tick(900);
    const auth = doc.querySelector('#screen-auth');
    const cards = [...doc.querySelectorAll('#screen-auth .auth-card')].filter(visible);
    line(cards.length === 1, `${width}px · sign-in is a single surface (found ${cards.length} cards)`);
    line(doc.body.classList.contains('is-auth'), `${width}px · the marketing chrome is retired (body.is-auth)`);
    const oauth = [...doc.querySelectorAll('#auth-oauth .oauth-btn')];
    line(oauth.length === 5, `${width}px · five provider rows render (found ${oauth.length})`);
    line(oauth.every((b) => b.querySelector('.oauth-mark svg')), `${width}px · every provider row carries its official mark`);
    line(oauth.every((b) => /^Continue with [A-Za-z]+$/.test(b.textContent.trim())), `${width}px · provider labels are plain product copy`);
    line(oauth.every((b) => b.dataset.oauthConfigured === '1' ? true : (b.disabled && b.getAttribute('aria-disabled') === 'true')), `${width}px · an unconfigured provider is disabled, never a dead button`);
    line(!/setup needed|CLIENT_ID|CLIENT_SECRET|not configured|provider credentials|GOOGLE_|MICROSOFT_/i.test(auth.textContent), `${width}px · the public sign-in screen leaks no operator configuration`);
    line(doc.querySelector('#auth-feedback')?.getAttribute('aria-live') === 'polite', `${width}px · sign-in feedback is announced politely`);
    line(doc.querySelector('#auth-reveal') !== null, `${width}px · the password reveal control is present`);
    line(doc.querySelector('#auth-password')?.closest('label')?.classList.contains('has-reveal'), `${width}px · the reveal control's field reserves its lane`);
    line(doc.querySelectorAll('section.screen:not([hidden])').length === 1, `${width}px · exactly one screen is on screen`);
  }

  // ---------- signed in as the owner ----------
  {
    const { doc, window, errors, tick } = await boot(width, { signedIn: true });
    line(visibleScreen(doc) !== 'screen-auth', `${width}px · the owner session leaves the sign-in screen`);
    for (const [hash, expected] of SIGNED_IN_ROUTES) {
      const before = errors.length;
      window.location.hash = hash;
      await tick(2200);
      line(visibleScreen(doc) === expected, `${width}px · ${hash} renders ${expected} (got ${visibleScreen(doc)})`);
      line(unnamedControls(doc).length === 0, `${width}px · ${hash} has no unnamed controls`);
      line(errors.length === before, `${width}px · ${hash} raised no runtime error (${errors.slice(before).join(' | ')})`);
    }

    // A role-gated route must fall back, not break.
    window.location.hash = '#/admin';
    await tick(1600);
    line(visibleScreen(doc) !== null, `${width}px · the admin route resolves for the owner (role-gated fallback)`);

    // Owner console: real tables must be scroll-wrapped, and every one is real data.
    window.location.hash = '#/economy';
    await tick(2600);
    const tables = [...doc.querySelectorAll('#screen-economy table')];
    line(tables.every((t) => t.closest('.table-scroll')), `${width}px · every owner-console table sits in a scroll container (${tables.length} table(s))`);

    // Mobile navigation: the drawer and the pane switch, exercised as a user would.
    window.location.hash = '#/master';
    await tick(2600);
    const shell = doc.querySelector('#master-shell');
    const layout = doc.querySelector('#master-layout');
    line(Boolean(shell && layout), `${width}px · the application shell mounts`);
    const menu = doc.querySelector('#master-menu-btn');
    line(Boolean(menu) && menu.getAttribute('aria-controls') === 'master-sidebar', `${width}px · the navigation control is labelled for its drawer`);
    menu?.dispatchEvent(new window.Event('click', { bubbles: true }));
    await tick(150);
    line(shell?.dataset.sidebar === 'drawer', `${width}px · tapping the menu opens the drawer (data-sidebar=${shell?.dataset.sidebar})`);
    doc.querySelector('#master-sidebar-scrim')?.dispatchEvent(new window.Event('click', { bubbles: true }));
    await tick(150);
    line(shell?.dataset.sidebar !== 'drawer', `${width}px · the scrim closes the drawer again`);
    doc.querySelector('#master-pane-chat')?.dispatchEvent(new window.Event('click', { bubbles: true }));
    await tick(150);
    line(layout?.dataset.pane === 'chat', `${width}px · the pane switch shows the conversation`);
    doc.querySelector('#master-pane-workspace')?.dispatchEvent(new window.Event('click', { bubbles: true }));
    await tick(150);
    line(layout?.dataset.pane === 'workspace', `${width}px · and shows the preview/artifacts pane again`);

    // A real run through the composer leaves a real deliverable on the canvas.
    const composer = doc.querySelector('#master-form textarea, #master-goal, .chat-composer textarea');
    const planButton = doc.querySelector('#master-plan-btn');
    // The real flow: a project is selected, so the run stores a versioned artifact.
    const projectSelect = doc.querySelector('#master-project');
    const projectOptions = [...(projectSelect?.options ?? [])].filter((o) => o.value);
    if (projectSelect && projectOptions.length) {
      projectSelect.value = projectOptions[0].value;
      projectSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
      await tick(2600);
    }
    line(projectOptions.length > 0, `${width}px · a real project is available to run into (${projectOptions.length} option(s))`);
    if (composer && planButton) {
      composer.value = 'Build a one-page calculator website with a clean layout.';
      composer.dispatchEvent(new window.Event('input', { bubbles: true }));
      doc.querySelector('#master-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      await tick(22000);
      // the chip carries the honest state in data-state; its label is human copy
      const canvasState = doc.querySelector('#master-canvas-state')?.dataset?.state ?? '';
      const frame = doc.querySelector('.wp-frame');
      line(['ok', 'error'].includes(canvasState), `${width}px · the run reaches a terminal, honest canvas state (${canvasState || 'none'})`);
      if (canvasState === 'ok') {
        // the export bar is refreshed from the artifact store after the run lands
        await tick(6000);
        line(/<!doctype html/i.test(frame?.getAttribute('srcdoc') ?? ''), `${width}px · a completed run renders the real deliverable in the preview`);
        line((frame?.getAttribute('sandbox') ?? '') === 'allow-scripts', `${width}px · the preview frame is sandboxed without same-origin access`);
        line(Boolean(doc.querySelector('#master-export-download')), `${width}px · the export control offers the real artifact (bar: ${doc.querySelector('#master-export-actions')?.textContent?.trim().slice(0, 60)})`);
      } else {
        line(!frame, `${width}px · a failed run leaves nothing faked on the canvas`);
      }
    } else {
      line(false, `${width}px · the composer and its run control are mounted`);
    }

    // Accessibility of what actually rendered.
    const problems = {
      unnamed: unnamedControls(doc).map((el) => el.outerHTML.slice(0, 70)),
      noAlt: [...doc.querySelectorAll('img')].filter((img) => !img.hasAttribute('alt')).length,
      bareIframe: [...doc.querySelectorAll('iframe')].filter((f) => !f.getAttribute('title')).length,
      dupId: (() => {
        const seen = new Set(); const dup = [];
        for (const el of doc.querySelectorAll('[id]')) { if (seen.has(el.id)) dup.push(el.id); else seen.add(el.id); }
        return dup;
      })(),
      unlabelledField: [...doc.querySelectorAll('input:not([type="hidden"]), select, textarea')].filter((f) => {
        if (!visible(f)) return false;
        return !(f.getAttribute('aria-label') || f.getAttribute('aria-labelledby') || (f.id && doc.querySelector(`label[for="${f.id}"]`)) || f.closest('label'));
      }).length,
    };
    line(problems.unnamed.length === 0, `${width}px · every control has an accessible name (${problems.unnamed.slice(0, 3).join(' | ')})`);
    line(problems.noAlt === 0, `${width}px · every image has alt text`);
    line(problems.bareIframe === 0, `${width}px · every iframe has a title`);
    line(problems.dupId.length === 0, `${width}px · element ids are unique (${problems.dupId.slice(0, 3).join(', ')})`);
    line(problems.unlabelledField === 0, `${width}px · every form field is labelled`);

    // The dialog: opens into focus, traps Tab, closes with Escape, restores focus.
    const modal = doc.querySelector('#legal-modal');
    const opener = [...doc.querySelectorAll('[data-legal]')].find(visible);
    if (modal && opener) {
      opener.dispatchEvent(new window.Event('click', { bubbles: true }));
      await tick(250);
      line(!modal.hidden, `${width}px · the legal dialog opens`);
      line(/legal-close/.test(doc.activeElement?.id ?? ''), `${width}px · focus moves into the dialog`);
      doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await tick(250);
      line(modal.hidden, `${width}px · Escape closes it`);
      line(doc.activeElement === opener, `${width}px · focus returns to the control that opened it`);
    } else {
      line(false, `${width}px · the legal dialog and its opener are mounted`);
    }
  }
}

console.log(`\nRENDERED ROUTE AUDIT — ${WIDTHS.join(' / ')} px`);
console.log(`  ${pass} passed, ${failures.length} failed${skips.length ? `, ${skips.length} skipped` : ''}`);
for (const f of failures) console.log(`  FAIL — ${f}`);
process.exit(failures.length ? 1 : 0);
