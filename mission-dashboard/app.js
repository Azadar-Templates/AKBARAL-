/**
 * ZA141251SA — private mission console.
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

const TOKEN_KEY = 'za_mission_token';
const LINK_KEY = 'za_mission_link';
// The open section, the Agents sub-tab and the selected chat agent survive a
// refresh, so a conversation stays where the owner left it.
const VIEW_KEY = 'za_mission_view';
const SUB_KEY = 'za_mission_agent_sub';
const CHAT_KEY = 'za_mission_chat_agent';

/**
 * Session persistence.
 *
 * sessionStorage alone is not enough: when this dashboard is opened through an
 * embedded preview the frame can be re-created, which hands the page a fresh
 * (empty) sessionStorage and made a signed-in dashboard fall back to the login
 * panel seconds after sign-in. The token is therefore mirrored into
 * localStorage for this origin, and the server additionally keeps an HttpOnly
 * cookie so the session can be recovered even when no web storage survives.
 * Every store is cleared on sign-out.
 */
const storage = {
  read(key) {
    try { const value = sessionStorage.getItem(key); if (value) return value; } catch { /* storage may be partitioned */ }
    try { return localStorage.getItem(key) || ''; } catch { return ''; }
  },
  write(key, value) {
    try { sessionStorage.setItem(key, value); } catch { /* ignore */ }
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  },
  clear(key) {
    try { sessionStorage.removeItem(key); } catch { /* ignore */ }
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

const state = {
  token: storage.read(TOKEN_KEY) || '',
  link: storage.read(LINK_KEY) || '',
  // true when the server recognised us through the HttpOnly session cookie
  // and this frame holds no token of its own.
  cookieAuth: false,
  owner: null,
  overview: null,
  summary: null,
  view: storage.read(VIEW_KEY) || 'home',
  agentSub: storage.read(SUB_KEY) || 'browse',
  chatAgent: storage.read(CHAT_KEY) ? { slug: storage.read(CHAT_KEY) } : null,
  openAgent: null,
  verifyingSlot: null,
};

/** The owner console has exactly four sections. */
const VIEWS = ['home', 'agents', 'withdraw', 'card'];

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

function table(columns, rows, emptyMessage) {
  const wrap = el('div', { class: 'table-wrap' });
  if (!rows || rows.length === 0) {
    wrap.appendChild(el('p', { class: 'muted small', style: 'padding:12px', text: emptyMessage || 'No data yet.' }));
    return wrap;
  }
  const thead = el('thead', {}, el('tr', {}, columns.map((column) => el('th', { text: column.label }))));
  const tbody = el('tbody', {}, rows.map((row) => el('tr', {}, columns.map((column) => {
    const cell = el('td', { class: column.wrap ? 'wrap' : '' });
    const content = column.render ? column.render(row) : row[column.key];
    if (content instanceof Node) cell.appendChild(content);
    else cell.textContent = content === null || content === undefined ? '—' : String(content);
    return cell;
  }))));
  wrap.appendChild(el('table', {}, [thead, tbody]));
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

// ── API ─────────────────────────────────────────────────────────────────────
async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json' };
  // The session travels in a custom header, not Authorization: proxies in
  // front of a preview may consume Authorization for their own auth, which
  // stripped the session from every request while login itself still worked.
  // x-mission-client marks same-origin dashboard calls, which is what lets the
  // server accept its HttpOnly cookie without opening a CSRF hole.
  headers['x-mission-client'] = 'dashboard';
  if (state.token) headers['x-mission-auth'] = state.token;
  if (state.link) headers['x-mission-link'] = state.link;
  const response = await fetch(`/api${path}`, {
    method: options.method || 'GET',
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  if (!response.ok) {
    // A 401 from one panel used to close the entire dashboard. Only the
    // session's own verdict may end a session: re-check it, and keep the
    // dashboard open when the session is still good.
    if (response.status === 401 && path !== '/session/me') await handleUnauthorized();
    const error = new Error((payload && payload.error && payload.error.message) || `request failed (${response.status})`);
    error.status = response.status;
    error.code = payload && payload.error ? payload.error.code : 'unknown';
    throw error;
  }
  return payload;
}

/**
 * Decide whether a 401 really means "your session is gone".
 * The dashboard is only closed when /session/me also refuses — an endpoint
 * that answers 401 for its own reasons must never log the owner out.
 */
async function handleUnauthorized() {
  if (!state.token && !state.link && !state.cookieAuth) return;
  try {
    const me = await api('/session/me');
    if (me && me.owner) {
      state.owner = me.owner;
      showIdentity();
      return; // session is alive; the 401 belonged to that one request
    }
  } catch (error) {
    if (error.status !== 401) return; // network/5xx: keep the dashboard open
  }
  signOut(false);
  banner('The mission session ended. Sign in again to continue.', 'error');
}

/** Owner-only actions are hidden for read-only access links. */
function canMutate() {
  return Boolean(state.token) || state.cookieAuth;
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
    storage.write(LINK_KEY, token);
  }
  // Remove the token from the address bar so it is not left in history,
  // screenshots or shared links.
  window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
}

function signOut(notify = true) {
  state.token = '';
  state.cookieAuth = false;
  state.owner = null;
  storage.clear(TOKEN_KEY);
  storage.clear(VIEW_KEY);
  storage.clear(SUB_KEY);
  storage.clear(CHAT_KEY);
  $('#app').hidden = true;
  $('#login-panel').hidden = false;
  $('#signout').hidden = true;
  $('#identity').textContent = 'not signed in';
  if (notify) banner('Signed out.', 'ok');
}

async function login(email, password) {
  const payload = await api('/session/login', { method: 'POST', body: { email, password } });
  state.token = payload.token;
  state.cookieAuth = false;
  state.owner = payload.owner;
  showIdentity();
  state.link = '';
  storage.write(TOKEN_KEY, payload.token);
  storage.clear(LINK_KEY);
  await start();
}

async function start() {
  $('#login-panel').hidden = true;
  $('#app').hidden = false;
  $('#signout').hidden = !canMutate();
  // Identify the operator from the session state we already hold, before any
  // network round-trip: a signed-in person must never see "not signed in".
  showIdentity();
  // The owner console needs only the compact summary; the heavy mission
  // reports stay on their own protected routes and are never loaded here.
  await loadView(state.view);
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
function tile(label, value, hint, kind = '') {
  return el('div', { class: `tile ${kind}` }, [
    el('span', { class: 'label', text: label }),
    el('span', { class: 'value', text: value }),
    hint ? el('span', { class: 'hint', text: hint }) : null,
  ].filter(Boolean));
}

function row(title, sub, sideNodes = [], onClick = null, wrap = false) {
  const node = el('div', { class: `row${onClick ? ' clickable' : ''}${wrap ? ' wrap' : ''}` }, [
    el('div', { class: 'main' }, [
      el('span', { class: 'title', text: title }),
      sub ? el('span', { class: 'sub', text: sub }) : null,
    ].filter(Boolean)),
    el('div', { class: 'side' }, sideNodes),
  ]);
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

function chip(text, kind = '') {
  return el('span', { class: `chip ${kind}`.trim(), text });
}

function statusChip(status) {
  const value = String(status || '').toLowerCase();
  if (['active', 'settled', 'paid', 'delivered', 'received'].includes(value)) return chip(value, 'ok');
  if (['paused', 'pending_approval', 'pending_verification', 'in_progress', 'approved', 'sent', 'proposed'].includes(value)) return chip(value.replace(/_/g, ' '), 'warn');
  if (['retired', 'failed', 'rejected', 'frozen', 'unconfigured'].includes(value)) return chip(value, value === 'unconfigured' ? '' : 'bad');
  return chip(value || 'unknown');
}

function fill(target, nodes, emptyMessage) {
  const node = $(target);
  if (!node) return;
  node.replaceChildren();
  const list = [].concat(nodes).filter(Boolean);
  if (!list.length) {
    node.appendChild(el('p', { class: 'empty', text: emptyMessage || 'Nothing yet.' }));
    return;
  }
  for (const child of list) node.appendChild(child);
}

async function loadSummary() {
  state.summary = await api('/summary');
  return state.summary;
}

// ── 1. OVERVIEW ─────────────────────────────────────────────────────────────
async function loadHome() {
  const data = await loadSummary();
  const currency = data.currency || 'USD';

  fill('#home-alerts', (data.alerts || []).map((alert) => el('div', { class: `alert ${alert.level}`, text: alert.message })), '');
  if (!(data.alerts || []).length) $('#home-alerts').replaceChildren();

  fill('#home-money', [
    tile('Verified available', money(data.money.verifiedAvailableCents, currency), 'ready to withdraw', 'primary'),
    tile('Verified earned', money(data.money.verifiedEarnedTotalCents, currency), `today ${money(data.money.verifiedEarnedTodayCents, currency)}`),
    tile('Active agents', String(data.agents.active), `${data.agents.working} with open work`),
    tile('Work in progress', String(data.work.inProgress), `${data.work.total} recorded in total`),
    data.money.expectedNotEarnedCents
      ? tile('Expected (not money)', money(data.money.expectedNotEarnedCents, currency), 'not verified — never counted as balance', 'muted-tile')
      : null,
  ].filter(Boolean));

  fill(
    '#home-work',
    (data.work.recent || []).map((item) =>
      row(item.title, `${item.agentName || item.agentSlug || 'unassigned'} · ${when(item.updatedAt)}`, [statusChip(item.status)]),
    ),
    'No work has been recorded yet.',
  );

  fill(
    '#home-activity',
    (data.activity || []).slice(0, 6).map((entry) => row(entry.summary, when(entry.at), [chip(entry.actor)])),
    'No activity recorded yet.',
  );

  $('#home-note').textContent = data.money.note;
}

// ── 2. AGENTS + CHAT ────────────────────────────────────────────────────────
// Two areas: "Agents" browses the fleet, "Chat" is a conversational workspace
// bound to one selected agent. Every message is sent to that agent's own
// mission endpoint, and every reply can only come from the real chat pipeline.
const QUICK_QUESTIONS = [
  'What are you doing right now?',
  'What work have you completed?',
  'What should you do next?',
  'What platforms are you researching?',
  'Find legitimate earning opportunities for your capabilities.',
  'Explain your current task.',
];

function setAgentSubButtons(sub) {
  $$('#agentnav .subbtn').forEach((button) => button.classList.toggle('active', button.getAttribute('data-sub') === sub));
  $$('[data-sub-panel]').forEach((panel) => { panel.hidden = panel.getAttribute('data-sub-panel') !== sub; });
}

async function loadAgentSub(sub) {
  state.agentSub = sub === 'chat' ? 'chat' : 'browse';
  storage.write(SUB_KEY, state.agentSub);
  setAgentSubButtons(state.agentSub);
  if (state.agentSub === 'chat') {
    await renderChatAgentList($('#chat-search')?.querySelector('input')?.value?.trim() || '');
    await loadAgentConversation();
  } else {
    await loadAgentCategories();
    await loadAgentsSimple($('#agent-quick-search')?.querySelector('input')?.value?.trim() || '');
    observeFleetScroll();
  }
}

const FLEET_PAGE = 25;

/** Fleet browsing state: the whole registry is reachable, page by page. */
const fleet = { query: '', category: '', offset: 0, total: 0, fleetTotal: 0, loading: false };

function fleetCount(value) {
  return Number(value || 0).toLocaleString('en-US');
}

async function loadAgentCategories() {
  const select = $('#agent-category');
  if (!select || select.dataset.loaded === 'yes') return;
  try {
    const payload = await api('/agents/categories');
    select.replaceChildren(el('option', { value: '', text: 'All categories' }));
    for (const entry of payload.categories || []) {
      if (!entry.category) continue;
      select.appendChild(el('option', { value: entry.category, text: `${entry.category} (${fleetCount(entry.count)})` }));
    }
    select.dataset.loaded = 'yes';
    select.value = fleet.category;
  } catch {
    select.replaceChildren(el('option', { value: '', text: 'All categories' }));
  }
}

/** One page of the fleet. `append` keeps what is already rendered (load more). */
async function loadAgentsSimple(query = '', options = {}) {
  const append = options.append === true;
  if (fleet.loading) return;
  fleet.loading = true;
  if (!append) {
    fleet.query = query;
    fleet.category = options.category !== undefined ? options.category : ($('#agent-category')?.value || '');
    fleet.offset = 0;
  }

  const data = state.summary || (await loadSummary());
  fill('#agent-summary', [
    chip(`${fleetCount(data.agents.active)} active`, 'ok'),
    data.agents.paused ? chip(`${fleetCount(data.agents.paused)} paused`, 'warn') : null,
    data.agents.retired ? chip(`${fleetCount(data.agents.retired)} retired`) : null,
    chip(`${fleetCount(data.agents.working)} working`),
  ].filter(Boolean));

  const params = new URLSearchParams({ limit: String(FLEET_PAGE), offset: String(fleet.offset) });
  if (fleet.query) params.set('q', fleet.query);
  if (fleet.category) params.set('category', fleet.category);

  let payload;
  try {
    payload = await api(`/agents?${params.toString()}`);
  } catch (error) {
    fleet.loading = false;
    fill('#agent-cards', [], error.message);
    return;
  }

  fleet.total = payload.total || 0;
  fleet.fleetTotal = payload.fleetTotal || payload.total || 0;

  const banner = $('#fleet-banner');
  if (banner) {
    banner.replaceChildren(
      el('strong', { text: `${fleetCount(fleet.fleetTotal)} Agents Available` }),
      el('span', { class: 'muted tiny', text: fleet.query || fleet.category
        ? ` — ${fleetCount(fleet.total)} match${fleet.total === 1 ? 'es' : ''} ${[fleet.query ? `“${fleet.query}”` : '', fleet.category ? `in ${fleet.category}` : ''].filter(Boolean).join(' ')}`
        : ' — the complete registry is searchable and browsable below' }),
    );
  }

  const work = (data.work.recent || []).reduce((map, item) => {
    if (item.agentSlug && !map[item.agentSlug]) map[item.agentSlug] = item;
    return map;
  }, {});

  const rows = (payload.agents || []).map((agent) => {
    const current = work[agent.slug];
    const identity = agent.identity || null;
    const doing = current ? `${current.status.replace(/_/g, ' ')}: ${current.title}` : agent.status === 'active' ? 'idle — no open work' : `agent ${agent.status}`;
    const chatButton = el('button', { class: 'small', type: 'button', text: 'Chat' });
    chatButton.addEventListener('click', (event) => { event.stopPropagation(); openAgentChat(agent.slug); });
    const line = el('div', { class: 'main' }, [
      el('span', { class: 'title', text: agent.name }),
      el('span', { class: 'sub', text: `${agent.slug} · ${agent.category || 'general'} · ${agent.mission_role || 'worker'}` }),
      identity ? el('span', { class: 'sub purpose', text: identity.purpose }) : null,
      el('span', { class: 'sub', text: doing }),
    ].filter(Boolean));
    const node = el('div', { class: 'row clickable wrap' }, [line, el('div', { class: 'side' }, [statusChip(agent.status), chatButton])]);
    node.addEventListener('click', () => openAgentSimple(agent.slug));
    return node;
  });

  const host = $('#agent-cards');
  if (append) rows.forEach((node) => host.appendChild(node));
  else fill('#agent-cards', rows, fleet.query || fleet.category ? 'No agent matches this search.' : 'No agents yet.');

  fleet.offset = (payload.offset || 0) + (payload.agents || []).length;
  renderFleetPager(payload);
  fleet.loading = false;
}

function renderFleetPager(payload) {
  const host = $('#agent-more');
  if (!host) return;
  host.replaceChildren();
  const shown = Math.min(fleet.offset, fleet.total);
  host.appendChild(el('p', { class: 'muted tiny', text: `Showing ${fleetCount(shown)} of ${fleetCount(fleet.total)} matching agents.` }));
  if (payload.hasMore) {
    const more = el('button', { type: 'button', class: 'small', id: 'agent-load-more', text: `Load ${Math.min(FLEET_PAGE, fleet.total - shown)} more` });
    more.addEventListener('click', () => loadAgentsSimple(fleet.query, { append: true }));
    host.appendChild(more);
  }
}

/** Infinite scroll: reaching the end of the list pulls the next page. */
function observeFleetScroll() {
  const host = $('#agent-more');
  if (!host || typeof IntersectionObserver !== 'function' || host.dataset.observed === 'yes') return;
  host.dataset.observed = 'yes';
  new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    if (state.view !== 'agents' || state.agentSub !== 'browse') return;
    if (fleet.loading || fleet.offset >= fleet.total) return;
    loadAgentsSimple(fleet.query, { append: true });
  }, { rootMargin: '200px' }).observe(host);
}

function section(title, nodes) {
  return [el('h4', { text: title }), ...nodes];
}

/** Browse drawer: designed identity, live state and the owner brake. */
async function openAgentSimple(slug) {
  const drawer = $('#agent-detail');
  drawer.hidden = false;
  drawer.replaceChildren(el('p', { class: 'empty', text: 'Loading agent…' }));
  drawer.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });

  let report;
  let live;
  try {
    [report, live] = await Promise.all([
      api(`/agents/${encodeURIComponent(slug)}`),
      api(`/agents/${encodeURIComponent(slug)}/chat-status`).catch(() => null),
    ]);
  } catch (error) {
    drawer.replaceChildren(el('p', { class: 'empty', text: error.message }));
    return;
  }
  const briefing = live?.briefing || null;
  const readiness = live?.readiness || null;
  const identity = live?.identity || briefing?.identity || null;
  const wallet = report.wallet || {};
  const currency = wallet.currency || 'USD';
  const openWork = briefing ? briefing.currentWork : (report.work || []).filter((item) => ['approved', 'in_progress'].includes(item.status));

  const chatButton = el('button', { class: 'small', type: 'button', text: 'Open chat' });
  chatButton.addEventListener('click', () => openAgentChat(slug));
  const closeButton = el('button', { class: 'ghost small', type: 'button', text: 'Close' });
  closeButton.addEventListener('click', () => { drawer.hidden = true; state.openAgent = null; });

  const head = el('div', { class: 'drawer-head' }, [
    el('div', {}, [
      el('h3', { text: report.agent.name }),
      el('p', { class: 'muted tiny', text: `${report.agent.slug} · ${report.agent.mission_role || briefing?.role || 'worker'} · ${report.agent.category || 'general'}${identity ? ` · ${identity.specialization}` : ''}` }),
      identity ? el('p', { class: 'purpose', text: identity.purpose }) : null,
    ].filter(Boolean)),
    el('div', { class: 'side' }, [statusChip(report.agent.status), chatButton, closeButton]),
  ]);

  const facts = el('div', { class: 'tiles' }, [
    tile('Wallet balance', money(wallet.balanceCents ?? wallet.balance_cents ?? 0, currency), 'verified ledger'),
    tile('Open work', String(openWork.length), `${briefing ? briefing.workCounts.total : (report.work || []).length} recorded`),
    tile('Verified revenue', money(briefing ? briefing.verifiedRevenueCents : report.revenue?.realizedCents ?? 0, currency), 'received + verified'),
    tile('Expected (not money)', money(briefing ? briefing.expectedRevenueCents : report.revenue?.expectedCents ?? 0, currency), 'contracted, unverified', 'muted-tile'),
  ]);

  const controls = el('div', { class: 'side' }, []);
  if (canMutate()) {
    const pauseButton = el('button', {
      class: report.agent.status === 'active' ? 'ghost small' : 'small',
      type: 'button',
      text: report.agent.status === 'active' ? 'Pause agent' : 'Resume agent',
    });
    pauseButton.addEventListener('click', async () => {
      const next = report.agent.status === 'active' ? 'paused' : 'active';
      const reason = next === 'paused' ? window.prompt('Reason for pausing this agent (required):') : '';
      if (next === 'paused' && (!reason || reason.trim().length < 3)) return;
      try {
        await api(`/agents/${encodeURIComponent(slug)}/status`, { method: 'POST', body: { status: next, reason: reason || '' } });
        banner(next === 'paused' ? 'Agent paused.' : 'Agent resumed.', 'ok');
        await openAgentSimple(slug);
        await loadAgentsSimple(fleet.query);
      } catch (error) {
        banner(error.message, 'error');
      }
    });
    controls.appendChild(pauseButton);
  }

  const providerLine = readiness
    ? `${readiness.status} · ${readiness.provider} · ${readiness.model}`
    : 'provider status unavailable';

  drawer.replaceChildren(
    head,
    facts,
    controls,
    el('div', { class: 'agent-state' }, [
      ...(identity ? section('Designed for', [
        el('p', { class: 'small', text: identity.purpose }),
        el('p', { class: 'muted tiny', text: `Archetype: ${identity.archetype} · Domain: ${identity.domain} · Registry key: ${identity.key}` }),
      ]) : []),
      ...(identity ? section('Workflow it follows', [
        el('ol', { class: 'steps' }, identity.workflow.map((step) => el('li', { text: step }))),
      ]) : []),
      ...(identity ? section('Inputs and outputs', [
        el('div', { class: 'chips' }, [
          ...identity.inputs.map((input) => chip(`in: ${input}`)),
          ...identity.outputs.map((output) => chip(`out: ${output}`, 'ok')),
        ]),
      ]) : []),
      ...section('Capabilities', [
        el('div', { class: 'chips' }, (briefing?.capabilities || identity?.capabilities || []).length
          ? (briefing?.capabilities || identity.capabilities).slice(0, 14).map((capability) => chip(capability))
          : [el('p', { class: 'empty', text: 'No capabilities recorded for this agent.' })]),
      ]),
      ...section('Approved tools', [
        el('div', { class: 'chips' }, (briefing?.tools || []).length
          ? briefing.tools.map((tool) => chip(tool, 'ok'))
          : [chip('no tools approved yet', 'warn')]),
        identity ? el('p', { class: 'muted tiny', text: `Designed to use: ${identity.toolPermissions.join(', ') || 'none'} — each still requires owner approval.` }) : null,
      ].filter(Boolean)),
      ...section('Current work', [
        el('div', { class: 'list' }, openWork.length
          ? openWork.slice(0, 5).map((item) => row(item.title, when(item.updatedAt || item.createdAt), [statusChip(item.status)]))
          : [el('p', { class: 'empty', text: 'No work is assigned to this agent right now.' })]),
      ]),
      ...section('Completed work', [
        el('div', { class: 'list' }, (briefing?.completedWork || []).length
          ? briefing.completedWork.slice(0, 5).map((item) => row(item.title, when(item.updatedAt), [statusChip(item.status)]))
          : [el('p', { class: 'empty', text: 'No delivered work recorded yet.' })]),
      ]),
      ...section('Provider and readiness', [
        el('div', { class: 'chips' }, [
          chip(providerLine, readiness?.ready ? 'ok' : 'warn'),
          chip(`resources: ${(briefing?.resources || []).length ? briefing.resources.map((resource) => `${resource.provider}/${resource.kind} (${resource.status})`).join(', ') : 'none provisioned'}`),
        ]),
        readiness && !readiness.ready
          ? el('ul', { class: 'blockers' }, (readiness.blockers || []).map((blocker) => el('li', { text: blocker })))
          : null,
      ].filter(Boolean)),
      ...(identity ? section('Verification rules and constraints', [
        el('ul', { class: 'blockers' }, [...identity.verificationRules, ...identity.securityPermissions].map((rule) => el('li', { text: rule }))),
      ]) : []),
    ]),
  );
  state.openAgent = { slug, id: report.agent.id };
}

// ── chat workspace ──────────────────────────────────────────────────────────
const chatList = { query: '', offset: 0, total: 0, loading: false };

async function renderChatAgentList(query = '', options = {}) {
  const host = $('#chat-agent-list');
  if (!host || chatList.loading) return;
  const append = options.append === true;
  chatList.loading = true;
  if (!append) {
    chatList.query = query;
    chatList.offset = 0;
  }
  const params = new URLSearchParams({ limit: '25', offset: String(chatList.offset) });
  if (chatList.query) params.set('q', chatList.query);
  let payload;
  try {
    payload = await api(`/agents?${params.toString()}`);
  } catch (error) {
    chatList.loading = false;
    host.replaceChildren(el('p', { class: 'empty', text: error.message }));
    return;
  }
  chatList.total = payload.total || 0;
  if (!append) host.replaceChildren();
  host.querySelector('.chatlist-footer')?.remove();

  for (const agent of payload.agents || []) {
    const item = el('button', {
      type: 'button',
      'data-slug': agent.slug,
      class: `chatitem${state.chatAgent?.slug === agent.slug ? ' active' : ''}`,
    }, [
      el('span', { class: 'name', text: agent.name }),
      el('span', { class: 'slug', text: agent.slug }),
      agent.identity ? el('span', { class: 'role', text: agent.identity.specialization }) : null,
    ].filter(Boolean));
    item.addEventListener('click', () => openAgentChat(agent.slug));
    host.appendChild(item);
  }
  chatList.offset = (payload.offset || 0) + (payload.agents || []).length;

  const footer = el('div', { class: 'chatlist-footer' }, []);
  if (!(payload.agents || []).length && !append) {
    footer.appendChild(el('p', { class: 'empty', text: `No agent matches “${chatList.query}”.` }));
  } else {
    footer.appendChild(el('p', { class: 'muted tiny', text: `${chatList.offset.toLocaleString('en-US')} of ${chatList.total.toLocaleString('en-US')} agents — search the full fleet by name, slug, category, role or capability.` }));
    if (payload.hasMore) {
      const more = el('button', { type: 'button', class: 'small', id: 'chat-load-more', text: 'Load more agents' });
      more.addEventListener('click', () => renderChatAgentList(chatList.query, { append: true }));
      footer.appendChild(more);
    }
  }
  host.appendChild(footer);
  chatList.loading = false;
}

/** Select an agent and open its conversation. */
async function openAgentChat(slug) {
  state.chatAgent = { slug };
  storage.write(CHAT_KEY, slug);
  if (state.view !== 'agents') await loadView('agents');
  await loadAgentSub('chat');
  $('#chatmain')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
}

/** Header, factual context, provider truth and history for the open agent. */
async function loadAgentConversation() {
  const header = $('#chat-header');
  const context = $('#chat-context');
  const log = $('#chat-log');
  const form = $('#chat-form');
  const suggestions = $('#chat-suggestions');
  if (!header || !log) return false;

  const slug = state.chatAgent?.slug;
  if (!slug) {
    header.replaceChildren(el('h3', { text: 'Select an agent' }));
    context.replaceChildren();
    $('#chat-readiness').replaceChildren();
    suggestions.replaceChildren();
    log.replaceChildren(el('p', { class: 'empty', text: 'Choose an agent on the left to open its conversation. Each agent keeps its own history.' }));
    if (form) form.hidden = true;
    $('#chat-note').textContent = '';
    return false;
  }

  let live;
  let messages;
  try {
    [live, messages] = await Promise.all([
      api(`/agents/${encodeURIComponent(slug)}/chat-status`),
      api(`/agents/${encodeURIComponent(slug)}/messages?after=0&limit=100`),
    ]);
  } catch (error) {
    log.replaceChildren(el('p', { class: 'empty', text: error.message }));
    return false;
  }
  const briefing = live.briefing || {};
  const readiness = live.readiness || {};
  state.chatAgent = { slug, id: live.agentId, name: briefing.name || slug };

  header.replaceChildren(
    el('div', {}, [
      el('h3', { text: `Chat with ${briefing.name || slug}` }),
      el('p', { class: 'muted tiny', text: `${slug} · ${briefing.role || 'worker'} · ${briefing.category || 'general'}` }),
    ]),
    el('div', { class: 'side' }, [statusChip(briefing.status || 'unknown')]),
  );

  const currency = 'USD';
  context.replaceChildren(
    el('div', { class: 'chips' }, [
      chip(`${(briefing.currentWork || []).length} open work`),
      chip(`${(briefing.completedWork || []).length} delivered`),
      chip(`wallet ${money(briefing.walletBalanceCents || 0, currency)}`),
      chip(`verified ${money(briefing.verifiedRevenueCents || 0, currency)}`, 'ok'),
      chip(`expected ${money(briefing.expectedRevenueCents || 0, currency)} (not money)`),
      ...(briefing.capabilities || []).slice(0, 6).map((capability) => chip(capability)),
      ...(briefing.tools || []).length ? (briefing.tools || []).map((tool) => chip(tool, 'ok')) : [chip('no tools approved', 'warn')],
    ]),
  );

  renderChatReadiness(readiness, slug, briefing);

  suggestions.replaceChildren(...QUICK_QUESTIONS.map((question) => {
    const button = el('button', { type: 'button', class: 'chip clickable', text: question });
    button.addEventListener('click', () => {
      const input = $('#chat-form input');
      if (!input) return;
      input.value = question;
      input.focus();
    });
    return button;
  }));

  const jobs = new Map((live.jobs || []).map((job) => [String(job.message_id), job]));
  const list = messages.messages || [];
  log.replaceChildren();
  if (!list.length) {
    log.appendChild(el('p', { class: 'empty', text: `No messages yet with ${briefing.name || slug}. Ask what it is working on, or give it an instruction.` }));
  }
  for (const message of list) {
    const job = jobs.get(String(message.id));
    log.appendChild(
      el('div', { class: `msg ${message.actor_type === 'owner' ? 'owner' : 'agent'}` }, [
        el('span', { class: 'who', text: `${message.actor_type === 'owner' ? 'you' : briefing.name || 'agent'} · ${when(message.created_at)}` }),
        el('span', { class: 'body', text: message.body }),
        job && message.actor_type === 'owner'
          ? el('span', { class: 'jobstate', text: `${JOB_LABELS[job.status] || job.status}${job.reason ? ` (${job.reason})` : ''}` })
          : null,
      ].filter(Boolean)),
    );
  }
  log.scrollTop = log.scrollHeight;

  if (form) form.hidden = !canMutate();
  const input = $('#chat-form input');
  if (input) input.placeholder = `Message ${briefing.name || slug}…`;
  $('#chat-note').textContent = readiness.ready
    ? 'Messages run through the mission chat pipeline against this agent’s own metered budget; the reply is the model’s real answer, grounded in this agent’s recorded state.'
    : 'Messages are recorded, delivered and auditable against this agent. No answer is invented: until an AI provider is configured for it, nothing replies on its behalf.';

  return (live.jobs || []).some((job) => ['queued', 'running'].includes(String(job.status)));
}

/**
 * The provider chain, stated exactly. When chat is not ready the owner gets the
 * real reason and — for the one configuration that cannot cost money — a form
 * that performs the whole enablement server-side. The key goes straight into
 * the encrypted mission vault; it is never displayed, stored in the page or
 * logged.
 */
function renderChatReadiness(readiness, slug, briefing) {
  const box = $('#chat-readiness');
  if (!box) return;
  box.className = `chat-readiness ${readiness.ready ? 'ok' : 'warn'}`;
  box.replaceChildren(
    el('div', { class: 'side' }, [
      chip(readiness.status || 'UNKNOWN', readiness.ready ? 'ok' : 'warn'),
      chip(`${readiness.provider} · ${readiness.model}`),
      chip(readiness.enabled ? 'binding enabled' : 'binding off', readiness.enabled ? 'ok' : 'warn'),
      readiness.billing === 'free_tier'
        ? chip('free tier · $0 cap · no wallet', 'ok')
        : readiness.billing === 'metered'
          ? chip(`metered · cap ${money(Number(readiness.maxCostCents || 0))}`, 'warn')
          : null,
    ].filter(Boolean)),
    el('p', { class: 'small', text: readiness.message || '' }),
    (readiness.blockers || []).length ? el('ul', { class: 'blockers' }, readiness.blockers.map((blocker) => el('li', { text: blocker }))) : null,
  );
  if (!canMutate()) return;

  // Whether this server can reach the provider at all is a separate fact from
  // whether a key is stored. Show it before the owner enters anything.
  const reach = el('div', { class: 'reachability small muted', text: 'Checking whether this server can reach the AI provider…' });
  box.appendChild(reach);
  api('/provider-reachability')
    .then(({ reachability, note }) => {
      reach.className = `reachability small ${reachability.reachable ? 'ok' : 'blocked'}`;
      reach.replaceChildren(
        chip(reachability.reachable ? 'PROVIDER REACHABLE' : 'RUNTIME BLOCKED', reachability.reachable ? 'ok' : 'warn'),
        el('span', { text: ` ${note}` }),
      );
      // A complete binding is not a working reply path. When the runtime
      // cannot reach the provider, the headline says so instead of READY.
      if (!reachability.reachable && readiness.ready) {
        const headline = box.querySelector('.chip');
        if (headline) { headline.textContent = 'RUNTIME BLOCKED'; headline.className = 'chip warn'; }
        box.className = 'chat-readiness warn';
        const note2 = $('#chat-note');
        if (note2) note2.textContent = 'This agent has a complete free-tier binding, but this server cannot reach the AI provider, so no reply can be generated here. Messages are still recorded, delivered and auditable.';
      }
    })
    .catch(() => {
      reach.textContent = 'The provider reachability check could not be completed; treat replies as unproven until it succeeds.';
    });

  const actions = el('div', { class: 'side wrap' }, []);
  if (readiness.ready || readiness.enabled) {
    const off = el('button', { type: 'button', class: 'ghost small', id: 'chat-disable', text: 'Turn replies off' });
    off.addEventListener('click', async () => {
      if (!window.confirm('Turn chat replies off for this agent? The stored provider key is revoked.')) return;
      try {
        await api(`/agents/${encodeURIComponent(slug)}/chat-disable`, { method: 'POST', body: { revokeKey: true } });
        banner('Chat replies disabled and the stored key revoked.', 'ok');
        await loadAgentConversation();
      } catch (error) {
        banner(error.message, 'error');
      }
    });
    actions.appendChild(off);
  } else {
    const enable = el('button', { type: 'button', class: 'small', id: 'chat-enable-open', text: 'Enable replies (free tier, no payment)' });
    enable.addEventListener('click', () => renderChatEnableForm(slug, briefing));
    actions.appendChild(enable);
    actions.appendChild(el('span', { class: 'muted tiny', text: 'Needs a free Google AI Studio API key. Nothing is purchased and no wallet is attached.' }));
  }
  box.appendChild(actions);
  box.appendChild(el('div', { id: 'chat-enable-host' }, []));
}

function renderChatEnableForm(slug, briefing) {
  const host = $('#chat-enable-host');
  if (!host) return;
  // Repeat the runtime verdict where the key is actually typed: a blocked
  // network means a correct key still cannot produce a reply.
  const warn = el('p', { class: 'small muted', text: '' });
  // The bound model name and its lifecycle come from the server: a dashboard
  // that hardcodes a model can tell the owner something the runtime no longer
  // does. Until the answer arrives the sentence names no model at all.
  const modelLine = el('p', { class: 'small', text: `Binds ${briefing?.name || slug} to Google on the free tier: a zero-cost resource, a 0 cost cap and no wallet, so a reply cannot spend money. The key is encrypted in the mission vault and never shown again.` });
  api('/provider-reachability')
    .then(({ model, modelLifecycle }) => {
      if (model) {
        modelLine.textContent = `Binds ${briefing?.name || slug} to Google ${model} on the free tier: a zero-cost resource, a 0 cost cap and no wallet, so a reply cannot spend money. The key is encrypted in the mission vault and never shown again.`;
      }
      if (modelLifecycle && modelLifecycle.status !== 'ok') {
        modelLine.appendChild(el('span', { class: 'reachability blocked', text: ` ${modelLifecycle.message}` }));
      }
    })
    .catch(() => {});
  api('/provider-reachability')
    .then(({ reachability, note }) => {
      if (reachability.reachable) return;
      warn.className = 'small blocked';
      warn.textContent = note;
    })
    .catch(() => {});
  const key = el('input', { type: 'password', name: 'apiKey', autocomplete: 'off', spellcheck: 'false', placeholder: 'Google AI Studio API key', required: 'required' });
  const requests = el('input', { type: 'number', name: 'dailyRequests', value: '200', min: '1', max: '100000' });
  const tokens = el('input', { type: 'number', name: 'dailyTokens', value: '250000', min: '1000', max: '50000000' });
  const submit = el('button', { type: 'submit', class: 'small', text: 'Store key and enable replies' });
  const cancel = el('button', { type: 'button', class: 'ghost small', text: 'Cancel' });
  cancel.addEventListener('click', () => host.replaceChildren());

  const form = el('form', { class: 'enable-form' }, [
    modelLine,
    el('label', {}, [el('span', { text: 'Provider API key' }), key]),
    el('div', { class: 'form-row' }, [
      el('label', {}, [el('span', { text: 'Mission cap — requests' }), requests]),
      el('label', {}, [el('span', { text: 'Mission cap — tokens' }), tokens]),
    ]),
    el('p', { class: 'muted tiny', text: 'These caps are mission-side quotas. Google enforces its own free-tier limits separately; the mission never claims a provider limit it has not measured.' }),
    warn,
    el('div', { class: 'side' }, [submit, cancel]),
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const result = await api(`/agents/${encodeURIComponent(slug)}/chat-enable`, {
        method: 'POST',
        body: {
          apiKey: key.value,
          dailyRequests: Number(requests.value),
          dailyTokens: Number(tokens.value),
          allowSupportActivity: true,
        },
      });
      key.value = '';
      host.replaceChildren();
      banner(result.readiness?.ready ? 'Chat enabled — this agent can now reply.' : 'Key stored, but chat is still blocked; see the reasons above.', result.readiness?.ready ? 'ok' : 'warn');
      await loadAgentConversation();
    } catch (error) {
      banner(error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });
  host.replaceChildren(form);
  key.focus();
}

const JOB_LABELS = {
  queued: 'queued — waiting for the chat worker',
  running: 'running — model call in progress',
  succeeded: 'answered',
  blocked: 'blocked — no reply was generated',
  needs_review: 'needs review — the call did not complete',
  superseded: 'superseded',
};

async function sendChatMessage(event) {
  event.preventDefault();
  const slug = state.chatAgent?.slug;
  const input = $('#chat-form input');
  if (!slug || !input) return;
  const message = input.value.trim();
  if (!message) return;
  const button = $('#chat-form button[type="submit"]');
  input.value = '';
  if (button) button.disabled = true;
  try {
    await api(`/agents/${encodeURIComponent(slug)}/messages`, {
      method: 'POST',
      body: { message, idempotencyKey: `owner-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    });
    await loadAgentConversation();
    await followAgentReply(slug);
  } catch (error) {
    banner(error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

/** Poll briefly while a real chat job is in flight; never fakes a reply. */
async function followAgentReply(slug, attempts = 10) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (state.chatAgent?.slug !== slug || state.view !== 'agents') return;
    const pending = await loadAgentConversation();
    if (!pending) return;
  }
}


// ── withdrawal methods (shared by Withdraw and Card) ────────────────────────
function methodRow(method, onChanged) {
  const side = [chip(method.statusLabel, method.payable ? 'ok' : 'warn')];
  if (canMutate()) {
    if (!method.payable) {
      const verify = el('button', { class: 'ghost small', type: 'button', text: 'Verify' });
      verify.addEventListener('click', () => openMethodVerification(method, onChanged));
      side.push(verify);
    }
    const remove = el('button', { class: 'ghost small', type: 'button', text: 'Remove' });
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Remove ${method.label}? The encrypted details are destroyed.`)) return;
      try {
        await api(`/withdrawal-methods/${method.slot}/remove`, { method: 'POST', body: {} });
        banner('Withdrawal method removed.', 'ok');
        await onChanged();
      } catch (error) {
        banner(error.message, 'error');
      }
    });
    side.push(remove);
  }
  return el('div', { class: 'method' }, [
    row(
      method.label,
      `${method.typeLabel}${method.holderName ? ` · ${method.holderName}` : ''} · ${method.masked || 'no account on record'} · ${method.currency}`,
      side,
    ),
  ]);
}

function renderMethods(target, methods, onChanged) {
  fill(
    target,
    (methods || []).map((method) => methodRow(method, onChanged)),
    'You haven’t set up any withdrawal methods yet.',
  );
}

/** Secure add-method form. Secret fields are password inputs, never logged. */
async function openMethodForm(host, onChanged) {
  const node = $(host);
  if (!node) return;
  if (node.dataset.open === '1') { node.replaceChildren(); node.dataset.open = '0'; return; }
  node.dataset.open = '1';
  node.replaceChildren(el('p', { class: 'empty', text: 'Loading withdrawal method types…' }));
  let payload;
  try {
    payload = await api('/withdrawal-methods');
  } catch (error) {
    node.replaceChildren(el('p', { class: 'empty', text: error.message }));
    return;
  }
  if ((payload.methods || []).length >= payload.max) {
    node.replaceChildren(el('p', { class: 'empty', text: `The maximum of ${payload.max} withdrawal methods is already configured. Remove one to add another.` }));
    return;
  }
  const types = payload.types || [];
  const select = el('select', { name: 'type' }, types.map((type) => el('option', { value: type.key, text: type.label })));
  const fields = el('div', { class: 'form-fields' });
  const availability = el('p', { class: 'muted tiny' });

  const renderFields = () => {
    const type = types.find((entry) => entry.key === select.value) || types[0];
    availability.textContent = `${type.description} ${type.availability}`;
    fields.replaceChildren(
      ...type.fields.map((field) => {
        const input = el('input', {
          name: field.key,
          type: field.secret ? 'password' : 'text',
          autocomplete: 'off',
          autocapitalize: 'off',
          spellcheck: 'false',
          placeholder: field.placeholder || field.label,
          ...(field.required ? { required: 'required' } : {}),
          ...(field.key === 'currency' ? { value: 'USD' } : {}),
        });
        return el('label', { class: 'field' }, [
          el('span', { class: 'tiny muted', text: `${field.label}${field.secret ? ' · encrypted' : ''}` }),
          input,
          field.help ? el('span', { class: 'tiny muted', text: field.help }) : null,
        ].filter(Boolean));
      }),
    );
  };
  select.addEventListener('change', renderFields);

  const form = el('form', { class: 'simple-form method-form' }, [
    el('label', { class: 'field' }, [el('span', { class: 'tiny muted', text: 'Method type' }), select]),
    availability,
    fields,
    el('label', { class: 'field' }, [
      el('span', { class: 'tiny muted', text: 'Label (optional)' }),
      el('input', { name: 'label', autocomplete: 'off', placeholder: 'e.g. Main payout account' }),
    ]),
    el('div', { class: 'side' }, [
      el('button', { type: 'submit', text: 'Save withdrawal method' }),
      el('button', { type: 'button', class: 'ghost small', text: 'Cancel' }),
    ]),
    el('p', { class: 'muted tiny', text: 'Account numbers, IBANs, SWIFT codes and provider emails are encrypted with the mission vault key before they are stored. Only a masked form (••••1234) is ever displayed, logged or audited. Saving a method does not verify it — verification is a separate owner step.' }),
  ]);
  form.querySelector('button.ghost').addEventListener('click', () => { node.replaceChildren(); node.dataset.open = '0'; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const type = types.find((entry) => entry.key === select.value);
    const values = {};
    for (const field of type.fields) {
      const input = form.querySelector(`[name="${field.key}"]`);
      if (input && input.value.trim()) values[field.key] = input.value.trim();
    }
    const label = form.querySelector('[name="label"]').value.trim();
    try {
      await api('/withdrawal-methods', { method: 'POST', body: { type: type.key, label: label || undefined, values } });
      // Clear the typed secrets from the DOM immediately.
      form.reset();
      node.replaceChildren();
      node.dataset.open = '0';
      banner('Withdrawal method saved — details encrypted, only the masked form is shown.', 'ok');
      await onChanged();
    } catch (error) {
      banner(error.message, 'error');
    }
  });
  renderFields();
  node.replaceChildren(form);
}

/** Real destination verification: the owner confirms each control check. */
async function openMethodVerification(method, onChanged) {
  let status;
  try {
    status = await api(`/payout-slots/${method.slot}/verification`);
  } catch (error) {
    banner(error.message, 'error');
    return;
  }
  const host = $('#withdraw-method-form') || $('#card-method-form');
  if (!host) return;
  const checks = status.checks || [];
  const form = el('form', { class: 'simple-form' }, [
    el('h4', { text: `Verify ${method.label}` }),
    el('p', { class: 'muted tiny', text: 'Confirm each control check honestly. A half-confirmed destination is refused, and verification expires so it must be renewed.' }),
    el('div', { class: 'checks' }, checks.map((check) =>
      el('label', { class: 'check' }, [
        el('input', { type: 'checkbox', name: `check:${check.key}` }),
        el('span', { text: check.label }),
      ]),
    )),
    el('label', { class: 'field' }, [
      el('span', { class: 'tiny muted', text: 'Evidence reference (statement id, provider confirmation…)' }),
      el('input', { name: 'evidenceRef', autocomplete: 'off' }),
    ]),
    el('label', { class: 'field' }, [
      el('span', { class: 'tiny muted', text: 'Attestation — type your confirmation' }),
      el('textarea', { name: 'attestation', rows: '3', required: 'required' }),
    ]),
    el('div', { class: 'side' }, [
      el('button', { type: 'submit', text: 'Confirm verification' }),
      el('button', { type: 'button', class: 'ghost small', text: 'Cancel' }),
    ]),
  ]);
  form.querySelector('button.ghost').addEventListener('click', () => host.replaceChildren());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = { checks: {}, attestation: form.querySelector('[name="attestation"]').value.trim(), evidenceRef: form.querySelector('[name="evidenceRef"]').value.trim() || undefined };
    for (const check of checks) body.checks[check.key] = form.querySelector(`[name="check:${check.key}"]`).checked;
    try {
      await api(`/payout-slots/${method.slot}/verification/start`, { method: 'POST', body: { evidenceRef: body.evidenceRef } });
      await api(`/payout-slots/${method.slot}/verification/confirm`, { method: 'POST', body });
      host.replaceChildren();
      banner('Destination verified.', 'ok');
      await onChanged();
    } catch (error) {
      banner(error.message, 'error');
    }
  });
  host.replaceChildren(form);
}

