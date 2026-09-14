/**
 * Production web-search providers (Agent #001 research path).
 *
 * The research agent originally spoke one protocol: a DuckDuckGo-shaped HTML
 * page or a generic JSON `{results:[{title,url,description}]}` endpoint. That
 * is a real integration, but it is not what a production host should depend on:
 * search engines routinely serve datacenter IP ranges a bot-check page instead
 * of results, and a keyless scrape has no quota contract.
 *
 * This module adds first-class support for the commercial search APIs an
 * operator can point the platform at, WITHOUT any credential ever reaching a
 * client, a log line or an error message:
 *
 *   TAVILY_API_KEY        Tavily        POST /search            (Bearer header)
 *   BRAVE_SEARCH_API_KEY  Brave Search  GET  /res/v1/web/search (subscription header)
 *   SERPER_API_KEY        Serper        POST /search            (X-API-KEY header)
 *   GOOGLE_CSE_API_KEY +  Google        GET  /customsearch/v1   (documented key param)
 *   GOOGLE_CSE_ID         Programmable Search
 *
 * Selection is explicit-first and never silent:
 *   1. AKBARAL_SEARCH_PROVIDER=<kind>   operator's explicit choice (validated)
 *   2. AKBARAL_SEARCH_ENDPOINT          operator's explicit endpoint/proxy
 *   3. auto-detected keyed provider     tavily → brave → serper → google_cse
 *   4. DuckDuckGo HTML                  keyless default (honest, no key needed)
 *
 * Credentials are read from the server environment at call time and travel in
 * request HEADERS wherever the provider supports it. Google Programmable Search
 * only accepts its key as a documented query parameter — that URL is never
 * logged and never echoed (the shared outbound helper reports status + a
 * redacted body only).
 *
 * Transport/safety: every provider URL passes the same SSRF validation as the
 * rest of the platform, and production refuses a cleartext base URL unless the
 * operator explicitly trusted a private provider.
 */

import { externalHttpRequest, ExternalHttpError } from '../integrations/http';
import { assertProviderHttpUrl } from '../security/ssrf';

export interface SearchResultItem {
  title: string;
  url: string;
  description: string;
}

export type SearchProviderKind = 'tavily' | 'brave' | 'serper' | 'google_cse' | 'endpoint' | 'duckduckgo';

export interface SearchProviderSpec {
  kind: SearchProviderKind;
  /** Human label used in status payloads and error messages. */
  label: string;
  /** Environment variable NAMES only — values are never read here. */
  requiredEnv: string[];
  /** True when the provider works without any credential. */
  keyless: boolean;
  /** Optional base-URL override variable (gateways, regional endpoints). */
  baseUrlEnv?: string;
  defaultBaseUrl?: string;
  docsUrl?: string;
}

export const SEARCH_PROVIDER_SPECS: readonly SearchProviderSpec[] = [
  {
    kind: 'tavily',
    label: 'Tavily',
    requiredEnv: ['TAVILY_API_KEY'],
    keyless: false,
    baseUrlEnv: 'TAVILY_BASE_URL',
    defaultBaseUrl: 'https://api.tavily.com',
    docsUrl: 'https://docs.tavily.com',
  },
  {
    kind: 'brave',
    label: 'Brave Search',
    requiredEnv: ['BRAVE_SEARCH_API_KEY'],
    keyless: false,
    baseUrlEnv: 'BRAVE_SEARCH_BASE_URL',
    defaultBaseUrl: 'https://api.search.brave.com',
    docsUrl: 'https://api-dashboard.search.brave.com',
  },
  {
    kind: 'serper',
    label: 'Serper',
    requiredEnv: ['SERPER_API_KEY'],
    keyless: false,
    baseUrlEnv: 'SERPER_BASE_URL',
    defaultBaseUrl: 'https://google.serper.dev',
    docsUrl: 'https://serper.dev',
  },
  {
    kind: 'google_cse',
    label: 'Google Programmable Search',
    requiredEnv: ['GOOGLE_CSE_API_KEY', 'GOOGLE_CSE_ID'],
    keyless: false,
    baseUrlEnv: 'GOOGLE_CSE_BASE_URL',
    defaultBaseUrl: 'https://www.googleapis.com',
    docsUrl: 'https://developers.google.com/custom-search/v1/overview',
  },
  {
    kind: 'endpoint',
    label: 'Configured search endpoint',
    requiredEnv: ['AKBARAL_SEARCH_ENDPOINT'],
    keyless: false,
  },
  {
    kind: 'duckduckgo',
    label: 'DuckDuckGo (keyless default)',
    requiredEnv: [],
    keyless: true,
  },
];

