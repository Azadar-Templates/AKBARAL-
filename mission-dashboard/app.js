/**
 * Private mission console.
 *
 * Design rules this client follows:
 *   · Every number shown comes from the mission API. Nothing is estimated,
 *     sampled or invented; empty states say "no data" instead of showing zeroes
 *     dressed up as results.
 *   · Realized revenue is displayed separately from contracted/expected
 *     amounts, and targets are labelled as targets with real progress.
 *   · Credential values are never requested for display and never rendered.
 *   · Access-link tokens are read once from the URL fragment, then removed from
 *     the address bar and kept in session storage only.
 */
'use strict';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(() => { /* offline shell is optional */ });
}

const TOKEN_KEY = 'za_mission_token';
const LINK_KEY = 'za_mission_link';

/** Rendered rows per table: a section must fit one screen, and this is the one place that decides it. */
const MAX_TABLE_ROWS = 8;
/**
 * The agent report is a drill-down that lives in the Bounty section's collapsed Agents block, and that
 * section has a three-screen budget whatever the API returns — so the report's history tables render
 * fewer rows than a section table does. Nothing is taken from the owner: the note under each table
 * counts what was left out, and every row stays in the API response and the database.
 */
const MAX_REPORT_ROWS = 3;
/** The roster in the same block is a picker, not a page: five agents is a screen of real choices. */
const MAX_PICKER_ROWS = 5;
/** A phone's viewport, and the row budget that keeps a folded section inside three screens there. */
const NARROW_VIEWPORT_PX = 500;
const MAX_PHONE_ROWS = 2;
/** Targets drawn on a program card before the card says "and N more in the allowlist". */
const MAX_TARGET_LINES = 4;

const state = {
  token: sessionStorage.getItem(TOKEN_KEY) || '',
  link: sessionStorage.getItem(LINK_KEY) || '',
  owner: null,
  overview: null,
  headAgent: null,
  headAgentPoller: null,
  activeTab: 'overview',
  verifyingSlot: null,
};

/**
 * What the console prints for a field the API response does not carry. `0`, `—` and an empty panel all
 * read as a result on a mission dashboard; this does not, and the difference is the point: an owner can
 * tell "not measured" from "measured as nothing".
 */
const MISSING = 'MISSING';

// ── tiny DOM helpers ────────────────────────────────────────────────────────
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function pill(text, kind = 'info') {
  return el('span', { class: `pill ${kind}`, text });
}

