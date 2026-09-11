import { env, requiredEnvKeys } from './env';

/**
 * Integration/credential registry.
 *
 * This is the single source of truth for which environment variable a feature
 * needs and whether it is currently configured. It returns boolean status plus
 * required variable NAMES only — never values — so any UI/API can safely show
 * "configured" without leaking a secret.
 */

export interface IntegrationDefinition {
  key: string;
  name: string;
  kind: 'llm' | 'search' | 'fetch' | 'email' | 'oauth' | 'payment' | 'messaging' | 'social' | 'commerce' | 'webhook' | 'maps' | 'core';
  description: string;
  requiredEnv: string[];
  /** When true the feature can run with sensible defaults even if unset. */
  optionalWhenUnset: boolean;
  /** A human/machine-readable reason it can still run without credentials. */
  defaultMode?: string;
}

export const INTEGRATION_DEFINITIONS: IntegrationDefinition[] = [
  {
    key: 'openai',
    name: 'OpenAI',
    kind: 'llm',
    description: 'LLM chat, vision and image generation via OpenAI.',
    requiredEnv: ['OPENAI_API_KEY'],
    optionalWhenUnset: false,
  },
  {
    key: 'anthropic',
    name: 'Anthropic',
    kind: 'llm',
    description: 'LLM chat via the Anthropic Messages API.',
    requiredEnv: ['ANTHROPIC_API_KEY'],
    optionalWhenUnset: false,
  },
  {
    key: 'google',
    name: 'Google AI',
    kind: 'llm',
    description: 'LLM chat via the Gemini API and Google Places via the same key.',
    requiredEnv: ['GOOGLE_API_KEY'],
    optionalWhenUnset: false,
  },
  {
    key: 'search',
    name: 'Web search',
    kind: 'search',
    description: 'Agent #001 / web_search. Defaults to the public DuckDuckGo HTML endpoint.',
    requiredEnv: ['AKBARAL_SEARCH_ENDPOINT'],
    optionalWhenUnset: true,
    defaultMode: 'public DuckDuckGo HTML endpoint',
  },
  {
    key: 'page_fetch',
    name: 'Page fetch',
    kind: 'fetch',
    description: 'Readable page extraction. Defaults to fetching public source URLs directly.',
    requiredEnv: ['AKBARAL_PAGE_FETCH_ENDPOINT'],
    optionalWhenUnset: true,
    defaultMode: 'direct public fetch',
  },
  {
    key: 'smtp',
    name: 'SMTP email',
    kind: 'email',
    description: 'Account recovery, email verification and campaign delivery.',
    requiredEnv: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'],
    optionalWhenUnset: true,
    defaultMode: 'development token mode only',
  },
  {
    key: 'oauth_google',
    name: 'Google OAuth',
    kind: 'oauth',
    description: 'Sign in with Google.',
    requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    optionalWhenUnset: true,
    defaultMode: 'email/password auth only',
  },
  {
    key: 'oauth_github',
    name: 'GitHub OAuth',
    kind: 'oauth',
    description: 'Sign in with GitHub.',
    requiredEnv: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
    optionalWhenUnset: true,
    defaultMode: 'email/password auth only',
  },
  {
    key: 'oauth_apple',
    name: 'Apple OAuth',
    kind: 'oauth',
    description: 'Sign in with Apple.',
    requiredEnv: ['APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET'],
    optionalWhenUnset: true,
    defaultMode: 'email/password auth only',
  },
  {
    key: 'oauth_microsoft',
    name: 'Microsoft OAuth',
    kind: 'oauth',
    description: 'Sign in with Microsoft.',
    requiredEnv: ['MS_CLIENT_ID', 'MS_CLIENT_SECRET'],
    optionalWhenUnset: true,
    defaultMode: 'email/password auth only',
  },
  {
    key: 'stripe',
    name: 'Stripe',
    kind: 'payment',
    description: 'Custom credit purchase via Stripe Payment Intents.',
    requiredEnv: ['STRIPE_SECRET_KEY'],
    optionalWhenUnset: true,
    defaultMode: 'manual admin settlement only',
  },
  {
    key: 'razorpay',
    name: 'Razorpay',
    kind: 'payment',
    description: 'Custom credit purchase via Razorpay.',
    requiredEnv: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'],
    optionalWhenUnset: true,
    defaultMode: 'manual admin settlement only',
  },
  {
    key: 'twilio',
    name: 'Twilio',
    kind: 'messaging',
    description: 'SMS/WhatsApp messages.',
    requiredEnv: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
    optionalWhenUnset: true,
    defaultMode: 'tool returns provider_not_configured',
  },
  {
    key: 'youtube',
    name: 'YouTube',
    kind: 'social',
    description: 'YouTube Data API v3 publish.',
    requiredEnv: ['YOUTUBE_ACCESS_TOKEN'],
    optionalWhenUnset: true,
    defaultMode: 'tool returns provider_not_configured',
  },
  {
    key: 'instagram',
    name: 'Instagram',
    kind: 'social',
    description: 'Instagram Graph API publish.',
    requiredEnv: ['INSTAGRAM_ACCESS_TOKEN'],
    optionalWhenUnset: true,
    defaultMode: 'tool returns provider_not_configured',
  },
  {
    key: 'x',
    name: 'X',
    kind: 'social',
    description: 'X API v2 post.',
    requiredEnv: ['X_BEARER_TOKEN'],
    optionalWhenUnset: true,
    defaultMode: 'tool returns provider_not_configured',
  },
  {
    key: 'shopify',
    name: 'Shopify',
    kind: 'commerce',
    description: 'Shopify Admin API product management.',
    requiredEnv: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ACCESS_TOKEN'],
    optionalWhenUnset: true,
    defaultMode: 'tool returns provider_not_configured',
  },
  {
    key: 'google_maps',
    name: 'Google Maps',
    kind: 'maps',
    description: 'Google Places text search.',
    requiredEnv: ['GOOGLE_API_KEY'],
    optionalWhenUnset: true,
    defaultMode: 'tool returns provider_not_configured',
  },
  {
    key: 'billing_webhook',
    name: 'Billing webhook',
    kind: 'webhook',
    description: 'Signed billing webhook verification.',
    requiredEnv: ['BILLING_WEBHOOK_SECRET'],
    optionalWhenUnset: true,
    defaultMode: 'webhook returns webhook_not_configured',
  },
];