// ── 3. WITHDRAW ─────────────────────────────────────────────────────────────
async function loadWithdrawSimple() {
  const data = await loadSummary();
  const currency = data.currency || 'USD';
  const withdraw = data.withdraw;
  const methods = withdraw.methods || [];

  fill('#withdraw-tiles', [
    tile('Verified available', money(withdraw.availableCents, currency), 'received + verified only', 'primary'),
    tile('Withdrawals in progress', money(withdraw.pendingCents, currency), `${withdraw.pendingCount} request${withdraw.pendingCount === 1 ? '' : 's'}`),
    tile('Paid out', money(withdraw.settledCents, currency), `${withdraw.settledCount} settled`),
    tile('Expected (not money)', money(data.money.expectedNotEarnedCents, currency), 'cannot be withdrawn', 'muted-tile'),
  ]);

  const action = $('#withdraw-action');
  action.replaceChildren();
  const payable = methods.filter((method) => method.payable);

  if (withdraw.availableCents <= 0) {
    action.appendChild(el('p', { class: 'empty', text: 'There is no verified balance to withdraw yet. Verified earnings appear here as soon as real money is received and independently verified.' }));
    action.appendChild(el('p', { class: 'muted tiny', text: methods.length ? `${methods.length} withdrawal method${methods.length === 1 ? '' : 's'} configured and ready for when verified money arrives.` : 'Add a withdrawal method now so a payout can be made the moment verified money arrives.' }));
  } else if (!payable.length) {
    action.appendChild(el('p', { class: 'empty', text: methods.length ? 'No withdrawal method is verified yet. Verify one below before withdrawing.' : 'Add a withdrawal method below before withdrawing.' }));
  } else {
    const form = el('form', { class: 'simple-form', id: 'simple-withdraw-form' }, [
      el('div', { class: 'form-row' }, [
        el('select', { name: 'slot' }, payable.map((method) => el('option', { value: String(method.slot), text: `${method.label} (${method.masked || 'verified'})` }))),
        el('input', { name: 'amount', type: 'number', min: '0.01', step: '0.01', placeholder: `Amount in ${currency}`, required: 'required' }),
      ]),
      el('input', { name: 'memo', placeholder: 'Reference (optional)', autocomplete: 'off' }),
      el('button', { type: 'submit', text: 'Request withdrawal' }),
      el('p', { class: 'muted tiny', text: 'A withdrawal needs your approval and a provider settlement reference. It is only reported as paid when the external provider confirms settlement.' }),
    ]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const slot = Number(form.querySelector('[name="slot"]').value);
      const amountCents = Math.round(Number(form.querySelector('[name="amount"]').value) * 100);
      if (!Number.isFinite(amountCents) || amountCents <= 0) return;
      try {
        await api('/withdraw', { method: 'POST', body: { slot, amountCents, memo: form.querySelector('[name="memo"]').value || undefined } });
        banner('Withdrawal requested — it now waits for your approval.', 'ok');
        await loadWithdrawSimple();
      } catch (error) {
        banner(error.message, 'error');
      }
    });
    action.appendChild(form);
  }

  renderMethods('#withdraw-destinations', methods, loadWithdrawSimple);
  const hint = $('#withdraw-destinations');
  if (hint && !methods.length) {
    hint.appendChild(el('p', { class: 'muted tiny', text: 'Up to 4 real methods: local bank account, international wire, Payoneer or an existing Wise account. Details are encrypted; only a masked form is displayed.' }));
  }

  fill(
    '#withdraw-history',
    (withdraw.payouts || []).map((payout) =>
      row(money(payout.amountCents, payout.currency), `${payout.label} · ${when(payout.createdAt)}`, [statusChip(payout.status)]),
    ),
    'No withdrawals yet.',
  );
}

