import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pre-login surface contract (2026-09-16).
 *
 * Live report: the screen a visitor meets before signing in still carried
 * marketing chrome around it, and the provider rows read "setup needed" —
 * internal configuration state shown to a visitor, which is not acceptable in a
 * production front door. The UI is now one clean surface.
 *
 * The contract:
 *   · the pre-login screen is ONE surface — brand identity, the way in, and the
 *     provider row. The public header/footer retire while it is up;
 *   · every provider renders a polished control carrying its official mark;
 *   · a configured provider is a real control: the press navigates to
 *     /api/auth/oauth/<key>/authorize → the provider's own consent screen;
 *   · an unconfigured provider renders as a subtle, plainly unavailable control
 *     (disabled + aria-disabled + is-unavailable) and NO credential,
 *     environment-variable or setup text ever reaches the visitor;
 *   · the exact credentials an operator must set, and the redirect URI to
 *     register, live in the owner-only console instead.
 *
 * The real interaction (a real DOM render of the real provider API response) is
 * exercised by `npm run smoke:shell`; the server-side half of every provider
 * flow — authorize → consent URL → callback → identity link — is covered by
 * src/auth/oauth.test.ts.
 */

const root = process.cwd();
const appJs = readFileSync(join(root, 'public', 'app.js'), 'utf8');
const css = readFileSync(join(root, 'public', 'styles.css'), 'utf8');
const page = readFileSync(join(root, 'src', 'app', 'page.tsx'), 'utf8');

const slice = (from: string, to: string) => {
  const start = appJs.indexOf(from);
  assert.ok(start > 0, `${from} exists`);
  const end = appJs.indexOf(to, start);
  assert.ok(end > start, `${to} follows ${from}`);
  return appJs.slice(start, end);
};

const renderer = slice('async function renderOAuthButtons()', 'async function loadConnectedAccounts()');
const diagnostics = (() => {
  const start = appJs.indexOf('async function renderProviderSetupDiagnostics()');
  assert.ok(start > 0, 'the owner-only diagnostics renderer exists');
  const rest = appJs.slice(start);
  const next = rest.search(/\n  (?:async )?function /);
  return next === -1 ? rest : rest.slice(0, next);
})();
const authMarkup = page.slice(page.indexOf('id="screen-auth"'), page.indexOf('id="screen-dashboard"'));
const unavailableBlock = (() => {
  const start = css.indexOf('.oauth-btn.is-unavailable {');
  assert.ok(start > 0, 'the unavailable state is styled');
  return css.slice(start, css.indexOf('}', start));
})();

