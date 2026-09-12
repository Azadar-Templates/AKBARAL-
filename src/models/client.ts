import { PROVIDER_SPECS, type ModelSpec } from './catalog';
import { externalHttpRequest, externalStreamingRequest, ExternalHttpError } from '../integrations/http';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ChatResult {
  text: string;
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
}

export class ProviderNotConfiguredError extends Error {
  readonly code = 'provider_not_configured';
  readonly requiredEnvKey: string;
  readonly providerKey: string;

  constructor(providerKey: string, requiredEnvKey: string) {
    super(`${providerKey} requires credential environment variable ${requiredEnvKey}`);
    this.providerKey = providerKey;
    this.requiredEnvKey = requiredEnvKey;
  }
}

export class ProviderCallError extends Error {
  readonly code = 'provider_call_failed';
  readonly providerKey: string;
  readonly status?: number;
  /**
   * Whether a retry can plausibly succeed: rate limits, provider 5xx and
   * network/timeout failures are transient; 4xx (auth, bad request, not
   * found) are permanent and must not burn the retry budget.
   */
  readonly retryable: boolean;

  constructor(providerKey: string, message: string, status?: number, options?: { retryable?: boolean }) {
    super(message);
    this.providerKey = providerKey;
    this.status = status;
    this.retryable =
      options?.retryable ?? (status === undefined || status === 408 || status === 429 || status >= 500);
  }
}

/**
 * Provider abstraction. Every concrete provider implements this interface; the
 * model router chooses the right provider per task. New providers only need to
 * add a spec + adapter, not agent changes.
 */
export interface ModelProvider {
  readonly key: string;
  chat(model: ModelSpec, messages: ChatMessage[]): Promise<ChatResult>;
  /**
   * Native streaming variant. Providers that support SSE streaming override
   * this; the default falls back to a single-shot chat and emits the complete
   * text as one token so callers always observe the same interface.
   */
  streamChat?(model: ModelSpec, messages: ChatMessage[], onToken: (token: string) => void): Promise<ChatResult>;
}

/** Default streaming implementation: one chat call, one token event. */
export async function streamViaChat(
  provider: ModelProvider,
  model: ModelSpec,
  messages: ChatMessage[],
  onToken: (token: string) => void,
): Promise<ChatResult> {
  const result = await provider.chat(model, messages);
  if (result.text) {
    onToken(result.text);
  }
  return result;
}

function resolveProviderSpec(key: string) {
  const spec = PROVIDER_SPECS.find((provider) => provider.key === key);
  if (!spec) {
    throw new Error(`unknown provider ${key}`);
  }
  return spec;
}

/**
 * Resolve a provider base URL. Env overrides (`<PROVIDER>_BASE_URL`, e.g.
 * OPENAI_BASE_URL) allow enterprise proxies, Azure-style gateways and
 * self-hosted OpenAI-compatible endpoints without code changes.
 */
/**
 * Per-request provider timeout. Default 60s; operators (and the timeout
 * regression test) can override via AKBARAL_PROVIDER_TIMEOUT_MS (min 1s so a
 * misconfiguration cannot disable the timeout entirely).
 */
function providerTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.AKBARAL_PROVIDER_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 60_000;
}

function resolveBaseUrl(spec: { key: string; baseUrl?: string }): string {
  const override = process.env[`${spec.key.toUpperCase()}_BASE_URL`];
  const base = (override && override.trim()) || spec.baseUrl;
  if (!base) {
    throw new Error(`provider ${spec.key} has no base URL configured`);
  }
  return base.replace(/\/+$/, '');
}

async function runJsonRequest(
  key: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  try {
    const result = await externalHttpRequest(key, url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      timeoutMs: providerTimeoutMs(),
    });
    return { status: result.status, json: result.json };
  } catch (error) {
    if (error instanceof ExternalHttpError) {
      throw new ProviderCallError(key, error.message, error.status);
    }
    throw new ProviderCallError(key, error instanceof Error ? error.message : 'network error');
  }
}

