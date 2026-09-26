/**
 * ZA141251SA owner console — client behaviour, rendered in a real DOM.
 *
 * The console is deliberately four sections (Overview, Agents + Chat,
 * Withdraw, Card). The protected mission systems (ledger, policy, approvals,
 * credentials, publishing, accounting, customer work) keep their own
 * authenticated API routes and are NOT part of this owner UI, so these tests
 * assert the console's own guarantees: it renders stored text as text, it
 * binds every conversation to the selected agent, it never fabricates an agent
 * reply, and a read-only access link cannot act.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.resolve('mission-dashboard/index.html'), 'utf8');

const summary = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  currency: 'USD',
  money: { verifiedAvailableCents: 0, verifiedEarnedTotalCents: 0, verifiedEarnedTodayCents: 0, verifiedEarned30dCents: 0, expectedNotEarnedCents: 0, pendingWithdrawalCents: 0, settledWithdrawalCents: 0, note: 'Verified money only.' },
  agents: { total: 2, active: 2, paused: 0, retired: 0, working: 0 },
  work: { total: 0, inProgress: 0, delivered: 0, recent: [] },
  activity: [],
  alerts: [],
  withdraw: { availableCents: 0, pendingCents: 0, pendingCount: 0, settledCents: 0, settledCount: 0, methods: [], methodCount: 0, maxMethods: 4, payableMethods: [], destinations: [], payouts: [] },
  card: { cards: [], count: 0, maxCards: 4, status: 'NOT ISSUED', availableCents: 0, providerConnected: false, providerName: 'Stripe Issuing (mission-dedicated keys)', canIssue: false, blockers: ['CREDENTIAL REQUIRED — no mission card provider is connected.'], requirements: ['A mission-dedicated card provider account.'], note: 'No card credentials are stored.', methods: [] },
  integrity: { auditOk: true, auditRows: 1, ledgerOk: true, identityLocked: true, killSwitch: false },
};

const AGENTS = [
  { id: 'agent-one', slug: 'agent-0001', name: 'Agent 0001', category: 'research', mission_role: 'worker', status: 'active' },
  { id: 'agent-two', slug: 'agent-0002', name: 'Agent 0002', category: 'writing', mission_role: 'worker', status: 'active' },
];

const briefing = (slug: string, name: string) => ({
  agentId: slug, slug, name, role: 'worker', category: 'research', status: 'active',
  capabilities: ['research'], currentWork: [], completedWork: [], workCounts: { total: 0, open: 0, delivered: 0 },
  walletBalanceCents: 0, verifiedRevenueCents: 0, expectedRevenueCents: 0, tools: [], resources: [], lastActivity: [], text: 'context',
});

const readiness = {
  ready: false, configured: false, enabled: false, provider: 'google', model: 'gemini-2.5-flash',
  blockers: ['No AI provider is configured for this agent.'],
  status: 'AI PROVIDER NOT CONFIGURED',
  message: 'AI provider not configured. This agent has no model credential, resource binding or chat budget, so no reply can be generated.',
};

function consoleFixture() {
  const source = fs.readFileSync(path.resolve('mission-dashboard/app.js'), 'utf8').replace("document.addEventListener('DOMContentLoaded', boot);", '');
  const dom = new JSDOM(HTML, { url: 'https://mission.example.test/', runScripts: 'outside-only' });
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  const messages: Record<string, Array<Record<string, unknown>>> = {
    'agent-0001': [{ id: 'm1', seq: 1, actor_type: 'owner', body: '<img src=x onerror="window.__xss=1">', created_at: '2026-01-01T00:00:00.000Z' }],
    'agent-0002': [],
  };
  dom.window.fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push({ url, method, body });
    const slug = (url.match(/\/api\/agents\/([^/?]+)/) ?? [])[1];
    if (method === 'POST' && url.endsWith('/messages')) {
      messages[slug].push({ id: `m-${messages[slug].length + 1}`, seq: messages[slug].length + 1, actor_type: 'owner', body: body.message, created_at: '2026-01-01T00:01:00.000Z' });
      return new Response(JSON.stringify({ message: { id: 'new' } }), { status: 201 });
    }
    if (url.startsWith('/api/summary')) return new Response(JSON.stringify(summary), { status: 200 });
    if (url.startsWith('/api/agents?')) {
      const query = new URL(url, 'https://mission.example.test').searchParams.get('q');
      const list = query ? AGENTS.filter((agent) => agent.name.toLowerCase().includes(query.toLowerCase()) || agent.slug.includes(query)) : AGENTS;
      return new Response(JSON.stringify({ total: AGENTS.length, agents: list }), { status: 200 });
    }
    if (url.includes('/chat-status')) {
      const agent = AGENTS.find((entry) => entry.slug === slug)!;
      return new Response(JSON.stringify({ agentId: agent.id, slug: agent.slug, readiness, briefing: briefing(agent.slug, agent.name), jobs: [] }), { status: 200 });
    }
    if (url.includes('/messages')) return new Response(JSON.stringify({ messages: messages[slug] ?? [], nextCursor: 0, hasMore: false, automaticReplies: false, automaticRepliesConfigured: false }), { status: 200 });
    if (url.startsWith('/api/withdrawal-methods')) {
      return new Response(JSON.stringify({ methods: [], count: 0, max: 4, types: [{ key: 'bank_local', label: 'Local bank account', description: 'd', availability: 'a', maskFrom: 'accountNumber', fields: [{ key: 'accountNumber', label: 'Account number', secret: true, required: true }, { key: 'currency', label: 'Currency', secret: false, required: true }] }] }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  dom.window.eval(`${source}\nwindow.fixture = { state, loadView, loadAgentSub, renderChatAgentList, openAgentChat, loadAgentConversation, sendChatMessage, openMethodForm, loadWithdrawSimple, loadCardSimple, wire };`);
  dom.window.fixture.wire();
  dom.window.fixture.state.token = 'synthetic-dom-session';
  return { dom, win: dom.window, requests };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

it('the owner console exposes only the four sections, with no legacy admin surface', () => {
  const dom = new JSDOM(HTML);
  const document = dom.window.document;
  const views = [...document.querySelectorAll('[data-view-panel]')].map((node) => node.getAttribute('data-view-panel'));
  assert.deepEqual(views, ['home', 'agents', 'withdraw', 'card']);
  assert.equal(document.querySelectorAll('[data-panel]').length, 0, 'the legacy 11-panel admin interface must not exist in the owner console');
  assert.equal(document.querySelector('#tabs'), null);
  assert.equal(document.querySelector('#advanced'), null);
  assert.equal(document.querySelector('#advanced-toggle'), null);
  assert.ok(!/Advanced \/ Owner settings/.test(HTML));
  assert.deepEqual(
    [...document.querySelectorAll('#agentnav .subbtn')].map((node) => node.getAttribute('data-sub')),
    ['browse', 'chat'],
    'Agents carries exactly two areas: the fleet list and the chat workspace',
  );
  dom.window.close();
});

it('a conversation renders stored text as text and never fabricates an agent reply', async () => {
  const { dom, win } = consoleFixture();
  try {
    await win.fixture.openAgentChat('agent-0001');
    await settle();
    const log = win.document.querySelector('#chat-log');
    assert.match(log.textContent, /onerror/, 'the stored message is shown literally');
    assert.equal(log.querySelectorAll('img').length, 0, 'stored text is never parsed as markup');
    assert.equal(win.__xss, undefined);
    assert.equal(log.querySelectorAll('.msg.agent').length, 0, 'no agent reply exists, so none is displayed');
    assert.match(win.document.querySelector('#chat-readiness').textContent, /AI PROVIDER NOT CONFIGURED/);
    assert.match(win.document.querySelector('#chat-note').textContent, /No answer is invented/i);
  } finally {
    dom.window.close();
  }
});

it('each message is posted to the selected agent with its own idempotency key', async () => {
  const { dom, win, requests } = consoleFixture();
  try {
    await win.fixture.openAgentChat('agent-0001');
    await settle();
    const form = win.document.querySelector('#chat-form');
    const input = form.querySelector('input');
    input.value = 'What are you doing right now?';
    await win.fixture.sendChatMessage(new win.Event('submit'));
    await settle();
    input.value = 'What should you do next?';
    await win.fixture.sendChatMessage(new win.Event('submit'));
    await settle();
    const posts = requests.filter((request) => request.method === 'POST');
    assert.equal(posts.length, 2);
    assert.ok(posts.every((post) => post.url === '/api/agents/agent-0001/messages'), 'messages go to the selected agent only');
    assert.notEqual(posts[0].body.idempotencyKey, posts[1].body.idempotencyKey);
    assert.equal(posts[0].body.message, 'What are you doing right now?');

    // An empty composer never posts.
    input.value = '   ';
    await win.fixture.sendChatMessage(new win.Event('submit'));
    await settle();
    assert.equal(requests.filter((request) => request.method === 'POST').length, 2);
  } finally {
    dom.window.close();
  }
});

it('switching agents rebinds the conversation to the newly selected agent', async () => {
  const { dom, win, requests } = consoleFixture();
  try {
    await win.fixture.openAgentChat('agent-0001');
    await settle();
    assert.match(win.document.querySelector('#chat-header').textContent, /Agent 0001/);
    await win.fixture.openAgentChat('agent-0002');
    await settle();
    assert.match(win.document.querySelector('#chat-header').textContent, /Agent 0002/);
    assert.equal(win.fixture.state.chatAgent.slug, 'agent-0002');
    assert.match(win.document.querySelector('#chat-log').textContent, /No messages yet with Agent 0002/);
    assert.ok(requests.some((request) => request.url.startsWith('/api/agents/agent-0002/chat-status')));

    const input = win.document.querySelector('#chat-form input');
    input.value = 'Explain your current task.';
    await win.fixture.sendChatMessage(new win.Event('submit'));
    await settle();
    const post = requests.filter((request) => request.method === 'POST').pop()!;
    assert.equal(post.url, '/api/agents/agent-0002/messages', 'the message follows the selected agent, not the first one opened');
  } finally {
    dom.window.close();
  }
});

it('the selected agent and section survive a reload through storage', async () => {
  const { dom, win } = consoleFixture();
  try {
    await win.fixture.openAgentChat('agent-0002');
    await settle();
    assert.equal(win.localStorage.getItem('za_mission_chat_agent'), 'agent-0002');
    assert.equal(win.localStorage.getItem('za_mission_view'), 'agents');
    assert.equal(win.localStorage.getItem('za_mission_agent_sub'), 'chat');
  } finally {
    dom.window.close();
  }
});

it('a read-only access link cannot send messages or change withdrawal methods', async () => {
  const { dom, win, requests } = consoleFixture();
  try {
    win.fixture.state.token = '';
    win.fixture.state.cookieAuth = false;
    win.fixture.state.link = 'synthetic-read-only-link';
    await win.fixture.openAgentChat('agent-0001');
    await settle();
    assert.equal(win.document.querySelector('#chat-form').hidden, true, 'a read-only link has no composer');
    await win.fixture.loadWithdrawSimple();
    await settle();
    assert.equal(win.document.querySelectorAll('#withdraw-destinations button').length, 0);
    assert.equal(requests.filter((request) => request.method === 'POST').length, 0);
  } finally {
    dom.window.close();
  }
});

it('the withdrawal method form keeps secret fields masked in the DOM and posts them once', async () => {
  const { dom, win, requests } = consoleFixture();
  try {
    await win.fixture.openMethodForm('#withdraw-method-form', async () => {});
    await settle();
    const secret = win.document.querySelector('#withdraw-method-form [name="accountNumber"]');
    assert.equal(secret.getAttribute('type'), 'password');
    assert.equal(secret.getAttribute('autocomplete'), 'off');
    secret.value = '12345678901234';
    win.document.querySelector('#withdraw-method-form [name="currency"]').value = 'PKR';
    win.document.querySelector('#withdraw-method-form form').dispatchEvent(new win.Event('submit'));
    await settle();
    const post = requests.find((request) => request.url === '/api/withdrawal-methods' && request.method === 'POST');
    assert.ok(post, 'the method is submitted to the encrypted-store endpoint');
    assert.equal((post!.body as any).values.accountNumber, '12345678901234');
    assert.ok(!win.document.body.innerHTML.includes('12345678901234'), 'the typed secret is cleared from the DOM after submission');
  } finally {
    dom.window.close();
  }
});
