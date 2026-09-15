import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Provider sign-in UX contract (2026-09-15).
 *
 * Live report: "I want to try Facebook sign-in with a test account and the
 * button does nothing." The cause was real and reproducible: every provider
 * without server-side credentials rendered as a `disabled` button, so a press
 * was silently swallowed — and the explanation lived in a `title` tooltip,
 * which no phone and no keyboard user ever sees.
 *
 * The contract now:
 *   · every provider button is PRESSABLE (never the `disabled` attribute), so a
 *     press always produces an answer;
 *   · a configured provider press navigates to the real server-side authorize
 *     endpoint (`/api/auth/oauth/<key>/authorize` → provider consent screen);
 *   · an unconfigured provider press states exactly which credentials an
 *     operator must set and the redirect URI to register, and reminds the user
 *     that email + password sign-in works right now;
 *   · nothing ever fakes a session, a redirect or a provider consent screen.
 *
 * The real interaction (a real click on the real button against the real
 * providers API) is exercised by `npm run smoke:shell`; the server-side half of
 * the Facebook flow — authorize → consent URL → callback → identity link — is
 * covered by src/auth/oauth.test.ts.
 */

const root = process.cwd();
const appJs = readFileSync(join(root, 'public', 'app.js'), 'utf8');
const css = readFileSync(join(root, 'public', 'styles.css'), 'utf8');

const renderer = (() => {
  const start = appJs.indexOf('async function renderOAuthButtons()');
  assert.ok(start > 0, 'renderOAuthButtons exists');
  const end = appJs.indexOf('async function loadConnectedAccounts()', start);
  assert.ok(end > start, 'the renderer body is delimited');
  return appJs.slice(start, end);
})();

describe('provider sign-in — a press always gets a real answer', () => {
  it('renders every provider as a pressable control, never a dead one', () => {
    assert.ok(!/<button[^>]*\sdisabled/.test(renderer), 'no provider button is rendered with the disabled attribute');
    assert.match(renderer, /data-oauth-provider="\$\{esc\(p\.key\)\}"/, 'each control carries its provider key');
    assert.match(renderer, /data-oauth-configured="\$\{p\.configured \? '1' : '0'\}"/, 'each control carries its real configured state');
    assert.match(renderer, /aria-disabled="true"/, 'an unconfigured control is announced as unavailable, not hidden');
    assert.match(renderer, /setup needed/, 'and says so on its face');
  });

  it('a configured provider starts the real server-side flow', () => {
    assert.match(renderer, /window\.location\.href = `\/api\/auth\/oauth\/\$\{encodeURIComponent\(key\)\}\/authorize`;/,
      'the press navigates to the authorize endpoint (302 → provider consent)');
    assert.match(renderer, /if \(button\.dataset\.oauthConfigured === '1'\)/, 'navigation is gated on the server-reported state');
  });

  it('an unconfigured provider answers with the exact missing credential and the redirect URI', () => {
    assert.match(renderer, /requiredFor\(provider\)/, 'the answer names the required env credentials');
    assert.match(renderer, /const redirectUri = `\$\{location\.origin\}\/api\/auth\/oauth\/\$\{key\}\/callback`;/, 'the exact redirect URI is shown');
    assert.match(renderer, /setNote\(/, 'the answer is written into the visible note');
    assert.match(renderer, /'setup'/, 'and styled as a setup notice');
    assert.match(renderer, /Email and password sign-in works right now\./, 'the user is told what does work today');
    assert.match(renderer, /note\.focus\(\{ preventScroll: true \}\)/, 'the note is focused for keyboard and screen readers');
    assert.match(renderer, /toast\(/, 'and announced as a toast');
  });

  it('never fabricates a session or a consent screen', () => {
    assert.ok(!/accessToken\s*=|setSession|localStorage\.setItem/.test(renderer), 'no token is invented client-side');
    assert.ok(!/status\s*=\s*'ok'|fake/i.test(renderer), 'no fake success path');
    // The provider list is the server truth, always.
    assert.match(renderer, /await api\('\/api\/auth\/oauth\/providers'\)/, 'the configured/unconfigured state comes from the server');
  });

  it('styles the setup state with design tokens, not hardcoded colours', () => {
    assert.match(css, /\.auth-oauth-buttons \.oauth-btn\[aria-disabled="true"\]/, 'the unconfigured control keeps a distinct, non-dead look');
    assert.match(css, /\.auth-oauth-buttons \.oauth-btn \.oauth-needs/, 'the "setup needed" badge is styled');
    assert.match(css, /\.auth-oauth-note\[data-kind="setup"\]/, 'the setup notice is styled');
    const ruleStart = css.indexOf('.auth-oauth-note[data-kind="setup"] {');
    const block = css.slice(ruleStart, css.indexOf('}', ruleStart));
    assert.match(block, /var\(--amber-soft\)/, 'the notice uses the amber token');
    assert.match(block, /var\(--text\)/, 'and the text token');
    assert.ok(!/#[0-9a-f]{3,6}/i.test(block), 'no hardcoded hex colours in the notice');
  });
});
