import { safeProviderErrorMessage } from '../config/secrets';

/**
 * Shared outbound HTTP helper for external providers.
 *
 * Guarantees:
 *   - every call has a timeout (caller can override; default 45s);
 *   - errors never include Authorization headers, API keys in URLs, or the raw
 *     provider response (they may echo request data);
 *   - the caller receives a typed ExternalHttpError with a provider-safe message.
 */

export interface ExternalHttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  timeoutMs?: number;
}

export interface ExternalHttpResult {
  status: number;
  text: string;
  json: Record<string, unknown>;
}

export class ExternalHttpError extends Error {
  readonly code = 'external_provider_error';
  readonly status?: number;
  constructor(providerKey: string, message: string, status?: number) {
    super(message);
    this.name = 'ExternalHttpError';
    this.status = status;
    this.providerKey = providerKey;
  }
  readonly providerKey: string;
}

export async function externalHttpRequest(
  providerKey: string,
  url: string,
  options: ExternalHttpOptions = {},
): Promise<ExternalHttpResult> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 45_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: typeof options.body === 'string' ? options.body : options.body?.toString(),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new ExternalHttpError(
        providerKey,
        safeProviderErrorMessage(providerKey, response.status, text),
        response.status,
      );
    }
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { status: response.status, text, json };
  } catch (error) {
    if (error instanceof ExternalHttpError) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    // Never expose the URL here; it can contain an API key (e.g. Gemini).
    throw new ExternalHttpError(providerKey, `${providerKey} request failed (${reason})`);
  } finally {
    clearTimeout(timeout);
  }
}
