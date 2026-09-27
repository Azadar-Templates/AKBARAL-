/**
 * Tests for the first real EarningProvider.
 *
 * These use a stub Stripe transport, which is legitimate here because what is
 * under test is THIS module's refusal logic — the conditions under which it
 * will and will not report that an external payment exists. A stub cannot and
 * does not prove that Stripe paid anyone; it proves that malformed, test-mode,
 * refunded, mismatched or absent payments are rejected. Real revenue still
 * requires the live API plus independent MoneyProvider verification.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.ZA141251SA_CREDENTIAL_KEY ??= randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
process.env.ZA141251SA_SESSION_SECRET ??= randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
process.env.ZA141251SA_DATABASE_URL ??= ':memory:';

const { StripeDirectEarning, configuredStripeDirectEarning, stripeDirectEarningReadiness } =
  require('./stripe-direct-earning') as typeof import('./stripe-direct-earning');
const { applyMissionMigrations } = require('../../database') as typeof import('../../database');
const { discoverEarningProviders, activeEarningProviders, earningProviderReadinessReport } =
  require('./registry') as typeof import('./registry');

const LIVE_KEY = 'sk_live_' + 'a'.repeat(24);
const ACCOUNT = 'acct_' + 'b'.repeat(16);

const JOB = { id: 'earn_job_1', agent_id: 'agt_1' } as any;
const OPP = { id: 'opp_1', provider: 'stripe-mission' } as any;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** A charge that satisfies every honesty condition. */
function goodCharge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ch_' + 'c'.repeat(16),
    balance_transaction: 'txn_' + 'd'.repeat(16),
    livemode: true,
    paid: true,
    captured: true,
    refunded: false,
    disputed: false,
    amount_refunded: 0,
    status: 'succeeded',
    amount: 25000,
    currency: 'usd',
    metadata: { mission: 'ZA141251SA', mission_job_id: 'earn_job_1', mission_agent_id: 'agt_1' },
    ...overrides,
  };
}

const GOOD_ACCOUNT = { id: ACCOUNT, charges_enabled: true, details_submitted: true };

/** Builds a transport that answers /account then /charges/search. */
function transportFor(charges: unknown[], account: unknown = GOOD_ACCOUNT): typeof fetch {
  return (async (url: string) => {
    const u = String(url);
    if (u.includes('/v1/account')) return jsonResponse(account);
    if (u.includes('/v1/charges/search')) return jsonResponse({ data: charges });
    throw new Error(`unexpected request ${u}`);
  }) as unknown as typeof fetch;
}

describe('StripeDirectEarning — construction refuses non-live credentials', () => {
  it('rejects a test-mode key so test money can never become mission revenue', () => {
    assert.throws(() => new StripeDirectEarning('sk_test_' + 'a'.repeat(24), ACCOUNT, transportFor([])));
  });

  it('rejects a malformed account id', () => {
    assert.throws(() => new StripeDirectEarning(LIVE_KEY, 'not-an-account', transportFor([])));
  });

  it('accepts a well-formed live configuration', () => {
    const p = new StripeDirectEarning(LIVE_KEY, ACCOUNT, transportFor([]));
    assert.equal(p.id, 'stripe-mission', 'id must match the MoneyProvider so runEarning pairs them');
  });
});

describe('StripeDirectEarning — detects only genuine settled payments', () => {
  beforeEach(() => { applyMissionMigrations(); });

  it('returns the balance-transaction id for a fully valid mission charge', async () => {
    const p = new StripeDirectEarning(LIVE_KEY, ACCOUNT, transportFor([goodCharge()]));
    const result = await p.lookup(JOB, OPP);
    assert.equal(result.paymentReference, 'txn_' + 'd'.repeat(16));
  });

  it('reports payment_not_received — never a fabricated reference — when nothing is paid', async () => {
    const p = new StripeDirectEarning(LIVE_KEY, ACCOUNT, transportFor([]));
    await assert.rejects(() => p.lookup(JOB, OPP), /earning_payment_not_received/);
  });

  it('refuses to choose between two charges for one job', async () => {
    const p = new StripeDirectEarning(LIVE_KEY, ACCOUNT, transportFor([goodCharge(), goodCharge({ id: 'ch_' + 'e'.repeat(16) })]));
    await assert.rejects(() => p.lookup(JOB, OPP), /earning_payment_ambiguous/);
  });

  // Each of these is a distinct way a payment could look real but must not count.
  const rejections: Array<[string, Record<string, unknown>]> = [
    ['a test-mode charge', { livemode: false }],
    ['an unpaid charge', { paid: false }],
    ['an uncaptured authorization', { captured: false }],
    ['a refunded charge', { refunded: true }],
    ['a disputed charge', { disputed: true }],
    ['a partially refunded charge', { amount_refunded: 500 }],
    ['a non-succeeded charge', { status: 'pending' }],
    ['a zero-amount charge', { amount: 0 }],
    ['a charge missing the mission tag', { metadata: { mission_job_id: 'earn_job_1', mission_agent_id: 'agt_1' } }],
    ['a charge belonging to another job', { metadata: { mission: 'ZA141251SA', mission_job_id: 'other_job', mission_agent_id: 'agt_1' } }],
    ['a charge belonging to another agent', { metadata: { mission: 'ZA141251SA', mission_job_id: 'earn_job_1', mission_agent_id: 'agt_99' } }],
    ['a malformed balance transaction', { balance_transaction: 'bogus' }],
  ];

  for (const [label, override] of rejections) {
    it(`rejects ${label}`, async () => {
      const p = new StripeDirectEarning(LIVE_KEY, ACCOUNT, transportFor([goodCharge(override)]));
      await assert.rejects(() => p.lookup(JOB, OPP), /mission_receipt_mismatch/);
    });
  }

  it('refuses when the Stripe account is not the mission account', async () => {
    const p = new StripeDirectEarning(LIVE_KEY, ACCOUNT, transportFor([goodCharge()], { id: 'acct_' + 'z'.repeat(16), charges_enabled: true, details_submitted: true }));
    await assert.rejects(() => p.lookup(JOB, OPP), /mission_account_not_activated/);
  });

  it('refuses when charges are disabled on the account', async () => {
    const p = new StripeDirectEarning(LIVE_KEY, ACCOUNT, transportFor([goodCharge()], { id: ACCOUNT, charges_enabled: false, details_submitted: true }));
    await assert.rejects(() => p.lookup(JOB, OPP), /mission_account_not_activated/);
  });
});

