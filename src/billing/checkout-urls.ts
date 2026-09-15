/**
 * Checkout return URLs.
 *
 * Where a customer lands after paying (or cancelling) is part of the product, not
 * a placeholder: a real deployment must return customers to ITS OWN domain, over
 * HTTPS. These values are therefore resolved from configuration, in this order:
 *
 *   1. the explicit request parameter (a caller may want a specific landing page);
 *   2. `AKBARAL_CHECKOUT_SUCCESS_URL` / `AKBARAL_CHECKOUT_CANCEL_URL`;
 *   3. `AKBARAL_SITE_URL` + `/billing/{success,cancel}`.
 *
 * `AKBARAL_SITE_URL` defaults to the deployment's documented host, so an
 * unconfigured deployment still produces a URL on a real domain rather than a
 * local placeholder — and the launch check reports whether the site URL is
 * actually configured for production.
 */

const DEFAULT_SITE_URL = 'https://akbaral.duckdns.org';

export interface CheckoutUrls {
  successUrl: string;
  cancelUrl: string;
  /** True when the value came from explicit configuration rather than the default host. */
  configured: boolean;
  siteUrl: string;
}

function trimSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function resolveCheckoutUrls(input: { successUrl?: string | null; cancelUrl?: string | null } = {}): CheckoutUrls {
  const explicitSuccess = (input.successUrl ?? '').trim();
  const explicitCancel = (input.cancelUrl ?? '').trim();
  const siteUrl = trimSlash(process.env.AKBARAL_SITE_URL ?? '') || DEFAULT_SITE_URL;
  const envSuccess = (process.env.AKBARAL_CHECKOUT_SUCCESS_URL ?? '').trim();
  const envCancel = (process.env.AKBARAL_CHECKOUT_CANCEL_URL ?? '').trim();

  const successUrl = explicitSuccess || envSuccess || `${siteUrl}/billing/success`;
  const cancelUrl = explicitCancel || envCancel || `${siteUrl}/billing/cancel`;
  return {
    successUrl,
    cancelUrl,
    configured: Boolean(explicitSuccess || explicitCancel || envSuccess || envCancel || (process.env.AKBARAL_SITE_URL ?? '').trim()),
    siteUrl,
  };
}
