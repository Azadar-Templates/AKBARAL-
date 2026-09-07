import { PROVIDER_SPECS, type ModelSpec } from './catalog';
import { externalHttpRequest, ExternalHttpError } from '../integrations/http';

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

  constructor(providerKey: string, message: string, status?: number) {
    super(message);
    this.providerKey = providerKey;
    this.status = status;
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
}

function resolveProviderSpec(key: string) {
  const spec = PROVIDER_SPECS.find((provider) => provider.key === key);
  if (!spec) {
    throw new Error(`unknown provider ${key}`);
  }
  return spec;
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
      timeoutMs: 60_000,
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
      `${spec.baseUrl}/chat/completions`,
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
      `${spec.baseUrl}/messages`,
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
    const { json } = await runJsonRequest(
      this.key,
      `${spec.baseUrl}/models/${model.key}:generateContent?key=${apiKey}`,
      { 'Content-Type': 'application/json' },
      { contents, systemInstruction: system ? { parts: [{ text: system }] } : undefined },
    );
    const candidates = json.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
    const text = candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
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
