import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const { JSDOM } = require('jsdom');

/**
 * The owner console's navigation contract, after the strip to four sections.
 *
 * What used to be 19 top-level tabs (then 6) is now Overview, Bounty, Approvals and Money. The
 * presentation changed, so these tests changed with it — but the parts that must NOT move are still
 * pinned here, and now pinned *more* tightly:
 *
 *   · exactly four nav items, each with its own panel and route;
 *   · every surviving view still reachable at its own deep link, as a collapsed block in one family;
 *   · deleted views land on Overview instead of 404-ing into a blank panel;
 *   · the access gates still decide visibility, navigation still never writes, and a link/token
 *     never travels in a URL;
 *   · the assets the mission gateway rebases are still exactly the three it knows.
 */
const SECTIONS = ['overview', 'bounties', 'approvals', 'money'] as const;
const SUB_VIEWS: Record<string, readonly string[]> = {
  bounties: ['bounty-registration', 'bounty-scope', 'bounty-catalogs', 'agents', 'specialist-records', 'customer-work', 'customer-intake'],
  approvals: ['policy', 'tools'],
  money: ['earnings', 'treasury', 'withdraw', 'expenses', 'evidence', 'audit'],
};
/** All nineteen views a route can name: four sections plus fifteen collapsed blocks. */
const VIEWS = [...SECTIONS, ...Object.values(SUB_VIEWS).flat()];
/** Views the strip deleted: their routes must fall back to Overview, not to a missing panel. */
const DELETED_VIEWS = ['knowledge', 'playbooks', 'lessons', 'guide', 'head-chat', 'chat', 'resources-expiry', 'publishing', 'billionaire'];
/** The owner-only Bounty section is the one nav entry a read-only session must not see. */
const OWNER_ONLY_SECTIONS = ['bounties'];
/** Routes referenced by scripts/verify-mission-dashboard.mjs, scripts/verify-mission-login.mjs and
 *  scripts/mission-browser-check.ts — a script that cannot land on its view is a false report. */
const PINNED_ROUTES = ['overview', 'bounties', 'approvals', 'money', 'agents', 'treasury', 'policy', 'audit', 'withdraw', 'tools', 'earnings'];

const htmlPath = path.resolve('mission-dashboard/index.html');
const appPath = path.resolve('mission-dashboard/app.js');
const cssPath = path.resolve('mission-dashboard/styles.css');