/** Auto-detection order when the operator configured a key but no explicit choice. */
export const AUTO_DETECT_ORDER: readonly SearchProviderKind[] = ['tavily', 'brave', 'serper', 'google_cse'];

export class SearchProviderNotConfiguredError extends Error {
  readonly code = 'provider_not_configured';
  readonly requiredEnvKeys: string[];

  constructor(message: string, requiredEnvKeys: string[]) {
    super(message);
    this.name = 'SearchProviderNotConfiguredError';
    this.requiredEnvKeys = requiredEnvKeys;
  }
}

export interface ActiveSearchProvider {
  kind: SearchProviderKind;
  label: string;
  /** Names only — never values. */
  requiredEnvVars: string[];
  /** True when everything this provider needs is present in the environment. */
  credentialsConfigured: boolean;
  /** True when it runs without credentials (the keyless default). */
  keyless: boolean;
}

export function getProviderSpec(kind: SearchProviderKind): SearchProviderSpec {
  const spec = SEARCH_PROVIDER_SPECS.find((entry) => entry.kind === kind);
  if (!spec) {
    throw new Error(`unknown search provider "${kind}"`);
  }
  return spec;
}

function isConfigured(spec: SearchProviderSpec): boolean {
  return spec.requiredEnv.every((key) => Boolean((process.env[key] ?? '').trim()));
}

function describe(spec: SearchProviderSpec): ActiveSearchProvider {
  return {
    kind: spec.kind,
    label: spec.label,
    requiredEnvVars: [...spec.requiredEnv],
    credentialsConfigured: isConfigured(spec),
    keyless: spec.keyless,
  };
}

/** Every environment variable name the search layer understands (names only). */
export function searchProviderEnvKeys(): string[] {
  return [...new Set(SEARCH_PROVIDER_SPECS.flatMap((spec) => spec.requiredEnv))];
}

/**
 * Resolve the provider that will serve searches for this process.
 *
 * An explicit `AKBARAL_SEARCH_PROVIDER` that is not usable fails honestly —
 * silently falling back would hide exactly the misconfiguration an operator
 * needs to see.
 */
export function resolveSearchProvider(): ActiveSearchProvider {
  const requested = (process.env.AKBARAL_SEARCH_PROVIDER ?? '').trim().toLowerCase();
  if (requested) {
    const spec = SEARCH_PROVIDER_SPECS.find((entry) => entry.kind === requested);
    if (!spec) {
      throw new SearchProviderNotConfiguredError(
        `AKBARAL_SEARCH_PROVIDER "${requested}" is not a supported provider; use one of ${SEARCH_PROVIDER_SPECS.map((s) => s.kind).join(', ')}`,
        [],
      );
    }
    if (spec.kind === 'endpoint' && !(process.env.AKBARAL_SEARCH_ENDPOINT ?? '').trim()) {
      throw new SearchProviderNotConfiguredError(
        'AKBARAL_SEARCH_PROVIDER=endpoint requires AKBARAL_SEARCH_ENDPOINT to be set',
        ['AKBARAL_SEARCH_ENDPOINT'],
      );
    }
    if (!spec.keyless && !isConfigured(spec)) {
      throw new SearchProviderNotConfiguredError(
        `${spec.label} is selected but not configured; set ${spec.requiredEnv.join(' and ')}`,
        [...spec.requiredEnv],
      );
    }
    return describe(spec);
  }

  if ((process.env.AKBARAL_SEARCH_ENDPOINT ?? '').trim()) {
    return describe(getProviderSpec('endpoint'));
  }

  for (const kind of AUTO_DETECT_ORDER) {
    const spec = getProviderSpec(kind);
    if (isConfigured(spec)) {
      return describe(spec);
    }
  }

  return describe(getProviderSpec('duckduckgo'));
}

