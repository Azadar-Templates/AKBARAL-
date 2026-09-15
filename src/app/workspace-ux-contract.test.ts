import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/**
 * Application-shell contract (Build #6 — the Task 4 workspace, web + Android
 * parity).
 *
 * The product requirement this suite locks: ONE compact application screen —
 * not a long scrolling dashboard — with the same model on every platform.
 *
 *   LEFT   · the sidebar: brand + tagline, New chat, Search, Library,
 *            Images & media, Projects, Files, recent history, account.
 *   CENTER · the MASTER conversation: header, live activity, composer with
 *            real attachment controls.
 *   RIGHT  · the artifact rail: the download / export control ABOVE the live
 *            preview canvas, plus the Files / Library / Images panels
 *            reachable from the rail tabs at the top.
 *
 * Narrow viewports collapse the sidebar into a drawer and SWITCH panes
 * (Preview | MASTER chat) — they never shrink the desktop grid. The Android
 * app implements the identical spatial model (mobile/src/screens/
 * MasterScreen.tsx) from the same design tokens.
 *
 * Part 1 asserts the source contract (markup + styles + route + mobile screen).
 * Part 2 EXECUTES the real app.js workspace functions in a VM against a DOM
 * stub to prove the behaviour: chat turns are real, the canvas is driven by
 * the same payload, the pane switch works, and nothing is fabricated.
 */

const root = process.cwd();
const appJs = readFileSync(join(root, 'public', 'app.js'), 'utf8');
const css = readFileSync(join(root, 'public', 'styles.css'), 'utf8');
const page = readFileSync(join(root, 'src', 'app', 'page.tsx'), 'utf8');
const shell = readFileSync(join(root, 'src', 'app', 'layout.tsx'), 'utf8');
const mobile = readFileSync(join(root, 'mobile', 'src', 'screens', 'MasterScreen.tsx'), 'utf8');

/** Extract a top-level `function name(…) {…}` from app.js by brace matching. */
function extractFunction(name: string): string {
  const marker = `function ${name}(`;
  const start = appJs.indexOf(marker);
  assert.ok(start >= 0, `function ${name} must exist in app.js`);
  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < appJs.length; i += 1) {
    const ch = appJs[i];
    if (ch === '{') {
      depth += 1;
      if (bodyStart < 0) bodyStart = i;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && bodyStart > 0) return appJs.slice(start, i + 1);
    }
  }
  throw new Error(`could not extract function ${name}`);
}

/* ---------------------------------------------------------------- DOM stub */

class FakeNode {
  id = '';
  innerHTML = '';
  textContent = '';
  hidden = false;
  className = '';
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  listeners: Record<string, Array<() => void>> = {};
  queryResults: FakeNode[] = [];
  scrollTop = 0;
  scrollHeight = 100;
  classList = {
    add: (): void => undefined,
    remove: (): void => undefined,
    toggle: (): void => undefined,
  };

  setAttribute(key: string, value: string): void { this.attrs[key] = value; }
  getAttribute(key: string): string { return this.attrs[key] ?? ''; }
  addEventListener(kind: string, fn: () => void): void { (this.listeners[kind] ||= []).push(fn); }
  click(): void { (this.listeners.click ?? []).forEach((fn) => fn()); }
  appendChild(node: FakeNode): FakeNode { node.parentNode = this; this.children.push(node); return node; }
  insertBefore(node: FakeNode, reference: FakeNode | null): FakeNode {
    node.parentNode = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index >= 0) this.children.splice(index, 0, node);
    else this.children.push(node);
    return node;
  }
  querySelector(_selector: string): FakeNode { return new FakeNode(); }
  querySelectorAll(_selector: string): FakeNode[] { return []; }
}

interface WorkspaceDom {
  nodes: Record<string, FakeNode>;
  created: FakeNode[];
}

