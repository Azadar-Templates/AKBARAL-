import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Final UI/UX pass contract (September 2026).
 *
 * The responsive work is only real if it is enforceable, so this locks the
 * structural guarantees the pass introduced:
 *
 *   1. There is one micro type step and it is legible. `--fs-micro` comes from
 *      typography.scale.micro.webSize, phones step UP to `--fs-micro-phone`,
 *      and no rule in the stylesheet may hardcode a smaller size again.
 *   2. Authentication has honest, finished states: an inline live-region
 *      message, marked fields, a busy submit, and a real password reveal
 *      control — never a silent dead form.
 *   3. Wide data surfaces scroll instead of clipping: `ensureTableScroll()`
 *      wraps every rendered table, and the wrapper keeps touch scrolling.
 *   4. Phone chrome is a layout, not a squeeze: the pane switch takes its own
 *      row, panels go full-bleed, sheets respect the safe area, and touch
 *      targets have a coarse-pointer floor.
 *   5. `scripts/responsive-audit.mjs` — the gate that resolves the real cascade
 *      at ten viewport widths — is part of the repository.
 */

const root = process.cwd();
const css = readFileSync(join(root, 'public', 'styles.css'), 'utf8');
const tokensCss = readFileSync(join(root, 'public', 'tokens.css'), 'utf8');
const tokensJson = JSON.parse(readFileSync(join(root, 'design-system', 'tokens.json'), 'utf8'));
const appJs = readFileSync(join(root, 'public', 'app.js'), 'utf8');
const page = readFileSync(join(root, 'src', 'app', 'page.tsx'), 'utf8');

const authSlice = () => {
  const start = page.indexOf('id="screen-auth"');
  const end = page.indexOf('id="screen-dashboard"', start);
  assert.ok(start > 0 && end > start, 'auth screen slice is addressable');
  return page.slice(start, end);
};

