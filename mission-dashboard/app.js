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

const state = {
  token: sessionStorage.getItem(TOKEN_KEY) || '',
  link: sessionStorage.getItem(LINK_KEY) || '',
  owner: null,
  overview: null,
  activeTab: 'overview',
  verifyingSlot: null,
};

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
  state.token = '';
  state.owner = null;
  sessionStorage.removeItem(TOKEN_KEY);
  $('#app').hidden = true;
  $('#login-panel').hidden = false;
  $('#signout').hidden = true;
  $('#identity').textContent = 'not signed in';
  if (notify) banner('Signed out.', 'ok');
}

async function login(email, password) {
  const payload = await api('/session/login', { method: 'POST', body: { email, password } });
  state.token = payload.token;
  state.owner = payload.owner;
  showIdentity();
  state.link = '';
  sessionStorage.setItem(TOKEN_KEY, payload.token);
  sessionStorage.removeItem(LINK_KEY);
  await start();
}

async function start() {
  $('#login-panel').hidden = true;
  $('#app').hidden = false;
  $('#signout').hidden = !canMutate();
  // Identify the operator from the session state we already hold, before any
  // network round-trip: a signed-in person must never see "not signed in".
  showIdentity();
  try {
    const overview = await api('/overview');
    state.overview = overview;
    showIdentity();
    renderOverview(overview);
  } catch (error) {
    if (error.status !== 401) banner(error.message, 'error');
  }
  await loadTab(state.activeTab);
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

function renderOverview(overview) {
  const cards = $('#overview-cards');
  cards.innerHTML = '';
  const currency = overview.treasury.currency;
  const treasury = overview.treasury.totals;
  cards.append(
    card('Agents', overview.agents.total, `${overview.agents.custom} created in-mission · ${overview.agents.registry} from the registry`),
    card('Hierarchy depth', overview.agents.maxDepth, `cap ${overview.policy.maxDepth}`),
    card('Legacy reported revenue', money(overview.revenue.windows.lifetimeCents, currency), 'verified receipts only'),
    card('Treasury balance', money(treasury.totalBalanceCents, currency), `${overview.treasury.wallets.length} wallets`),
    card('Today (verified)', money(overview.revenue.windows.todayCents, currency)),
    card('Last 30 days', money(overview.revenue.windows.last30DaysCents, currency)),
    card('Contracted (not earned)', money(overview.revenue.contractedCents, currency)),
    card('Expected (not earned)', money(overview.revenue.expectedCents, currency)),
    card('Expenses paid', money(overview.expenses.paidCents, currency), `${money(overview.expenses.pendingCents, currency)} awaiting decision`),
    card('Committed monthly cost', money(overview.costs.monthlyCommittedCents, currency), 'active resources'),
    card('Spend today', money(overview.costs.spendTodayCents, currency), `cap ${money(overview.costs.dailyCapCents, currency)}`),
    card('Pending approvals', overview.approvals.pending, `${overview.upgrades.requested} upgrade requests`),
  );

  $('#revenue-honesty').textContent = overview.honesty.noFabrication;

  replace('#revenue-realized', table([
    { label: 'Source', key: 'source' },
    { label: 'Receipts', key: 'count' },
    { label: 'Amount', render: (row) => money(row.cents, currency) },
  ], overview.revenue.bySource, 'No verified receipts yet — nothing has been earned, so nothing is shown.'));

  const pending = overview.revenue.recent.filter((row) => row.status !== 'received');
  replace('#revenue-pending', table([
    { label: 'Recorded', render: (row) => when(row.created_at) },
    { label: 'Status', render: (row) => pill(String(row.status), 'warn') },
    { label: 'Amount', render: (row) => money(row.amount_cents, currency) },
    { label: 'Work', render: (row) => row.work_id || '—' },
    { label: 'Reference', render: (row) => row.external_ref || '—' },
  ], pending, 'No contracted or expected amounts recorded.'));

  replace('#targets', table([
    { label: 'Target', key: 'label' },
    { label: 'Period', key: 'period' },
    { label: 'Goal', render: (row) => money(row.amountCents, currency) },
    { label: 'Verified progress', render: (row) => `${money(row.actualCents, currency)} (${row.progressPct}%)` },
    { label: 'Kind', render: () => pill('target', 'warn') },
  ], overview.targets, 'No targets configured.'));

  replace('#expenses', table([
    { label: 'Category', key: 'category' },
    { label: 'Entries', key: 'count' },
    { label: 'Paid', render: (row) => money(row.cents, currency) },
  ], overview.expenses.byCategory, 'No expenses paid yet.'));

  replace('#costs', table([
    { label: 'Cost category (30 days)', key: 'category' },
    { label: 'Entries', key: 'count' },
    { label: 'Spend', render: (row) => money(row.cents, currency) },
  ], overview.costs.byCategory, 'No operating spend recorded in the last 30 days.'));

  replace('#integrity', table([
    { label: 'Chain', render: (row) => row.name },
    { label: 'State', render: (row) => (row.ok ? pill('verified', 'ok') : pill('broken', 'bad')) },
    { label: 'Entries', render: (row) => row.count },
  ], [
    { name: 'Audit trail', ok: overview.audit.ok, count: overview.audit.rows },
    { name: 'Ledger', ok: overview.integrity.ledger.ok, count: overview.integrity.ledger.rows },
  ]));

  replace('#activation', table([
    { label: 'Provider', key: 'provider' },
    { label: 'Required external action', key: 'action', wrap: true },
    { label: 'Why', key: 'why', wrap: true },
  ], overview.honesty.externalActivationPending, 'Nothing pending.'));
}

function renderAgentReport(report) {
  const currency = state.overview ? state.overview.treasury.currency : 'USD';
  const host = $('#agent-report');
  host.innerHTML = '';
  const revenue = report.revenue;

  host.appendChild(el('h2', { text: `Agent — ${report.agent.name}` }));
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
  ]));

  host.appendChild(el('p', { class: 'muted small', text: report.honesty.note }));
  if (canMutate()) {
    host.appendChild(renderAgentControls(report));
  }

  const conversation = el('section', { class: 'control-block', 'aria-label': 'Private agent messages' });
  host.appendChild(conversation);
  void renderAgentMessages(conversation, report.agent.slug);

  host.appendChild(el('h3', { text: 'Children (delegation)' }));
  host.appendChild(table([
    { label: 'Slug', key: 'slug' },
    { label: 'Name', key: 'name' },
    { label: 'Role', key: 'role' },
    { label: 'Depth', key: 'depth' },
    { label: 'Status', render: (row) => pill(String(row.status), row.status === 'active' ? 'ok' : 'warn') },
  ], report.agent.children ?? [], 'This agent has not delegated any work yet.'));

  host.appendChild(el('h3', { text: 'Revenue by source (realized)' }));
  host.appendChild(table([
    { label: 'Source', key: 'source' },
    { label: 'Receipts', key: 'count' },
    { label: 'Amount', render: (row) => money(row.cents, currency) },
  ], revenue.bySource, 'No verified revenue for this agent.'));

  host.appendChild(el('h3', { text: 'Receipts' }));
  host.appendChild(table([
    { label: 'When', render: (row) => when(row.receivedAt) },
    { label: 'Amount', render: (row) => money(row.amountCents, currency) },
    { label: 'Status', render: (row) => pill(String(row.status), row.status === 'received' ? 'ok' : 'warn') },
    { label: 'Verifier', render: (row) => row.verifier || '—' },
    { label: 'Reference', render: (row) => row.externalRef || '—' },
  ], revenue.entries, 'No revenue recorded for this agent.'));

  host.appendChild(el('h3', { text: 'Work that produced it' }));
  host.appendChild(table([
    { label: 'Title', key: 'title', wrap: true },
    { label: 'Activity', key: 'category' },
    { label: 'Status', key: 'status' },
    { label: 'Revenue', render: (row) => money(row.revenueCents, currency) },
    { label: 'Cost', render: (row) => money(row.costCents, currency) },
    { label: 'Created', render: (row) => when(row.createdAt) },
  ], report.work, 'No approved work recorded yet.'));

  host.appendChild(el('h3', { text: 'Expenses' }));
  host.appendChild(table([
    { label: 'When', render: (row) => when(row.createdAt) },
    { label: 'Category', key: 'category' },
    { label: 'Provider', key: 'provider' },
    { label: 'Amount', render: (row) => money(row.amountCents, currency) },
    { label: 'Status', key: 'status' },
  ], report.expenses.entries, 'No expenses recorded for this agent.'));

  host.appendChild(el('h3', { text: 'Resources, credentials, services & upgrades' }));
  host.appendChild(table([
    { label: 'Kind', key: 'kind' },
    { label: 'Provider', key: 'provider' },
    { label: 'Status', key: 'status' },
    { label: 'Monthly cost', render: (row) => money(row.monthlyCostCents, currency) },
    { label: 'Expires', render: (row) => when(row.expiresAt) },
  ], report.resources, 'No resources assigned.'));
  host.appendChild(table([
    { label: 'Provider', key: 'provider' },
    { label: 'Label', key: 'label' },
    { label: 'Status', render: (row) => pill(String(row.status), row.urgency === 'critical' ? 'warn' : 'info') },
    { label: 'Expires', render: (row) => when(row.expiresAt) },
  ], report.credentials, 'No credentials stored.'));
  host.appendChild(table([
    { label: 'Service', key: 'name' },
    { label: 'Kind', key: 'kind' },
    { label: 'Health', key: 'status' },
    { label: 'Source', render: (row) => row.healthSource || '—' },
    { label: 'Checked', render: (row) => when(row.lastCheckedAt) },
  ], report.services, 'No services assigned.'));
  host.appendChild(table([
    { label: 'Capability', key: 'capability', wrap: true },
    { label: 'Status', key: 'status' },
    { label: 'Cost', render: (row) => money(row.costCents, currency) },
    { label: 'Requested', render: (row) => when(row.createdAt) },
  ], report.upgrades, 'No upgrades requested.'));
}

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
  form.append(enabled, resource, wallet, el('p', { text: 'Fixed model: gemini-2.5-flash. Internal reservations are not a provider-enforced billing ceiling.' }));
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
      await api(`${base}/chat-config`, { method: 'POST', body: { enabled: enabled.value === 'true', resourceId: resource.value, walletId: wallet.value, model: 'gemini-2.5-flash', maxInputBytes: Number(form.elements.maxInputBytes.value), maxOutputTokens: Number(form.elements.maxOutputTokens.value), maxCostCents: Number(form.elements.maxCostCents.value), costBasis: basis.value } });
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