/** Build the exact mounts the workspace shell writes to. */
function buildDom(): WorkspaceDom {
  const nodes: Record<string, FakeNode> = {};
  const add = (id: string): FakeNode => (nodes[id] = Object.assign(new FakeNode(), { id }));
  const chatLog = add('master-chat-log');
  const activity = add('master-output');
  add('master-result');
  add('master-preview-empty');
  add('master-canvas-state');
  add('master-layout');
  const tabs = ['workspace', 'chat'].map((pane) => Object.assign(new FakeNode(), { dataset: { paneTab: pane } }));
  chatLog.appendChild(activity); // activity stream is the last element of the rail
  const created: FakeNode[] = [];
  (nodes as unknown as Record<string, unknown>).__tabs = tabs;
  (nodes as unknown as Record<string, unknown>).__created = created;
  return { nodes, created };
}

/** Load the real workspace functions from app.js into a VM with the stub. */
function loadWorkspace(dom: WorkspaceDom): Record<string, any> {
  const tabs = (dom.nodes as unknown as Record<string, unknown>).__tabs as FakeNode[];
  const documentStub = {
    getElementById: (id: string) => dom.nodes[id] ?? null,
    createElement: () => {
      const node = new FakeNode();
      const children = new Map<string, FakeNode>();
      // Stable child per selector: a re-queried action button is the SAME node,
      // so a bound handler is the handler the test clicks.
      node.querySelector = (selector: string) => {
        if (!children.has(selector)) children.set(selector, new FakeNode());
        return children.get(selector) as FakeNode;
      };
      dom.created.push(node);
      return node;
    },
    querySelector: (selector: string) => (selector.startsWith('#') ? dom.nodes[selector.slice(1)] ?? null : null),
    querySelectorAll: (selector: string) => (selector === '[data-pane-tab]' ? tabs : []),
  };
  const windowStub = {
    matchMedia: () => ({ matches: false }),
    open: () => undefined,
    addEventListener: () => undefined,
  };
  const source = [
    'const state = { accessToken: "test-token" };',
    'const $ = (sel, root) => (root ? root.querySelector(sel) : document.querySelector(sel));',
    'const $$ = (sel, root) => (root ? root.querySelectorAll(sel) : document.querySelectorAll(sel));',
    extractFunction('esc'),
    extractFunction('friendlyTaskError'),
    extractFunction('isFullHtmlDocument'),
    extractFunction('tryParseJsonTable'),
    extractFunction('renderWebsitePreview'),
    extractFunction('renderDataTable'),
    extractFunction('renderImagePreview'),
    extractFunction('renderDocumentPreview'),
    extractFunction('renderBusinessForm'),
    extractFunction('renderComparisonCards'),
    extractFunction('renderTaskOutcome'),
    extractFunction('chatAppend'),
    extractFunction('chatScrollToEnd'),
    extractFunction('masterPaneSet'),
    extractFunction('masterPaneIsNarrow'),
    extractFunction('canvasSetState'),
    extractFunction('canvasKindLabel'),
    extractFunction('extractHtmlDeliverable'),
    extractFunction('outcomeChatTurn'),
    extractFunction('renderMasterResult'),
    extractFunction('clearMasterResult'),
    'module.exports = { chatAppend, masterPaneSet, canvasSetState, canvasKindLabel, extractHtmlDeliverable, outcomeChatTurn, renderMasterResult, clearMasterResult, renderTaskOutcome, esc };',
  ].join('\n\n');
  const module = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(source, {
    module,
    console,
    document: documentStub,
    window: windowStub,
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => undefined },
    Blob: class Blob { constructor() { undefined; } },
    fetch: () => Promise.resolve({ ok: true, blob: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    setTimeout: () => undefined,
  });
  return module.exports as Record<string, any>;
}

/* ------------------------------------------------------- 1. SOURCE CONTRACT */

describe('AKBARAL! application shell — source contract (web)', () => {
  it('the conversation is the CENTER column and the artifact rail is the bounded RIGHT column', () => {
    const chat = page.indexOf('id="master-chat"');
    const rail = page.indexOf('id="master-workspace"');
    assert.ok(chat > 0 && rail > 0, 'both regions are mounted');
    assert.ok(chat < rail, 'the conversation precedes the artifact rail in document order (left → right)');
    assert.match(css, /\.master-layout\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(360px,\s*460px\)/, 'grid: fluid conversation + bounded artifact rail');
    assert.match(css, /\.master-chat\s*\{[^}]*min-width:\s*0/, 'the conversation is the flow column');
    assert.match(css, /\.master-chat\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto/, 'the conversation is a header / log / composer grid');
    assert.match(css, /\.master-workspace\s*\{\s*display:\s*grid;\s*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/, 'the rail is a tabs / scrollable-body grid');
    assert.match(css, /\.ak-rail-body\s*\{[^}]*overflow-y:\s*auto/, 'the rail body scrolls inside its own column');
  });

  it('the LEFT sidebar mounts every top-level control — and hides the marketing chrome on the app screen', () => {
    const sidebar = page.indexOf('id="master-sidebar"');
    const chat = page.indexOf('id="master-chat"');
    assert.ok(sidebar > 0 && chat > 0, 'sidebar and conversation are mounted');
    assert.ok(sidebar < chat, 'the sidebar precedes the conversation (left → right)');
    const rail = page.slice(sidebar, page.indexOf('id="master-sidebar-scrim"'));
    for (const mount of [
      'brand-mark ak-brand-mark',
      'One Intelligence. Every Solution.',
      'id="master-new-chat"',
      'data-ak-action="search"',
      'data-ak-action="library"',
      'data-ak-action="media"',
      'data-ak-action="projects"',
      'data-ak-action="files"',
      'id="master-task-history"',
      'id="master-account"',
      'id="ak-user-name"',
      'id="ak-account-menu"',
      'id="ak-owner-link"',
      'id="ak-logout"',
    ]) {
      assert.ok(rail.includes(mount), `${mount} lives in the sidebar`);
    }
    assert.ok(!rail.includes('id="master-chat-log"'), 'the chat log is not part of the sidebar');
    assert.match(css, /body\.is-workspace \.site-header\s*\{\s*display:\s*none/, 'the app screen owns the viewport');
    assert.match(css, /\.ak-app\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*264px minmax\(0,\s*1fr\)/, 'sidebar + main frame');
  });

  it('every sidebar entry opens a real surface — no placeholder navigation', () => {
    assert.match(appJs, /function shellAction\(action\)/, 'the sidebar dispatcher exists');
    assert.match(appJs, /case 'search': shellSearchOpen\(\);/, 'Search opens the real search overlay');
    assert.match(appJs, /case 'library': shellRailOpen\('library'\);/, 'Library opens the real task library');
    assert.match(appJs, /case 'media': shellRailOpen\('media'\);/, 'Images & media opens the real media panel');
    assert.match(appJs, /case 'files': shellRailOpen\('files'\);/, 'Files opens the real project file panel');
    assert.match(appJs, /case 'projects': location\.hash = '#\/projects';/, 'Projects opens the real projects screen');
    assert.match(appJs, /if \(view === 'projects'\) \{ showScreen\('workspace'\); await loadWorkspace\(\); return; \}/, 'the projects route really mounts the projects surface');
    assert.match(appJs, /case 'agents': location\.hash = '#\/agents';/, 'Agents opens the real registry screen');
    assert.match(appJs, /case 'billing': location\.hash = '#\/billing';/, 'Billing opens the real billing screen');
    // The real data sources behind the panels.
    assert.match(appJs, /async function shellLoadLibrary\(\)[\s\S]{0,600}?api\('\/api\/tasks'\)/, 'the library reads real tasks');
    assert.match(appJs, /async function shellLoadMedia\(\)[\s\S]{0,900}?artifacts\/image/, 'the media panel reads real image artifacts');
    assert.match(appJs, /async function shellSearchRun\(query\)[\s\S]{0,900}?api\('\/api\/files\/knowledge\/search'/, 'search queries the real knowledge index');
    assert.match(appJs, /data-library-open/, 'library rows open the stored result');
    assert.match(appJs, /data-media-download/, 'media cards download the stored bytes');
  });

  it('the rail tabs reach Preview / Files / Library / Images and the file mounts live in the rail', () => {
    const rail = page.slice(page.indexOf('id="master-workspace"'), page.indexOf('id="screen-task"'));
    for (const tab of ['preview', 'files', 'library', 'media']) {
      assert.ok(rail.includes(`data-rail-tab="${tab}"`), `the ${tab} tab is mounted`);
      assert.ok(rail.includes(`data-rail-pane="${tab}"`), `the ${tab} panel is mounted`);
    }
    for (const mount of ['ws-files-panel', 'id="master-files"', 'id="master-project-controls"', 'id="master-attachment-input"']) {
      assert.ok(rail.includes(mount), `${mount} lives in the artifact rail`);
    }
    assert.ok(!rail.includes('id="master-chat-log"'), 'the chat log is not part of the artifact rail');
    assert.match(appJs, /function shellRailTabSet\(name\)/, 'the rail tabs are wired in the client');
    assert.match(appJs, /pane\.hidden = pane\.dataset\.railPane !== tab/, 'the rail really switches panels');
    assert.match(appJs, /shellRailSet\(shell\?\.dataset\.rail === 'closed'\)/, 'the rail collapses and reopens from the top bar');
  });

  it('the download/export control is ABOVE the preview, and the preview is the canvas right under it', () => {
    const exportBar = page.indexOf('id="master-export-actions"');
    const preview = page.indexOf('id="master-preview"');
    const result = page.indexOf('id="master-result"');
    assert.ok(exportBar < preview && preview < result, 'export control → preview surface → deliverable canvas');
    assert.match(css, /\.ws-exportbar\s*\{[^}]*align-items:\s*center/, 'export bar is a real toolbar');
    assert.match(css, /\.ws-preview\s*\{[^}]*overflow:\s*hidden/, 'preview clips the rendered deliverable');
  });

  it('the composer is the bottom command surface of the conversation, with real attachment controls', () => {
    const log = page.indexOf('id="master-chat-log"');
    const form = page.indexOf('id="master-form"');
    const goal = page.indexOf('id="master-goal"');
    assert.ok(log < form && form < goal, 'log → composer → goal field order');
    const composer = page.slice(form, page.indexOf('id="screen-task"'));
    assert.ok(composer.includes('htmlFor="master-attachment-input"'), 'the composer attaches real files');
    assert.ok(composer.includes('id="master-open-files"'), 'the composer opens the Files/artifacts panel');
    assert.ok(composer.includes('id="master-plan-btn"'), 'the composer submits the real plan & run action');
    assert.match(appJs, /#master-goal'\)\?\.addEventListener\('keydown'/, 'Enter sends, Shift+Enter adds a line');
  });

  it('the AKBARAL! identity heads the sidebar and the conversation rail', () => {
    const brand = page.indexOf('brand-mark ak-brand-mark');
    const sideHead = page.indexOf('ak-side-head');
    // Scoped to the sidebar: the tagline is brand identity and legitimately
    // appears on the pre-login surface too, which must not satisfy this check.
    const tagline = page.indexOf('One Intelligence. Every Solution.', sideHead);
    const chatBrand = page.indexOf('brand-mark chat-brand');
    const log = page.indexOf('id="master-chat-log"');
    const composer = page.indexOf('id="master-form"');
    assert.ok(brand > 0 && tagline > brand, 'the wordmark + tagline head the sidebar');
    assert.ok(chatBrand > 0 && chatBrand < log && log < composer, 'the conversation rail keeps brand → log → composer order');
  });

  it('panes switch on narrow viewports and the sidebar becomes a drawer (never a squashed desktop)', () => {
    assert.match(page, /id="master-pane-workspace"[\s\S]{0,220}?id="master-pane-chat"/, 'pane tabs mounted on the top bar');
    assert.match(page, /data-pane="workspace"/, 'the layout ships a default pane');
    assert.match(appJs, /function masterPaneSet\(name\)/, 'the pane switch is wired in the client');
    assert.match(appJs, /data-pane-tab/, 'tab clicks drive the pane');
    assert.match(page, /id="master-menu-btn"/, 'the phone navigation trigger is mounted');
    assert.match(css, /\.ak-app\[data-sidebar="drawer"\] \.ak-sidebar\s*\{\s*transform:\s*none;/, 'the drawer opens over the app on phones');
    assert.match(css, /@media \(max-width: 1080px\)\s*\{[\s\S]*?\.master-pane-switch\s*\{\s*display:\s*flex;/, 'the pane switch appears at 1080px');
    assert.match(appJs, /function shellSidebarSet\(mode\)/, 'the drawer/collapse state is real client state');
  });

  it('the workspace is a real route (`/workspace`), not only a hash screen', () => {
    const route = readFileSync(join(root, 'src', 'app', 'workspace', 'page.tsx'), 'utf8');
    assert.match(route, /export default function WorkspacePage\(\)/, 'the route has a component');
    assert.match(route, /<Home \/>/, 'it renders the same application as `/` (one shell, one behaviour)');
    assert.match(route, /robots: \{ index: false, follow: false \}/, 'a signed-in surface is never indexed');
    assert.match(appJs, /path === '\/workspace' \? 'master' : ''/, 'the client opens MASTER on the workspace path');
    assert.match(appJs, /const wantsMarketing = hash === '#\/' \|\| hash === '#\/landing'/, 'only an explicit hash asks for the marketing page');
    const entry = appJs.slice(appJs.indexOf("if (view === '') {"), appJs.indexOf('const taskMatch'));
    assert.ok(entry.length > 0, 'the clean-entry branch is present');
    assert.match(entry, /state\.accessToken/, 'a clean entry resolves the stored session first');
    assert.match(entry, /location\.hash = '#\/login';/, 'a clean entry with no live session opens the sign-in card');
    assert.ok(!/showScreen\('landing'\)/.test(entry), 'the marketing page is never the fallback for an app entry');
  });

  it('every workspace control is bound to a real API — no fake export, no tokenless auth links', () => {
    // Auth'd endpoints reject plain hrefs (no token in a query string), so a
    // static link would be a fake control: exports must be auth-fetched.
    assert.ok(!/href="\/api\/(projects|files)/.test(appJs), 'no plain href to an auth-protected API path');
    assert.match(appJs, /async function authedDownload\(/, 'auth-fetched downloads exist');
    assert.match(appJs, /#artifact-export'\)\?\.addEventListener\('click', \(\) => authedDownload\(/, 'artifact export downloads the real bytes');
    assert.match(appJs, /#artifact-open'\)\?\.addEventListener\('click', \(\) => void openArtifactBlob\(/, 'artifact open fetches the real version');
    assert.match(appJs, /async function openArtifactBlob\(projectId, version\)/, 'open helper exists');
    assert.match(appJs, /artifacts\/website\/v\/\$\{encodeURIComponent\(String\(version\)\)\}/, 'open uses the versioned artifact endpoint');
  });

  it('the live preview keeps the artifact isolated from the app on both platforms', () => {
    assert.match(appJs, /sandbox="allow-scripts"/, 'web preview iframe is sandboxed to scripts');
    assert.ok(!appJs.includes('allow-same-origin'), 'the artifact can never become same-origin with the app');
    assert.match(appJs, /\.srcdoc/, 'web preview renders through srcdoc (no external embedding)');
    assert.match(mobile, /originWhitelist=\{\['about:blank', 'data:\*'\]\}/, 'Android preview only allows about:blank/data origins');
    assert.match(mobile, /onShouldStartLoadWithRequest/, 'Android preview gates navigation');
  });

  it('the workspace surfaces share one asset version so a redesign is never stale', () => {
    const versions = [...shell.matchAll(/\/?(?:tokens\.css|styles\.css|app\.js)\?v=([\w.-]+)/g)].map((m) => m[1]);
    assert.ok(versions.length >= 3, 'the shell versions the workspace assets');
    assert.equal(new Set(versions).size, 1, `all assets share one cache-busting version (${versions.join(', ')})`);
  });
});

/* ------------------------------------------------ 2. BEHAVIOUR (real app.js) */

describe('Arena-style workspace — client behaviour (real app.js functions)', () => {
  it('chatAppend posts a real turn above the live activity stream and binds actions', () => {
    const dom = buildDom();
    const api = loadWorkspace(dom);
    let pressed = 0;
    const el = api.chatAppend({
      kind: 'user',
      who: 'You',
      html: '<p>Build me a website</p>',
      meta: [{ label: 'project', tone: 'blue' }],
      actions: [{ label: 'Open in canvas', onClick: () => { pressed += 1; } }],
    });
    assert.ok(el, 'the turn element is created');
    assert.match(el.className, /chat-msg user/, 'the turn carries its role class');
    assert.match(el.innerHTML, /Build me a website/, 'the real content is rendered');
    assert.match(el.innerHTML, /project/, 'meta chips render');
    const order = dom.nodes['master-chat-log'].children;
    assert.equal(order[order.length - 1].id, 'master-output', 'the activity stream stays the last element of the rail');
    const button = el.querySelector('[data-chat-action="0"]');
    button.click();
    assert.equal(pressed, 1, 'the action handler is bound to the real control');
  });

  it('renderMasterResult drives the canvas AND the chat from the same real payload', () => {
    const dom = buildDom();
    const api = loadWorkspace(dom);
    api.renderMasterResult(true, {
      executiveSummary: 'Aurora Coffee landing page is ready.',
      sections: [{ stepOrder: 1, specialization: 'Web Development / Strategic Architect', status: 'completed', content: '## Hero\n\nFull-bleed hero with subscription CTA.' }],
    });
    const canvas = dom.nodes['master-result'];
    assert.equal(canvas.hidden, false, 'the canvas is revealed');
    assert.match(canvas.innerHTML, /Aurora Coffee landing page is ready\./, 'the canvas renders the real executive summary');
    assert.match(canvas.innerHTML, /Full-bleed hero with subscription CTA\./, 'the canvas renders the real section content');
    assert.equal(dom.nodes['master-preview-empty'].hidden, true, 'the empty state yields to the deliverable');
    assert.equal(dom.nodes['master-canvas-state'].textContent, 'report', 'the canvas state chip reflects the payload shape');
    const turns = dom.nodes['master-chat-log'].children.filter((node) => /chat-msg/.test(node.className));
    assert.equal(turns.length, 1, 'exactly one chat turn is posted for the run');
    assert.match(turns[0].innerHTML, /Aurora Coffee landing page is ready\./, 'the chat turn carries the same real answer');
  });

  it('a finished website run offers a real export action derived from the deliverable', () => {
    const dom = buildDom();
    const api = loadWorkspace(dom);
    const html = '<!doctype html><html><body><h1>Aurora</h1></body></html>';
    assert.equal(api.extractHtmlDeliverable({ sections: [{ status: 'completed', content: html }] }), html, 'the HTML deliverable is located');
    const turn = api.outcomeChatTurn(true, { sections: [{ status: 'completed', content: html }] });
    assert.equal(turn.meta[0].label, 'website', 'the turn is labelled by the real deliverable shape');
    assert.ok(turn.actions.some((action: { label: string }) => action.label === 'Export .html'), 'export action is offered');
    assert.ok(!turn.actions.some((action: { label: string }) => /share|publish/i.test(action.label)), 'no invented integrations');
  });

  it('failures keep honest copy in the chat — completion is never faked', () => {
    const dom = buildDom();
    const api = loadWorkspace(dom);
    const turn = api.outcomeChatTurn(false, { code: 'provider_not_configured', message: 'no provider available' });
    assert.match(turn.html, /No AI provider configured/, 'the friendly honest title is used');
    assert.ok(!/Completed/.test(turn.html), 'a failure never claims completion');
    assert.equal(turn.kind, 'master err', 'the turn is styled as a failure');
    api.renderMasterResult(false, { code: 'verification_failed', message: 'verification_failed: substance' });
    assert.match(dom.nodes['master-result'].innerHTML, /rejected by verification/, 'the canvas states the honest reason');
    assert.equal(dom.nodes['master-canvas-state'].textContent, 'failed', 'the canvas state chip reports the failure');
  });

  it('clearMasterResult restores the honest empty canvas (no stale deliverable)', () => {
    const dom = buildDom();
    const api = loadWorkspace(dom);
    api.renderMasterResult(true, { content: 'previous run output' });
    api.clearMasterResult();
    assert.equal(dom.nodes['master-result'].hidden, true, 'the canvas is cleared');
    assert.equal(dom.nodes['master-result'].innerHTML, '', 'no stale content remains');
    assert.equal(dom.nodes['master-preview-empty'].hidden, false, 'the empty state returns');
    assert.equal(dom.nodes['master-canvas-state'].textContent, 'idle', 'the canvas returns to idle');
  });

  it('masterPaneSet switches panes and reports selection accessibly', () => {
    const dom = buildDom();
    const api = loadWorkspace(dom);
    const tabs = (dom.nodes as unknown as Record<string, unknown>).__tabs as FakeNode[];
    api.masterPaneSet('chat');
    assert.equal(dom.nodes['master-layout'].dataset.pane, 'chat', 'the layout reports the chat pane');
    assert.equal(tabs.find((tab) => tab.dataset.paneTab === 'chat')?.getAttribute('aria-selected'), 'true', 'the chat tab is selected');
    assert.equal(tabs.find((tab) => tab.dataset.paneTab === 'workspace')?.getAttribute('aria-selected'), 'false', 'the workspace tab is deselected');
    api.masterPaneSet('workspace');
    assert.equal(dom.nodes['master-layout'].dataset.pane, 'workspace', 'switching back works');
    api.masterPaneSet('nonsense');
    assert.equal(dom.nodes['master-layout'].dataset.pane, 'workspace', 'unknown panes fall back to the workspace');
  });
});

/* ------------------------------------------------------------ 3. ANDROID */

describe('Arena-style workspace — Android parity', () => {
  it('the mobile MASTER screen implements the same two-pane model', () => {
    assert.match(mobile, /type Pane = 'workspace' \| 'chat'/, 'the same two panes exist');
    assert.match(mobile, /PANE_BREAKPOINT = 900/, 'a documented breakpoint decides split vs switch');
    assert.match(mobile, /const wide = width >= PANE_BREAKPOINT/, 'wide viewports show both panes');
    assert.match(mobile, /pane === 'workspace' \? workspacePane : chatPane/, 'narrow viewports switch panes');
    assert.match(mobile, /'MASTER chat'/, 'the chat pane is labelled like the web rail');
  });

  it('the export control renders ABOVE the preview canvas, which renders ABOVE the file area', () => {
    const exportBar = mobile.indexOf('styles.exportBar');
    const canvas = mobile.indexOf('styles.canvas}');
    const files = mobile.indexOf('styles.filesPanel');
    assert.ok(exportBar > 0 && canvas > exportBar, 'export bar precedes the canvas');
    assert.ok(files > canvas, 'the file area follows the canvas in the workspace pane');
    assert.match(mobile, /EXPORT CONTROL — ABOVE THE PREVIEW/, 'the spatial rule is documented in place');
    assert.match(mobile, /THE LIVE PREVIEW CANVAS/, 'the canvas is an explicit region');
    assert.match(mobile, /THE PROJECT \/ BOOK \/ FILE AREA/, 'the file area is an explicit region');
  });

  it('the brand header tops the screen — AKBARAL! identity, then the chat', () => {
    assert.match(mobile, /<Text style=\{styles.wordmark\}>AKBARAL!<\/Text>/, 'the wordmark is the mobile rail header');
    assert.match(mobile, /styles.brandMark/, 'the A! mark leads the header');
    const header = mobile.indexOf('BRAND HEADER');
    const panes = mobile.indexOf('PANE SWITCH');
    assert.ok(header > 0 && panes > header, 'the brand header comes before the pane switch');
  });

  it('the mobile workspace uses the shared design system (no parallel palette)', () => {
    assert.match(mobile, /import \{ glass, palette, radius, shadow, spacing, statusColor, type as typeScale \} from '\.\.\/theme'/, 'tokens come from the shared theme');
    assert.match(mobile, /from '\.\.\/components\/ui'/, 'shared UI primitives are used');
    assert.ok(!/const palette\s*=/.test(mobile), 'no local palette copy');
    assert.ok(!/#9790f2|#7378e8|#8fc7de/.test(mobile), 'identity colours are referenced by token, never re-typed as literals');
  });

  it('the mobile chat drives the real orchestration APIs and reports honestly', () => {
    assert.match(mobile, /api\.post\('\/api\/workflows\/master'/, 'MASTER planning endpoint');
    assert.match(mobile, /api\.post\(`\/api\/workflows\/\$\{encodeURIComponent\(workflowId\)\}\/run`/, 'workflow run endpoint');
    assert.match(mobile, /api\.get\(`\/api\/workflows\/\$\{encodeURIComponent\(workflowId\)\}`\)/, 'live workflow status polling');
    assert.match(mobile, /api\.get\(`\/api\/projects\/\$\{encodeURIComponent\(id\)\}\/artifacts\/website`\)/, 'real project website artifact');
    assert.match(mobile, /The workflow completed successfully, but no result content was attached to it\./, 'honest no-content statement');
    assert.match(mobile, /reason is honest|refunded|failed honestly/i, 'failures state the refund policy');
  });

  it('the project vault opens a project in the workspace pane (one workspace, reachable everywhere)', () => {
    const vault = readFileSync(join(root, 'mobile', 'src', 'screens', 'WorkspaceScreen.tsx'), 'utf8');
    const app = readFileSync(join(root, 'mobile', 'App.tsx'), 'utf8');
    assert.match(vault, /navigation\.navigate\('MASTER', \{ projectId: item\.id \}\)/, 'the vault opens the MASTER workspace for a project');
    assert.match(mobile, /\(route\.params as \{ projectId\?: string \} \| undefined\)\?\.projectId/, 'the workspace consumes the requested project');
    assert.match(mobile, /setPane\('workspace'\)/, 'opening a project lands on the workspace pane');
    assert.match(app, /MASTER: 'master\/:projectId\?'/, 'deep links can address a project workspace directly');
  });

  it('the mobile preview renders real content types, never a fabricated preview', () => {
    assert.match(mobile, /import \{ WebView \} from 'react-native-webview'/, 'HTML renders in a real WebView');
    assert.match(mobile, /source=\{\{ html: String\(artifact\.content\) \}\}/, 'the deliverable HTML is rendered as-is');
    assert.match(mobile, /<Image[\s\S]{0,220}?headers: token \? \{ authorization: `Bearer \$\{token\}` \} : \{\}/, 'images are auth-fetched from the real file endpoint');
    assert.match(mobile, /no result content to render|has no text content to render/i, 'empty documents are stated honestly');
  });
});
