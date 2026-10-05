import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const shellPath = 'src/app/_components/app-shell.tsx';
const workbenchPath = 'src/app/_components/workbench/workbench-shell.tsx';
const shell = readFileSync(join(root, shellPath), 'utf8');
const shellCss = readFileSync(join(root, 'src/app/_components/app-shell.module.css'), 'utf8');
const workbench = readFileSync(join(root, workbenchPath), 'utf8');
const workbenchCss = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.module.css'), 'utf8');

function navItems(source: string, constName: string) {
  const block = source.split(`const ${constName} = [`)[1]?.split('] as const;')[0] ?? '';
  assert.ok(block.length > 0, `${constName} is declared in the shell`);
  return [...block.matchAll(/\{\s*href:\s*'([^']+)',\s*label:\s*'([^']+)'/g)].map((match) => ({ href: match[1], label: match[2] }));
}

describe('sidebar navigation contract', () => {
  const nav = navItems(shell, 'NAV_GROUPS');

  it('keeps Chat and Task as the first two primary modes', () => {
    assert.deepEqual(nav.slice(0, 2), [
      { href: '/chat', label: 'Chat' },
      { href: '/work', label: 'Task' },
    ]);
  });

  it('uses intentional named groups instead of a generic More or Others bucket', () => {
    for (const label of ['PRIMARY MODES', 'WORKSPACE', 'ACCOUNT']) assert.ok(shell.includes(label), `${label} group`);
    assert.doesNotMatch(shell, />Others<|>More<|NAV_ITEMS|OTHER_NAV_ITEMS/);
  });

  it('keeps the workspace registry links in the canonical product order', () => {
    const paths = nav.map((item) => item.href);
    for (const path of ['/dashboard', '/files', '/images', '/projects', '/agents', '/agent-factory', '/automations']) {
      assert.ok(paths.includes(path), `${path} is navigable`);
    }
  });

  it('keeps billing, pricing, settings, and help in the account group', () => {
    for (const path of ['/billing', '/pricing', '/settings', '/help']) assert.ok(nav.some((item) => item.href === path), `${path} account link`);
  });

  it('keeps nav targets at least 44px tall and keyboard operable', () => {
    assert.match(shellCss, /\.nav a\{[^}]*min-height:42px/);
    assert.match(shellCss, /\.shell :where\(button, a\[href\]\)\s*\{\s*min-height:\s*44px/);
    assert.match(shell, /<nav className=\{styles\.nav\}/);
  });
});

describe('chat layout contract', () => {
  it('renders the message thread before the composer in the DOM', () => {
    const threadIndex = workbench.indexOf('styles.messages');
    const composerIndex = workbench.indexOf('className={styles.composerDock}');
    assert.ok(threadIndex > -1, 'thread container exists');
    assert.ok(composerIndex > -1, 'composer dock exists');
    assert.ok(threadIndex < composerIndex, `${workbenchPath}: thread must precede composer`);
  });

  it('keeps the composer dock as the last child of the chat flex column', () => {
    const chat = workbench.split('className={styles.sessionMain}')[1]?.split('{/* 3 — RIGHT')[0] ?? '';
    assert.ok(chat.length > 0);
    assert.ok(chat.lastIndexOf('className={styles.composerDock}') > chat.lastIndexOf('styles.messages'));
    assert.ok(!/<article[\s\S]*styles\.composerDock/.test(chat.slice(chat.indexOf('composerDock'))), 'no message blocks after the composer');
    assert.match(workbenchCss, /\.sessionMain\s*\{[\s\S]*?display:\s*flex/);
    assert.match(workbenchCss, /\.messages\{[^}]*flex:1 1 auto[^}]*min-height:0[^}]*overflow:auto/);
  });

  it('keeps the composer honest, large, and keyboard friendly', () => {
    assert.match(workbench, /rows=\{4\}/);
    assert.match(workbenchCss, /\.composer textarea\{[^}]*max-height:30dvh/);
    assert.match(workbench, /event\.key === 'Enter' && !event\.shiftKey/);
    assert.match(workbench, /Upload image/);
    assert.match(workbench, /Chat never deducts Work task credits\./);
  });

  it('drives the chat model selector from the server catalog, not a client allow-list', () => {
    assert.doesNotMatch(workbench, /item\.provider === 'google'/, 'the Gemini-only filter is gone');
    assert.match(workbench, /disabled=\{!item\.available\}/, 'unavailable models are disabled, not hidden');
  });
});
