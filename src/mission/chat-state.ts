import { missionDb, missionId, nowIso, appendMissionAudit, sha256, type Row } from './database';
import { currentPolicy, checkActivity } from './policy';
import { MissionSelfServiceError, getCredentialPublic, getTool, resourceReadiness } from './self-management';
import { getWallet } from './treasury';
import { modelLifecycle, recommendedFreeModel, type Lifecycle } from '../config/google-model-lifecycle';

/**
 * The model every mission agent chat is bound to.
 *
 * It is NOT a bare string any more: a pinned model that Google retires stops
 * answering with HTTP 404, which is indistinguishable from a bad key for the
 * owner. `recommendedFreeModel()` resolves, from the verified model table, the
 * free-tier model with the longest remaining supported life.
 */
export const CHAT_MODEL = recommendedFreeModel();

/** Lifecycle verdict for the bound chat model, for readiness output. */
export function chatModelLifecycle(today: Date = new Date()): Lifecycle {
  return modelLifecycle(CHAT_MODEL, today);
}
/**
 * How a chat call is paid for.
 *
 *  · `metered`   — the vendor can charge for the call, so the mission holds a
 *                  positive wallet budget and refuses to dispatch until a
 *                  verified vendor billing adapter exists (see chat-provider).
 *  · `free_tier` — the binding is provably incapable of costing money: the
 *                  resource has zero recurring and zero provisioned cost, the
 *                  cost cap is 0 and no wallet is attached, so no ledger entry
 *                  and no external charge can result. Quota metering still
 *                  applies, which is what free tiers are actually limited by.
 */