describe('StripeDirectEarning — execute() honours the authorization gate', () => {
  beforeEach(() => { applyMissionMigrations(); });

  it('calls authorizeExecute before contacting the provider', async () => {
    const order: string[] = [];
    const transport = (async (url: string) => {
      order.push('provider');
      const u = String(url);
      if (u.includes('/v1/account')) return jsonResponse(GOOD_ACCOUNT);
      return jsonResponse({ data: [goodCharge()] });
    }) as unknown as typeof fetch;
    const p = new StripeDirectEarning(LIVE_KEY, ACCOUNT, transport);
    await p.execute(JOB, OPP, AbortSignal.timeout(5000), () => { order.push('authorize'); });
    assert.equal(order[0], 'authorize', 'authorization must precede any provider call');
  });

  it('propagates an authorization refusal and never reaches the provider', async () => {
    let called = false;
    const transport = (async () => { called = true; return jsonResponse(GOOD_ACCOUNT); }) as unknown as typeof fetch;
    const p = new StripeDirectEarning(LIVE_KEY, ACCOUNT, transport);
    await assert.rejects(
      () => p.execute(JOB, OPP, AbortSignal.timeout(5000), () => { throw new Error('grant_revoked'); }),
      /grant_revoked/,
    );
    assert.equal(called, false, 'a revoked grant must stop work before any external call');
  });
});

describe('Earning provider registry — honest discovery', () => {
  it('reports credential_required, not readiness, when unconfigured', () => {
    const descriptors = discoverEarningProviders({});
    assert.equal(descriptors.length, 1);
    assert.equal(descriptors[0].status, 'credential_required');
    assert.ok(descriptors[0].blockers.length > 0, 'must state exactly why it is not ready');
    assert.ok(descriptors[0].ownerActions.length > 0, 'must state the human action required');
    assert.equal(descriptors[0].provider, null);
  });

  it('activates the provider only when live credentials are present', () => {
    const env = { ZA141251SA_STRIPE_SECRET_KEY: LIVE_KEY, ZA141251SA_STRIPE_ACCOUNT_ID: ACCOUNT };
    const active = activeEarningProviders(env);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, 'stripe-mission');
  });

  it('returns an empty active set when credentials are absent', () => {
    assert.deepEqual(activeEarningProviders({}), []);
  });

  it('never activates on a test-mode key', () => {
    const env = { ZA141251SA_STRIPE_SECRET_KEY: 'sk_test_' + 'a'.repeat(24), ZA141251SA_STRIPE_ACCOUNT_ID: ACCOUNT };
    assert.deepEqual(activeEarningProviders(env), []);
  });

  it('summarises zero-state without implying earning capability', () => {
    const report = earningProviderReadinessReport({});
    assert.equal(report.ready, 0);
    assert.equal(report.earningPossible, false);
    assert.match(report.summary, /No earning job can complete/);
    assert.ok(!('provider' in (report.providers[0] as object)), 'must not leak the implementation object');
  });

  it('reports earning as possible once credentialed', () => {
    const env = { ZA141251SA_STRIPE_SECRET_KEY: LIVE_KEY, ZA141251SA_STRIPE_ACCOUNT_ID: ACCOUNT };
    const report = earningProviderReadinessReport(env);
    assert.equal(report.ready, 1);
    assert.equal(report.earningPossible, true);
  });

  it('exposes readiness blockers without leaking secret values', () => {
    const env = { ZA141251SA_STRIPE_SECRET_KEY: LIVE_KEY, ZA141251SA_STRIPE_ACCOUNT_ID: '' };
    const readiness = stripeDirectEarningReadiness(env);
    assert.equal(readiness.configured, false);
    assert.equal(readiness.blockers.length, 1);
    assert.ok(!JSON.stringify(readiness).includes(LIVE_KEY), 'secret material must never appear in readiness output');
  });

  it('configuredStripeDirectEarning returns null rather than throwing when unconfigured', () => {
    assert.equal(configuredStripeDirectEarning({}), null);
  });
});
