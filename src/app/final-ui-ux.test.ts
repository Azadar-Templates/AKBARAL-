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

  it('the responsive audit gate is part of the repository', () => {
    const auditPath = join(root, 'scripts', 'responsive-audit.mjs');
    assert.ok(existsSync(auditPath), 'responsive-audit.mjs exists');
    const audit = readFileSync(auditPath, 'utf8');
    for (const kind of ['overflow', 'tiny-text', 'clipped', 'small-target', 'grid-guard']) {
      assert.ok(audit.includes(`'${kind}'`), `the audit reports ${kind}`);
    }
    assert.match(audit, /AUDIT_BASE/, 'the audit can target a served build');
    assert.match(audit, /--widths=/, 'the audit is width-parameterised');
    assert.match(audit, /--selftest/, 'the audit can prove it is able to fail');
    assert.match(audit, /every dialog surface/, 'modal surfaces are audited too');
  });
});
