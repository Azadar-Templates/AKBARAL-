#!/usr/bin/env node
/**
 * AKBARAL! — Task 4 live shell smoke (the application shell, end to end).
 *
 * Loads the SERVER-RENDERED /workspace document from a RUNNING AKBARAL! stack
 * into jsdom, executes the real public/app.js against the REAL authenticated
 * APIs (nothing is mocked) and drives the shell exactly as a user does:
 *
 *   signed-out gate → sign-in form → sidebar navigation (Library / Images /
 *   Files / Search) → a real MASTER run → New chat → sidebar + rail collapse
 *   → the phone drawer and pane switch → account menu / sign-out
 *
 * Usage (the stack must be up — `npm start`, or the preview processes):
 *   AKBARAL_WEB_URL=http://127.0.0.1:3000 \
 *   AKBARAL_API_URL=http://127.0.0.1:4000 \
 *     npm run smoke:shell
 *
 * When the local ops file `.platform-owner-credentials.txt` exists (two
 * lines: owner email, owner password) the script also proves the OWNER path —
 * the sidebar reveals the owner console entry for the owner role and stays
 * hidden for ordinary accounts. It never prints a password.
 *
 * Exit code 0 = every check passed.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const WEB = (process.env.AKBARAL_WEB_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const API = (process.env.AKBARAL_API_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');

const problems = [];
const results = [];
const check = (label, ok, detail = '') => {
  results.push([ok, label, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`);
};

/* ---------------------------------------------------------------- account */

async function signup(email, password, name) {
  const response = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (![201, 409].includes(response.status)) {
    throw new Error(`register failed (${response.status})`);
  }
}

const ownerFile = '.platform-owner-credentials.txt';
const useOwner = existsSync(ownerFile);
const credentials = useOwner
  ? readFileSync(ownerFile, 'utf8').trim().split('\n')
  : (() => {
      const stamp = Date.now();
      const email = `shell-smoke-${stamp}@akbaral.test`;
      const password = `Shell-smoke-${randomBytes(9).toString('base64url')}!1`;
      return [email, password];
    })();
const [email, password] = credentials;
await signup(email, password, useOwner ? 'AKBARAL Owner' : 'Shell Smoke');

/* ------------------------------------------------------------ the browser */

const html = await (await fetch(`${WEB}/workspace`)).text();
const appJs = readFileSync('public/app.js', 'utf8');
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (error) => problems.push(`jsdomError: ${String(error.message).slice(0, 200)}`));
virtualConsole.on('error', (...args) => problems.push(`console.error: ${String(args[0]).slice(0, 200)}`));

