import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const shellPath = 'src/app/_components/app-shell.tsx';
const cssPath = 'src/app/_components/app-shell.module.css';
const shell = readFileSync(join(root, shellPath), 'utf8');
const css = readFileSync(join(root, cssPath), 'utf8');

describe('avatar menu and global header contract', () => {
  it('ports the account menu outside viewport-locked overflow and restores focus on close', () => {
    assert.match(shell, /createPortal\([\s\S]*document\.body/);
    assert.match(shell, /event\.key === 'Escape'/);
    assert.match(shell, /document\.addEventListener\('pointerdown', onPointerDown\)/);
    assert.match(shell, /avatarButtonRef\.current\?\.focus\(\)/);
    assert.match(css, /\.menu\{position:fixed;min-width:220px/);
  });

  it('keeps every account and navigation label whole, including the longest product names', () => {
    for (const label of ['Settings', 'Billing & credits', 'See plans and pricing', 'Automations', 'Agent Factory', 'Files & documents']) {
      assert.ok(shell.includes(label), `${label} remains a labelled destination`);
    }
    assert.match(css, /\.menu :is\(.menuHead b,.menuHead small,a,button\)\{white-space:nowrap;overflow-wrap:normal;word-break:normal\}/);
    assert.match(css, /\.navText\{white-space:nowrap;overflow-wrap:normal;word-break:normal\}/);
    assert.match(css, /\.content :where\(\.secondaryButton,\.ghostButton,\.smallButton,\.historySearch button\)\{white-space:nowrap/);
  });

  it('uses one header navigation surface with no collapsed icon rail or sidebar', () => {
    assert.match(shell, /<header className=\{styles\.topbar\}/);
    assert.match(shell, /<WorkspaceNavigation/);
    assert.doesNotMatch(shell, /Collapse navigation|shellCollapsed|className=\{styles\.sidebar\}/);
    assert.doesNotMatch(css, /\.shellCollapsed|\.sidebar/);
  });

  it('keeps navigation and menu actions at least 44px tall', () => {
    assert.match(css, /\.menu a,\.menu button\{[^}]*min-height:44px/);
    assert.match(css, /\.shell :where\(button, a\[href\]\) \{ min-height: 44px; \}/);
  });
});