describe('final UI/UX pass contract', () => {
  it('ships a single legible micro type step, driven by tokens', () => {
    assert.match(tokensCss, /--fs-micro:\s*0\.71875rem;/, 'web micro step is emitted (11.5px)');
    assert.match(tokensCss, /--fs-micro-phone:\s*0\.75rem;/, 'phones get the larger micro step (12px)');
    assert.match(tokensCss, /--fs-floor:\s*0\.72rem;/, 'the declared floor is above the legibility line');
    assert.ok(
      tokensJson.typography.scale.micro.webSize >= 11,
      'design system micro web size must stay at or above 11px',
    );
    assert.ok(
      tokensJson.typography.scale.micro.phoneSize >= tokensJson.typography.scale.micro.webSize,
      'phones must never render smaller micro type than desktop',
    );
    assert.ok(tokensJson.responsive.fontFloorRem >= 0.7, 'the design-system font floor is legible');
  });

  it('no stylesheet rule may hardcode text below the micro floor', () => {
    const small = css.match(/font-size:\s*0\.(?:5\d|6|6[0-8])rem/g) ?? [];
    assert.deepEqual(small, [], `sub-floor font sizes found: ${small.join(', ')}`);
    assert.ok(css.includes('font-size: var(--fs-micro)'), 'micro type goes through the token');
    assert.match(
      css,
      /@media \(max-width: 560px\) \{\s*:root \{ --fs-micro: var\(--fs-micro-phone\); \}/,
      'phones step the micro size up',
    );
  });

  it('authentication reports failures in place, marks fields and never looks dead', () => {
    const auth = authSlice();
    assert.match(auth, /id="auth-feedback"[^>]*role="status"[^>]*aria-live="polite"/, 'inline live region exists');
    assert.match(auth, /data-password-reveal="auth-password"[^>]*aria-pressed="false"/, 'reveal control is a real toggle');
    assert.match(auth, /<svg className="eye-on"/, 'reveal control shows the eye state');
    assert.match(auth, /<svg className="eye-off"/, 'reveal control shows the crossed-eye state');

    assert.match(appJs, /function authFeedback\(/, 'feedback writer exists');
    assert.match(appJs, /authMarkInvalid\('email', true\)/, 'invalid fields are marked');
    assert.match(appJs, /setAttribute\('aria-invalid', 'true'\)/, 'aria-invalid is set on failure');
    assert.match(appJs, /authSetBusy\(true\)/, 'the submit control reports its busy state');
    assert.match(appJs, /input\.type = next \? 'text' : 'password';/, 'the reveal control really switches the input');
    assert.match(appJs, /const message = error && error\.message \? error\.message : 'Sign-in failed\. Please try again\.'/, 'errors are surfaced honestly');

    assert.match(css, /\.auth-feedback\[data-state="error"\]/, 'error state is styled');
    assert.match(css, /\.auth-feedback\[data-state="success"\]/, 'success state is styled');
    assert.match(css, /\.auth-reveal\[aria-pressed="true"\] \.eye-off \{ display: block; \}/, 'the reveal control reflects its pressed state');
    assert.match(css, /\.auth-field input\[aria-invalid="true"\]/, 'invalid inputs are visually distinct');
    assert.match(css, /\.auth-screen \{\s*min-height: 100dvh; padding: 0;\s*overflow-x: hidden; overflow-y: auto/, 'the auth surface can never clip its own content');
  });

  it('nothing in the public authentication surface leaks setup or debug text', () => {
    const auth = authSlice().toLowerCase();
    for (const leak of ['setup needed', 'not configured', 'client_secret', 'client id', 'env ', 'callback uri', 'debug']) {
      assert.ok(!auth.includes(leak), `public auth UI must not mention “${leak}”`);
    }
  });

  it('wide data surfaces scroll instead of clipping', () => {
    assert.match(appJs, /function ensureTableScroll\(root = document\)/, 'table wrapper helper exists');
    assert.match(appJs, /parent\.classList\.contains\('table-scroll'\)/, 'the helper is idempotent');
    assert.match(appJs, /classList\.add|wrap\.className = 'table-scroll'/, 'the helper creates the real scroller');
    assert.match(appJs, /\n\s+ensureTableScroll\(\);/, 'the economy renderer uses it');
    assert.match(css, /\.table-scroll \{ -webkit-overflow-scrolling: touch; overscroll-behavior-x: contain; \}/, 'the scroller keeps touch scrolling');
    assert.match(css, /@media \(max-width: 720px\) \{\s*\.table-scroll \{ margin: 0; border-radius: 12px; \}/, 'tables tighten on phones');
  });

  it('phone chrome is redesigned, not squeezed', () => {
    assert.match(css, /\.ak-topbar \{ flex-wrap: wrap; gap: 8px; \}/, 'the top bar wraps instead of compressing');
    assert.match(css, /\.master-pane-switch \{ order: 5; flex: 1 1 100%; width: 100%;/, 'the pane switch owns its own row on phones');
    assert.match(css, /\.master-workspace \{ padding: 0; \}/, 'the workspace goes full-bleed');
    assert.match(css, /env\(safe-area-inset-bottom, 0px\)\)/, 'sheets respect the safe area');
    assert.match(css, /\.modal-card \{\s*width: 100%; max-height: 92dvh; border-radius: 20px 20px 0 0;/, 'modals present as phone sheets');
    assert.match(css, /@media \(pointer: coarse\) \{/, 'touch devices get a target floor');
    assert.match(css, /\.ak-nav-item, \.ak-rail-tabs button, \.master-pane-switch button, \.quick-amounts button \{ min-height: 44px; \}/, 'the coarse-pointer floor covers real controls');
    assert.match(css, /\.quick-amounts button \{ min-height: 40px;/, 'credit amounts are tappable');
    assert.match(css, /\.akx-band \{ padding: 34px 0; \}/, 'marketing bands stop dominating small screens');
  });

  it('every tier of text clears WCAG AA on the obsidian field', () => {
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) => {
      const h = hex.replace('#', '');
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [luminance(a), luminance(b)];
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const dark = tokensJson.color.dark as Record<string, string>;
    for (const field of ['#040705', '#070a08', '#0b100d', '#101713']) {
      for (const tier of ['text', 'textDim', 'textFaint', 'accentBright']) {
        const value = String(dark[tier]);
        assert.match(value, /^#[0-9a-f]{6}$/, `${tier} is a real hex colour`);
        assert.ok(
          ratio(value, field) >= 4.5,
          `${tier} (${value}) must clear 4.5:1 on ${field} — got ${ratio(value, field).toFixed(2)}:1`,
        );
      }
    }
    // The darker brand tone is for fills, never for glyphs on the field.
    assert.match(css, /\.ws-preview-empty \.wpe-mark \{[^}]*color: var\(--accent-bright\)/, 'glyph marks use the readable accent');
    assert.match(css, /\.console-state \{[^}]*color: var\(--text-dim\)/, 'chrome labels on raised glass use the dim tier');
  });

  it('keyboard and disabled states exist for every control family', () => {
    const focusRules = css.match(/:focus-visible/g) ?? [];
    assert.ok(focusRules.length >= 10, `expected a real focus layer, found ${focusRules.length} rules`);
    assert.match(
      css,
      /:where\(a, button, input, select, textarea, summary, \[role="tab"\], \[role="button"\], \[tabindex\]:not\(\[tabindex="-1"\]\)\):focus-visible \{\s*outline: 2px solid color-mix\(in srgb, var\(--accent-bright\) 80%, transparent\);/,
      'one emerald focus ring covers every control family',
    );
    assert.match(css, /\[disabled\] \{ opacity: 0\.62; \}/, 'disabled controls read as disabled');
    assert.match(css, /\.btn:disabled \{ opacity: 0\.6; box-shadow: none; transform: none; \}/, 'disabled buttons lose their affordance');
    assert.match(css, /\.oauth-btn\[aria-disabled="true"\] \{ opacity: 1; \}/, 'unavailable providers keep their honest, legible treatment');
    assert.match(css, /\.chat-composer textarea:focus-visible/, 'the composer has a keyboard state');
  });

  it('dialogs behave like dialogs', () => {
    assert.match(appJs, /let returnFocusTo = null;/, 'the opener is remembered');
    assert.match(appJs, /if \(returnFocusTo && document\.contains\(returnFocusTo\)\) returnFocusTo\.focus\(\);/,
      'focus returns to the opener on every close path');
    assert.match(appJs, /if \(event\.key !== 'Tab' \|\| modal\.hidden\) return;/, 'focus is trapped while the dialog is open');
    assert.match(appJs, /event\.shiftKey && document\.activeElement === first/, 'shift+tab wraps backwards');
  });

  it('the responsive audit gate is part of the repository', () => {
    const auditPath = join(root, 'scripts', 'responsive-audit.mjs');
    assert.ok(existsSync(auditPath), 'responsive-audit.mjs exists');
    const audit = readFileSync(auditPath, 'utf8');
    for (const kind of ['overflow', 'tiny-text', 'clipped', 'small-target', 'grid-guard', 'contrast', 'anchored-overflow']) {
      assert.ok(audit.includes(`'${kind}'`), `the audit reports ${kind}`);
    }
    assert.match(audit, /AUDIT_BASE/, 'the audit can target a served build');
    assert.match(audit, /--widths=/, 'the audit is width-parameterised');
    assert.match(audit, /--selftest/, 'the audit can prove it is able to fail');
    assert.match(audit, /every dialog surface/, 'modal surfaces are audited too');
  });
});