/** Operator-facing status for admin/config surfaces: names and booleans only. */
export function searchProviderStatus(): {
  active: ActiveSearchProvider;
  supported: Array<{ kind: SearchProviderKind; label: string; requiredEnvVars: string[]; configured: boolean; keyless: boolean }>;
} {
  return {
    active: (() => {
      try {
        return resolveSearchProvider();
      } catch {
        // An explicitly selected but unusable provider is reported as such by
        // the call path; status must still answer without throwing.
        return {
          kind: 'endpoint' as SearchProviderKind,
          label: 'misconfigured (see AKBARAL_SEARCH_PROVIDER)',
          requiredEnvVars: searchProviderEnvKeys(),
          credentialsConfigured: false,
          keyless: false,
        };
      }
    })(),
    supported: SEARCH_PROVIDER_SPECS.map((spec) => ({
      kind: spec.kind,
      label: spec.label,
      requiredEnvVars: [...spec.requiredEnv],
      configured: isConfigured(spec),
      keyless: spec.keyless,
    })),
  };
}

/**
 * Retry only transient failures (network, timeout, 429, 5xx). Auth/bad-request
 * failures are permanent: retrying burns quota for a guaranteed failure.
 */
export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ExternalHttpError) {
    const status = error.status;
    return status === undefined || status === 408 || status === 429 || status >= 500;
  }
  if (error instanceof SearchProviderNotConfiguredError) {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /status (5\d\d|429)\b|aborted|timed out|network|fetch failed|econn|etimedout|enotfound|too many redirects/i.test(
    message,
  );
}

function baseUrl(spec: SearchProviderSpec): string {
  const override = spec.baseUrlEnv ? (process.env[spec.baseUrlEnv] ?? '').trim() : '';
  const base = override || spec.defaultBaseUrl;
  if (!base) {
    throw new SearchProviderNotConfiguredError(`${spec.label} has no base URL configured`, []);
  }
  // Same SSRF validation the rest of the platform uses; a provider override
  // may only be a private host when the operator explicitly trusted one.
  const validated = assertProviderHttpUrl(base).replace(/\/+$/, '');
  const url = new URL(validated);
  if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production' && process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER !== '1') {
    throw new Error(
      `${spec.label} base URL must use HTTPS in production (set ${spec.baseUrlEnv ?? 'the base URL override'} to an https:// URL, or AKBARAL_ALLOW_PRIVATE_PROVIDER=1 only for a trusted internal provider)`,
    );
  }
  return validated;
}

/** Read a credential; never logged, never returned, never echoed in errors. */
function requireKey(spec: SearchProviderSpec, envKey: string): string {
  const value = (process.env[envKey] ?? '').trim();
  if (!value) {
    throw new SearchProviderNotConfiguredError(`${spec.label} requires ${envKey}`, [...spec.requiredEnv]);
  }
  return value;
}

function pickString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
}

