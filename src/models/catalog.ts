import {
  db,
  upsertModel,
  upsertModelProvider,
  registerTool,
} from '../db';

/** ISO timestamp for catalog sync writes. */
const NOW = () => new Date().toISOString();

/**
 * Model/Provider/Tool catalog.
 *
 * This is the integration contract for legitimate public providers. No secret is
 * ever read from the database; each provider points at an environment variable
 * (`envKey`) that must hold the credential before the provider is enabled.
 */

export interface ProviderSpec {
  key: string;
  name: string;
  type: 'llm' | 'image' | 'video' | 'audio' | 'speech' | 'embedding';
  baseUrl?: string;
  docsUrl?: string;
  envKey: string;
  capabilities: string[];
}

export interface ModelSpec {
  key: string;
  name: string;
  providerKey: string;
  capability: 'llm' | 'image' | 'video' | 'audio' | 'speech' | 'embedding';
  modality: 'text' | 'image' | 'video' | 'audio' | 'multimodal';
  contextTokens?: number;
  maxOutputTokens?: number;
  costInputPerMillionCents?: number;
  costOutputPerMillionCents?: number;
  costPerImageCents?: number;
  latencyMs?: number;
  reliability?: number;
  isDefault?: boolean;
  capabilities: string[];
}

export interface ToolSpec {
  key: string;
  name: string;
  description: string;
  kind: string;
  requiresCredential?: boolean;
  requiredCredentialEnvKey?: string;
  requiredCredentialEnvKeys?: string[];
  supportsStreaming?: boolean;
  securityPermissions: string[];
}

export const PROVIDER_SPECS: ProviderSpec[] = [
  {
    key: 'openai',
    name: 'OpenAI',
    type: 'llm',
    baseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/docs',
    envKey: 'OPENAI_API_KEY',
    capabilities: ['text', 'reasoning', 'coding', 'vision', 'image', 'multimodal', 'embedding'],
  },
  {
    key: 'anthropic',
    name: 'Anthropic',
    type: 'llm',
    baseUrl: 'https://api.anthropic.com/v1',
    docsUrl: 'https://docs.anthropic.com',
    envKey: 'ANTHROPIC_API_KEY',
    capabilities: ['text', 'reasoning', 'coding', 'writing', 'multimodal'],
  },
  {
    key: 'google',
    name: 'Google AI',
    type: 'llm',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    docsUrl: 'https://ai.google.dev',
    envKey: 'GOOGLE_API_KEY',
    capabilities: ['text', 'reasoning', 'vision', 'multimodal', 'embedding'],
  },
];

export const MODEL_SPECS: ModelSpec[] = [
  {
    key: 'gpt-4o',
    name: 'GPT-4o',
    providerKey: 'openai',
    capability: 'llm',
    modality: 'multimodal',
    contextTokens: 128000,
    maxOutputTokens: 16384,
    costInputPerMillionCents: 250,
    costOutputPerMillionCents: 1000,
    latencyMs: 1500,
    reliability: 0.99,
    isDefault: false,
    capabilities: ['reasoning', 'coding', 'vision', 'research', 'writing'],
  },
  {
    key: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    providerKey: 'openai',
    capability: 'llm',
    modality: 'multimodal',
    contextTokens: 128000,
    maxOutputTokens: 16384,
    costInputPerMillionCents: 15,
    costOutputPerMillionCents: 60,
    latencyMs: 500,
    reliability: 0.99,
    isDefault: true,
    capabilities: ['speed', 'research', 'writing', 'simple_coding'],
  },
  {
    key: 'c3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    providerKey: 'anthropic',
    capability: 'llm',
    modality: 'multimodal',
    contextTokens: 200000,
    maxOutputTokens: 8192,
    costInputPerMillionCents: 300,
    costOutputPerMillionCents: 1500,
    latencyMs: 1800,
    reliability: 0.98,
    isDefault: false,
    capabilities: ['reasoning', 'coding', 'writing', 'analysis', 'long_context'],
  },
  // Google Gemini models — verified against the official model list and
  // pricing (ai.google.dev/gemini-api/docs/models, September 2026).
  // gemini-2.0-flash was shut down by Google on 2026-06-01 (release notes:
  // "Use gemini-3.5-flash or gemini-3.1-flash-lite instead") and returns
  // HTTP 404 from generativelanguage.googleapis.com — it must never come
  // back into this catalog.
  {
    key: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    providerKey: 'google',
    capability: 'llm',
    modality: 'multimodal',
    contextTokens: 1048576,
    maxOutputTokens: 65536,
    costInputPerMillionCents: 75,
    costOutputPerMillionCents: 375,
    latencyMs: 700,
    reliability: 0.98,
    isDefault: true,
    capabilities: ['reasoning', 'coding', 'research', 'writing', 'speed', 'long_context', 'vision'],
  },
  {
    key: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    providerKey: 'google',
    capability: 'llm',
    modality: 'multimodal',
    contextTokens: 1048576,
    maxOutputTokens: 65536,
    costInputPerMillionCents: 150,
    costOutputPerMillionCents: 900,
    latencyMs: 750,
    reliability: 0.98,
    isDefault: false,
    capabilities: ['research', 'writing', 'speed', 'long_context', 'vision'],
  },
  {
    key: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash-Lite',
    providerKey: 'google',
    capability: 'llm',
    modality: 'multimodal',
    contextTokens: 1048576,
    maxOutputTokens: 65536,
    costInputPerMillionCents: 25,
    costOutputPerMillionCents: 150,
    latencyMs: 400,
    reliability: 0.97,
    isDefault: false,
    capabilities: ['speed', 'research', 'writing'],
  },
  {
    key: 'dall-e-3',
    name: 'DALL·E 3',
    providerKey: 'openai',
    capability: 'image',
    modality: 'image',
    costPerImageCents: 40,
    latencyMs: 5000,
    reliability: 0.97,
    isDefault: false,
    capabilities: ['image_generation', 'design', 'creative'],
  },
];