describe('pre-login surface — a clean front door', () => {
  it('is one surface: identity, the way in, the provider row — nothing else', () => {
    for (const piece of ['auth-brand', 'auth-wordmark', 'auth-title', 'auth-sub', 'id="auth-form"', 'id="auth-oauth"', 'id="auth-switch"']) {
      assert.ok(authMarkup.includes(piece), `the card keeps ${piece}`);
    }
    for (const gone of ['auth-trust', 'auth-core', 'auth-core-ring', 'auth-core-dot', '⬡']) {
      assert.ok(!authMarkup.includes(gone), `the marketing remnant ${gone} is gone from the pre-login card`);
    }
  });

  it('retires the public header and footer while it is up, and fills the viewport', () => {
    assert.match(appJs, /document\.body\.classList\.toggle\('is-auth', name === 'auth'\)/, 'the route signals the pre-login state');
    assert.match(css, /body\.is-auth \.site-header,\s*body\.is-auth \.site-footer \{ display: none; \}/, 'the marketing chrome retires');
    assert.match(css, /body\.is-auth \.auth-screen \{ min-height: 100dvh/, 'the surface takes the whole viewport');
    // Scoped to the class, so a visitor without JavaScript still gets the page.
    assert.ok(!/(^|\n)\.site-header \{ display: none/.test(css), 'the chrome is not hidden globally');
  });

  it('renders polished provider controls with official marks and no badges', () => {
    assert.match(appJs, /const OAUTH_LOGOS = \{/, 'the official marks are inlined (no third-party asset host)');
    assert.match(renderer, /OAUTH_LOGOS\[p\.key\]/, 'each control renders the mark for its provider');
    for (const key of ['google', 'github', 'microsoft', 'facebook', 'apple']) {
      assert.ok(new RegExp(`\\n    ${key}: '<svg`).test(appJs), `${key} has its official mark`);
    }
    assert.match(renderer, /<span class="oauth-mark" aria-hidden="true">\$\{mark\}<\/span>/, 'the mark is rendered in the control');
    assert.match(renderer, /<span class="oauth-label">Continue with \$\{esc\(p\.label\)\}<\/span>/, 'the label names the provider');
    assert.ok(!/setup needed/i.test(renderer), 'no "setup needed" badge is rendered');
    assert.ok(!/oauth-needs/.test(appJs) && !/oauth-needs/.test(css), 'the retired badge styling is gone');
    assert.match(css, /\.oauth-btn \.oauth-mark svg \{ display: block; width: 20px; height: 20px; \}/, 'marks share one consistent size');
    assert.match(css, /\.oauth-btn:focus-visible \{/, 'keyboard focus is visible');
    assert.match(css, /\.oauth-btn:hover \{/, 'hover is styled');
  });

  it('never exposes credentials, environment variables or setup state to a visitor', () => {
    assert.ok(!/CLIENT_ID|CLIENT_SECRET|requiredFor|provider credentials|not configured/i.test(renderer),
      'the public renderer carries no configuration language');
    assert.ok(!/CLIENT_ID|CLIENT_SECRET|setup needed/i.test(authMarkup), 'the pre-login markup carries none either');
    assert.match(renderer, /note\.removeAttribute\('data-kind'\)/, 'any stale setup notice is cleared on render');
    assert.ok(!/dataset\.kind = /.test(renderer), 'and no setup notice is ever written to a visitor');
    assert.ok(!/data-kind="setup"/.test(css) && !/auth-oauth-note\[data-kind/.test(css), 'and its styling is gone');
  });

  it('presents an unconfigured provider as subtly unavailable, never as dead weight', () => {
    assert.match(renderer, /disabled aria-disabled="true"/, 'the control is announced as unavailable');
    assert.match(renderer, /is-unavailable/, 'and carries a designed unavailable state');
    assert.match(renderer, /class="oauth-slot" title=/, 'the wrapper carries a plain-language reason');
    assert.ok(!/CLIENT_ID|CLIENT_SECRET/.test(renderer), 'the reason names no credentials');
    assert.match(css, /\.oauth-btn\.is-unavailable \{/, 'the state is styled');
    assert.match(unavailableBlock, /var\(--line-faint\)/, 'with design tokens, not hardcoded colours');
    assert.ok(!/#[0-9a-f]{3,6}/i.test(unavailableBlock), 'no hardcoded hex colours in the unavailable state');
    assert.match(css, /\.oauth-btn\.is-unavailable:hover \{ transform: none;/, 'an unavailable control does not pretend to respond');
  });

  it('a configured provider starts the real server-side flow', () => {
    assert.match(renderer, /window\.location\.href = `\/api\/auth\/oauth\/\$\{encodeURIComponent\(button\.dataset\.oauthProvider\)\}\/authorize`;/,
      'the press navigates to the authorize endpoint (302 → provider consent)');
    assert.match(renderer, /if \(button\.dataset\.oauthConfigured !== '1'\) return;/, 'navigation is gated on the server-reported state');
    assert.match(renderer, /const available = Boolean\(p\.configured\);/, 'the real configuration state drives the control');
    assert.match(renderer, /await api\('\/api\/auth\/oauth\/providers'\)/, 'and always comes from the server');
  });

  it('never fabricates a session, a consent screen or a redirect', () => {
    assert.ok(!/accessToken\s*=|setSession|localStorage\.setItem/.test(renderer), 'no token is invented client-side');
    assert.ok(!/status\s*=\s*'ok'|fake/i.test(renderer), 'no fake success path');
    assert.match(renderer, /catch \{\s*wrap\.hidden = true;/, 'an API failure hides the row instead of inventing providers');
  });

  it('keeps the operator half in the owner-only console', () => {
    assert.match(diagnostics, /p\.required/, 'the required credentials are named there');
    assert.match(diagnostics, /api\/auth\/oauth\/\$\{encodeURIComponent\(p\.key\)\}\/callback/, 'and the redirect URI to register');
    assert.match(diagnostics, /\$\$\('\[data-provider-setup\]'\)/, 'rendered into every operator surface that asks for it');
    assert.ok(page.includes('id="admin-provider-setup"'), 'the panel exists in the admin console');
    assert.ok(page.indexOf('id="screen-admin"') < page.indexOf('id="admin-provider-setup"'),
      'inside the admin screen');
    assert.ok(page.includes('id="owner-provider-setup"'), 'and in the private owner console');
    assert.ok(page.indexOf('id="screen-economy"') < page.indexOf('id="owner-provider-setup"'),
      'inside the owner-only screen, because the owner role cannot reach the admin screen');
    assert.match(appJs, /void renderProviderSetupDiagnostics\(\);/, 'loaded with the owner console too');
    assert.match(appJs, /renderAdminFeedback\(feedback\.feedback \|\| \[\]\);\s*\n\s*await renderProviderSetupDiagnostics\(\);/, 'loaded with the rest of the console');
    assert.ok(!/renderProviderSetupDiagnostics/.test(renderer), 'and never from the public renderer');
  });

  it('lays the pre-login surface out for small screens', () => {
    assert.match(css, /@media \(max-width: 560px\) \{\s*\.auth-wrap \{ padding: 24px 16px; \}/, 'the surface tightens at 560px');
    assert.match(css, /@media \(max-width: 380px\) \{\s*\.auth-mark/, 'and again at 380px');
    assert.match(css, /\.oauth-btn \{\s*display: flex;[\s\S]*?width: 100%/, 'provider buttons fill the column on every width');
  });
});