function readNested(record: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = record;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Map provider-specific payloads into the platform's search result shape.
 * Non-http(s) entries are dropped here so a hostile/malformed provider
 * response can never inject `javascript:` or relative URLs into the canvas.
 */
export function normalizeProviderResults(
  kind: SearchProviderKind,
  payload: Record<string, unknown>,
  limit: number,
): SearchResultItem[] {
  const raw: Array<Record<string, unknown>> = (() => {
    switch (kind) {
      case 'tavily':
        return asRecordArray(payload.results);
      case 'brave':
        return asRecordArray(readNested(payload, ['web', 'results']));
      case 'serper': {
        const organic = asRecordArray(payload.organic);
        return organic.length > 0 ? organic : asRecordArray(payload.results);
      }
      case 'google_cse':
        return asRecordArray(payload.items);
      default: {
        const direct = asRecordArray(payload.results);
        return direct.length > 0 ? direct : asRecordArray(payload.items);
      }
    }
  })();

  const results: SearchResultItem[] = [];
  for (const item of raw) {
    if (results.length >= limit) {
      break;
    }
    const url =
      kind === 'serper' || kind === 'google_cse'
        ? pickString(item, ['link', 'url'])
        : pickString(item, ['url', 'link']);
    if (!/^https?:\/\//i.test(url)) {
      continue;
    }
    const title = pickString(item, ['title', 'name']);
    if (!title) {
      continue;
    }
    const description = pickString(item, ['content', 'description', 'snippet', 'text']);
    results.push({ title, url, description });
  }
  return results;
}

/**
 * Does this payload contain the results container the provider documents?
 *
 * A recognized-but-empty array is a genuine "no matches" answer. An
 * unrecognized payload (block page, quota HTML, renamed field after an API
 * change) must fail loudly instead of masquerading as an empty search — that
 * would silently degrade every research task.
 */
export function hasRecognizedResultShape(kind: SearchProviderKind, payload: Record<string, unknown>): boolean {
  switch (kind) {
    case 'tavily':
      return Array.isArray(payload.results);
    case 'brave':
      return Array.isArray(readNested(payload, ['web', 'results']));
    case 'serper':
      return Array.isArray(payload.organic) || Array.isArray(payload.results);
    case 'google_cse':
      return Array.isArray(payload.items);
    default:
      return Array.isArray(payload.results) || Array.isArray(payload.items);
  }
}

interface BuiltRequest {
  url: string;
  init: { method: string; headers: Record<string, string>; body?: string };
}

/** Build the concrete provider request. Exported for contract tests. */
export function buildProviderRequest(
  provider: ActiveSearchProvider,
  query: string,
  limit: number,
): BuiltRequest {
  const spec = getProviderSpec(provider.kind);
  const base = baseUrl(spec);
  const capped = Math.max(1, Math.min(Math.floor(limit) || 5, 10));

  switch (provider.kind) {
    case 'tavily': {
      const key = requireKey(spec, 'TAVILY_API_KEY');
      return {
        url: `${base}/search`,
        init: {
          method: 'POST',
          // Credential in a header — never in the URL.
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ query, max_results: capped, search_depth: 'basic', include_answer: false }),
        },
      };
    }
    case 'brave': {
      const key = requireKey(spec, 'BRAVE_SEARCH_API_KEY');
      const url = new URL(`${base}/res/v1/web/search`);
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(capped));
      return {
        url: url.toString(),
        init: {
          method: 'GET',
          headers: { Accept: 'application/json', 'X-Subscription-Token': key },
        },
      };
    }
    case 'serper': {
      const key = requireKey(spec, 'SERPER_API_KEY');
      return {
        url: `${base}/search`,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-KEY': key },
          body: JSON.stringify({ q: query, num: capped }),
        },
      };
    }
    case 'google_cse': {
      const key = requireKey(spec, 'GOOGLE_CSE_API_KEY');
      const cx = requireKey(spec, 'GOOGLE_CSE_ID');
      const url = new URL(`${base}/customsearch/v1`);
      // Google's documented interface takes the key as a query parameter; the
      // URL is never logged and provider errors are redacted upstream.
      url.searchParams.set('key', key);
      url.searchParams.set('cx', cx);
      url.searchParams.set('q', query);
      url.searchParams.set('num', String(capped));
      return { url: url.toString(), init: { method: 'GET', headers: { Accept: 'application/json' } } };
    }
    default:
      throw new SearchProviderNotConfiguredError(
        `${provider.label} does not use the keyed search transport; it is served by the configured-endpoint path`,
        [...spec.requiredEnv],
      );
  }
}

/**
 * Execute one search against a keyed provider. Retries exactly once on a
 * transient failure (network/timeout/429/5xx) and never on a permanent one.
 */
export async function runProviderSearch(
  provider: ActiveSearchProvider,
  query: string,
  limit: number,
  options: { attempts?: number; backoffMs?: number } = {},
): Promise<SearchResultItem[]> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const backoffMs = options.backoffMs ?? 250;
  const spec = getProviderSpec(provider.kind);
  const request = buildProviderRequest(provider, query, limit);
  const capped = Math.max(1, Math.min(Math.floor(limit) || 5, 10));

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await externalHttpRequest(`search:${spec.kind}`, request.url, {
        method: request.init.method,
        headers: request.init.headers,
        body: request.init.body,
        timeoutMs: 15_000,
      });
      if (!hasRecognizedResultShape(spec.kind, response.json)) {
        // Permanent by nature: retrying an API-shape problem cannot help.
        throw new Error(
          `${spec.label} returned an unrecognized response (no documented results array) — verify the provider API version, plan quota and base URL`,
        );
      }
      return normalizeProviderResults(spec.kind, response.json, capped);
    } catch (error) {
      lastError = error;
      if (attempt < attempts && isRetryableProviderError(error)) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      break;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${spec.label} search failed (${message})`);
}