function consoleFixture(options: { hash?: string; signedIn?: 'owner' | 'link' | 'none' } = {}) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  // The same hook the sibling render test uses: keep the real client, drive it by hand instead of
  // letting DOMContentLoaded boot it.
  const source = fs.readFileSync(appPath, 'utf8').replace("document.addEventListener('DOMContentLoaded', boot);", '');
  const dom = new JSDOM(html, {
    url: `https://mission.example.test/${options.hash ?? ''}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const requests: Array<{ url: string; method: string; hasAuthorization: boolean }> = [];
  const responses: Record<string, unknown> = {
    // Enough of a real overview payload for the overview renderer to run: the shape comes from
    // buildMissionOverview, and a stub that is too thin would measure a thrown render instead.
    '/api/overview': {
      generatedAt: '2026-10-10T05:00:00Z', currency: 'USD',
      agents: { total: 4001, registry: 4000, custom: 1 }, treasury: { currency: 'USD', totals: { totalBalanceCents: 0 }, wallets: [] },
      policy: { maxDepth: 2 }, approvals: { pending: 0 }, upgrades: { requested: 0 }, targets: [],
      revenue: { windows: { lifetimeCents: 0, todayCents: 0, last30DaysCents: 0 }, contractedCents: 0, expectedCents: 0, bySource: [], recent: [] },
      expenses: { paidCents: 0, pendingCents: 0, byCategory: [] }, costs: { monthlyCommittedCents: 0, spendTodayCents: 0, dailyCapCents: 0, byCategory: [] },
      audit: { ok: true, rows: 0 }, integrity: { ledger: { ok: true, rows: 0 } },
      honesty: { realizedRevenueOnly: true, noFabrication: 'verified only', externalActivationPending: [] },
      fleet: { registered: 4001, withPlatform: 7, ready: 0, blocked: 0, needsOwnerAction: 7, earnedCents: 0, settledProofs: 0, nextAction: 'authorize a GitHub credential' },
    },
    '/api/session/me': { owner: { id: 'own_1', email: 'owner@example.test', role: 'owner' } },
  };
  dom.window.fetch = async (url: string, init: RequestInit = {}) => {
    requests.push({ url: String(url), method: String(init.method ?? 'GET'), hasAuthorization: Boolean(new Headers(init.headers ?? {}).get('authorization')) });
    return new Response(JSON.stringify(responses[String(url).split('?')[0]] ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  dom.window.eval(`${source}
window.nav = { boot, wire, state, activateTab, applyTabChrome, routeFromHash, groupOfView, subSection, loadTab, gateHidesNavEntry, viewLabel, applySessionMode, isReadOnlySession, isOwnerSession, PRIMARY_TABS, TAB_GROUPS, TAB_PARENT, TAB_VIEWS, TAB_COVIEW, TAB_ROUTE_ALIASES };`);
  const nav = dom.window.nav as NavInternals;
  const mode = options.signedIn ?? 'owner';
  if (mode === 'owner') nav.state.owner = { id: 'own_1', email: 'owner@example.test', role: 'owner' };
  if (mode !== 'none') nav.state.token = 'synthetic-console-session';
  if (mode === 'link') { nav.state.token = ''; nav.state.link = 'synthetic-read-only-link'; }
  nav.wire();
  const doc = dom.window.document as unknown as Document;
  const api = {
    dom,
    doc,
    nav,
    requests,
    visiblePanels: () => [...doc.querySelectorAll('[data-panel]')].filter(panel => !(panel as HTMLElement).hidden).map(panel => panel.getAttribute('data-panel')),
    openBlocks: (section?: string) => [...doc.querySelectorAll('details.sub')].filter((details: Element) => (details as HTMLDetailsElement).open && (!section || details.closest('[data-panel]')?.getAttribute('data-panel') === section)).map(details => details.getAttribute('data-view')),
    activeButtons: () => [...doc.querySelectorAll('#tabs .tab')].filter(button => button.classList.contains('active')).map(button => button.getAttribute('data-tab')),
    primaryButtons: () => [...doc.querySelectorAll('#tabs > button.tab')].map(button => button.getAttribute('data-tab')),
    hiddenButtons: () => [...doc.querySelectorAll('#tabs [data-tab]')].filter(button => (button as HTMLElement).hidden).map(button => button.getAttribute('data-tab')),
    buttonFor: (view: string) => doc.querySelector(`#tabs [data-tab="${view}"]`) as HTMLElement | null,
    detailsFor: (view: string) => doc.querySelector(`details.sub[data-view="${view}"]`) as HTMLDetailsElement | null,
    hash: () => String(dom.window.location.hash),
    async click(view: string) {
      const button = api.buttonFor(view);
      assert.ok(button, `the nav must still offer a button for ${view}`);
      button.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      await settle();
    },
    /** The route a caller uses for a collapsed block: no button exists for it, so the entry point is
     *  the same one the hashchange handler calls. */
    async open(view: string) {
      await api.nav.activateTab(view);
      await settle();
    },
    async openBlock(view: string) {
      const details = api.detailsFor(view);
      assert.ok(details, `${view} must be a collapsed block`);
      const summary = details.querySelector('summary');
      assert.ok(summary, `${view} needs a summary to click`);
      summary.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      if (!details.open) {
        // A host without summary activation still has to be measured in the state a browser would
        // be in, so the open is applied and the toggle event that drives the load and the route is
        // delivered exactly as the browser would deliver it.
        details.open = true;
        details.dispatchEvent(new dom.window.Event('toggle'));
      }
      await settle();
    },
    async go(hash: string) { dom.window.location.hash = hash; await settle(); },
    async back() { dom.window.history.back(); await settle(); },
    async forward() { dom.window.history.forward(); await settle(); },
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
  subSection: (view: string) => HTMLDetailsElement | null;
  loadTab: (view: string) => Promise<void>;
  applySessionMode: () => void;
  isReadOnlySession: () => boolean;
  isOwnerSession: () => boolean;
  gateHidesNavEntry: (button: Element) => boolean;
  viewLabel: (view: string) => string;
  PRIMARY_TABS: string[];
  TAB_GROUPS: Record<string, string[]>;
  TAB_PARENT: Record<string, string>;
  TAB_VIEWS: string[];
  TAB_COVIEW: Record<string, string[]>;
  TAB_ROUTE_ALIASES: Record<string, string>;
}

/** jsdom renders and the client's awaited fetches resolve on the macrotask queue, so poll for the
 *  state the change should have produced. */
async function settle(ticks = 40): Promise<void> {
  for (let index = 0; index < ticks; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

it('exactly four top-level items, and the config says the same as the markup', async () => {
  assert.deepEqual([...consoleFixture().nav.PRIMARY_TABS], [...SECTIONS], 'PRIMARY_TABS is the nav as rendered');
  const fixture = consoleFixture();
  try {
    assert.deepEqual(fixture.primaryButtons(), [...SECTIONS], 'the rendered row is Overview, Bounty, Approvals, Money');
    assert.deepEqual([...fixture.doc.querySelectorAll('[data-panel]')].map(node => node.getAttribute('data-panel')), [...SECTIONS]);
    assert.deepEqual(Object.keys(fixture.nav.TAB_GROUPS).sort(), ['approvals', 'bounties', 'money'], 'only three sections own collapsed blocks');
    for (const [family, views] of Object.entries(SUB_VIEWS)) {
      assert.deepEqual([...fixture.nav.TAB_GROUPS[family]].sort(), [...views].sort(), `${family}'s group is the DOM's blocks`);
    }
    assert.deepEqual(Object.keys(fixture.nav.TAB_COVIEW), [], 'no view shares a screen with another any more');
    // TAB_VIEWS is the set a route may address: the four sections plus the ten collapsed blocks.
    // Nothing from the old 19-tab surface may survive in it.
    assert.deepEqual([...fixture.nav.TAB_VIEWS].sort(), [...VIEWS].sort(), 'every addressable view, and only those');
  } finally { fixture.close(); }
});

it('every surviving view is reachable at its own route, inside its family', async () => {
  const fixture = consoleFixture();
  try {
    for (const view of VIEWS) {
      assert.equal(fixture.nav.routeFromHash(`#/${view}`), view, `${view} keeps its deep link`);
    }
    for (const [family, views] of Object.entries(SUB_VIEWS)) {
      for (const view of views) {
        assert.equal(fixture.nav.groupOfView(view), family, `${view} resolves to ${family}`);
        await fixture.open(view);
        assert.deepEqual(fixture.activeButtons(), [family], `${view} activates ${family}, not a tab of its own`);
        assert.deepEqual(fixture.visiblePanels(), [family]);
        assert.equal(fixture.detailsFor(view)?.open, true, `${view} opens its block instead of hiding behind it`);
        assert.deepEqual(fixture.openBlocks(family), [view], `only the routed block is open in ${family}`);
        assert.equal(fixture.hash(), `#/${view}`, `${view} keeps its own hash for a reload or a shared link`);
      }
    }
    for (const section of SECTIONS) {
      await fixture.click(section);
      assert.deepEqual(fixture.activeButtons(), [section]);
      assert.deepEqual(fixture.openBlocks(section), [], 'clicking a section by name opens nothing extra');
    }
  } finally { fixture.close(); }
});

it('the routes the verification and browser scripts navigate by still land somewhere real', async () => {
  const fixture = consoleFixture();
  try {
    for (const route of PINNED_ROUTES) {
      await fixture.go(`#/${route}`);
      const family = fixture.nav.groupOfView(route);
      assert.ok(family, `${route} resolves to a section`);
      assert.deepEqual(fixture.visiblePanels(), [family], `${route} shows ${family}, not a blank shell`);
      if (family === route) assert.deepEqual(fixture.openBlocks(family), [], `${route} is a section, so it opens nothing extra`);
      else assert.deepEqual(fixture.openBlocks(family), [route], `${route} opens its own block`);
    }
  } finally { fixture.close(); }
});

it('a deleted view lands on Overview, not on a blank panel', async () => {
  const fixture = consoleFixture();
  try {
    for (const view of DELETED_VIEWS) {
      assert.equal(fixture.nav.routeFromHash(`#/${view}`), null, `${view} is gone: no route claims it`);
      assert.equal(fixture.nav.TAB_VIEWS.includes(view), false, `${view} is not in the view list either`);
      await fixture.go(`#/${view}`);
      assert.equal(fixture.nav.state.activeTab, 'overview', `${view} renders the fallback, not a blank panel`);
      assert.deepEqual(fixture.visiblePanels(), ['overview'], `${view} cannot open a panel that no longer exists`);
      assert.equal(fixture.detailsFor(view), null);
      assert.equal(fixture.buttonFor(view), null);
    }
    assert.equal(fixture.nav.routeFromHash('#/nope'), null, 'an unknown route is not silently rewritten');
    assert.ok(fixture.doc.querySelectorAll('[data-panel]:not([hidden])').length === 1, 'the fallback shows exactly one panel');
  } finally { fixture.close(); }
});

it('a route change moves both the section and the block, and never writes', async () => {
  const fixture = consoleFixture();
  try {
    await fixture.click('approvals');
    await fixture.openBlock('tools');
    assert.equal(fixture.hash(), '#/tools', 'opening a block records it as the view');
    assert.deepEqual(fixture.openBlocks('approvals'), ['tools']);
    await fixture.click('money');
    assert.equal(fixture.hash(), '#/money');
    assert.deepEqual(fixture.openBlocks('approvals'), [], 'the block left behind closed with its section');
    await fixture.openBlock('audit');
    assert.deepEqual(fixture.openBlocks('money'), ['audit']);
    // A click on a section — including the one already on screen — puts it back to its single
    // screen, and leaving a section closes its block so it cannot stack up for the next visit.
    await fixture.click('money');
    assert.deepEqual(fixture.openBlocks('money'), [], 'the section click is the reset');
    assert.equal(fixture.hash(), '#/money', 'and the URL says what is on screen');
    await fixture.openBlock('withdraw');
    await fixture.click('approvals');
    assert.deepEqual(fixture.openBlocks('money'), [], 'the block closes when its section is left');
    // The block route is what a reload or a shared link restores.
    await fixture.go('#/audit');
    assert.deepEqual(fixture.openBlocks('money'), ['audit'], 'the route names the block, so the view comes back");'.replace('");',''));
    const writes = fixture.requests.filter(request => request.method !== 'GET');
    assert.deepEqual(writes, [], 'navigation must never write');
    const pushed = fixture.requests.filter(request => !request.url.startsWith('/api/'));
    assert.deepEqual(pushed, [], 'and never leave the API origin');
  } finally { fixture.close(); }
});

it('the access gates still decide visibility: a read-only link reaches nothing new', async () => {
  const ownerFixture = consoleFixture({ signedIn: 'owner' });
  const linkFixture = consoleFixture({ signedIn: 'link' });
  try {
    for (const view of OWNER_ONLY_SECTIONS) {
      assert.equal(ownerFixture.nav.gateHidesNavEntry(ownerFixture.buttonFor(view)!), false, 'an owner sees Bounty');
      assert.equal(linkFixture.nav.gateHidesNavEntry(linkFixture.buttonFor(view)!), true, 'a read-only link does not');
    }
    await linkFixture.click('bounties');
    assert.notDeepEqual(linkFixture.visiblePanels(), ['bounties'], 'a hidden owner-only section is not opened by a synthetic click either');
    await linkFixture.go('#/bounties');
    assert.notDeepEqual(linkFixture.visiblePanels(), ['bounties'], 'nor by a deep link');
    // Everything the mission lets a scoped link read is still readable: the strip removed panels,
    // not permissions.
    for (const view of ['money', 'policy', 'audit', 'treasury']) {
      await linkFixture.go(`#/${view}`);
      assert.ok(linkFixture.visiblePanels().includes(view === 'money' ? 'money' : (linkFixture.nav.groupOfView(view) ?? '')), `${view} stays reachable for a read-only link`);
    }
    // The read-only label is a session fact and nothing else: applySessionMode() decides it, with no
    // request in the path. It used to be a line at the end of renderOverview, which meant the claim was
    // only ever applied if the Overview happened to render — a slow or failed fleet read left a signed-in
    // owner standing under "Read-only head agent". So the claim is checked straight off the session.
    for (const entry of [ownerFixture, linkFixture]) {
      entry.nav.applySessionMode();
      await settle(4);
    }
    assert.equal(ownerFixture.doc.querySelector('#head-read-only-state')?.hasAttribute('hidden'), true, 'an owner session hides the read-only pill');
    assert.equal(linkFixture.doc.querySelector('#head-read-only-state')?.hasAttribute('hidden'), false, 'a scoped link shows it');
    assert.equal(ownerFixture.nav.isReadOnlySession(), false, 'and the predicate the label follows agrees with the server: a token session can mutate');
    assert.equal(linkFixture.nav.isReadOnlySession(), true, 'while a link session cannot');
    await linkFixture.nav.loadTab('overview');
    await settle(8);
    assert.equal(linkFixture.doc.querySelector('#head-read-only-state')?.hasAttribute('hidden'), false, 'rendering the Overview for a link session changes nothing about the label');
  } finally { ownerFixture.close(); linkFixture.close(); }
});

it('navigation never exposes a credential: routes carry ids, not tokens', async () => {
  const fixture = consoleFixture();
  try {
    for (const view of VIEWS) await fixture.go(`#/${view}`);
    for (const request of fixture.requests) {
      assert.ok(!/token=|link=|zal_|Bearer/.test(`${request.url}${fixture.hash()}`), `${request.url} must not carry a credential`);
      assert.ok(!/[?&](token|link|authorization)=/.test(request.url), 'no credential in a query string');
    }
    assert.ok(fixture.requests.every(request => request.url.startsWith('/api/')), 'the client only ever calls the mission API');
  } finally { fixture.close(); }
});

it('an access-link fragment still wins over routing, and is still scrubbed from the URL', async () => {
  const fixture = consoleFixture({ hash: '#/audit?mission_link=zal_synthetic_link_value', signedIn: 'link' });
  try {
    await Promise.resolve().then(() => fixture.nav.boot());
    await settle();
    assert.equal(fixture.nav.state.link, 'zal_synthetic_link_value', 'the link is taken from the fragment on boot');
    assert.ok(!fixture.hash().includes('zal_synthetic_link_value'), 'and stripped from the address bar afterwards');
    assert.equal(fixture.nav.routeFromHash('#/audit?mission_link=zal_synthetic_link_value'), null, 'a route with a query is not a view, so nothing is half-parsed');
    assert.deepEqual(fixture.visiblePanels(), ['overview'], 'the console opens on its first screen instead of failing');
    assert.equal(fixture.nav.state.token, '', 'a link is never promoted to a session token');
  } finally { fixture.close(); }
});

it('the collapsed blocks and the nav row wrap instead of scrolling sideways', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  const navRules = /\.tabs\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.match(navRules, /display:\s*flex/, 'the primary row is a flex row');
  assert.match(navRules, /flex-wrap:\s*wrap/, 'four primaries must wrap at narrow widths instead of scrolling');
  assert.doesNotMatch(navRules, /overflow-x:\s*(auto|scroll)/, 'the nav must not scroll horizontally');
  assert.doesNotMatch(navRules, /white-space:\s*nowrap/, 'no-nowrap is what keeps the row inside the viewport');
  assert.doesNotMatch(navRules, /min-width:\s*\d/, 'a fixed min-width could force an overflow at 320px');
  // Sub-tab rows are gone, replaced by disclosures; their rules are what a narrow screen needs now.
  assert.ok(!/\.subtabs\b/.test(css), 'the deleted sub-tab row must not leave stylesheet weight behind');
  const blockRules = /details\.sub\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.match(blockRules, /border-radius:/, 'a block reads as one surface');
  assert.match(blockRules, /var\(--panel\)/, 'and uses the existing green-theme tokens, not a new colour');
  const summaryRules = /details\.sub > summary\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.match(summaryRules, /cursor:\s*pointer/, 'the summary is clickable');
  assert.match(summaryRules, /list-style:\s*none/, 'the disclosure marker is drawn from the marker glyph, not the UA triangle');
  assert.match(css, /details\.sub\[hidden\]\s*\{\s*display:\s*none/, 'a gated block must beat the block display');
  assert.match(css, /\.section-head\s*\{[^}]*flex-wrap:\s*wrap/, 'the section head wraps on a phone');
  const fixture = consoleFixture();
  try {
    const labels = fixture.primaryButtons().map(view => (fixture.buttonFor(view as string)?.textContent ?? '').trim());
    assert.ok(labels.every(label => label.length <= 14), `primary labels must stay short enough to wrap cleanly, got ${labels.join(' / ')}`);
    for (const views of Object.values(SUB_VIEWS)) {
      for (const view of views) {
        const summary = fixture.detailsFor(view)?.querySelector('summary')?.textContent?.trim() ?? '';
        assert.ok(summary.length > 3 && summary.length <= 64, `${view} summary stays one line on a phone: "${summary}"`);
        assert.equal(fixture.nav.viewLabel(view), summary, 'the route label shown in the banner is the block summary, not a second copy');
      }
    }
  } finally { fixture.close(); }
});

it('the dashboard markup keeps its exact document references so the gateway rebase still holds', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]).sort();
  assert.deepEqual(refs, ['/app.js', '/manifest.webmanifest', '/styles.css'], 'the stripped nav must add no script/stylesheet/anchor reference');
  assert.ok(!/<a\b/.test(html), 'the nav stays button-driven: an <a href> would escape the serving prefix');
});
