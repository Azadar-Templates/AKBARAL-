import { decryptCredential } from '../auth';
import { appendMissionAudit, missionDb, missionId, nowIso, type Row } from '../database';
import { assertInScope } from './bug-bounty-system';

/**
 * Mission model control plane. Secrets are resolved only in-process from the
 * encrypted mission vault. This module never accepts an API key as input and
 * never returns a decrypted credential. Every provider request requires the
 * caller's configured bounty program and target so the absolute scope gate is
 * reached immediately before every outbound attempt, including retries.
 */

export type ModelHealthStatus = 'unknown' | 'ok' | 'rate_limited' | 'unauthorized' | 'quota_exceeded' | 'timeout' | 'error';
export type ModelCallStatus = 'succeeded' | 'failed' | 'blocked' | 'fallback';
export type ModelRole = string;

export interface ModelScopeContext { programId: string; target: string; agentType?: string; runId?: string }
export interface JsonSchema { type?: string; required?: string[]; properties?: Record<string, JsonSchema>; items?: JsonSchema; enum?: unknown[] }
export interface ModelGenerateRequest {
  model?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxOutputTokens?: number;
  roleKey?: ModelRole;
  scope: ModelScopeContext;
  jsonSchema?: JsonSchema;
}
export interface ModelGenerateResult {
  providerKey: string;
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  fallbackFrom?: string;
}
export interface ModelStructuredResult<T> extends ModelGenerateResult { value: T }

export interface ModelClient {
  generate(request: ModelGenerateRequest): Promise<ModelGenerateResult>;
  generateStructured<T>(request: Omit<ModelGenerateRequest, 'jsonSchema'> & { jsonSchema: JsonSchema }): Promise<ModelStructuredResult<T>>;
  streamGenerate(request: ModelGenerateRequest, onToken: (token: string) => void): Promise<ModelGenerateResult>;
}

export interface ModelProviderPublic {
  id: string; providerKey: string; displayName: string; baseUrl: string; credentialVaultKey: string;
  modelsAvailable: string[]; defaultModel: string; priority: number; costPer1kIn: number; costPer1kOut: number;
  maxConcurrency: number; rateLimitPerMin: number; healthStatus: ModelHealthStatus; lastHealthCheckAt: string | null;
  enabled: boolean; supportsJsonSchema: boolean;
}

export interface ModelProviderInput {
  providerKey: string; displayName: string; baseUrl: string; credentialVaultKey: string; modelsAvailable: string[];
  defaultModel: string; priority?: number; costPer1kIn?: number; costPer1kOut?: number; maxConcurrency?: number;
  rateLimitPerMin?: number; enabled?: boolean; supportsJsonSchema?: boolean;
}

export class ModelLayerError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 409) { super(message); }
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) throw new ModelLayerError('invalid_input', `${name} is required and bounded`, 400);
  return value.trim();
}
function int(value: unknown, name: string, min: number, max: number, fallback?: number): number {
  const n = value === undefined && fallback !== undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new ModelLayerError('invalid_input', `${name} is invalid`, 400);
  return n;
}
function decimal(value: unknown, name: string, min: number, max: number, fallback?: number): number {
  const n = value === undefined && fallback !== undefined ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new ModelLayerError('invalid_input', `${name} is invalid`, 400);
  return n;
}
function parse(value: unknown, fallback: any): any { try { return JSON.parse(String(value ?? '')); } catch { return fallback; } }
function publicProvider(row: Row): ModelProviderPublic {
  return {
    id: String(row.id), providerKey: String(row.provider_key), displayName: String(row.display_name), baseUrl: String(row.base_url),
    credentialVaultKey: String(row.credential_vault_key), modelsAvailable: parse(row.models_available_json, []), defaultModel: String(row.default_model),
    priority: Number(row.priority), costPer1kIn: Number(row.cost_per_1k_in), costPer1kOut: Number(row.cost_per_1k_out), maxConcurrency: Number(row.max_concurrency),
    rateLimitPerMin: Number(row.rate_limit_per_min), healthStatus: String(row.health_status) as ModelHealthStatus,
    lastHealthCheckAt: row.last_health_check_at == null ? null : String(row.last_health_check_at), enabled: Number(row.enabled) === 1,
    supportsJsonSchema: Number(row.supports_json_schema) === 1,
  };
}

