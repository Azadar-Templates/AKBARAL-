import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const shell = readFileSync(join(root, 'src/app/_components/app-shell.tsx'), 'utf8');
const shellCss = readFileSync(join(root, 'src/app/_components/app-shell.module.css'), 'utf8');
const workbench = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.tsx'), 'utf8');
const workbenchCss = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.module.css'), 'utf8');

const navItems = [
  'Chat', 'Task', 'Dashboard', 'Files & documents', 'Images', 'Projects', 'Agents',
  'Agent Factory', 'Automations', 'Billing & credits', 'See plans and pricing', 'Settings', 'Help',
];

describe('authenticated layout fill and shared Chat navigation', () => {
  it('does not cap authenticated content or reserve a sidebar gutter', () => {
    assert.match(shellCss, /\.shell\{[^}]*display:flex/);
    assert.match(shellCss, /\.contentInner\{[^}]*width:100%[^}]*max-width:none/);
    assert.doesNotMatch(shellCss, /grid-template-columns:\s*(?:280px|86px)/);
    assert.doesNotMatch(shellCss, /\.sidebar|\.shellCollapsed/);
    assert.doesNotMatch(workbenchCss, /@media\s*\(min-width:\s*1600px\)[\s\S]*?width:\s*min\(1400px/);
  });

  it('keeps Chat and Task surfaces full width while retaining readable bubbles', () => {
    assert.match(workbenchCss, /\.page,\s*\n\.workGrid,\s*\n\.session\s*\{[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*none/);
    assert.match(workbenchCss, /\.sessionMain > \.messages,\s*\n\.sessionMain > \.composerDock\s*\{[\s\S]*?width:\s*100%/);
    assert.match(workbenchCss, /\.message\{[^}]*width:min\(760px,100%\)/);
    assert.match(workbenchCss, /\.workGrid\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(320px,420px\)/);
  });

  it('renders one shared header nav inventory and route-based active state', () => {
    for (const label of navItems) assert.ok(shell.includes(label), `${label} is present`);
    assert.match(shell, /title: 'PRIMARY MODES'/);
    assert.match(shell, /title: 'WORKSPACE'/);
    assert.match(shell, /title: 'ACCOUNT'/);
    assert.match(shell, /aria-current=\{pathname === item\.href \? 'page' : undefined\}/);
    assert.match(shell, /<header className=\{styles\.topbar\}/);
    assert.match(workbench, /<AppShell title=\{title\} viewportLocked>/);
  });

  it('uses the required desktop strip, tablet scroller, and mobile drawer bands', () => {
    assert.match(shellCss, /@media\s*\(min-width:1280px\)[\s\S]*?\.nav/);
    assert.match(shellCss, /@media\s*\(min-width:768px\) and \(max-width:1279px\)[\s\S]*?\.nav[\s\S]*?overflow-x:auto/);
    assert.match(shellCss, /@media\s*\(max-width:767px\)[\s\S]*?\.nav[\s\S]*?position:fixed/);
    assert.match(shellCss, /transform:translateX\(-105%\)/);
    assert.match(shell, /event\.key === 'Escape'/);
    assert.match(shell, /event\.preventDefault\(\); last\.focus\(\)/);
    assert.match(shell, /mobileRestoreRef/);
    assert.match(workbenchCss, /@media\s*\(max-width:\s*767px\)[\s\S]*?\.sessionRail[\s\S]*?transform:\s*translateX\(-105%\)/);
  });

  it('runs the no-gutter matrix at 1440px and 1920px', () => {
    const output = execFileSync('node', ['scripts/responsive-layout-audit.mjs', '--widths=1440,1920'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.match(output, /90 route\/width checks passed/);
    assert.doesNotMatch(output, /FAIL|overflow|finding/i);
  });
});
