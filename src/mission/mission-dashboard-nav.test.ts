import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const { JSDOM } = require('jsdom');

/**
 * The owner console's navigation contract.
 *
 * 19 top-level tabs became 6, but this is a presentation change only, so these
 * tests pin the parts that must NOT move: every view id, its panel, its
 * reachability, its deep link, its active state, and the access checks that
 * still gate each view. The ids below are copied from the nav as it was before
 * the consolidation, which is what makes "nothing was deleted" a checked
 * claim rather than a promise.
 */
const VIEW_IDS = ['overview', 'agents', 'bounties', 'knowledge', 'playbooks', 'lessons', 'approvals', 'earnings', 'resources-expiry', 'guide', 'head-chat', 'customer-work', 'money', 'treasury', 'withdraw', 'publishing', 'tools', 'policy', 'audit'] as const;
/** Views whose buttons are gated: they need an owner session (or a mutable one). */
const OWNER_ONLY_VIEWS = ['bounties', 'knowledge', 'playbooks', 'lessons'];
const HEAD_AGENT_VIEWS = ['earnings', 'resources-expiry', 'guide', 'head-chat'];
/** Route strings referenced by scripts/verify-mission-dashboard.mjs,
 *  scripts/verify-mission-login.mjs and scripts/mission-browser-check.ts. */
const PINNED_ROUTES = ['agents', 'treasury', 'policy', 'audit', 'money', 'tools'];

const htmlPath = path.resolve('mission-dashboard/index.html');
const appPath = path.resolve('mission-dashboard/app.js');
const cssPath = path.resolve('mission-dashboard/styles.css');

function consoleFixture(options: { hash?: string; signedIn?: 'owner' | 'muting-link' | 'link' | 'none' } = {}) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  // The same hook the sibling render test uses: keep the real client, drive it
  // by hand instead of letting DOMContentLoaded boot it.
  const source = fs.readFileSync(appPath, 'utf8').replace("document.addEventListener('DOMContentLoaded', boot);", '');
  const dom = new JSDOM(html, {
    url: `https://mission.example.test/${options.hash ?? ''}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const requests: Array<{ url: string; method: string; hasAuthorization: boolean }> = [];
  const responses: Record<string, unknown> = {
    '/api/overview': { cards: [], currency: 'USD' },
    '/api/session/me': { owner: { id: 'own_1', email: 'owner@example.test', role: 'owner' } },
  };
  dom.window.fetch = async (url: string, init: RequestInit = {}) => {
    requests.push({ url: String(url), method: String(init.method ?? 'GET'), hasAuthorization: Boolean(new Headers(init.headers ?? {}).get('authorization')) });
    return new Response(JSON.stringify(responses[String(url)] ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  dom.window.eval(`${source}
window.nav = { boot, wire, state, activateTab, applyTabChrome, routeFromHash, groupOfView, gateHidesNavEntry, PRIMARY_TABS, TAB_GROUPS, TAB_PARENT, TAB_VIEWS, TAB_COVIEW, TAB_ROUTE_ALIASES };`);
  const nav = dom.window.nav as NavInternals;
  const mode = options.signedIn ?? 'owner';
  if (mode === 'owner') nav.state.owner = { id: 'own_1', email: 'owner@example.test', role: 'owner' };
  if (mode !== 'none') nav.state.token = 'synthetic-console-session';
  if (mode === 'link' || mode === 'muting-link') { nav.state.token = ''; nav.state.link = 'synthetic-read-only-link'; }
  nav.wire();
  // Every write to the banner is recorded, so the gate's explanation can be
  // asserted even when a data loader later overwrites it — the loaders here run
  // against thin stub payloads, and this test is about navigation, not about
  // how complete the fixture's API shapes are.
  const bannerWrites: string[] = [];
  const bannerNode = dom.window.document.querySelector('#banner');
  const textContent = (Object.getOwnPropertyDescriptor(dom.window.Node.prototype, 'textContent')
    ?? Object.getOwnPropertyDescriptor(dom.window.Element.prototype, 'textContent')) as PropertyDescriptor;
  assert.ok(textContent?.set && textContent.get, 'the fixture needs a writable textContent to spy on the banner');
  Object.defineProperty(bannerNode, 'textContent', {
    configurable: true,
    get: () => textContent.get?.call(bannerNode),
    set: (value: unknown) => { bannerWrites.push(String(value)); textContent.set?.call(bannerNode, value); },
  });
  const win = dom.window as Window;
  const api = {
    dom,
    win,
    nav,
    requests,
    document: dom.window.document as Document,
    visiblePanels: () => [...dom.window.document.querySelectorAll('[data-panel]')].filter((panel: Element) => !(panel as HTMLElement).hidden).map((panel: Element) => panel.getAttribute('data-panel')),
    activeButtons: (scope = '#tabs .tab') => [...dom.window.document.querySelectorAll(scope)].filter((button: Element) => button.classList.contains('active')).map((button: Element) => button.getAttribute('data-tab')),
    primaryButtons: () => [...dom.window.document.querySelectorAll('#tabs > button.tab')].map((button: Element) => button.getAttribute('data-tab')),
    buttonFor: (view: string) => dom.window.document.querySelector(`#tabs [data-tab="${view}"]`) as HTMLElement | null,
    hash: () => String(dom.window.location.hash),
    bannerText: () => String(dom.window.document.querySelector('#banner')?.textContent ?? ''),
    bannerWrites: () => [...bannerWrites],
    async click(view: string) {
      const button = api.buttonFor(view);
      assert.ok(button, `the nav must still offer a button for ${view}`);
      button.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      await settle();
    },
    async go(hash: string) {
      dom.window.location.hash = hash;
      await settle();
    },
    async back() {
      dom.window.history.back();
      await settle();
    },
    async forward() {
      dom.window.history.forward();
      await settle();
    },
    close() { dom.window.close(); },
  };
  return api;
}

