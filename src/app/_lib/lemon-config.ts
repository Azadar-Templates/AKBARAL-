/**
 * Lemon Squeezy checkout configuration — UI ONLY.
 *
 * This module maps paid AKBARAL! plans to public Lemon Squeezy checkout
 * links. It contains NO API client, NO webhook logic, and NO secret values.
 * Only public data lives here: the store URL and public variant IDs. Server
 * credentials are configured in the deployment environment and are never
 * referenced from any client-side file.
 *
 * Why not src/config/env.ts: that module is server-only (dotenv + node:crypto).
 * Next.js inlines NEXT_PUBLIC_* variables at build time, so this client-safe
 * module reads NEXT_PUBLIC_LEMON_STORE_URL directly and falls back to the
 * compiled constant below.
 */

/**
 * Compiled fallback for the owner's Lemon Squeezy store URL (public value).
 * Empty until the owner supplies it; can also be provided at build/deploy
 * time via NEXT_PUBLIC_LEMON_STORE_URL, which takes precedence.
 */
export const LEMON_STORE_URL_FALLBACK = '';

/** Resolve the store URL: optional public env var first, compiled fallback second. */
export function resolveLemonStoreUrl(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_LEMON_STORE_URL ?? '').trim();
  return fromEnv || LEMON_STORE_URL_FALLBACK;
}

/** The effective store URL at module load (e.g. https://akbaral.lemonsqueezy.com). */
export const LEMON_STORE_URL: string = resolveLemonStoreUrl();

/**
 * Public Lemon Squeezy variant IDs, keyed by the paid plan keys defined in
 * src/app/_lib/pricing.ts. `null` means "the owner has not supplied a variant
 * for this plan yet" — the UI must then show an honest unavailable state,
 * never a dead or fake link. Variant IDs are public identifiers, not secrets,
 * but none are invented here: every entry starts null until owner-supplied.
 */
export const LEMON_VARIANT_IDS: Record<string, string | null> = {
  starter: null,
  pro: null,
  business: null,
  scale: null,
  enterprise: null,
};

export interface LemonCheckoutConfig {
  storeUrl: string;
  variantIds: Record<string, string | null>;
}

/**
 * Build the checkout URL for a plan from explicit config. Returns null when
 * the plan is unmapped (no variant ID) or no store URL is configured — callers
 * render the honest unavailable state in that case.
 */
export function buildLemonCheckoutUrl(planId: string, config: LemonCheckoutConfig): string | null {
  const variantId = (config.variantIds[planId] ?? '').trim();
  const storeUrl = config.storeUrl.trim().replace(/\/+$/, '');
  if (!variantId || !storeUrl) return null;
  return `${storeUrl}/buy/${variantId}`;
}

/**
 * Checkout URL for a plan using the live configuration, or null when the plan
 * is not yet mapped to a Lemon Squeezy variant.
 */
export function lemonCheckoutUrl(planId: string): string | null {
  return buildLemonCheckoutUrl(planId, { storeUrl: LEMON_STORE_URL, variantIds: LEMON_VARIANT_IDS });
}