// ── 4. CARD ─────────────────────────────────────────────────────────────────
function cardFace(card, availableCents, currency, providerConnected) {
  if (!card) {
    return el('div', { class: 'cardface' }, [
      el('div', { class: 'brandline' }, [el('span', { class: 'mark', text: 'ZA141251SA' }), chip('NOT ISSUED', 'warn')]),
      el('div', {}, [
        el('span', { class: 'label muted tiny', text: 'Available (verified)' }),
        el('div', { class: 'amount', text: money(availableCents, currency) }),
      ]),
      el('div', { class: 'number', text: '•••• •••• •••• ••••' }),
      el('div', { class: 'meta' }, [
        el('span', { text: 'Mission treasury' }),
        el('span', { text: providerConnected ? 'card provider connected' : 'card provider not connected' }),
      ]),
    ]);
  }
  return el('div', { class: 'cardface issued' }, [
    el('div', { class: 'brandline' }, [el('span', { class: 'mark', text: 'ZA141251SA' }), chip(String(card.status).toUpperCase(), card.status === 'active' ? 'ok' : 'warn')]),
    el('div', {}, [
      el('span', { class: 'label muted tiny', text: 'Available (verified)' }),
      el('div', { class: 'amount', text: money(availableCents, card.currency || currency) }),
    ]),
    el('div', { class: 'number', text: `•••• •••• •••• ${card.last4}` }),
    el('div', { class: 'meta' }, [
      el('span', { text: `${card.provider}${card.brand ? ` · ${card.brand}` : ''}` }),
      el('span', { text: `issued ${when(card.issuedAt)}` }),
    ]),
  ]);
}

