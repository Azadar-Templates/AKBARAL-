import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const { JSDOM } = require('jsdom');

function consoleFixture() {
  const html = fs.readFileSync(path.resolve('mission-dashboard/index.html'), 'utf8');
  const source = fs.readFileSync(path.resolve('mission-dashboard/app.js'), 'utf8').replace("document.addEventListener('DOMContentLoaded', boot);", '');
  const dom = new JSDOM(html, { url: 'https://mission.example.test/', runScripts: 'outside-only' });
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const resource = { id: 'resource-fixture', provider: 'synthetic-provider', status: 'approved', monthly_cost_cents: 100, readiness: { usable: false, blockers: ['resource_not_provisioned'] } };
  const wallet = { id: 'wallet-fixture', label: 'Synthetic reserve', currency: 'USD', balanceCents: 1000, budgetCents: 1000, spentCents: 0, kind: 'reserve', status: 'active' };
  const payloads: Record<string, unknown> = {
    '/api/treasury': { treasury: { currency: 'USD', totals: { totalBalanceCents: 1000 }, daily: {} } },
    '/api/payout-slots': { slots: [] }, '/api/ledger?limit=50': { entries: [] },
    '/api/agents/agent-fixture/messages?after=0': { messages: [], nextCursor: 0, hasMore: false },
    '/api/wallets': { wallets: [wallet] }, '/api/tools': { tools: [] }, '/api/credentials': { credentials: [] },
    '/api/resources': { resources: [resource] }, '/api/services': { services: [] },
    '/api/payouts': { payouts: [{ id: 'payout-fixture', status: 'approved', amount_cents: 100, slot: 1, currency: 'USD', source_wallet_id: wallet.id, destination_snapshot: JSON.stringify({ providerRef: 'synthetic-destination', currency: 'USD' }) }] },
  };
  dom.window.fetch = async (url: string, init: RequestInit = {}) => {
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body));
      requests.push({ url, body });
      if (url.endsWith('/messages')) payloads['/api/agents/agent-fixture/messages?after=0'] = { messages: [{ seq: 1, actor_type: 'owner', body: body.message }], nextCursor: 1, hasMore: false };
    }
    return new Response(JSON.stringify(payloads[url] ?? {}), { status: 200 });
  };
  dom.window.eval(`${source}\nwindow.fixture = { state, loadTools, loadTreasury, renderResourceProvision, renderAgentMessages };`);
  dom.window.fixture.state.token = 'synthetic-dom-session';
  return { dom, win: dom.window, requests, resource };
}

it('owner payout controls show the authorized destination and record failure evidence without sending money', async () => {
  const { dom, win, requests } = consoleFixture();
  try {
    await win.fixture.loadTreasury();
    assert.match(win.document.querySelector('#payouts').textContent, /wallet-fixture/);
    assert.match(win.document.querySelector('#payouts').textContent, /synthetic-destination/);
    win.prompt = () => 'Synthetic provider failure evidence';
    win.document.querySelector('[data-settle][data-state="failed"]').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requests[0], { url: '/api/payouts/payout-fixture/settle', body: { status: 'failed', failureReason: 'Synthetic provider failure evidence' } });
    assert.match(win.document.querySelector('#banner').textContent, /No external payment/);
    win.fixture.state.token = '';
    await win.fixture.loadTreasury();
    assert.equal(win.document.querySelectorAll('[data-settle], [data-payout]').length, 0, 'read-only links do not expose owner controls');
  } finally { dom.window.close(); }
});

it('owner provisioning form sends the selected mission wallet and evidence, not credentials', async () => {
  const { dom, win, requests, resource } = consoleFixture();
  try {
    await win.fixture.loadTools();
    assert.match(win.document.querySelector('#resources').textContent, /resource_not_provisioned/);
    await win.fixture.renderResourceProvision(resource);
    const form = win.document.querySelector('#resource-provision form');
    form.elements.walletId.value = 'wallet-fixture';
    form.elements.actualCostCents.value = '75';
    form.elements.providerRef.value = 'synthetic-invoice';
    form.elements.evidence.value = 'Synthetic provisioning proof, not a real purchase.';
    form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requests[0], { url: '/api/resources/resource-fixture/provision', body: { walletId: 'wallet-fixture', actualCostCents: 75, providerRef: 'synthetic-invoice', evidence: 'Synthetic provisioning proof, not a real purchase.' } });
    assert.match(win.document.querySelector('#resource-provision').textContent, /readiness is shown separately/);
    assert.equal(win.document.querySelector('#resource-provision input[type="password"]'), null);
  } finally { dom.window.close(); }
});

it('owner messaging renders actual stored text safely and never fabricates an agent reply', async () => {
  const { dom, win, requests } = consoleFixture();
  try {
    const host = win.document.createElement('section');
    win.document.body.appendChild(host);
    await win.fixture.renderAgentMessages(host, 'agent-fixture');
    const form = host.querySelector('form');
    form.elements.message.value = '<img src=x onerror=alert(1)> Synthetic owner message';
    form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests[0].url, '/api/agents/agent-fixture/messages');
    assert.equal(typeof requests[0].body.idempotencyKey, 'string');
    assert.equal(host.querySelector('img'), null, 'untrusted message text is never parsed as HTML');
    assert.match(host.textContent, /Synthetic owner message/);
    assert.match(host.textContent, /not simulated agent replies/);
  } finally { dom.window.close(); }
});

it('overlapping transcript refreshes are coalesced without duplicate messages', async () => {
  const { dom, win } = consoleFixture();
  try {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    win.fetch = async () => {
      calls++;
      await gate;
      return new Response(JSON.stringify({ messages: [{ id: 'synthetic-one', seq: 1, actor_type: 'owner', body: 'Synthetic single message' }], nextCursor: 1, hasMore: false }));
    };
    const host = win.document.createElement('section');
    win.document.body.appendChild(host);
    const rendering = win.fixture.renderAgentMessages(host, 'agent-fixture');
    host.querySelector('button').dispatchEvent(new win.Event('click'));
    host.querySelector('button').dispatchEvent(new win.Event('click'));
    assert.equal(calls, 1);
    release();
    await rendering;
    assert.equal(host.querySelectorAll('tbody tr').length, 1);
    assert.equal(host.querySelector('button').disabled, false);
  } finally { dom.window.close(); }
});

it('message submission rejects double clicks, reuses uncertain retry keys and rotates keys for edited content', async () => {
  const { dom, win } = consoleFixture();
  try {
    const attempts: Array<{ message: string; idempotencyKey: string }> = [];
    win.fetch = async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') {
        attempts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ error: { message: 'Synthetic uncertain response; retry permitted.' } }), { status: 503 });
      }
      return new Response(JSON.stringify({ messages: [], nextCursor: 0, hasMore: false }));
    };
    const host = win.document.createElement('section');
    win.document.body.appendChild(host);
    await win.fixture.renderAgentMessages(host, 'agent-fixture');
    const form = host.querySelector('form');
    const submit = () => form.dispatchEvent(new win.Event('submit', { cancelable: true }));
    form.elements.message.value = 'Synthetic initial message';
    submit(); submit();
    assert.equal(attempts.length, 1);
    await new Promise(resolve => setImmediate(resolve));
    submit();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].idempotencyKey, attempts[1].idempotencyKey);
    form.elements.message.value = 'Synthetic revised message';
    submit();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attempts.length, 3);
    assert.notEqual(attempts[1].idempotencyKey, attempts[2].idempotencyKey);
    assert.equal(form.elements.message.readOnly, false);
  } finally { dom.window.close(); }
});
