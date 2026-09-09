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

/**
 * Streaming variant for SSE-style provider endpoints (chat streaming).
 *
 * POSTs and consumes the response incrementally, invoking `onData` for every
 * `data:` line payload (the `[DONE]` sentinel is forwarded; parsing the JSON is
 * the caller's job). Guarantees match externalHttpRequest: mandatory timeout,
 * redacted errors, typed ExternalHttpError. The timeout resets on every chunk
 * so slow streams are bounded per-chunk, not per-response.
 */
export async function externalStreamingRequest(
  providerKey: string,
  url: string,
  options: ExternalHttpOptions & { onData: (data: string) => void; chunkTimeoutMs?: number },
): Promise<{ status: number }> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;
  const armTimeout = (): void => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => controller.abort(), options.chunkTimeoutMs ?? 30_000);
  };
  try {
    armTimeout();
    const response = await fetch(url, {
      method: options.method ?? 'POST',
      headers: options.headers,
      body: typeof options.body === 'string' ? options.body : options.body?.toString(),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new ExternalHttpError(
        providerKey,
        safeProviderErrorMessage(providerKey, response.status, text),
        response.status,
      );
    }
    if (!response.body) {
      throw new ExternalHttpError(providerKey, 'provider returned an empty stream body');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      armTimeout();
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith('data:')) {
          options.onData(line.slice(5).trim());
        }
        newlineIndex = buffer.indexOf('\n');
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith('data:')) {
      options.onData(tail.slice(5).trim());
    }
    return { status: response.status };
  } catch (error) {
    if (error instanceof ExternalHttpError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'network error';
    throw new ExternalHttpError(providerKey, message === 'This operation was aborted' ? 'stream timed out' : message);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
