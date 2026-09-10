import { externalHttpRequest, ExternalHttpError } from '../integrations/http';

/**
 * Real payment-provider integrations (Milestone 8).
 *
 * Stripe Checkout Sessions and Razorpay Orders are created through the shared
 * outbound HTTP helper (mandatory timeouts, redacted error messages, no
 * credential leakage). When a provider's credentials are not configured the
 * caller receives an honest `provider_not_configured` result — never a
 * fabricated checkout URL.
 *
 * Base URLs can be overridden with `<PROVIDER>_BASE_URL` for gateway proxies.
 */

export interface CheckoutSession {
  provider: 'stripe' | 'razorpay';
  providerReference: string;
  checkoutUrl: string | null;
}

export class PaymentProviderError extends Error {
  readonly code = 'provider_call_failed';
  constructor(message: string) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

function resolveBase(provider: string, fallback: string): string {
  const override = process.env[`${provider.toUpperCase()}_BASE_URL`];
  return ((override && override.trim()) || fallback).replace(/\/+$/, '');
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function razorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

/**
 * Create a Stripe Checkout Session for a credit purchase.
 * https://docs.stripe.com/api/checkout/sessions/create
 */
export async function createStripeCheckout(input: {
  amountCents: number;
  credits: number;
  invoiceNumber: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutSession> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new PaymentProviderError('stripe is not configured; set STRIPE_SECRET_KEY');
  }
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', input.successUrl);
  params.set('cancel_url', input.cancelUrl);
  params.set('client_reference_id', input.invoiceNumber);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(input.amountCents));
  params.set('line_items[0][price_data][product_data][name]', `${input.credits} AKBARAL credits`);
  try {
    const result = await externalHttpRequest('stripe', `${resolveBase('stripe', 'https://api.stripe.com')}/v1/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
      timeoutMs: 20_000,
    });
    const session = result.json as { id?: string; url?: string };
    if (!session.id) {
      throw new PaymentProviderError('stripe returned no session id');
    }
    return { provider: 'stripe', providerReference: session.id, checkoutUrl: session.url ?? null };
  } catch (error) {
    if (error instanceof ExternalHttpError) {
      throw new PaymentProviderError(error.message);
    }
    throw error;
  }
}

/**
 * Create a Razorpay Order for a credit purchase.
 * https://razorpay.com/docs/api/orders/
 */
export async function createRazorpayOrder(input: {
  amountCents: number;
  invoiceNumber: string;
}): Promise<CheckoutSession> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new PaymentProviderError('razorpay is not configured; set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
  }
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  try {
    const result = await externalHttpRequest('razorpay', `${resolveBase('razorpay', 'https://api.razorpay.com')}/v1/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: input.amountCents,
        currency: 'USD',
        receipt: input.invoiceNumber,
        notes: { purpose: 'akbaral-credits' },
      }),
      timeoutMs: 20_000,
    });
    const order = result.json as { id?: string };
    if (!order.id) {
      throw new PaymentProviderError('razorpay returned no order id');
    }
    // Razorpay checkout is opened client-side with the order id; there is no
    // hosted URL on the order object itself.
    return { provider: 'razorpay', providerReference: order.id, checkoutUrl: null };
  } catch (error) {
    if (error instanceof ExternalHttpError) {
      throw new PaymentProviderError(error.message);
    }
    throw error;
  }
}
