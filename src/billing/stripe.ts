import crypto from 'node:crypto';

/**
 * Stripe-native webhook verification (real integration).
 *
 * Stripe signs every event with the endpoint's signing secret:
 *   Stripe-Signature: t=<unix seconds>,v1=<hex hmac of "t.payload">[,v0=…]
 *
 * This module implements that scheme exactly as documented:
 *   · the signature is HMAC-SHA256 over `${timestamp}.${rawBody}`;
 *   · the timestamp must be inside a tolerance window (replay protection);
 *   · comparison is constant-time;
 *   · multiple v1 signatures are accepted (Stripe sends more than one during
 *     secret rotation), and `v0` (the deprecated scheme) is ignored.
 *
 * The raw request body MUST be used — re-serializing JSON changes the bytes and
 * invalidates the signature. The route therefore stores the raw body.
 *
 * Nothing here fabricates an event: an unverifiable payload is rejected with
 * 400, and a missing signing secret is reported as not configured (503) rather
 * than silently trusting the caller.
 */

export const STRIPE_SIGNATURE_HEADER = 'stripe-signature';
/** 5 minutes, Stripe's documented default tolerance. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export interface StripeSignatureHeader {
  timestamp: number;
  signatures: string[];
}

export class StripeWebhookError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, message: string, code: string) {
    super(message);
    this.name = 'StripeWebhookError';
    this.status = status;
    this.code = code;
  }
}

/** Parse a `Stripe-Signature` header without trusting any of its values. */
export function parseStripeSignatureHeader(header: string | undefined | null): StripeSignatureHeader {
  if (!header || !header.trim()) {
    throw new StripeWebhookError(400, `missing ${STRIPE_SIGNATURE_HEADER} header`, 'missing_signature');
  }
  let timestamp = 0;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [rawKey, rawValue] = part.split('=');
    const key = (rawKey ?? '').trim();
    const value = (rawValue ?? '').trim();
    if (!value) continue;
    if (key === 't') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) timestamp = parsed;
    } else if (key === 'v1') {
      signatures.push(value);
    }
  }
  if (timestamp <= 0 || signatures.length === 0) {
    throw new StripeWebhookError(400, 'malformed stripe signature header', 'invalid_signature_header');
  }
  return { timestamp, signatures };
}

