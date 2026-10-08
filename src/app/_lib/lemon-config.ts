/**
 * Lemon Squeezy checkout configuration (client-safe).
 *
 * Exposes store URL and variant ID mapping for paid plan checkouts.
 * Defaults all variant IDs to null and store URL to empty string until
 * provided by the owner.
 */

const HARDCODED_STORE_URL = '';

/**
 * Owner's Lemon Squeezy store URL.
 * Reads NEXT_PUBLIC_LEMON_STORE_URL if set, falling back to the hardcoded value.
 */
export const LEMON_STORE_URL: string = (
  typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_LEMON_STORE_URL
    ? process.env.NEXT_PUBLIC_LEMON_STORE_URL.trim()
    : HARDCODED_STORE_URL
);

/**
 * Mapping of paid plan IDs to Lemon Squeezy variant IDs.
 * Unmapped plans default to null.
 */
export const LEMON_VARIANT_IDS: Record<string, string | null> = {
  starter: null,
  pro: null,
  business: null,
  scale: null,
  enterprise: null,
};

export interface LemonCheckoutOptions {
  storeUrl?: string;
  variantIds?: Record<string, string | null>;
}

/**
 * Generates a Lemon Squeezy checkout URL for a given plan ID.
 * Returns null if the plan is unmapped (null variant ID or empty store URL).
 *
 * @param planId - Plan key ('starter', 'pro', 'business', 'scale', 'enterprise')
 * @param options - Optional overrides for storeUrl and variantIds
 */
export function lemonCheckoutUrl(
  planId: string,
  options?: LemonCheckoutOptions,
): string | null {
  const variants = options?.variantIds ?? LEMON_VARIANT_IDS;
  const variantId = variants[planId]?.trim();
  if (!variantId) {
    return null;
  }

  // If variantId is already a full URL, return directly
  if (/^https?:\/\//i.test(variantId)) {
    return variantId;
  }

  const envStore = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_LEMON_STORE_URL
    ? process.env.NEXT_PUBLIC_LEMON_STORE_URL.trim()
    : '';

  const rawStore = (options?.storeUrl ?? (envStore || LEMON_STORE_URL)).trim();

  if (!rawStore) {
    return null;
  }

  const base = rawStore.replace(/\/+$/, '');
  const prefix = /^https?:\/\//i.test(base) ? base : `https://${base}`;

  if (prefix.endsWith('/buy')) {
    return `${prefix}/${encodeURIComponent(variantId)}`;
  }
  return `${prefix}/buy/${encodeURIComponent(variantId)}`;
}