export type ChatBilling = 'metered' | 'free_tier';
export interface AgentChatConfig {
  enabled: boolean; resourceId: string; walletId: string; model: typeof CHAT_MODEL;
  maxInputBytes: number; maxOutputTokens: number; maxCostCents: number; costBasis: string;
  billing: ChatBilling;
}
function fail(message: string, status = 409): never { throw new MissionSelfServiceError(status, message, 'chat_unavailable'); }
/** Canonical shape and key order, so config snapshots compare byte for byte. */
function normalize(raw: Partial<AgentChatConfig>): AgentChatConfig {
  return {
    enabled: Boolean(raw.enabled),
    resourceId: String(raw.resourceId ?? ''),
    walletId: String(raw.walletId ?? ''),
    model: CHAT_MODEL,
    maxInputBytes: Number(raw.maxInputBytes ?? 0),
    maxOutputTokens: Number(raw.maxOutputTokens ?? 0),
    maxCostCents: Number(raw.maxCostCents ?? 0),
    costBasis: String(raw.costBasis ?? ''),
    billing: raw.billing === 'free_tier' ? 'free_tier' : 'metered',
  };
}
export function agentChatConfig(agentId: string): AgentChatConfig | null {
  const row = missionDb.get<Row>('SELECT config FROM mission_agent_chat_configs WHERE agent_id = ?', [agentId]);
  return row ? normalize(JSON.parse(String(row.config)) as Partial<AgentChatConfig>) : null;
}
/** A free-tier binding must be structurally incapable of spending money. */
export function assertZeroCostResource(resource: Row): void {
  if (Number(resource.monthly_cost_cents ?? 0) !== 0 || Number(resource.provisioned_cost_cents ?? 0) !== 0) {
    fail('a free-tier chat binding requires a resource with zero recurring and zero provisioned cost', 400);
  }
}
export function configureAgentChat(agentId: string, input: AgentChatConfig, actor: { actorType: 'owner' | 'agent'; actorId: string }): AgentChatConfig {
  return missionDb.transaction(() => {
    if (actor.actorType !== 'owner' || !actor.actorId?.trim()) fail('chat configuration requires a trusted owner', 403);
    if (!missionDb.get('SELECT id FROM mission_agents WHERE id = ?', [agentId])) fail('agent not found', 404);
    const billing: ChatBilling = input?.billing === 'free_tier' ? 'free_tier' : 'metered';
    if (!input || typeof input.resourceId !== 'string' || input.resourceId.length > 200 || typeof input.walletId !== 'string' || input.walletId.length > 200 || typeof input.enabled !== 'boolean' || input.model !== CHAT_MODEL || !Number.isSafeInteger(input.maxInputBytes) || input.maxInputBytes < 128 || input.maxInputBytes > 48000 || !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 64 || input.maxOutputTokens > 4096 || !Number.isSafeInteger(input.maxCostCents) || input.maxCostCents > 1000000 || typeof input.costBasis !== 'string' || input.costBasis.trim().length < 12 || input.costBasis.length > 1000) fail('bounded chat limits and an owner cost-basis statement are required', 400);
    if (billing === 'metered' && input.maxCostCents < 1) fail('bounded chat limits and an owner cost-basis statement are required', 400);
    const resource = missionDb.get<Row>('SELECT * FROM mission_resources WHERE id = ?', [input.resourceId]);
    if (!resource || resource.agent_id !== agentId || resource.provider !== 'google') fail('chat requires this agent’s Google resource', 403);
    if (billing === 'free_tier') {
      // No wallet, no cap above zero, no chargeable resource: the binding cannot
      // move money, which is exactly why it may dispatch without a verified
      // vendor billing adapter.
      if (input.maxCostCents !== 0 || input.walletId !== '') fail('a free-tier chat binding carries a zero cost cap and no wallet', 400);
      assertZeroCostResource(resource);
    } else if (getWallet(input.walletId)?.agentId !== agentId) {
      fail('chat wallet must belong to this agent', 403);
    }
    const config: AgentChatConfig = normalize({ enabled: input.enabled, resourceId: input.resourceId, walletId: input.walletId, maxInputBytes: input.maxInputBytes, maxOutputTokens: input.maxOutputTokens, maxCostCents: input.maxCostCents, costBasis: input.costBasis.trim(), billing });
    missionDb.run('INSERT INTO mission_agent_chat_configs (agent_id, config, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET config = excluded.config, updated_by = excluded.updated_by, updated_at = excluded.updated_at', [agentId, JSON.stringify(config), actor.actorId, nowIso()]);
    appendMissionAudit({ ...actor, action: 'agent.chat_configured', subjectType: 'agent', subjectId: agentId, detail: { enabled: config.enabled, resourceId: config.resourceId, model: config.model, maxCostCents: config.maxCostCents, billing: config.billing, providerActivated: false } });
    return config;
  });
}
/** Called in the message transaction; only new owner messages can enqueue. */
export function enqueueAgentChat(message: Row): void {
  if (message.actor_type !== 'owner') return;
  const config = agentChatConfig(String(message.agent_id));
  if (!config?.enabled) return;
  const id = missionId('chat');
  missionDb.run("INSERT INTO mission_agent_chat_jobs (id, message_id, agent_id, config_snapshot, message_fingerprint, status, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)", [id, message.id, message.agent_id, JSON.stringify(config), sha256(String(message.body)), nowIso()]);
  appendMissionAudit({ actorType: 'owner', actorId: String(message.actor_id), action: 'agent.chat_queued', subjectType: 'agent', subjectId: String(message.agent_id), detail: { jobId: id, messageId: message.id, commandExecuted: false } });
}
export function assertAgentChatReady(agentId: string, config: AgentChatConfig): void {
  if (!config.enabled || JSON.stringify(agentChatConfig(agentId)) !== JSON.stringify(config)) fail('chat configuration changed or is disabled');
  const policy = currentPolicy();
  if (!policy.autonomousEnabled || !checkActivity('support_services', policy).allowed) fail('mission autonomous support activity is disabled');
  if (missionDb.get<Row>('SELECT status FROM mission_agents WHERE id = ?', [agentId])?.status !== 'active') fail('chat agent is not active');
  const tool = getTool('gemini_api');
  if (!tool || tool.status === 'blocked' || (tool.status !== 'approved' && !missionDb.get("SELECT id FROM mission_tool_requests WHERE agent_id = ? AND tool_key = 'gemini_api' AND status = 'approved'", [agentId]))) fail('model tool is not authorized');
  const resource = missionDb.get<Row>('SELECT * FROM mission_resources WHERE id = ?', [config.resourceId]);
  if (!resource || resource.agent_id !== agentId || resource.provider !== 'google' || !resource.credential_id) fail('Google resource binding changed');
  const credential = getCredentialPublic(String(resource.credential_id));
  if (!credential?.scope.includes('model.call')) fail('provider credential lacks model.call scope');
}
export function chatResourcePreflight(agentId: string, config: AgentChatConfig): void {
  assertAgentChatReady(agentId, config);
  const readiness = resourceReadiness(config.resourceId);
  if (!readiness.usable) fail(`chat resource is unavailable: ${readiness.blockers.join(', ')}`);
}

export function listAgentChatJobs(agentId: string, beforeSeq = Number.MAX_SAFE_INTEGER, limit = 50): { jobs: Row[]; nextCursor: number | null } {
  if (!Number.isSafeInteger(beforeSeq) || beforeSeq < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('invalid chat job cursor or limit', 400);
  const rows = missionDb.all<Row>('SELECT j.id, j.message_id, j.status, j.call_id, j.reply_message_id, j.reason, j.created_at, j.resolved_at, m.seq AS message_seq FROM mission_agent_chat_jobs j JOIN mission_agent_messages m ON m.id = j.message_id WHERE j.agent_id = ? AND m.seq < CAST(? AS BIGINT) ORDER BY m.seq DESC LIMIT ?', [agentId, beforeSeq, limit + 1]);
  const jobs = rows.slice(0, limit);
  return { jobs, nextCursor: rows.length > limit ? Number(jobs[jobs.length - 1].message_seq) : null };
}
