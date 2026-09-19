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
  const resource = { id: 'resource-fixture', agent_id: 'agent-fixture', provider: 'google', status: 'approved', monthly_cost_cents: 100, readiness: { usable: false, blockers: ['resource_not_provisioned'] } };
  const wallet = { id: 'wallet-fixture', label: 'Synthetic reserve', currency: 'USD', balanceCents: 1000, budgetCents: 1000, spentCents: 0, agentId: 'agent-fixture', kind: 'reserve', status: 'active' };
  const payloads: Record<string, unknown> = {
    '/api/treasury': { treasury: { currency: 'USD', totals: { totalBalanceCents: 1000 }, daily: {} } },
    '/api/payout-slots': { slots: [] }, '/api/ledger?limit=50': { entries: [] },
    '/api/agents/agent-fixture/chat-config': { agentId: 'agent-fixture', config: null, workerLivenessVerified: false },
    '/api/agents/agent-fixture/chat-jobs?limit=50': { jobs: [], nextCursor: null },
    '/api/agents/agent-fixture/messages?after=0': { messages: [], nextCursor: 0, hasMore: false },
    '/api/wallets': { wallets: [wallet] }, '/api/tools': { tools: [] }, '/api/credentials': { credentials: [{ id: 'credential-fixture', provider: 'google', status: 'active', label: 'Synthetic stored credential' }, { id: 'other-provider', provider: 'other', status: 'active', label: 'Not for this resource' }] },
    '/api/policy': { policy: { currency: 'USD' } },
    '/api/resources/resource-fixture/periods?limit=50': { periods: [], nextCursor: null },
    '/api/resources/resource-fixture/calls?limit=50': { calls: [{ id: 'held-fixture', status: 'reserved', reservedUsage: { requests: 1 }, actualUsage: null }, { id: 'uncertain-fixture', status: 'uncertain', reservedUsage: { requests: 1 }, actualUsage: null, evidence: '<img src=x> Synthetic evidence text' }, { id: 'cost-fixture', status: 'succeeded', reservedUsage: { requests: 1 }, actualUsage: { requests: 1 }, budget: { status: 'held', reservedCents: 40, actualCents: null, currency: 'USD' } }], nextCursor: null },
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
  dom.window.eval(`${source}\nwindow.fixture = { state, loadTools, loadTreasury, renderResourceProvision, renderAgentMessages, renderResourceCredentialBinding, renderResourceCalls, renderAgentChatControls, renderResourcePeriods, wire };`);
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

it('owner credential binding selects same-provider metadata and submits no plaintext secrets', async () => {
  const { dom, win, requests, resource } = consoleFixture();
  try {
    await win.fixture.loadTools();
    assert.equal(win.document.querySelectorAll('[data-bind-credential]').length, 1);
    await win.fixture.renderResourceCredentialBinding(resource);
    const form = win.document.querySelector('#resource-credential form');
    assert.equal(form.elements.credentialId.options.length, 2);
    form.elements.credentialId.value = 'credential-fixture';
    form.elements.reason.value = 'Synthetic owner review of replacement binding.';
    form.dispatchEvent(new win.Event('submit', { cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requests[0], { url: '/api/resources/resource-fixture/credential', body: { credentialId: 'credential-fixture', expectedCredentialId: null, reason: 'Synthetic owner review of replacement binding.' } });
    assert.match(win.document.querySelector('#resource-credential').textContent, /not provider verification/);
    win.fixture.state.token = '';
    await win.fixture.loadTools();
    assert.equal(win.document.querySelectorAll('[data-bind-credential]').length, 0);
  } finally { dom.window.close(); }
});

it('owner quota-call controls submit actual evidence, never guessed zero, and render text safely', async () => {
  const { dom, win, requests, resource } = consoleFixture();
  try {
    await win.fixture.loadTools();
    assert.equal(win.document.querySelectorAll('[data-resource-calls]').length, 1);
    await win.fixture.renderResourceCalls(resource);
    const host = win.document.querySelector('#resource-calls');
    assert.equal(host.querySelector('img'), null);
    assert.match(host.textContent, /Unknown \/ not reconciled/);
    host.querySelector('[data-reconcile-call]').click();
    const form = host.querySelector('form');
    assert.equal(form.querySelector('input[type="number"]').value, '', 'usage is never prefilled with guessed zero');
    form.elements.outcome.value = 'succeeded';
    form.querySelector('input[type="number"]').value = '1';
    form.elements.providerRef.value = 'synthetic-owner-receipt';
    form.elements.evidence.value = 'Synthetic owner usage evidence, not a real provider receipt.';
    form.dispatchEvent(new win.Event('submit', { cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requests[0], { url: '/api/resources/resource-fixture/calls/uncertain-fixture/reconcile', body: { outcome: 'succeeded', actualUsage: { requests: 1 }, providerRef: 'synthetic-owner-receipt', evidence: 'Synthetic owner usage evidence, not a real provider receipt.' } });
    assert.match(host.textContent, /No provider verification, payment or refund/);
    host.querySelector('[data-cancel-call]').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests[1].url, '/api/resources/resource-fixture/calls/held-fixture/cancel');
    win.fixture.state.token = '';
    await win.fixture.loadTools();
    assert.equal(win.document.querySelectorAll('[data-resource-calls], [data-reconcile-call], [data-cancel-call]').length, 0);
  } finally { dom.window.close(); }
});

it('financial receipt control requires an explicit actual charge and distinguishes accounting from payment', async () => {
  const { dom, win, requests, resource } = consoleFixture();
  try {
    await win.fixture.renderResourceCalls(resource);
    const host = win.document.querySelector('#resource-calls');
    assert.match(host.textContent, /40 USD minor units reserved; actual unknown/);
    host.querySelector('[data-record-call-cost]').click();
    const form = host.querySelector('form');
    assert.equal(form.elements.actualCostCents.value, '');
    form.elements.actualCostCents.value = '25';
    form.elements.providerRef.value = 'synthetic-financial-ref';
    form.elements.evidence.value = 'Synthetic financial evidence, not a real payment.';
    form.dispatchEvent(new win.Event('submit', { cancelable: true }));
    form.dispatchEvent(new win.Event('submit', { cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1, 'double submit records one request');
    assert.deepEqual(requests[0], { url: '/api/resources/resource-fixture/calls/cost-fixture/record-cost', body: { actualCostCents: 25, providerRef: 'synthetic-financial-ref', evidence: 'Synthetic financial evidence, not a real payment.' } });
    assert.match(host.textContent, /No external payment executed/);
  } finally { dom.window.close(); }
});

it('automatic reply controls require owner opt-in and explicit financial assumptions without claiming activation', async () => {
  const { dom, win, requests } = consoleFixture();
  try {
    const host = win.document.createElement('div'); win.document.body.appendChild(host);
    await win.fixture.renderAgentChatControls(host, 'agent-fixture');
    const form = host.querySelector('form');
    assert.equal(form.elements.enabled.value, 'false');
    assert.equal(form.elements.maxCostCents.value, '');
    form.elements.resourceId.value = 'resource-fixture';
    form.elements.walletId.value = 'wallet-fixture';
    form.elements.maxCostCents.value = '40';
    form.elements.costBasis.value = 'Synthetic owner-reviewed test pricing assumption.';
    form.elements.enabled.value = 'true';
    let confirmed = 0; win.confirm = () => { confirmed++; return true; };
    form.dispatchEvent(new win.Event('submit', { cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(confirmed, 1);
    assert.equal(requests[0].url, '/api/agents/agent-fixture/chat-config');
    assert.deepEqual(requests[0].body, { enabled: true, resourceId: 'resource-fixture', walletId: 'wallet-fixture', model: 'gemini-2.5-flash', maxInputBytes: 2000, maxOutputTokens: 1024, maxCostCents: 40, costBasis: 'Synthetic owner-reviewed test pricing assumption.' });
    assert.match(win.document.querySelector('#banner').textContent, /does not activate a provider or prove a live worker/);
    win.fixture.state.token = '';
    const privateHost = win.document.createElement('div');
    await win.fixture.renderAgentChatControls(privateHost, 'agent-fixture');
    assert.equal(privateHost.children.length, 0);
  } finally { dom.window.close(); }
});

it('owner period controls require explicit starting usage and cost and retain one idempotency key per attempt', async () => {
  const { dom, win, requests, resource } = consoleFixture();
  try {
    await win.fixture.renderResourcePeriods({ ...resource, status: 'active', provisioned_at: '2026-08-01T00:00:00Z', expires_at: '2026-09-01T00:00:00Z', limits: '{"requests":10}' });
    const host = win.document.querySelector('#resource-periods'), form = host.querySelector('form');
    assert.equal(form.elements.actualCostCents.value, '');
    assert.equal(form.querySelector('[aria-label="Starting requests usage"]').value, '');
    form.elements.periodStart.value = '2026-09-01T00:00'; form.elements.periodEnd.value = '2026-10-01T00:00';
    form.elements.walletId.value = 'wallet-fixture'; form.elements.actualCostCents.value = '5';
    form.querySelector('[aria-label="Starting requests usage"]').value = '2';
    form.elements.providerRef.value = 'synthetic-period-ui'; form.elements.evidence.value = 'Synthetic current provider-period evidence only.';
    form.dispatchEvent(new win.Event('submit', { cancelable: true }));
    form.dispatchEvent(new win.Event('submit', { cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/resources/resource-fixture/periods');
    assert.deepEqual(requests[0].body.startingUsage, { requests: 2 });
    assert.equal(requests[0].body.actualCostCents, 5); assert.equal(requests[0].body.currency, 'USD');
    assert.ok(String(requests[0].body.idempotencyKey).length >= 8);
    assert.match(host.textContent, /No purchase or external payment executed/);
    win.fixture.state.token = ''; await win.fixture.loadTools();
    assert.equal(host.querySelectorAll('form').length, 0);
  } finally { dom.window.close(); }
});

it('credential creation requires explicit local model permission and blocks duplicate secret submissions', async () => {
  const { dom, win, requests } = consoleFixture();
  try {
    win.fixture.wire();
    const form = win.document.querySelector('#credential-form');
    assert.equal(form.elements.scope.value, '');
    form.elements.provider.value = 'google'; form.elements.label.value = 'Synthetic scoped credential';
    form.elements.secret.value = 'synthetic-credential-not-real'; form.elements.scope.value = 'model.call';
    form.dispatchEvent(new win.Event('submit', { cancelable: true }));
    form.dispatchEvent(new win.Event('submit', { cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1); assert.deepEqual(requests[0].body.scope, ['model.call']);
    assert.equal(form.elements.secret.value, '');
    assert.match(win.document.querySelector('#banner').textContent, /does not activate or verify a provider/);
    win.fixture.state.token = ''; await win.fixture.loadTools(); assert.equal(form.hidden, true);
  } finally { dom.window.close(); }
});
