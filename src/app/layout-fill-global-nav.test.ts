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
  it('does not cap the authenticated content at a narrow desktop width', () => {
    assert.match(shellCss, /\.contentInner\s*\{[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*none/);
    assert.match(shellCss, /@media\s*\(min-width:\s*1600px\)[\s\S]*?\.contentInner\s*\{\s*width:\s*min\(1600px,\s*100%\)/);
    assert.doesNotMatch(shellCss, /\.contentInner\s*\{[^}]*max-width:\s*(?:9|10|11)\d\dpx/);
    assert.doesNotMatch(workbenchCss, /@media\s*\(min-width:\s*1600px\)[\s\S]*?width:\s*min\(1400px/);
  });

  it('keeps Chat and Task surfaces full width while retaining readable bubbles', () => {
    assert.match(workbenchCss, /\.page,\s*\n\.workGrid,\s*\n\.session\s*\{[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*none/);
    assert.match(workbenchCss, /\.sessionMain > \.messages,\s*\n\.sessionMain > \.composerDock\s*\{[\s\S]*?width:\s*100%/);
    assert.match(workbenchCss, /\.message\{[^}]*width:min\(760px,100%\)/);
    assert.match(workbenchCss, /\.workGrid\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(320px,420px\)/);
  });

  it('renders one shared global nav inventory and route-based active state', () => {
    for (const label of navItems) assert.ok(shell.includes(label), `${label} is present`);
    assert.match(shell, /title: 'PRIMARY MODES'/);
    assert.match(shell, /title: 'WORKSPACE'/);
    assert.match(shell, /title: 'ACCOUNT'/);
    assert.match(shell, /aria-current=\{pathname === item\.href \? 'page' : undefined\}/);
    assert.match(workbench, /if \(mode === 'chat'\) return <AppShell title=\{title\}>/);
    assert.doesNotMatch(workbench, /if \(mode === 'chat'\) return <AppShell title=\{title\} chrome="focus">/);
  });

  it('keeps the global sidebar and session rail closed as overlays on phones', () => {
    assert.match(shellCss, /@media\(max-width:1023px\)/);
    assert.match(shellCss, /\.sidebar\{[^}]*position:fixed[^}]*transform:translateX\(-105%\)/);
    assert.match(workbenchCss, /@media\s*\(max-width:\s*767px\)[\s\S]*?\.sessionRail[\s\S]*?transform:\s*translateX\(-105%\)/);
    assert.match(workbenchCss, /@media\s*\(max-width:\s*767px\)[\s\S]*?grid-template-areas:\s*"topbar" "center"/);
  });

  it('runs the no-gutter matrix at 1440px and 1920px', () => {
    const output = execFileSync('node', ['scripts/responsive-layout-audit.mjs', '--widths=1440,1920'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.match(output, /54 route\/width checks passed/);
    assert.doesNotMatch(output, /FAIL|overflow|finding/i);
  });
});
