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
  const top = navItems(shell, 'NAV_ITEMS');
  const others = navItems(shell, 'OTHER_NAV_ITEMS');

  it('first top-level item is exactly Chat and links to /chat', () => {
    assert.equal(top[0]?.label, 'Chat');
    assert.equal(top[0]?.href, '/chat');
  });

  it('removes the plus icon and the word New from the first nav label', () => {
    assert.ok(!top[0]!.label.includes('+'), 'no plus icon in the Chat label');
    assert.ok(!/\bNew\b/.test(top[0]!.label), 'no "New" text in the Chat label');
  });

  it('second top-level item is Task and links to /work', () => {
    assert.equal(top[1]?.label, 'Task');
    assert.equal(top[1]?.href, '/work');
  });

  it('exposes exactly one collapsible Others group that is collapsed by default', () => {
    assert.equal(shell.match(/>Others</g)?.length, 1, 'exactly one Others group label');
    assert.match(shell, /const \[othersOpen, setOthersOpen\] = useState\(false\)/, 'Others is default-collapsed');
    assert.match(shell, /aria-expanded=\{othersOpen\}/);
    assert.match(shell, /aria-controls="sidebar-others-group"/);
    assert.match(shell, /id="sidebar-others-group" hidden=\{!othersOpen\}/);
  });

  it('keeps the Others children in canonical order with canonical routes', () => {
    assert.deepEqual(others, [
      { href: '/files', label: 'Files & documents' },
      { href: '/images', label: 'Images' },
      { href: '/projects', label: 'Projects' },
      { href: '/agents', label: 'Agents' },
      { href: '/automations', label: 'Automations' },
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/settings', label: 'Settings' },
      { href: '/help', label: 'Help' },
      { href: '/billing', label: 'Billing & credits' },
    ]);
  });

  it('keeps exactly one of Billing & credits / See plans and pricing at top level', () => {
    const topLabels = top.map((item) => item.label);
    const visible = topLabels.filter((label) => label === 'Billing & credits' || label === 'See plans and pricing');
    assert.deepEqual(visible, ['See plans and pricing']);
    assert.ok(others.some((item) => item.label === 'Billing & credits'), 'Billing & credits moved into Others');
  });

  it('keeps the flat legacy list removed — only Chat, Task and pricing stay top-level', () => {
    assert.deepEqual(top.map((item) => item.href), ['/chat', '/work', '/pricing']);
  });

  it('keeps nav targets at least 44px tall and keyboard operable', () => {
    assert.match(shellCss, /\.navGroupToggle\{[^}]*min-height:44px/);
    assert.match(shellCss, /\.navGroupItems a\{[^}]*min-height:44px/);
    assert.match(shell, /<button\s+className=\{styles\.navGroupToggle\}/);
  });
});

describe('chat layout contract', () => {
  it('renders the message thread before the composer in the DOM', () => {
    const threadIndex = workbench.indexOf('className={styles.messages}');
    const composerIndex = workbench.indexOf('className={styles.composerDock}');
    assert.ok(threadIndex > -1, 'thread container exists');
    assert.ok(composerIndex > -1, 'composer dock exists');
    assert.ok(threadIndex < composerIndex, `${workbenchPath}: thread must precede composer`);
  });

  it('keeps the composer dock as the last child of the chat flex column', () => {
    const chat = workbench.split('className={styles.chatWrap}')[1]?.split('</section>')[0] ?? '';
    assert.ok(chat.length > 0);
    assert.ok(chat.lastIndexOf('className={styles.composerDock}') > chat.lastIndexOf('className={styles.messages}'));
    assert.ok(!/<article[\s\S]*styles\.composerDock/.test(chat.slice(chat.indexOf('composerDock'))), 'no message blocks after the composer');
    assert.match(workbenchCss, /\.chatWrap\{[^}]*display:flex[^}]*flex-direction:column/);
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
