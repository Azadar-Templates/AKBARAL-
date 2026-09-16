#!/usr/bin/env node
/**
 * ZA141251SA dashboard login verification — the real browser flow, headless.
 *
 *   node scripts/verify-mission-login.mjs
 *
 * The mission console is a plain page (index.html + app.js) served by the
 * mission server. This script loads that exact document in a DOM, points its
 * fetch at the running server, types the owner credentials into the real form
 * and asserts what a person would see:
 *
 *   · the login panel is shown when there is no session
 *   · a wrong password surfaces an error and keeps the user on the form
 *   · the configured owner signs in, the app panel opens, the identity line
 *     shows the signed-in owner and the overview renders real numbers
 *   · the session survives a reload (token is restored, /session/me revalidates)
 *   · signing out returns to the login panel and clears the stored session
 *
 * Credentials come from the environment or the operator's local credentials
 * file; nothing is printed. Exit code 1 on any failed step.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.MISSION_BASE ?? 'http://127.0.0.1:4200';
const repo = process.cwd();
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function credentials() {
  const email = process.env.MISSION_EMAIL;
  const password = process.env.MISSION_PASSWORD;
  if (email && password) return { email, password };
  const file = path.resolve(repo, '.mission-owner-credentials.txt');
  if (!fs.existsSync(file)) return { email: '', password: '' };
  const text = fs.readFileSync(file, 'utf8');
  return {
    email: new RegExp('email:\\s*(\\S+)').exec(text)?.[1] ?? '',
    password: new RegExp('password:\\s*(\\S+)').exec(text)?.[1] ?? '',
  };
}

async function newPage(token = '') {
  const html = await (await fetch(`${BASE}/`)).text();
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM(html, { url: `${BASE}/`, runScripts: 'dangerously', resources: undefined, pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  // The page must reach the real server, the same way a browser would.
  window.fetch = (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input.url;
    return fetch(raw.startsWith('/') ? `${BASE}${raw}` : raw, init);
  };
  window.scrollTo = () => {};
  if (token) window.sessionStorage.setItem('za_mission_token', token);
  // The document already ran its own scripts; re-run app.js in this context so
  // module-scope state (the token read from storage) is what the page uses.
  window.eval(fs.readFileSync(path.join(repo, 'mission-dashboard/app.js'), 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 400));
  return { dom, window, errors };
}

function waitFor(getter, description, timeoutMs = 6000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let value;
      try {
        value = getter();
      } catch {
        value = null;
      }
      if (value) return resolve(value);
      if (Date.now() - started > timeoutMs) return reject(new Error(`timed out waiting for ${description}`));
      setTimeout(tick, 50);
    };
    tick();
  });
}

async function main() {
  const { email, password } = credentials();
  if (!email || !password) {
    console.error('no owner credentials available (set MISSION_EMAIL/MISSION_PASSWORD or write .mission-owner-credentials.txt)');
    process.exit(1);
  }

  const health = await (await fetch(`${BASE}/api/health`)).json();
  record('the mission server is reachable and reports its state', health.status === 'ok', `ownerAccounts=${health.ownerAccounts}, vault=${health.vaultConfigured}`);

  // ── 1. a fresh visitor sees the login panel ───────────────────────────────
  const fresh = await newPage();
  const freshDoc = fresh.window.document;
  record(
    'a fresh visitor is shown the login panel and nothing else',
    !freshDoc.querySelector('#login-panel').hidden && freshDoc.querySelector('#app').hidden,
    `identity="${freshDoc.querySelector('#identity').textContent}"`,
  );

  // ── 2. the form is a real form (no hardcoded identity in the markup) ─────
  const emailField = freshDoc.querySelector('#email');
  const passwordField = freshDoc.querySelector('#password');
  const markup = freshDoc.documentElement.outerHTML;
  record(
    'the login form is empty and carries no hardcoded identity',
    emailField.value === '' && passwordField.value === '' && !markup.includes(email),
    'email + password fields start empty',
  );

  // ── 3. a wrong password is refused in the UI ─────────────────────────────
  emailField.value = email;
  passwordField.value = `${password}-wrong`;
  freshDoc.querySelector('#login-form').dispatchEvent(new fresh.window.Event('submit', { bubbles: true, cancelable: true }));
  const errorShown = await waitFor(() => {
    const node = freshDoc.querySelector('#login-error');
    return node && !node.hidden && node.textContent.trim().length > 0 ? node.textContent.trim() : null;
  }, 'the login error', 8000);
  record('a wrong password shows an error and stays on the form', Boolean(errorShown) && freshDoc.querySelector('#app').hidden, `"${errorShown}"`);

  // ── 4. the configured owner signs in ─────────────────────────────────────
  emailField.value = email;
  passwordField.value = password;
  freshDoc.querySelector('#login-form').dispatchEvent(new fresh.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => (!freshDoc.querySelector('#app').hidden ? true : null), 'the app panel', 10000);
  const identity = await waitFor(
    () => {
      const text = freshDoc.querySelector('#identity').textContent;
      return text.includes(email) ? text : null;
    },
    'the identity line to show the signed-in owner',
    10000,
  );
  record('the configured owner signs in and the console opens', identity.includes(email), `identity="${identity}"`);

  const cards = await waitFor(() => (freshDoc.querySelector('#overview-cards').children.length > 0 ? freshDoc.querySelector('#overview-cards') : null), 'the overview cards', 10000);
  record('the signed-in dashboard renders real overview data', cards.children.length >= 6, `${cards.children.length} cards, first="${cards.children[0].textContent.slice(0, 60)}"`);

  const storedToken = fresh.window.sessionStorage.getItem('za_mission_token');
  record('the session token is stored for the tab only (not localStorage)', Boolean(storedToken) && !fresh.window.localStorage.getItem('za_mission_token'), `sessionStorage=${Boolean(storedToken)}`);

  // ── 5. a reload keeps the session and revalidates it ────────────────────
  const reloaded = await newPage(storedToken);
  const reloadedDoc = reloaded.window.document;
  await waitFor(() => (!reloadedDoc.querySelector('#app').hidden ? true : null), 'the app panel after reload', 10000);
  const reloadedIdentity = await waitFor(
    () => {
      const text = reloadedDoc.querySelector('#identity').textContent;
      return text.includes(email) ? text : null;
    },
    'the restored session identity',
    10000,
  );
  record(
    'a reload restores the session (identity revalidated from the server) and re-shows the signed-in console',
    !reloadedDoc.querySelector('#app').hidden && reloadedDoc.querySelector('#login-panel').hidden && reloadedIdentity.includes(email),
    reloadedIdentity,
  );

  // ── 6. the first screen offers the real owner controls (no placeholders) ─
  const createForm = reloadedDoc.querySelector('#create-agent-form');
  const activitySelect = reloadedDoc.querySelector('#create-agent-activity');
  await waitFor(() => (activitySelect.options.length > 0 ? true : null), 'the activity catalog', 8000);
  record(
    'the console offers the policy activity catalog in the create-agent form',
    Boolean(createForm) && activitySelect.options.length >= 5,
    `${activitySelect.options.length} activities`,
  );
  const tabs = Array.from(reloadedDoc.querySelectorAll('#tabs .tab')).map((node) => node.textContent.trim());
  record('every mission section is reachable from the navigation', tabs.length >= 7, tabs.join(' / '));

  // ── 7. signing out clears the session ───────────────────────────────────
  reloadedDoc.querySelector('#signout').dispatchEvent(new reloaded.window.Event('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  record(
    'signing out returns to the login panel and clears the stored session',
    !reloadedDoc.querySelector('#login-panel').hidden && !reloaded.window.sessionStorage.getItem('za_mission_token'),
    `token=${reloaded.window.sessionStorage.getItem('za_mission_token') ? 'still stored' : 'cleared'}`,
  );

  const scriptErrors = [...fresh.errors, ...reloaded.errors];
  record('no uncaught script errors during the whole flow', scriptErrors.length === 0, scriptErrors.slice(0, 2).join(' | '));

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${failed.length === 0 ? 'LOGIN VERIFIED' : `${failed.length} STEP(S) FAILED`} — ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('verification failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
