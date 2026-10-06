import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const shellPath = 'src/app/_components/app-shell.tsx';
const cssPath = 'src/app/_components/app-shell.module.css';
const shell = readFileSync(join(root, shellPath), 'utf8');
const css = readFileSync(join(root, cssPath), 'utf8');

describe('avatar menu and collapsed rail contract', () => {
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
  });

  it('uses a true 56px, accessible collapsed rail with legible centred marks and an active indicator', () => {
    assert.match(css, /\.shellCollapsed\{grid-template-columns:56px minmax\(0,1fr\)\}/);
    assert.match(css, /\.shellCollapsed \.mark\{width:38px;height:38px;overflow:visible\}/);
    assert.match(css, /\.shellCollapsed \.navBullet\{width:24px;height:24px\}/);
    assert.match(css, /\.shellCollapsed \.nav a\[aria-current=page\]::before/);
    assert.match(shell, /aria-label=\{collapsed \? 'Expand navigation' : 'Collapse navigation'\}/);
    assert.match(shell, /aria-label=\{collapsed \? item\.label : undefined\}/);
  });

  it('keeps navigation and menu actions at least 44px tall', () => {
    assert.match(css, /\.menu a,\.menu button\{min-height:44px\}/);
    assert.match(css, /\.shell :where\(button, a\[href\]\) \{ min-height: 44px; \}/);
  });
});