const dom = new JSDOM(html, {
  url: `${WEB}/workspace`,
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;
const doc = window.document;

// Same-origin requests are proxied to the API, cookies/tokens flow exactly as
// in a browser (the SPA keeps the session in localStorage + Bearer headers).
window.fetch = (input, init = {}) => {
  const raw = typeof input === 'string' ? input : input.url;
  return fetch(raw.startsWith('/') ? `${API}${raw}` : raw, init);
};
window.matchMedia = (query) => ({
  matches: /max-width:\s*1080px/.test(query) ? window.__narrow === true : false,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
});
window.scrollTo = () => {};
window.XMLHttpRequest = class { open() {} send() {} setRequestHeader() {} addEventListener() {} };

window.eval(appJs);
const tick = (ms = 900) => new Promise((resolve) => setTimeout(resolve, ms));
await tick(60);
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
window.dispatchEvent(new window.Event('load'));
await tick(1500);

const q = (selector) => doc.querySelector(selector);
const shellState = () => q('#master-shell')?.dataset ?? {};
const turns = () => doc.querySelectorAll('.chat-msg').length;

/* ---------------------------------------------------------------- checks */

// 1 — boot + the signed-out gate.
check('bundle boots and mounts the application shell', Boolean(q('#master-shell')), `hash=${window.location.hash}`);
check('signed-out /workspace shows the real sign-in card', q('#screen-auth')?.hidden === false);
check('the OAuth area lists the real providers', Boolean(q('#auth-oauth')));
await tick(800);
const oauthLabels = [...doc.querySelectorAll('#auth-oauth-buttons .oauth-btn')].map((button) => button.textContent.trim());
check('Google / GitHub / Facebook buttons are mounted', oauthLabels.length >= 5, oauthLabels.join(' | ').slice(0, 170));
check('unconfigured providers are disabled, never fake success', [...doc.querySelectorAll('#auth-oauth-buttons button.oauth-btn')].every((button) => button.disabled === true));

// 2 — real sign-in through the real form and the real auth API.
q('#auth-email').value = email;
q('#auth-password').value = password;
q('#auth-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await tick(3200);
check('sign-in lands in the workspace', q('#screen-master')?.hidden === false && doc.body.classList.contains('is-workspace'), `hash=${window.location.hash}`);
check('the account block shows the signed-in identity', q('#ak-user-name').textContent.trim().length > 0 && q('#ak-user-name').textContent !== 'Guest', q('#ak-user-name').textContent);
check('the credit pill carries a real number', /Credits|Trial/.test(q('#ak-credit-pill').textContent), q('#ak-credit-pill').textContent);
check('recent history loaded real data', /list-item/.test(q('#master-task-history').innerHTML));
if (useOwner) {
  check('owner account is revealed the Owner console entry', q('#ak-owner-link').hidden === false);
} else {
  check('ordinary account NEVER sees the owner entry (RBAC)', q('#ak-owner-link').hidden === true);
}

// 3 — sidebar navigation drives the rail panels with real data.
q('#ak-nav-library').click();
await tick(1500);
check('Library selects its rail tab and panel', q('#ak-tab-library').getAttribute('aria-selected') === 'true' && q('#ak-pane-library').hidden === false && shellState().rail === 'open');
check('Library rendered real content or an honest empty state', /library-row|empty-state|state-card/.test(q('#master-library').innerHTML));
q('#ak-nav-media').click();
await tick(2500);
check('Images & media selects its rail tab and panel', q('#ak-tab-media').getAttribute('aria-selected') === 'true' && q('#ak-pane-media').hidden === false);
check('Media rendered real content or an honest empty state', /media-card|empty-state|list-item/.test(q('#master-media').innerHTML));
q('#ak-nav-files').click();
await tick(1500);
check('Files selects the uploaded + generated file panel', q('#ak-tab-files').getAttribute('aria-selected') === 'true' && Boolean(q('#master-attachment-input')));

// 4 — the search overlay runs against the real task / knowledge APIs.
q('#ak-nav-search').click();
await tick(200);
check('Search opens from the sidebar', q('#master-search').hidden === false);
q('#master-search-input').value = 'calculator';
q('#master-search-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await tick(2500);
const groups = [...doc.querySelectorAll('#master-search-results .ak-command-group > b')].map((node) => node.textContent);
check('Search answered from the real APIs', groups.length > 0, groups.join(', '));
doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await tick(200);
check('Escape closes the overlay', q('#master-search').hidden === true);

// 5 — a real MASTER run through the real pipeline (honest outcome).
q('#master-goal').value = 'Build me a calculator';
q('#master-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await tick(1200);
check('the goal opens as a real user turn', turns() >= 1 && q('#master-chat-log').innerHTML.includes('Build me a calculator'));
await tick(15000);
const canvasState = q('#master-canvas-state').textContent.trim();
check('the run reaches a terminal, honest canvas state', /failed|ok|error|idle/i.test(canvasState), `canvas = ${canvasState}`);
check('the outcome is never faked as success without a result', canvasState !== 'ok' || /Export|result/i.test(q('#master-result').innerHTML), q('#master-output').textContent.split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 130));

// 6 — New chat resets the conversation for real.
q('#master-new-chat').click();
await tick(600);
check('New chat clears the conversation', turns() === 0, `turns=${turns()}`);
check('New chat returns the canvas to idle', q('#master-canvas-state').textContent.trim() === 'idle');

// 7 — layout state machine (desktop collapse + phone drawer/pane switch).
q('#master-sidebar-toggle').click();
await tick(200);
check('sidebar collapses to icons', shellState().sidebar === 'collapsed');
q('#master-sidebar-toggle').click();
await tick(200);
check('sidebar expands again', shellState().sidebar === 'open');
q('#master-rail-toggle').click();
await tick(200);
check('the preview rail collapses', shellState().rail === 'closed' && q('#master-rail-toggle').getAttribute('aria-expanded') === 'false');
q('#master-rail-toggle').click();
await tick(200);
check('the preview rail reopens', shellState().rail === 'open');

window.__narrow = true; // ≤1080px: the drawer + pane switch take over
q('#master-menu-btn').click();
await tick(200);
check('the phone burger opens the sidebar drawer', shellState().sidebar === 'drawer' && q('#master-sidebar-scrim').hidden === false);
q('#master-sidebar-scrim').click();
await tick(200);
check('the scrim closes the drawer', shellState().sidebar === 'open' && q('#master-sidebar-scrim').hidden === true);
q('#master-pane-chat').click();
await tick(200);
check('the pane switch selects the conversation', q('#master-layout').dataset.pane === 'chat' && q('#master-pane-chat').getAttribute('aria-selected') === 'true');
q('#master-pane-workspace').click();
await tick(200);
check('the pane switch selects the preview rail', q('#master-layout').dataset.pane === 'workspace');
q('#ak-nav-files').click();
await tick(400);
check('opening a rail panel on a phone reveals the rail pane', q('#master-layout').dataset.pane === 'workspace');

// 8 — account menu + real sign-out.
q('#ak-account-menu-btn').click();
await tick(150);
check('the account menu opens with real entries', q('#ak-account-menu').hidden === false && q('#ak-account-menu').innerHTML.includes('settings'));
q('#ak-logout').click();
await tick(1400);
check('sign-out clears the session and returns to the landing screen', q('#screen-landing').hidden === false && !doc.body.classList.contains('is-workspace'));

/* ----------------------------------------------------------------- report */

const failed = results.filter(([ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} shell checks passed`);
if (failed.length) {
  console.log('failures:');
  for (const [, label, detail] of failed) console.log(`  · ${label} ${detail}`);
}
console.log('runtime problems:', problems.length ? [...new Set(problems)].slice(0, 8) : 'none');
process.exit(failed.length ? 1 : 0);