/** OpenAI-compatible chat completions adapter (OpenAI, Azure-style, local servers). */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly key = 'openai';

  async chat(model: ModelSpec, messages: ChatMessage[]): Promise<ChatResult> {
    const spec = resolveProviderSpec(this.key);
    const apiKey = process.env[spec.envKey];
    if (!apiKey) {
      throw new ProviderNotConfiguredError(this.key, spec.envKey);
    }
    const started = Date.now();
    const { json } = await runJsonRequest(
      this.key,
      `${resolveBaseUrl(spec)}/chat/completions`,
      {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      {
        model: model.key,
        messages,
      },
    );
    const choices = json.choices as Array<{ message?: { content?: string } }> | undefined;
    const text = choices?.[0]?.message?.content ?? '';
    const usage = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    return {
      text,
      model: model.key,
      provider: this.key,
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
      latencyMs: Date.now() - started,
    };
  }

  async streamChat(model: ModelSpec, messages: ChatMessage[], onToken: (token: string) => void): Promise<ChatResult> {
    const spec = resolveProviderSpec(this.key);
    const apiKey = process.env[spec.envKey];
    if (!apiKey) {
      throw new ProviderNotConfiguredError(this.key, spec.envKey);
    }
    const started = Date.now();
    let text = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    try {
      await externalStreamingRequest(
        this.key,
        `${resolveBaseUrl(spec)}/chat/completions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({ model: model.key, messages, stream: true }),
          onData: (data) => {
            if (!data || data === '[DONE]') {
              return;
            }
            try {
              const chunk = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number };
              };
              const token = chunk.choices?.[0]?.delta?.content ?? '';
              if (token) {
                text += token;
                onToken(token);
              }
              if (chunk.usage) {
                inputTokens = chunk.usage.prompt_tokens;
                outputTokens = chunk.usage.completion_tokens;
              }
            } catch {
              // Ignore malformed keep-alive chunks; the provider contract is
              // best-effort per chunk, terminal state is decided by the caller.
            }
          },
        },
      );
    } catch (error) {
      if (error instanceof ExternalHttpError) {
        throw new ProviderCallError(this.key, error.message, error.status);
      }
      throw error;
    }
    return {
      text,
      model: model.key,
      provider: this.key,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
    };
  }
}

/** Anthropic Messages API adapter. */
export class AnthropicProvider implements ModelProvider {
  readonly key = 'anthropic';

  async chat(model: ModelSpec, messages: ChatMessage[]): Promise<ChatResult> {
    const spec = resolveProviderSpec(this.key);
    const apiKey = process.env[spec.envKey];
    if (!apiKey) {
      throw new ProviderNotConfiguredError(this.key, spec.envKey);
    }
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');
    const rest = messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content }));

    const started = Date.now();
    const { json } = await runJsonRequest(
      this.key,
      `${resolveBaseUrl(spec)}/messages`,
      {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      {
        model: model.key,
        max_tokens: model.maxOutputTokens ?? 4096,
        system: system || undefined,
        messages: rest,
      },
    );
    const content = json.content as Array<{ type: string; text?: string }> | undefined;
    const text = content?.map((item) => (item.type === 'text' ? item.text ?? '' : '')).join('\n') ?? '';
    const usage = json.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    return {
      text,
      model: model.key,
      provider: this.key,
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
      latencyMs: Date.now() - started,
    };
  }

  async streamChat(model: ModelSpec, messages: ChatMessage[], onToken: (token: string) => void): Promise<ChatResult> {
    const spec = resolveProviderSpec(this.key);
    const apiKey = process.env[spec.envKey];
    if (!apiKey) {
      throw new ProviderNotConfiguredError(this.key, spec.envKey);
    }
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');
    const rest = messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content }));
    const started = Date.now();
    let text = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    try {
      await externalStreamingRequest(
        this.key,
        `${resolveBaseUrl(spec)}/messages`,
        {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            model: model.key,
            max_tokens: model.maxOutputTokens ?? 4096,
            system: system || undefined,
            messages: rest,
            stream: true,
          }),
          onData: (data) => {
            if (!data) {
              return;
            }
            try {
              const event = JSON.parse(data) as {
                type?: string;
                delta?: { type?: string; text?: string };
                message?: { usage?: { input_tokens?: number; output_tokens?: number } };
                usage?: { input_tokens?: number; output_tokens?: number };
              };
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
                text += event.delta.text;
                onToken(event.delta.text);
              }
              if (event.type === 'message_start' && event.message?.usage) {
                inputTokens = event.message.usage.input_tokens;
              }
              if (event.type === 'message_delta' && event.usage) {
                outputTokens = event.usage.output_tokens;
              }
            } catch {
              // Ignore malformed keep-alive events.
            }
          },
        },
      );
    } catch (error) {
      if (error instanceof ExternalHttpError) {
        throw new ProviderCallError(this.key, error.message, error.status);
      }
      throw error;
    }
    return {
      text,
      model: model.key,
      provider: this.key,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
    };
  }
}

/** Google Generative Language adapter (Gemini). */
export class GoogleProvider implements ModelProvider {
  readonly key = 'google';

  async chat(model: ModelSpec, messages: ChatMessage[]): Promise<ChatResult> {
    const spec = resolveProviderSpec(this.key);
    const apiKey = process.env[spec.envKey];
    if (!apiKey) {
      throw new ProviderNotConfiguredError(this.key, spec.envKey);
    }
    const contents = messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }));
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');

    const started = Date.now();
    // The API key travels in the x-goog-api-key HEADER, never in the URL —
    // URLs can leak into logs; headers do not.
    const { json } = await runJsonRequest(
      this.key,
      `${resolveBaseUrl(spec)}/models/${model.key}:generateContent`,
      { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      { contents, systemInstruction: system ? { parts: [{ text: system }] } : undefined },
    );
    const candidates = json.candidates as Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> | undefined;
    const blockReason = (json.promptFeedback as { blockReason?: string } | undefined)?.blockReason;
    if (blockReason) {
      // Honest, explicit failure: a safety-blocked request must never surface
      // as a silently-empty output that later fails verification confusingly.
      // Safety blocks are deterministic — retrying cannot help.
      throw new ProviderCallError(
        this.key,
        `google blocked the request (promptFeedback.blockReason: ${blockReason})`,
        undefined,
        { retryable: false },
      );
    }
    const text = candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
    const finishReason = candidates?.[0]?.finishReason;
    if (!text && candidates && finishReason && finishReason !== 'STOP') {
      const retryable = finishReason === 'MAX_TOKENS' || finishReason === 'RECITATION';
      throw new ProviderCallError(
        this.key,
        `google returned no content (finishReason: ${finishReason})`,
        undefined,
        { retryable },
      );
    }
    const usage = json.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
    return {
      text,
      model: model.key,
      provider: this.key,
      inputTokens: usage?.promptTokenCount,
      outputTokens: usage?.candidatesTokenCount,
      latencyMs: Date.now() - started,
    };
  }

  async streamChat(model: ModelSpec, messages: ChatMessage[], onToken: (token: string) => void): Promise<ChatResult> {
    const spec = resolveProviderSpec(this.key);
    const apiKey = process.env[spec.envKey];
    if (!apiKey) {
      throw new ProviderNotConfiguredError(this.key, spec.envKey);
    }
    const contents = messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }));
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');
    const started = Date.now();
    let text = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    try {
      await externalStreamingRequest(
        this.key,
        `${resolveBaseUrl(spec)}/models/${model.key}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents,
            systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          }),
          onData: (data) => {
            if (!data) {
              return;
            }
            try {
              const chunk = JSON.parse(data) as {
                candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
                usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
              };
              const token = chunk.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
              if (token) {
                text += token;
                onToken(token);
              }
              if (chunk.usageMetadata) {
                inputTokens = chunk.usageMetadata.promptTokenCount;
                outputTokens = chunk.usageMetadata.candidatesTokenCount;
              }
            } catch {
              // Ignore malformed keep-alive chunks.
            }
          },
        },
      );
    } catch (error) {
      if (error instanceof ExternalHttpError) {
        throw new ProviderCallError(this.key, error.message, error.status);
      }
      throw error;
    }
    return {
      text,
      model: model.key,
      provider: this.key,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
    };
  }
}

export function createProvider(key: string): ModelProvider {
  switch (key) {
    case 'openai':
      return new OpenAICompatibleProvider();
    case 'anthropic':
      return new AnthropicProvider();
    case 'google':
      return new GoogleProvider();
    default:
      throw new Error(`model provider "${key}" is not implemented`);
  }
}
