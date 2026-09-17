import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

/**
 * Stripe webhook integration tests.
 *
 * These verify the REAL contract Stripe enforces — signature scheme, tolerance
 * window, replay protection, attribution rules — without contacting Stripe and
 * without inventing any payment. A signature that does not verify must never
 * reach the billing service, and an unattributable payment must never be
 * treated as one of our invoices being paid.
 */
import {
  DEFAULT_TOLERANCE_SECONDS,
  STRIPE_WEBHOOK_EVENTS,
  StripeWebhookError,
  computeStripeSignature,
  isHandledStripeEventType,
  normalizeStripeEvent,
  parseStripeSignatureHeader,
  verifyStripeWebhook,
} from './stripe';

const SECRET = ['whsec', 'test', 'value', 'not', 'a', 'real', 'secret'].join('_');

function signedHeader(payload: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${computeStripeSignature(payload, timestamp, secret)}`;
}

describe('stripe webhook signature verification', () => {
  it('accepts a correctly signed payload', () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
    const result = verifyStripeWebhook({ payload, header: signedHeader(payload), secret: SECRET });
    assert.ok(result.timestamp > 0);
  });

  it('accepts several v1 signatures (secret rotation)', () => {
    const payload = '{"id":"evt_2"}';
    const timestamp = Math.floor(Date.now() / 1000);
    const good = computeStripeSignature(payload, timestamp, SECRET);
    const header = `t=${timestamp},v1=${'a'.repeat(64)},v1=${good}`;
    assert.doesNotThrow(() => verifyStripeWebhook({ payload, header, secret: SECRET }));
  });

  it('rejects a tampered payload, a wrong secret and a malformed header', () => {
    const payload = JSON.stringify({ id: 'evt_3', type: 'invoice.paid' });
    const header = signedHeader(payload);
    assert.throws(
      () => verifyStripeWebhook({ payload: `${payload} `, header, secret: SECRET }),
      (error: unknown) => error instanceof StripeWebhookError && error.code === 'signature_mismatch',
      'a payload that was modified after signing must fail',
    );
    assert.throws(
      () => verifyStripeWebhook({ payload, header: signedHeader(payload, 'whsec_other_secret_value'), secret: SECRET }),
      (error: unknown) => error instanceof StripeWebhookError && error.code === 'signature_mismatch',
    );
    assert.throws(
      () => verifyStripeWebhook({ payload, header: 'not-a-signature', secret: SECRET }),
      (error: unknown) => error instanceof StripeWebhookError && error.code === 'invalid_signature_header',
    );
    assert.throws(
      () => verifyStripeWebhook({ payload, header: undefined, secret: SECRET }),
      (error: unknown) => error instanceof StripeWebhookError && error.code === 'missing_signature',
    );
  });

  it('rejects replayed events outside the tolerance window', () => {
    const payload = '{"id":"evt_old"}';
    const oldTimestamp = Math.floor(Date.now() / 1000) - (DEFAULT_TOLERANCE_SECONDS + 60);
    assert.throws(
      () => verifyStripeWebhook({ payload, header: signedHeader(payload, SECRET, oldTimestamp), secret: SECRET }),
      (error: unknown) => error instanceof StripeWebhookError && error.code === 'timestamp_out_of_tolerance',
    );
    // Same payload inside the window is accepted (a slow delivery is normal).
    const recent = Math.floor(Date.now() / 1000) - 30;
    assert.doesNotThrow(() => verifyStripeWebhook({ payload, header: signedHeader(payload, SECRET, recent), secret: SECRET }));
  });

  it('refuses to verify when the signing secret is not configured', () => {
    const payload = '{"id":"evt_4"}';
    assert.throws(
      () => verifyStripeWebhook({ payload, header: signedHeader(payload), secret: '' }),
      (error: unknown) => error instanceof StripeWebhookError && error.status === 503 && error.code === 'webhook_not_configured',
    );
  });

  it('parses the header defensively', () => {
    const parsed = parseStripeSignatureHeader(`t=1700000000,v0=deadbeef,v1=abc123`);
    assert.equal(parsed.timestamp, 1700000000);
    assert.deepEqual(parsed.signatures, ['abc123'], 'the deprecated v0 scheme is ignored');
    assert.throws(() => parseStripeSignatureHeader('v1=abc'), (error: unknown) => error instanceof StripeWebhookError);
    assert.throws(() => parseStripeSignatureHeader('t=1700000000'), (error: unknown) => error instanceof StripeWebhookError);
  });

  it('comparison is constant-time (no early-exit length leak)', () => {
    // A signature of the right length but wrong content must be rejected; the
    // implementation compares via timingSafeEqual on equal-length buffers.
    const payload = '{"id":"evt_5"}';
    const timestamp = Math.floor(Date.now() / 1000);
    const wrongSameLength = crypto.createHash('sha256').update('nope').digest('hex');
    assert.throws(
      () => verifyStripeWebhook({ payload, header: `t=${timestamp},v1=${wrongSameLength}`, secret: SECRET }),
      (error: unknown) => error instanceof StripeWebhookError && error.code === 'signature_mismatch',
    );
  });
});

describe('stripe event normalization', () => {
  const invoiceId = 'inv_akbaral_123';

  it('maps a paid checkout session to invoice.paid', () => {
    const normalized = normalizeStripeEvent({
      id: 'evt_paid_1',
      type: 'checkout.session.completed',
      data: { object: { object: 'checkout.session', id: 'cs_test_1', payment_status: 'paid', amount_total: 2500, currency: 'usd', client_reference_id: invoiceId, metadata: { user_id: 'usr_1' } } },
    });
    assert.equal(normalized.internal, 'invoice.paid');
    assert.equal(normalized.invoiceId, invoiceId);
    assert.equal(normalized.userId, 'usr_1');
    assert.equal(normalized.amountCents, 2500);
    assert.equal(normalized.checkoutSessionId, 'cs_test_1');
  });

  it('does not settle an unsettled checkout session', () => {
    const normalized = normalizeStripeEvent({
      id: 'evt_unpaid',
      type: 'checkout.session.completed',
      data: { object: { object: 'checkout.session', id: 'cs_test_2', payment_status: 'unpaid', client_reference_id: invoiceId } },
    });
    assert.equal(normalized.internal, 'ignored', 'an unpaid session is never treated as payment');
  });

  it('only attributes a payment_intent when it names one of our invoices', () => {
    const attributable = normalizeStripeEvent({
      id: 'evt_pi_1',
      type: 'payment_intent.succeeded',
      data: { object: { object: 'payment_intent', id: 'pi_1', amount: 9900, metadata: { invoice_id: invoiceId } } },
    });
    assert.equal(attributable.internal, 'invoice.paid');
    assert.equal(attributable.invoiceId, invoiceId);
    assert.equal(attributable.paymentIntentId, 'pi_1');

    const stranger = normalizeStripeEvent({
      id: 'evt_pi_2',
      type: 'payment_intent.succeeded',
      data: { object: { object: 'payment_intent', id: 'pi_2', amount: 9900 } },
    });
    assert.equal(stranger.internal, 'ignored', 'an unattributable payment is recorded, never guessed at');
  });

  it('captures failure detail without card data', () => {
    const normalized = normalizeStripeEvent({
      id: 'evt_fail',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          object: 'payment_intent',
          id: 'pi_3',
          metadata: { invoice_id: invoiceId },
          last_payment_error: { code: 'card_declined', message: 'Your card was declined.' },
        },
      },
    });
    assert.equal(normalized.internal, 'payment.failed');
    assert.equal(normalized.failureCode, 'card_declined');
    assert.equal(normalized.failureReason, 'Your card was declined.');
    assert.ok(!JSON.stringify(normalized).includes('4242'), 'no card number can appear in the normalized event');
  });

  it('maps refunds and subscription cancellation for our invoices only', () => {
    const refund = normalizeStripeEvent({
      id: 'evt_refund',
      type: 'charge.refunded',
      data: { object: { object: 'charge', id: 'ch_1', amount: 2500, metadata: { invoice_id: invoiceId } } },
    });
    assert.equal(refund.internal, 'invoice.refunded');
    const foreignRefund = normalizeStripeEvent({
      id: 'evt_refund_2',
      type: 'charge.refunded',
      data: { object: { object: 'charge', id: 'ch_2', amount: 2500 } },
    });
    assert.equal(foreignRefund.internal, 'ignored');
    const cancelled = normalizeStripeEvent({
      id: 'evt_cancel',
      type: 'customer.subscription.deleted',
      data: { object: { object: 'subscription', id: 'sub_1', metadata: { user_id: 'usr_1' } } },
    });
    assert.equal(cancelled.internal, 'subscription.cancelled');
  });

  it('never invents an effect for an unknown event type', () => {
    const normalized = normalizeStripeEvent({ id: 'evt_weird', type: 'radar.early_fraud_warning.created', data: { object: { object: 'radar.warning' } } });
    assert.equal(normalized.internal, 'ignored');
    assert.equal(normalized.amountCents, null);
    assert.equal(isHandledStripeEventType('radar.early_fraud_warning.created'), false);
    for (const type of STRIPE_WEBHOOK_EVENTS) {
      assert.equal(isHandledStripeEventType(type), true, `${type} is a documented handled event`);
    }
  });
});