export const TOOL_SPECS: ToolSpec[] = [
  {
    key: 'web_search',
    name: 'Web Search',
    description: 'Search the public web through a configurable search endpoint.',
    kind: 'web',
    supportsStreaming: true,
    securityPermissions: ['network:http', 'data:read'],
  },
  {
    key: 'page_fetch',
    name: 'Page Fetch',
    description: 'Fetch and extract readable content from a public URL.',
    kind: 'web',
    securityPermissions: ['network:http', 'data:read', 'ssrf:allow_public'],
  },
  {
    key: 'code_repository_read',
    name: 'Repository Read',
    description: 'Safely read files within the workspace repository.',
    kind: 'code',
    securityPermissions: ['fs:read:workspace', 'data:read'],
  },
  {
    key: 'file_parse_text',
    name: 'Text File Parser',
    description: 'Parse and index text, CSV and JSON documents.',
    kind: 'file',
    securityPermissions: ['fs:read:uploads', 'data:read'],
  },
  {
    key: 'knowledge_search',
    name: 'Knowledge Search',
    description: 'Retrieve indexed project knowledge.',
    kind: 'knowledge',
    securityPermissions: ['data:read'],
  },
  {
    key: 'excel_build',
    name: 'Spreadsheet Builder',
    description: 'Build structured spreadsheet output after analysis.',
    kind: 'data',
    securityPermissions: ['data:read', 'export:data'],
  },
  {
    key: 'image_render',
    name: 'Image Renderer',
    description: 'Render an image through a configured image model.',
    kind: 'media',
    requiresCredential: true,
    requiredCredentialEnvKey: 'OPENAI_API_KEY',
    securityPermissions: ['model:image', 'api:call'],
  },
  {
    key: 'youtube_publish',
    name: 'YouTube Publish',
    description: 'Publish a video to the YouTube Data API v3.',
    kind: 'media',
    requiresCredential: true,
    requiredCredentialEnvKey: 'YOUTUBE_ACCESS_TOKEN',
    securityPermissions: ['api:call', 'publish:video'],
  },
  {
    key: 'instagram_publish',
    name: 'Instagram Publish',
    description: 'Publish media through the Instagram Graph API.',
    kind: 'media',
    requiresCredential: true,
    requiredCredentialEnvKey: 'INSTAGRAM_ACCESS_TOKEN',
    securityPermissions: ['api:call', 'publish:media'],
  },
  {
    key: 'x_post',
    name: 'X Post',
    description: 'Publish a post through the X API v2.',
    kind: 'social',
    requiresCredential: true,
    requiredCredentialEnvKey: 'X_BEARER_TOKEN',
    securityPermissions: ['api:call', 'publish:post'],
  },
  {
    key: 'shopify_product',
    name: 'Shopify Product',
    description: 'Manage products through the Shopify Admin API.',
    kind: 'commerce',
    requiresCredential: true,
    requiredCredentialEnvKeys: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ACCESS_TOKEN'],
    securityPermissions: ['api:call', 'write:commerce'],
  },
  {
    key: 'twilio_message',
    name: 'Twilio Message',
    description: 'Send messages through the Twilio API.',
    kind: 'messaging',
    requiresCredential: true,
    requiredCredentialEnvKeys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
    securityPermissions: ['api:call', 'send:message'],
  },
  {
    key: 'stripe_payment',
    name: 'Stripe Payment',
    description: 'Create payment intents through Stripe.',
    kind: 'payment',
    requiresCredential: true,
    requiredCredentialEnvKey: 'STRIPE_SECRET_KEY',
    securityPermissions: ['api:call', 'charge:payment'],
  },
  {
    key: 'http_request',
    name: 'HTTP Request',
    description: 'Perform a GET or POST JSON request against a public HTTP endpoint (SSRF-guarded).',
    kind: 'api',
    securityPermissions: ['network:http', 'ssrf:allow_public', 'data:read'],
  },
  {
    key: 'json_transform',
    name: 'JSON Transform',
    description: 'Pick, limit and reshape JSON data locally without any network access.',
    kind: 'data',
    securityPermissions: ['data:read', 'data:transform'],
  },
  {
    key: 'text_analyze',
    name: 'Text Analyzer',
    description: 'Local text statistics: words, sentences, characters, top keywords and reading time.',
    kind: 'data',
    securityPermissions: ['data:read', 'data:transform'],
  },
  {
    key: 'csv_parse',
    name: 'CSV Parser',
    description: 'Parse CSV text into structured headers and rows entirely locally.',
    kind: 'data',
    securityPermissions: ['data:read', 'data:transform'],
  },
  {
    key: 'maps_place',
    name: 'Maps Place Search',
    description: 'Search places with the Google Places API.',
    kind: 'geo',
    requiresCredential: true,
    requiredCredentialEnvKey: 'GOOGLE_API_KEY',
    securityPermissions: ['api:call', 'geo:read'],
  },
];