export function computeStripeSignature(payload: string, timestamp: number, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length === 0 || bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Verify a Stripe webhook. Returns the verified timestamp; throws
 * StripeWebhookError with a precise code on any failure.
 */
export function verifyStripeWebhook(input: {
  payload: string;
  header?: string | null;
  secret?: string | null;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): { timestamp: number } {
  const secret = (input.secret ?? '').trim();
  if (!secret) {
    throw new StripeWebhookError(503, 'STRIPE_WEBHOOK_SECRET is not configured', 'webhook_not_configured');
  }
  const { timestamp, signatures } = parseStripeSignatureHeader(input.header);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) {
    throw new StripeWebhookError(400, 'stripe webhook timestamp is outside the tolerance window', 'timestamp_out_of_tolerance');
  }
  const expected = computeStripeSignature(input.payload, timestamp, secret);
  const matched = signatures.some((signature) => timingSafeEqualHex(expected, signature.trim().toLowerCase()));
  if (!matched) {
    throw new StripeWebhookError(400, 'stripe webhook signature verification failed', 'signature_mismatch');
  }
  return { timestamp };
}

// ─────────────────────────────────────────────────────────────────────────────
// Event normalization: Stripe event → the platform's internal event contract
// ─────────────────────────────────────────────────────────────────────────────

export type InternalBillingEvent = 'invoice.paid' | 'payment.failed' | 'invoice.refunded' | 'subscription.cancelled' | 'ignored';

export interface NormalizedStripeEvent {
  /** Stripe's own event id — the idempotency key for replay protection. */
  eventId: string | null;
  type: string;
  /** Internal event name understood by the billing service. */
  internal: InternalBillingEvent;
  /** Our invoice id, recovered from client_reference_id or metadata. */
  invoiceId: string | null;
  /** Our user id, recovered from metadata when present. */
  userId: string | null;
  amountCents: number | null;
  currency: string | null;
  failureCode: string | null;
  failureReason: string | null;
  paymentIntentId: string | null;
  checkoutSessionId: string | null;
  /** The Stripe object the event is about (never includes card data). */
  objectType: string | null;
}

interface StripeObject {
  id?: string;
  object?: string;
  amount_total?: number;
  amount?: number;
  currency?: string;
  client_reference_id?: string;
  payment_intent?: string;
  payment_status?: string;
  status?: string;
  customer?: string;
  metadata?: Record<string, unknown>;
  last_payment_error?: { code?: string; message?: string; payment_method?: unknown };
  payment_intent_object?: { id?: string; last_payment_error?: { code?: string; message?: string } };
  charges?: { data?: Array<{ refunded?: boolean; amount_refunded?: number }> };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readMetadata(source: { metadata?: Record<string, unknown> } | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const found = stringOrNull(source?.metadata?.[key]);
    if (found) return found;
  }
  return null;
}

/**
 * Map a Stripe event onto the internal contract. Unknown event types are
 * returned as `ignored` (recorded, never guessed at) so the webhook can answer
 * 200 without inventing an effect.
 */
export function normalizeStripeEvent(event: Record<string, unknown>): NormalizedStripeEvent {
  const type = stringOrNull(event.type) ?? 'unknown';
  const data = (event.data ?? {}) as { object?: StripeObject };
  const object = data.object ?? {};
  const objectType = stringOrNull(object.object);

  const metadataUserId = readMetadata(object, ['user_id', 'userId', 'akbaral_user_id']);
  const invoiceIdFromMetadata = readMetadata(object, ['invoice_id', 'invoiceId', 'akbaral_invoice_id']);
  const checkoutSessionId = objectType === 'checkout.session' ? stringOrNull(object.id) : readMetadata(object, ['checkout_session_id']);
  const invoiceId = invoiceIdFromMetadata ?? stringOrNull(object.client_reference_id) ?? null;
  const userId = metadataUserId ?? null;

  const base = {
    eventId: stringOrNull(event.id),
    type,
    invoiceId,
    userId,
    currency: stringOrNull(object.currency),
    checkoutSessionId,
    paymentIntentId: objectType === 'payment_intent' ? stringOrNull(object.id) : stringOrNull(object.payment_intent) ?? stringOrNull(object.payment_intent_object?.id),
    objectType,
  };

  if (type === 'checkout.session.completed' || type === 'invoice.paid' || type === 'invoice.payment_succeeded') {
    // A checkout session can complete without funds actually captured
    // (e.g. delayed methods): only `paid` sessions settle an invoice.
    const paid = type === 'checkout.session.completed' ? object.payment_status === 'paid' : true;
    return {
      ...base,
      internal: paid ? 'invoice.paid' : 'ignored',
      amountCents: type === 'checkout.session.completed' ? (object.amount_total ?? null) : (object.amount ?? null),
      failureCode: null,
      failureReason: null,
    };
  }

  if (type === 'payment_intent.succeeded' || type === 'charge.succeeded') {
    // A successful intent we cannot attribute to one of OUR invoices is not
    // treated as a payment of it: it is recorded as ignored instead of guessed.
    return {
      ...base,
      internal: invoiceId ? 'invoice.paid' : 'ignored',
      amountCents: object.amount ?? object.amount_total ?? null,
      failureCode: null,
      failureReason: null,
    };
  }

  if (type === 'payment_intent.payment_failed' || type === 'invoice.payment_failed' || type === 'charge.failed') {
    const error = object.last_payment_error ?? object.payment_intent_object?.last_payment_error;
    return {
      ...base,
      internal: 'payment.failed',
      amountCents: object.amount ?? object.amount_total ?? null,
      failureCode: stringOrNull(error?.code) ?? 'payment_failed',
      failureReason: stringOrNull(error?.message),
    };
  }

  if (type === 'charge.refunded' || type === 'refund.created' || type === 'invoice.refunded') {
    return {
      ...base,
      internal: invoiceId ? 'invoice.refunded' : 'ignored',
      amountCents: object.amount ?? object.amount_total ?? null,
      failureCode: null,
      failureReason: null,
    };
  }

  if (type === 'customer.subscription.deleted' || type === 'customer.subscription.canceled') {
    return { ...base, internal: 'subscription.cancelled', amountCents: null, failureCode: null, failureReason: null };
  }

  return { ...base, internal: 'ignored', amountCents: null, failureCode: null, failureReason: null };
}

/** Stripe's endpoint list for this deployment — used by docs and the launch check. */
export const STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
  'customer.subscription.deleted',
] as const;

/**
 * Whether an event type is one this deployment acts on. Anything else is
 * acknowledged and recorded as ignored rather than interpreted.
 */
export function isHandledStripeEventType(type: string): boolean {
  return (STRIPE_WEBHOOK_EVENTS as readonly string[]).includes(type);
}
