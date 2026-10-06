/**
 * Menu/rail fix contract (reapplied spec of commit 1c25f21).
 *
 * 1. Avatar dropdown labels never break mid-word ("Settin gs",
 *    "Billing & credit s" are forbidden): nowrap overrides the blanket
 *    overflow-wrap:anywhere rules, and the menus reserve ≥220px min-width.
 * 2. The dropdown is never clipped by an ancestor overflow:hidden
 *    (viewport-locked topbar and the 56px session bar clip horizontally only).
 * 3. True 56px collapsed rail with an unclipped A! mark, centered ≥20px
 *    icons, a labeled ≥44px collapse toggle and a visible active indicator.
 * 4. Escape closes each account menu and restores focus to the avatar
 *    button; pointer interaction outside the account region closes it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const shell = readFileSync(join(root, 'src/app/_components/app-shell.tsx'), 'utf8');
const shellCss = readFileSync(join(root, 'src/app/_components/app-shell.module.css'), 'utf8');
const workbench = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.tsx'), 'utf8');
const workbenchCss = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.module.css'), 'utf8');

describe('account menu never breaks labels mid-word', () => {
  it('menu min-width is at least 220px and fits the longest label', () => {
    const shellMenu = shellCss.match(/\.menu\{min-width:(\d+)px/);
    assert.ok(shellMenu, 'app-shell .menu declares a px min-width');
    assert.ok(Number(shellMenu![1]) >= 220, `app-shell menu min-width ${shellMenu![1]}px >= 220px`);
    const sessionMenu = workbenchCss.match(/\.sessionMenu\s*\{\s*min-width:\s*(\d+)px/);
    assert.ok(sessionMenu, 'workbench .sessionMenu declares a px min-width');
    assert.ok(Number(sessionMenu![1]) >= 220, `session menu min-width ${sessionMenu![1]}px >= 220px`);
    // width:max-content lets the menu grow to its longest label instead of
    // wrapping it.
    assert.match(shellCss, /\.menu\{min-width:\d+px;width:max-content/);
    assert.match(workbenchCss, /\.sessionMenu\s*\{\s*min-width:\s*\d+px;\s*width:\s*max-content/);
  });

  it('menu items and nav labels are nowrap and override overflow-wrap:anywhere', () => {
    const shellNowrap = shellCss.indexOf('.shell .menu a,.shell .menu button,.shell .menuHead b,.shell .menuHead small{white-space:nowrap;overflow-wrap:normal;word-break:keep-all}');
    assert.ok(shellNowrap >= 0, 'app-shell menu nowrap override exists');
    const shellAnywhere = shellCss.lastIndexOf('overflow-wrap:anywhere;white-space:normal');
    assert.ok(shellNowrap > shellAnywhere, 'nowrap override comes after the blanket anywhere rule');
    assert.ok(shellCss.includes('.shell .navText,.shell .avatarName{white-space:nowrap;overflow-wrap:normal;word-break:keep-all'), 'sidebar labels are nowrap');
    const wbNowrap = workbenchCss.indexOf('.session .sessionMenu a,\n.session .sessionMenu button { white-space: nowrap; overflow-wrap: normal; word-break: keep-all;');
    assert.ok(wbNowrap >= 0, 'session menu nowrap override exists');
    assert.ok(wbNowrap > workbenchCss.indexOf('overflow-wrap: anywhere'), 'session override comes after the blanket anywhere rule');
  });

  it('the labels that previously broke mid-word all render through nowrap rules', () => {
    for (const label of ['Settings', 'Billing &amp; credits', 'Help']) {
      assert.ok(shell.includes(`>${label.replace('&amp;', '&amp;')}</Link>`) || shell.includes(label), `${label} is in the app-shell menu`);
      assert.ok(workbench.includes(label), `${label} is in the session menu`);
    }
    for (const label of ['See plans and pricing', 'Automations', 'Agent Factory', 'Files & documents']) {
      assert.ok(shell.includes(label), `${label} is a sidebar nav label`);
    }
    // Sidebar nav labels render inside .navText, which is nowrap + ellipsis.
    assert.match(shell, /<span className=\{styles\.navText\}>\{item\.label\}<\/span>/);
    assert.match(shellCss, /\.shell \.navText,\.shell \.avatarName\{white-space:nowrap[^}]*text-overflow:ellipsis\}/);
  });
});

describe('account menu is not clipped by ancestor overflow', () => {
  it('viewport-locked topbar and session bar clip horizontally only', () => {
    assert.match(shellCss, /\.shellViewportLocked \.topbar \{[^}]*overflow-x: clip;[^}]*overflow-y: visible;/s);
    assert.match(workbenchCss, /\.sessionBar \{[^}]*overflow-x: clip;[^}]*overflow-y: visible;/s);
    assert.doesNotMatch(shellCss, /\.shellViewportLocked \.topbar \{[^}]*overflow: hidden/s);
  });

  it('topbar and account region keep overflow visible in the default shell', () => {
    assert.ok(shellCss.includes('.topbar{overflow:visible}'));
    assert.ok(shellCss.includes('.account{overflow:visible}'));
  });
});

describe('account menu dismissal and focus restoration', () => {
  it('Escape closes the app-shell menu and returns focus to the avatar button', () => {
    assert.match(shell, /if \(!menuOpen\) return;/);
    assert.match(shell, /event\.key !== 'Escape'\) return;\s*setMenuOpen\(false\);\s*avatarButtonRef\.current\?\.focus\(\);/s);
    assert.match(shell, /ref=\{avatarButtonRef\}/);
  });

  it('pointer interaction outside the account region closes the app-shell menu', () => {
    assert.match(shell, /addEventListener\('pointerdown', onPointerDown\)/);
    assert.match(shell, /!region\.contains\(event\.target\)\) setMenuOpen\(false\)/);
    assert.match(shell, /className=\{styles\.account\} ref=\{accountRef\}/);
  });

  it('the session menu has the same Escape + outside-pointer contract', () => {
    assert.match(workbench, /if \(!sessionMenuOpen\) return;/);
    assert.match(workbench, /setSessionMenuOpen\(false\);\s*sessionAvatarButtonRef\.current\?\.focus\(\);/s);
    assert.match(workbench, /!region\.contains\(event\.target\)\) setSessionMenuOpen\(false\)/);
    assert.match(workbench, /ref=\{sessionAvatarButtonRef\}/);
    assert.match(workbench, /className=\{styles\.sessionAccount\} ref=\{sessionAccountRef\}/);
  });

  it('menu links close the menu they live in', () => {
    assert.match(shell, /<Link href="\/settings" onClick=\{\(\) => setMenuOpen\(false\)\}>Settings<\/Link>/);
    assert.match(workbench, /<Link href="\/settings" role="menuitem" onClick=\{\(\) => setSessionMenuOpen\(false\)\}>Settings<\/Link>/);
  });
});

describe('true 56px collapsed rail', () => {
  it('rail column is exactly 56px and the A! mark fits unclipped', () => {
    assert.match(shellCss, /\.shellCollapsed\{grid-template-columns:56px minmax\(0,1fr\)\}/);
    const padding = shellCss.match(/\.shellCollapsed \.sidebar\{padding:\d+px (\d+)px/);
    assert.ok(padding, 'collapsed sidebar declares horizontal padding');
    const mark = shellCss.match(/\.shellCollapsed \.mark\{width:(\d+)px/);
    assert.ok(mark, 'collapsed mark declares a width');
    const inner = 56 - 2 * Number(padding![1]);
    assert.ok(Number(mark![1]) <= inner, `A! mark ${mark![1]}px fits the ${inner}px inner rail (unclipped)`);
    // The mark never shrinks below its box (flex basis is fixed).
    assert.match(shellCss, /\.shellCollapsed \.mark\{width:\d+px;height:\d+px;flex:0 0 auto\}/);
  });

  it('collapsed icons are at least 20px and centered', () => {
    const bullet = shellCss.match(/\.shellCollapsed \.navBullet\{width:(\d+)px;height:(\d+)px\}/);
    assert.ok(bullet, 'collapsed nav bullet size is declared');
    assert.ok(Number(bullet![1]) >= 20 && Number(bullet![2]) >= 20, 'icons are >=20px');
    assert.match(shellCss, /\.shellCollapsed \.nav a\{width:44px;justify-content:center;padding:0;margin-inline:auto\}/);
    assert.match(shellCss, /\.shellCollapsed \.brand\{flex:0 0 auto;width:44px;justify-content:center\}/);
  });

  it('the collapse toggle keeps a non-empty accessible name and a 44px target', () => {
    assert.match(shell, /aria-label=\{collapsed \? 'Expand navigation' : 'Collapse navigation'\}/);
    assert.match(shellCss, /\.collapse,\.mobileMenu\{width:44px;min-width:44px;height:44px/);
    assert.match(shellCss, /\.shellCollapsed \.collapse\{width:44px;min-width:44px;height:44px\}/);
  });

  it('the active item keeps a visible indicator while collapsed', () => {
    assert.match(shellCss, /\.shellCollapsed \.nav a\[aria-current=page\]\{box-shadow:inset 0 0 0 1px var\(--line-accent\),inset 3px 0 0 var\(--accent-bright\)\}/);
    // Expanded active state is unchanged.
    assert.match(shellCss, /\.nav a\[aria-current=page\]\{background:var\(--accent-soft\);border-color:var\(--line-accent\);color:var\(--accent-bright\)\}/);
  });

  it('interactive targets stay at least 44px everywhere in the shell', () => {
    assert.match(shellCss, /\.shell :where\(button, a\[href\]\) \{ min-height: 44px; \}/);
  });
});