export function providerEnabled(spec: ProviderSpec): boolean {
  return Boolean(process.env[spec.envKey]);
}

export function modelAvailable(spec: ModelSpec): boolean {
  const provider = PROVIDER_SPECS.find((item) => item.key === spec.providerKey);
  return Boolean(provider && providerEnabled(provider));
}

export function modelRequiredCredential(spec: ModelSpec): string | null {
  const provider = PROVIDER_SPECS.find((item) => item.key === spec.providerKey);
  return provider?.envKey ?? null;
}

/**
 * Keep the operator's current status when re-seeding; only absent rows default
 * to enabled. The router reports provider_not_configured when credentials are
 * missing, so `disabled` is reserved for an explicit admin decision.
 */
function preserveStatus(table: 'models' | 'model_providers', key: string): string {
  const row = db.get<{ status: string }>(`SELECT status FROM ${table} WHERE key = ?`, [key]);
  return row?.status === 'disabled' ? 'disabled' : 'enabled';
}

/**
 * Register the catalog into the database so runtime routing reads the same
 * definitions used by the admin/control surfaces.
 */
export function syncModelCatalog(): void {
  for (const provider of PROVIDER_SPECS) {
    upsertModelProvider({
      key: provider.key,
      name: provider.name,
      type: provider.type,
      baseUrl: provider.baseUrl ?? null,
      docsUrl: provider.docsUrl ?? null,
      envKey: provider.envKey,
      capabilities: provider.capabilities,
      // Status encodes operator enable/disable, not credential availability.
      // Credential absence is surfaced by the router as provider_not_configured
      // so the platform stays honest and never reports "no models registered".
      status: preserveStatus('model_providers', provider.key),
    });
  }
  for (const model of MODEL_SPECS) {
    upsertModel({
      key: model.key,
      name: model.name,
      providerKey: model.providerKey,
      capability: model.capability,
      modality: model.modality,
      contextTokens: model.contextTokens ?? null,
      maxOutputTokens: model.maxOutputTokens ?? null,
      costInputPerMillionCents: model.costInputPerMillionCents ?? 0,
      costOutputPerMillionCents: model.costOutputPerMillionCents ?? 0,
      costPerImageCents: model.costPerImageCents ?? 0,
      latencyMs: model.latencyMs ?? 0,
      reliability: model.reliability ?? 0.95,
      strengths: model.capabilities,
      weaknesses: [],
      status: preserveStatus('models', model.key),
      isDefault: model.isDefault ?? false,
    });
  }
  // Retire catalog-managed models that are no longer in MODEL_SPECS.
  // Providers retire model IDs (e.g. Google shut gemini-2.0-flash down on
  // 2026-06-01 — every call then fails HTTP 404), so a stale DB row must
  // never stay routable. Only rows belonging to a catalog provider are
  // touched: operator-disabled rows keep their status, and rows for
  // providers outside this catalog are left alone entirely.
  const catalogKeys = new Set(MODEL_SPECS.map((model) => model.key));
  const catalogProviderKeys = Array.from(new Set(PROVIDER_SPECS.map((provider) => provider.key)));
  const managed = db.all(
    `SELECT key, status FROM models WHERE provider_key IN (${catalogProviderKeys.map(() => '?').join(', ')})`,
    catalogProviderKeys,
  ) as Array<{ key: string; status: string }>;
  for (const row of managed) {
    if (row.status === 'retired' || row.status === 'disabled') {
      continue;
    }
    if (!catalogKeys.has(row.key)) {
      db.run("UPDATE models SET status = 'retired', updated_at = ? WHERE key = ?", [NOW(), row.key]);
    }
  }

  for (const tool of TOOL_SPECS) {
    registerTool({
      key: tool.key,
      name: tool.name,
      description: tool.description,
      kind: tool.kind,
      requiresCredential: tool.requiresCredential ?? false,
      requiredCredentialEnvKey: tool.requiredCredentialEnvKeys?.join(', ') ?? tool.requiredCredentialEnvKey ?? null,
      supportsStreaming: tool.supportsStreaming ?? false,
      securityPermissions: tool.securityPermissions,
    });
  }
}