async function loadCardSimple() {
  const data = await loadSummary();
  const currency = data.currency || 'USD';
  const card = data.card;
  const methods = card.methods || data.withdraw?.methods || [];
  const cards = card.cards || [];

  renderMethods('#card-methods', methods, loadCardSimple);

  const face = $('#card-face');
  face.replaceChildren();
  if (!cards.length) {
    face.appendChild(el('p', { class: 'empty', text: 'No cards issued.' }));
    face.appendChild(cardFace(null, card.availableCents, currency, card.providerConnected));
  } else {
    const grid = el('div', { class: 'cardgrid' }, cards.map((entry) => cardFace(entry, card.availableCents, currency, card.providerConnected)));
    face.appendChild(grid);
    face.appendChild(el('p', { class: 'muted tiny', text: `${cards.length} of ${card.maxCards} mission cards issued. Full card number, CVV and PIN are never stored or displayed.` }));
  }

  const detail = $('#card-detail');
  const issueButton = el('button', { class: 'small', type: 'button', text: cards.length ? 'Issue another mission card' : 'Issue a mission card' });
  issueButton.disabled = !card.canIssue || !canMutate();
  issueButton.addEventListener('click', async () => {
    try {
      await api('/cards/issue', { method: 'POST', body: {} });
      banner('Card provider confirmed issuance.', 'ok');
      await loadCardSimple();
    } catch (error) {
      banner(error.message, 'error');
    }
  });

  detail.replaceChildren(
    el('h2', { text: 'Card status' }),
    el('p', { class: 'muted small', text: card.note }),
    el('div', { class: 'list' }, [
      row('Cards issued', `${cards.length} of ${card.maxCards}`, [chip(card.status, cards.length ? 'ok' : 'warn')]),
      row('Card provider', card.providerName, [card.providerConnected ? chip('connected', 'ok') : chip('not connected', 'warn')]),
      row('Available to fund a card', money(card.availableCents, currency), [chip('verified only', 'ok')]),
    ]),
    (card.blockers || []).length
      ? el('div', {}, [
          el('h3', { text: cards.length ? 'Why another card cannot be issued yet' : 'Why no card can be issued yet' }),
          el('div', { class: 'list' }, card.blockers.map((blocker) => row(blocker, '', [], null, true))),
        ])
      : null,
    el('h3', { text: 'What a real card needs' }),
    el('div', { class: 'list' }, (card.requirements || []).map((requirement) => row(requirement, '', [], null, true))),
    el('div', { class: 'side' }, [issueButton]),
    el('p', { class: 'muted tiny', text: card.canIssue ? 'Issuance calls the connected card provider; a card appears here only if the provider confirms it.' : 'The button stays disabled until a real card provider is connected and the requirements above are met — no placeholder card is created.' }),
  );
}

