import fs from 'node:fs';
import path from 'node:path';
import { after, it } from 'node:test';
import assert from 'node:assert/strict';
const { JSDOM } = require('jsdom');

/**
 * The owner's Overview, and the one label beside it.
 *
 * This file exists because the deployed console rendered nothing: `#overview-cards` was empty,
 * `#overview-owner-path` was never created, and a signed-in owner was told they were a "Read-only head
 * agent". Both symptoms had one mechanism — the five cards, the activation path AND the read-only label
 * were all decided at the end of a single unprotected render of one fleet-sized response, so anything
 * that stopped that response (or one unreadable field inside it) took the whole panel and the session
 * claim down with it.
 *
 * The pins below are what keeps that from coming back:
 *   · the five cards are rendered from the payload's own values, matched against it field by field;
 *   · a field the payload does not carry renders `MISSING`, never a `0` that looks like a measurement;
 *   · an unreadable block says so on its own line and leaves the rest of the panel standing;
 *   · the read-only label follows the session alone — owner session never shows it, a read-only access
 *     link always does, and a failed Overview leaves no claim behind either way;
 *   · a tab with no session renders no private panel and sends no private request;
 *   · one console load asks for the Overview once.
 *
 * The payload fixture is the shape captured from a live `GET /api/overview` on this commit against a
 * populated mission database (see `realOverviewPayload`); the server-side twin of its key list is pinned
 * in src/mission/mission-overview-read-path.test.ts, so the two cannot drift apart silently.
 */
const files = {
  html: fs.readFileSync(path.resolve('mission-dashboard/index.html'), 'utf8'),
  js: fs.readFileSync(path.resolve('mission-dashboard/app.js'), 'utf8'),
};
const OWNER = { id: 'own_1', email: 'owner@mission.local', displayName: 'Mission owner', role: 'owner', status: 'active' };
/** Every top-level key the mission server puts in `GET /api/overview`, in the order it sends them. */
const OVERVIEW_TOP_LEVEL_KEYS = [
  'generatedAt', 'fleet', 'isolation', 'identityLock', 'policy', 'agents', 'treasury', 'revenue', 'expenses',
  'upgrades', 'payouts', 'approvals', 'costs', 'targets', 'billionaireDaily', 'selfManagement', 'audit',
  'integrity', 'opportunityCatalog', 'honesty',
];