export interface IntegrationStatus {
  key: string;
  name: string;
  kind: string;
  description: string;
  configured: boolean;
  /** Names only — never values. */
  requiredEnvVars: string[];
  missingEnvVars: string[];
  optionalWhenUnset: boolean;
  defaultMode?: string;
}

export interface ConfigStatus {
  core: {
    nodeEnv: string;
    host: string;
    port: number;
    database: { backend: string; configured: boolean };
    uploadDir: string;
    sessionSecretConfigured: boolean;
    allowPrivateProvider: boolean;
  };
  integrations: IntegrationStatus[];
}

function isConfigured(def: IntegrationDefinition): boolean {
  if (def.key === 'search') {
    return true; // default public endpoint works.
  }
  if (def.key === 'page_fetch') {
    return true; // direct public fetch works.
  }
  return requiredEnvKeys(def.requiredEnv).length === 0;
}

export function integrationStatus(def: IntegrationDefinition): IntegrationStatus {
  const missing = requiredEnvKeys(def.requiredEnv);
  return {
    key: def.key,
    name: def.name,
    kind: def.kind,
    description: def.description,
    configured: isConfigured(def),
    requiredEnvVars: [...def.requiredEnv],
    missingEnvVars: missing,
    optionalWhenUnset: def.optionalWhenUnset,
    defaultMode: def.defaultMode,
  };
}

export function getConfigStatus(): ConfigStatus {
  return {
    core: {
      nodeEnv: env.nodeEnv,
      host: env.host,
      port: env.port,
      database: {
        backend: /^postgres(ql)?:\/\//i.test(env.databaseUrl)
          ? 'postgres'
          : env.databaseUrl === ':memory:'
            ? 'sqlite:memory'
            : 'sqlite:file',
        configured: true,
      },
      uploadDir: env.uploadDir,
      sessionSecretConfigured: env.isProduction ? env.sessionSecret.length >= 32 : Boolean(env.sessionSecret),
      allowPrivateProvider: env.allowPrivateProvider,
    },
    integrations: INTEGRATION_DEFINITIONS.map(integrationStatus),
  };
}

export function getIntegration(key: string): IntegrationStatus | undefined {
  const def = INTEGRATION_DEFINITIONS.find((item) => item.key === key);
  return def ? integrationStatus(def) : undefined;
}