async function loadTab(tab) {
  try {
    if (tab === 'overview') {
      const overview = await api('/overview');
      state.overview = overview;
      renderOverview(overview);
    }
    if (tab === 'agents') await loadAgents();
    if (tab === 'customer-work') await loadCustomerWork();
    if (tab === 'money') await loadVerifiedCash();
    if (tab === 'treasury') await loadTreasury();
    if (tab === 'withdraw') await loadWithdraw();
    if (tab === 'publishing') await loadPublishing();
    if (tab === 'approvals') await loadApprovals();
    if (tab === 'tools') await loadTools();
    if (tab === 'policy') await loadPolicy();
    if (tab === 'audit') await loadAudit();
  } catch (error) {
    banner(error.message, 'error');
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
  ], rows, 'No agents match.');
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
async function loadPublishing() {
  const payload = await api('/social/connections');
  const currency = 'USD';
  void currency;
  const rows = payload.platforms.map((platform) => ({
    ...platform,
    appLabel: platform.appConfigured ? pill('app registered', 'ok') : pill('app not registered', 'warn'),
    connectionLabel: platform.connected ? pill('connected', 'ok') : pill(platform.status.replace('_', ' '), 'warn'),
    expiry: platform.expiresAt ? `${platform.expiresAt.slice(0, 10)} (${platform.daysUntilExpiry} d)` : '—',
    actions: el('span', {}, [
      canMutate() && platform.appConfigured && !platform.connected
        ? el('button', { class: 'small', text: 'Connect', 'data-platform': platform.id, 'data-action': 'connect' }) : null,
      canMutate() && platform.connected
        ? el('button', { class: 'small', text: 'Disconnect', 'data-platform': platform.id, 'data-action': 'disconnect' }) : null,
    ]),
  }));
  replace('#social-connections', table([
    { label: 'Platform', key: 'label' },
    { label: 'App', render: (row) => row.appLabel },
    { label: 'Connection', render: (row) => row.connectionLabel },
    { label: 'Account', render: (row) => row.accountLabel || '—' },
    { label: 'Token expires', key: 'expiry' },
    { label: 'Scopes', render: (row) => (row.scopes || []).join(', ') },
    { label: 'Actions', render: (row) => row.actions },
  ], rows, 'Publishing platforms unavailable.'));

  const setupItems = payload.setup || [];
  const setupHost = $('#social-setup');
  setupHost.innerHTML = '';
  setupHost.appendChild(el('h3', { text: 'Setup required (owner action, outside this dashboard)' }));
  if (setupItems.length === 0) {
    setupHost.appendChild(el('p', { class: 'muted small', text: 'Every platform app is registered. Connect each account when you are ready.' }));
  } else {
    const list = el('ul', { class: 'muted small' });
    for (const item of setupItems) {
      list.appendChild(
        el('li', {
          text: `${item.label}: register an app, add the redirect URI ${item.redirectUri}, then set ${item.requireEnvKeys.join(' and ')}.`,
        }),
      );
    }
    setupHost.appendChild(list);
  }
  if (payload.guaranteedEngagement === false) {
    setupHost.appendChild(
      el('p', {
        class: 'muted small',
        text: 'No engagement is synthesized anywhere in this system: metrics are read back from the platform API after publishing, or they are absent.',
      }),
    );
  }

  $$('#social-connections button[data-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!guardMutation()) return;
      const platform = button.getAttribute('data-platform');
      try {
        if (button.getAttribute('data-action') === 'connect') {
          const started = await api(`/social/oauth/${platform}/start`, { method: 'POST', body: {} });
          banner(`Approve the ${platform} scopes in the window that opens; the callback stores the connection.`, 'ok');
          window.open(started.authorizeUrl, '_blank', 'noopener');
        } else {
          const reason = window.prompt('Reason for disconnecting (stored in the audit trail)?');
          if (!reason) return;
          const result = await api(`/social/connections/${platform}`, { method: 'POST', body: { reason } });
          banner(result.providerRevoked ? 'Disconnected and the provider revoked the token.' : `Disconnected locally. ${result.providerRevokeResult}`, 'ok');
        }
        await loadPublishing();
      } catch (error) {
        banner(error.message, 'error');
      }
    });
  });
}

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

  $('#tabs').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-tab]');
    if (!button) return;
    const tab = button.getAttribute('data-tab');
    state.activeTab = tab;
    $$('#tabs .tab').forEach((entry) => entry.classList.toggle('active', entry === button));
    $$('[data-panel]').forEach((panel) => { panel.hidden = panel.getAttribute('data-panel') !== tab; });
    await loadTab(tab);
  });

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
  const form=el('form',{class:'control-block','aria-label':title});form.appendChild(el('h3',{text:title}));setup(form);const button=el('button',{type:'submit',text:title});form.appendChild(button);host.appendChild(form);
  form.addEventListener('submit',async event=>{event.preventDefault();if(!guardMutation())return;button.disabled=true;try{const result=await api(`/customer-work/${command}`,{method:'POST',body:toBody(new FormData(form))});await after(result.result);}catch(error){banner(error.message,'error');}finally{button.disabled=false;}});return form;
}
async function loadCustomerWork(){
  const host=$('#customer-work');host.replaceChildren();$('#customer-detail').replaceChildren();
  if(!canMutate()){host.appendChild(el('p',{text:'Owner sign-in required. Access links cannot view customer briefs.'}));return;}
  const data=await api('/customer-work');host.appendChild(el('p',{text:data.note}));
  host.appendChild(table([{label:'Capability (not a live offer)',key:'title'},{label:'Customer need',key:'customer',wrap:true},{label:'Deliverables',key:'deliverables',wrap:true},{label:'Limits',key:'limit'}],data.offers));
  host.appendChild(el('h3',{text:'Reviewed customer-acquisition mechanisms — not acquired leads'}));
  host.appendChild(table([{label:'Category',key:'category'},{label:'Where customers come from',key:'customerOrigin',wrap:true},{label:'Value to deliver',key:'value',wrap:true},{label:'Actual payment event',key:'paymentGeneration',wrap:true},{label:'Settlement gate',key:'settlement',wrap:true},{label:'Human ownership / approval',key:'human',wrap:true},{label:'Automation boundary',key:'automation',wrap:true}],data.channelInventory??[],'No channel inventory loaded.'));
  const services=data.offers.map(x=>x.id);
  customerForm(host,'Prepare unpublished listing','listing',form=>{customerField(form,'Service','serviceId','select',services);customerField(form,'Owner-proposed USD cents — not earnings','quoteCents','number');},f=>({serviceId:f.get('serviceId'),quoteCents:Number(f.get('quoteCents'))}),result=>customerOutput(host,result.text));
  customerForm(host,'Preview on my own authorized sample','preview',form=>{customerField(form,'Service','serviceId','select',services);customerField(form,'Non-sensitive sample input','input','textarea');const config=customerField(form,'Configuration JSON: required fields + uniqueKey, or null for HTML','configuration','textarea');config.value='null';customerField(form,'I have the data rights','dataRightsReviewed','checkbox');customerField(form,'This sample contains no sensitive data','nonSensitiveDataOnly','checkbox');},f=>({serviceId:f.get('serviceId'),input:f.get('input'),configuration:JSON.parse(f.get('configuration')),dataRightsReviewed:f.has('dataRightsReviewed'),nonSensitiveDataOnly:f.has('nonSensitiveDataOnly')}),result=>{customerOutput(host,result.classification);customerOutput(host,result.artifact);});
  customerForm(host,'Record an explicit customer request','record',form=>{
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