interface NavInternals {
  state: { token: string; link: string; owner: unknown; activeTab: string };
  boot: () => Promise<void>;
  wire: () => void;
  activateTab: (view: string, options?: { navigate?: boolean }) => Promise<void>;
  applyTabChrome: (view: string) => void;
  routeFromHash: (hash: string) => string | null;
  groupOfView: (view: string) => string | null;
  gateHidesNavEntry: (button: Element) => boolean;
  PRIMARY_TABS: string[];
  TAB_GROUPS: Record<string, string[]>;
  TAB_PARENT: Record<string, string>;
  TAB_VIEWS: string[];
  TAB_COVIEW: Record<string, string[]>;
  TAB_ROUTE_ALIASES: Record<string, string>;
}

/** jsdom renders and the client's awaited fetches resolve on the macrotask
 * queue, so poll for the state the change should have produced. */
async function settle(ticks = 40): Promise<void> {
  for (let index = 0; index < ticks; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}
async function waitFor(condition: () => boolean, label: string, ticks = 200): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(`timed out waiting for ${label}`);
}

it('every view that was reachable from the old 19-tab nav is still reachable, at its own route', async () => {
  const fixture = consoleFixture();
  try {
    for (const view of VIEW_IDS) {
      await fixture.nav.activateTab(view);
      assert.equal(fixture.nav.state.activeTab, view, `${view} must be the active view`);
      assert.ok(fixture.visiblePanels().includes(view), `${view}'s panel must be on screen`);
      assert.ok(fixture.buttonFor(view), `${view} must still have a nav button`);
    }
    // No view was silently dropped or renamed by the consolidation.
    assert.deepEqual([...fixture.nav.TAB_VIEWS].sort(), [...VIEW_IDS].sort(), 'the nav map must cover exactly the original view ids');
    assert.equal(new Set(fixture.nav.TAB_VIEWS).size, VIEW_IDS.length, 'no duplicate view id');
    for (const view of VIEW_IDS) assert.ok(fixture.document.querySelector(`[data-panel="${view}"]`), `${view} panel section must still exist`);
  } finally { fixture.close(); }
});

it('consolidation is a pure re-parenting: each hidden view has exactly one family', () => {
  const fixture = consoleFixture();
  try {
    const children = Object.values(fixture.nav.TAB_GROUPS).flat();
    assert.equal(new Set(children).size, children.length, 'a view must not be filed under two families');
    const primaries = fixture.nav.PRIMARY_TABS;
    assert.deepEqual([...new Set(children)].sort(), [...VIEW_IDS].filter((view) => !primaries.includes(view)).sort(), 'every non-primary view must have a family');
    for (const [family, views] of Object.entries(fixture.nav.TAB_GROUPS)) {
      assert.ok(fixture.nav.PRIMARY_TABS.includes(family), `${family} must itself be a primary item`);
      for (const view of views) assert.equal(fixture.nav.TAB_PARENT[view], family, `${view} belongs to ${family}`);
    }
    // Each family's row is real markup inside #tabs, not a menu that must be
    // opened first: the buttons exist in the document for every view.
    assert.equal(fixture.document.querySelectorAll('#tabs .subtab').length, children.length);
  } finally { fixture.close(); }
});

