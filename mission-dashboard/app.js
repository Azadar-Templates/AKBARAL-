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
    card('Realized revenue', money(overview.revenue.windows.lifetimeCents, currency), 'verified receipts only'),
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
    card('Realized revenue', money(revenue.realizedCents, currency), 'verified receipts'),
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

async function renderAgentMessages(host, slug) {
  host.replaceChildren(el('h3', { text: 'Owner / agent messages' }), el('p', { class: 'muted small', text: 'Stored private correspondence, not simulated agent replies. Text does not execute commands or move money. Use the explicit owner controls for actions.' }));
  const transcript = el('div', { class: 'table-wrap', 'aria-live': 'polite' });
  host.appendChild(transcript);
  const messages = [];
  let cursor = 0;
  const refresh = el('button', { type: 'button', class: 'small', text: 'Refresh / load next messages' });
  const load = async () => {
    try {
      const result = await api(`/agents/${encodeURIComponent(slug)}/messages?after=${cursor}`);
      messages.push(...result.messages);
      cursor = result.nextCursor;
      transcript.replaceChildren(table([
        { label: 'When', render: row => when(row.created_at) },
        { label: 'From', key: 'actor_type' },
        { label: 'Message', key: 'body', wrap: true },
      ], messages, 'No messages yet. No agent response is fabricated.'));
      refresh.textContent = result.hasMore ? 'Load next page' : 'Refresh messages';
    } catch (error) { transcript.textContent = error.message; }
  };
  refresh.addEventListener('click', load);
  host.appendChild(refresh);
  if (canMutate()) {
    const form = el('form', { class: 'stack-form' });
    const input = el('textarea', { name: 'message', maxlength: 12000, required: '', 'aria-label': 'Message to this agent', placeholder: 'Send a private message. Never paste credentials.' });
    form.append(input, el('button', { type: 'submit', text: 'Send owner message' }));
    let key = crypto.randomUUID();
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!guardMutation()) return;
      try {
        await api(`/agents/${encodeURIComponent(slug)}/messages`, { method: 'POST', body: { message: input.value, idempotencyKey: key } });
        input.value = '';
        key = crypto.randomUUID();
        await load();
        banner('Owner message stored. Await an actual agent reply; no command was executed.', 'ok');
      } catch (error) { banner(error.message, 'error'); }
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
    if (tab === 'treasury') await loadTreasury();
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
    card('Realized revenue', money(totals.realizedRevenueCents, currency)),
    card('Pending revenue', money(totals.pendingRevenueCents, currency), 'contracted + expected'),
    card('Expenses', money(totals.totalExpensesCents, currency)),
    card('Settled payouts', money(totals.settledPayoutsCents, currency)),
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
    { label: 'Action', render: (row) => canMutate() && ['approved', 'needs_verification'].includes(row.status) ? el('button', { class: 'small', text: 'Record provisioning', 'data-provision': row.id }) : '—' },
  ], resources.resources, 'No resources requested.'));
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

  $('#credential-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!guardMutation()) return;
    const data = new FormData(event.target);
    try {
      await api('/credentials', {
        method: 'POST',
        body: {
          provider: data.get('provider'),
          label: data.get('label'),
          secret: data.get('secret'),
          expiresAt: data.get('expiresAt') || undefined,
          envVar: data.get('envVar') || undefined,
        },
      });
      banner('Credential stored encrypted. Its value will never be displayed.', 'ok');
      event.target.reset();
      await loadTools();
    } catch (error) { banner(error.message, 'error'); }
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
