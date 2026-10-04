import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const authCard = readFileSync(join(root, 'src', 'app', '_components', 'auth-card.tsx'), 'utf8');
const authCss = readFileSync(join(root, 'src', 'app', '_components', 'auth-card.module.css'), 'utf8');
const signIn = readFileSync(join(root, 'src', 'app', 'signin', 'page.tsx'), 'utf8');
const signUp = readFileSync(join(root, 'src', 'app', 'signup', 'page.tsx'), 'utf8');

describe('AKBARAL! auth surface — one-product reset', () => {
  it('renders dedicated typed sign-in and sign-up cards, not the old application shell', () => {
    assert.match(signIn, /<AuthCard mode="signin" \/>/);
    assert.match(signUp, /<AuthCard mode="signup" \/>/);
    assert.doesNotMatch(signIn + signUp, /<Home \/>/);
    assert.match(authCard, /<main className=\{styles\.page\}>/);
    assert.match(authCard, /AKBARAL!/);
    assert.match(authCard, /One Intelligence\. Every Solution\./);
  });

  it('keeps the way in minimal: email, password, provider buttons, switch link, back link', () => {
    assert.match(authCard, /type="email"/);
    assert.match(authCard, /type="password"/);
    assert.match(authCard, /\/api\/auth\/login/);
    assert.match(authCard, /\/api\/auth\/register/);
    assert.match(authCard, /No account yet\?/);
    assert.match(authCard, /Already have an account\?/);
    assert.match(authCard, /Back to landing/);
  });

  it('shows only configured Google and GitHub provider controls and starts the existing OAuth path', () => {
    assert.match(authCard, /\/api\/auth\/oauth\/providers/);
    assert.match(authCard, /provider\.key === 'google' \|\| provider\.key === 'github'/);
    assert.match(authCard, /provider\.configured/);
    assert.match(authCard, /\/api\/auth\/oauth\/\$\{encodeURIComponent\(provider\.key\)\}\/authorize/);
    for (const retired of ['microsoft', 'facebook', 'apple']) assert.doesNotMatch(authCard, new RegExp(retired, 'i'));
  });

  it('does not leak setup, credential, or debug language on the public auth card', () => {
    for (const leak of ['setup needed', 'client_secret', 'client id', 'env ', 'callback uri', 'debug', 'not configured']) {
      assert.ok(!authCard.toLowerCase().includes(leak), `auth card must not mention ${leak}`);
    }
  });

  it('stores real password-login tokens and sends provider users to /chat without URL tokens', () => {
    assert.match(authCard, /window\.localStorage\.setItem\('ak_access'/);
    assert.match(authCard, /window\.localStorage\.setItem\('ak_refresh'/);
    assert.match(authCard, /window\.location\.href = '\/chat'/);
    assert.doesNotMatch(authCard, /access_token=|refresh_token=|#token|status='ok'|fake/i);
  });

  it('is responsive, centered, and token-based', () => {
    assert.match(authCss, /min-height:100dvh/);
    assert.match(authCss, /place-items:center/);
    assert.match(authCss, /@media\(max-width:360px\)/);
    assert.match(authCss, /var\(--accent\)/);
    assert.doesNotMatch(authCss, /#[0-9a-fA-F]{3,8}/);
  });
});
