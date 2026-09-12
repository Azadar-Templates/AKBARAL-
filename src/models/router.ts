import { getModel, listModels, recordModelRun } from '../db';
import { MODEL_SPECS, PROVIDER_SPECS, type ModelSpec } from './catalog';
import { createProvider, streamViaChat, type ChatMessage, type ChatResult } from './client';

export interface ModelRequirements {
  capability?: string[]; // reasoning | coding | vision | speed | long_context | research | image | ...
  answerQuality?: 'fast' | 'balanced' | 'high';
  maxCostCents?: number;
  preferredModelKey?: string | null;
  fallbackModelKeys?: string[];
  taskId?: string | null;
  agentExecutionId?: string | null;
}

export interface RoutingDecision {
  model: ModelSpec;
  providerKey: string;
  available: boolean;
  requiredEnvKey: string | null;
  reason: string;
}

/**
 * Model router.
 *
 * Selects the model most suitable for an agent/task from capability, cost,
 * latency, reliability, health and provider credential availability. Selects a
 * primary + fallback chain, and records every run for cost/latency monitoring.
 */
export class ModelRouter {
  private dbModels(): ModelSpec[] {
    const rows = listModels() as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      return MODEL_SPECS;
    }
    return rows
      .filter((row) => !['disabled', 'retired'].includes(String(row.status ?? 'enabled')))
      .map((row) => ({
      key: String(row.key),
      name: String(row.name),
      providerKey: String(row.provider_key),
      capability: (row.capability as ModelSpec['capability']) ?? 'llm',
      modality: (row.modality as ModelSpec['modality']) ?? 'text',
      contextTokens: row.context_tokens ? Number(row.context_tokens) : undefined,
      maxOutputTokens: row.max_output_tokens ? Number(row.max_output_tokens) : undefined,
      costInputPerMillionCents: Number(row.cost_input_per_million_cents ?? 0),
      costOutputPerMillionCents: Number(row.cost_output_per_million_cents ?? 0),
      costPerImageCents: Number(row.cost_per_image_cents ?? 0),
      latencyMs: Number(row.latency_ms ?? 0),
      reliability: Number(row.reliability ?? 0.95),
      isDefault: row.is_default === 1,
      capabilities: (typeof row.strengths === 'string' ? JSON.parse(row.strengths as string) : []) as string[],
    }));
  }

  private credentialsAvailable(model: ModelSpec): { available: boolean; envKey: string | null } {
    const provider = PROVIDER_SPECS.find((spec) => spec.key === model.providerKey);
    if (!provider) {
      return { available: false, envKey: null };
    }
    return { available: Boolean(process.env[provider.envKey]), envKey: provider.envKey };
  }

  private score(model: ModelSpec, requirements: ModelRequirements): number {
    let score = 0;
    if (requirements.answerQuality === 'high') {
      score += model.capabilities.includes('reasoning') ? 8 : 0;
      score += model.capabilities.includes('coding') ? 3 : 0;
    } else if (requirements.answerQuality === 'fast') {
      score += model.capabilities.includes('speed') ? 8 : 0;
      score -= (model.latencyMs ?? 0) / 1000;
    } else {
      score += model.capabilities.includes('reasoning') ? 4 : 2;
      score += model.capabilities.includes('speed') ? 2 : 0;
      score -= (model.latencyMs ?? 0) / 1000;
    }
    for (const requirement of requirements.capability ?? []) {
      if (model.capabilities.includes(requirement)) {
        score += 5;
      }
    }
    if (model.isDefault) {
      score += 1;
    }
    if (requirements.maxCostCents !== undefined) {
      const estimated = Math.max(model.costInputPerMillionCents ?? 0, model.costOutputPerMillionCents ?? 0);
      if (estimated > requirements.maxCostCents) {
        score -= 100;
      }
    }
    return score;
  }

  route(requirements: ModelRequirements): RoutingDecision {
    const models = this.dbModels().filter((model) => model.capability !== 'embedding');
    const candidates = models.map((model) => ({ model, score: this.score(model, requirements) }));
    candidates.sort((a, b) => b.score - a.score);

    for (const { model } of candidates) {
      if (requirements.preferredModelKey && model.key === requirements.preferredModelKey) {
        const credential = this.credentialsAvailable(model);
        return {
          model,
          providerKey: model.providerKey,
          available: credential.available,
          requiredEnvKey: credential.envKey,
          reason: 'preferred model selected',
        };
      }
    }

    if (candidates.length === 0) {
      throw new Error('no models registered');
    }
    // Prefer the best-scoring model whose provider is actually CONFIGURED.
    // Routing to an unconfigured provider as the primary (only to fall
    // through the chain anyway) reports a misleading "unavailable" decision
    // for every request when a perfectly good provider IS configured.
    // Only when no model is configured at all does the top scorer surface
    // as an honest unavailable decision.
    const firstConfigured = candidates.find(({ model }) => this.credentialsAvailable(model).available);
    const primary = firstConfigured ?? candidates[0];
    const credential = this.credentialsAvailable(primary.model);
    return {
      model: primary.model,
      providerKey: primary.model.providerKey,
      available: credential.available,
      requiredEnvKey: credential.envKey,
      reason: firstConfigured
        ? `scored ${primary.score} for ${requirements.answerQuality ?? 'balanced'} quality (best configured model)`
        : `scored ${primary.score} for ${requirements.answerQuality ?? 'balanced'} quality (no provider configured)`,
    };
  }

  /**
   * When EVERY provider in the chain was unconfigured, the old behavior
   * surfaced only the last chain entry ("openai is not configured…"),
   * misleading users into thinking a single key was missing. The honest
   * error aggregates every required credential.
   */
  private unconfiguredChainError(unconfigured: Array<{ providerKey: string; requiredEnvKey: string | null }>): Error {
    const required = [...new Set(unconfigured.map((d) => d.requiredEnvKey).filter((k): k is string => Boolean(k)))];
    const error = new Error(
      `AI providers are not configured; set at least one of ${required.join(', ')} (provider configuration is server-side only)`,
    ) as Error & { code?: string };
    error.code = 'provider_not_configured';
    return error;
  }

  /**
   * Run a chat completion through the routed primary model, then fall back to
   * the next available model if the provider fails or is not configured.
   */
  async complete(requirements: ModelRequirements, messages: ChatMessage[]): Promise<ChatResult> {
    const primary = this.route(requirements);
    const chain = this.fallbackChain(primary, requirements);

    let lastError: unknown = null;
    // A real provider ATTEMPT failure (auth, outage, block, timeout) is the
    // diagnostic that matters: it must never be masked by a later "not
    // configured" skip for a different provider in the fallback chain.
    let lastAttemptError: unknown = null;
    const unconfigured: Array<{ providerKey: string; requiredEnvKey: string | null }> = [];
    for (const decision of chain) {
      if (!decision.available) {
        const error = new Error(
          `${decision.providerKey} is not configured; set ${decision.requiredEnvKey}`,
        ) as Error & { code?: string; requiredEnvKey?: string };
        error.code = 'provider_not_configured';
        error.requiredEnvKey = decision.requiredEnvKey ?? undefined;
        lastError = error;
        unconfigured.push({ providerKey: decision.providerKey, requiredEnvKey: decision.requiredEnvKey });
        continue;
      }
      const provider = createProvider(decision.providerKey);
      const startedAt = Date.now();
      try {
        const result = await provider.chat(decision.model, messages);
        recordModelRun({
          modelKey: decision.model.key,
          providerKey: decision.providerKey,
          taskId: requirements.taskId ?? null,
          agentExecutionId: requirements.agentExecutionId ?? null,
          status: 'succeeded',
          latencyMs: result.latencyMs,
          inputTokens: result.inputTokens ?? null,
          outputTokens: result.outputTokens ?? null,
          costCents: estimateCost(decision.model, result.inputTokens ?? 0, result.outputTokens ?? 0),
        });
        return result;
      } catch (error) {
        lastError = error;
        lastAttemptError = error;
        recordModelRun({
          modelKey: decision.model.key,
          providerKey: decision.providerKey,
          taskId: requirements.taskId ?? null,
          agentExecutionId: requirements.agentExecutionId ?? null,
          status: 'failed',
          latencyMs: Date.now() - startedAt,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (unconfigured.length === chain.length) {
      throw this.unconfiguredChainError(unconfigured);
    }
    // Prefer the real attempt error: if any configured provider was actually
    // called and failed, that failure is the honest reason this request
    // failed — not the absence of some other provider's key.
    if (lastAttemptError instanceof Error) {
      throw lastAttemptError;
    }
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error('no model available for request');
  }

  /**
   * Full routing decision without executing anything: the primary model plus
   * the ordered fallback chain, each with an honest availability flag. Used by
   * the routing-preview API and diagnostics.
   */
  routeChain(requirements: ModelRequirements): RoutingDecision[] {
    const primary = this.route(requirements);
    return this.fallbackChain(primary, requirements);
  }

  /**
   * Streaming variant of complete(): tokens are forwarded to onToken as the
   * provider emits them (providers without native streaming emit the full text
   * as a single token). Same fallback chain, same run recording.
   */
  async completeStreaming(
    requirements: ModelRequirements,
    messages: ChatMessage[],
    onToken: (token: string) => void,
  ): Promise<ChatResult> {
    const primary = this.route(requirements);
    const chain = this.fallbackChain(primary, requirements);

    let lastError: unknown = null;
    // A real provider ATTEMPT failure (auth, outage, block, timeout) is the
    // diagnostic that matters: it must never be masked by a later "not
    // configured" skip for a different provider in the fallback chain.
    let lastAttemptError: unknown = null;
    const unconfigured: Array<{ providerKey: string; requiredEnvKey: string | null }> = [];
    for (const decision of chain) {
      if (!decision.available) {
        const error = new Error(
          `${decision.providerKey} is not configured; set ${decision.requiredEnvKey}`,
        ) as Error & { code?: string; requiredEnvKey?: string };
        error.code = 'provider_not_configured';
        error.requiredEnvKey = decision.requiredEnvKey ?? undefined;
        lastError = error;
        unconfigured.push({ providerKey: decision.providerKey, requiredEnvKey: decision.requiredEnvKey });
        continue;
      }
      const provider = createProvider(decision.providerKey);
      const startedAt = Date.now();
      try {
        const result = provider.streamChat
          ? await provider.streamChat(decision.model, messages, onToken)
          : await streamViaChat(provider, decision.model, messages, onToken);
        recordModelRun({
          modelKey: decision.model.key,
          providerKey: decision.providerKey,
          taskId: requirements.taskId ?? null,
          agentExecutionId: requirements.agentExecutionId ?? null,
          status: 'succeeded',
          latencyMs: result.latencyMs,
          inputTokens: result.inputTokens ?? null,
          outputTokens: result.outputTokens ?? null,
          costCents: estimateCost(decision.model, result.inputTokens ?? 0, result.outputTokens ?? 0),
        });
        return result;
      } catch (error) {
        lastError = error;
        lastAttemptError = error;
        recordModelRun({
          modelKey: decision.model.key,
          providerKey: decision.providerKey,
          taskId: requirements.taskId ?? null,
          agentExecutionId: requirements.agentExecutionId ?? null,
          status: 'failed',
          latencyMs: Date.now() - startedAt,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (unconfigured.length === chain.length) {
      throw this.unconfiguredChainError(unconfigured);
    }
    // Prefer the real attempt error: if any configured provider was actually
    // called and failed, that failure is the honest reason this request
    // failed — not the absence of some other provider's key.
    if (lastAttemptError instanceof Error) {
      throw lastAttemptError;
    }
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error('no model available for request');
  }

  private fallbackChain(primary: RoutingDecision, requirements: ModelRequirements): RoutingDecision[] {
    const preferred = requirements.fallbackModelKeys ?? [];
    const candidates = this.dbModels()
      .filter((model) => model.capability !== 'embedding')
      .map((model) => ({ model, score: this.score(model, requirements) }))
      .sort((a, b) => b.score - a.score);

    const ordered: ModelSpec[] = [];
    for (const key of preferred) {
      const row = getModel(key);
      if (row) ordered.push(this.toSpec(row as Record<string, unknown>));
    }
    ordered.push(primary.model);
    for (const candidate of candidates) {
      ordered.push(candidate.model);
    }

    // De-dup by key while preserving preference order, then score order.
    const seen = new Set<string>();
    const chain: RoutingDecision[] = [];
    for (const model of ordered) {
      if (seen.has(model.key)) {
        continue;
      }
      seen.add(model.key);
      const credential = this.credentialsAvailable(model);
      chain.push({
        model,
        providerKey: model.providerKey,
        available: credential.available,
        requiredEnvKey: credential.envKey,
        reason: chain.length === 0 ? 'primary chain' : 'fallback chain',
      });
    }
    return chain;
  }

  private toSpec(row: Record<string, unknown>): ModelSpec {
    return {
      key: String(row.key),
      name: String(row.name),
      providerKey: String(row.provider_key),
      capability: 'llm',
      modality: 'text',
      costInputPerMillionCents: Number(row.cost_input_per_million_cents ?? 0),
      costOutputPerMillionCents: Number(row.cost_output_per_million_cents ?? 0),
      costPerImageCents: Number(row.cost_per_image_cents ?? 0),
      latencyMs: Number(row.latency_ms ?? 0),
      reliability: Number(row.reliability ?? 0.95),
      capabilities: [],
    };
  }
}

function estimateCost(model: ModelSpec, inputTokens: number, outputTokens: number): number {
  const inputCents = ((model.costInputPerMillionCents ?? 0) * inputTokens) / 1_000_000;
  const outputCents = ((model.costOutputPerMillionCents ?? 0) * outputTokens) / 1_000_000;
  return Math.ceil(inputCents + outputCents);
}

export const modelRouter = new ModelRouter();