/** The real response's shape, with the row lists shortened to what fits a fixture. */
function realOverviewPayload(): Record<string, unknown> {
  return {
    generatedAt: '2026-10-10T16:41:07.000Z',
    fleet: {
      registered: 4001,
      withPlatform: 7,
      ready: 3,
      blocked: 11,
      needsOwnerAction: 5,
      earnedCents: 2050,
      settledProofs: 1,
      nextAction: 'set the variable in the host secret manager (Railway service variable) and redeploy',
      claimStatus: 'FIXTURE / NOT PRODUCTION',
      activation: {
        claimStatus: 'FIXTURE / NOT PRODUCTION',
        source: 'local mission database',
        allClear: false,
        note: 'Read-only report. Nothing here was executed, paid, or inferred from tests.',
        remaining: [
          {
            code: 'no_platform_credential',
            label: 'GitHub credential',
            how: 'env var',
            target: 'ZA141251SA_GITHUB_TOKEN',
            action: 'set the variable in the host secret manager and redeploy',
            verify: 'npm run mission:fleet:readiness -- --json',
            evidence: '.env.example:268',
          },
          {
            code: 'no_verified_payout_slot',
            label: 'Payout destination',
            how: 'dashboard control',
            target: 'Money → payout slots',
            action: 'verify one slot against the provider',
            verify: 'npm run verify:mission-money',
            evidence: 'src/mission/treasury.ts:1',
          },
        ],
      },
    },
    isolation: {
      database: 'file:/tmp/repro/mission.db',
      platformLedger: 'not read, not written — AKBARAL! customer revenue is a different database and treasury',
      ownerAuth: 'mission-local sessions only',
    },
    identityLock: { enabled: true, configuredEmail: 'owner@mission.local', ownersSuspended: 0, sessionsRevoked: 0, linksRevoked: 0 },
    policy: {
      killSwitch: true,
      autonomousEnabled: false,
      currency: 'USD',
      dailyRevenueTargetCents: 100000,
      allowedActivities: ['bounty_work'],
      prohibitedActivities: ['fraud'],
      prohibitions: [{ key: 'fraud', statement: 'Fraud, misrepresentation or deceptive billing.' }],
    },
    agents: { total: 4001, registry: 4000, custom: 1, active: 4001, paused: 0, maxDepth: 0, largestHierarchy: 0, byCategory: [], byDepth: [] },
    treasury: {
      currency: 'USD',
      wallets: [{ id: 'wal_1', kind: 'agent', agentId: 'agent_1', label: 'First wallet', currency: 'USD', balanceCents: 0, budgetCents: 0, spentCents: 0, status: 'active' }],
      totals: { totalBalanceCents: 0, missionBalanceCents: 0, agentBalancesCents: 0, reserveBalanceCents: 0, realizedRevenueCents: 0 },
      daily: { spentTodayCents: 0, policyDailyCapCents: 10000 },
    },
    revenue: {
      realizedCents: 2050,
      contractedCents: 0,
      expectedCents: 0,
      bySource: [{ source: 'gofrantic', cents: 2050, count: 1 }],
      windows: { todayCents: 0, last7DaysCents: 2050, last30DaysCents: 2050, lifetimeCents: 2050 },
      recent: [{ id: 'rev_1', created_at: '2026-10-09T10:00:00.000Z', status: 'contracted', amount_cents: 900, work_id: 'work_1', external_ref: null }],
    },
    expenses: { paidCents: 0, pendingCents: 0, byCategory: [], recent: [] },
    upgrades: { requested: 0, approved: 0, applied: 0, rejected: 0 },
    payouts: { slots: [], pendingCents: 0, settledCents: 0, recent: [] },
    approvals: { pending: 0, recent: [] },
    costs: { monthlyCommittedCents: 0, spendTodayCents: 0, dailyCapCents: 10000, byCategory: [] },
    targets: [{ id: 'tgt_1', label: 'Verified revenue this month', period: 'month', amountCents: 5000000, actualCents: 2050, progressPct: 0.04 }],
    billionaireDaily: {
      perAgentTargetCents: 100000000000,
      perAgentCurrency: 'USD',
      persistentObjective: 'Maximize legitimate, verified real-world earnings toward $1B/day aspirational target — lawful, sustainable, verifiable only, no guarantees.',
      globalDailyTarget: { configured: true, targetCents: 100000000000, realizedCents: 2050, progressPct: 0, met: false },
      todayPerAgent: [],
      dailyTargets: {
        day: '2026-10-10',
        agents: 4001,
        configured: 4001,
        met: 0,
        persisted: 0,
        basis: 'counted live from stored rows for this UTC day; the read itself writes nothing, so per-agent rows are materialised by the owner sweep command (POST /api/targets/sweep)',
      },
      note: 'Owner-defined aspirational $1B verified revenue per day per agent.',
    },
    selfManagement: { tools: [], credentials: [], resources: [], upgrades: [], services: [], requiresExternalActivation: [] },
    audit: { ok: true, rows: 16011, brokenAtSeq: null, detail: '16011 audit rows verified end to end' },
    integrity: { ledger: { ok: true, rows: 40, brokenAtId: null, detail: '40 ledger rows verified' } },
    opportunityCatalog: { total: 0, verified: 0, pending_review: 0, rejected: 0, expired: 0, archived: 0 },
    honesty: {
      realizedRevenueOnly: true,
      noFabrication: 'Every figure comes from this mission database. Revenue is counted only when it was received and verified.',
      externalActivationPending: [{ provider: 'github', action: 'authorize a credential', why: 'no credential is stored' }],
    },
  };
}

type ConsoleOptions = {
  token?: string | null;
  link?: string | null;
  overview?: unknown;
  overviewStatus?: number;
  overviewBody?: unknown;
};

/**
 * The real bundle, booted the way the gateway boots it: the served `index.html`, `app.js` evaluated as a
 * classic script, an owner session in session storage, and a fetch that answers exactly the endpoints a
 * console load touches. Every thrown error and unhandled rejection is kept, because the failure this file
 * pins was one the page swallowed into a six-second banner.
 */
