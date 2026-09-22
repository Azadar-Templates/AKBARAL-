/**
 * OmniRoute Gateway — private sidecar provider.
 *
 * - Binds ONLY to 127.0.0.1:20128 (never public). AKBARAL_ALLOW_PRIVATE_PROVIDER=1 required to allow non-loopback.
 * - OpenAI-compatible /chat/completions at OMNIROUTE_BASE_URL default http://127.0.0.1:20128/v1
 * - Requires OMNIROUTE_API_KEY (generated locally when self-hosting OmniRoute, stored encrypted in vault).
 * - Enabled via OMNIROUTE_ENABLED=1 or auto when key present (see env.ts).
 * - Quota: per-agent daily token budget (default 100K), RPM limit default 10, monthly cost cents default 500.
 * - Provides fallback/routing/telemetry compression Dashboard; does NOT replace direct provider accounts or mission wallet.
 *
 * Security: private bind check, API key never returned, ToS compliance note.
 */

import { env } from '../config/env';
import type { ModelSpec } from './catalog';
import type { ModelProvider, ChatMessage, ChatResult } from './client';

function privateBindOk(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return true;
    if (process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER === '1') return true;
    return false;
  } catch {
    return false;
  }
}

export function omnirouteBaseUrl(): string {
  return env.omnirouteBaseUrl || 'http://127.0.0.1:20128/v1';
}

export function omnirouteDashboardUrl(): string {
  const base = omnirouteBaseUrl().replace(/\/v1\/?$/, '');
  return `${base}/dashboard`;
}

export function omnirouteApiKey(): string | null {
  return env.omnirouteApiKey || null;
}

export function isOmnirouteConfigured(): boolean {
  return Boolean(omnirouteApiKey());
}

export function omnirouteEnabled(): boolean {
  return Boolean(env.omnirouteEnabled) || isOmnirouteConfigured();
}

export function omnirouteModelAuto(): string {
  return env.omnirouteModelAuto || 'auto';
}

// --- In-memory quota buckets ---

interface Bucket {
  tokensToday: number;
  costCentsToday: number;
  costCentsMonth: number;
  requestsMinute: number[];
  lastResetDay: string; // YYYY-MM-DD
  lastResetMonth: string; // YYYY-MM
}

const buckets = new Map<string, Bucket>(); // key = agentId or 'global'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthStr(): string {
  return new Date().toISOString().slice(0, 7);
}

function getBucket(agentId: string | null): Bucket {
  const key = agentId ?? 'global';
  let b = buckets.get(key);
  if (!b) {
    b = {
      tokensToday: 0,
      costCentsToday: 0,
      costCentsMonth: 0,
      requestsMinute: [],
      lastResetDay: todayStr(),
      lastResetMonth: monthStr(),
    };
    buckets.set(key, b);
  }
  // Reset daily
  const today = todayStr();
  if (b.lastResetDay !== today) {
    b.tokensToday = 0;
    b.costCentsToday = 0;
    b.requestsMinute = [];
    b.lastResetDay = today;
  }
  const month = monthStr();
  if (b.lastResetMonth !== month) {
    b.costCentsMonth = 0;
    b.lastResetMonth = month;
  }
  // Prune requests older than 60s
  const now = Date.now();
  b.requestsMinute = b.requestsMinute.filter((ts) => now - ts < 60_000);
  return b;
}

export function checkOmnirouteQuota(agentId: string | null): { allowed: boolean; reason?: string } {
  if (!isOmnirouteConfigured()) {
    return { allowed: false, reason: 'omniroute not configured (OMNIROUTE_API_KEY missing)' };
  }
  if (!privateBindOk(omnirouteBaseUrl())) {
    return { allowed: false, reason: `omniroute base URL must be private (127.0.0.1) unless AKBARAL_ALLOW_PRIVATE_PROVIDER=1 — got ${omnirouteBaseUrl()}` };
  }
  const bucket = getBucket(agentId);
  const dailyBudget = env.omnirouteDailyTokenBudget ?? 100_000;
  if (bucket.tokensToday >= dailyBudget) {
    return { allowed: false, reason: `omniroute daily token budget exceeded (${bucket.tokensToday}/${dailyBudget})` };
  }
  const rpm = env.omnirouteRateLimitRpm ?? 10;
  if (bucket.requestsMinute.length >= rpm) {
    return { allowed: false, reason: `omniroute RPM limit exceeded (${bucket.requestsMinute.length}/${rpm})` };
  }
  const monthlyCents = env.omnirouteMonthlyCostCents ?? 500;
  if (bucket.costCentsMonth >= monthlyCents) {
    return { allowed: false, reason: `omniroute monthly cost limit exceeded (${bucket.costCentsMonth}/${monthlyCents} cents)` };
  }
  return { allowed: true };
}