it('the primary row holds at most six items and keeps Approvals and Earnings in it', () => {
  const fixture = consoleFixture();
  try {
    const primaries = fixture.primaryButtons();
    assert.ok(primaries.length <= 6, `at most 6 primary items, got ${primaries.length}: ${primaries.join(', ')}`);
    assert.deepEqual([...primaries].sort(), ['agents', 'approvals', 'bounties', 'earnings', 'overview', 'policy']);
    assert.ok(primaries.includes('approvals'), 'the human-in-the-loop gate stays top level');
    assert.ok(primaries.includes('earnings'));
    // Approvals and Audit are not diluted by sub-sections hanging off them.
    // (Length checks, not deepEqual: these arrays come from the jsdom realm.)
    assert.equal((fixture.nav.TAB_GROUPS.approvals ?? []).length, 0, 'Approvals stays a bare top-level gate');
    assert.ok(fixture.nav.TAB_GROUPS.policy.includes('audit'));
    // The standalone verifier scripts' nav floors still hold: they read
    // "#tabs button" (>=6) and "#tabs .tab" labels (>=7).
    assert.ok(fixture.document.querySelectorAll('#tabs button').length >= 6);
    assert.ok(fixture.document.querySelectorAll('#tabs .tab').length >= 7);
  } finally { fixture.close(); }
});

it('audit stays prominent: one click on the primary row puts the audit trail on screen', async () => {
  const fixture = consoleFixture();
  try {
    await nav(fixture, 'overview');
    assert.ok(!fixture.visiblePanels().includes('audit'), 'audit is not on screen before the click');
    await fixture.click('policy');
    const shown = fixture.visiblePanels();
    assert.ok(shown.includes('audit'), `policy and audit share one screen, got ${shown.join(',')}`);
    assert.ok(shown.includes('policy'), 'the policy view is still shown beside it');
    assert.ok(fixture.requests.some((request) => request.url.includes('/api/audit')), 'the audit loader must actually run');
    assert.ok(fixture.activeButtons().includes('audit'), 'audit shows as active, because it is visibly on screen');
    // Reachable in ONE click from the primary row — not nested under a details
    // element, a dropdown or a hover menu.
    const auditButton = fixture.buttonFor('audit');
    assert.ok(auditButton);
    assert.equal(auditButton.parentElement?.id, 'subtabs');
    assert.equal(auditButton.closest('details'), null, 'audit must not be buried in a disclosure widget');
    assert.ok(auditButton.textContent && /audit/i.test(auditButton.textContent), 'the label must still say audit');
  } finally { fixture.close(); }
});

async function nav(fixture: ReturnType<typeof consoleFixture>, view: string) {
  await fixture.nav.activateTab(view);
  await settle();
}

it('every consolidated view is one click from its family row, with no scroll hunting', async () => {
  const fixture = consoleFixture();
  try {
    for (const [family, children] of Object.entries(fixture.nav.TAB_GROUPS)) {
      for (const view of children) {
        await nav(fixture, 'overview');
        await fixture.click(family);
        const button = fixture.buttonFor(view);
        assert.ok(button, `${view} must be offered under ${family}`);
        assert.equal(button.hidden, false, `${view} must be visible in ${family}'s row`);
        await fixture.click(view);
        assert.ok(fixture.visiblePanels().includes(view), `clicking ${view} opens its panel`);
      }
    }
    // Families with nothing to show render no empty row.
    await nav(fixture, 'approvals');
    assert.equal((fixture.document.querySelector('#subtabs') as HTMLElement).hidden, true, 'Approvals has no sub-sections, so no row is shown');
  } finally { fixture.close(); }
});

it('pinned routes land on the right view, including the ones scripts and links depend on', async () => {
  const expectedPanel: Record<string, string> = { agents: 'agents', treasury: 'treasury', policy: 'policy', audit: 'audit', money: 'money', tools: 'tools' };
  for (const route of PINNED_ROUTES) {
    const fixture = consoleFixture({ hash: `#/${route}` });
    try {
      await fixture.nav.boot();
      await settle();
      assert.equal(fixture.hash(), `#/${route}`, `the pinned route must survive load unchanged, saw ${fixture.hash()}`);
      assert.equal(fixture.nav.state.activeTab, route, `${route} must be the loaded view`);
      assert.ok(fixture.visiblePanels().includes(expectedPanel[route]), `${route} must open ${expectedPanel[route]}'s panel`);
      if (route === 'policy' || route === 'audit') assert.ok(fixture.visiblePanels().includes('audit') && fixture.visiblePanels().includes('policy'), 'the policy/audit pair stays co-visible from either route');
      // Deep-linking a consolidated view must not fire a login or a write.
      assert.deepEqual(fixture.requests.filter((request) => request.method !== 'GET'), [], 'a deep link performs no mutation');
    } finally { fixture.close(); }
  }
});