export function listModelProviders(): ModelProviderPublic[] { return missionDb.all<Row>('SELECT * FROM model_providers ORDER BY priority, provider_key').map(publicProvider); }
export function getModelProvider(id: string): ModelProviderPublic | null {
  const row = missionDb.get<Row>('SELECT * FROM model_providers WHERE id=? OR provider_key=?', [id, id]);
  return row ? publicProvider(row) : null;
}
function normalizeProviderInput(input: ModelProviderInput): Required<ModelProviderInput> {
  const models = input.modelsAvailable.filter((model) => typeof model === 'string' && /^[A-Za-z0-9._:/-]{1,160}$/.test(model)).slice(0, 100);
  if (!models.length) throw new ModelLayerError('invalid_input', 'modelsAvailable must contain at least one safe model id', 400);
  const defaultModel = text(input.defaultModel, 'defaultModel', 160);
  if (!models.includes(defaultModel)) throw new ModelLayerError('invalid_input', 'defaultModel must be listed in modelsAvailable', 400);
  const url = text(input.baseUrl, 'baseUrl', 1000);
  if (!/^https?:\/\//i.test(url)) throw new ModelLayerError('invalid_input', 'baseUrl must use http or https', 400);
  const vaultKey = text(input.credentialVaultKey, 'credentialVaultKey', 160);
  if (!/^model\.[a-z0-9_-]+\.[a-z0-9_.-]+$/i.test(vaultKey)) throw new ModelLayerError('invalid_input', 'credentialVaultKey must be a vault name such as model.openai.api_key', 400);
  return {
    providerKey: text(input.providerKey, 'providerKey', 80).toLowerCase(), displayName: text(input.displayName, 'displayName', 160), baseUrl: url.replace(/\/+$/, ''),
    credentialVaultKey: vaultKey, modelsAvailable: models, defaultModel, priority: int(input.priority, 'priority', 0, 100000, 100),
    costPer1kIn: decimal(input.costPer1kIn, 'costPer1kIn', 0, 1000000, 0), costPer1kOut: decimal(input.costPer1kOut, 'costPer1kOut', 0, 1000000, 0),
    maxConcurrency: int(input.maxConcurrency, 'maxConcurrency', 1, 100, 1), rateLimitPerMin: int(input.rateLimitPerMin, 'rateLimitPerMin', 1, 100000, 1),
    enabled: input.enabled === true, supportsJsonSchema: input.supportsJsonSchema === true,
  };
}

export function createModelProvider(input: ModelProviderInput, ownerId: string): ModelProviderPublic {
  const value = normalizeProviderInput(input); const id = missionId('mp'); const at = nowIso();
  missionDb.run(`INSERT INTO model_providers (id,provider_key,display_name,base_url,credential_vault_key,models_available_json,default_model,priority,cost_per_1k_in,cost_per_1k_out,max_concurrency,rate_limit_per_min,enabled,supports_json_schema,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, value.providerKey, value.displayName, value.baseUrl, value.credentialVaultKey, JSON.stringify(value.modelsAvailable), value.defaultModel, value.priority, value.costPer1kIn, value.costPer1kOut, value.maxConcurrency, value.rateLimitPerMin, value.enabled ? 1 : 0, value.supportsJsonSchema ? 1 : 0, at, at]);
  appendMissionAudit({ actorType: 'owner', actorId: ownerId, action: 'model_provider.created', subjectType: 'model_provider', subjectId: id, detail: { providerKey: value.providerKey, credentialVaultKey: value.credentialVaultKey } });
  return getModelProvider(id)!;
}

export function updateModelProvider(id: string, patch: Partial<ModelProviderInput>, ownerId: string): ModelProviderPublic {
  const current = missionDb.get<Row>('SELECT * FROM model_providers WHERE id=? OR provider_key=?', [id, id]);
  if (!current) throw new ModelLayerError('not_found', 'model provider not found', 404);
  const merged: ModelProviderInput = {
    providerKey: patch.providerKey ?? String(current.provider_key), displayName: patch.displayName ?? String(current.display_name), baseUrl: patch.baseUrl ?? String(current.base_url),
    credentialVaultKey: patch.credentialVaultKey ?? String(current.credential_vault_key), modelsAvailable: patch.modelsAvailable ?? parse(current.models_available_json, []), defaultModel: patch.defaultModel ?? String(current.default_model),
    priority: patch.priority ?? Number(current.priority), costPer1kIn: patch.costPer1kIn ?? Number(current.cost_per_1k_in), costPer1kOut: patch.costPer1kOut ?? Number(current.cost_per_1k_out),
    maxConcurrency: patch.maxConcurrency ?? Number(current.max_concurrency), rateLimitPerMin: patch.rateLimitPerMin ?? Number(current.rate_limit_per_min), enabled: patch.enabled ?? Number(current.enabled) === 1, supportsJsonSchema: patch.supportsJsonSchema ?? Number(current.supports_json_schema) === 1,
  };
  const value = normalizeProviderInput(merged); const at = nowIso();
  missionDb.run(`UPDATE model_providers SET provider_key=?,display_name=?,base_url=?,credential_vault_key=?,models_available_json=?,default_model=?,priority=?,cost_per_1k_in=?,cost_per_1k_out=?,max_concurrency=?,rate_limit_per_min=?,enabled=?,supports_json_schema=?,updated_at=? WHERE id=?`, [value.providerKey, value.displayName, value.baseUrl, value.credentialVaultKey, JSON.stringify(value.modelsAvailable), value.defaultModel, value.priority, value.costPer1kIn, value.costPer1kOut, value.maxConcurrency, value.rateLimitPerMin, value.enabled ? 1 : 0, value.supportsJsonSchema ? 1 : 0, at, String(current.id)]);
  appendMissionAudit({ actorType: 'owner', actorId: ownerId, action: 'model_provider.updated', subjectType: 'model_provider', subjectId: String(current.id), detail: { providerKey: value.providerKey, credentialVaultKey: value.credentialVaultKey } });
  return getModelProvider(String(current.id))!;
}
export function deleteModelProvider(id: string, ownerId: string): void {
  const row = missionDb.get<Row>('SELECT id,provider_key FROM model_providers WHERE id=? OR provider_key=?', [id, id]);
  if (!row) throw new ModelLayerError('not_found', 'model provider not found', 404);
  missionDb.run('UPDATE model_providers SET enabled=0,updated_at=? WHERE id=?', [nowIso(), String(row.id)]);
  appendMissionAudit({ actorType: 'owner', actorId: ownerId, action: 'model_provider.disabled', subjectType: 'model_provider', subjectId: String(row.id), detail: { providerKey: String(row.provider_key) } });
}

export function setModelSpendCap(scopeKey: string, capCents: number, period: 'calendar_day'|'calendar_week'|'calendar_month'|'lifetime', ownerId: string): Record<string, unknown> {
  const key = text(scopeKey, 'scopeKey', 120); const cap = int(capCents, 'capCents', 0, Number.MAX_SAFE_INTEGER); const at = nowIso();
  const existing = missionDb.get<Row>('SELECT id FROM model_spend_caps WHERE scope_key=?', [key]); const id = existing ? String(existing.id) : missionId('msc');
  if (existing) missionDb.run('UPDATE model_spend_caps SET cap_cents=?,period=?,updated_by=?,updated_at=? WHERE id=?', [cap, period, ownerId, at, id]);
  else missionDb.run('INSERT INTO model_spend_caps (id,scope_key,cap_cents,period,updated_by,updated_at) VALUES (?,?,?,?,?,?)', [id, key, cap, period, ownerId, at]);
  return missionDb.get<Row>('SELECT id,scope_key,cap_cents,period,updated_by,updated_at FROM model_spend_caps WHERE id=?', [id])!;
}
export function listModelSpendCaps(): Array<Record<string, unknown>> { return missionDb.all<Row>('SELECT id,scope_key,cap_cents,period,updated_by,updated_at FROM model_spend_caps ORDER BY scope_key'); }

function errorClass(error: unknown): string { const message = error instanceof Error ? error.message.toLowerCase() : ''; if (/401|403|unauthor/.test(message)) return 'unauthorized'; if (/429|rate/.test(message)) return 'rate_limited'; if (/quota/.test(message)) return 'quota_exceeded'; if (/timeout|abort/.test(message)) return 'timeout'; return 'provider_error'; }
function healthFromError(error: unknown): ModelHealthStatus { const cls = errorClass(error); return cls === 'unauthorized' || cls === 'rate_limited' || cls === 'quota_exceeded' || cls === 'timeout' ? cls : 'error'; }
function credentialSecret(row: Row): string {
  const credential = missionDb.get<Row>(`SELECT * FROM mission_credentials WHERE env_var=? AND status IN ('active','expiring') ORDER BY updated_at DESC LIMIT 1`, [String(row.credential_vault_key)]);
  if (!credential) throw new ModelLayerError('auth_required', `vault credential required: ${String(row.credential_vault_key)}`, 409);
  try { return decryptCredential({ ciphertext: String(credential.ciphertext), iv: String(credential.iv), tag: String(credential.tag) }); } catch { throw new ModelLayerError('auth_required', `vault credential unavailable: ${String(row.credential_vault_key)}`, 409); }
}

const providerActive = new Map<string, number>();
const providerRequests = new Map<string, number[]>();
function acquireProvider(row: Row): () => void {
  const id = String(row.id); const now = Date.now(); const times = (providerRequests.get(id) ?? []).filter((time) => now - time < 60000);
  if (times.length >= Number(row.rate_limit_per_min)) throw new ModelLayerError('rate_limit_exceeded', 'provider rate limit reached', 429);
  const active = providerActive.get(id) ?? 0; if (active >= Number(row.max_concurrency)) throw new ModelLayerError('concurrency_exceeded', 'provider concurrency limit reached', 429);
  times.push(now); providerRequests.set(id, times); providerActive.set(id, active + 1); return () => providerActive.set(id, Math.max(0, (providerActive.get(id) ?? 1) - 1));
}
function estimateTokens(messages: ModelGenerateRequest['messages']): number { return Math.max(1, Math.ceil(messages.reduce((sum, message) => sum + message.content.length, 0) / 4)); }
function periodStart(period: string): string { const date = new Date(); if (period === 'lifetime') return '1970-01-01T00:00:00.000Z'; if (period === 'calendar_day') date.setUTCHours(0, 0, 0, 0); else if (period === 'calendar_week') { const day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() - day + 1); date.setUTCHours(0, 0, 0, 0); } else date.setUTCDate(1), date.setUTCHours(0, 0, 0, 0); return date.toISOString(); }
function enforceCaps(row: Row, request: ModelGenerateRequest): void {
  const estimatedIn = estimateTokens(request.messages); const estimatedOut = request.maxOutputTokens ?? 2048; const estimateCents = Math.ceil((estimatedIn / 1000) * Number(row.cost_per_1k_in) + (estimatedOut / 1000) * Number(row.cost_per_1k_out));
  const caps = missionDb.all<Row>(`SELECT * FROM model_spend_caps WHERE scope_key IN ('global',?)`, [request.roleKey ? `role:${request.roleKey}` : 'role:default']);
  if (estimateCents > 0 && !caps.some((cap) => Number(cap.cap_cents) >= 0)) throw new ModelLayerError('spend_cap_not_configured', 'model spend cap is not configured; refusing a paid model call', 409);
  for (const cap of caps) { const spent = Number(missionDb.get<Row>('SELECT COALESCE(SUM(cost_cents),0) AS total FROM model_call_logs WHERE status=\'succeeded\' AND created_at>=?', [periodStart(String(cap.period))])?.total ?? 0); if (spent + estimateCents > Number(cap.cap_cents)) throw new ModelLayerError('spend_cap_exceeded', `model ${String(cap.scope_key)} spend cap would be exceeded`, 409); }
}
function validateSchema(value: any, schema: JsonSchema, path = '$'): void {
  if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) throw new ModelLayerError('schema_validation_failed', `${path} is not an allowed value`, 422);
  if (schema.type === 'object') { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ModelLayerError('schema_validation_failed', `${path} must be an object`, 422); for (const key of schema.required ?? []) if (!(key in value)) throw new ModelLayerError('schema_validation_failed', `${path}.${key} is required`, 422); for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in value) validateSchema(value[key], child, `${path}.${key}`); }
  else if (schema.type === 'array') { if (!Array.isArray(value)) throw new ModelLayerError('schema_validation_failed', `${path} must be an array`, 422); if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items!, `${path}[${index}]`)); }
  else if (schema.type === 'string' && typeof value !== 'string') throw new ModelLayerError('schema_validation_failed', `${path} must be a string`, 422);
  else if (schema.type === 'number' && typeof value !== 'number') throw new ModelLayerError('schema_validation_failed', `${path} must be a number`, 422);
  else if (schema.type === 'boolean' && typeof value !== 'boolean') throw new ModelLayerError('schema_validation_failed', `${path} must be a boolean`, 422);
}

export interface ModelTransport { fetch: typeof fetch; sleep?: (ms: number) => Promise<void> }
export interface ModelClientOptions { transport?: ModelTransport; maxRetries?: number; retryBaseMs?: number }

function modelResultFromResponse(row: Row, model: string, payload: any, started: number, fallbackFrom?: string): ModelGenerateResult {
  const choice = payload?.choices?.[0]?.message?.content ?? payload?.content?.[0]?.text ?? payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text).join('');
  const textValue = typeof choice === 'string' ? choice.trim() : '';
  const usage = payload?.usage ?? payload?.usageMetadata;
  if (!textValue || !Number.isSafeInteger(Number(usage?.prompt_tokens ?? usage?.promptTokenCount)) || !Number.isSafeInteger(Number(usage?.completion_tokens ?? usage?.candidatesTokenCount))) throw new ModelLayerError('provider_receipt_invalid', 'provider response lacks bounded text or actual token usage', 502);
  const inputTokens = Number(usage.prompt_tokens ?? usage.promptTokenCount); const outputTokens = Number(usage.completion_tokens ?? usage.candidatesTokenCount);
  return { providerKey: String(row.provider_key), model, text: textValue.slice(0, 200000), inputTokens, outputTokens, costCents: Math.ceil(inputTokens / 1000 * Number(row.cost_per_1k_in) + outputTokens / 1000 * Number(row.cost_per_1k_out)), latencyMs: Date.now() - started, ...(fallbackFrom ? { fallbackFrom } : {}) };
}

export class MissionModelClient implements ModelClient {
  private readonly transport: ModelTransport;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  constructor(options: ModelClientOptions = {}) { this.transport = options.transport ?? { fetch }; this.maxRetries = options.maxRetries ?? 2; this.retryBaseMs = options.retryBaseMs ?? 100; }

  private async outbound(row: Row, model: string, request: ModelGenerateRequest, secret: string, onToken?: (token: string) => void): Promise<ModelGenerateResult> {
    assertInScope(request.scope.programId, request.scope.target, { agentType: request.scope.agentType, runId: request.scope.runId });
    const url = `${String(row.base_url).replace(/\/+$/, '')}${String(row.provider_key) === 'google' ? `/models/${encodeURIComponent(model)}:generateContent` : '/chat/completions'}`;
    const provider = String(row.provider_key); const headers: Record<string, string> = { 'content-type': 'application/json' }; const messages = request.messages;
    let body: Record<string, unknown>;
    if (provider === 'anthropic') { headers['x-api-key'] = secret; headers['anthropic-version'] = '2023-06-01'; body = { model, max_tokens: request.maxOutputTokens ?? 2048, temperature: request.temperature ?? 0, system: messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n'), messages: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })) }; }
    else if (provider === 'google') { headers['x-goog-api-key'] = secret; body = { contents: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), generationConfig: { temperature: request.temperature ?? 0, maxOutputTokens: request.maxOutputTokens ?? 2048, ...(request.jsonSchema ? { responseMimeType: 'application/json', responseSchema: request.jsonSchema } : {}) } }; }
    else { headers.Authorization = `Bearer ${secret}`; body = { model, messages, temperature: request.temperature ?? 0, max_tokens: request.maxOutputTokens ?? 2048, ...(request.jsonSchema ? { response_format: { type: 'json_schema', json_schema: { name: 'mission_output', strict: true, schema: request.jsonSchema } } } : {}) }; }
    let last: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        assertInScope(request.scope.programId, request.scope.target, { agentType: request.scope.agentType, runId: request.scope.runId });
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 60000);
        const response = await this.transport.fetch(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: controller.signal }); clearTimeout(timer);
        if (!response.ok) { const err = new ModelLayerError(response.status === 401 || response.status === 403 ? 'unauthorized' : response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'provider_error' : 'provider_request_failed', `provider request failed with HTTP ${response.status}`, response.status === 401 || response.status === 403 ? 401 : response.status === 429 ? 429 : 502); if (response.status < 500 && response.status !== 429) throw err; throw err; }
        const payload = await response.json(); const result = modelResultFromResponse(row, model, payload, Date.now(), undefined); if (onToken) onToken(result.text); return result;
      } catch (error) {
        last = error; const retryable = error instanceof ModelLayerError && ['rate_limited', 'provider_error', 'timeout'].includes(error.code);
        if (!retryable || attempt >= this.maxRetries) throw error;
        const jitter = this.retryBaseMs ? Math.floor(Math.random() * this.retryBaseMs) : 0; await (this.transport.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(this.retryBaseMs * (2 ** attempt) + jitter);
      }
    }
    throw last instanceof Error ? last : new ModelLayerError('provider_error', 'provider call failed', 502);
  }

  private async call(request: ModelGenerateRequest, stream = false, onToken?: (token: string) => void): Promise<ModelGenerateResult> {
    assertInScope(request.scope.programId, request.scope.target, { agentType: request.scope.agentType, runId: request.scope.runId });
    const providers = missionDb.all<Row>("SELECT * FROM model_providers WHERE enabled=1 AND health_status NOT IN ('unauthorized','quota_exceeded','rate_limited','timeout','error') ORDER BY priority, provider_key"); if (!providers.length) throw new ModelLayerError('no_provider_available', 'no healthy enabled model provider is configured', 409);
    const chosen = request.model ? providers.filter((row) => parse(row.models_available_json, []).includes(request.model)) : providers; const candidates = chosen.length ? chosen : providers;
    let fallbackFrom: string | undefined; let last: unknown;
    for (const row of candidates) {
      const model = request.model ?? String(row.default_model); if (request.jsonSchema && Number(row.supports_json_schema) !== 1) { last = new ModelLayerError('schema_support_required', `provider ${String(row.provider_key)} cannot enforce JSON schema`, 409); continue; }
      try {
        enforceCaps(row, request); const release = acquireProvider(row);
        try {
          const secret = credentialSecret(row); const result = await this.outbound(row, model, request, secret, stream ? onToken : undefined); result.fallbackFrom = fallbackFrom; missionDb.run('UPDATE model_providers SET health_status=\'ok\',last_health_check_at=?,updated_at=? WHERE id=?', [nowIso(), nowIso(), String(row.id)]);
          missionDb.run('INSERT INTO model_call_logs (id,provider_id,provider_key,model,role_key,program_id,target,status,fallback_from_provider_id,input_tokens,output_tokens,cost_cents,schema_requested,schema_validated,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [missionId('mcl'), String(row.id), String(row.provider_key), model, request.roleKey ?? null, request.scope.programId, request.scope.target, 'succeeded', fallbackFrom ?? null, result.inputTokens, result.outputTokens, result.costCents, request.jsonSchema ? 1 : 0, request.jsonSchema ? 1 : 0, nowIso()]);
          return result;
        } finally { release(); }
      } catch (error) {
        last = error; const cls = errorClass(error); const healthStatus = healthFromError(error); missionDb.run('UPDATE model_providers SET health_status=?,updated_at=? WHERE id=?', [healthStatus, nowIso(), String(row.id)]); missionDb.run('INSERT INTO model_health_events (id,provider_id,occurred_at,status,latency_ms,error_class,recovery_at) VALUES (?,?,?,?,?,?,?)', [missionId('mhe'), String(row.id), nowIso(), healthStatus, null, cls, null]); missionDb.run('INSERT INTO model_call_logs (id,provider_id,provider_key,model,role_key,program_id,target,status,fallback_from_provider_id,fallback_reason,error_class,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [missionId('mcl'), String(row.id), String(row.provider_key), model, request.roleKey ?? null, request.scope.programId, request.scope.target, 'failed', fallbackFrom ?? null, error instanceof ModelLayerError ? error.code : cls, cls, nowIso()]);
        if (candidates.indexOf(row) < candidates.length - 1) { missionDb.run('INSERT INTO model_call_logs (id,provider_id,provider_key,model,role_key,program_id,target,status,fallback_from_provider_id,fallback_reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [missionId('mcl'), String(row.id), String(row.provider_key), model, request.roleKey ?? null, request.scope.programId, request.scope.target, 'fallback', String(row.id), cls, nowIso()]); fallbackFrom = String(row.provider_key); continue; }
      }
    }
    throw last instanceof Error ? last : new ModelLayerError('no_provider_available', 'no provider completed the request', 502);
  }

  async generate(request: ModelGenerateRequest): Promise<ModelGenerateResult> { return this.call(request); }
  async generateStructured<T>(request: Omit<ModelGenerateRequest, 'jsonSchema'> & { jsonSchema: JsonSchema }): Promise<ModelStructuredResult<T>> {
    const result = await this.call(request); let value: T; try { value = JSON.parse(result.text) as T; validateSchema(value, request.jsonSchema); } catch (error) { missionDb.run('UPDATE model_call_logs SET schema_validated=0 WHERE provider_key=? AND created_at=?', [result.providerKey, nowIso()]); throw error instanceof ModelLayerError ? error : new ModelLayerError('schema_validation_failed', 'structured model response was not valid JSON', 422); }
    missionDb.run('UPDATE model_call_logs SET schema_validated=1 WHERE id=(SELECT id FROM model_call_logs WHERE provider_key=? ORDER BY created_at DESC LIMIT 1)', [result.providerKey]); return { ...result, value };
  }
  async streamGenerate(request: ModelGenerateRequest, onToken: (token: string) => void): Promise<ModelGenerateResult> { return this.call(request, true, onToken); }
}

export function createMissionModelClient(options: ModelClientOptions = {}): ModelClient { return new MissionModelClient(options); }

export async function checkModelHealth(input: { programId: string; target: string; providerId?: string }): Promise<Array<Record<string, unknown>>> {
  const rows = missionDb.all<Row>(input.providerId ? 'SELECT * FROM model_providers WHERE id=? OR provider_key=?' : 'SELECT * FROM model_providers ORDER BY priority,provider_key', input.providerId ? [input.providerId, input.providerId] : []);
  const results: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const started = Date.now(); let status: ModelHealthStatus = 'error'; let detail = 'health check failed';
    try {
      const secret = credentialSecret(row); assertInScope(input.programId, input.target, { agentType: 'model_health_check' });
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000); const response = await fetch(String(row.base_url), { method: 'GET', headers: { Authorization: `Bearer ${secret}`, 'x-api-key': secret, 'x-goog-api-key': secret }, redirect: 'error', signal: controller.signal }); clearTimeout(timer);
      status = response.ok ? 'ok' : response.status === 401 || response.status === 403 ? 'unauthorized' : response.status === 429 ? 'rate_limited' : 'error'; detail = response.ok ? 'provider endpoint responded' : `provider endpoint returned HTTP ${response.status}`;
    } catch (error) { status = error instanceof ModelLayerError && error.code === 'auth_required' ? 'unauthorized' : healthFromError(error); detail = error instanceof ModelLayerError ? error.message : 'health check failed'; }
    const at = nowIso(); missionDb.run('UPDATE model_providers SET health_status=?,last_health_check_at=?,updated_at=? WHERE id=?', [status, at, at, String(row.id)]); missionDb.run('INSERT INTO model_health_events (id,provider_id,occurred_at,status,latency_ms,error_class,recovery_at) VALUES (?,?,?,?,?,?,?)', [missionId('mhe'), String(row.id), at, status, Date.now() - started, status === 'ok' ? null : status, status === 'ok' ? at : null]);
    results.push({ provider: publicProvider({ ...row, health_status: status, last_health_check_at: at }), status, detail });
  }
  return results;
}

export function modelHealthEvents(providerId?: string): Array<Record<string, unknown>> { return providerId ? missionDb.all<Row>('SELECT id,provider_id,occurred_at,status,latency_ms,error_class,recovery_at FROM model_health_events WHERE provider_id=? ORDER BY occurred_at DESC LIMIT 200', [providerId]) : missionDb.all<Row>('SELECT id,provider_id,occurred_at,status,latency_ms,error_class,recovery_at FROM model_health_events ORDER BY occurred_at DESC LIMIT 200'); }
export function modelCallObservability(): Array<Record<string, unknown>> { return missionDb.all<Row>('SELECT id,provider_key,model,role_key,status,fallback_from_provider_id,fallback_reason,input_tokens,output_tokens,cost_cents,schema_requested,schema_validated,error_class,created_at FROM model_call_logs ORDER BY created_at DESC LIMIT 200'); }
