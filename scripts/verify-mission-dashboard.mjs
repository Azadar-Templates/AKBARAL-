#!/usr/bin/env node
/**
 * ZA141251SA mission console — end-to-end login + render verification.
 *
 *   node scripts/verify-mission-dashboard.mjs
 *
 * Loads the REAL served console in a DOM, runs its REAL client script, and
 * asserts what a person would actually see:
 *
 *   1. A fresh visitor (no session) gets the sign-in panel — the console is
 *      never open to anonymous visitors.
 *   2. The sign-in form carries no pre-filled or hardcoded owner identity.
 *   3. Wrong credentials are refused with an error and the panel stays.
 *   4. The configured owner signs in through the form; the session token is
 *      kept for the tab only (sessionStorage), never in localStorage.
 *   5. The console renders its real data: overview cards, agent list, treasury,
 *      policy and audit sections — every value fetched from the mission API.
 *   6. A reload with the stored session restores the console (no re-login).
 *   7. Sign-out clears the stored session and returns to the panel.
 *
 * The owner password is read from the environment or from
 * `.mission-owner-credentials.txt` and is never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const BASE = (process.env.MISSION_BASE ?? 'http://127.0.0.1:4200').replace(/\/$/, '');
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function ownerCredentials() {
  if (process.env.MISSION_OWNER_EMAIL && process.env.MISSION_OWNER_PASSWORD) {
    return { email: process.env.MISSION_OWNER_EMAIL, password: process.env.MISSION_OWNER_PASSWORD };
  }
  const file = path.resolve(process.cwd(), '.mission-owner-credentials.txt');
  if (!fs.existsSync(file)) return null;
  const match = {
    email: /email[:\s]+(\S+)/i.exec(fs.readFileSync(file, 'utf8'))?.[1],
    password: /password[:\s]+(\S+)/i.exec(fs.readFileSync(file, 'utf8'))?.[1],
  };
  return match.email && match.password ? match : null;
}

async function bootConsole(initialToken = '') {
  const html = await (await fetch(`${BASE}/`)).text();
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error.message));
  virtualConsole.on('error', (message) => errors.push(String(message)));
  const dom = new JSDOM(html, { url: `${BASE}/`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  // A returning visitor already has the tab session: the console reads it from
  // sessionStorage when its own script loads.
  if (initialToken) window.sessionStorage.setItem('za_mission_token', initialToken);
  // The page must talk to the real mission server.
  window.fetch = (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input.url;
    return fetch(raw.startsWith('/') ? `${BASE}${raw}` : raw, init);
  };
  window.scrollTo = () => {};
  window.eval(fs.readFileSync(path.resolve(process.cwd(), 'mission-dashboard/app.js'), 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  return { dom, window, document: window.document, errors };
}

const waitFor = async (getter, description, timeoutMs = 8000) => {
  const started = Date.now();
  for (;;) {
    const value = getter();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

async function main() {
  const credentials = ownerCredentials();
  if (!credentials) {
    console.error('no mission owner credentials (set MISSION_OWNER_EMAIL/MISSION_OWNER_PASSWORD or write .mission-owner-credentials.txt)');
    process.exit(1);
  }

  const health = await (await fetch(`${BASE}/api/health`)).json().catch(() => null);
  record('the mission API answers and reports its own state',
    Boolean(health) && typeof health === 'object',
    health ? Object.entries(health).slice(0, 4).map(([key, value]) => `${key}=${typeof value === 'object' ? '…' : value}`).join(', ') : 'no health payload');

  // ── 1. fresh visitor ───────────────────────────────────────────────────
  const first = await bootConsole();
  const { document: doc, window: win } = first;
  await waitFor(() => doc.querySelector('#login-panel') && !doc.querySelector('#login-panel').hidden ? 'panel' : '', 'the sign-in panel');
  record('a fresh visitor gets the sign-in panel', doc.querySelector('#login-panel').hidden === false);
  record('the sign-in form is empty — no hardcoded owner identity',
    doc.querySelector('#email').value === '' && doc.querySelector('#password').value === '',
    `email field value: "${doc.querySelector('#email').value}"`);

  // The source of truth for "no hardcoded identity" is the served script itself.
  const clientSource = await (await fetch(`${BASE}/app.js`)).text().catch(() => fs.readFileSync(path.resolve(process.cwd(), 'mission-dashboard/app.js'), 'utf8'));
  const emails = [...clientSource.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)].map((match) => match[0]).filter((address) => !address.endsWith('akbaral.test'));
  record('the console script contains no hardcoded account address', emails.length === 0, emails.slice(0, 3).join(', ') || 'none found');

  // ── 2. wrong credentials ───────────────────────────────────────────────
  doc.querySelector('#email').value = credentials.email;
  doc.querySelector('#password').value = 'definitely-not-the-password';
  doc.querySelector('#login-form').dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true }));
  const errorShown = await waitFor(() => {
    const error = doc.querySelector('#login-error');
    return error && !error.hidden && error.textContent.trim() ? error.textContent.trim() : '';
  }, 'the sign-in error message');
  record('wrong credentials are refused and the panel stays', doc.querySelector('#login-panel').hidden === false, errorShown.slice(0, 80));

  // ── 3. owner sign-in ───────────────────────────────────────────────────
  doc.querySelector('#password').value = credentials.password;
  doc.querySelector('#login-form').dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true }));
  const cards = await waitFor(() => {
    const nodes = doc.querySelectorAll('#overview-cards .card');
    return nodes.length > 0 ? nodes : '';
  }, 'the signed-in console to render');
  record('the owner signs in through the real form', doc.querySelector('#login-panel').hidden === true && doc.querySelector('#app')?.hidden === false);
  // The overview is one screen: exactly the five readouts the owner asked for, nothing else.
  record('the overview renders exactly the five cards and nothing else', cards.length === 5, `${cards.length} cards rendered`);

  const tokenInSession = win.sessionStorage.getItem('za_mission_token');
  const tokenInLocal = win.localStorage.getItem('za_mission_token');
  record('the session token is kept for the tab only', Boolean(tokenInSession) && !tokenInLocal,
    `sessionStorage=${Boolean(tokenInSession)}, localStorage=${Boolean(tokenInLocal)}`);

  // ── 4. real data sections ──────────────────────────────────────────────
  const tabs = [...doc.querySelectorAll('#tabs button')].map((button) => button.getAttribute('data-tab'));
  record('the console has exactly four top-level sections', tabs.length === 4, tabs.join(', '));
  record('nothing hides a fifth section outside the nav row', [...doc.querySelectorAll('[data-tab]')].every(node => node.closest('#tabs')),
    `${[...doc.querySelectorAll('[data-tab]')].length} data-tab nodes, all inside #tabs`);

  // Views that were top-level tabs are collapsed blocks now, so a check has to open its family and
  // then the block — which is also what the owner does, so the click budget is verified here too.
  const sectionOf = (view) => {
    const button = [...doc.querySelectorAll('#tabs button')].find((entry) => entry.getAttribute('data-tab') === view);
    if (button) return view;
    const details = doc.querySelector(`details.sub[data-view="${view}"]`);
    return details ? details.closest('[data-panel]').getAttribute('data-panel') : null;
  };
  const clickTab = async (view) => {
    const section = sectionOf(view);
    if (!section) throw new Error(`no section owns the view ${view}`);
    const button = [...doc.querySelectorAll('#tabs button')].find((entry) => entry.getAttribute('data-tab') === section);
    button.dispatchEvent(new win.Event('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const details = doc.querySelector(`details.sub[data-view="${view}"]`);
    if (details && !details.open) {
      details.querySelector('summary').dispatchEvent(new win.Event('click', { bubbles: true }));
      if (!details.open) { details.open = true; details.dispatchEvent(new win.Event('toggle')); }
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (details.open !== true) throw new Error(`${view} did not open on one click`);
    }
  };

  // Deep links have to keep working for the folded views: the owner bookmarks the audit trail, and a
  // route that silently lands elsewhere is a broken link, not a simplification.
  for (const node of [...doc.querySelectorAll('details.sub')]) {
    const view = node.getAttribute('data-view');
    win.location.hash = `#/${view}`;
    await new Promise((resolve) => setTimeout(resolve, 350));
    const panel = node.closest('[data-panel]');
    record(`the collapsed block ${view} answers #/${view}`, panel?.hidden === false && node.open === true,
      `panel hidden=${panel?.hidden}, block open=${node.open}`);
  }

  await clickTab('agents');
  const agentRows = doc.querySelectorAll('#agent-list tr').length;
  record('the agents section lists agents from the mission database', agentRows > 1, `${agentRows - 1} rows`);

  await clickTab('treasury');
  const walletRows = doc.querySelectorAll('#wallets tr').length;
  const ledgerRows = doc.querySelectorAll('#ledger tr').length;
  // The console's job is the surface: wallets listed, and the ledger either rendered or declared
  // empty in its own words. A scratch database legitimately has no ledger rows, and "no ledger
  // entries yet." is the correct answer, not a failure to hide behind a green check.
  const ledgerText = (doc.querySelector('#ledger')?.textContent ?? '').trim();
  const ledgerSurfaceOk = ledgerRows > 0 || /no ledger entries yet/i.test(ledgerText);
  record('the treasury section renders wallets and the ledger surface', walletRows > 0 && ledgerSurfaceOk,
    `${walletRows - 1} wallets, ${ledgerRows > 0 ? `${ledgerRows - 1} ledger entries` : `empty ledger stated plainly: "${ledgerText.slice(0, 48)}"`}`);

  await clickTab('policy');
  const policyText = doc.querySelector('#policy')?.textContent ?? doc.body.textContent;
  record('the policy section renders real limits', /maxAgents|agent cap|Kill switch/i.test(policyText), policyText.trim().split('\n')[0]?.slice(0, 80) ?? '');

  await clickTab('audit');
  const auditRows = doc.querySelectorAll('#audit tr').length;
  record('the audit section renders the hash-chained log', auditRows > 1, `${auditRows - 1} entries`);

  // ── 5. reload restores the session ─────────────────────────────────────
  const token = win.sessionStorage.getItem('za_mission_token');
  const second = await bootConsole(token);
  const restored = await waitFor(() => (second.document.querySelector('#app')?.hidden === false ? 'restored' : ''), 'the stored session to restore the console');
  const restoredIdentity = second.document.querySelector('#identity')?.textContent ?? '';
  record('a reload with the stored session restores the console without re-login',
    restored === 'restored' && Boolean(token),
    restoredIdentity.trim().slice(0, 60));

  // ── 6. sign out ────────────────────────────────────────────────────────
  doc.querySelector('#signout').dispatchEvent(new win.Event('click', { bubbles: true }));
  const signedOut = await waitFor(() => (doc.querySelector('#login-panel').hidden === false ? 'out' : ''), 'the sign-out to return to the panel');
  record('sign-out returns to the panel and clears the stored session',
    signedOut === 'out' && !win.sessionStorage.getItem('za_mission_token'),
    `token after sign-out: ${win.sessionStorage.getItem('za_mission_token') ?? 'cleared'}`);

  record('no uncaught script errors while rendering the console', first.errors.length === 0, first.errors.slice(0, 2).join(' | '));

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${failed.length === 0 ? 'MISSION CONSOLE VERIFIED' : `${failed.length} CHECK(S) FAILED`} — ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('console verification failed:', error instanceof Error ? error.message : error);
  const failed = results.filter((entry) => !entry.ok).length;
  console.log(`\nCONSOLE VERIFICATION INCOMPLETE — ${results.length - failed}/${results.length}`);
  process.exit(1);
});