it('old and label-derived routes redirect to the canonical route instead of falling back', async () => {
  const redirects: Array<[string, string]> = [
    ['#verified-cash', '#/money'],
    ['#legacy-accounting', '#/treasury'],
    ['#accounting', '#/treasury'],
    ['#withdrawal', '#/withdraw'],
    ['#audit-trail', '#/audit'],
    ['#withdraw', '#/withdraw'],
    ['#chat', '#/head-chat'],
    ['#customers', '#/customer-work'],
    ['#bug-bounty', '#/bounties'],
  ];
  for (const [from, to] of redirects) {
    const fixture = consoleFixture({ hash: from });
    try {
      await fixture.nav.boot();
      await settle();
      assert.equal(fixture.hash(), to, `${from} must redirect to ${to}`);
      const view = to.replace('#/', '');
      assert.equal(fixture.nav.state.activeTab, view, `${from} must land on ${view}`);
    } finally { fixture.close(); }
  }
  // An unknown fragment is ignored, not routed: the default view stays put.
  const unknown = consoleFixture({ hash: '#/definitely-not-a-view' });
  try {
    await unknown.nav.boot();
    await settle();
    assert.equal(unknown.nav.state.activeTab, 'overview', 'an unknown route must not blank the console');
    assert.ok(unknown.visiblePanels().includes('overview'));
  } finally { unknown.close(); }
});

it('active state is correct on direct load, and on back and forward', async () => {
  const fixture = consoleFixture({ hash: '#/treasury' });
  try {
    await fixture.nav.boot();
    await settle();
    assert.deepEqual(fixture.activeButtons('#tabs > .tab'), ['earnings'], 'the Earnings family carries the active state for a consolidated deep link');
    assert.ok(fixture.activeButtons().includes('treasury'));

    // A click writes the route, so the view is shareable and reload-stable.
    await fixture.click('tools');
    assert.equal(fixture.hash(), '#/tools', 'clicking a view writes its route');
    await fixture.click('guide');
    assert.equal(fixture.hash(), '#/guide');

    await fixture.back();
    await waitFor(() => fixture.nav.state.activeTab === 'tools', 'back to #/tools');
    assert.ok(fixture.visiblePanels().includes('tools'), 'back must show tools again');
    assert.ok(fixture.activeButtons().includes('tools'));

    await fixture.forward();
    await waitFor(() => fixture.nav.state.activeTab === 'guide', 'forward to #/guide');
    assert.ok(fixture.visiblePanels().includes('guide'), 'forward must show guide again');

    // Back to the bare URL returns to the pre-routing default rather than
    // leaving a stale view under an empty hash.
    await fixture.back();
    await waitFor(() => fixture.nav.state.activeTab === 'tools', 'back again to #/tools');
    await fixture.go('');
    await waitFor(() => fixture.nav.state.activeTab === 'overview', 'an empty route to fall back to Overview');
  } finally { fixture.close(); }
});

it('hidden views keep their own access rules: a read-only link reaches nothing new', async () => {
  const fixture = consoleFixture({ signedIn: 'link' });
  try {
    for (const view of VIEW_IDS) {
      await fixture.nav.activateTab(view);
      await settle();
    }
    // Navigation is not a credential: a read-only link may still read what it
    // was already allowed to read, but it may not write, and it must not be
    // handed a mission bearer by the nav code.
    const writes = fixture.requests.filter((request) => request.method !== 'GET');
    assert.deepEqual(writes, [], 'navigation alone must never mutate anything');
    assert.ok(fixture.requests.every((request) => !request.hasAuthorization), 'the nav must never attach an authorization header');
    // Gated views fall back to their family with the reason, never to a blank
    // screen and never by silently showing a private panel.
    for (const view of [...OWNER_ONLY_VIEWS, ...HEAD_AGENT_VIEWS]) {
      await fixture.nav.activateTab(view);
      await settle();
      assert.ok(!fixture.visiblePanels().includes(view), `${view} must stay closed for a read-only link`);
      assert.ok(fixture.bannerWrites().some((line) => /needs the mission owner session/.test(line)), `${view} must say why it did not open`);
    }
    // Ungated views do open for a link, which is the pre-existing behaviour.
    await nav(fixture, 'withdraw');
    assert.ok(fixture.visiblePanels().includes('withdraw'), 'a view the link may read still opens');
  } finally { fixture.close(); }
});

