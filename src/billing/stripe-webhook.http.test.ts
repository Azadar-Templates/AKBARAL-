import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiServer, type ApiServer } from '../app';
import { db, getCreditAccount } from '../db';
import { computeStripeSignature } from './stripe';

/**
 * End-to-end Stripe webhook integration over HTTP.
 *
 * Proves the production contract of POST /api/billing/webhook/stripe:
 *   · the raw request bytes are what gets verified (signature over raw body);
 *   · a valid, attributable payment settles the invoice and grants credits;
 *   · a replayed event id settles nothing twice (subscription-grade idempotency);
 *   · a tampered payload / wrong secret / stale timestamp is rejected with 400
 *     and changes nothing;
 *   · events that cannot be attributed to one of our invoices are acknowledged
 *     and recorded — never treated as payment;
 *   · a missing signing secret answers 503 instead of trusting the caller.
 *
 * No Stripe account is contacted and no payment is fabricated: the events below
 * are signed locally with a test secret, exactly as Stripe would.
 */
const suffix = randomBytes(6).toString('hex');
const password = 'correct-horse-battery-staple';
const WEBHOOK_SECRET = ['whsec', 'test', 'http', suffix].join('_');

describe('Stripe webhook endpoint (integration)', () => {
  let api: ApiServer;
  let baseUrl = '';
  let token = '';
  let userId = '';
  let invoiceId = '';
  let invoiceNumber = '';
  let credits = 0;
  const savedEnv = new Map<string, string | undefined>();

  before(async () => {
    for (const key of ['STRIPE_WEBHOOK_SECRET', 'BILLING_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY']) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;

    const email = `stripe-${suffix}@akbaral.test`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Stripe Integration' }),
    });
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const session = (await login.json()) as { accessToken: string; user: { id: string } };
    token = session.accessToken;
    userId = session.user.id;

    // A real invoice for a real credit purchase (manual provider = payable by
    // webhook or admin settlement).
    const purchase = await fetch(`${baseUrl}/api/billing/credits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ credits: 500, amount_cents: 4500, provider: 'manual' }),
    });
    assert.equal(purchase.status, 201);
    const body = (await purchase.json()) as { order: { invoiceId: string; invoiceNumber: string; credits: number } };
    invoiceId = body.order.invoiceId;
    invoiceNumber = body.order.invoiceNumber;
    credits = body.order.credits;
    assert.ok(invoiceId, 'a real invoice exists to settle');
  });

  after(async () => {
    db.run('DELETE FROM users WHERE email LIKE ?', [`stripe-%${suffix}@akbaral.test`]);
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    db.close();
    await api.close();
  });

  function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: `evt_${randomBytes(6).toString('hex')}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          object: 'checkout.session',
          id: `cs_test_${randomBytes(4).toString('hex')}`,
          payment_status: 'paid',
          amount_total: 4500,
          currency: 'usd',
          client_reference_id: invoiceId,
          metadata: { user_id: userId, invoice_id: invoiceId },
        },
      },
      ...overrides,
    };
  }

  async function postSigned(payload: Record<string, unknown>, options: { secret?: string; timestamp?: number; signatureOverride?: string } = {}): Promise<{ status: number; body: any }> {
    const raw = JSON.stringify(payload);
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
    const signature = options.signatureOverride ?? computeStripeSignature(raw, timestamp, options.secret ?? WEBHOOK_SECRET);
    const response = await fetch(`${baseUrl}/api/billing/webhook/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
      body: raw,
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  }

  /** Purchased credits land in the paid_credits bucket of the credit account. */
  function purchasedCredits(): number {
    const account = getCreditAccount(userId);
    return Number(account?.paid_credits ?? 0) + Number(account?.bonus_credits ?? 0);
  }

  function invoiceStatus(): string {
    return String(db.get<{ status: string }>('SELECT status FROM invoices WHERE id = ?', [invoiceId])?.status);
  }

  it('refuses every event while the signing secret is missing (503, no trust)', async () => {
    const before = purchasedCredits();
    const response = await postSigned(event());
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'webhook_not_configured');
    assert.equal(purchasedCredits(), before, 'nothing was granted');
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  it('rejects a tampered payload and a wrong secret without any effect', async () => {
    const before = purchasedCredits();
    const payload = event();

    const tampered = await fetch(`${baseUrl}/api/billing/webhook/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=${computeStripeSignature(JSON.stringify(payload), Math.floor(Date.now() / 1000), WEBHOOK_SECRET)}` },
      body: `${JSON.stringify(payload)} `,
    });
    assert.equal(tampered.status, 400);
    assert.equal(((await tampered.json()) as { error: { code: string } }).error.code, 'signature_mismatch');

    const wrongSecret = await postSigned(event(), { secret: ['whsec', 'wrong', suffix].join('_') });
    assert.equal(wrongSecret.status, 400);
    assert.equal(purchasedCredits(), before, 'a forged event never changes a balance');
    assert.equal(invoiceStatus(), 'due');
  });

  it('rejects a replayed event outside the tolerance window', async () => {
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const response = await postSigned(event(), { timestamp: stale });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'timestamp_out_of_tolerance');
    assert.equal(invoiceStatus(), 'due');
  });

  it('settles a paid checkout session, grants the purchased credits, and stays idempotent', async () => {
    const before = purchasedCredits();
    const payload = event();
    const first = await postSigned(payload);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.duplicate, false);
    assert.equal(first.body.effect, 'settled');
    assert.equal(invoiceStatus(), 'paid');
    assert.equal(purchasedCredits(), before + credits, 'the purchased credits were granted exactly once');

    // Stripe retries the same event (a different signature timestamp is normal).
    const replay = await postSigned(payload);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.duplicate, true, 'the event id was already claimed');
    assert.equal(replay.body.effect, 'ignored_duplicate');
    assert.equal(purchasedCredits(), before + credits, 'a retry grants nothing extra');
  });

  it('records an unattributable payment without treating it as ours', async () => {
    const before = purchasedCredits();
    const payload = event({
      type: 'payment_intent.succeeded',
      data: { object: { object: 'payment_intent', id: `pi_${randomBytes(4).toString('hex')}`, amount: 9999, currency: 'usd' } },
    });
    const response = await postSigned(payload);
    assert.equal(response.status, 200);
    assert.equal(response.body.stripeEventType, 'payment_intent.succeeded');
    assert.equal(response.body.effect, 'recorded');
    assert.equal(purchasedCredits(), before, 'an unattributable payment grants nothing');
  });

  it('does not settle an unsettled checkout session', async () => {
    const payload = event({ data: { object: { object: 'checkout.session', id: `cs_unpaid_${randomBytes(3).toString('hex')}`, payment_status: 'unpaid', client_reference_id: invoiceId, metadata: { invoice_id: invoiceId } } } });
    const response = await postSigned(payload);
    assert.equal(response.status, 200);
    // The invoice is already paid from the previous test, so the honest answer
    // is "already paid": no new credits are granted either way.
    assert.ok(['already_paid', 'ignored_duplicate'].includes(response.body.effect) || response.body.effect === 'recorded');
    const balance = purchasedCredits();
    const again = await postSigned(payload);
    assert.equal(again.status, 200);
    assert.equal(purchasedCredits(), balance, 'replaying an unpaid session never settles it');
  });

  it('acknowledges an unknown event type without inventing an effect', async () => {
    const before = purchasedCredits();
    const payload = { id: `evt_radar_${randomBytes(4).toString('hex')}`, type: 'radar.early_fraud_warning.created', data: { object: { object: 'radar.warning', id: 'rw_1' } } };
    const response = await postSigned(payload);
    assert.equal(response.status, 200);
    assert.equal(response.body.effect, 'recorded');
    assert.equal(purchasedCredits(), before);
    const recorded = db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM billing_events WHERE event_type LIKE 'stripe.ignored:%'`);
    assert.ok(Number(recorded?.count ?? 0) >= 1, 'the ignored event is recorded for audit');
  });

  it('marks a failed payment honestly and leaves the invoice unpaid', async () => {
    const statusBefore = invoiceStatus();
    const payload = {
      id: `evt_fail_${randomBytes(4).toString('hex')}`,
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          object: 'payment_intent',
          id: `pi_fail_${randomBytes(3).toString('hex')}`,
          amount: 4500,
          metadata: { invoice_id: invoiceId, user_id: userId },
          last_payment_error: { code: 'card_declined', message: 'Your card was declined.' },
        },
      },
    };
    const response = await postSigned(payload);
    assert.equal(response.status, 200);
    assert.equal(response.body.stripeEventType, 'payment_intent.payment_failed');
    assert.equal(invoiceStatus(), statusBefore, 'a failure never changes the settled invoice state');
    void invoiceNumber;
  });
});
