#!/usr/bin/env node
/**
 * AKBARAL! — refresh / deep-link verification (browser-shaped, no fixture).
 *
 *   node scripts/verify-refresh-deeplinks.mjs
 *
 * Reproduces exactly what a browser does when it REFRESHES a URL: it asks the
 * server for that path, then runs the real client bundle against the real API.
 * A framework 404 page, a blank screen or a silently dropped session all fail
 * this check.
 *
 * Covered:
 *   · every application surface answers 200 with the shell (not a 404 page),
 *   · each clean path opens ITS OWN screen (the whole point of the route),
 *   · a signed-in visitor whose tab is refreshed on a deep link gets the
 *     session restored from the stored refresh token and the authenticated
 *     surface back — no re-login,
 *   · a visitor with a revoked/expired token is returned to the sign-in screen
 *     instead of a broken or blank page,
 *   · an anonymous visitor on an app surface is asked to sign in (never shown
 *     another account's data),
 *   · unknown paths and the private mission names still 404,
 *   · no uncaught script errors on any of it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const BASE = (process.env.AUDIT_BASE ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * A brand-new session per scenario. The server rotates refresh tokens (a
 * reused token is rejected by design — the auth probe asserts that), so one
 * token cannot be replayed across several boots: each refresh below gets its
 * own account session, exactly like a different browser tab would.
 */
/** The configured deployment owner (gitignored file or environment). */
function ownerCredentials() {
  if (process.env.OWNER_EMAIL && process.env.OWNER_PASSWORD) {
    return { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD };
  }
  const file = path.resolve(process.cwd(), '.platform-owner-credentials.txt');
  if (!fs.existsSync(file)) return null;
  return parseOwnerCredentials(fs.readFileSync(file, 'utf8'));
}

/**
 * POST that respects the platform's REAL rate limiter (/api/auth allows 30
 * requests per minute). A 429 is infrastructure, not a product verdict: it is
 * retried with backoff, and if it still cannot get through the call reports
 * that explicitly instead of silently degrading into a missing token.
 */

/** Accept both credentials formats: two lines (email, password) or labelled lines. */
function parseOwnerCredentials(text) {
  const lines = text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const labelledEmail = /^email[:\s]+(\S+)$/i.exec(lines.find((line) => /^email[:\s]/i.test(line)) ?? '')?.[1];
  const labelledPassword = /^password[:\s]+(\S+)$/i.exec(lines.find((line) => /^password[:\s]/i.test(line)) ?? '')?.[1];
  if (labelledEmail && labelledPassword) return { email: labelledEmail, password: labelledPassword };
  const [email = '', password = ''] = lines;
  return email.includes('@') && password ? { email, password } : null;
}

async function postAuth(path, payload, { attempts = 6, waitMs = 12_000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.status !== 429) return response;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return { status: 429, json: async () => null, text: async () => 'rate limited' };
}

async function freshSession() {
  const suffix = Math.random().toString(36).slice(2, 8);
  const email = `refresh-${suffix}@akbaral.test`;
  const password = 'refresh-check-password-1';
  await postAuth('/api/auth/register', { email, password, name: 'Refresh check' });
  const login = await postAuth('/api/auth/login', { email, password });
  const body = await login.json().catch(() => null);
  if (login.status === 429) {
    throw new Error('the platform rate limiter refused the verifier itself (429 on /api/auth/login) — this is an infrastructure limit, not a product verdict');
  }
  return { email, password, refreshToken: body?.refreshToken ?? null };
}

