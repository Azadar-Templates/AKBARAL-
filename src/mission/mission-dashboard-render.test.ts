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
    '/api/wallets': { wallets: [wallet] }, '/api/tools': { tools: [] }, '/api/credentials': { credentials: [] },
    '/api/resources': { resources: [resource] }, '/api/services': { services: [] },
    '/api/payouts': { payouts: [{ id: 'payout-fixture', status: 'approved', amount_cents: 100, slot: 1, currency: 'USD', source_wallet_id: wallet.id, destination_snapshot: JSON.stringify({ providerRef: 'synthetic-destination', currency: 'USD' }) }] },
  };
  dom.window.fetch = async (url: string, init: RequestInit = {}) => {
    if (init.method === 'POST') requests.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(payloads[url] ?? {}), { status: 200 });
  };
  dom.window.eval(`${source}\nwindow.fixture = { state, loadTools, loadTreasury, renderResourceProvision };`);
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
