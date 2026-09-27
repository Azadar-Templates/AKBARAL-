// ─────────────────────────────────────────────────────────────────────────────
// ZA141251SA — owner-driven chat enablement ($0 free-tier path)
//
// Turning chat on used to require six separate owner actions through the admin
// API (store credential → approve tool → request resource → provision it →
// bind the credential → write a chat config), each with its own failure mode.
// This module performs exactly those steps in one audited transaction from the
// owner console, in the one configuration that cannot cost money:
//
//   · resource plan `gemini-free-tier`, 0 recurring cost, provisioned at 0
//   · chat binding `billing: 'free_tier'` — 0 cost cap, no wallet attached
//   · mission-side request/token quotas the owner sets (the provider's own
//     free-tier limits apply independently and are not claimed here)
//
// The API key is encrypted by the existing vault on the way in and is never
// logged, echoed, audited or returned — only the vault's masked hint is.
// ─────────────────────────────────────────────────────────────────────────────

import { missionDb, nowIso, appendMissionAudit, type Row } from './database';
import { currentPolicy, updatePolicy, checkActivity } from './policy';
import {
  MissionSelfServiceError,
  getCredentialPublic,
  getTool,
  provisionResource,
  recordResourceUsage,
  requestResource,
  retireResource,
  revokeCredential,
  storeCredential,
  type CredentialPublic,
} from './self-management';
import { configureAgentChat, agentChatConfig, CHAT_MODEL, type AgentChatConfig } from './chat-state';
import { agentChatReadiness, type AgentChatReadiness } from './agent-briefing';

export const FREE_TIER_PLAN = 'gemini-free-tier';

export interface ChatEnablementInput {
  agentId: string;
  /** Provider API key. Encrypted immediately; never stored or logged in clear. */
  apiKey: string;
  /** Mission-side caps. Defaults are conservative, not provider promises. */
  dailyRequests?: number;
  dailyTokens?: number;
  maxInputBytes?: number;
  maxOutputTokens?: number;
  /** The owner explicitly allows the mission's support_services chat activity. */
  allowSupportActivity?: boolean;
  actorId: string;
}

export interface ChatEnablementResult {
  agentId: string;
  credential: CredentialPublic;
  resourceId: string;
  config: AgentChatConfig;
  readiness: AgentChatReadiness;
  policyUpdated: boolean;
  /** Set when this call replaced an earlier binding (key rotation / re-enable). */
  replaced: { resourceId: string; credentialRevoked: boolean } | null;
}

function fail(message: string, status = 400, code = 'chat_enablement'): never {
  throw new MissionSelfServiceError(status, message, code);
}

const bounded = (value: unknown, fallback: number, min: number, max: number): number => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) fail(`value must be an integer between ${min} and ${max}`);
  return parsed;
};

/**
 * Enable real replies for one agent on the free tier. Idempotent in effect: a
 * second call rotates to the supplied key by storing a new credential and
 * rebinding, leaving an audit trail for both.
 */
