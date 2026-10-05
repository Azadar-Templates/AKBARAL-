import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Structural contract for the authenticated agent session page.
 *
 * Four panes in a fixed order (left sessions · center thread · docked composer
 * · right output panel), chronological flow with the composer last, and every
 * row sourced from a real endpoint.
 */
const root = process.cwd();
const uiPath = 'src/app/_components/workbench/workbench-shell.tsx';
const ui = readFileSync(join(root, uiPath), 'utf8');
const css = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.module.css'), 'utf8');
const shell = readFileSync(join(root, 'src/app/_components/app-shell.tsx'), 'utf8');
const shellCss = readFileSync(join(root, 'src/app/_components/app-shell.module.css'), 'utf8');

const sessionBlock = ui.slice(ui.indexOf("if (mode === 'chat') return"), ui.indexOf('return <AppShell title={title} viewportLocked>\n    <div className={styles.page}>'));

describe('agent session layout — four panes', () => {
  it('mounts left rail, center column, docked composer and right panel in order', () => {
    const order = ['styles.session}', 'styles.sessionBar}', 'styles.sessionRail}', 'styles.sessionMain}', 'styles.messages}', 'styles.composerDock}', 'styles.sessionPanel}'];
    let cursor = -1;
    for (const marker of order) {
      const index = sessionBlock.indexOf(marker);
      assert.ok(index > -1, `${marker} exists`);
      assert.ok(index > cursor, `${marker} follows the previous pane`);
      cursor = index;
    }
  });

  it('uses the shared global AppShell so Chat and Task have the same navigation', () => {
    assert.match(sessionBlock, /<AppShell title=\{title\} viewportLocked>/);
    assert.match(shell, /const NAV_GROUPS = \[/);
    for (const label of ['Chat', 'Task', 'Dashboard', 'Files & documents', 'Images', 'Projects', 'Agents', 'Agent Factory', 'Automations', 'Billing &amp; credits', 'See plans and pricing', 'Settings', 'Help']) {
      assert.ok(shell.includes(label), `${label} is in the global navigation`);
    }
    assert.match(shell, /aria-current=\{pathname === item\.href \? 'page' : undefined\}/);
    assert.match(shellCss, /grid-template-columns:280px minmax\(0,1fr\)/);
  });

  it('left rail is collapsible with a real new-session action and grouped real rows', () => {
    assert.match(sessionBlock, /aria-expanded=\{railOpen\}/);
    assert.match(sessionBlock, /aria-controls="session-rail"/);
    assert.match(sessionBlock, /\+ New session/);
    assert.match(ui, /const startNewSession = \(\) => \{/);
    assert.match(ui, /function groupSessions/);
    for (const label of ["'Today'", "'Yesterday'", "'Older'"]) assert.ok(ui.includes(label), `${label} group`);
  });

  it('rail is expanded from 1280px up and collapsed below it', () => {
    assert.match(ui, /const wide = window\.matchMedia\('\(min-width: 1280px\)'\)/);
    assert.match(ui, /setRailOpen\(wide\.matches\); setRailDrawer\(!wide\.matches\)/);
  });

  it('collapses the rail to a 56px icon strip that keeps every action reachable', () => {
    assert.match(sessionBlock, /data-collapsed=\{railOpen \? undefined : 'true'\}/);
    assert.match(sessionBlock, /className=\{styles\.railIcons\}/);
    assert.match(sessionBlock, /aria-label="Expand sessions"/);
    assert.match(sessionBlock, /aria-label="New session"/);
    assert.match(css, /\.session\[data-rail='collapsed'\]\{grid-template-columns:56px/);
    assert.match(css, /\.railIconButton\{width:44px;height:44px/);
  });

  it('filters sessions client-side with a debounce', () => {
    assert.match(ui, /setTimeout\(\(\) => setDebouncedQuery\(historyQuery\.trim\(\)\.toLowerCase\(\)\), 250\)/);
    assert.match(ui, /const visibleConversations = debouncedQuery/);
    assert.match(ui, /const sessionGroups = groupSessions\(visibleConversations\)/);
  });

  it('traps focus in the rail while it is an overlay drawer', () => {
    assert.match(ui, /if \(!railDrawer \|\| !railOpen\) return/);
    assert.match(ui, /if \(event\.key === 'Escape'\) \{ setRailOpen\(false\); return; \}/);
    assert.match(ui, /event\.preventDefault\(\); last\.focus\(\)/);
    assert.match(sessionBlock, /className=\{styles\.sessionScrim\}/);
  });

  it('center top bar carries back link, title and a live status dot only', () => {
    assert.match(sessionBlock, /className=\{styles\.backLink\} href="\/chat"/);
    assert.match(sessionBlock, /className=\{styles\.sessionTitle\}/);
    assert.match(sessionBlock, /data-state=\{sessionStatus\}/);
    assert.match(ui, /const sessionStatus = error \? 'error' : busy \? 'streaming' : 'idle'/);
    assert.ok(!/>Share<|>More<|aria-label="Share"|Microphone|>Mic</.test(sessionBlock), 'no placeholder share/more/mic controls');
  });

  it('right panel exposes Files / Artifacts / Preview tabs and closes', () => {
    assert.match(sessionBlock, /role="tablist"/);
    assert.match(sessionBlock, /\(\['files', 'artifacts', 'preview'\] as PanelTab\[\]\)/);
    assert.match(sessionBlock, /aria-selected=\{panelTab === tab\}/);
    assert.match(sessionBlock, /role="tabpanel"/);
    assert.match(css, /\.panelTab\{[^}]*min-height:44px/);
  });

  it('right panel opens by itself only on a wide screen with real output', () => {
    assert.match(ui, /const hasOutput = \(artifacts\.artifacts \?\? \[\]\)\.length > 0 \|\| Boolean\(website\.artifact\)/);
    assert.match(ui, /if \(hasOutput && window\.matchMedia\('\(min-width: 1280px\)'\)\.matches\) setPanelOpen\(true\)/);
    assert.match(ui, /const \[panelOpen, setPanelOpen\] = useState\(false\)/);
  });
});

describe('agent session flow — chronological, composer last', () => {
  it('renders the thread before the composer and nothing after it', () => {
    const threadIndex = sessionBlock.indexOf('styles.messages');
    const composerIndex = sessionBlock.indexOf('className={styles.composerDock}');
    assert.ok(threadIndex > -1 && composerIndex > threadIndex, `${uiPath}: thread precedes composer`);
    const afterComposer = sessionBlock.slice(composerIndex);
    assert.ok(!afterComposer.includes('styles.message}'), 'no message bubbles after the composer');
    assert.ok(!afterComposer.includes('styles.messages}'), 'no second thread after the composer');
  });

  it('streams assistant tokens into the thread, never into the composer', () => {
    assert.match(ui, /setMessages\(\(current\) => current\.map\(\(item\) => item\.id === assistantId \? \{ \.\.\.item, content: item\.content \+ event\.token \}/);
    assert.match(sessionBlock, /styles\.streamCursor/);
    assert.match(css, /\.streamCursor\{/);
  });

  it('keeps the thread itself scrollable and auto-scrolls smoothly', () => {
    assert.match(css, /\.messages\{[^}]*flex:1 1 auto[^}]*min-height:0[^}]*overflow:auto/);
    assert.match(ui, /thread\.scrollTo\(\{ top: thread\.scrollHeight, behavior: 'smooth' \}\)/);
    assert.match(ui, /ref=\{threadRef\}/);
  });

  it('keeps the composer docked inside the center column', () => {
    const columnStart = sessionBlock.indexOf('className={styles.sessionMain}');
    const column = sessionBlock.slice(columnStart, sessionBlock.indexOf('{/* 3 — RIGHT', columnStart));
    assert.ok(column.includes('styles.composerDock'), 'composer lives inside the center column');
    assert.ok(column.lastIndexOf('styles.composerDock') > column.lastIndexOf('styles.messages'));
    assert.match(css, /\.sessionMain\{[^}]*display:flex[^}]*flex-direction:column/);
  });
});

describe('agent session honesty', () => {
  it('shows tool lines only when real events exist', () => {
    assert.match(sessionBlock, /\{tools\.length > 0 \? <ol className=\{styles\.inlineTools\}/);
    assert.ok(!/Running bash|Searching the web|Session complete/.test(ui), 'no synthetic activity copy');
  });

  it('gates attach controls on the catalog reason, both file and image', () => {
    assert.match(ui, /disabled title=\{attachDisabledReason\} aria-describedby="composer-attach-reason">Attach file/);
    assert.match(ui, /disabled title=\{attachDisabledReason\} aria-describedby="composer-attach-reason">Upload image/);
  });

  it('keeps the model picker catalog-driven inside the session composer', () => {
    assert.match(sessionBlock, /disabled=\{!item\.available\}/);
    assert.ok(!/provider === 'google'/.test(ui));
  });

  it('renders honest empty states for sessions, files, artifacts and preview', () => {
    for (const copy of ['No sessions yet.', 'No files yet.', 'No artifacts yet.', 'No preview yet.']) {
      assert.ok(sessionBlock.includes(copy), `${copy} empty state`);
    }
    assert.ok(!/sample|placeholder row|dummy|lorem/i.test(sessionBlock), 'no placeholder rows');
  });

  it('builds the right panel from real project endpoints only', () => {
    assert.match(ui, /`\/api\/projects\/\$\{encodeURIComponent\(id\)\}`/);
    assert.match(ui, /`\/api\/projects\/\$\{encodeURIComponent\(id\)\}\/artifacts`/);
    assert.match(ui, /`\/api\/projects\/\$\{encodeURIComponent\(id\)\}\/artifacts\/website`/);
    assert.match(sessionBlock, /artifacts\/website\/download/);
    assert.match(sessionBlock, /title="Sandboxed session artifact" sandbox=""/);
  });

  it('keeps exactly one merged credit and AI-accuracy disclosure at the point of input', () => {
    assert.match(sessionBlock, /AI can make mistakes\. Verify important information\. Chat never deducts Work task credits\./);
    assert.equal((sessionBlock.match(/styles\.disclosure/g) ?? []).length, 1);
    assert.match(sessionBlock, /<a href="\/privacy">Privacy<\/a>/);
  });
});

describe('agent session grid and responsive contract', () => {
  it('uses one CSS grid with a top bar spanning all three columns', () => {
    assert.match(css, /\.session\{[^}]*display:grid/);
    assert.match(css, /grid-template-areas:"topbar topbar topbar" "leftrail center rightpanel"/);
    assert.match(css, /grid-template-columns:280px minmax\(0,1fr\) 320px/);
    assert.match(css, /\.sessionBar\{grid-area:topbar[^}]*height:56px/);
    assert.match(css, /\.sessionRail\{grid-area:leftrail/);
    assert.match(css, /\.sessionMain\{grid-area:center/);
    assert.match(css, /\.sessionPanel\{grid-area:rightpanel/);
  });

  it('closes the right panel below 1280px and keeps it an overlay there', () => {
    assert.match(css, /@media\(max-width:1279px\)\{[^@]*\.sessionPanel\{position:absolute/);
    assert.match(ui, /const query = window\.matchMedia\('\(min-width: 1280px\)'\);\n\s*const apply = \(\) => \{ if \(!query\.matches\) setPanelOpen\(false\); \}/);
  });

  it('turns both side panes into drawers below 768px', () => {
    assert.match(css, /@media\s*\(max-width:\s*767px\)[\s\S]*?grid-template-areas:\s*"topbar" "center"/);
    assert.match(css, /@media\s*\(max-width:\s*767px\)[\s\S]*?\.sessionRail[\s\S]*?position:\s*absolute/);
    assert.match(css, /@media\(max-width:1023px\)\{/);
  });

  it('cannot scroll horizontally: every session container is width-contained', () => {
    assert.match(css, /\.session\{[^}]*max-width:100%[^}]*overflow:hidden/);
    assert.match(css, /\.session>\*\{min-width:0;max-width:100%\}/);
    assert.match(css, /\.messages\{[^}]*overflow-x:hidden/);
    assert.match(css, /\.sessionMain\{[^}]*min-width:0[^}]*overflow:hidden/);
    assert.match(css, /\.panelPreview\{width:100%;max-width:100%/);
  });

  it('keeps focus-visible rings on every session control', () => {
    assert.match(css, /\.session :where\(button,textarea,select,a,input\):focus-visible\{outline:2px solid var\(--accent-bright\)/);
  });
});

describe('agent session scroll behaviour', () => {
  it('respects a reader who scrolled up by more than 100px', () => {
    assert.match(ui, /const distance = thread\.scrollHeight - thread\.scrollTop - thread\.clientHeight/);
    assert.match(ui, /const pinned = distance <= 100/);
    assert.match(ui, /if \(threadPinned\) thread\.scrollTo\(\{ top: thread\.scrollHeight, behavior: 'smooth' \}\)/);
    assert.match(ui, /else if \(messages\.length > 0\) setHasNewBelow\(true\)/);
  });

  it('offers a New toast that jumps back to the newest message', () => {
    assert.match(sessionBlock, /\{hasNewBelow \? <button className=\{styles\.newBelowToast\}[^>]*onClick=\{scrollThreadToEnd\}/);
    assert.match(css, /\.newBelowToast\{position:absolute[^}]*min-height:44px/);
    assert.match(sessionBlock, /onScroll=\{onThreadScroll\}/);
  });

  it('right-aligns the user bubble and keeps the assistant plain', () => {
    assert.match(css, /\.message\[data-role="user"\]\{[^}]*margin-left:auto/);
    assert.match(css, /\.message\{[^}]*width:min\(760px,100%\);margin:0 auto/);
    assert.match(sessionBlock, /message\.content \? <CopyButton value=\{message\.content\} \/> : null/);
  });
});