it('the gate rules drive visibility from one predicate, for primaries and sub-views alike', () => {
  const owner = consoleFixture({ signedIn: 'owner' });
  const link = consoleFixture({ signedIn: 'link' });
  try {
    for (const view of [...OWNER_ONLY_VIEWS, ...HEAD_AGENT_VIEWS]) {
      assert.equal(owner.nav.gateHidesNavEntry(owner.buttonFor(view) as Element), false, `${view} is available to the owner`);
      assert.equal(link.nav.gateHidesNavEntry(link.buttonFor(view) as Element), true, `${view} is gated for a read-only link`);
    }
    assert.equal(owner.nav.gateHidesNavEntry(owner.buttonFor('audit') as Element), false, 'audit is never gated away for the owner');
    assert.equal(link.nav.gateHidesNavEntry(link.buttonFor('audit') as Element), false, 'audit keeps the same rule it had before: the panel itself is what the server guards');
  } finally { owner.close(); link.close(); }
});

it('navigation never exposes a credential: routes carry ids, not tokens', async () => {
  const fixture = consoleFixture({ hash: '#/audit' });
  try {
    await fixture.nav.boot();
    for (const view of VIEW_IDS) { await nav(fixture, view); }
    const url = fixture.win.location.href;
    assert.ok(!/session|token|synthetic-console-session/.test(url), `the address bar must carry only the view id, got ${url}`);
    const serialized = JSON.stringify(fixture.nav.state);
    for (const fragment of ['za_mission_token', 'Bearer ']) assert.ok(!url.includes(fragment));
    assert.ok(fixture.nav.state.token, 'the session stays in state/sessionStorage, where it was before');
    assert.ok(!serialized.includes('Bearer '), 'nav state must never hold a bearer string');
  } finally { fixture.close(); }
});

it('an access-link fragment still wins over routing, and is still scrubbed from the URL', async () => {
  const fixture = consoleFixture({ hash: '#link=synthetic-read-only-token', signedIn: 'none' });
  try {
    await fixture.nav.boot();
    await settle();
    assert.equal(fixture.hash(), '', 'the link token must be removed from the address bar as before');
    assert.equal(fixture.nav.state.link, 'synthetic-read-only-token', 'and still read into state');
    assert.equal(fixture.nav.state.activeTab, 'overview', 'a link opens on the default view');
    assert.ok(fixture.document.querySelector('#login-panel'), 'the login panel is untouched');
  } finally { fixture.close(); }
});

it('narrow viewports: the consolidated row wraps instead of scrolling sideways', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  const navRules = /\.tabs\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
  const subRules = /\.subtabs\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.match(navRules, /display:\s*flex/, 'the primary row is a flex row');
  assert.match(navRules, /flex-wrap:\s*wrap/, 'six primaries must wrap at narrow widths instead of scrolling');
  assert.match(subRules, /flex-wrap:\s*wrap/, 'the family row must wrap too');
  assert.match(subRules, /width:\s*100%/, 'the family row takes its own line under the primary row');
  assert.match(css, /\.subtabs\[hidden\]\s*\{\s*display:\s*none/, 'a hidden family row must beat display:flex');
  for (const block of [navRules, subRules]) {
    assert.doesNotMatch(block, /overflow-x:\s*(auto|scroll)/, 'the nav must not scroll horizontally');
    assert.doesNotMatch(block, /white-space:\s*nowrap/, 'no-nowrap is what keeps the row inside the viewport');
    assert.doesNotMatch(block, /min-width:\s*\d/, 'a fixed min-width could force an overflow at 320px');
  }
  // The requirement\'s own breakpoint is handled, and it is the one at 768px.
  const narrow = /@media \(max-width: 768px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  assert.match(narrow, /\.tabs/, 'the primary row is retuned at <=768px');
  assert.match(narrow, /\.subtab/, 'the family row is retuned at <=768px');
  // Six short labels: the longest primary label stays comfortably narrow.
  const fixture = consoleFixture();
  try {
    const labels = fixture.primaryButtons().map((view) => (fixture.buttonFor(view as string)?.textContent ?? '').trim());
    assert.ok(labels.every((label) => label.length <= 14), `primary labels must stay short enough to wrap cleanly, got ${labels.join(' / ')}`);
  } finally { fixture.close(); }
});

it('the dashboard markup keeps its exact document references so the gateway rebase still holds', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(refs, ['/app.js', '/manifest.webmanifest', '/styles.css'], 'consolidated nav markup must add no script/stylesheet/anchor reference');
  assert.ok(!/<a\b/.test(html), 'the nav must stay button-driven: an <a href> would escape the serving prefix');
});
