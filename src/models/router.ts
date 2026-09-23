import { getModel, listModels, recordModelRun } from '../db';
import { MODEL_SPECS, PROVIDER_SPECS, type ModelSpec } from './catalog';
import { createProvider, streamViaChat, type ChatMessage, type ChatResult } from './client';
import { omnirouteEnabled, isOmnirouteConfigured, checkOmnirouteQuota, recordOmnirouteUsage } from './omniroute';

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
 *
 * OmniRoute integration: when OMNIROUTE_ENABLED=1 and OMNIROUTE_API_KEY set,
 * gateway is preferred (private 127.0.0.1:20128, never public). Quota-aware
 * fallback, cost controls, telemetry preserved. Direct providers remain as
 * fallback — never removed.
 *
 * Resilience (fix for "AI took too long to respond"):
 *   - Overall chain timeout (configurable via env) prevents indefinite waiting
 *   - Streaming with per-chunk timeout
 *   - Clear user-friendly error after all fallbacks exhausted
 *   - Long-running queue tasks continue in background, HTTP returns 202 quickly
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
    if (omnirouteEnabled() && isOmnirouteConfigured() && model.providerKey === 'omniroute') {
      score += 10;
      if (model.key === 'auto') score += 5;
      if (model.capabilities.includes('fallback')) score += 2;
      if (model.capabilities.includes('quota-aware')) score += 2;
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

  private unconfiguredChainError(unconfigured: Array<{ providerKey: string; requiredEnvKey: string | null }>): Error {
    const required = [...new Set(unconfigured.map((d) => d.requiredEnvKey).filter((k): k is string => Boolean(k)))];
    const error = new Error(
      `AI providers are not configured; set at least one of ${required.join(', ')} (provider configuration is server-side only)`,
    ) as Error & { code?: string };
    error.code = 'provider_not_configured';
    return error;
  }

  private overallTimeoutMs(): number {
    try {
      const { env } = require('../config/env') as { env: { providerTimeoutMs: number; executionStepTimeoutMs: number } };
      const providerMs = env?.providerTimeoutMs ?? 60_000;
      const stepMs = env?.executionStepTimeoutMs ?? 120_000;
      return Math.min(providerMs * 3 + 10_000, stepMs);
    } catch {
      return 120_000;
    }
  }

  private chainExhaustedError(lastError: unknown, attempted: string[]): Error {
    const attemptedList = attempted.join(', ') || 'no providers attempted';
    const reason = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error');
    const error = new Error(
      `All AI providers failed after trying: ${attemptedList}. Last error: ${reason}. The task was retried with fallback and then stopped honestly — your free task credit was refunded. Try again shortly or check provider configuration.`,
    ) as Error & { code?: string; attemptedProviders?: string[] };
    error.code = (lastError as { code?: string })?.code ?? 'provider_chain_exhausted';
    error.attemptedProviders = attempted;
    return error;
  }

  async complete(requirements: ModelRequirements, messages: ChatMessage[]): Promise<ChatResult> {
    const primary = this.route(requirements);
    const chain = this.fallbackChain(primary, requirements);
    const overallTimeout = this.overallTimeoutMs();
    const overallDeadline = Date.now() + overallTimeout;

    let lastError: unknown = null;
    let lastAttemptError: unknown = null;
    const unconfigured: Array<{ providerKey: string; requiredEnvKey: string | null }> = [];
    const attempted: string[] = [];
    for (const decision of chain) {
      if (Date.now() > overallDeadline) {
        const timeoutErr = new Error(`AI provider chain timed out after ${overallTimeout}ms (attempted: ${attempted.join(', ')})`) as Error & { code?: string };
        timeoutErr.code = 'timeout';
        lastError = timeoutErr;
        lastAttemptError = timeoutErr;
        break;
      }

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

      if (decision.providerKey === 'omniroute') {
        const quota = checkOmnirouteQuota(requirements.agentExecutionId ?? null);
        if (!quota.allowed) {
          const qError = new Error(quota.reason ?? 'omniroute quota exceeded') as Error & { code?: string };
          qError.code = 'quota_exceeded';
          lastError = qError;
          continue;
        }
      }

      attempted.push(`${decision.providerKey}/${decision.model.key}`);
      const provider = createProvider(decision.providerKey);
      const startedAt = Date.now();
      try {
        const result = await provider.chat(decision.model, messages);
        const costCents = estimateCost(decision.model, result.inputTokens ?? 0, result.outputTokens ?? 0);
        if (decision.providerKey === 'omniroute') {
          recordOmnirouteUsage({
            agentId: requirements.agentExecutionId ?? null,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costCents,
          });
        }
        recordModelRun({
          modelKey: decision.model.key,
          providerKey: decision.providerKey,
          taskId: requirements.taskId ?? null,
          agentExecutionId: requirements.agentExecutionId ?? null,
          status: 'succeeded',
          latencyMs: result.latencyMs,
          inputTokens: result.inputTokens ?? null,
          outputTokens: result.outputTokens ?? null,
          costCents,
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
    if (attempted.length > 0) {
      throw this.chainExhaustedError(lastAttemptError ?? lastError, attempted);
    }
    if (lastAttemptError instanceof Error) {
      throw lastAttemptError;
    }
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error('no model available for request');
  }

  routeChain(requirements: ModelRequirements): RoutingDecision[] {
    const primary = this.route(requirements);
    return this.fallbackChain(primary, requirements);
  }

  async completeStreaming(
    requirements: ModelRequirements,
    messages: ChatMessage[],
    onToken: (token: string) => void,
  ): Promise<ChatResult> {
    const primary = this.route(requirements);
    const chain = this.fallbackChain(primary, requirements);
    const overallTimeout = this.overallTimeoutMs();
    const overallDeadline = Date.now() + overallTimeout;

    let lastError: unknown = null;
    let lastAttemptError: unknown = null;
    const unconfigured: Array<{ providerKey: string; requiredEnvKey: string | null }> = [];
    const attempted: string[] = [];
    for (const decision of chain) {
      if (Date.now() > overallDeadline) {
        const timeoutErr = new Error(`AI provider streaming chain timed out after ${overallTimeout}ms (attempted: ${attempted.join(', ')})`) as Error & { code?: string };
        timeoutErr.code = 'timeout';
        lastError = timeoutErr;
        lastAttemptError = timeoutErr;
        break;
      }

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

      if (decision.providerKey === 'omniroute') {
        const quota = checkOmnirouteQuota(requirements.agentExecutionId ?? null);
        if (!quota.allowed) {
          const qError = new Error(quota.reason ?? 'omniroute quota exceeded') as Error & { code?: string };
          qError.code = 'quota_exceeded';
          lastError = qError;
          continue;
        }
      }

      attempted.push(`${decision.providerKey}/${decision.model.key}`);
      const provider = createProvider(decision.providerKey);
      const startedAt = Date.now();
      try {
        const result = provider.streamChat
          ? await provider.streamChat(decision.model, messages, onToken)
          : await streamViaChat(provider, decision.model, messages, onToken);
        const costCents = estimateCost(decision.model, result.inputTokens ?? 0, result.outputTokens ?? 0);
        if (decision.providerKey === 'omniroute') {
          recordOmnirouteUsage({
            agentId: requirements.agentExecutionId ?? null,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costCents,
          });
        }
        recordModelRun({
          modelKey: decision.model.key,
          providerKey: decision.providerKey,
          taskId: requirements.taskId ?? null,
          agentExecutionId: requirements.agentExecutionId ?? null,
          status: 'succeeded',
          latencyMs: result.latencyMs,
          inputTokens: result.inputTokens ?? null,
          outputTokens: result.outputTokens ?? null,
          costCents,
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
    if (attempted.length > 0) {
      throw this.chainExhaustedError(lastAttemptError ?? lastError, attempted);
    }
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
