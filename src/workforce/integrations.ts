/**
 * WORKFORCE INTEGRATIONS — honest, central status for every earning-relevant
 * provider. Each entry reports:
 *   · configured (credential present) or missing (exact env var + owner action);
 *   · what real work it unlocks;
 *   · what stays honestly unavailable until the owner acts.
 *
 * No probing calls that spend money or send messages are ever made here:
 * status = credential presence + format sanity + the tool's own honest error
 * contract. Anything genuinely requiring an external provider or owner
 * approval is labelled as such.
 */

export interface IntegrationStatus {
  key: string;
  label: string;
  category: string;
  configured: boolean;
  requiredEnv: string[];
  presentEnv: string[];
  missingEnv: string[];
  unlocks: string;
  ownerAction: string;
  status: 'ready' | 'needs_owner_action';
}

function envPresent(name: string): boolean {
  return Boolean((process.env[name] ?? '').trim());
}

const DEFINITIONS: Array<Omit<IntegrationStatus, 'configured' | 'presentEnv' | 'missingEnv' | 'status'>> = [
  {
    key: 'gemini', label: 'Google Gemini (reasoning model)', category: 'ai_model',
    requiredEnv: ['GOOGLE_API_KEY'],
    unlocks: 'Real agent reasoning, deliverables, verification. Without it all model executions fail honestly with provider_not_configured.',
    ownerAction: 'Set GOOGLE_API_KEY in the deployment secret store (never in chat).',
  },
  {
    key: 'search_tavily', label: 'Tavily web search', category: 'search',
    requiredEnv: ['TAVILY_API_KEY'],
    unlocks: 'Real opportunity discovery + verified tool context for agents.',
    ownerAction: 'Set TAVILY_API_KEY (or Brave/Serper below, or AKBARAL_SEARCH_ENDPOINT).',
  },
  {
    key: 'search_brave', label: 'Brave web search', category: 'search',
    requiredEnv: ['BRAVE_SEARCH_API_KEY'],
    unlocks: 'Real opportunity discovery + verified tool context for agents.',
    ownerAction: 'Set BRAVE_SEARCH_API_KEY (alternative to Tavily).',
  },
  {
    key: 'search_serper', label: 'Serper web search', category: 'search',
    requiredEnv: ['SERPER_API_KEY'],
    unlocks: 'Real opportunity discovery + verified tool context for agents.',
    ownerAction: 'Set SERPER_API_KEY (alternative to Tavily).',
  },
  {
    key: 'search_endpoint', label: 'Custom search endpoint', category: 'search',
    requiredEnv: ['AKBARAL_SEARCH_ENDPOINT'],
    unlocks: 'Real opportunity discovery via a self-hosted search proxy.',
    ownerAction: 'Set AKBARAL_SEARCH_ENDPOINT to a reachable search provider URL.',
  },
  {
    key: 'stripe', label: 'Stripe payments', category: 'payments',
    requiredEnv: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    unlocks: 'Verified revenue ingestion (webhook-signed payment events → evidence-backed revenue).',
    ownerAction: 'Connect Stripe: set STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET and register the webhook endpoint.',
  },
  {
    key: 'shopify', label: 'Shopify', category: 'commerce',
    requiredEnv: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ACCESS_TOKEN'],
    unlocks: 'Real product listings (draft by default) for e-commerce work.',
    ownerAction: 'Create a store + custom app token; set SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN.',
  },
  {
    key: 'youtube', label: 'YouTube Data API', category: 'publishing',
    requiredEnv: ['YOUTUBE_ACCESS_TOKEN'],
    unlocks: 'Real video publishing (after owner approval per item).',
    ownerAction: 'OAuth-connect the channel; set YOUTUBE_ACCESS_TOKEN.',
  },
  {
    key: 'instagram', label: 'Instagram Graph API', category: 'publishing',
    requiredEnv: ['INSTAGRAM_ACCESS_TOKEN'],
    unlocks: 'Real media publishing (after owner approval per item).',
    ownerAction: 'Connect the business account; set INSTAGRAM_ACCESS_TOKEN.',
  },
  {
    key: 'x', label: 'X API v2', category: 'publishing',
    requiredEnv: ['X_BEARER_TOKEN'],
    unlocks: 'Real posts (after owner approval per item).',
    ownerAction: 'Create an X app token; set X_BEARER_TOKEN.',
  },
  {
    key: 'twilio', label: 'Twilio messaging', category: 'messaging',
    requiredEnv: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
    unlocks: 'Real SMS/transactional messages (consented recipients + owner-approved template only).',
    ownerAction: 'Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN; approve templates.',
  },
  {
    key: 'smtp', label: 'SMTP email', category: 'messaging',
    requiredEnv: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'],
    unlocks: 'Real transactional email (consented recipients + owner-approved template only).',
    ownerAction: 'Set SMTP_HOST/SMTP_USER/SMTP_PASS (+ SMTP_FROM).',
  },
  {
    key: 'openai_images', label: 'OpenAI Images', category: 'media',
    requiredEnv: ['OPENAI_API_KEY'],
    unlocks: 'Real image generation for design/licensing deliverables.',
    ownerAction: 'Set OPENAI_API_KEY.',
  },
  {
    key: 'maps', label: 'Google Maps Places', category: 'data',
    requiredEnv: ['GOOGLE_API_KEY'],
    unlocks: 'Real place/business lookup for local-business work.',
    ownerAction: 'Covered by GOOGLE_API_KEY (Maps/Places enabled in the project).',
  },
];

export function integrationStatus(): IntegrationStatus[] {
  return DEFINITIONS.map((def) => {
    const presentEnv = def.requiredEnv.filter(envPresent);
    const missingEnv = def.requiredEnv.filter((name) => !envPresent(name));
    const configured = missingEnv.length === 0;
    return { ...def, configured, presentEnv, missingEnv, status: configured ? 'ready' : 'needs_owner_action' };
  });
}

export function searchConfigured(): boolean {
  return envPresent('TAVILY_API_KEY') || envPresent('BRAVE_SEARCH_API_KEY') || envPresent('SERPER_API_KEY') || Boolean((process.env.AKBARAL_SEARCH_ENDPOINT ?? '').trim());
}

export function modelConfigured(): boolean {
  return envPresent('GOOGLE_API_KEY');
}

export interface WorkforceReadiness {
  model: boolean;
  search: boolean;
  payments: boolean;
  ready: IntegrationStatus[];
  needsAction: IntegrationStatus[];
  summary: string;
}

export function workforceReadiness(): WorkforceReadiness {
  const all = integrationStatus();
  const ready = all.filter((i) => i.configured);
  const needsAction = all.filter((i) => !i.configured);
  const model = modelConfigured();
  const search = searchConfigured();
  const payments = envPresent('STRIPE_SECRET_KEY') && envPresent('STRIPE_WEBHOOK_SECRET');
  const summary = model && search
    ? 'Workforce can discover, evaluate and execute real work now; publishing/messaging/commerce unlock as each provider is connected.'
    : !model && !search
      ? 'Model + search are both unconfigured: discovery and execution will fail honestly until GOOGLE_API_KEY and a search key/endpoint are set.'
      : !model
        ? 'Search is ready but the model is not: discovery works, execution waits for GOOGLE_API_KEY.'
        : 'Model is ready but search is not: execution works for owner-supplied opportunities, discovery waits for a search key/endpoint.';
  return { model, search, payments, ready, needsAction, summary };
}
