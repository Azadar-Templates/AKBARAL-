import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();
const ui = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.tsx'), 'utf8');
const css = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.module.css'), 'utf8');
const chat = ui.slice(ui.indexOf("if (mode === 'chat') return"), ui.indexOf('  return <AppShell title={title} viewportLocked>'));
const center = chat.slice(chat.indexOf('className={styles.sessionMain}'), chat.indexOf('{/* 3 — RIGHT'));
const topbar = chat.slice(chat.indexOf('className={styles.sessionBar}'), chat.indexOf('{/* 1 — LEFT'));

function count(pattern: RegExp, value: string) {
  return [...value.matchAll(pattern)].length;
}

describe('AKBARAL! green chat layout release fixes', () => {
  it('docks the composer as the final center-column child with a flexible thread', () => {
    assert.ok(center.indexOf('styles.messages') > -1);
    assert.ok(center.lastIndexOf('className={styles.composerDock}') > center.lastIndexOf('className={styles.messages}'));
    assert.match(css, /\.sessionMain\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
    assert.match(css, /\.sessionMain\s*\{[\s\S]*?gap:\s*0/);
    assert.match(css, /\.messages\s*\{[^}]*flex:\s*1 1 auto[^}]*min-height:\s*0[^}]*overflow:\s*auto/s);
    assert.match(css, /\.composerDock\s*\{[^}]*flex:\s*0 0 auto/s);
    assert.doesNotMatch(css, /spacer|fixed-height spacer/i);
  });

  it('centers the empty state inside the scrollable thread only', () => {
    assert.match(center, /styles\.messages[\s\S]*styles\.messagesEmpty/);
    assert.match(center, /messages\.length === 0[\s\S]*How can I help\?/s);
    assert.match(css, /\.messagesEmpty\s*\{[^}]*justify-content:\s*center/s);
    assert.match(css, /\.messagesEmpty \.empty\s*\{[^}]*margin:\s*auto/s);
  });

  it('keeps the session search button on one line with a real input minimum', () => {
    assert.match(chat, />Search<\/button>/);
    assert.match(css, /\.historySearch input\{[^}]*min-width:0/);
    assert.match(css, /\.historySearch \.smallButton\s*\{[^}]*white-space:\s*nowrap/s);
    assert.match(css, /\.historySearch \.smallButton\s*\{[^}]*min-width:\s*max-content/s);
    assert.doesNotMatch(ui, /Sear\s+ch/);
  });

  it('keeps only the rail New session action, not a composer New chat action', () => {
    assert.match(chat, /\+ New session/);
    assert.doesNotMatch(center, />New chat<\/button>/);
  });

  it('renders exactly one merged point-of-input disclosure', () => {
    assert.equal(count(/styles\.disclosure/g, center), 1);
    assert.equal(count(/AI can make mistakes\./g, center), 1);
    assert.match(center, /AI can make mistakes\. Verify important information\. Chat never deducts Work task credits\./);
  });

  it('renders all three honest output tabs and switches the selected panel', () => {
    assert.match(chat, /\['files', 'artifacts', 'preview'\] as PanelTab\[\]/);
    for (const label of ['Files', 'Artifacts', 'Preview']) assert.ok(chat.includes(`'${label.toLowerCase()}'`) || chat.includes(`>${label}<`), `${label} tab`);
    assert.match(chat, /aria-selected=\{panelTab === tab\}/);
    assert.match(chat, /panelTab === 'files'/);
    assert.match(chat, /panelTab === 'artifacts'/);
    assert.match(chat, /panelTab === 'preview'/);
    assert.match(chat, /No files yet\./);
    assert.match(chat, /No artifacts yet\./);
    assert.match(chat, /No preview yet\./);
  });

  it('renders only real API sessions and filters starter labels at the source boundary', () => {
    assert.match(ui, /apiJson<ConversationsPayload>\(`\/api\/chat/);
    assert.match(ui, /\.filter\(\(row\) => !isStarterPromptSession\(row\)\)/);
    assert.match(ui, /STARTER_PROMPTS\.some/);
    assert.match(ui, /setConversations\(realSessions\)/);
    assert.doesNotMatch(center, /setConversations\(\[/);
  });

  it('attaches starter chips directly above the composer and scrolls on phones', () => {
    const starters = center.indexOf('className={styles.starters}');
    const composer = center.indexOf('<Composer ');
    assert.ok(starters > -1 && composer > starters);
    assert.ok(!ui.slice(ui.indexOf('className={styles.messages}'), starters).includes('styles.starters'));
    assert.match(css, /\.starterChip\s*\{[^}]*white-space:\s*nowrap/s);
    assert.match(css, /\.starters\s*\{[\s\S]*?overflow-x:\s*auto/s);
    assert.match(css, /\.starters\s*\{\s*flex-wrap:\s*nowrap/s);
  });

  it('balances the session bar with title, live status, and account menu', () => {
    assert.match(topbar, /className=\{styles\.backLink\}/);
    assert.match(topbar, /className=\{styles\.sessionTitle\}/);
    assert.match(topbar, /className=\{styles\.statusDot\} data-state=\{sessionStatus\}/);
    assert.match(topbar, /className=\{styles\.sessionAvatarButton\}/);
    assert.match(topbar, /className=\{styles\.sessionMenu\}/);
    for (const label of ['Settings', 'Billing &amp; credits', 'Help', 'Log out']) assert.ok(topbar.includes(label), `${label} menu action`);
    assert.match(css, /\.sessionBar\s*\{[^}]*height:\s*56px/s);
    // Horizontal clip only: the account dropdown hangs below the bar and must
    // not be clipped by an ancestor overflow:hidden (menu/rail fix).
    assert.match(css, /\.sessionBar\s*\{[^}]*overflow-x:\s*clip/s);
    assert.match(css, /\.sessionBar\s*\{[^}]*overflow-y:\s*visible/s);
    assert.doesNotMatch(css, /\.sessionBar\s*\{[^}]*overflow:\s*hidden/s);
    assert.match(css, /\.sessionAvatarButton\s*\{\s*width:\s*44px/s);
  });
});