function bootConsole(options: ConsoleOptions = {}) {
  const overview = options.overview === undefined ? realOverviewPayload() : options.overview;
  const dom = new JSDOM(files.html, { url: 'https://mission.invalid/mission-gateway/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom as unknown as { window: Window & typeof globalThis };
  const storage = window.sessionStorage;
  if (options.token === null) storage.removeItem('za_mission_token');
  else storage.setItem('za_mission_token', options.token ?? 'synthetic-owner-session');
  if (options.link) storage.setItem('za_mission_link', options.link);
  else storage.removeItem('za_mission_link');

  const requests: string[] = [];
  const problems: string[] = [];
  window.addEventListener('error', (event: ErrorEvent) => problems.push(`window.error: ${event.message}\n${event.error?.stack ?? '(no stack)'}`));
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason as Error;
    problems.push(`unhandledrejection: ${reason?.stack ?? String(reason)}`);
  });
  (window as unknown as { fetch: typeof fetch }).fetch = (async (url: string | URL) => {
    const asText = String(url);
    const requestPath = asText.replace(/^.*\/api/, '') || '/';
    requests.push(requestPath);
    if (requestPath === '/overview') {
      if (options.overviewStatus) return new Response(JSON.stringify(options.overviewBody ?? { error: 'mission service is unavailable' }), { status: options.overviewStatus, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify(overview), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (requestPath === '/session/me') {
      return new Response(JSON.stringify({ owner: OWNER, expiresAt: null, vaultConfigured: true, identityLock: { enabled: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  // Everything the page schedules, so the page can be torn down: the console keeps a 30-second
  // notification poller alive once it is signed in and re-arms a six-second banner timer on every message,
  // and those handles live in the jsdom realm — clearing them with the test process's own clearInterval
  // would free nothing, and the run would sit holding the event loop open until the batch timeout. That is
  // exactly how this file failed in CI, so the harness records the ids and clears them in that realm.
  const timers: number[] = [];
  const page = dom.window as unknown as {
    setInterval: (handler: () => void, ms: number) => number;
    clearInterval: (id: number) => void;
    setTimeout: (handler: () => void, ms: number) => number;
    clearTimeout: (id: number) => void;
  };
  const pageSetInterval = page.setInterval;
  const pageSetTimeout = page.setTimeout;
  page.setInterval = (handler: () => void, ms: number) => {
    const id = pageSetInterval(handler, ms);
    timers.push(id);
    return id;
  };
  page.setTimeout = (handler: () => void, ms: number) => {
    const id = pageSetTimeout(handler, ms);
    timers.push(id);
    return id;
  };
  const releasePage = () => {
    if (!openPages.includes(releasePage)) openPages.push(releasePage);
    for (const id of timers) {
      page.clearInterval(id);
      page.clearTimeout(id);
    }
    timers.length = 0;
  };

  const source = files.js.replace("document.addEventListener('DOMContentLoaded', boot);", '');
  (window as unknown as { eval: (code: string) => void }).eval(`${source}\nwindow.ownerOverview = { boot, state, renderOverview, isReadOnlySession };`);
  const api = (window as unknown as { ownerOverview: OwnerOverviewInternals }).ownerOverview;
  const settle = async () => {
    await api.boot();
    for (let index = 0; index < 80; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    releasePage();
  };
  const doc = window.document;
  const read = {
    cards: () => [...doc.querySelectorAll('#overview-cards .card')].map((node) => ({
      label: node.querySelector('.label')?.textContent ?? '',
      value: node.querySelector('.value')?.textContent ?? '',
      note: node.querySelector('.note')?.textContent ?? '',
    })),
    pill: () => doc.querySelector('#head-read-only-state') as HTMLElement | null,
    ownerPath: () => doc.querySelector('#overview-owner-path'),
    unavailable: () => doc.querySelector('#overview-unavailable')?.textContent ?? '',
    identity: () => doc.querySelector('#identity')?.textContent ?? '',
    appHidden: () => (doc.querySelector('#app') as HTMLElement).hidden,
    loginVisible: () => !(doc.querySelector('#login-panel') as HTMLElement).hidden,
    banner: () => ({ hidden: (doc.querySelector('#banner') as HTMLElement).hidden, text: doc.querySelector('#banner')?.textContent ?? '' }),
  };
  return { window, api, requests, problems, settle, releasePage, read, document: doc };
}

interface OwnerOverviewInternals {
  boot: () => Promise<void>;
  state: { token: string; link: string; owner: unknown; loadedTabs?: Set<string> };
  renderOverview: (overview: unknown) => void;
  isReadOnlySession: () => boolean;
}

/**
 * Pages this file left running, so the file can finish even when an assertion threw before that test's
 * own `settle()`. A jsdom console holds a 30-second interval and a six-second banner timeout; the test
 * runner waits for the process to drain rather than killing it, so one leaked handle is a batch timeout in
 * CI and no failure message at all.
 */
const openPages: Array<() => void> = [];

after(() => {
  for (const release of openPages.splice(0)) release();
});

/** The card the owner asked about, by its label. */
function cardOf(cards: Array<{ label: string; value: string; note: string }>, label: string) {
  const found = cards.find((card) => card.label === label);
  assert.ok(found, `the Overview must render a "${label}" card`);
  return found;
}

it('an owner session renders all five Overview cards, and each value is the payload\'s own', async () => {
  const harness = bootConsole();
  await harness.settle();
  const payload = realOverviewPayload() as { fleet: Record<string, number | string> };
  const fleet = payload.fleet;
  const cards = harness.read.cards();
  assert.equal(cards.length, 5, 'exactly five cards: the fleet, its readiness, its blockers, what it earned and what is next');
  assert.deepEqual(cards.map((card) => card.label), ['Fleet', 'Ready to work', 'Blocked', 'Earned', 'Next action']);
  assert.equal(cardOf(cards, 'Fleet').value, String(fleet.registered), 'the fleet count is the payload’s, not a rounded stand-in');
  const registry = (realOverviewPayload().agents as { registry: number }).registry;
  assert.equal(cardOf(cards, 'Fleet').note, `${fleet.withPlatform} paired with a verified venue · ${registry} from the registry`, 'the note carries the payload’s own pairing and registry counts');
  assert.equal(cardOf(cards, 'Ready to work').value, String(fleet.ready));
  assert.equal(cardOf(cards, 'Blocked').value, String(Number(fleet.blocked) + Number(fleet.needsOwnerAction)));
  assert.equal(cardOf(cards, 'Earned').value, '20.50 USD', 'cents are rendered as the stored currency amount');
  assert.equal(cardOf(cards, 'Earned').note, '1 verified settlement proof(s); advertised rewards are never counted');
  assert.equal(cardOf(cards, 'Next action').value, String(fleet.nextAction));
  assert.ok(harness.read.ownerPath(), 'the owner activation path renders beside the cards, because the payload carries the queue');
  assert.deepEqual(harness.problems, [], 'a clean owner render must throw nothing');
});

it('a field the payload does not carry renders MISSING, never a zero that looks like a measurement', async () => {
  const payload = realOverviewPayload();
  const fleet = payload.fleet as Record<string, unknown>;
  delete fleet.withPlatform;
  delete fleet.ready;
  delete fleet.earnedCents;
  delete fleet.needsOwnerAction;
  delete fleet.nextAction;
  const harness = bootConsole({ overview: payload });
  await harness.settle();
  const cards = harness.read.cards();
  assert.equal(cards.length, 5, 'the five cards are still five — an absent field changes what they say, not whether they exist');
  assert.equal(cardOf(cards, 'Ready to work').value, 'MISSING');
  assert.equal(cardOf(cards, 'Earned').value, 'MISSING');
  assert.equal(cardOf(cards, 'Next action').value, 'MISSING');
  assert.equal(cardOf(cards, 'Blocked').value, 'MISSING', 'a sum of two counts is not a sum when only one of them was counted');
  assert.match(cardOf(cards, 'Fleet').note, /MISSING paired with a verified venue/);
  const zeroFilled = cards.filter((card) => /^0(\.0+)?($|\s)/.test(card.value));
  assert.deepEqual(zeroFilled.map((card) => `${card.label}=${card.value}`), [], 'no card may fill an absent field with a zero, and no amount may be shown as 0.00');
  assert.deepEqual(harness.problems, [], 'an absent field is a report, not an exception');
});

it('the markup ships that label hidden, because markup cannot know who is looking', () => {
  const pillMarkup = /<span id="head-read-only-state"[^>]*>/.exec(files.html)?.[0] ?? '';
  assert.ok(pillMarkup, 'the read-only pill is part of the Overview header');
  assert.match(pillMarkup, /\bhidden\b/, 'it has to start hidden: the claim is about the session, and a page whose script never ran must not assert one');
});

it('an owner session does not render the read-only head-agent label', async () => {
  const harness = bootConsole();
  await harness.settle();
  assert.equal(harness.read.pill()?.hidden, true, 'a signed-in owner must never be labelled a read-only head agent');
  assert.equal(harness.read.identity(), 'signed in as owner@mission.local');
});

it('an owner session keeps that label off screen even with an old access link left in this tab', async () => {
  const harness = bootConsole({ link: 'synthetic-stale-link-token' });
  await harness.settle();
  assert.equal(harness.read.pill()?.hidden, true, 'the session can mutate, so the session is not read-only — whatever a leftover link says');
  assert.equal(harness.api.state.link, 'synthetic-stale-link-token', 'the link is still there, and the classification is still correct');
});

it('a read-only access-link session does render the label', async () => {
  const harness = bootConsole({ token: null, link: 'synthetic-read-only-link' });
  await harness.settle();
  assert.equal(harness.read.pill()?.hidden, false, 'an access link genuinely is read-only, and the console has to say so');
  assert.equal(harness.read.identity(), 'read-only access link');
  assert.equal(harness.read.cards().length, 5, 'a link may read the Overview, so the cards are rendered from the payload');
  assert.ok(!harness.requests.includes('/session/me'), 'a link session never asks for the owner identity');
});

it('a tab with no session is refused the private panel and sends no private request', async () => {
  const harness = bootConsole({ token: null });
  await harness.settle();
  assert.equal(harness.read.appHidden(), true, 'the console shell stays hidden without a session');
  assert.equal(harness.read.loginVisible(), true, 'and the sign-in panel is what is offered instead');
  assert.deepEqual(harness.requests, [], 'nothing private is requested at all');
  assert.equal(harness.read.cards().length, 0, 'no Overview data is rendered to an anonymous tab');
  assert.equal(harness.read.ownerPath(), null, 'no activation path either');
});

it('a failed Overview renders the five cards as MISSING with the reason, and leaves no read-only claim behind', async () => {
  const harness = bootConsole({ overviewStatus: 502, overviewBody: { error: 'mission service is unavailable' } });
  await harness.settle();
  const cards = harness.read.cards();
  assert.equal(cards.length, 5, 'the panel reports the gap instead of going blank');
  for (const card of cards) {
    assert.equal(card.value, 'MISSING', `${card.label} must say MISSING when nothing was measured for it`);
  }
  assert.match(harness.read.unavailable(), /HTTP 502/, 'the reason the owner needs is on the panel, not only in a banner that hides itself');
  assert.match(harness.read.unavailable(), /no figure on this panel was filled in by hand/i);
  assert.equal(harness.read.pill()?.hidden, true, 'a data failure may never decide what the session is allowed to do');
  assert.equal(harness.read.banner().hidden, false, 'the banner is still shown, beside the honest panel state');
  assert.equal(harness.read.banner().text, 'request failed (502)');
  assert.deepEqual(harness.problems, [], 'the failure is reported, not thrown');
});

it('one unreadable block cannot blank the rest of the Overview', async () => {
  const payload = realOverviewPayload();
  delete payload.treasury;
  delete payload.targets;
  (payload.agents as Record<string, unknown>).registry = undefined;
  const harness = bootConsole({ overview: payload });
  await harness.settle();
  const cards = harness.read.cards();
  assert.equal(cards.length, 5, 'the cards still render, from the fields that did arrive');
  assert.equal(cardOf(cards, 'Fleet').value, '4001', 'the count that arrived is still shown');
  assert.equal(cardOf(cards, 'Earned').value, '20.50 MISSING', 'the amount is known and its currency is not — both are said');
  assert.match(harness.document.querySelector('#targets')?.textContent ?? '', /MISSING — targets is not in the Overview payload/);
  assert.match(harness.document.querySelector('#revenue-realized')?.textContent ?? '', /gofrantic/, 'a block whose data arrived is untouched by a block whose data did not');
  assert.deepEqual(harness.problems, []);
});

it('the console asks for the Overview once per load, not twice', async () => {
  const harness = bootConsole();
  await harness.settle();
  const calls = harness.requests.filter((request) => request === '/overview');
  assert.equal(calls.length, 1, `the Overview is the fleet-sized read of this console; one load must fetch it once (saw ${calls.length})`);
  assert.ok(harness.api.state.loadedTabs?.has('overview'), 'and the tab loader is told it happened, so nothing refetches it');
});

it('the renderer is driven by the exact real payload shape and reads every field it dereferences', async () => {
  const harness = bootConsole();
  await harness.settle();
  const keys = Object.keys(realOverviewPayload());
  assert.deepEqual(keys, OVERVIEW_TOP_LEVEL_KEYS, 'this fixture is the response the mission server actually sends — same 20 keys, same order');
  // The five cards are the Overview panel itself; the read-only tables `renderOverview` also fills are
  // hosts the strip moved into the sections an owner reads them from, so they are looked up by id.
  const panel = harness.document.querySelector('[data-panel="overview"]') as HTMLElement;
  assert.equal(panel.querySelector('#overview-cards')?.children.length, 5, 'the Overview panel carries the five cards');
  for (const host of ['#revenue-honesty', '#revenue-realized', '#revenue-pending', '#targets', '#expenses', '#costs', '#integrity', '#activation']) {
    const node = harness.document.querySelector(host);
    assert.ok(node, `the console needs ${host} to render into`);
    assert.ok(node.textContent?.trim().length, `${host} was rendered, not left empty`);
  }
  assert.equal(harness.document.querySelector('#revenue-honesty')?.textContent, 'Every figure comes from this mission database. Revenue is counted only when it was received and verified.');
  assert.equal(harness.document.querySelector('#integrity')?.textContent?.includes('verified'), true, 'both chains report the state the payload carried');
  assert.deepEqual(harness.problems, []);
});