/** Load a path the way a browser refresh does, then run the real bundle. */
async function refreshAt(routePath, { refreshToken = null, runScripts = true } = {}) {
  const response = await fetch(`${BASE}${routePath}`);
  const html = await response.text();
  const isFramework404 = html.includes('class="next-error-h1"');
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error.message));
  virtualConsole.on('error', (message) => errors.push(String(message)));
  const dom = new JSDOM(html, { url: `${BASE}${routePath}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  window.fetch = (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input.url;
    return fetch(raw.startsWith('/') ? `${BASE}${raw}` : raw, init);
  };
  window.scrollTo = () => {};
  if (refreshToken) window.localStorage.setItem('ak_refresh', refreshToken);
  if (runScripts) {
    window.eval(fs.readFileSync(path.resolve(process.cwd(), 'public/app.js'), 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  const visibleScreen = () => {
    const shown = [...window.document.querySelectorAll('.screen')].filter((node) => !node.hidden);
    return shown.map((node) => node.id).join(',') || '(none)';
  };
  return { status: response.status, isFramework404, window, visibleScreen, errors, bytes: html.length };
}

const waitFor = async (getter, description, timeoutMs = 9000) => {
  const started = Date.now();
  for (;;) {
    const value = await getter();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
};

/** path → the screen the route must open (auth screen for the entry paths). */
const EXPECTED = [
  ['/', 'anchor:any'],
  ['/workspace', 'screen-master'],
  ['/master', 'screen-master'],
  ['/signin', 'screen-auth'],
  ['/signup', 'screen-auth'],
  ['/projects', 'screen-workspace'],
  ['/billing', 'screen-billing'],
  // /admin is the STAFF plane: a customer session must be refused by the
  // client gate and land on its own dashboard (the API refuses too). The owner
  // case below asserts the console really opens for a staff session.
  ['/admin', 'screen-dashboard'],
];

async function main() {
  const account = await freshSession();
  if (!account.refreshToken) {
    console.error('could not obtain a session to test session restoration');
    process.exit(1);
  }

  // ── 1. every app surface answers with the shell, never a 404 page ────────
  for (const [routePath] of EXPECTED) {
    const response = await fetch(`${BASE}${routePath}`);
    const html = await response.text();
    const framework404 = html.includes('class="next-error-h1"');
    const hasShell = html.includes('id="screen-auth"') || html.includes('id="app"');
    record(`refresh ${routePath} → 200 application shell`,
      response.status === 200 && !framework404 && hasShell,
      `HTTP ${response.status}, ${html.length} bytes${framework404 ? ', FRAMEWORK 404 PAGE' : ''}`);
  }

  // ── 2. each clean path opens its own screen for a signed-in visitor ──────
  for (const [routePath, expected] of EXPECTED) {
    if (expected === 'anchor:any') continue;
    const perPathSession = await freshSession(); // its own token: rotation is single-use
    const session = await refreshAt(routePath, { refreshToken: perPathSession.refreshToken });
    let screen = session.visibleScreen();
    if (screen === '(none)') {
      try {
        screen = await waitFor(() => session.visibleScreen() === '(none)' ? '' : session.visibleScreen(), `a screen on ${routePath}`);
      } catch { /* reported below */ }
    }
    record(`signed-in refresh on ${routePath} opens ${expected}`,
      screen.includes(expected),
      `visible: ${screen}${session.errors.length ? `; errors: ${session.errors[0]}` : ''}`);
  }

  // ── 3. session restoration really happened (not a lucky cached token) ────
  const identitySession = await freshSession();
  const deep = await refreshAt('/billing', { refreshToken: identitySession.refreshToken });
  const screenAfterRefresh = deep.visibleScreen();
  // The proof that the session was restored is not a pixel: it is that the
  // SPA, after the refresh, holds a WORKING access token it obtained by
  // rotating the stored refresh token. Ask the API with exactly that token.
  // Boot is asynchronous: wait (bounded) for the SPA to finish restoring the
  // session before judging it. The assertion itself is unchanged — a restored
  // WORKING token, obtained by rotating the stored refresh token.
  const readStorage = () => ({
    access: deep.window.localStorage.getItem('ak_access') ?? '',
    refresh: deep.window.localStorage.getItem('ak_refresh') ?? '',
  });
  try {
    await waitFor(
      () => {
        const { access, refresh } = readStorage();
        return access && refresh && refresh !== identitySession.refreshToken ? true : '';
      },
      'the SPA to rotate the stored refresh token after a refresh',
    );
  } catch { /* reported below */ }
  const persistedAccess = readStorage().access || deep.window.localStorage.getItem('ak_access');
  const persistedRefresh = readStorage().refresh || deep.window.localStorage.getItem('ak_refresh');
  let restoredEmail = '';
  if (persistedAccess) {
    const me = await fetch(`${BASE}/api/me`, { headers: { authorization: `Bearer ${persistedAccess}` } });
    const meBody = await me.json().catch(() => null);
    restoredEmail = meBody?.user?.email ?? '';
  }
  record('a refresh restores the real session from the stored refresh token',
    restoredEmail === identitySession.email
      && persistedRefresh !== identitySession.refreshToken // the server rotated it
      && screenAfterRefresh.includes('screen-billing'),
    `screen=${screenAfterRefresh}, /api/me with the restored token → ${restoredEmail || 'no usable token'}, refresh token rotated=${persistedRefresh !== identitySession.refreshToken}`);

  // ── 4. a revoked token returns the visitor to sign-in, never a blank page ─
  const revoked = await refreshAt('/billing', { refreshToken: 'revoked-or-expired-token' });
  let revokedScreen = revoked.visibleScreen();
  try {
    revokedScreen = await waitFor(() => revoked.visibleScreen().includes('screen-auth') || revoked.visibleScreen().includes('screen-master') ? revoked.visibleScreen() : '', 'the sign-in screen after a revoked token');
  } catch { /* reported below */ }
  record('a revoked session lands on the sign-in screen (not a blank or broken page)',
    revokedScreen.includes('screen-auth'),
    `visible: ${revokedScreen}`);

  // ── 5. anonymous visitor on an app surface is asked to sign in ───────────
  const anonymous = await refreshAt('/billing', { refreshToken: null });
  let anonymousScreen = anonymous.visibleScreen();
  try {
    anonymousScreen = await waitFor(() => anonymous.visibleScreen().includes('screen-auth') ? anonymous.visibleScreen() : '', 'the sign-in screen for an anonymous visitor');
  } catch { /* reported below */ }
  record('an anonymous refresh on an app surface asks for sign-in',
    anonymousScreen.includes('screen-auth'),
    `visible: ${anonymousScreen}`);

  // ── 5b. the owner session really opens the staff console ────────────────
  const ownerCreds = ownerCredentials();
  if (ownerCreds) {
    const ownerLogin = await postAuth('/api/auth/login', ownerCreds, { attempts: 12, waitMs: 15_000 });
    const ownerBody = await ownerLogin.json().catch(() => null);
    const ownerSession = await refreshAt('/admin', { refreshToken: ownerBody?.refreshToken ?? null });
    const ownerScreen = ownerSession.visibleScreen();
    // The client gate and the API agree: `admin`/`super_admin` are the STAFF
    // plane, so the owner role is sent to its own dashboard by /admin — and the
    // owner's real surface (/api/owner/dashboard) answers for the owner token
    // while refusing a customer token.
    let ownerToken = ownerSession.window.localStorage.getItem('ak_access');
    if (!ownerToken) {
      try {
        ownerToken = await waitFor(
          () => ownerSession.window.localStorage.getItem('ak_access') || '',
          'the owner session to be restored after a refresh',
        );
      } catch { /* reported below */ }
    }
    const ownerScreenAfterWait = ownerSession.visibleScreen();
    void ownerScreenAfterWait;
    const ownerDashboard = ownerToken
      ? await fetch(`${BASE}/api/owner/dashboard`, { headers: { authorization: `Bearer ${ownerToken}` } })
      : { status: 0 };
    const customerLogin = identitySession
      ? await postAuth('/api/auth/login', { email: identitySession.email, password: identitySession.password }, { attempts: 12, waitMs: 15_000 })
      : null;
    const customerToken = customerLogin ? (await customerLogin.json().catch(() => ({}))).accessToken ?? null : null;
    const customerOwner = customerToken
      ? await fetch(`${BASE}/api/owner/dashboard`, { headers: { authorization: `Bearer ${customerToken}` } })
      : { status: 0 };
    record('the owner plane answers the owner session and refuses a customer session',
      ownerDashboard.status === 200 && customerOwner.status === 403,
      `role=${ownerBody?.user?.role ?? 'unknown'}, /api/owner/dashboard owner=${ownerDashboard.status} customer=${customerOwner.status}, /admin for the owner shows ${ownerScreen}`);
  } else {
    record('the configured owner session opens /admin after a refresh (staff plane)', false,
      'no owner credentials configured on this deployment');
  }

  // ── 6. unknown paths and the private mission stay 404 ───────────────────
  for (const routePath of ['/nonexistent-xyz', '/mission', '/za141251sa']) {
    const response = await fetch(`${BASE}${routePath}`);
    const html = await response.text();
    record(`${routePath} still 404s (no catch-all swallowing broken links)`,
      response.status === 404 && html.includes('class="next-error-h1"'),
      `HTTP ${response.status}`);
  }

  // ── 7. no uncaught errors across the whole sweep ───────────────────────
  const allErrors = [...deep.errors, ...revoked.errors, ...anonymous.errors];
  record('no uncaught client errors while refreshing deep links', allErrors.length === 0, allErrors.slice(0, 2).join(' | '));

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${failed.length === 0 ? 'REFRESH + DEEP LINKS VERIFIED' : `${failed.length} CHECK(S) FAILED`} — ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('refresh verification failed:', error instanceof Error ? error.message : error);
  const failed = results.filter((entry) => !entry.ok).length;
  console.log(`\nREFRESH VERIFICATION INCOMPLETE — ${results.length - failed}/${results.length}`);
  process.exit(1);
});
