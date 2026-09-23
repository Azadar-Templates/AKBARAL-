/**
 * AKBARAL! PAYMENT PROVIDER CAPABILITY DETECTION
 *
 * Exposes the honest configuration status of payment providers WITHOUT
 * revealing secrets. Used by the Owner Console and billing routes to
 * make informed decisions about whether to present paid checkout.
 *
 * NEVER fabricates provider availability. NEVER exposes secret values.
 * If no provider is configured, checkout is honestly disabled.
 */

import { stripeConfigured, razorpayConfigured } from './providers';

export interface PaymentProviderCapability {
  provider: string;
  configured: boolean;
  /** Whether this provider can accept payments from this country (if specified) */
  countryEligible?: boolean;
  /** Human-readable reason for current status */
  status: string;
  /** What the owner needs to do to enable this provider */
  ownerActions: string[];
  /** Whether checkout can proceed with this provider */
  checkoutReady: boolean;
}

export interface PaymentCapabilities {
  /** Can customers currently upgrade to a paid plan? */
  paidCheckoutAvailable: boolean;
  /** Can customers currently purchase credits? */
  creditPurchaseAvailable: boolean;
  /** Which providers are ready for checkout */
  readyProviders: string[];
  /** Which providers are configured but not ready */
  degradedProviders: string[];
  /** Which providers are not configured */
  unavailableProviders: string[];
  /** Detailed capability for each provider */
  providers: PaymentProviderCapability[];
  /** Free plan and trial functionality */
  freeTierAvailable: boolean;
  /** Whether invoice generation works without payment provider */
  invoiceGenerationAvailable: boolean;
  /** Whether the system is ready for paid upgrades (honest check) */
  message: string;
}

/** Stripe merchant countries where the account can legally receive payments */
const STRIPE_SUPPORTED_COUNTRIES = new Set([
  'US','GB','DE','FR','CA','AU','NZ','JP','SG','HK','IN','BR','MX','MY','TH','ID','PH','VN',
  'PL','CZ','HU','RO','BG','HR','SK','SI','LT','LV','EE','PT','ES','IT','NL','BE','AT','CH',
  'DK','SE','NO','FI','IE','GR','LU','MT','CY','IS','LI','TR','AE','SA','QA','KW','BH','OM','JO',
]);

/** Razorpay is India-only for merchants */
const RAZORPAY_SUPPORTED_COUNTRIES = new Set(['IN']);

/**
 * Get the full payment capability report.
 * Optionally filter by merchant country (the country where the business is registered).
 */
export function getPaymentCapabilities(merchantCountry?: string): PaymentCapabilities {
  const providers: PaymentProviderCapability[] = [];

  // Stripe
  const stripeReady = stripeConfigured();
  const stripeCountryOk = merchantCountry ? STRIPE_SUPPORTED_COUNTRIES.has(merchantCountry.toUpperCase()) : true;
  const stripeActions: string[] = [];
  if (!stripeReady) stripeActions.push('Set STRIPE_SECRET_KEY environment variable');
  if (merchantCountry && !stripeCountryOk) stripeActions.push(`Stripe is not available for merchants in ${merchantCountry}. Requires Stripe-supported country or US LLC + EIN + US bank account.`);

  providers.push({
    provider: 'stripe',
    configured: stripeReady,
    countryEligible: merchantCountry ? stripeCountryOk : undefined,
    status: !stripeReady ? 'not_configured' : (!stripeCountryOk ? 'country_not_supported' : 'ready'),
    ownerActions: stripeActions,
    checkoutReady: stripeReady && stripeCountryOk,
  });

  // Razorpay
  const razorpayReady = razorpayConfigured();
  const razorpayCountryOk = merchantCountry ? RAZORPAY_SUPPORTED_COUNTRIES.has(merchantCountry.toUpperCase()) : true;
  const razorpayActions: string[] = [];
  if (!razorpayReady) razorpayActions.push('Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables');
  if (merchantCountry && !razorpayCountryOk) razorpayActions.push(`Razorpay is only available for merchants in India`);

  providers.push({
    provider: 'razorpay',
    configured: razorpayReady,
    countryEligible: merchantCountry ? razorpayCountryOk : undefined,
    status: !razorpayReady ? 'not_configured' : (!razorpayCountryOk ? 'country_not_supported' : 'ready'),
    ownerActions: razorpayActions,
    checkoutReady: razorpayReady && razorpayCountryOk,
  });

  const readyProviders = providers.filter(p => p.checkoutReady).map(p => p.provider);
  const degradedProviders = providers.filter(p => p.configured && !p.checkoutReady).map(p => p.provider);
  const unavailableProviders = providers.filter(p => !p.configured).map(p => p.provider);

  const paidCheckoutAvailable = readyProviders.length > 0;

  let message: string;
  if (paidCheckoutAvailable) {
    message = `Payment checkout available via: ${readyProviders.join(', ')}. Customers can upgrade and purchase credits.`;
  } else {
    const missingActions = providers.flatMap(p => p.ownerActions);
    message = `No payment provider configured. Free tier and trials are available. To enable paid checkout: ${missingActions.join('; ') || 'configure at least one payment provider.'}`;
  }

  return {
    paidCheckoutAvailable,
    creditPurchaseAvailable: paidCheckoutAvailable,
    readyProviders,
    degradedProviders,
    unavailableProviders,
    providers,
    freeTierAvailable: true,
    invoiceGenerationAvailable: true,
    message,
  };
}

/**
 * Quick check: can this customer upgrade to a paid plan?
 * Returns an honest result that the billing route can use.
 */
export function canUpgrade(merchantCountry?: string): {
  canUpgrade: boolean;
  provider: string | null;
  reason: string;
} {
  const caps = getPaymentCapabilities(merchantCountry);
  if (caps.readyProviders.length === 0) {
    return {
      canUpgrade: false,
      provider: null,
      reason: caps.message,
    };
  }
  return {
    canUpgrade: true,
    provider: caps.readyProviders[0],
    reason: `Upgrade available via ${caps.readyProviders[0]}`,
  };
}

/**
 * Resolve which provider to use for checkout, based on configuration.
 * Returns null if no provider is configured (honest failure).
 */
export function resolveCheckoutProvider(merchantCountry?: string): 'stripe' | 'razorpay' | null {
  const caps = getPaymentCapabilities(merchantCountry);
  if (caps.readyProviders.length === 0) return null;
  // Prefer Stripe over Razorpay
  if (caps.readyProviders.includes('stripe')) return 'stripe';
  if (caps.readyProviders.includes('razorpay')) return 'razorpay';
  return null;
}
