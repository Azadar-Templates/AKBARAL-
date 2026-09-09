import { Router } from 'express';
import { listModels, listEnabledProviders } from '../db';
import { PROVIDER_SPECS, modelAvailable, modelRequiredCredential, type ModelSpec } from '../models/catalog';
import { modelRouter, type ModelRequirements } from '../models/router';
import type { ChatMessage } from '../models/client';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { rateLimit } from '../server/middleware/rate-limit';
import { HttpError, asyncRoute } from '../server/http';
import { getBody } from '../server/middleware/validation';

/**
 * Model catalog + routing APIs (Milestone 4).
 *
 *   GET  /api/models            — catalog with honest availability per model
 *   POST /api/models/route      — routing decision preview (no model call)
 *   POST /api/models/chat/stream — real streaming chat over SSE through the router
 *
 * Everything here reports the truth: models whose provider credentials are
 * missing are listed as unavailable with their required env key; a streaming
 * request without any configured provider ends with an honest
 * provider_not_configured error event, never a fake completion.
 */
export function createModelsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', (_req: AuthenticatedRequest, res) => {
    const providerRows = listEnabledProviders() as Array<Record<string, unknown>>;
    const providers = PROVIDER_SPECS.map((spec) => {
      const row = providerRows.find((candidate) => String(candidate.key) === spec.key);
      return {
        key: spec.key,
        name: spec.name,
        type: spec.type,
        envKey: spec.envKey,
        capabilities: spec.capabilities,
        configured: Boolean(process.env[spec.envKey]),
        status: row ? String(row.status) : 'enabled',
      };
    });
    const models = (listModels() as Array<Record<string, unknown>>).map((row) => ({
      key: String(row.key),
      name: String(row.name),
      provider: String(row.provider_key),
      capability: String(row.capability ?? 'llm'),
      contextTokens: row.context_tokens ? Number(row.context_tokens) : null,
      maxOutputTokens: row.max_output_tokens ? Number(row.max_output_tokens) : null,
      costInputPerMillionCents: Number(row.cost_input_per_million_cents ?? 0),
      costOutputPerMillionCents: Number(row.cost_output_per_million_cents ?? 0),
      latencyMs: Number(row.latency_ms ?? 0),
      reliability: Number(row.reliability ?? 0.95),
      isDefault: row.is_default === 1,
      status: String(row.status ?? 'enabled'),
      available:
        String(row.status ?? 'enabled') === 'enabled' &&
        modelAvailable({ key: String(row.key), providerKey: String(row.provider_key) } as ModelSpec),
      requiredEnvKey: modelRequiredCredential({ key: String(row.key), providerKey: String(row.provider_key) } as ModelSpec),
    }));
    res.status(200).json({
      providers,
      models,
      anyProviderConfigured: providers.some((provider) => provider.configured),
    });
  });

  router.post(
    '/route',
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const body = getBody(req);
      const requirements: ModelRequirements = {
        capability: Array.isArray(body.capability)
          ? body.capability.filter((item): item is string => typeof item === 'string')
          : undefined,
        answerQuality:
          body.answerQuality === 'fast' || body.answerQuality === 'balanced' || body.answerQuality === 'high'
            ? body.answerQuality
            : undefined,
        maxCostCents: typeof body.maxCostCents === 'number' ? body.maxCostCents : undefined,
        preferredModelKey: typeof body.preferredModelKey === 'string' ? body.preferredModelKey : null,
      };
      const chain = modelRouter.routeChain(requirements);
      res.status(200).json({
        primary: chain[0] ?? null,
        chain: chain.map((decision) => ({
          modelKey: decision.model.key,
          modelName: decision.model.name,
          provider: decision.providerKey,
          available: decision.available,
          requiredEnvKey: decision.requiredEnvKey,
          reason: decision.reason,
        })),
        modelsConsidered: chain.length,
      });
    }),
  );

  // Real streaming chat over SSE. The router picks the model (or honors an
  // explicit preferred model); tokens stream as `data: {"type":"token",...}`
  // events; the final event carries usage + latency. Failures stream an honest
  // error event and close — the client never receives a fabricated completion.
  router.post(
    '/chat/stream',
    rateLimit({ prefix: 'model-chat-stream', max: 30, windowMs: 60_000 }),
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const body = getBody(req);
      const rawMessages = Array.isArray(body.messages) ? body.messages : [];
      const messages: ChatMessage[] = [];
      for (const raw of rawMessages.slice(0, 40)) {
        if (!raw || typeof raw !== 'object') {
          continue;
        }
        const candidate = raw as { role?: unknown; content?: unknown };
        if (
          (candidate.role === 'user' || candidate.role === 'system' || candidate.role === 'assistant') &&
          typeof candidate.content === 'string' &&
          candidate.content.trim().length > 0
        ) {
          messages.push({ role: candidate.role, content: candidate.content.slice(0, 20_000) });
        }
      }
      if (messages.length === 0) {
        throw new HttpError(400, 'messages must contain at least one {role, content} entry', 'invalid_request');
      }
      const requirements: ModelRequirements = {
        capability: Array.isArray(body.capability)
          ? body.capability.filter((item): item is string => typeof item === 'string')
          : undefined,
        answerQuality:
          body.answerQuality === 'fast' || body.answerQuality === 'balanced' || body.answerQuality === 'high'
            ? body.answerQuality
            : undefined,
        preferredModelKey: typeof body.model === 'string' && body.model.trim().length > 0 ? body.model : null,
      };

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const send = (payload: Record<string, unknown>): void => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      req.on('close', () => {
        /* client disconnect: the awaited provider stream finishes or errors;
           the response object is already closed so writes are no-ops. */
      });

      const chain = modelRouter.routeChain(requirements);
      send({
        type: 'decision',
        model: chain[0]?.model.key ?? null,
        provider: chain[0]?.providerKey ?? null,
        available: chain[0]?.available ?? false,
      });

      try {
        const result = await modelRouter.completeStreaming(requirements, messages, (token) => {
          send({ type: 'token', token });
        });
        send({
          type: 'done',
          model: result.model,
          provider: result.provider,
          inputTokens: result.inputTokens ?? null,
          outputTokens: result.outputTokens ?? null,
          latencyMs: result.latencyMs,
          text: result.text,
        });
      } catch (error) {
        const typed = error as Error & { code?: string; requiredEnvKey?: string };
        send({
          type: 'error',
          code: typed.code ?? 'provider_call_failed',
          message: typed.message,
          requiredEnvKey: typed.requiredEnvKey ?? null,
        });
      }
      res.end();
    }),
  );

  return router;
}