// ── view routing ────────────────────────────────────────────────────────────
async function loadView(view) {
  state.view = VIEWS.includes(view) ? view : 'home';
  storage.write(VIEW_KEY, state.view);
  $$('#mainnav .navbtn').forEach((button) => button.classList.toggle('active', button.getAttribute('data-view') === state.view));
  $$('[data-view-panel]').forEach((panel) => { panel.hidden = panel.getAttribute('data-view-panel') !== state.view; });
  try {
    if (state.view === 'home') await loadHome();
    if (state.view === 'agents') await loadAgentSub(state.agentSub);
    if (state.view === 'withdraw') await loadWithdrawSimple();
    if (state.view === 'card') await loadCardSimple();
  } catch (error) {
    if (error.status !== 401) banner(error.message, 'error');
  }
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

  // ── simple shell navigation ───────────────────────────────────────────
  $('#mainnav').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-view]');
    if (!button) return;
    await loadView(button.getAttribute('data-view'));
  });

  $('#agent-quick-search').addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = (new FormData(event.target).get('q') || '').toString().trim();
    try {
      await loadAgentsSimple(query);
    } catch (error) {
      if (error.status !== 401) banner(error.message, 'error');
    }
  });

  // Add-withdrawal-method buttons (Withdraw and Card open the same secure form).
  $('#add-method')?.addEventListener('click', () => openMethodForm('#withdraw-method-form', loadWithdrawSimple));
  $('#card-add-method')?.addEventListener('click', () => openMethodForm('#card-method-form', loadCardSimple));


  // Agents ⇄ Chat sub-navigation.
  $('#agentnav')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-sub]');
    if (!button) return;
    await loadAgentSub(button.getAttribute('data-sub'));
  });

  $('#chat-search')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = (new FormData(event.target).get('q') || '').toString().trim();
    try {
      await renderChatAgentList(query);
    } catch (error) {
      if (error.status !== 401) banner(error.message, 'error');
    }
  });

  // Category facet: changing it re-runs the search across the whole fleet.
  $('#agent-category')?.addEventListener('change', async (event) => {
    try {
      // Use what is actually typed in the box, not the last submitted query.
      const typed = ($('#agent-quick-search')?.querySelector('input')?.value || '').trim();
      await loadAgentsSimple(typed, { category: event.target.value });
    } catch (error) {
      if (error.status !== 401) banner(error.message, 'error');
    }
  });

  $('#chat-form')?.addEventListener('submit', sendChatMessage);
}

async function boot() {
  readLinkFromUrl();
  wire();
  if (!state.token && !state.link) {
    // No token in web storage. The frame may simply have been re-created by an
    // embedded preview, so ask the server whether the HttpOnly session cookie
    // still identifies us before dropping the operator back to sign-in.
    try {
      const me = await api('/session/me');
      if (me && me.owner) {
        state.owner = me.owner;
        state.cookieAuth = true;
        await start();
        return;
      }
    } catch { /* not signed in: show the login panel */ }
    return;
  }
  try {
    if (state.token) {
      const me = await api('/session/me');
      state.owner = me.owner;
    }
    await start();
  } catch (error) {
    if (error.status === 401) {
      state.token = '';
      storage.clear(TOKEN_KEY);
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