export function enableAgentChatFreeTier(input: ChatEnablementInput): ChatEnablementResult {
  const apiKey = String(input.apiKey ?? '').trim();
  if (apiKey.length < 20 || apiKey.length > 400 || /\s/.test(apiKey)) {
    fail('provide the provider API key exactly as issued (no spaces, 20–400 characters)');
  }
  const actorId = String(input.actorId ?? '').trim();
  if (!actorId) fail('an authenticated owner is required', 403, 'forbidden');

  const dailyRequests = bounded(input.dailyRequests, 200, 1, 100000);
  const dailyTokens = bounded(input.dailyTokens, 250000, 1000, 50000000);
  const maxInputBytes = bounded(input.maxInputBytes, 8000, 128, 48000);
  const maxOutputTokens = bounded(input.maxOutputTokens, 1024, 64, 4096);

  return missionDb.transaction(() => {
    const agent = missionDb.get<Row>('SELECT * FROM mission_agents WHERE id = ?', [input.agentId]);
    if (!agent) fail('agent not found', 404, 'not_found');
    if (String(agent.status) !== 'active') fail('only an active agent can be given a chat binding', 409, 'conflict');
    const tool = getTool('gemini_api');
    if (!tool || String(tool.status) === 'blocked') fail('the Google Gemini tool is blocked by policy', 403, 'forbidden');

    // Re-enabling after a disable (or rotating to a new key) must work. The
    // previous resource is retired and its key revoked instead of being left
    // active beside the new one, so an agent never holds two live bindings.
    const previous = agentChatConfig(input.agentId);
    let replaced: { resourceId: string; credentialRevoked: boolean } | null = null;
    if (previous?.resourceId) {
      const priorRow = missionDb.get<Row>('SELECT id, status, credential_id FROM mission_resources WHERE id = ?', [previous.resourceId]);
      if (priorRow) {
        let credentialRevoked = false;
        const priorCredentialId = priorRow.credential_id ? String(priorRow.credential_id) : null;
        if (priorCredentialId && getCredentialPublic(priorCredentialId)?.status !== 'revoked') {
          revokeCredential(priorCredentialId, actorId, 'owner rotated the agent chat provider key', 'owner');
          credentialRevoked = true;
        }
        if (String(priorRow.status) !== 'retired') {
          retireResource(String(priorRow.id), actorId, 'replaced by a new free-tier chat binding', 'owner');
        }
        replaced = { resourceId: String(priorRow.id), credentialRevoked };
      }
    }

    const credential = storeCredential({
      provider: 'google',
      label: `Gemini free tier — ${String(agent.slug)}`,
      kind: 'api_key',
      scope: ['model.call'],
      envVar: null,
      secret: apiKey,
      actorId,
    });

    const resource = requestResource({
      agentId: input.agentId,
      kind: 'api',
      provider: 'google',
      plan: FREE_TIER_PLAN,
      monthlyCostCents: 0,
      autoRenew: false,
      limits: { requests: dailyRequests, tokens: dailyTokens },
      credentialId: credential.id,
      actorId,
    });
    const resourceId = String(resource.id);
    if (String(resource.status) !== 'approved') fail('a zero-cost resource should not require approval; check mission policy', 409, 'conflict');

    // The provisioning reference is unique per binding: the ledger refuses a
    // repeated provider reference, which is what blocked re-enablement before.
    const rotation = Number(
      missionDb.get<Row>(
        `SELECT COUNT(*) AS n FROM mission_resources WHERE agent_id = ? AND provider = 'google' AND plan = ?`,
        [input.agentId, FREE_TIER_PLAN],
      )?.n ?? 1,
    );
    provisionResource({
      id: resourceId,
      actualCostCents: 0,
      providerRef: `google-ai-studio-free-tier:${String(agent.slug)}:binding-${rotation}`,
      evidence: 'Google AI Studio free tier: no purchase, no invoice and no vendor charge. Mission-side request/token caps apply; the provider enforces its own free-tier limits independently.',
      actorId,
      actorType: 'owner',
    });

    // Quota counters must exist before the first call: an unreported counter is
    // treated as "usage unknown" and would block the resource.
    recordResourceUsage({ id: resourceId, usage: { requests: 0, tokens: 0 }, actorType: 'owner', actorId });

    const config = configureAgentChat(
      input.agentId,
      {
        enabled: true,
        resourceId,
        walletId: '',
        model: CHAT_MODEL,
        maxInputBytes,
        maxOutputTokens,
        maxCostCents: 0,
        costBasis: 'Google AI Studio free tier — zero cost cap, no wallet attached, no ledger entry can result from a chat call.',
        billing: 'free_tier',
      },
      { actorType: 'owner', actorId },
    );

    let policyUpdated = false;
    const policy = currentPolicy();
    if (input.allowSupportActivity && (!policy.autonomousEnabled || !checkActivity('support_services', policy).allowed)) {
      updatePolicy(
        {
          autonomousEnabled: true,
          allowedActivities: [...new Set([...policy.allowedActivities, 'support_services'])],
        },
        actorId,
      );
      policyUpdated = true;
    }

    appendMissionAudit({
      actorType: 'owner',
      actorId,
      action: 'agent.chat_enabled',
      subjectType: 'agent',
      subjectId: input.agentId,
      // Provider, plan, caps and the credential id — never the key or its hint.
      detail: {
        provider: 'google',
        model: CHAT_MODEL,
        plan: FREE_TIER_PLAN,
        billing: 'free_tier',
        resourceId,
        credentialId: credential.id,
        dailyRequests,
        dailyTokens,
        costCents: 0,
        walletAttached: false,
        policyUpdated,
        providerActivated: false,
        replacedResourceId: replaced?.resourceId ?? null,
        replacedKeyRevoked: replaced?.credentialRevoked ?? false,
      },
    });

    return {
      agentId: input.agentId,
      credential,
      resourceId,
      config,
      readiness: agentChatReadiness(input.agentId),
      policyUpdated,
      replaced,
    };
  });
}

/**
 * Turn chat off for one agent. `revokeKey` also revokes the stored credential,
 * which is the honest "remove my key" action; the encrypted row is retained for
 * the audit chain but can no longer be used.
 */
export function disableAgentChat(input: { agentId: string; revokeKey?: boolean; actorId: string }): {
  agentId: string;
  config: AgentChatConfig | null;
  readiness: AgentChatReadiness;
  credentialRevoked: boolean;
} {
  const actorId = String(input.actorId ?? '').trim();
  if (!actorId) fail('an authenticated owner is required', 403, 'forbidden');
  return missionDb.transaction(() => {
    const existing = agentChatConfig(input.agentId);
    if (!existing) fail('this agent has no chat binding', 404, 'not_found');
    const config = configureAgentChat(input.agentId, { ...existing, enabled: false }, { actorType: 'owner', actorId });
    let credentialRevoked = false;
    if (input.revokeKey) {
      const resource = missionDb.get<Row>('SELECT credential_id FROM mission_resources WHERE id = ?', [existing.resourceId]);
      const credentialId = resource?.credential_id ? String(resource.credential_id) : null;
      if (credentialId && getCredentialPublic(credentialId)?.status !== 'revoked') {
        revokeCredential(credentialId, actorId, 'owner disabled agent chat and removed the provider key', 'owner');
        credentialRevoked = true;
      }
    }
    appendMissionAudit({
      actorType: 'owner',
      actorId,
      action: 'agent.chat_disabled',
      subjectType: 'agent',
      subjectId: input.agentId,
      detail: { resourceId: existing.resourceId, credentialRevoked, at: nowIso() },
    });
    return { agentId: input.agentId, config, readiness: agentChatReadiness(input.agentId), credentialRevoked };
  });
}