function money(cents, currency = 'USD') {
  if (cents === null || cents === undefined) return '—';
  const value = Number(cents);
  const formatted = (value / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${formatted} ${currency}`;
}

function when(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

function table(columns, rows, emptyMessage, options = {}) {
  const wrap = el('div', { class: 'table-wrap' });
  if (!rows || rows.length === 0) {
    wrap.appendChild(el('p', { class: 'muted small', style: 'padding:12px', text: emptyMessage || 'No data yet.' }));
    return wrap;
  }
  // A section has to stay inside one screen whatever the API returns, so the table primitive bounds
  // what renders instead of every caller having to remember to. The rows are not hidden from the
  // owner — they stay in the response, and the line below says how many were left out.
  // The caller can ask for a tighter budget than the section default (the agent report does), and a
  // phone gets a tighter default still: at 390px wide every wrapped cell costs several lines, so
  // eight rows is four screens of one table. The rows are not hidden from anyone — the line under the
  // table counts what was left out and the API and the database keep all of them.
  const cap = options.maxRows || (window.innerWidth <= NARROW_VIEWPORT_PX ? MAX_PHONE_ROWS : MAX_TABLE_ROWS);
  const shown = rows.length > cap ? rows.slice(0, cap) : rows;
  const thead = el('thead', {}, el('tr', {}, columns.map((column) => el('th', { text: column.label }))));
  const tbody = el('tbody', {}, shown.map((row) => el('tr', {}, columns.map((column) => {
    const cell = el('td', { class: column.wrap ? 'wrap' : '' });
    const content = column.render ? column.render(row) : row[column.key];
    if (content instanceof Node) cell.appendChild(content);
    else cell.textContent = content === null || content === undefined ? '—' : String(content);
    return cell;
  }))));
  wrap.appendChild(el('table', {}, [thead, tbody]));
  if (rows.length > shown.length) {
    wrap.appendChild(el('p', { class: 'muted small', style: 'padding:6px 12px 0', text: `${rows.length - shown.length} more row(s) not rendered; the full list is in the API response and the database.` }));
  }
  return wrap;
}

function replace(selector, node) {
  const host = $(selector);
  if (!host) return;
  host.innerHTML = '';
  host.appendChild(node);
}

let bannerTimer = null;
function banner(message, kind = 'ok') {
  const node = $('#banner');
  node.className = `banner ${kind}`;
  node.textContent = message;
  node.hidden = false;
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { node.hidden = true; }, 6000);
}

// ── navigation ──────────────────────────────────────────────────────────────
/**
 * Six primary items; every view kept.
 *
 * The console used to expose 19 top-level tabs, which read as clutter. 13 of
 * them are now sub-sections of the six families below. This is presentation
 * only: every view id, its panel, its loader and its owner / head-agent gate
 * attributes are unchanged, so
 *
 *   · each view still deep-links as #/<id> — including the hidden ones, which
 *     open their family and themselves on load;
 *   · back/forward works, because the route lives in the URL, not only in
 *     memory (the old nav kept `activeTab` in a variable, so a reload or a
 *     back step always landed back on Overview);
 *   · nothing is deleted, so no data path, access check or loader changed.
 *
 * Policy and Audit are ONE primary item that shows both views on one screen.
 * The hash-chained audit trail is a compliance control, so it is kept beside
 * the policy it evidences — reachable in a single click from the primary row
 * and still separately linkable as #/audit — rather than buried a level deeper.
 */
const PRIMARY_TABS = ['overview', 'bounties', 'approvals', 'money'];

/**
 * The collapsed sub-sections, keyed by the section that holds them. Each entry is a
 * `<details class="sub" data-view="…">` inside that section — not a hidden page: the
 * markup and every host id it contains are the same ones the old tab rendered, so the
 * loaders, the access gates and the deep links below did not have to change shape.
 */
const TAB_GROUPS = {
  bounties: ['bounty-registration', 'bounty-scope', 'bounty-catalogs', 'agents', 'specialist-records', 'customer-work', 'customer-intake'],
  approvals: ['policy', 'tools'],
  money: ['earnings', 'treasury', 'withdraw', 'expenses', 'evidence', 'audit'],
};

/** Views that share a screen. The 2026-10 strip left none: each sub-section is its own
 *  collapsed block, so nothing renders twice and no screen stacks two unrelated tables. */
const TAB_COVIEW = {};

const TAB_PARENT = {};
const TAB_VIEWS = PRIMARY_TABS.slice();
for (const family of Object.keys(TAB_GROUPS)) {
  for (const view of TAB_GROUPS[family]) {
    TAB_PARENT[view] = family;
    TAB_VIEWS.push(view);
  }
}

/**
 * Redirects for routes this console has actually emitted, plus the label spellings a
 * person would type. The seven views the owner stripped (guide, chat, knowledge,
 * playbooks, lessons, resources & expiry, publishing) are deliberately absent: their
 * routes fall through to Overview rather than being kept alive as aliases to a screen
 * that no longer exists, and every route a script or a saved link still needs resolves.
 */
const TAB_ROUTE_ALIASES = {
  'bug-bounty': 'bounties',
  'bugbounty': 'bounties',
  'verified-cash': 'money',
  'cash': 'money',
  'legacy-accounting': 'treasury',
  'accounting': 'treasury',
  destinations: 'treasury',
  'payout-destinations': 'treasury',
  resources: 'tools',
  expiry: 'tools',
  credentials: 'tools',
  'tools-credentials': 'tools',
  customers: 'customer-work',
  work: 'customer-work',
  'audit-trail': 'audit',
  withdrawal: 'withdraw',
  'legacy-withdraw': 'withdraw',
  revenue: 'earnings',
  expenses: 'expenses',
};

/** The collapsed block for a view, when it is one. */
function subSection(view) {
  return document.querySelector(`details.sub[data-view="${view}"]`);
}

function groupOfView(view) {
  return PRIMARY_TABS.includes(view) ? view : (TAB_PARENT[view] || null);
}

function tabButton(view) {
  return $(`#tabs [data-tab="${view}"]`);
}

function viewLabel(view) {
  const button = tabButton(view);
  if (button) return button.textContent.trim();
  const details = subSection(view);
  if (details) {
    const summary = details.querySelector('summary');
    if (summary) return summary.textContent.trim();
  }
  return view;
}

/**
 * Whether the current caller may see this nav entry at all. This is the single
 * source of truth for the gate rules that used to be applied with two
 * $$('[data-…]') loops, so a sub-view can never be shown without its family
 * (or hidden while its panel stays on screen).
 */
function gateHidesNavEntry(button) {
  if (button.getAttribute('data-head-agent') === 'true') return !canMutate();
  if (button.getAttribute('data-owner-only') === 'true') return !isOwnerSession();
  return false;
}

/** The view a route addresses, or null when the fragment is not a view. */
function routeFromHash(hash) {
  const match = /^#\/?([A-Za-z0-9][A-Za-z0-9-]*)$/.exec((hash || '').trim());
  if (!match) return null;
  const raw = match[1].toLowerCase();
  // '#link=<token>' is an access link, not a route: readLinkFromUrl owns it.
  if (raw === 'link') return null;
  const view = Object.prototype.hasOwnProperty.call(TAB_ROUTE_ALIASES, raw) ? TAB_ROUTE_ALIASES[raw] : raw;
  return TAB_VIEWS.includes(view) ? view : null;
}

/**
 * Paints the four sections and the open/closed state of their collapsed blocks. Loads
 * nothing. A sub-view is on screen exactly when its family is shown and its own
 * `<details>` is open, so "reachable in two clicks" is a property of the markup rather
 * than of a menu that has to be hovered.
 */
function applyTabChrome(view) {
  const family = groupOfView(view) || view;
  const shown = TAB_COVIEW[view] || [family];
  state.activeTab = view;
  for (const panel of $$('[data-panel]')) {
    const name = panel.getAttribute('data-panel');
    panel.hidden = !shown.includes(name);
    for (const details of $$('details.sub', panel)) {
      // A block in a hidden section closes, so a section never reopens with three
      // tables stacked from whatever was last visited.
      if (panel.hidden) { details.open = false; continue; }
      const sub = details.getAttribute('data-view');
      const gated = gateHidesNavEntry(details);
      details.hidden = gated;
      details.open = !gated && sub === view;
    }
  }
  for (const button of $$('#tabs .tab')) {
    const entry = button.getAttribute('data-tab');
    button.hidden = gateHidesNavEntry(button);
    const active = entry === family || (shown.includes(entry) && entry === view);
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

function writeRoute(view) {
  const wanted = `#/${view}`;
  if (window.location.hash === wanted) return;
  try {
    window.history.pushState({}, '', wanted);
  } catch {
    // A locked-down host still switches the view; only the URL stays put.
  }
}

/**
 * The one navigation entry point: resolve the view, paint, record the route,
 * then let each existing loader fill its own panel. A gated sub-view falls
 * back to its family with the reason on the banner, exactly as the head-agent
 * chat guard did before — it never renders a blank screen.
 */
async function activateTab(view, options = {}) {
  let target = TAB_VIEWS.includes(view) ? view : 'overview';
  // Gating is decided by the gate rules themselves, never by whether the
  // button happens to be visible right now: a sub-view of a family that is not
  // currently open is hidden for a different reason (its family is closed), and
  // must still open normally.
  //
  // This also closes a gap the routes made possible: before routing, a gated
  // view was unreachable simply because its button was hidden, so a shared
  // #/<view> link is checked against the very same rule here — for a primary as
  // well as a sub-view. The caller falls back to its family, or to Overview,
  // with the reason on the banner; the private panel is never rendered. The
  // server still guards the data independently, as it always did.
  const entry = tabButton(target) || subSection(target);
  if (entry && gateHidesNavEntry(entry)) {
    banner(`${viewLabel(target)} needs the mission owner session.`, 'error');
    target = TAB_PARENT[target] || 'overview';
  }
  applyTabChrome(target);
  if (options.navigate) writeRoute(target);
  // A family opens with every block closed; a sub-view opens its own block only.
  const family = groupOfView(target) || target;
  await loadTab(family === target ? target : family);
  if (target !== family) await loadTab(target);
  for (const sibling of (TAB_COVIEW[target] || [])) {
    if (sibling !== target) await loadTab(sibling);
  }
}

// ── API ─────────────────────────────────────────────────────────────────────
async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json' };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  if (state.link) headers['x-mission-link'] = state.link;
  const response = await fetch(`/api${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  if (!response.ok) {
    if (response.status === 401) signOut(false);
    const error = new Error((payload && payload.error && payload.error.message) || `request failed (${response.status})`);
    error.status = response.status;
    error.code = payload && payload.error ? payload.error.code : 'unknown';
    throw error;
  }
  return payload;
}

/** Owner-only actions are hidden for read-only access links. */
function canMutate() {
  return Boolean(state.token);
}

function isOwnerSession() {
  return Boolean(state.token && state.owner && state.owner.role === 'owner');
}

/**
 * Whether this tab is looking through a read-only link rather than the owner's own session.
 *
 * The server's rule, stated once here so every affordance agrees with it: an access link can read and
 * cannot change anything (`canMutate()`), and a signed-in session whose mission role is not `owner` is
 * refused every mutation (`requireOwner`). Anything else that carries a token is the owner's session and
 * must never be labelled read-only — including when an old link token is still sitting in this tab's
 * session storage, which is what used to make a fully authorised owner look like a head agent.
 */
function isReadOnlySession() {
  if (state.token) return Boolean(state.owner) && state.owner.role !== 'owner';
  return Boolean(state.link);
}

/** Session facts, applied together and independently of any panel's data: who is looking, and what they
 *  can do about it. Nothing in here may depend on a network response, or a slow endpoint would be free
 *  to leave a wrong statement about the owner on screen. */
function applySessionMode() {
  showIdentity();
  const signOutButton = $('#signout');
  if (signOutButton) signOutButton.hidden = !canMutate();
  const pillNode = $('#head-read-only-state');
  if (pillNode) pillNode.hidden = !isReadOnlySession();
}

function guardMutation() {
  if (canMutate()) return true;
  banner('This access link is read-only. Sign in as the mission owner to make changes.', 'error');
  return false;
}

// ── session ─────────────────────────────────────────────────────────────────
function readLinkFromUrl() {
  const hash = window.location.hash || '';
  const match = hash.match(/link=([^&]+)/);
  if (!match) return;
  const token = decodeURIComponent(match[1]).trim();
  if (token) {
    state.link = token;
    sessionStorage.setItem(LINK_KEY, token);
  }
  // Remove the token from the address bar so it is not left in history,
  // screenshots or shared links.
  window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
}

function signOut(notify = true) {
  if (state.headAgentPoller) {
    clearInterval(state.headAgentPoller);
    state.headAgentPoller = null;
  }
  state.token = '';
  state.owner = null;
  state.headAgent = null;
  sessionStorage.removeItem(TOKEN_KEY);
  $('#app').hidden = true;
  $('#login-panel').hidden = false;
  applySessionMode();
  if (notify) banner('Signed out.', 'ok');
}

async function login(email, password) {
  const payload = await api('/session/login', { method: 'POST', body: { email, password } });
  state.token = payload.token;
  state.owner = payload.owner;
  state.link = '';
  // Applied after the link is dropped, so the label describes the session that just started and not the
  // access link this tab happened to arrive on.
  applySessionMode();
  sessionStorage.setItem(TOKEN_KEY, payload.token);
  sessionStorage.removeItem(LINK_KEY);
  await start();
}

async function start() {
  $('#login-panel').hidden = true;
  $('#app').hidden = false;
  // Who is looking is a session fact, not a data fact, so it is applied here — before the first request
  // and whatever it returns.
  applySessionMode();
  // Gate rules, visible panels and the sub-section row are one computation,
  // so a consolidated view can never be shown without its family (or hidden
  // while its panel stays on screen).
  applyTabChrome(state.activeTab);
  // Identify the operator from the session state we already hold, before any
  // network round-trip: a signed-in person must never see "not signed in".
  const loaded = state.loadedTabs || (state.loadedTabs = new Set());
  try {
    const overview = await api('/overview');
    state.overview = overview;
    renderOverview(overview);
    // This load has already paid for the Overview; `activateTab` below must not fetch and render the same
    // endpoint a second time before the owner has seen anything.
    loaded.add('overview');
  } catch (error) {
    if (error.status !== 401) banner(error.message, 'error');
    // Same treatment as loadTab gives a failed panel: the tab counts as attempted, and the panel says
    // what is missing rather than staying blank.
    loaded.add('overview');
    renderOverviewUnavailable(error);
  }
  await activateTab(state.activeTab);
  if (canMutate()) {
    try { await loadHeadAgentOverview(); } catch (error) { if (error.status !== 401) banner(error.message, 'error'); }
    await loadHeadAgentNotifications();
    if (!state.headAgentPoller) state.headAgentPoller = setInterval(() => { void loadHeadAgentNotifications(); }, 30000);
  }
  await loadActivityOptions();
}

/** The identity line, kept true from whatever session state the tab holds. */
function showIdentity() {
  if (!canMutate()) {
    $('#identity').textContent = 'read-only access link';
    return;
  }
  $('#identity').textContent = state.owner ? `signed in as ${state.owner.email}` : 'signed in — session restored';
}

/**
 * The activity catalog is the policy's own allow-list: the create form offers
 * exactly the activities the mission is permitted to perform, nothing else.
 */
async function loadActivityOptions() {
  const select = $('#create-agent-activity');
  if (!select || select.options.length > 0) return;
  try {
    const policy = await api('/policy');
    const activities = policy.categories && policy.categories.length > 0 ? policy.categories : policy.policy.allowedActivities;
    for (const activity of activities) select.appendChild(el('option', { value: activity, text: activity }));
  } catch {
    /* the form simply stays empty; the server still enforces the policy */
  }
}

// ── renderers ───────────────────────────────────────────────────────────────
function card(label, value, note) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value', text: String(value) }),
    note ? el('div', { class: 'note', text: note }) : null,
  ]);
}

/** The remaining owner actions, in the order the gates actually unblock each other. */
function ownerActionLines(activation) {
  const remaining = (activation && Array.isArray(activation.remaining) ? activation.remaining : []).slice(0, 6);
  return remaining.map((row) => el('li', {}, [
    el('strong', { text: String(row.code || 'blocker') }),
    el('span', { text: ` — ${row.action || row.label || ''}` }),
    row.target ? el('span', { class: 'muted', text: ` (${row.how || 'owner action'}: ${row.target})` }) : null,
    row.cleared ? el('span', { class: 'pill ok', text: 'cleared' }) : null,
  ]));
}

/**
 * One card line cannot carry an activation path. The queue itself is rendered here, folded so the
 * Overview stays short, and the source mark travels with it: an owner reading a verdict that came
 * from a scratch database sees that before they see any number.
 */
function renderOwnerActivationPath(overview) {
  const panel = document.querySelector('[data-panel="overview"]');
  if (!panel) return;
  const activation = (overview && overview.fleet && overview.fleet.activation) || null;
  const lines = ownerActionLines(activation);
  let block = panel.querySelector('#overview-owner-path');
  if (!block) {
    if (lines.length === 0) return;
    block = el('details', { class: 'card owner-path', id: 'overview-owner-path' });
    panel.append(block);
  }
  block.innerHTML = '';
  block.append(
    el('summary', { text: lines.length
      ? `${lines.length} owner action(s) left before the fleet can work`
      : 'No owner action outstanding' }),
    lines.length ? el('ul', { class: 'owner-action-list' }, lines) : null,
    activation && activation.claimStatus
      ? el('p', { class: 'muted small', text: `Read from ${activation.source || 'the mission database'} · ${activation.claimStatus}` })
      : null,
    activation && activation.note ? el('p', { class: 'muted small', text: activation.note }) : null,
  );
}

/**
 * The five cards an owner opens this console for, plus the read-only tables under them.
 *
 * Every figure is the payload's own. A field the payload does not carry renders `MISSING` instead of a
 * zero: on this console a zero reads like a measurement, and a fleet whose readiness was never counted
 * must not look like a fleet with nothing ready. Each block renders on its own for the same reason — one
 * panel that cannot be read says so on its own line instead of taking the rest of the Overview (and the
 * session label beside it) down with it.
 */
function renderOverview(overview) {
  const source = overview && typeof overview === 'object' ? overview : {};
  const fleet = source.fleet || {};
  const agents = source.agents || {};
  const currency = source.treasury && source.treasury.currency ? source.treasury.currency : MISSING;

  const stale = $('#overview-unavailable');
  if (stale) stale.remove();

  const cards = $('#overview-cards');
  if (cards) {
    cards.innerHTML = '';
    cards.append(
      card('Fleet', countOf(fleet.registered, agents.total), `${countOf(fleet.withPlatform)} paired with a verified venue · ${countOf(agents.registry)} from the registry`),
      card('Ready to work', countOf(fleet.ready), 'EXECUTION_READY or WORKING — every gate green'),
      card('Blocked', bothNumbered(fleet.blocked, fleet.needsOwnerAction), `${countOf(fleet.blocked)} blocked/inactive · ${countOf(fleet.needsOwnerAction)} awaiting the owner`),
      card('Earned', centsOf(fleet.earnedCents, currency), `${countOf(fleet.settledProofs)} verified settlement proof(s); advertised rewards are never counted`),
      card('Next action', typeof fleet.nextAction === 'string' ? (fleet.nextAction || 'none recorded') : MISSING, 'the single thing that moves the fleet forward'),
    );
  }
  renderOwnerActivationPath(source);

  block('#revenue-honesty', () => {
    const node = $('#revenue-honesty');
    if (!node) return null;
    node.textContent = source.honesty && source.honesty.noFabrication ? String(source.honesty.noFabrication) : MISSING;
    return null;
  });

  block('#revenue-realized', () => table([
    { label: 'Source', key: 'source' },
    { label: 'Receipts', key: 'count' },
    { label: 'Amount', render: (row) => money(row.cents, currency) },
  ], rowsOf(source.revenue && source.revenue.bySource, 'revenue.bySource'), 'No verified receipts yet — nothing has been earned, so nothing is shown.'));

  block('#revenue-pending', () => {
    const pending = rowsOf(source.revenue && source.revenue.recent, 'revenue.recent').filter((row) => row.status !== 'received');
    return table([
      { label: 'Recorded', render: (row) => when(row.created_at) },
      { label: 'Status', render: (row) => pill(String(row.status), 'warn') },
      { label: 'Amount', render: (row) => money(row.amount_cents, currency) },
      { label: 'Work', render: (row) => row.work_id || '—' },
      { label: 'Reference', render: (row) => row.external_ref || '—' },
    ], pending, 'No contracted or expected amounts recorded.');
  });

  block('#targets', () => table([
    { label: 'Target', key: 'label' },
    { label: 'Period', key: 'period' },
    { label: 'Goal', render: (row) => money(row.amountCents, currency) },
    { label: 'Verified progress', render: (row) => `${money(row.actualCents, currency)} (${row.progressPct}%)` },
    { label: 'Kind', render: () => pill('target', 'warn') },
  ], rowsOf(source.targets, 'targets'), 'No targets configured.'));

  block('#expenses', () => table([
    { label: 'Category', key: 'category' },
    { label: 'Entries', key: 'count' },
    { label: 'Paid', render: (row) => money(row.cents, currency) },
  ], rowsOf(source.expenses && source.expenses.byCategory, 'expenses.byCategory'), 'No expenses paid yet.'));

  block('#costs', () => table([
    { label: 'Cost category (30 days)', key: 'category' },
    { label: 'Entries', key: 'count' },
    { label: 'Spend', render: (row) => money(row.cents, currency) },
  ], rowsOf(source.costs && source.costs.byCategory, 'costs.byCategory'), 'No operating spend recorded in the last 30 days.'));

  block('#integrity', () => table([
    { label: 'Chain', render: (row) => row.name },
    { label: 'State', render: (row) => (row.ok === MISSING ? pill(MISSING, 'warn') : row.ok ? pill('verified', 'ok') : pill('broken', 'bad')) },
    { label: 'Entries', render: (row) => row.count },
  ], [
    { name: 'Audit trail', ok: verifiedOf(source.audit && source.audit.ok), count: countOf(source.audit && source.audit.rows) },
    { name: 'Ledger', ok: verifiedOf(source.integrity && source.integrity.ledger && source.integrity.ledger.ok), count: countOf(source.integrity && source.integrity.ledger && source.integrity.ledger.rows) },
  ]));

  block('#activation', () => table([
    { label: 'Provider', key: 'provider' },
    { label: 'Required external action', key: 'action', wrap: true },
    { label: 'Why', key: 'why', wrap: true },
  ], rowsOf(source.honesty && source.honesty.externalActivationPending, 'honesty.externalActivationPending'), 'Nothing pending.'));
}

/** One Overview block, rendered independently: unreadable data becomes a MISSING line, never a blank panel. */
function block(selector, build) {
  try {
    const node = build();
    if (node) replace(selector, node);
  } catch (error) {
    replace(selector, missingNote(error && error.message ? error.message : 'the Overview payload could not be read'));
  }
}

function missingNote(reason) {
  return el('p', { class: 'muted small', style: 'padding:12px', text: `${MISSING} — ${reason}. Nothing here was estimated to fill the gap.` });
}

/** A list the payload does not carry is not the same claim as a list that is empty. */
function rowsOf(rows, path) {
  if (Array.isArray(rows)) return rows;
  throw new Error(`${path} is not in the Overview payload`);
}

/** The first field that actually carries a number; `MISSING` when none of them does. */
function countOf(...fields) {
  for (const field of fields) {
    if (typeof field === 'number' && Number.isFinite(field)) return String(field);
  }
  return MISSING;
}

/** A sum of two stored counts, reported only when both were actually counted. */
function bothNumbered(left, right) {
  const hasLeft = typeof left === 'number' && Number.isFinite(left);
  const hasRight = typeof right === 'number' && Number.isFinite(right);
  return hasLeft && hasRight ? String(left + right) : MISSING;
}

function centsOf(cents, currency) {
  return typeof cents === 'number' && Number.isFinite(cents) ? money(cents, currency) : MISSING;
}

function verifiedOf(value) {
  return value === undefined || value === null ? MISSING : Boolean(value);
}

/**
 * The Overview when the Overview never arrived.
 *
 * A failed, timed-out or refused request used to leave the panel exactly as the markup shipped it: an
 * empty grid, no reason, and — because the read-only label was decided at the end of the render that
 * never happened — a session claim the owner never earned. The five cards are rendered anyway with
 * `MISSING` and the reason under them. The figures themselves are never invented to fill the hole.
 */
function renderOverviewUnavailable(error) {
  const reason = error && error.message ? String(error.message) : 'the Overview request failed';
  const status = error && error.status ? ` (HTTP ${error.status})` : '';
  const cards = $('#overview-cards');
  if (cards) {
    cards.innerHTML = '';
    for (const label of ['Fleet', 'Ready to work', 'Blocked', 'Earned', 'Next action']) {
      cards.append(card(label, MISSING, 'the Overview did not load, so nothing was measured for it'));
    }
  }
  let note = $('#overview-unavailable');
  if (!note && cards) {
    note = el('p', { class: 'muted small', id: 'overview-unavailable' });
    cards.after(note);
  }
  if (note) note.textContent = `${MISSING} — the mission Overview could not be read${status}: ${reason}. Reload this page to try again; no figure on this panel was filled in by hand.`;
}

// History tables inside the agent report are budgeted; see MAX_REPORT_ROWS.
function reportTable(columns, rows, emptyMessage) { return table(columns, rows, emptyMessage, { maxRows: MAX_REPORT_ROWS }); }

function renderAgentReport(report) {
  const currency = state.overview ? state.overview.treasury.currency : 'USD';
  const host = $('#agent-report');
  host.innerHTML = '';
  const revenue = report.revenue;
  const dailyTarget = report.dailyTarget || report.agent.dailyTarget;

  // h3, not h2: the agent report renders inside a collapsed block, under the section's own title.
  host.appendChild(el('h3', { text: `Agent — ${report.agent.name}` }));
  host.appendChild(el('div', { class: 'cards' }, [
    card('Slug', report.agent.slug),
    card('Role', report.agent.role),
    card('Depth', report.agent.depth),
    card('Parent', report.agent.parentSlug || '—'),
    card('Children', report.agent.childCount),
    card('Status', report.agent.status),
    card('Wallet balance', report.wallet ? money(report.wallet.balanceCents, currency) : 'no wallet'),
    card('Legacy reported revenue', money(revenue.realizedCents, currency), 'verified receipts'),
    card('Contracted', money(revenue.contractedCents, currency)),
    card('Expected', money(revenue.expectedCents, currency)),
    card('Audit entries', report.audit.entries, report.audit.lastAction || ''),
    dailyTarget ? card('Daily target', money(dailyTarget.targetCents, dailyTarget.currency), `owner-defined $1B/day aspirational`) : null,
    dailyTarget ? card('Verified today', money(dailyTarget.realizedCents, dailyTarget.currency), `${dailyTarget.progressPct}% progress`) : null,
    dailyTarget ? card('Remaining gap', money(dailyTarget.remainingCents, dailyTarget.currency), dailyTarget.met ? '✓ met today (verified)' : 'resets daily UTC') : null,
  ].filter(Boolean)));

  if (dailyTarget) {
    host.appendChild(el('h3', { text: 'Persistent objective — $1B/day per agent' }));
    host.appendChild(el('p', { class: 'muted small', text: dailyTarget.persistentObjective || report.agent.persistentObjective || 'Maximize legitimate, verified real-world earnings toward $1B/day aspirational target — lawful, sustainable, verifiable only, no guarantees.' }));
    host.appendChild(el('p', { class: 'muted small', text: dailyTarget.note || 'Progress counts ONLY verified received revenue (status=received + verifier). Target resets daily UTC, never guarantee, never fabricated.' }));
  }

  host.appendChild(el('p', { class: 'muted small', text: report.honesty.note }));
  if (canMutate()) {
    host.appendChild(renderAgentControls(report));
  }

  // The thread is rendered by the function the strip had removed with the head-agent chat panel; it
  // belongs to the per-agent report, so it is restored there rather than duplicated here.
  // The correspondence is opened, not stacked: an owner reading a report is usually reading the
  // controls, and the thread (plus its reply settings) is one click away either way.
  const thread = el('details', { class: 'control-block' });
  thread.appendChild(el('summary', { text: 'Owner ↔ agent messages and automatic replies' }));
  host.appendChild(thread);
  const conversation = el('section', { class: 'control-block', 'aria-label': 'Private agent messages' });
  thread.appendChild(conversation);
  void renderAgentMessages(conversation, report.agent.slug);

  // Nine read-only lists, and every one of them has a real owner-visible purpose — so they are not
  // deleted and not truncated into meaninglessness: they sit in a disclosure the owner opens once per
  // agent. The section's screen budget is what this pays for, and `table()` still counts for itself
  // when a list is longer than the row budget.
  const history = el('details', { class: 'control-block' });
  history.appendChild(el('summary', { text: 'The record — children, revenue, receipts, work, expenses, resources and services' }));
  host.appendChild(history);
  history.appendChild(el('h3', { text: 'Children (delegation)' }));
  history.appendChild(reportTable([
    { label: 'Slug', key: 'slug' },
    { label: 'Name', key: 'name' },
    { label: 'Role', key: 'role' },
    { label: 'Depth', key: 'depth' },
    { label: 'Status', render: (row) => pill(String(row.status), row.status === 'active' ? 'ok' : 'warn') },
  ], report.agent.children ?? [], 'This agent has not delegated any work yet.'));

  history.appendChild(el('h3', { text: 'Revenue by source (realized)' }));
  history.appendChild(reportTable([
    { label: 'Source', key: 'source' },
    { label: 'Receipts', key: 'count' },
    { label: 'Amount', render: (row) => money(row.cents, currency) },
  ], revenue.bySource, 'No verified revenue for this agent.'));

  history.appendChild(el('h3', { text: 'Receipts' }));
  history.appendChild(reportTable([
    { label: 'When', render: (row) => when(row.receivedAt) },
    { label: 'Amount', render: (row) => money(row.amountCents, currency) },
    { label: 'Status', render: (row) => pill(String(row.status), row.status === 'received' ? 'ok' : 'warn') },
    { label: 'Verifier', render: (row) => row.verifier || '—' },
    { label: 'Reference', render: (row) => row.externalRef || '—' },
  ], revenue.entries, 'No revenue recorded for this agent.'));

  history.appendChild(el('h3', { text: 'Work that produced it' }));
  history.appendChild(reportTable([
    { label: 'Title', key: 'title', wrap: true },
    { label: 'Activity', key: 'category' },
    { label: 'Status', key: 'status' },
    { label: 'Revenue', render: (row) => money(row.revenueCents, currency) },
    { label: 'Cost', render: (row) => money(row.costCents, currency) },
    { label: 'Created', render: (row) => when(row.createdAt) },
  ], report.work, 'No approved work recorded yet.'));

  history.appendChild(el('h3', { text: 'Expenses' }));
  history.appendChild(reportTable([
    { label: 'When', render: (row) => when(row.createdAt) },
    { label: 'Category', key: 'category' },
    { label: 'Provider', key: 'provider' },
    { label: 'Amount', render: (row) => money(row.amountCents, currency) },
    { label: 'Status', key: 'status' },
  ], report.expenses.entries, 'No expenses recorded for this agent.'));

  history.appendChild(el('h3', { text: 'Resources, credentials, services & upgrades' }));
  history.appendChild(reportTable([
    { label: 'Kind', key: 'kind' },
    { label: 'Provider', key: 'provider' },
    { label: 'Status', key: 'status' },
    { label: 'Monthly cost', render: (row) => money(row.monthlyCostCents, currency) },
    { label: 'Expires', render: (row) => when(row.expiresAt) },
  ], report.resources, 'No resources assigned.'));
  history.appendChild(reportTable([
    { label: 'Provider', key: 'provider' },
    { label: 'Label', key: 'label' },
    { label: 'Status', render: (row) => pill(String(row.status), row.urgency === 'critical' ? 'warn' : 'info') },
    { label: 'Expires', render: (row) => when(row.expiresAt) },
  ], report.credentials, 'No credentials stored.'));
  history.appendChild(reportTable([
    { label: 'Service', key: 'name' },
    { label: 'Kind', key: 'kind' },
    { label: 'Health', key: 'status' },
    { label: 'Source', render: (row) => row.healthSource || '—' },
    { label: 'Checked', render: (row) => when(row.lastCheckedAt) },
  ], report.services, 'No services assigned.'));
  history.appendChild(reportTable([
    { label: 'Capability', key: 'capability', wrap: true },
    { label: 'Status', key: 'status' },
    { label: 'Cost', render: (row) => money(row.costCents, currency) },
    { label: 'Requested', render: (row) => when(row.createdAt) },
  ], report.upgrades, 'No upgrades requested.'));
}

function headAmount(value) {
  if (!value) return '—';
  const status = String(value.status || 'unverified');
  if (value.cents === null || value.cents === undefined) return status;
  return `${money(value.cents, value.currency || 'USD')} · ${status}`;
}

// The per-agent report owns its own private correspondence and reply configuration: the head-agent
// chat panel was stripped from the console, but an owner must still be able to message an agent they
// opened, read what is actually stored, and turn automatic replies on or off. Nothing here is a
// capability the strip was allowed to remove.
async function renderAgentChatControls(host, slug) {
  if (!canMutate()) return;
  const base = `/agents/${encodeURIComponent(slug)}`;
  const [settings, resources, wallets] = await Promise.all([api(`${base}/chat-config`), api('/resources'), api('/wallets')]);
  const config = settings.config || {};
  const form = el('form', { class: 'stack-form' });
  form.append(el('h4', { text: 'Automatic replies — explicit owner opt-in' }), el('p', { text: 'Only future owner messages are eligible. Google receives the message text; no tools or payment commands are available. A separately enabled private worker, active policy, scoped credential, quota and funded budget are required. Worker liveness and provider access are not verified here.' }));
  const enabled = el('select', { name: 'enabled', 'aria-label': 'Automatic replies enabled' }, [el('option', { value: 'false', text: 'Disabled' }), el('option', { value: 'true', text: 'Enable future owner-message jobs' })]);
  enabled.value = config.enabled ? 'true' : 'false';
  const resource = el('select', { name: 'resourceId', required: '', 'aria-label': 'Assigned Google resource' }, [el('option', { value: '', text: 'Choose this agent’s Google resource' }), ...(resources.resources || []).filter(row => row.agent_id === settings.agentId && row.provider === 'google').map(row => el('option', { value: row.id, text: `${row.id} — ${row.status}` }))]);
  resource.value = config.resourceId || '';
  const wallet = el('select', { name: 'walletId', required: '', 'aria-label': 'Assigned funded wallet' }, [el('option', { value: '', text: 'Choose this agent’s wallet' }), ...(wallets.wallets || []).filter(row => row.agentId === settings.agentId).map(row => el('option', { value: row.id, text: `${row.label} — ${row.currency}` }))]);
  wallet.value = config.walletId || '';
  form.append(enabled, resource, wallet, el('p', { text: 'Fixed model: gemini-3.8-flash. Internal reservations are not a provider-enforced billing ceiling.' }));
  for (const [name, label, min, max, fallback] of [['maxInputBytes', 'Maximum message bytes', 128, 48000, 2000], ['maxOutputTokens', 'Maximum output tokens', 64, 4096, 1024], ['maxCostCents', 'Maximum reserved cost in minor units', 1, 1000000, '']]) {
    form.appendChild(el('label', {}, [label, el('input', { name, type: 'number', min, max, step: 1, required: '', value: config[name] ?? fallback, 'aria-label': label })]));
  }
  const basis = el('textarea', { name: 'costBasis', required: '', minlength: 12, maxlength: 1000, 'aria-label': 'Owner-reviewed cost basis', placeholder: 'Record your reviewed pricing/cap assumptions. This is not a financial receipt.' });
  basis.value = config.costBasis || '';
  form.append(basis, el('button', { type: 'submit', text: 'Save reply configuration' }));
  let saving = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !guardMutation() || !form.reportValidity()) return;
    if (enabled.value === 'true' && !confirm('Enable future owner-message jobs? An enabled worker can send their text to Google and incur provider charges within the configured request limits. Review pricing and provider billing caps first.')) return;
    saving = true; form.querySelector('button').disabled = true;
    try {
      await api(`${base}/chat-config`, { method: 'POST', body: { enabled: enabled.value === 'true', resourceId: resource.value, walletId: wallet.value, model: 'gemini-3.8-flash', maxInputBytes: Number(form.elements.maxInputBytes.value), maxOutputTokens: Number(form.elements.maxOutputTokens.value), maxCostCents: Number(form.elements.maxCostCents.value), costBasis: basis.value } });
      banner('Reply configuration saved. This does not activate a provider or prove a live worker.', 'ok');
    } catch (error) { banner(error.message, 'error'); }
    finally { saving = false; form.querySelector('button').disabled = false; }
  });
  const jobs = el('div', { class: 'table-wrap' });
  const next = el('button', { type: 'button', text: 'Older reply jobs', hidden: true });
  const refresh = el('button', { type: 'button', text: 'Refresh reply jobs' });
  let rows = [], cursor = null, loading = false;
  const loadJobs = async (reset = false) => {
    if (loading) return;
    loading = true; next.disabled = true; refresh.disabled = true;
    try {
      const result = await api(`${base}/chat-jobs?limit=50${!reset && cursor ? `&before=${cursor}` : ''}`);
      if (reset) rows = [];
      const seen = new Set(rows.map(row => row.id));
      rows.push(...result.jobs.filter(row => !seen.has(row.id)));
      cursor = result.nextCursor;
      jobs.replaceChildren(table([{ label: 'Job', key: 'id', wrap: true }, { label: 'State', key: 'status' }, { label: 'Reason', key: 'reason', wrap: true }, { label: 'Resource call', key: 'call_id', wrap: true }], rows, 'No automatic reply jobs recorded.'));
      next.hidden = !cursor;
    } finally { loading = false; next.disabled = false; refresh.disabled = false; }
  };
  next.addEventListener('click', () => { void loadJobs().catch(error => banner(error.message, 'error')); });
  refresh.addEventListener('click', () => { void loadJobs(true).catch(error => banner(error.message, 'error')); });
  host.replaceChildren(form, el('p', { class: 'muted small', text: 'Blocked/interrupted jobs are never automatically retried. Review their call under Tools → Resource calls; reconcile actual usage and financial evidence separately. No reply is fabricated for an interrupted job.' }), jobs, next, refresh);
  await loadJobs(true);
}

async function renderAgentMessages(host, slug) {
  host.replaceChildren(el('h3', { text: 'Owner / agent messages' }), el('p', { class: 'muted small', text: 'Stored private correspondence, not simulated agent replies. Text does not execute commands or move money. Use the explicit owner controls for actions.' }));
  const transcript = el('div', { class: 'table-wrap', 'aria-live': 'polite' });
  host.appendChild(transcript);
  const messages = [];
  let cursor = 0;
  const refresh = el('button', { type: 'button', class: 'small', text: 'Refresh / load next messages' });
  let loading = null;
  const load = async () => {
    if (loading) return loading;
    refresh.disabled = true;
    loading = (async () => {
      try {
        const result = await api(`/agents/${encodeURIComponent(slug)}/messages?after=${cursor}`);
        const seen = new Set(messages.map(message => message.seq));
        for (const message of result.messages) {
          if (!seen.has(message.seq)) { messages.push(message); seen.add(message.seq); }
        }
        cursor = result.nextCursor;
        transcript.replaceChildren(table([
          { label: 'When', render: row => when(row.created_at) },
          { label: 'From', key: 'actor_type' },
          { label: 'Message', key: 'body', wrap: true },
        ], messages, 'No messages yet. No agent response is fabricated.'));
        refresh.textContent = result.hasMore ? 'Load next page' : 'Refresh messages';
      } catch (error) { banner(error.message, 'error'); }
    })();
    try { await loading; } finally { loading = null; refresh.disabled = false; }
  };
  refresh.addEventListener('click', load);
  host.appendChild(refresh);
  if (canMutate()) {
    const control = el('button', { type: 'button', class: 'small', text: 'Configure automatic replies', 'data-chat-config': slug });
    const settings = el('section', { class: 'control-block', 'aria-label': 'Automatic reply configuration' });
    control.addEventListener('click', async () => {
      if (!guardMutation() || control.disabled) return;
      control.disabled = true;
      try { await renderAgentChatControls(settings, slug); } catch (error) { banner(error.message, 'error'); }
      finally { control.disabled = false; }
    });
    host.append(control, settings);
  }
  if (canMutate()) {
    const form = el('form', { class: 'stack-form' });
    const input = el('textarea', { name: 'message', maxlength: 12000, required: '', 'aria-label': 'Message to this agent', placeholder: 'Send a private message. Never paste credentials.' });
    form.append(input, el('button', { type: 'submit', text: 'Send owner message' }));
    let attempt = null;
    let sending = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (sending || !guardMutation()) return;
      if (!attempt || attempt.message !== input.value) attempt = { message: input.value, idempotencyKey: crypto.randomUUID() };
      sending = true;
      input.readOnly = true;
      form.querySelector('button').disabled = true;
      try {
        await api(`/agents/${encodeURIComponent(slug)}/messages`, { method: 'POST', body: attempt });
        input.value = '';
        attempt = null;
        if (loading) await loading;
        await load();
        banner('Owner message stored. Await an actual agent reply; no command was executed.', 'ok');
      } catch (error) { banner(error.message, 'error'); }
      finally { sending = false; input.readOnly = false; form.querySelector('button').disabled = false; }
    });
    host.appendChild(form);
  }
  await load();
}

function citationLabel(row) {
  const source = row && row.citation;
  return source ? `${source.label} · cite ${source.recordId}` : '—';
}

function renderHeadAgent(data) {
  state.headAgent = data;
  const status = data.missionStatus || {};
  const agentStatus = status.agents || { total: 0, byStatus: {} };
  const realized = data.earnings?.realized;
  const expected = data.earnings?.contractedExpected;
  replace('#head-earnings-summary', el('div', { class: 'cards' }, [
    card('Verified received', headAmount(realized?.amount), `${realized?.count ?? 0} record(s)`),
    card('Contracted / expected', headAmount(expected?.amount), 'unverified · not earned'),
    card('Payout queue', status.payoutQueueRecords ?? 0, 'awaiting owner review'),
  ]));
  replace('#head-earnings-realized', table([
    { label: 'Receipt', render: (row) => row.id },
    { label: 'Amount', render: (row) => headAmount(row.amount) },
    { label: 'Source', key: 'source' },
    { label: 'Verifier', key: 'verifier' },
    { label: 'Citation', render: citationLabel },
  ], realized?.records || [], 'No verified received revenue records.'));
  replace('#head-earnings-expected', table([
    { label: 'Record', key: 'id' },
    { label: 'Amount', render: (row) => headAmount(row.amount) },
    { label: 'Status', key: 'status' },
    { label: 'Source', key: 'source' },
    { label: 'Citation', render: citationLabel },
  ], expected?.records || [], 'No contracted or expected records.'));
  replace('#head-provider-readiness', table([
    { label: 'Provider', key: 'label' },
    { label: 'Kind', key: 'kind' },
    { label: 'Status', render: (row) => pill(row.status, row.status === 'ready' ? 'ok' : row.status === 'blocked' ? 'bad' : 'warn') },
    { label: 'Credential env', key: 'credentialEnv' },
    { label: 'Payout verifiable', render: (row) => row.payoutVerifiable ? 'yes' : 'no' },
    { label: 'Latest failure', render: (row) => row.latestFailure ? `${row.latestFailure.code} (${row.latestFailure.category})` : '—', wrap: true },
    { label: 'Citation', render: citationLabel },
  ], data.providers || [], 'No provider readiness records.'));
  replace('#head-payout-queue', table([
    { label: 'Payout', key: 'id' },
    { label: 'State', key: 'status' },
    { label: 'Amount', render: (row) => headAmount(row.amount) },
    { label: 'Slot verification', render: (row) => row.slotVerification?.status || '—' },
    { label: 'Settlement', key: 'settlement' },
    { label: 'Citation', render: citationLabel },
  ], data.payouts || [], 'No payout queue records.'));
  replace('#head-opportunities', table([
    { label: 'Opportunity', key: 'id' },
    { label: 'Source', key: 'source' },
    { label: 'Provider', key: 'provider' },
    { label: 'State', key: 'state' },
    { label: 'Quote', render: (row) => headAmount(row.quote) },
    { label: 'Evidence', key: 'evidenceHash' },
    { label: 'Consent expires', render: (row) => when(row.consentExpiresAt) },
    { label: 'Citation', render: citationLabel },
  ], data.opportunities || [], 'No discovery opportunity records. No demand or earnings is inferred.'));
  replace('#head-approvals', table([
    { label: 'Approval', key: 'id' },
    { label: 'Subject', render: (row) => `${row.subjectType}:${row.subjectId}` },
    { label: 'Action', key: 'action' },
    { label: 'Amount', render: (row) => headAmount(row.amount) },
    { label: 'State', key: 'status' },
    { label: 'Citation', render: citationLabel },
  ], data.approvals || [], 'No approval records.'));
  const note = $('#head-approvals-note');
  if (note) note.textContent = `Updated ${when(data.generatedAt)}. Read-only and notify-only; email/WhatsApp delivery is ${data.notificationDelivery || 'UNKNOWN / VERIFY REQUIRED'}.`;
}

async function loadHeadAgentOverview() {
  if (!canMutate()) return;
  const data = await api('/mission/head-agent/overview');
  renderHeadAgent(data);
}

async function loadHeadAgentNotifications() {
  if (!canMutate()) return;
  try {
    const data = await api('/mission/head-agent/notifications?limit=50');
    const badge = $('#head-agent-notification');
    if (badge) {
      badge.hidden = !data.unreadCount;
      badge.textContent = data.unreadCount ? `${data.unreadCount} alert${data.unreadCount === 1 ? '' : 's'}` : '';
    }
    if (state.headAgent && Array.isArray(data.alerts)) {
      state.headAgent.alerts = data.alerts;
      state.headAgent.missionStatus.openAlerts = data.unreadCount;
    }
  } catch (error) {
    if (error.status !== 401) console.warn('head-agent notification poll failed', error);
  }
}

function bountyTargetRow(target = '', targetType = 'repo') {
  const row = el('div', { class: 'bounty-target-row' });
  const input = el('input', { name: 'target', placeholder: 'org/repo or example.com', required: 'required', value: target });
  const select = el('select', { name: 'targetType' }, [
    el('option', { value: 'repo', text: 'repo' }), el('option', { value: 'domain', text: 'domain' }),
    el('option', { value: 'package', text: 'package' }), el('option', { value: 'API', text: 'API' }),
  ]);
  select.value = targetType;
  const remove = el('button', { type: 'button', class: 'ghost small', text: 'Remove target' });
  remove.addEventListener('click', () => row.remove());
  row.append(input, select, remove);
  return row;
}

function addBountyTarget(target = '', targetType = 'repo') {
  const host = $('#bounty-registration-targets');
  if (host) host.appendChild(bountyTargetRow(target, targetType));
}

function clearTermsResult(message = '') {
  const hash = $('#bounty-terms-hash');
  if (hash) hash.value = '';
  const meta = $('#bounty-terms-meta');
  if (meta) { meta.textContent = ''; meta.hidden = true; }
  const previewRegion = $('#bounty-terms-preview-region');
  if (previewRegion) previewRegion.hidden = true;
  const status = $('#bounty-terms-status');
  if (status) status.textContent = message;
}

function termsHashValid() {
  return /^[0-9a-f]{64}$/i.test(String($('#bounty-terms-hash')?.value || '').trim());
}

function updateBountySubmitState() {
  const button = $('#bounty-registration-submit');
  if (button) button.disabled = !termsHashValid();
}

async function fetchBountyTermsForForm() {
  const url = String($('#bounty-scope-url')?.value || '').trim();
  const status = $('#bounty-terms-status');
  if (!/^https:\/\/[^\s]+$/i.test(url)) { clearTermsResult('Enter a valid https:// scope URL before fetching terms.'); updateBountySubmitState(); return; }
  const button = $('#bounty-fetch-terms');
  button.disabled = true;
  clearTermsResult('Fetching terms…');
  try {
    const result = await api('/bounty/programs/fetch-terms', { method: 'POST', body: { scopeUrl: url } });
    $('#bounty-terms-hash').value = result.sha256 || '';
    $('#bounty-terms-meta').textContent = `sha256: ${result.sha256} · byteLength: ${result.byteLength} · fetchedAt: ${result.fetchedAt}`;
    $('#bounty-terms-meta').hidden = false;
    $('#bounty-terms-preview').textContent = result.contentPreview || '';
    $('#bounty-terms-preview-region').hidden = false;
    status.textContent = 'Terms fetched. Review the preview and scope before registering.';
  } catch (error) {
    clearTermsResult(`${error.code || 'error'}: ${error.message}`);
  } finally { button.disabled = false; updateBountySubmitState(); }
}

function bountyProgramCard(program, scope) {
  const targets = (scope || []).filter((row) => row.inScope === true || Number(row.in_scope) === 1);
  const card = el('article', { class: 'card bounty-program-card' });
  const title = el('div', { class: 'bounty-card-title' }, [el('strong', { text: `${program.platform} / ${program.programHandle}` }), pill(program.active ? 'active' : 'inactive', program.active ? 'ok' : 'warn')]);
  const listed = targets.slice(0, MAX_TARGET_LINES);
  const targetList = targets.length
    ? el('ul', { class: 'bounty-card-targets' }, [
      ...listed.map((row) => el('li', { text: `${row.target} (${row.targetType || row.target_type || 'unknown'})` })),
      ...(targets.length > listed.length ? [el('li', { class: 'muted', text: `${targets.length - listed.length} more in scope — the allowlist form below is the full record` })] : []),
    ])
    : el('p', { class: 'muted small', text: 'No in-scope targets saved. Activation is disabled.' });
  const actions = el('div', { class: 'action-stack' });
  const toggle = el('button', { type: 'button', class: program.active ? 'ghost' : '', text: program.active ? 'Deactivate' : 'Activate' });
  toggle.disabled = !program.active && targets.length === 0;
  if (!program.active && targets.length === 0) toggle.title = 'Add at least one in-scope target before activating.';
  toggle.addEventListener('click', async () => {
    if (!isOwnerSession() || (!program.active && targets.length === 0)) return;
    toggle.disabled = true;
    try { await api(`/bounty/programs/${encodeURIComponent(program.id)}`, { method: 'PATCH', body: { active: !program.active } }); await loadBountyControl(); banner(`Program ${program.active ? 'deactivated' : 'activated'}.`, 'ok'); }
    catch (error) { toggle.disabled = false; banner(error.message, 'error'); }
  });
  actions.appendChild(toggle);
  card.append(title, el('p', { class: 'muted small', text: `In-scope targets: ${targets.length}` }), targetList, actions);
  return card;
}

async function renderBountyPrograms(programs) {
  const host = $('#bounty-programs');
  if (!host) return;
  host.replaceChildren();
  if (!programs || programs.length === 0) { host.appendChild(el('p', { class: 'empty-state muted', text: 'No bounty programs registered yet. The worker stays idle until a program is active with at least one in-scope target.' })); return; }
  const visible = programs.slice(0, MAX_TABLE_ROWS);
  const cards = await Promise.all(visible.map(async (program) => {
    try { const result = await api(`/bounty/programs/${encodeURIComponent(program.id)}/scope`); return bountyProgramCard(program, result.scope || []); }
    catch (error) { return el('article', { class: 'card', children: [], text: `${program.platform} / ${program.programHandle}: ${error.message}` }); }
  }));
  host.append(...cards);
  if (programs.length > visible.length) {
    host.appendChild(el('p', { class: 'muted small', text: `${programs.length - visible.length} more registered program(s) not shown; they remain active and auditable through the API.` }));
  }
}

async function loadBountyControl() {
  if (!isOwnerSession()) return;
  const [programs, agents, findings, events, providers, platforms, reputation, lessons] = await Promise.all([
    api('/bounty/programs'), api('/bounty/agents'), api('/bounty/findings'), api('/bounty/scope-events'),
    api('/mission/model-providers'), api('/bounty/platforms'), api('/bounty/reputation'), api('/bounty/lessons'),
  ]);
  await renderBountyPrograms(programs.programs || []);
  replace('#bounty-agent-registry', table([
    { label: 'Agent type', key: 'type' }, { label: 'Capability', key: 'capabilityDescription', wrap: true },
    { label: 'Required tools', render: (row) => (row.requiredTools || []).join(', ') }, { label: 'Concurrency', key: 'maxConcurrency' },
    { label: 'Quality gate', render: (row) => row.qualityGateRequired ? 'required' : 'not required' },
  ], agents.agents || [], 'No agent capability definitions loaded.'));
  replace('#bounty-findings', table([
    { label: 'Finding', key: 'id' }, { label: 'Target', key: 'target' }, { label: 'Class', key: 'vulnerability_class' },
    { label: 'State', key: 'state' }, { label: 'Fingerprint', key: 'finding_fingerprint', wrap: true },
    { label: 'CVSS', render: (row) => row.cvss_score === null || row.cvss_score === undefined ? 'unverified' : `${row.cvss_score} ${row.cvss_vector || ''}` },
    { label: 'Approved', render: (row) => row.approved_by ? `owner ${row.approved_by}` : 'no' },
  ], findings.findings || [], 'No findings. Weak, duplicate or out-of-scope records never reach submission.'));
  replace('#bounty-scope-events', table([
    { label: 'When', render: (row) => when(row.created_at) }, { label: 'Target', key: 'target' }, { label: 'Decision', render: (row) => pill(row.decision, row.decision === 'allowed' ? 'ok' : 'bad') },
    { label: 'Reason', key: 'reason', wrap: true }, { label: 'Agent', key: 'agent_type' },
  ], events.events || [], 'No scope-gate events.'));
  replace('#bounty-providers', table([
    { label: 'Provider', key: 'displayName' }, { label: 'Priority', key: 'priority' },
    { label: 'Enabled', render: (row) => row.enabled ? pill('enabled', 'ok') : pill('disabled', 'warn') },
    { label: 'Health', render: (row) => pill(row.healthStatus || 'unknown', row.healthStatus === 'ok' ? 'ok' : 'warn') },
    { label: 'Vault key', key: 'credentialVaultKey' }, { label: 'Fallback events', render: (row) => row.fallbackEvents || 'visible in logs' },
  ], providers.providers || [], 'No model provider metadata. No credentials are displayed.'));
  replace('#bounty-platforms', table([
    { label: 'Platform', key: 'displayName' }, { label: 'Category', key: 'category' }, { label: 'Adapter', render: (row) => pill(row.adapterStatus, row.adapterStatus === 'ready_public_source' ? 'ok' : 'warn') },
    { label: 'Last sync', render: (row) => row.lastSyncAt ? when(row.lastSyncAt) : 'never' }, { label: 'Reads', render: (row) => row.authRequiredForReads ? 'owner credential later' : 'public only' },
  ], platforms.adapters || [], 'No adapter metadata.'));
  replace('#bounty-reputation', table([
    { label: 'Program', key: 'programHandle' }, { label: 'Submitted', key: 'findingsSubmitted' }, { label: 'Accepted', key: 'accepted' }, { label: 'Rejected', key: 'rejected' },
    { label: 'Duplicate rate', render: (row) => `${Math.round((row.duplicateRate || 0) * 100)}%` }, { label: 'Risk', render: (row) => pill(row.riskLevel, row.riskLevel === 'healthy' ? 'ok' : 'warn') },
  ], reputation.reputation || [], 'No program reputation data. No outcomes are inferred.'));
  replace('#bounty-lessons', table([
    { label: 'Reason', key: 'reasonCode' }, { label: 'Count', key: 'count' }, { label: 'Last seen', render: (row) => when(row.lastSeen) },
  ], lessons.summary || [], 'No rejection lessons recorded.'));
}

async function loadSpecialistRecords() {
  const data = await api('/specialists?limit=50');
  const rows = data.records || [];
  replace('#specialist-records', table([
    { label: 'Agent', key: 'agentId' },
    { label: 'Specialty', render: (row) => `${row.specialtyLabel}${(row.workKinds || []).length ? ` — ${row.workKinds.join(', ')}` : ''}`, wrap: true },
    { label: 'Venue', key: 'platformId' },
    { label: 'State', render: (row) => pill(String(row.state ?? 'unassigned'), row.state === 'WORKING' || row.state === 'EXECUTION_READY' ? 'ok' : 'warn') },
    { label: 'Skill', render: (row) => `${row.skillLevel}/100` },
    { label: 'Work', render: (row) => `ranked ${row.work.ranked} · assigned ${row.work.assigned} · delivered ${row.work.delivered} · dropped ${row.work.dropped}` },
    { label: 'Evidence', render: (row) => `${row.evidence.passedSuites}/${row.evidence.gradedSuites} suites · ${row.evidence.transitions} transitions` },
    { label: 'Verified', render: (row) => `${row.verified.accepted} accepted · ${row.verified.paymentVerified} paid` },
    { label: 'Earnings', render: (row) => money(row.earningsCents, 'USD') },
  ], rows, 'No specialist is paired yet. Assign a verified venue — do not create a placeholder row to fill this table.'));
}

async function loadTab(tab) {
  const loaded = state.loadedTabs || (state.loadedTabs = new Set());
  if (loaded.has(tab)) return;
  loaded.add(tab);
  try {
    if (tab === 'overview') {
      const overview = await api('/overview');
      state.overview = overview;
      renderOverview(overview);
      if (canMutate()) await loadHeadAgentOverview();
    }
    if (tab === 'agents') {
      await loadAgents();
      // The per-agent specialist record is its own collapsed block, so each screen stays inside its
      // height budget; opening either of them refreshes both, because the roster and the record are
      // read from the same rows and must never disagree on screen.
      await loadSpecialistRecords();
    }
    if (tab === 'specialist-records') await loadSpecialistRecords();
    // The Bounty section's three collapsed blocks are parts of the same screen as the section: the
    // one bounty loader fills all of their hosts, so opening a block loads the family's data.
    if (['bounties', 'bounty-registration', 'bounty-scope', 'bounty-catalogs'].includes(tab)) await loadBountyControl();
    // The intake block and the workbench block are the same screen read two ways: one loader, one
    // refresh, so a saved request never shows up in one and not the other.
    if (tab === 'customer-work' || tab === 'customer-intake') await loadCustomerWork();
    if (tab === 'money') await loadVerifiedCash();
    if (tab === 'treasury') await loadTreasury();
    if (tab === 'withdraw') await loadWithdraw();
    if (tab === 'approvals') {
      if (canMutate()) await loadHeadAgentOverview();
      await loadApprovals();
    }
    if (tab === 'tools') await loadTools();
    if (tab === 'policy') await loadPolicy();
    if (tab === 'audit') await loadAudit();
  } catch (error) {
    loaded.delete(tab);
    banner(error.message, 'error');
  }
}

/** Opening a collapsed block is a navigation event: it loads that block's data once. */
function wireSubSections(root = document) {
  for (const details of $$('details.sub[data-view]', root)) {
    details.addEventListener('toggle', () => {
      const view = details.getAttribute('data-view');
      if (details.open) {
        void loadTab(view);
        // The open block is the view, so the URL says so: a reload, a shared link and the back
        // button all land on the same thing the owner is looking at.
        writeRoute(view);
      } else if (state.activeTab === view) {
        writeRoute(groupOfView(view) || view);
      }
    });
  }
}

/**
 * Owner controls on a single agent: pause / resume / retire, and the wallet
 * controls (fund working capital, set the authorised budget, freeze). Every
 * action goes to the real API and refreshes the report from the server, so what
 * is displayed is always the server's answer — never an optimistic guess.
 */
function renderAgentControls(report) {
  const slug = report.agent.slug;
  const wallet = report.wallet;
  const block = el('details', { class: 'control-block' });
  block.appendChild(el('summary', { text: 'Owner controls' }));
  const body = el('div', { class: 'stack-form' });
  block.appendChild(body);

  const reason = el('input', { placeholder: 'reason (required to pause or retire)', maxlength: '200' });

  const statusRow = el('div', { class: 'inline-form' }, [
    el('button', { class: 'small', text: 'Pause', type: 'button' }),
    el('button', { class: 'small', text: 'Resume', type: 'button' }),
    el('button', { class: 'small', text: 'Retire', type: 'button' }),
    reason,
  ]);
  const [pauseButton, resumeButton, retireButton] = $$('button', statusRow);
  const setStatus = async (status) => {
    try {
      if (status !== 'active' && reason.value.trim().length < 3) {
        banner('A reason is required to pause or retire an agent.', 'error');
        return;
      }
      await api(`/agents/${encodeURIComponent(slug)}/status`, { method: 'POST', body: { status, reason: reason.value.trim() } });
      banner(`Agent ${slug} is now ${status}.`, 'ok');
      await refreshAgentReport(slug);
    } catch (error) {
      banner(error.message, 'error');
    }
  };
  pauseButton.addEventListener('click', () => setStatus('paused'));
  resumeButton.addEventListener('click', () => setStatus('active'));
  retireButton.addEventListener('click', () => setStatus('retired'));

  body.appendChild(el('div', { class: 'label', text: 'Agent state' }));
  body.appendChild(statusRow);
  body.appendChild(el('p', { class: 'muted small', text: 'A paused agent cannot take work, request tools, resources, upgrades or expenses until it is resumed. Every change is audited.' }));

  if (wallet) {
    body.appendChild(el('div', { class: 'label', text: `Wallet ${wallet.id} — balance ${money(wallet.balanceCents, wallet.currency)} / budget ${money(wallet.budgetCents, wallet.currency)}` }));
    const fundAmount = el('input', { type: 'number', min: '1', step: '1', placeholder: 'amount in minor units' });
    const fundReference = el('input', { placeholder: 'funding reference (bank transfer / statement line)', maxlength: '160' });
    const fundForm = el('div', { class: 'inline-form' }, [fundAmount, fundReference, el('button', { class: 'small', type: 'button', text: 'Fund wallet' })]);
    $('button', fundForm).addEventListener('click', async () => {
      try {
        const amountCents = Number(fundAmount.value);
        if (!Number.isFinite(amountCents) || amountCents <= 0) {
          banner('Enter a positive amount.', 'error');
          return;
        }
        const key = `ui-fund-${slug}-${Date.now().toString(36)}`;
        const result = await api(`/wallets/${encodeURIComponent(wallet.id)}/fund`, {
          method: 'POST',
          body: { amountCents, reference: fundReference.value.trim(), idempotencyKey: key, memo: `funded from the mission console by the owner` },
        });
        banner(result.duplicated ? 'That funding request was already applied.' : `Funded ${money(amountCents, wallet.currency)} (owner capital, not revenue).`, 'ok');
        await refreshAgentReport(slug);
      } catch (error) {
        banner(error.message, 'error');
      }
    });
    body.appendChild(el('div', { class: 'label', text: 'Fund working capital' }));
    body.appendChild(fundForm);
    body.appendChild(el('p', { class: 'muted small', text: 'Working capital is recorded as owner_capital in the ledger. Revenue is only ever recorded against a verified external payment.' }));

    const budgetInput = el('input', { type: 'number', min: '0', step: '1', value: String(wallet.budgetCents) });
    const freezeButton = el('button', { class: 'small', type: 'button', text: wallet.status === 'frozen' ? 'Unfreeze' : 'Freeze' });
    const budgetRow = el('div', { class: 'inline-form' }, [budgetInput, el('button', { class: 'small', type: 'button', text: 'Set budget' }), freezeButton]);
    const [setBudgetButton] = $$('button', budgetRow);
    setBudgetButton.addEventListener('click', async () => {
      try {
        await api(`/wallets/${encodeURIComponent(wallet.id)}`, { method: 'PATCH', body: { budgetCents: Number(budgetInput.value) } });
        banner('Wallet budget updated.', 'ok');
        await refreshAgentReport(slug);
      } catch (error) {
        banner(error.message, 'error');
      }
    });
    freezeButton.addEventListener('click', async () => {
      try {
        await api(`/wallets/${encodeURIComponent(wallet.id)}`, {
          method: 'PATCH',
          body: { status: wallet.status === 'frozen' ? 'active' : 'frozen' },
        });
        banner(wallet.status === 'frozen' ? 'Wallet unfrozen.' : 'Wallet frozen — it cannot spend until it is unfrozen.', 'ok');
        await refreshAgentReport(slug);
      } catch (error) {
        banner(error.message, 'error');
      }
    });
    body.appendChild(el('div', { class: 'label', text: 'Authorised budget / wallet state' }));
    body.appendChild(budgetRow);
    body.appendChild(el('p', { class: 'muted small', text: 'The budget is authority to spend, not money: funding adds balance, the budget allows it to be spent. A frozen wallet refuses every spend.' }));
  }

  const workForm = el('div', { class: 'inline-form' }, [
    el('input', { placeholder: 'assign work — title', maxlength: '160' }),
    el('button', { class: 'small', type: 'button', text: 'Assign work' }),
  ]);
  $('button', workForm).addEventListener('click', async () => {
    try {
      const title = $('input', workForm).value.trim();
      if (title.length < 3) {
        banner('A title is required to assign work.', 'error');
        return;
      }
      // The agent's own category is the activity it is authorised to perform;
      // fall back to the first policy-allowed activity offered by the console.
      const activity = report.agent.category || $('#create-agent-activity').value || 'software_development';
      const created = await api('/work', { method: 'POST', body: { agentSlug: slug, title, activity, description: 'Assigned from the mission console.' } });
      banner(`Work assigned to ${slug} (${created.work.status}).`, 'ok');
      await refreshAgentReport(slug);
    } catch (error) {
      banner(error.message, 'error');
    }
  });
  body.appendChild(el('div', { class: 'label', text: 'Assign work' }));
  body.appendChild(workForm);
  return block;
}

async function refreshAgentReport(slug) {
  const report = await api(`/agents/${encodeURIComponent(slug)}/report`);
  renderAgentReport(report);
}

async function loadAgents(query = '') {
  const payload = await api(`/agents?limit=50${query ? `&q=${encodeURIComponent(query)}` : ''}`);
  const rows = payload.agents.map((agent) => ({
    ...agent,
    open: el('button', { class: 'small', text: 'Open report' }),
  }));
  const node = table([
    { label: 'Slug', key: 'slug' },
    { label: 'Name', key: 'name' },
    { label: 'Category', render: (row) => row.category || '—' },
    { label: 'Role', key: 'mission_role' },
    { label: 'Depth', key: 'depth' },
    { label: 'Status', key: 'status' },
    { label: '', render: (row) => row.open },
  // The picker budget applies because the roster lives in a folded block whose section must fit three
  // screens; the button indices below still line up, since the capped rows are the first rows.
  ], rows, 'No agents match.', { maxRows: MAX_PICKER_ROWS });
  $$('button', node).forEach((button, index) => {
    const agent = rows[index];
    button.addEventListener('click', async () => {
      try {
        const report = await api(`/agents/${encodeURIComponent(agent.slug)}/report`);
        renderAgentReport(report);
      } catch (error) {
        banner(error.message, 'error');
      }
    });
  });
  replace('#agent-list', node);
}

/**
 * The payout verification form: every required control check plus the attestation.
 * Nothing is activated here — the server refuses a partial confirmation with the
 * exact missing checks, which is what makes the flow evidence-based.
 */
function renderSlotVerification(slotsPayload) {
  const host = $('#slot-verification');
  if (!host) return;
  host.innerHTML = '';
  const slot = state.verifyingSlot;
  if (!slot) return;
  const checks = (slotsPayload.checks || []).filter((check) => check.required || (check.requiresProviderRef && (slotsPayload.slots || []).find((entry) => Number(entry.slot) === Number(slot))?.provider_ref));
  const form = el('form', { class: 'stack-form' });
  form.appendChild(el('h3', { text: `Verify payout destination — slot ${slot}` }));
  form.appendChild(
    el('p', {
      class: 'muted small',
      text: `Stored only as a provider reference or a masked description. A verification is valid for ${slotsPayload.validityDays} days, after which the slot pauses until it is re-verified.`,
    }),
  );
  const checkBoxes = [];
  for (const check of checks) {
    const id = `check-${check.key}`;
    const input = el('input', { type: 'checkbox', id, name: check.key });
    checkBoxes.push(input);
    form.appendChild(el('label', { class: 'checkbox' }, [input, el('span', { text: `${check.label}${check.required ? '' : ' (when a provider reference is set)'}` })]));
  }
  const evidence = el('input', { name: 'evidenceRef', placeholder: 'evidence reference (provider statement, last statement date…)' });
  const attestation = el('textarea', { name: 'attestation', rows: '3', placeholder: 'I control this destination, the details match my records, and the provider has verified my identity.' });
  form.appendChild(el('label', {}, [el('span', { text: 'Evidence reference' }), evidence]));
  form.appendChild(el('label', {}, [el('span', { text: 'Attestation (40+ characters, stored verbatim)' }), attestation]));
  const submit = el('button', { type: 'submit', text: 'Confirm verification' });
  const cancel = el('button', { type: 'button', class: 'ghost', text: 'Cancel' });
  form.appendChild(el('span', { class: 'actions' }, [submit, cancel]));
  cancel.addEventListener('click', () => {
    state.verifyingSlot = null;
    host.innerHTML = '';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!guardMutation()) return;
    const body = { checks: {}, attestation: attestation.value };
    for (const input of checkBoxes) body.checks[input.name] = input.checked;
    if (evidence.value) body.evidenceRef = evidence.value;
    try {
      await api(`/payout-slots/${slot}/verification/confirm`, { method: 'POST', body });
      state.verifyingSlot = null;
      banner(`Slot ${slot} verified: the destination is now payable (payouts still need owner approval).`, 'ok');
      await loadTreasury();
    } catch (error) {
      banner(error.message, 'error');
    }
  });
  host.appendChild(form);
}

/** Publishing connections: honest per-platform state, with the exact setup steps. */
async function loadTreasury() {
  const [treasury, slots, payouts, ledger, wallets] = await Promise.all([
    api('/treasury'), api('/payout-slots'), api('/payouts'), api('/ledger?limit=50'), api('/wallets'),
  ]);
  const currency = treasury.treasury.currency;
  const cards = $('#treasury-summary');
  cards.innerHTML = '';
  const totals = treasury.treasury.totals;
  cards.append(
    card('Total balance', money(totals.totalBalanceCents, currency)),
    card('Mission treasury', money(totals.missionBalanceCents, currency)),
    card('Agent wallets', money(totals.agentBalancesCents, currency)),
    card('Legacy reported revenue', money(totals.realizedRevenueCents, currency)),
    card('Pending revenue', money(totals.pendingRevenueCents, currency), 'contracted + expected'),
    card('Expenses', money(totals.totalExpensesCents, currency)),
    card('Legacy reported payouts', money(totals.settledPayoutsCents, currency)),
    card('Spend today', money(treasury.treasury.daily.spentTodayCents, currency), `cap ${money(treasury.treasury.daily.policyDailyCapCents, currency)}`),
  );

  // Verification is evidence, not a status flip: the slot row shows what the
  // server actually verified (checks, expiry, staleness) and the action opens the
  // confirmation form rather than activating anything by itself.
  const verificationBySlot = new Map((slots.verification || []).map((entry) => [Number(entry.slot), entry]));
  const slotRows = slots.slots.map((slot) => {
    const verification = verificationBySlot.get(Number(slot.slot));
    return {
      ...slot,
      verificationStatus: verification?.verification?.status || 'none',
      expires: verification?.expiresAt ? new Date(verification.expiresAt).toLocaleDateString() : '—',
      blockers: verification?.blockers?.length ? verification.blockers.join('; ') : '—',
      actions: el('span', {}, [
        canMutate() ? el('button', { class: 'small', text: 'Verify / re-verify', 'data-action': 'verify', 'data-slot': String(slot.slot) }) : null,
        canMutate() && verification?.verification?.status === 'verified'
          ? el('button', { class: 'small', text: 'Revoke verification', 'data-action': 'revoke', 'data-slot': String(slot.slot) }) : null,
        canMutate() ? el('button', { class: 'small', text: 'Pause', 'data-action': 'pause', 'data-slot': String(slot.slot) }) : null,
      ]),
    };
  });
  replace('#payout-slots', table([
    { label: 'Slot', key: 'slot' },
    { label: 'Label', key: 'label' },
    { label: 'Type', render: (row) => row.destination_type || '—' },
    { label: 'Provider ref', render: (row) => row.provider_ref || '—' },
    { label: 'Masked destination', render: (row) => row.masked_account || '—' },
    { label: 'Status', render: (row) => pill(String(row.status), row.status === 'active' ? 'ok' : 'warn') },
    { label: 'Verification', render: (row) => pill(String(row.verificationStatus), row.verificationStatus === 'verified' ? 'ok' : 'warn') },
    { label: 'Expires', key: 'expires' },
    { label: 'Blockers', key: 'blockers' },
    { label: 'Min payout', render: (row) => money(row.min_payout_cents, currency) },
    { label: 'Actions', render: (row) => row.actions },
  ], slotRows, 'Payout slots unavailable.'));

  renderSlotVerification(slots);
  $$('#payout-slots button[data-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!guardMutation()) return;
      const slot = Number(button.getAttribute('data-slot'));
      const action = button.getAttribute('data-action');
      try {
        if (action === 'verify') {
          state.verifyingSlot = slot;
          renderSlotVerification(slots);
          banner(`Slot ${slot}: confirm every control check and sign the attestation to verify it.`, 'ok');
          return;
        }
        if (action === 'revoke') {
          const reason = window.prompt('Why is this payout destination being revoked? (the slot is paused immediately)');
          if (!reason) return;
          await api(`/payout-slots/${slot}/verification/revoke`, { method: 'POST', body: { reason } });
          banner(`Slot ${slot}: verification revoked and slot paused.`, 'ok');
        } else {
          await api(`/payout-slots/${slot}/status`, { method: 'POST', body: { status: 'paused' } });
          banner(`Slot ${slot} paused.`, 'ok');
        }
        await loadTreasury();
      } catch (error) {
        banner(error.message, 'error');
      }
    });
  });

  const payoutRows = payouts.payouts.map((row) => ({
    ...row,
    actions: el('span', {}, [
      canMutate() && String(row.status) === 'pending_approval'
        ? el('button', { class: 'small', text: 'Approve', 'data-payout': String(row.id), 'data-decision': 'approved' }) : null,
      canMutate() && String(row.status) === 'pending_approval'
        ? el('button', { class: 'small', text: 'Reject', 'data-payout': String(row.id), 'data-decision': 'rejected' }) : null,
      canMutate() && ['approved', 'sent'].includes(String(row.status))
        ? el('button', { class: 'small', text: 'Record settled', 'data-settle': String(row.id), 'data-state': 'settled' }) : null,
      canMutate() && String(row.status) === 'approved'
        ? el('button', { class: 'small', text: 'Record sent', 'data-settle': String(row.id), 'data-state': 'sent' }) : null,
      canMutate() && ['approved', 'sent'].includes(String(row.status))
        ? el('button', { class: 'small danger', text: 'Record failure / return reservation', 'data-settle': String(row.id), 'data-state': 'failed' }) : null,
    ]),
  }));
  replace('#payouts', table([
    { label: 'Requested', render: (row) => when(row.created_at) },
    { label: 'Slot', key: 'slot' },
    { label: 'Amount', render: (row) => money(row.amount_cents, currency) },
    { label: 'Status', render: (row) => pill(String(row.status), row.status === 'settled' ? 'ok' : row.status === 'failed' ? 'bad' : 'warn') },
    { label: 'Source wallet', render: (row) => row.source_wallet_id || 'Legacy: ledger reconciliation required' },
    { label: 'Authorized destination', render: (row) => { try { const d = JSON.parse(row.destination_snapshot || '{}'); return [d.providerRef || d.maskedAccount || 'Unbound legacy request', d.currency || row.currency].join(' · '); } catch { return 'Invalid snapshot — review required'; } } },
    { label: 'Settlement ref / failure evidence', render: (row) => row.settlement_ref || row.failure_reason || '—' },
    { label: 'Actions', render: (row) => row.actions },
  ], payoutRows, 'No payouts requested.'));

  $$('#payouts button[data-payout]').forEach((button) => button.addEventListener('click', async () => {
    if (!guardMutation()) return;
    try {
      await api(`/payouts/${button.getAttribute('data-payout')}/decide`, {
        method: 'POST', body: { decision: button.getAttribute('data-decision') },
      });
      banner('Payout decision recorded.', 'ok');
      await loadTreasury();
    } catch (error) { banner(error.message, 'error'); }
  }));
  $$('#payouts button[data-settle]').forEach((button) => button.addEventListener('click', async () => {
    if (!guardMutation()) return;
    const status = button.getAttribute('data-state');
    const reference = window.prompt(status === 'failed' ? 'Provider failure evidence/reason (required). This returns only the internal reservation; it does not refund a bank transfer:' : 'Actual provider transfer reference (required). This records evidence only; it does not send money:');
    if (!reference?.trim()) return;
    try {
      await api(`/payouts/${button.getAttribute('data-settle')}/settle`, { method: 'POST', body: { status, ...(status === 'failed' ? { failureReason: reference.trim() } : { settlementRef: reference.trim() }) } });
      banner(`Payout evidence recorded as ${status}. No external payment was initiated here.`, 'ok');
      await loadTreasury();
    } catch (error) { banner(error.message, 'error'); }
  }));

  replace('#wallets', table([
    { label: 'Wallet', key: 'label' },
    { label: 'Kind', key: 'kind' },
    { label: 'Balance', render: (row) => money(row.balanceCents, currency) },
    { label: 'Budget', render: (row) => money(row.budgetCents, currency) },
    { label: 'Spent', render: (row) => money(row.spentCents, currency) },
    { label: 'Status', key: 'status' },
  ], wallets.wallets, 'No wallets yet.'));

  replace('#ledger', table([
    { label: 'When', render: (row) => when(row.createdAt) },
    { label: 'Direction', render: (row) => pill(row.direction, row.direction === 'credit' ? 'ok' : 'warn') },
    { label: 'Amount', render: (row) => money(row.amountCents, currency) },
    { label: 'Category', key: 'category' },
    { label: 'Memo', render: (row) => row.memo || '—', wrap: true },
    { label: 'Balance after', render: (row) => money(row.balanceAfter, currency) },
  ], ledger.entries, 'No ledger entries yet.'));
}

async function loadWithdraw() {
  const [treasury, slots, payouts, ledger, wallets] = await Promise.all([
    api('/treasury'), api('/payout-slots'), api('/withdraw?limit=100').catch(() => api('/payouts?limit=100')),
    api('/ledger?limit=50'), api('/wallets'),
  ]);
  const currency = treasury.treasury.currency;
  const totals = treasury.treasury.totals;
  const available = Number(totals.missionBalanceCents ?? 0);
  const cards = $('#withdraw-summary');
  if (cards) {
    cards.innerHTML = '';
    cards.append(
      card('Verified treasury (withdrawable)', money(totals.missionBalanceCents, currency), 'Only received + verifier counts'),
      card('Agent wallets (non-withdrawable until swept)', money(totals.agentBalancesCents, currency), 'Swept to treasury on receipt'),
      card('Total verified balance', money(totals.totalBalanceCents, currency)),
      card('Pending revenue (not withdrawable)', money(totals.pendingRevenueCents, currency), 'expected + contracted'),
      card('Ledger integrity', treasury.ledgerIntegrity ? (treasury.ledgerIntegrity.ok ? 'Verified' : 'FAILED') : 'Verified'),
      card('Withdrawable now', money(available, currency), available === 0 ? 'No verified funds yet' : 'Verified only'),
    );
  }
  const hint = $('#withdraw-balance-hint');
  if (hint) hint.textContent = `Verified treasury available for withdrawal: ${money(available, currency)}. Unverified/expected/contracted/synthetic cannot be withdrawn.`;
  const notice = $('#withdraw-notice');
  const hasVerifiedSlot = (slots.verification || []).some((v) => v.verification?.status === 'verified' && v.payable);
  const allUnconfigured = (slots.slots || []).every((s) => String(s.status) === 'unconfigured');
  if (notice) {
    if (allUnconfigured) {
      notice.textContent = 'No verified payout destination yet — internal verified balance can still accumulate. Configure a destination below (masked/provider reference only) and verify it before withdrawing.';
      notice.className = 'banner warn';
      notice.hidden = false;
    } else if (!hasVerifiedSlot) {
      notice.textContent = 'No payable (verified) slot — add/verify a destination before withdrawing. Balance accumulation continues; no account is required at setup.';
      notice.className = 'banner warn';
      notice.hidden = false;
    } else {
      notice.hidden = true;
    }
  }
  const verificationBySlot = new Map((slots.verification || []).map((e) => [Number(e.slot), e]));
  const slotRows = (slots.slots || []).map((slot) => {
    const v = verificationBySlot.get(Number(slot.slot));
    return {
      ...slot,
      verificationStatus: v?.verification?.status || 'none',
      expires: v?.expiresAt ? new Date(v.expiresAt).toLocaleDateString() : '—',
      blockers: v?.blockers?.length ? v.blockers.join('; ') : '—',
      actions: el('span', {}, [
        canMutate() ? el('button', { class: 'small', text: 'Verify / re-verify', 'data-action': 'verify', 'data-slot': String(slot.slot) }) : null,
        canMutate() && v?.verification?.status === 'verified' ? el('button', { class: 'small', text: 'Revoke verification', 'data-action': 'revoke', 'data-slot': String(slot.slot) }) : null,
        canMutate() ? el('button', { class: 'small', text: 'Pause', 'data-action': 'pause', 'data-slot': String(slot.slot) }) : null,
      ]),
    };
  });
  replace('#withdraw-slots', table([
    { label: 'Slot', key: 'slot' },
    { label: 'Label', key: 'label' },
    { label: 'Type', render: (r) => r.destination_type || '—' },
    { label: 'Provider ref', render: (r) => r.provider_ref || '—' },
    { label: 'Masked destination', render: (r) => r.masked_account || '—' },
    { label: 'Status', render: (r) => pill(String(r.status), r.status === 'active' ? 'ok' : 'warn') },
    { label: 'Verification', render: (r) => pill(String(r.verificationStatus), r.verificationStatus === 'verified' ? 'ok' : 'warn') },
    { label: 'Expires', key: 'expires' },
    { label: 'Blockers', key: 'blockers' },
    { label: 'Min payout', render: (r) => money(r.min_payout_cents, currency) },
    { label: 'Actions', render: (r) => r.actions },
  ], slotRows, 'Payout slots unavailable.'));
  const wHost = $('#withdraw-slot-verification');
  if (wHost) {
    wHost.innerHTML = '';
    const slot = state.verifyingSlot;
    if (slot) {
      const checks = (slots.checks || []).filter((c) => c.required || (c.requiresProviderRef && (slots.slots || []).find((e) => Number(e.slot) === Number(slot))?.provider_ref));
      const form = el('form', { class: 'stack-form' });
      form.appendChild(el('h3', { text: `Verify payout destination — slot ${slot}` }));
      form.appendChild(el('p', { class: 'muted small', text: `Stored only as a provider reference or a masked description. A verification is valid for ${slots.validityDays} days.` }));
      const boxes = [];
      for (const check of checks) {
        const input = el('input', { type: 'checkbox', id: `w-check-${check.key}`, name: check.key });
        boxes.push(input);
        form.appendChild(el('label', { class: 'checkbox' }, [input, el('span', { text: `${check.label}${check.required ? '' : ' (when a provider reference is set)'}` })]));
      }
      const evidence = el('input', { name: 'evidenceRef', placeholder: 'evidence reference' });
      const attestation = el('textarea', { name: 'attestation', rows: '3', placeholder: 'I control this destination... (40+ characters)' });
      form.appendChild(el('label', {}, [el('span', { text: 'Evidence reference' }), evidence]));
      form.appendChild(el('label', {}, [el('span', { text: 'Attestation (40+ characters, stored verbatim)' }), attestation]));
      const submit = el('button', { type: 'submit', text: 'Confirm verification' });
      const cancel = el('button', { type: 'button', class: 'ghost', text: 'Cancel' });
      form.appendChild(el('span', { class: 'actions' }, [submit, cancel]));
      cancel.addEventListener('click', () => { state.verifyingSlot = null; wHost.innerHTML = ''; });
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); if (!guardMutation()) return;
        const body = { checks: {}, attestation: attestation.value };
        for (const b of boxes) body.checks[b.name] = b.checked;
        if (evidence.value) body.evidenceRef = evidence.value;
        try { await api(`/payout-slots/${slot}/verification/confirm`, { method: 'POST', body }); state.verifyingSlot = null; banner(`Slot ${slot} verified: now payable (payouts still need owner approval).`, 'ok'); await loadWithdraw(); } catch (err) { banner(err.message, 'error'); }
      });
      wHost.appendChild(form);
    }
  }
  $$('#withdraw-slots button[data-action]').forEach((b) => b.addEventListener('click', async () => {
    if (!guardMutation()) return;
    const slot = Number(b.getAttribute('data-slot'));
    const action = b.getAttribute('data-action');
    try {
      if (action === 'verify') { state.verifyingSlot = slot; await loadWithdraw(); banner(`Slot ${slot}: confirm every control check and sign the attestation to verify it.`, 'ok'); return; }
      if (action === 'revoke') { const reason = window.prompt('Why is this payout destination being revoked? (slot paused immediately)'); if (!reason) return; await api(`/payout-slots/${slot}/verification/revoke`, { method: 'POST', body: { reason } }); banner(`Slot ${slot}: verification revoked and slot paused.`, 'ok'); }
      else { await api(`/payout-slots/${slot}/status`, { method: 'POST', body: { status: 'paused' } }); banner(`Slot ${slot} paused.`, 'ok'); }
      await loadWithdraw();
    } catch (err) { banner(err.message, 'error'); }
  }));
  const list = payouts.payouts || payouts.withdrawals || [];
  const rows = list.map((row) => ({
    ...row,
    withdrawalStatus: row.withdrawalStatus || ({ pending_approval: 'REQUESTED', verifying: 'VERIFYING', approved: 'APPROVED', sent: 'PROCESSING', settled: 'PAID', failed: 'FAILED', rejected: 'FAILED' }[String(row.status)] || String(row.status).toUpperCase()),
    actions: el('span', {}, [
      canMutate() && String(row.status) === 'pending_approval' ? el('button', { class: 'small', text: 'Approve', 'data-payout': String(row.id), 'data-decision': 'approved' }) : null,
      canMutate() && String(row.status) === 'pending_approval' ? el('button', { class: 'small', text: 'Reject', 'data-payout': String(row.id), 'data-decision': 'rejected' }) : null,
      canMutate() && ['approved', 'sent'].includes(String(row.status)) ? el('button', { class: 'small', text: 'Record settled', 'data-settle': String(row.id), 'data-state': 'settled' }) : null,
      canMutate() && String(row.status) === 'approved' ? el('button', { class: 'small', text: 'Record sent', 'data-settle': String(row.id), 'data-state': 'sent' }) : null,
      canMutate() && ['approved', 'sent'].includes(String(row.status)) ? el('button', { class: 'small danger', text: 'Record failure / return reservation', 'data-settle': String(row.id), 'data-state': 'failed' }) : null,
    ]),
  }));
  replace('#withdrawals', table([
    { label: 'Requested', render: (r) => when(r.created_at) },
    { label: 'Slot', key: 'slot' },
    { label: 'Amount', render: (r) => money(r.amount_cents, currency) },
    { label: 'Withdrawal status', render: (r) => pill(String(r.withdrawalStatus), String(r.withdrawalStatus) === 'PAID' ? 'ok' : String(r.withdrawalStatus) === 'FAILED' ? 'bad' : 'warn') },
    { label: 'Payout status', render: (r) => pill(String(r.status), String(r.status) === 'settled' ? 'ok' : String(r.status) === 'failed' ? 'bad' : 'warn') },
    { label: 'Source wallet', render: (r) => r.source_wallet_id || 'Legacy' },
    { label: 'Authorized destination', render: (r) => { try { const d = JSON.parse(r.destination_snapshot || '{}'); return [d.providerRef || d.maskedAccount || 'Unbound', d.currency || r.currency].join(' · '); } catch { return 'Invalid snapshot'; } } },
    { label: 'Settlement ref / failure evidence', render: (r) => r.settlement_ref || r.failure_reason || '—' },
    { label: 'Actions', render: (r) => r.actions },
  ], rows, 'No withdrawals requested. Verified balance can accumulate without a payout slot; use the destination form when ready.'));
  $$('#withdrawals button[data-payout]').forEach((b) => b.addEventListener('click', async () => {
    if (!guardMutation()) return;
    try { await api(`/payouts/${b.getAttribute('data-payout')}/decide`, { method: 'POST', body: { decision: b.getAttribute('data-decision') } }); banner('Withdrawal decision recorded. Atomic reserve: payout:reserve on APPROVED; refund on FAILED.', 'ok'); await loadWithdraw(); } catch (e) { banner(e.message, 'error'); }
  }));
  $$('#withdrawals button[data-settle]').forEach((b) => b.addEventListener('click', async () => {
    if (!guardMutation()) return;
    const st = b.getAttribute('data-state');
    const ref = window.prompt(st === 'failed' ? 'Provider failure evidence/reason (required). This returns only the internal reservation; it does not refund a bank transfer:' : 'Actual provider transfer reference (required). This records evidence only; it does not send money:');
    if (!ref?.trim()) return;
    try { await api(`/payouts/${b.getAttribute('data-settle')}/settle`, { method: 'POST', body: { status: st, ...(st === 'failed' ? { failureReason: ref.trim() } : { settlementRef: ref.trim() }) } }); banner(`Withdrawal evidence recorded as ${st}. Atomic: ${st === 'failed' ? 'restored via payout:refund' : 'reserved via payout:reserve'}. No external payment was initiated here.`, 'ok'); await loadWithdraw(); } catch (e) { banner(e.message, 'error'); }
  }));
  replace('#withdraw-wallets', table([
    { label: 'Wallet', key: 'label' },
    { label: 'Kind', key: 'kind' },
    { label: 'Balance', render: (r) => money(r.balanceCents, currency) },
    { label: 'Budget', render: (r) => money(r.budgetCents, currency) },
    { label: 'Spent', render: (r) => money(r.spentCents, currency) },
    { label: 'Status', key: 'status' },
  ], wallets.wallets, 'No wallets yet. Every active agent has a wallet; treasury aggregates verified earnings.'));
  replace('#withdraw-ledger', table([
    { label: 'When', render: (r) => when(r.createdAt) },
    { label: 'Direction', render: (r) => pill(r.direction, r.direction === 'credit' ? 'ok' : 'warn') },
    { label: 'Amount', render: (r) => money(r.amountCents, currency) },
    { label: 'Category', key: 'category' },
    { label: 'Memo', render: (r) => r.memo || '—', wrap: true },
    { label: 'Balance after', render: (r) => money(r.balanceAfter, currency) },
  ], ledger.entries, 'No ledger entries yet. All movements are hash-chained and audited.'));
}

async function loadApprovals() {
  const [approvals, expenses, upgrades] = await Promise.all([api('/approvals'), api('/expenses'), api('/upgrades')]);
  const currency = state.overview ? state.overview.treasury.currency : 'USD';
  const rows = approvals.pending.map((row) => ({
    ...row,
    actions: el('span', {}, [
      canMutate() ? el('button', { class: 'small', text: 'Approve', 'data-approval': String(row.id), 'data-decision': 'approved' }) : null,
      canMutate() ? el('button', { class: 'small', text: 'Reject', 'data-approval': String(row.id), 'data-decision': 'rejected' }) : null,
    ]),
  }));
  replace('#approvals', table([
    { label: 'Requested', render: (row) => when(row.created_at) },
    { label: 'Subject', key: 'subject_type' },
    { label: 'Action', key: 'action' },
    { label: 'Amount', render: (row) => money(row.amount_cents, currency) },
    { label: 'Requested by', render: (row) => row.requested_by || '—' },
    { label: 'Note', render: (row) => row.note || '—', wrap: true },
    { label: 'Decision', render: (row) => row.actions },
  ], rows, 'Nothing awaiting approval.'));
  $$('#approvals button[data-approval]').forEach((button) => button.addEventListener('click', async () => {
    if (!guardMutation()) return;
    const id = button.getAttribute('data-approval');
    const decision = button.getAttribute('data-decision');
    try {
      // Money decisions also act on the underlying subject so an approval is
      // never a free-floating flag.
      const approval = approvals.pending.find((row) => String(row.id) === id);
      await api(`/approvals/${id}/decide`, { method: 'POST', body: { decision } });
      if (approval && approval.subject_type === 'expense') await api(`/expenses/${approval.subject_id}/decide`, { method: 'POST', body: { decision } });
      if (approval && approval.subject_type === 'upgrade') await api(`/upgrades/${approval.subject_id}/decide`, { method: 'POST', body: { decision } });
      if (approval && approval.subject_type === 'resource') await api(`/resources/${approval.subject_id}/decide`, { method: 'POST', body: { decision } });
      banner('Decision recorded.', 'ok');
      await loadApprovals();
    } catch (error) { banner(error.message, 'error'); }
  }));

  replace('#expense-requests', table([
    { label: 'Created', render: (row) => when(row.created_at) },
    { label: 'Category', key: 'category' },
    { label: 'Provider', key: 'provider' },
    { label: 'Description', render: (row) => row.description, wrap: true },
    { label: 'Amount', render: (row) => money(row.amount_cents, currency) },
    { label: 'Status', render: (row) => pill(String(row.status), String(row.status) === 'paid' ? 'ok' : String(row.status) === 'rejected' ? 'bad' : 'warn') },
  ], expenses.expenses, 'No expense requests.'));

  replace('#upgrades', table([
    { label: 'Requested', render: (row) => when(row.created_at) },
    { label: 'Capability', render: (row) => row.capability, wrap: true },
    { label: 'Cost', render: (row) => money(row.requested_cost_cents, currency) },
    { label: 'Budget ok', render: (row) => (Number(row.budget_ok) ? pill('within budget', 'ok') : pill('needs funding', 'warn')) },
    { label: 'Status', key: 'status' },
  ], upgrades.upgrades, 'No upgrade requests.'));
}

async function loadTools() {
  $('#credential-form').hidden = !canMutate();
  if (!canMutate()) replace('#resource-periods', el('p', { text: 'Owner sign-in is required to review resource billing periods.' }));
  if (!canMutate()) replace('#resource-calls', el('p', { text: 'Owner sign-in is required to review resource calls.' }));
  const [tools, credentials, resources, services] = await Promise.all([
    api('/tools'), api('/credentials'), api('/resources'), api('/services'),
  ]);
  const currency = state.overview ? state.overview.treasury.currency : 'USD';

  const toolRows = tools.tools.map((tool) => ({
    ...tool,
    actions: canMutate()
      ? el('span', {}, [
        el('button', { class: 'small', text: 'Approve', 'data-tool': String(tool.key), 'data-status': 'approved' }),
        el('button', { class: 'small', text: 'Restrict', 'data-tool': String(tool.key), 'data-status': 'restricted' }),
        el('button', { class: 'small', text: 'Block', 'data-tool': String(tool.key), 'data-status': 'blocked' }),
      ])
      : null,
  }));
  replace('#tools', table([
    { label: 'Tool', key: 'name' },
    { label: 'Key', key: 'key' },
    { label: 'Category', key: 'category' },
    { label: 'Cost model', key: 'cost_model' },
    { label: 'Status', render: (row) => pill(String(row.status), String(row.status) === 'approved' ? 'ok' : String(row.status) === 'blocked' ? 'bad' : 'warn') },
    { label: 'Provider terms', render: (row) => row.terms_url || '—' },
    { label: 'Set status', render: (row) => row.actions },
  ], toolRows, 'No tools configured.'));
  $$('#tools button[data-tool]').forEach((button) => button.addEventListener('click', async () => {
    if (!guardMutation()) return;
    try {
      await api(`/tools/${encodeURIComponent(button.getAttribute('data-tool'))}`, { method: 'POST', body: { status: button.getAttribute('data-status') } });
      banner('Tool status updated.', 'ok');
      await loadTools();
    } catch (error) { banner(error.message, 'error'); }
  }));

  const credentialRows = credentials.credentials.map((credential) => ({
    ...credential,
    actions: canMutate()
      ? el('span', {}, [
        el('button', { class: 'small', text: 'Rotate', 'data-rotate': credential.id }),
        el('button', { class: 'small', text: 'Revoke', 'data-revoke': credential.id }),
      ])
      : null,
  }));
  replace('#credentials', table([
    { label: 'Provider', key: 'provider' },
    { label: 'Label', key: 'label' },
    { label: 'Masked', key: 'maskedHint' },
    { label: 'Local permissions', render: row => (row.scope || []).join(', ') || 'None recorded' },
    { label: 'Env var', render: (row) => row.envVar || '—' },
    { label: 'Status', render: (row) => pill(String(row.status), String(row.status) === 'active' ? 'ok' : 'warn') },
    { label: 'Expires', render: (row) => (row.expiresAt ? `${when(row.expiresAt)} (${row.daysUntilExpiry} d)` : '—') },
    { label: 'Rotations', key: 'rotationCount' },
    { label: 'Actions', render: (row) => row.actions },
  ], credentialRows, 'No credentials stored. Vault state shown above.'));
  $$('#credentials button[data-rotate]').forEach((button) => button.addEventListener('click', async () => {
    if (!guardMutation()) return;
    const secret = window.prompt('New provider value (stored encrypted; never displayed again):');
    if (!secret) return;
    try {
      await api(`/credentials/${button.getAttribute('data-rotate')}/rotate`, {
        method: 'POST', body: { secret, reason: 'manual rotation from dashboard', verified: false },
      });
      banner('Credential rotated. Mark it verified only after a real provider call succeeds.', 'ok');
      await loadTools();
    } catch (error) { banner(error.message, 'error'); }
  }));
  $$('#credentials button[data-revoke]').forEach((button) => button.addEventListener('click', async () => {
    if (!guardMutation()) return;
    if (!window.confirm('Revoke this credential?')) return;
    try {
      await api(`/credentials/${button.getAttribute('data-revoke')}/revoke`, { method: 'POST', body: { reason: 'revoked from dashboard' } });
      banner('Credential revoked.', 'ok');
      await loadTools();
    } catch (error) { banner(error.message, 'error'); }
  }));

  replace('#resources', table([
    { label: 'Kind', key: 'kind' },
    { label: 'Provider', key: 'provider' },
    { label: 'Plan', render: (row) => row.plan || '—' },
    { label: 'Monthly cost', render: (row) => money(row.monthly_cost_cents, currency) },
    { label: 'Status', key: 'status' },
    { label: 'Renews', render: (row) => when(row.renews_at) },
    { label: 'Expires', render: (row) => when(row.expires_at) },
    { label: 'Usability', render: (row) => row.readiness?.usable ? 'Ready according to recorded checks' : (row.readiness?.blockers || ['Not checked']).join('; ') },
    { label: 'Provisioning ref', render: (row) => row.provisioning_ref || 'No evidence recorded' },
    { label: 'Billing periods', render: row => canMutate() ? el('button', { class: 'small', text: 'Review periods', 'data-resource-periods': row.id }) : 'Owner-only' },
    { label: 'Quota calls', render: row => canMutate() ? el('button', { class: 'small', text: 'Review calls', 'data-resource-calls': row.id }) : 'Owner-only' },
    { label: 'Credential binding', render: row => canMutate() && row.status !== 'retired' ? el('button', { class: 'small', text: 'Bind credential', 'data-bind-credential': row.id }) : (row.credential_id || 'Not bound') },
    { label: 'Action', render: (row) => canMutate() && ['approved', 'needs_verification'].includes(row.status) ? el('button', { class: 'small', text: 'Record provisioning', 'data-provision': row.id }) : '—' },
  ], resources.resources, 'No resources requested.'));
  $$('#resources button[data-resource-periods]').forEach(button => button.addEventListener('click', async () => {
    if (!guardMutation()) return;
    try { await renderResourcePeriods(resources.resources.find(row => row.id === button.getAttribute('data-resource-periods'))); } catch (error) { banner(error.message, 'error'); }
  }));
  $$('#resources button[data-resource-calls]').forEach(button => button.addEventListener('click', async () => {
    if (!guardMutation()) return;
    try { await renderResourceCalls(resources.resources.find(row => row.id === button.getAttribute('data-resource-calls'))); } catch (error) { banner(error.message, 'error'); }
  }));
  $$('#resources button[data-bind-credential]').forEach(button => button.addEventListener('click', async () => {
    if (!guardMutation()) return;
    try { await renderResourceCredentialBinding(resources.resources.find(row => row.id === button.getAttribute('data-bind-credential'))); } catch (error) { banner(error.message, 'error'); }
  }));
  $$('#resources button[data-provision]').forEach(button => button.addEventListener('click', async () => {
    if (!guardMutation()) return;
    try { await renderResourceProvision(resources.resources.find(row => row.id === button.getAttribute('data-provision'))); } catch (error) { banner(error.message, 'error'); }
  }));

  replace('#services', table([
    { label: 'Service', key: 'name' },
    { label: 'Kind', key: 'kind' },
    { label: 'Health', key: 'status' },
    { label: 'Source', render: (row) => row.health_source || '—' },
    { label: 'Checked', render: (row) => when(row.last_checked_at) },
  ], services.services, 'No services registered.'));
}

async function renderResourcePeriods(resource) {
  if (!resource || !canMutate()) return;
  const host = $('#resource-periods');
  const history = el('div', { class: 'table-wrap' });
  const older = el('button', { type: 'button', text: 'Older billing periods', hidden: true });
  const refresh = el('button', { type: 'button', text: 'Refresh billing history' });
  let cursor = null, rows = [], loading = null;
  const load = async (reset = false) => {
    if (loading) { await loading; return load(reset); }
    older.disabled = true; refresh.disabled = true;
    loading = (async () => {
      try {
        const result = await api(`/resources/${resource.id}/periods?limit=50${!reset && cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`);
        if (reset) rows = [];
        const seen = new Set(rows.map(row => row.id));
        rows.push(...result.periods.filter(row => !seen.has(row.id)));
        cursor = result.nextCursor;
        history.replaceChildren(table([{ label: 'Start', render: row => when(row.period_start) }, { label: 'End', render: row => when(row.period_end) }, { label: 'Archived usage', key: 'previous_usage', wrap: true }, { label: 'Starting usage', key: 'starting_usage', wrap: true }, { label: 'Actual charge', render: row => money(row.actual_cost_cents, row.currency) }, { label: 'Evidence', key: 'evidence', wrap: true }], rows, 'No evidenced renewal periods recorded.'));
        older.hidden = !cursor;
      } finally { loading = null; older.disabled = false; refresh.disabled = false; }
    })();
    return loading;
  };
  host.replaceChildren(el('h3', { text: `Billing periods — ${resource.provider}` }), el('p', { class: 'muted small', text: 'An auto-renew flag is intent, not a purchase. Record only an actual current provider period. Resolve all quota and financial holds first. Prior usage is archived; no provider is contacted and no external payment is executed.' }), history, older, refresh);
  older.addEventListener('click', () => { void load().catch(error => banner(error.message, 'error')); });
  refresh.addEventListener('click', () => { void load(true).catch(error => banner(error.message, 'error')); });
  await load(true);
  if (resource.status !== 'active' || !resource.provisioned_at || !resource.expires_at) {
    host.appendChild(el('p', { text: 'A previously provisioned, non-retired resource with a known prior expiry is required before a renewed period can be recorded.' }));
    return;
  }
  const [wallets, policy] = await Promise.all([api('/wallets'), api('/policy')]);
  const currency = policy.policy.currency;
  const limits = typeof resource.limits === 'string' ? JSON.parse(resource.limits) : (resource.limits || {});
  const form = el('form', { class: 'stack-form' });
  form.append(el('h4', { text: 'Record a renewed current period' }), el('p', { text: `Prior expiry: ${when(resource.expires_at)} UTC. Enter provider period dates in your browser’s local time. Accounting currency: ${currency}. No cost or starting usage is assumed.` }));
  form.append(el('label', {}, ['Provider period start', el('input', { name: 'periodStart', type: 'datetime-local', required: '', 'aria-label': 'Provider period start' })]), el('label', {}, ['Provider period end', el('input', { name: 'periodEnd', type: 'datetime-local', required: '', 'aria-label': 'Provider period end' })]));
  const wallet = el('select', { name: 'walletId', 'aria-label': 'Renewal funding wallet' }, [el('option', { value: '', text: 'Choose funded mission wallet (required for a charge)' }), ...wallets.wallets.filter(row => row.currency === currency && (!row.agentId || row.agentId === resource.agent_id)).map(row => el('option', { value: row.id, text: `${row.label} — ${money(row.balanceCents, currency)}` }))]);
  form.append(wallet, el('input', { name: 'actualCostCents', type: 'number', min: 0, max: resource.monthly_cost_cents, step: 1, required: '', 'aria-label': 'Actual renewal charge in minor units' }));
  const counters = Object.keys(limits).sort().map(key => {
    const cap = el('input', { type: 'number', min: 0, step: 'any', value: limits[key], required: '', 'aria-label': `New ${key} limit` });
    const usage = el('input', { type: 'number', min: 0, step: 'any', required: '', 'aria-label': `Starting ${key} usage` });
    form.append(el('label', {}, [`Provider ${key} limit for this period`, cap]), el('label', {}, [`Actual starting ${key} usage`, usage]));
    return { key, cap, usage };
  });
  form.append(el('input', { name: 'providerRef', required: '', minlength: 4, maxlength: 200, 'aria-label': 'Renewal charge reference' }), el('textarea', { name: 'evidence', required: '', minlength: 12, maxlength: 2000, 'aria-label': 'Provider period evidence without secrets' }), el('button', { type: 'submit', text: 'Record evidenced renewal — no purchase' }));
  let saving = false, attempt = null;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !guardMutation() || !form.reportValidity()) return;
    saving = true; form.querySelector('button').disabled = true;
    try {
      const body = { expectedExpiresAt: resource.expires_at, periodStart: new Date(form.elements.periodStart.value).toISOString(), periodEnd: new Date(form.elements.periodEnd.value).toISOString(), actualCostCents: Number(form.elements.actualCostCents.value), currency, ...(wallet.value ? { walletId: wallet.value } : {}), limits: Object.fromEntries(counters.map(row => [row.key, Number(row.cap.value)])), startingUsage: Object.fromEntries(counters.map(row => [row.key, Number(row.usage.value)])), providerRef: form.elements.providerRef.value, evidence: form.elements.evidence.value };
      const signature = JSON.stringify(body);
      if (!attempt || attempt.signature !== signature) attempt = { signature, key: crypto.randomUUID() };
      await api(`/resources/${resource.id}/periods`, { method: 'POST', body: { ...body, idempotencyKey: attempt.key } });
      form.replaceWith(el('p', { text: 'Evidenced period and private accounting recorded; previous usage archived. No purchase or external payment executed.' }));
      await load(true); await loadTools();
      banner('Provider period recorded, not purchased or independently verified.', 'ok');
    } catch (error) { banner(error.message, 'error'); }
    finally { saving = false; form.querySelector('button').disabled = false; }
  });
  host.appendChild(form);
}

async function renderResourceCalls(resource) {
  if (!resource || !canMutate()) return;
  const host = $('#resource-calls');
  const transcript = el('div', { class: 'table-wrap' });
  const editor = el('div');
  const next = el('button', { type: 'button', text: 'Load older calls', hidden: true });
  const refresh = el('button', { type: 'button', text: 'Refresh calls' });
  host.replaceChildren(el('h3', { text: `Resource calls — ${resource.provider}` }), el('p', { class: 'muted small', text: 'Cancel only unstarted reservations. Reconcile unknown outcomes using actual provider usage evidence, never guessed zero usage. These controls never call a provider or execute external payments/refunds. Usage reconciliation and financial receipt accounting are separate.' }), transcript, next, refresh, editor);
  let rows = [], cursor = null, loading = null;
  const load = async (reset = false) => {
    if (loading) { await loading; return load(reset); }
    next.disabled = true; refresh.disabled = true;
    loading = (async () => {
    try {
      const payload = await api(`/resources/${encodeURIComponent(resource.id)}/calls?limit=50${!reset && cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`);
      if (reset) rows = [];
      const seen = new Set(rows.map(row => row.id));
      rows.push(...payload.calls.filter(row => !seen.has(row.id)));
      cursor = payload.nextCursor;
      transcript.replaceChildren(table([
        { label: 'Call', key: 'id', wrap: true }, { label: 'State', key: 'status' },
        { label: 'Reserved quota', render: row => JSON.stringify(row.reservedUsage) },
        { label: 'Actual usage', render: row => row.actualUsage ? JSON.stringify(row.actualUsage) : 'Unknown / not reconciled' },
        { label: 'Financial exposure', render: row => row.budget ? `${row.budget.status}: ${row.budget.reservedCents} ${row.budget.currency} minor units reserved; actual ${row.budget.actualCents ?? 'unknown'}` : 'Quota-only call; no financial hold' },
        { label: 'Deadline', render: row => when(row.deadlineAt) },
        { label: 'Provider reference', render: row => row.providerRef || 'No receipt' },
        { label: 'Evidence', key: 'evidence', wrap: true },
        { label: 'Owner action', render: row => {
          if (row.status === 'reserved') {
            const button = el('button', { type: 'button', class: 'small', text: 'Cancel unstarted', 'data-cancel-call': row.id });
            button.addEventListener('click', async () => {
              if (!guardMutation() || button.disabled) return;
              button.disabled = true;
              try { await api(`/resources/${resource.id}/calls/${row.id}/cancel`, { method: 'POST', body: {} }); await load(true); banner('Unstarted quota hold cancelled. No provider call or money movement.', 'ok'); }
              catch (error) { banner(error.message, 'error'); }
              finally { button.disabled = false; }
            });
            return button;
          }
          if (['dispatched', 'uncertain'].includes(row.status)) {
            const button = el('button', { type: 'button', class: 'small', text: 'Reconcile usage', 'data-reconcile-call': row.id });
            button.addEventListener('click', () => editReceipt(row));
            return button;
          }
          if (row.budget?.status === 'held' && ['succeeded', 'failed'].includes(row.status)) {
            const button = el('button', { type: 'button', class: 'small', text: 'Record charge evidence', 'data-record-call-cost': row.id });
            button.addEventListener('click', () => editCost(row));
            return button;
          }
          return 'Final record';
        } },
      ], rows, 'No provider-call reservations recorded.'));
      next.hidden = !cursor;
    } finally { loading = null; next.disabled = false; refresh.disabled = false; }
    })();
    return loading;
  };
  const editReceipt = call => {
    if (!guardMutation()) return;
    const form = el('form', { class: 'stack-form' });
    form.appendChild(el('h4', { text: `Actual usage receipt — ${call.id}` }));
    const outcome = el('select', { name: 'outcome', required: '', 'aria-label': 'Actual provider outcome' }, [el('option', { value: '', text: 'Choose evidenced outcome' }), el('option', { value: 'succeeded', text: 'Provider operation succeeded' }), el('option', { value: 'failed', text: 'Provider operation failed (usage may still be incurred)' })]);
    form.appendChild(outcome);
    const counters = Object.keys(call.reservedUsage).sort().map(key => {
      const input = el('input', { type: 'number', min: 0, step: 'any', required: '', 'aria-label': `Actual ${key}` });
      form.appendChild(el('label', {}, [`Actual ${key} (from provider evidence)`, input]));
      return { key, input };
    });
    form.append(el('input', { name: 'providerRef', required: '', minlength: 4, maxlength: 200, 'aria-label': 'Provider usage reference' }), el('textarea', { name: 'evidence', required: '', minlength: 12, maxlength: 2000, 'aria-label': 'Usage evidence without secrets' }), el('button', { type: 'submit', text: 'Record actual usage evidence' }));
    let saving = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (saving || !guardMutation()) return;
      if (!form.reportValidity()) return;
      saving = true; form.querySelector('button').disabled = true;
      try {
        const actualUsage = Object.fromEntries(counters.map(({ key, input }) => [key, Number(input.value)]));
        await api(`/resources/${resource.id}/calls/${call.id}/reconcile`, { method: 'POST', body: { outcome: outcome.value, actualUsage, providerRef: form.elements.providerRef.value, evidence: form.elements.evidence.value } });
        editor.replaceChildren(el('p', { text: 'Usage evidence recorded. No provider verification, payment or refund was performed.' }));
        await load(true);
      } catch (error) { banner(error.message, 'error'); }
      finally { saving = false; form.querySelector('button').disabled = false; }
    });
    editor.replaceChildren(form);
  };
  const editCost = call => {
    if (!guardMutation()) return;
    const form = el('form', { class: 'stack-form' });
    form.append(el('h4', { text: `Financial receipt — ${call.id}` }), el('p', { text: `This records an evidenced charge in the private ${call.budget.currency} ledger and releases the financial hold. It does not pay a provider. Do not substitute a token estimate for a financial receipt.` }), el('input', { name: 'actualCostCents', type: 'number', min: 0, step: 1, required: '', 'aria-label': 'Actual charge in minor units' }), el('input', { name: 'providerRef', required: '', minlength: 4, maxlength: 200, 'aria-label': 'Provider charge reference' }), el('textarea', { name: 'evidence', required: '', minlength: 12, maxlength: 2000, 'aria-label': 'Financial evidence without secrets' }), el('button', { type: 'submit', text: 'Record evidenced charge — no external payment' }));
    let saving = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (saving || !guardMutation() || !form.reportValidity()) return;
      saving = true; form.querySelector('button').disabled = true;
      try {
        await api(`/resources/${resource.id}/calls/${call.id}/record-cost`, { method: 'POST', body: { actualCostCents: Number(form.elements.actualCostCents.value), providerRef: form.elements.providerRef.value, evidence: form.elements.evidence.value } });
        editor.replaceChildren(el('p', { text: 'Owner-evidenced charge recorded in the private ledger. No external payment executed.' }));
        await load(true);
      } catch (error) { banner(error.message, 'error'); }
      finally { saving = false; form.querySelector('button').disabled = false; }
    });
    editor.replaceChildren(form);
  };
  next.addEventListener('click', () => { void load().catch(error => banner(error.message, 'error')); });
  refresh.addEventListener('click', () => { void load(true).catch(error => banner(error.message, 'error')); });
  await load(true);
}

async function renderResourceCredentialBinding(resource) {
  if (!resource || !canMutate()) return;
  const credentials = (await api('/credentials')).credentials;
  const form = el('form', { class: 'stack-form' });
  form.appendChild(el('h3', { text: `Bind stored credential — ${resource.provider}` }));
  form.appendChild(el('p', { class: 'muted small', text: 'Select a credential already stored in the vault. This changes only its resource binding, not provider verification, provisioning or quota usage. Never paste a secret into the reason.' }));
  const select = el('select', { name: 'credentialId', required: '', 'aria-label': 'Stored provider credential' }, [el('option', { value: '', text: 'Choose a current same-provider credential' })]);
  for (const credential of credentials.filter(row => row.provider === resource.provider && ['active', 'expiring'].includes(row.status) && (!row.expiresAt || Date.parse(row.expiresAt) > Date.now()))) {
    select.appendChild(el('option', { value: credential.id, text: `${credential.label} · ${credential.status}` }));
  }
  form.append(select, el('textarea', { name: 'reason', minlength: 12, maxlength: 1000, required: '', 'aria-label': 'Binding reason without secrets' }), el('button', { type: 'submit', text: 'Record credential binding' }));
  let saving = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !guardMutation()) return;
    saving = true;
    form.querySelector('button').disabled = true;
    try {
      const body = { ...Object.fromEntries(new FormData(form)), expectedCredentialId: resource.credential_id || null };
      await api(`/resources/${resource.id}/credential`, { method: 'POST', body });
      replace('#resource-credential', el('p', { text: 'Credential binding recorded. This is not provider verification or a purchase.' }));
      await loadTools();
    } catch (error) { banner(error.message, 'error'); }
    finally { saving = false; form.querySelector('button').disabled = false; }
  });
  replace('#resource-credential', form);
}

async function renderResourceProvision(resource) {
  if (!resource) return;
  const wallets = (await api('/wallets')).wallets;
  const form = el('form', { class: 'stack-form' });
  form.appendChild(el('h3', { text: `Record provider provisioning — ${resource.provider}` }));
  form.appendChild(el('p', { class: 'muted small', text: 'Record only an actual provider invoice/subscription and evidence. This posts the verified expense from a mission wallet; it does not purchase a resource or call a payment provider. Never enter credentials here.' }));
  const select = el('select', { name: 'walletId', 'aria-label': 'Funding mission wallet' }, [el('option', { value: '', text: 'Choose funding wallet (required for paid resources)' })]);
  for (const wallet of wallets) select.appendChild(el('option', { value: wallet.id, text: `${wallet.label} · ${money(wallet.balanceCents, wallet.currency)}` }));
  form.appendChild(select);
  form.appendChild(el('label', {}, ['Actual cost, in minor units', el('input', { name: 'actualCostCents', type: 'number', min: 0, max: resource.monthly_cost_cents, step: 1, value: resource.monthly_cost_cents, required: '' })]));
  form.appendChild(el('label', {}, ['Provider invoice/subscription reference', el('input', { name: 'providerRef', minlength: 4, required: '', autocomplete: 'off' })]));
  form.appendChild(el('label', {}, ['Provisioning evidence (no secrets)', el('textarea', { name: 'evidence', minlength: 12, required: '' })]));
  form.appendChild(el('button', { type: 'submit', text: 'Record funded provisioning evidence' }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!guardMutation()) return;
    const body = Object.fromEntries(new FormData(form));
    body.actualCostCents = Number(body.actualCostCents);
    if (!body.walletId) delete body.walletId;
    try {
      await api(`/resources/${resource.id}/provision`, { method: 'POST', body });
      replace('#resource-provision', el('p', { class: 'muted small', text: 'Provisioning evidence and expense recorded. Credential/quota readiness is shown separately.' }));
      await loadTools();
      banner('Provisioning recorded; no external purchase was initiated.', 'ok');
    } catch (error) { banner(error.message, 'error'); }
  });
  replace('#resource-provision', form);
}

async function loadPolicy() {
  const payload = await api('/policy');
  const policy = payload.policy;
  replace('#policy', table([
    { label: 'Setting', key: 'setting' },
    { label: 'Value', key: 'value' },
  ], [
    { setting: 'Kill switch', value: policy.killSwitch ? 'ENGAGED' : 'released' },
    { setting: 'Autonomous operation', value: policy.autonomousEnabled ? 'enabled' : 'disabled (owner approval for each action)' },
    { setting: 'Agent creation', value: policy.allowAgentCreation ? 'allowed within limits' : 'disabled' },
    { setting: 'Max depth', value: policy.maxDepth },
    { setting: 'Max children per agent', value: policy.maxChildrenPerAgent },
    { setting: 'Max agents', value: policy.maxAgents },
    { setting: 'Daily spend ceiling', value: money(policy.maxDailySpendCents, policy.currency) },
    { setting: 'Per-transaction ceiling', value: money(policy.maxExpenseCents, policy.currency) },
    { setting: 'Approval threshold', value: money(policy.requireApprovalAboveCents, policy.currency) },
    { setting: 'Payout ceiling', value: money(policy.maxPayoutCents, policy.currency) },
    { setting: 'Owner approval required for payouts', value: policy.requireOwnerForPayout ? 'yes' : 'no' },
    { setting: 'Enabled activity categories', value: policy.allowedActivities.join(', ') },
  ]));

  // The checkbox mirrors the stored policy; it is the only way the switch moves from this console,
  // and a non-owner session cannot move it at all (the handler re-checks server-side too).
  const autonomyBox = $('#policy-autonomous');
  if (autonomyBox) {
    autonomyBox.checked = Boolean(policy.autonomousEnabled);
    autonomyBox.disabled = !isOwnerSession();
  }

  replace('#prohibitions', table([
    { label: 'Key', key: 'key' },
    { label: 'Prohibited', key: 'statement', wrap: true },
  ], (state.overview && state.overview.policy.prohibitions) || payload.prohibitions || [], 'No prohibitions loaded.'));
}

async function loadAudit() {
  const payload = await api('/audit?limit=200');
  replace('#audit-verification', table([
    { label: 'Chain', render: () => 'Audit trail' },
    { label: 'State', render: () => (payload.verification.ok ? pill('verified', 'ok') : pill('BROKEN', 'bad')) },
    { label: 'Entries', render: () => payload.verification.rows },
    { label: 'Detail', render: () => payload.verification.detail || '—' },
  ], [{}]));
  replace('#audit', table([
    { label: 'Seq', key: 'seq' },
    { label: 'When', render: (row) => when(row.created_at) },
    { label: 'Actor', render: (row) => `${row.actor_type}${row.actor_id ? `:${row.actor_id}` : ''}` },
    { label: 'Action', key: 'action' },
    { label: 'Subject', render: (row) => `${row.subject_type || '—'}${row.subject_id ? `:${row.subject_id}` : ''}` },
    { label: 'Detail', render: (row) => row.detail || '—', wrap: true },
  ], payload.entries, 'No audit entries.'));
}

// ── wiring ──────────────────────────────────────────────────────────────────
function wire() {
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#login-button');
    const error = $('#login-error');
    error.hidden = true;
    button.disabled = true;
    try {
      await login($('#email').value.trim(), $('#password').value);
      $('#password').value = '';
    } catch (caught) {
      error.textContent = caught.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });

  $('#signout').addEventListener('click', async () => {
    try { await api('/session/logout', { method: 'POST' }); } catch { /* session may already be gone */ }
    signOut();
  });

  $('#bounty-platform').addEventListener('change', (event) => {
    const other = $('#bounty-other-platform-wrap');
    const input = $('#bounty-other-platform');
    other.hidden = event.target.value !== 'other';
    input.required = event.target.value === 'other';
  });
  $('#bounty-add-target').addEventListener('click', () => addBountyTarget());
  $('#bounty-fetch-terms').addEventListener('click', () => { void fetchBountyTermsForForm(); });
  $('#bounty-terms-hash').addEventListener('input', updateBountySubmitState);
  $('#bounty-terms-hash').addEventListener('blur', () => {
    const status = $('#bounty-terms-status');
    if ($('#bounty-terms-hash').value && !termsHashValid()) status.textContent = 'Terms hash must be exactly 64 hexadecimal characters.';
    updateBountySubmitState();
  });
  addBountyTarget();

  $('#bounty-program-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!isOwnerSession()) { banner('Bug bounty program configuration requires the mission owner session.', 'error'); return; }
    if (!termsHashValid()) { banner('Enter or fetch a valid 64-character terms hash before registering.', 'error'); return; }
    const form = event.target;
    const submit = $('#bounty-registration-submit');
    const status = $('#bounty-registration-status');
    const platformSelect = $('#bounty-platform').value;
    const platform = platformSelect === 'other' ? String($('#bounty-other-platform').value || '').trim() : platformSelect;
    const scopeUrl = String($('#bounty-scope-url').value || '').trim();
    const rows = $$('#bounty-registration-targets .bounty-target-row').map((row) => ({ target: String($('input', row).value || '').trim(), targetType: $('select', row).value })).filter((row) => row.target);
    if (!platform || !scopeUrl || !/^https:\/\/[^\s]+$/i.test(scopeUrl) || !termsHashValid()) { status.textContent = 'Platform, handle, https scope URL, and a valid terms hash are required.'; return; }
    if ($$('#bounty-registration-targets .bounty-target-row input').some((input) => !input.value.trim())) { status.textContent = 'Remove empty target rows or fill them before saving.'; return; }
    submit.disabled = true;
    status.textContent = 'Saving inactive program…';
    let program;
    const failedTargets = [];
    try {
      const created = await api('/bounty/programs', { method: 'POST', body: { platform, programHandle: String(form.programHandle.value || '').trim(), scopeUrl, programTermsHash: String($('#bounty-terms-hash').value).trim(), active: false } });
      program = created.program;
      for (const row of rows) {
        try { await api(`/bounty/programs/${encodeURIComponent(program.id)}/scope`, { method: 'POST', body: { target: row.target, targetType: row.targetType, inScope: true } }); }
        catch (error) { failedTargets.push(`${row.target} (${error.code || 'error'}: ${error.message})`); }
      }
      if (failedTargets.length) {
        status.textContent = `Partial failure: the program was created but these targets failed: ${failedTargets.join('; ')}. The program was NOT activated.`;
        banner('Partial failure — program was not activated.', 'error');
        await loadBountyControl();
        return;
      }
      if ($('#bounty-activate-now').checked && rows.length > 0) {
        status.textContent = 'Activating after all scope rows saved…';
        await api(`/bounty/programs/${encodeURIComponent(program.id)}`, { method: 'PATCH', body: { active: true } });
      }
      form.reset(); $('#bounty-other-platform-wrap').hidden = true; clearTermsResult(); $('#bounty-registration-targets').replaceChildren(); addBountyTarget(); updateBountySubmitState();
      await loadBountyControl();
      status.textContent = 'Program registered successfully.';
      banner('Bounty program registered. Scope was saved before activation.', 'ok');
    } catch (error) {
      if (error.code === 'program_exists') { status.textContent = `${error.code}: ${error.message} Use the existing program card instead. No further requests were sent.`; banner('That program already exists. Use its existing card instead.', 'error'); return; }
      status.textContent = program ? `Registration failed after program creation: ${error.code || 'error'}: ${error.message}. The program was NOT activated.` : `${error.code || 'error'}: ${error.message}`;
      banner(status.textContent, 'error');
    } finally { submit.disabled = !termsHashValid(); }
  });

  $('#bounty-scope-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!isOwnerSession()) { banner('Scope configuration requires the mission owner session.', 'error'); return; }
    const form = event.target;
    const data = new FormData(form);
    try {
      await api(`/bounty/programs/${encodeURIComponent(data.get('programId'))}/scope`, { method: 'POST', body: { target: data.get('target'), targetType: data.get('targetType'), inScope: data.has('inScope'), authRequired: data.has('authRequired') } });
      form.reset();
      await loadBountyControl();
      banner('Scope entry saved. Only explicit in-scope entries can pass the hard gate.', 'ok');
    } catch (error) { banner(error.message, 'error'); }
  });

  wireSubSections();
  $('#tabs').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-tab]');
    if (!button) return;
    // One entry point, so a click, a shared link and a back step all leave the
    // same thing on screen.
    await activateTab(button.getAttribute('data-tab'), { navigate: true });
  });

  // Back / forward and hand-written routes. Both events are watched: history
  // moves fired by pushState arrive as popstate, address-bar and fragment
  // changes arrive as hashchange, and a host that suppresses one still gets the
  // other.
  // An absent or unknown fragment means the pre-routing default: back/forward
  // has to agree with the address bar, so returning to the bare URL shows
  // Overview rather than leaving a stale view under an empty hash.
  const followRoute = () => {
    const view = routeFromHash(window.location.hash) || 'overview';
    if (view !== state.activeTab) void activateTab(view);
  };
  window.addEventListener('hashchange', followRoute);
  window.addEventListener('popstate', followRoute);

  $('#agent-search').addEventListener('submit', async (event) => {
    event.preventDefault();
    await loadAgents(new FormData(event.target).get('q') || '');
  });

  // Create a root mission agent. The server gates the creation itself (hierarchy
  // depth/children policy, agent cap, activity allowlist) and answers with the
  // agent, its contract and its wallet — the console shows that answer and opens
  // the new report, so what is on screen is always the server's own state.
  $('#create-agent-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!guardMutation()) return;
    const form = event.target;
    const field = (name) => form.querySelector(`[name="${name}"]`);
    const body = {
      name: (field('name').value || '').trim(),
      specialization: (field('specialization').value || '').trim(),
      activity: $('#create-agent-activity').value,
      missionRole: field('missionRole').value,
      budgetCents: Number(field('budgetCents').value) || 0,
    };
    if (body.name.length < 3) {
      banner('A name of at least 3 characters is required to create an agent.', 'error');
      return;
    }
    try {
      const created = await api('/agents', { method: 'POST', body });
      banner(`Agent ${created.agent.slug} created — wallet ${created.wallet.id}, budget ${money(created.wallet.budgetCents, created.wallet.currency)}.`, 'ok');
      form.reset();
      await loadAgents();
      renderAgentReport(await api(`/agents/${encodeURIComponent(created.agent.slug)}/report`));
    } catch (error) {
      banner(error.message, 'error');
    }
  });

  $('#target-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!guardMutation()) return;
    const data = new FormData(event.target);
    try {
      await api('/targets', {
        method: 'POST',
        body: { label: data.get('label'), period: data.get('period'), amountCents: Number(data.get('amountCents')) },
      });
      banner('Target added. Progress counts verified receipts only.', 'ok');
      event.target.reset();
      await loadTab('overview');
    } catch (error) { banner(error.message, 'error'); }
  });

  $('#slot-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!guardMutation()) return;
    const data = new FormData(event.target);
    const body = { slot: Number(data.get('slot')) };
    for (const key of ['label', 'destinationType', 'holderName', 'maskedAccount', 'providerRef']) {
      if (data.get(key)) body[key] = data.get(key);
    }
    if (data.get('minPayoutCents') !== null && data.get('minPayoutCents') !== '') body.minPayoutCents = Number(data.get('minPayoutCents'));
    try {
      await api(`/payout-slots/${body.slot}`, { method: 'POST', body });
      banner('Slot saved. Confirm the control checks and attestation before any payout can target it.', 'ok');
      event.target.reset();
      await loadTreasury();
    } catch (error) { banner(error.message, 'error'); }
  });

  $('#payout-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!guardMutation()) return;
    const data = new FormData(event.target);
    try {
      await api('/payouts', {
        method: 'POST',
        body: {
          slot: Number(data.get('slot')),
          amountCents: Number(data.get('amountCents')),
          memo: data.get('memo') || undefined,
          idempotencyKey: `dash-${Date.now()}`,
        },
      });
      banner('Payout requested — it needs an owner approval before funds move.', 'ok');
      event.target.reset();
      await loadTreasury();
    } catch (error) { banner(error.message, 'error'); }
  });

  $('#withdraw-slot-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!guardMutation()) return;
    const data = new FormData(event.target);
    const body = { slot: Number(data.get('slot')) };
    for (const key of ['label', 'destinationType', 'holderName', 'maskedAccount', 'providerRef']) {
      if (data.get(key)) body[key] = data.get(key);
    }
    if (data.get('minPayoutCents') !== null && data.get('minPayoutCents') !== '') body.minPayoutCents = Number(data.get('minPayoutCents'));
    try {
      await api(`/payout-slots/${body.slot}`, { method: 'POST', body });
      banner('Withdraw destination saved (masked/provider reference only). Verify it before requesting a withdrawal — no raw account is stored.', 'ok');
      event.target.reset();
      await loadWithdraw();
    } catch (error) { banner(error.message, 'error'); }
  });

  $('#withdraw-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!guardMutation()) return;
    const data = new FormData(event.target);
    const slot = Number(data.get('slot'));
    const amountCents = Number(data.get('amountCents'));
    if (!Number.isFinite(amountCents) || amountCents <= 0) { banner('Enter a positive amount (verified balance only).', 'error'); return; }
    try {
      // Prefer the explicit /withdraw endpoint (same atomic guard as /payouts) — fallback to /payouts if the server version is older.
      try {
        const result = await api('/withdraw', { method: 'POST', body: { slot, amountCents, memo: data.get('memo') || undefined, idempotencyKey: `withdraw-${Date.now()}` } });
        banner(`Withdrawal ${result.withdrawalStatus || 'REQUESTED'} — needs owner approval; atomically reserved (payout:reserve) on approval. Balance remains while slots are unconfigured.`, 'ok');
      } catch (withdrawError) {
        if (withdrawError.code === 'unknown' || String(withdrawError.message).includes('not found')) throw withdrawError;
        // If /withdraw is not recognised, fall back to legacy /payouts which enforces the same verification + atomic guards.
        if (String(withdrawError.message).includes('404') || String(withdrawError.message).includes('not found')) {
          await api('/payouts', { method: 'POST', body: { slot, amountCents, memo: data.get('memo') || undefined, idempotencyKey: `dash-withdraw-${Date.now()}` } });
          banner('Withdrawal requested (via payouts) — it needs an owner approval before funds move. Atomic deduct/freeze on approval.', 'ok');
        } else throw withdrawError;
      }
      event.target.reset();
      await loadWithdraw();
    } catch (error) { banner(error.message, 'error'); }
  });

  let storingCredential = false;
  $('#credential-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (storingCredential || !guardMutation()) return;
    const form = event.target;
    if (!form.reportValidity()) return;
    storingCredential = true; form.querySelector('button').disabled = true;
    const data = new FormData(form);
    try {
      await api('/credentials', {
        method: 'POST',
        body: {
          provider: data.get('provider'),
          label: data.get('label'),
          secret: data.get('secret'),
          scope: data.get('scope') === 'model.call' ? ['model.call'] : [],
          expiresAt: data.get('expiresAt') || undefined,
          envVar: data.get('envVar') || undefined,
        },
      });
      banner('Credential stored encrypted. Its value will never be displayed. Local permission does not activate or verify a provider.', 'ok');
      form.reset();
      await loadTools();
    } catch (error) { banner(error.message, 'error'); }
    finally { storingCredential = false; form.querySelector('button').disabled = false; }
  });

  $('#policy-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!guardMutation()) return;
    const data = new FormData(event.target);
    const body = {};
    for (const key of ['maxDailySpendCents', 'requireApprovalAboveCents', 'maxPayoutCents']) {
      if (data.get(key)) body[key] = Number(data.get(key));
    }
    if (Object.keys(body).length === 0) return;
    try {
      await api('/policy', { method: 'PATCH', body });
      banner('Policy updated and audited.', 'ok');
      event.target.reset();
      await loadPolicy();
    } catch (error) { banner(error.message, 'error'); }
  });

  // Guarded because the render harnesses mount app.js against partial documents; a missing control
  // must degrade to "no switch here", never to a thrown wiring error that blanks the console.
  const autonomyForm = $('#autonomy-form');
  if (autonomyForm) {
    autonomyForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!guardMutation()) return;
      const box = $('#policy-autonomous');
      const next = Boolean(box && box.checked);
      try {
        await api('/policy', { method: 'PATCH', body: { autonomousEnabled: next } });
        banner(next
          ? 'Autonomous execution enabled by the owner. Payouts still need a verified destination and owner approval.'
          : 'Autonomous execution disabled by the owner: every action waits for approval again.', 'ok');
        await loadPolicy();
      } catch (error) { banner(error.message, 'error'); }
    });
  }

  $('#kill-on').addEventListener('click', async () => {
    if (!guardMutation()) return;
    try { await api('/kill-switch', { method: 'POST', body: { engage: true } }); banner('Kill switch engaged: all mission activity is suspended.', 'ok'); await loadPolicy(); }
    catch (error) { banner(error.message, 'error'); }
  });
  $('#kill-off').addEventListener('click', async () => {
    if (!guardMutation()) return;
    try { await api('/kill-switch', { method: 'POST', body: { engage: false } }); banner('Kill switch released.', 'ok'); await loadPolicy(); }
    catch (error) { banner(error.message, 'error'); }
  });
}

async function boot() {
  readLinkFromUrl();
  wire();
  // A bookmarked or shared #/<view> opens that view, and an old or
  // label-derived spelling is redirected to the canonical route so the address
  // bar shows what is actually on screen. Without a route this stays on
  // Overview, exactly as before.
  const route = routeFromHash(window.location.hash);
  if (route) {
    state.activeTab = route;
    if (window.location.hash !== `#/${route}`) {
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}#/${route}`);
    }
  }
  if (!state.token && !state.link) return;
  try {
    if (state.token) {
      const me = await api('/session/me');
      state.owner = me.owner;
    }
    await start();
  } catch (error) {
    if (error.status === 401) {
      state.token = '';
      sessionStorage.removeItem(TOKEN_KEY);
      if (state.link) {
        try {
          await start();
          return;
        } catch (linkError) {
          banner('That access link is no longer valid.', 'error');
        }
      }
      $('#login-panel').hidden = false;
    } else {
      banner(error.message, 'error');
    }
  }
}

document.addEventListener('DOMContentLoaded', boot);


async function loadVerifiedCash() {
  const target = $('#verified-cash-summary');
  target.replaceChildren();
  if (!canMutate()) { target.textContent = 'Verified cash controls require the mission owner session.'; return; }
  const data = await api('/money');
  const accounts = data.accounts || [];
  const currency = accounts[0]?.currency || 'USD';
  target.append(
    card('Verified available', money(accounts.reduce((n,a) => n + Number(a.available_cents),0),currency)),
    card('Held / uncertain', money(accounts.reduce((n,a) => n + Number(a.held_cents),0),currency)),
    card('Integrity', data.ledger.ok ? 'Verified' : 'FAILED'),
    card('Execution', data.killSwitch ? 'FROZEN' : 'Policy gated'),
    card('Activation', 'NOT LIVE-VERIFIED'),
  );
  target.append(el('p',{text:'Blocked until real payment connection testing, lawful earning connectors, vendor billing adapters and real opportunity assignments are complete. Legacy usage receipts do not prove cash payment.'}));
  $('#verified-cash-operations').replaceChildren(el('pre',{text:JSON.stringify(data.operations,null,2)}));
  $('#verified-cash-data').textContent=JSON.stringify(data,null,2);
}
const moneyForm = $('#money-command-form');
if(moneyForm) moneyForm.addEventListener('submit',async(event)=>{
  event.preventDefault(); const form = new FormData(moneyForm); const status = $('#money-command-result');
  try {
    const action=String(form.get('action')); const payload=JSON.parse(String(form.get('payload')));
    if(action==='dispatch' && !window.confirm('Dispatch this approved operation to the configured real payment provider?')) return;
    const result=await api(`/money/${action}`,{method:'POST',body:payload});
    status.textContent=JSON.stringify(result);await loadVerifiedCash();
  } catch(error) {status.textContent=error.message || 'Action refused';}
});


// Customer acquisition is a human-controlled commercial workflow, not a lead counter.
let customerFieldSequence = 0;
function customerField(form,label,name,type='text',options=[]) {
  const id=`customer-field-${++customerFieldSequence}`;
  const node=el(type==='textarea'?'textarea':type==='select'?'select':'input',{id,name,required:'required',...(type==='select'||type==='textarea'?{}:{type})});
  if(type==='select') for(const option of options)node.appendChild(el('option',{value:option,text:option}));
  if(type==='number'){node.min='1';node.max='1000000';node.step='1';}
  if(type==='textarea')node.maxLength=131072;
  form.appendChild(el('label',{for:id,text:label}));form.appendChild(node);return node;
}
function customerOutput(host,value){const box=el('textarea',{'aria-label':'Prepared artifact — not sent',readonly:'readonly',rows:'12'});box.value=typeof value==='string'?value:JSON.stringify(value,null,2);host.appendChild(box);}
function customerForm(host,title,command,setup,toBody,after){
  // Each intake form is a disclosure of its own: the block lists the three things an owner can do here,
  // and the fields for the one they picked are what takes the screen. The title is the summary, so the
  // heading inside the form went away rather than being printed twice.
  const shell=el('details',{class:'control-block'});shell.appendChild(el('summary',{text:title}));
  const form=el('form',{class:'control-block','aria-label':title});setup(form);const button=el('button',{type:'submit',text:title});form.appendChild(button);shell.appendChild(form);host.appendChild(shell);
  form.addEventListener('submit',async event=>{event.preventDefault();if(!guardMutation())return;button.disabled=true;try{const result=await api(`/customer-work/${command}`,{method:'POST',body:toBody(new FormData(form))});await after(result.result);}catch(error){banner(error.message,'error');}finally{button.disabled=false;}});return form;
}
async function loadCustomerWork(){
  const host=$('#customer-work');host.replaceChildren();$('#customer-detail').replaceChildren();
  // The three intake forms are the tall part of this screen, so they render into their own collapsed
  // block: the section keeps its record tables on one screen and an owner opens the form they need.
  const intake=$('#customer-intake');if(intake)intake.replaceChildren();
  if(!canMutate()){host.appendChild(el('p',{text:'Owner sign-in required. Access links cannot view customer briefs.'}));return;}
  const data=await api('/customer-work');host.appendChild(el('p',{text:data.note}));
  host.appendChild(table([{label:'Capability (not a live offer)',key:'title'},{label:'Customer need',key:'customer',wrap:true},{label:'Deliverables',key:'deliverables',wrap:true},{label:'Limits',key:'limit'}],data.offers));
  host.appendChild(el('h3',{text:'Reviewed customer-acquisition mechanisms — not acquired leads'}));
  host.appendChild(table([{label:'Category',key:'category'},{label:'Where customers come from',key:'customerOrigin',wrap:true},{label:'Value to deliver',key:'value',wrap:true},{label:'Actual payment event',key:'paymentGeneration',wrap:true},{label:'Settlement gate',key:'settlement',wrap:true},{label:'Human ownership / approval',key:'human',wrap:true},{label:'Automation boundary',key:'automation',wrap:true}],data.channelInventory??[],'No channel inventory loaded.'));
  const services=data.offers.map(x=>x.id);
  customerForm(intake,'Prepare unpublished listing','listing',form=>{customerField(form,'Service','serviceId','select',services);customerField(form,'Owner-proposed USD cents — not earnings','quoteCents','number');},f=>({serviceId:f.get('serviceId'),quoteCents:Number(f.get('quoteCents'))}),result=>customerOutput(host,result.text));
  customerForm(intake,'Preview on my own authorized sample','preview',form=>{customerField(form,'Service','serviceId','select',services);customerField(form,'Non-sensitive sample input','input','textarea');const config=customerField(form,'Configuration JSON: required fields + uniqueKey, or null for HTML','configuration','textarea');config.value='null';customerField(form,'I have the data rights','dataRightsReviewed','checkbox');customerField(form,'This sample contains no sensitive data','nonSensitiveDataOnly','checkbox');},f=>({serviceId:f.get('serviceId'),input:f.get('input'),configuration:JSON.parse(f.get('configuration')),dataRightsReviewed:f.has('dataRightsReviewed'),nonSensitiveDataOnly:f.has('nonSensitiveDataOnly')}),result=>{customerOutput(host,result.classification);customerOutput(host,result.artifact);});
  customerForm(intake,'Record an explicit customer request','record',form=>{
    form.appendChild(el('p',{text:'Owner-reviewed declarations only, not independently verified demand. Use the originating platform customer ID; never import scraped contacts. For direct referrals, use your actual contact reference; map it to the authenticated Contra client only after an owner identity review.'}));
    customerField(form,'Service','serviceId','select',services);customerField(form,'Original channel','origin','select',['direct','fiverr','upwork','contra']);
    for(const [label,name] of [['Customer reference (not credentials)','customerRef'],['Actual incoming request reference','sourceRef'],['Human review reference','reviewRef']])customerField(form,label,name);
    customerField(form,'Request observed at','observedAt','datetime-local');customerField(form,'Contact permission expires (maximum 7 days)','consentExpiresAt','datetime-local');customerField(form,'Actual client brief','brief','textarea');customerField(form,'Owner-proposed USD cents','quoteCents','number');const config=customerField(form,'Configuration JSON, or null for HTML','configuration','textarea');config.value='null';
    for(const [label,name] of [['I reviewed an explicit real request','explicitRequestReviewed'],['The recipient permits this reply','contactPermissionReviewed'],['The purpose is lawful','lawfulPurposeReviewed'],['The client has authorized data use and retention','dataRightsReviewed'],['Only non-sensitive data will be supplied','nonSensitiveDataOnly'],['The proposed automation is permitted','automationPermissionReviewed']])customerField(form,label,name,'checkbox');
  },f=>{const body=Object.fromEntries(f);body.quoteCents=Number(body.quoteCents);body.configuration=JSON.parse(body.configuration);body.observedAt=new Date(body.observedAt).toISOString();body.consentExpiresAt=new Date(body.consentExpiresAt).toISOString();for(const key of ['explicitRequestReviewed','contactPermissionReviewed','lawfulPurposeReviewed','dataRightsReviewed','nonSensitiveDataOnly','automationPermissionReviewed'])body[key]=f.has(key);return body;},async result=>{await loadCustomerWork();await loadCustomerDetail(result.id);});
  host.appendChild(el('h3',{text:`Requests (latest ${data.limit}; total records ${data.totalRecords}, not a verified customer count)`}));
  host.appendChild(table([{label:'Record',key:'id'},{label:'Evidence stage',key:'stage'},{label:'Proposed price, not revenue',render:r=>money(r.proposedUsdCents)},{label:'Verified received USD, not spendable balance',render:r=>money(r.receivedNetUsdCents)},{label:'Open',render:r=>{const b=el('button',{type:'button',text:'Review request'});b.addEventListener('click',()=>loadCustomerDetail(r.id).catch(e=>banner(e.message,'error')));return b;}}],data.requests,'No customer requests recorded. No demand or earnings are inferred.'));
}
async function loadCustomerDetail(id){
  const host=$('#customer-detail');host.replaceChildren();const data=await api(`/customer-work/${encodeURIComponent(id)}`),d=data.request;
  host.appendChild(el('h3',{text:`Request ${id}`}));host.appendChild(el('p',{text:`${data.progress.stage}. ${data.progress.note}`}));
  host.appendChild(el('p',{text:'Exact proposed contract scope — copy into the actual agreement; its hash must match the existing connector:'}));customerOutput(host,d.scope_text);customerOutput(host,d.scope_hash);
  if(d.response)customerOutput(host,d.response);if(d.artifact)customerOutput(host,d.artifact);
  customerForm(host,'Prepare one manual reply','response',()=>{},()=>({requestId:id}),result=>customerOutput(host,result.content));
  customerForm(host,'Bind actual authenticated contract','bind',form=>{customerField(form,'Existing connector','connector','select',['fiverr','upwork','contra']);customerField(form,'Existing authorized work ID','workId');customerField(form,'Direct-contact identity mapping review (required if references differ)','identityReviewRef').removeAttribute('required');},f=>({requestId:id,connector:f.get('connector'),workId:f.get('workId'),identityReviewRef:f.get('identityReviewRef')||undefined}),()=>loadCustomerDetail(id));
  customerForm(host,'Produce authorized client work','produce',form=>customerField(form,'Client-authorized non-sensitive input','input','textarea'),f=>({requestId:id,input:f.get('input')}),()=>loadCustomerDetail(id));
  customerForm(host,'Approve exact artifact for manual handoff','approve',form=>{customerField(form,'Human quality review reference','qualityRef');},f=>({requestId:id,artifactHash:d.artifact_hash,qualityRef:f.get('qualityRef')}),result=>{customerOutput(host,result.instruction);customerOutput(host,result.content);});
  customerForm(host,'Stop contact and future work','stop',form=>customerField(form,'Opt-out or rejection evidence reference','reasonRef'),f=>({requestId:id,reasonRef:f.get('reasonRef')}),()=>loadCustomerDetail(id));
}