export function recordOmnirouteUsage(params: {
  agentId: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costCents?: number;
}): void {
  const bucket = getBucket(params.agentId);
  const tokens = (params.inputTokens ?? 0) + (params.outputTokens ?? 0);
  bucket.tokensToday += tokens;
  bucket.costCentsToday += params.costCents ?? 0;
  bucket.costCentsMonth += params.costCents ?? 0;
  bucket.requestsMinute.push(Date.now());
}

export function getOmnirouteQuotaStatus(agentId: string | null): {
  tokensToday: number;
  dailyBudget: number;
  costCentsToday: number;
  costCentsMonth: number;
  monthlyBudget: number;
  rpmUsed: number;
  rpmLimit: number;
} {
  const bucket = getBucket(agentId);
  return {
    tokensToday: bucket.tokensToday,
    dailyBudget: env.omnirouteDailyTokenBudget ?? 100_000,
    costCentsToday: bucket.costCentsToday,
    costCentsMonth: bucket.costCentsMonth,
    monthlyBudget: env.omnirouteMonthlyCostCents ?? 500,
    rpmUsed: bucket.requestsMinute.length,
    rpmLimit: env.omnirouteRateLimitRpm ?? 10,
  };
}

export function omnirouteStatus(): {
  enabled: boolean;
  configured: boolean;
  baseUrl: string;
  dashboardUrl: string;
  modelAuto: string;
  privateBind: boolean;
  privateBindNote: string;
  requiredEnv: string[];
  optionalEnv: string[];
  quota: ReturnType<typeof getOmnirouteQuotaStatus>;
  tosNote: string;
} {
  const base = omnirouteBaseUrl();
  return {
    enabled: omnirouteEnabled(),
    configured: isOmnirouteConfigured(),
    baseUrl: base,
    dashboardUrl: omnirouteDashboardUrl(),
    modelAuto: omnirouteModelAuto(),
    privateBind: privateBindOk(base),
    privateBindNote: 'OmniRoute gateway must bind 127.0.0.1:20128 only, never public. Set AKBARAL_ALLOW_PRIVATE_PROVIDER=1 to allow private network override.',
    requiredEnv: ['OMNIROUTE_API_KEY (when sidecar enabled)'],
    optionalEnv: ['OMNIROUTE_BASE_URL', 'OMNIROUTE_ENABLED', 'OMNIROUTE_DAILY_TOKEN_BUDGET', 'OMNIROUTE_MONTHLY_COST_CENTS', 'OMNIROUTE_RATE_LIMIT_RPM', 'OMNIROUTE_MODEL_AUTO'],
    quota: getOmnirouteQuotaStatus(null),
    tosNote: 'OmniRoute aggregates existing provider free tiers; operator must ensure upstream ToS allows proxy/gateway usage. Do not use if prohibited.',
  };
}

/** Reset buckets for tests */
export function _resetOmnirouteBuckets(): void {
  buckets.clear();
}

export class OmniRouteProvider implements ModelProvider {
  readonly key = 'omniroute';

  private baseUrl(): string {
    const base = omnirouteBaseUrl();
    if (!privateBindOk(base)) {
      throw new Error(`OmniRoute base URL must be private (127.0.0.1) unless AKBARAL_ALLOW_PRIVATE_PROVIDER=1 — got ${base}`);
    }
    return base.replace(/\/$/, '');
  }

  private apiKey(): string {
    const key = omnirouteApiKey();
    if (!key) throw new Error('OMNIROUTE_API_KEY is not set');
    return key;
  }

  async chat(model: ModelSpec, messages: ChatMessage[]): Promise<ChatResult> {
    const started = Date.now();
    const modelId = model.key === 'auto' ? omnirouteModelAuto() : model.key;

    const res = await fetch(`${this.baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey()}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OmniRoute ${res.status}: ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const content = json.choices?.[0]?.message?.content ?? '';
    return {
      text: content,
      model: model.key,
      provider: this.key,
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - started,
    };
  }

  async streamChat(model: ModelSpec, messages: ChatMessage[], onToken: (t: string) => void): Promise<ChatResult> {
    // Fallback to non-streaming then emit as single token (simple, keeps compatibility)
    const result = await this.chat(model, messages);
    onToken(result.text);
    return result;
  }
}
