/**
 * ZA141251SA — the $0 chat path, end to end.
 *
 * These tests drive the REAL pipeline: owner enablement → encrypted credential
 * → zero-cost Google resource → free-tier chat binding → queued job → the real
 * `invokeGoogleChat` adapter → persisted reply. Only the HTTP transport is a
 * fixture (the sandbox has no egress), so every line of mission code that runs
 * in production runs here, including the provider response validation.
 *
 * What must hold: no fabricated reply, no money, the agent's real catalog
 * identity in the prompt, the key unreadable anywhere, and a metered binding
 * still refused without verified vendor billing.
 */
import { after, before, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mission-freetier-')), 'mission.db')}`;
process.env.ZA141251SA_CREDENTIAL_KEY = 'synthetic-free-tier-vault-key-0123456789abcd';

const { applyMissionMigrations, missionDb, verifyMissionAudit } = require('./database') as typeof import('./database');
const { updatePolicy, currentPolicy } = require('./policy') as typeof import('./policy');
const { seedTools, requestResource, provisionResource, storeCredential, listCredentials, getCredentialPublic } = require('./self-management') as typeof import('./self-management');
const { createWallet } = require('./treasury') as typeof import('./treasury');
const { appendAgentMessage, listAgentMessages } = require('./messaging') as typeof import('./messaging');
const { configureAgentChat, agentChatConfig, CHAT_MODEL } = require('./chat-state') as typeof import('./chat-state');
const { runNextAgentChat } = require('./chat-worker') as typeof import('./chat-worker');
const { googleChatAdapter } = require('./chat-provider') as typeof import('./chat-provider');
const { enableAgentChatFreeTier, disableAgentChat } = require('./chat-enablement') as typeof import('./chat-enablement');
const { agentChatReadiness, agentBriefing } = require('./agent-briefing') as typeof import('./agent-briefing');
const { heldResourceBudget } = require('./resource-budget-state') as typeof import('./resource-budget-state');

const OWNER = `synthetic-owner-${randomUUID()}`;
// Synthetic value shaped like a provider key. Not a real credential, and
// ASSEMBLED at runtime so this file contains no scannable secret marker (the
// convention used by src/config/env.test.ts and the secret-scan gate).
const SYNTHETIC_KEY = `${['AI', 'zaSy'].join('')}-synthetic-not-a-real-key-${randomUUID().replace(/-/g, '')}`;
let original: ReturnType<typeof currentPolicy>;

before(() => {
  applyMissionMigrations();
  seedTools();
  original = currentPolicy();
  updatePolicy({ autonomousEnabled: true, killSwitch: false }, OWNER);
});
after(() => {
  updatePolicy(original, OWNER);
  missionDb.close();
});

/** A real registry agent: the catalog identity must survive into the prompt. */
function agent(slug = 'youtube-author-006', name = 'YouTube Content Author') {
  const id = `synthetic-agent-${randomUUID()}`;
  missionDb.run(
    "INSERT INTO mission_agents (id, slug, name, category, role_key, depth, generation, status, mission_role, origin_platform, capabilities) VALUES (?, ?, ?, 'YouTube', 'specialist', 0, 'registry', 'active', 'worker', 'akbaral-registry', ?)",
    [id, slug, name, JSON.stringify(['writing', 'research', 'vision'])],
  );
  return id;
}

/** Bounded Gemini-shaped response; the adapter's own validation still applies. */
function transportFixture(text: string, seen: Array<{ url: string; body: any; headers: Record<string, string> }>) {
  return (async (url: string, init: RequestInit = {}) => {
    seen.push({ url: String(url), body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    return new Response(
      JSON.stringify({
        responseId: `synthetic-response-${randomUUID()}`,
        usageMetadata: { totalTokenCount: 128 },
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

it('one owner action enables a real provider binding that cannot cost money', () => {
  const agentId = agent();
  const result = enableAgentChatFreeTier({ agentId, apiKey: SYNTHETIC_KEY, actorId: OWNER, allowSupportActivity: true });

  assert.equal(result.config.billing, 'free_tier');
  assert.equal(result.config.maxCostCents, 0, 'a free-tier binding carries a zero cost cap');
  assert.equal(result.config.walletId, '', 'no wallet is attached, so no ledger entry can result');
  assert.equal(result.config.model, CHAT_MODEL);
  assert.equal(result.readiness.ready, true, `readiness blockers: ${result.readiness.blockers.join(' | ')}`);
  assert.equal(result.readiness.status, 'READY');

  const resource = missionDb.get<Record<string, unknown>>('SELECT * FROM mission_resources WHERE id = ?', [result.resourceId])!;
  assert.equal(Number(resource.monthly_cost_cents), 0);
  assert.equal(Number(resource.provisioned_cost_cents), 0);
  assert.equal(String(resource.status), 'active');
  assert.equal(String(resource.plan), 'gemini-free-tier');
});

it('the provider key is encrypted and never readable from any mission surface', () => {
  const agentId = agent(`research-researcher-002`, 'Research Analyst');
  const result = enableAgentChatFreeTier({ agentId, apiKey: SYNTHETIC_KEY, actorId: OWNER });

  const credential = listCredentials().find((entry) => entry.id === result.credential.id)!;
  assert.equal(Object.values(credential).some((value) => String(value).includes(SYNTHETIC_KEY)), false, 'the public credential view never carries the key');

  // Nothing anywhere in the mission database may contain the plaintext key.
  const tables = missionDb.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name);
  for (const table of tables) {
    const rows = missionDb.all<Record<string, unknown>>(`SELECT * FROM ${table}`);
    for (const row of rows) {
      for (const value of Object.values(row)) {
        assert.equal(String(value ?? '').includes(SYNTHETIC_KEY), false, `plaintext provider key found in ${table}`);
      }
    }
  }
  assert.equal(verifyMissionAudit().ok, true);
});

it('a message produces a real provider reply carrying the agent’s own identity', async () => {
  const agentId = agent('youtube-researcher-002', 'YouTube Research Analyst');
  enableAgentChatFreeTier({ agentId, apiKey: SYNTHETIC_KEY, actorId: OWNER });

  const seen: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  const replyText = 'I have no open work items assigned to me right now.';
  appendAgentMessage({ agentId, actorType: 'owner', actorId: OWNER, body: 'What are you doing right now?', idempotencyKey: randomUUID() });

  const job = await runNextAgentChat(googleChatAdapter(transportFixture(replyText, seen)), { agentId });
  assert.equal(job!.status, 'succeeded', `job reason: ${job!.reason}`);

  // The reply in the conversation is the provider's text, attributed to the agent.
  const messages = listAgentMessages(agentId, 0, 10).messages;
  const reply = messages.find((message) => message.actor_type === 'agent');
  assert.ok(reply, 'the provider reply is persisted in this agent’s conversation');
  assert.equal(String(reply!.body), replyText);
  assert.equal(String(reply!.actor_id), agentId, 'the reply is attributed to the agent that produced it');

  // The prompt actually carried this agent's identity and live state.
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent`);
  const system = seen[0].body.systemInstruction.parts.map((part: { text: string }) => part.text).join('\n');
  assert.match(system, /YouTube Research Analyst/, 'the selected agent’s name is in the model prompt');
  assert.match(system, /slug youtube-researcher-002/);
  assert.match(system, /Purpose:/, 'the catalog purpose is in the model prompt');
  assert.match(system, /Open work items: 0/, 'live mission state is in the model prompt');
  assert.equal(system.includes(SYNTHETIC_KEY), false);

  // Free tier means no money anywhere: no wallet hold, no budget row, no ledger.
  assert.equal(missionDb.get<{ c: number }>('SELECT COUNT(*) AS c FROM mission_resource_call_budgets WHERE call_id = ?', [String(job!.call_id)])!.c, 0);
  assert.equal(missionDb.get<{ c: number }>("SELECT COUNT(*) AS c FROM mission_ledger WHERE reference = ?", [String(job!.call_id)])!.c, 0);
  assert.equal(verifyMissionAudit().ok, true);
});

it('two agents keep separate conversations and separate identities', async () => {
  const writer = agent('writing-author-006', 'Writing Content Author');
  const reviewer = agent('software-engineering-security-gate-046', 'Software Engineering Security Reviewer');
  enableAgentChatFreeTier({ agentId: writer, apiKey: SYNTHETIC_KEY, actorId: OWNER });
  enableAgentChatFreeTier({ agentId: reviewer, apiKey: SYNTHETIC_KEY, actorId: OWNER });

  const seen: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  appendAgentMessage({ agentId: writer, actorType: 'owner', actorId: OWNER, body: 'Draft an outline.', idempotencyKey: randomUUID() });
  appendAgentMessage({ agentId: reviewer, actorType: 'owner', actorId: OWNER, body: 'Review this plan.', idempotencyKey: randomUUID() });

  await runNextAgentChat(googleChatAdapter(transportFixture('Writer reply.', seen)), { agentId: writer });
  await runNextAgentChat(googleChatAdapter(transportFixture('Reviewer reply.', seen)), { agentId: reviewer });

  const writerMessages = listAgentMessages(writer, 0, 10).messages.map((message) => String(message.body));
  const reviewerMessages = listAgentMessages(reviewer, 0, 10).messages.map((message) => String(message.body));
  assert.ok(writerMessages.includes('Writer reply.'));
  assert.ok(reviewerMessages.includes('Reviewer reply.'));
  assert.equal(writerMessages.includes('Reviewer reply.'), false, 'conversations are isolated per agent');
  assert.equal(reviewerMessages.includes('Draft an outline.'), false);

  const prompts = seen.map((entry) => entry.body.systemInstruction.parts.map((part: { text: string }) => part.text).join('\n'));
  assert.match(prompts[0], /Writing Content Author/);
  assert.match(prompts[1], /Software Engineering Security Reviewer/);
  assert.equal(/Security Reviewer/.test(prompts[0]), false, 'one agent’s identity never leaks into another’s prompt');
});

it('a provider failure stays truthful: no reply is invented', async () => {
  const agentId = agent('data-science-analyst-003', 'Data Science Data Analyst');
  enableAgentChatFreeTier({ agentId, apiKey: SYNTHETIC_KEY, actorId: OWNER });
  appendAgentMessage({ agentId, actorType: 'owner', actorId: OWNER, body: 'Anything to report?', idempotencyKey: randomUUID() });

  const failing = (async () => new Response('gateway error', { status: 502 })) as unknown as typeof fetch;
  const job = await runNextAgentChat(googleChatAdapter(failing), { agentId });

  assert.notEqual(job!.status, 'succeeded');
  assert.equal(listAgentMessages(agentId, 0, 10).messages.some((message) => message.actor_type === 'agent'), false, 'no agent message exists when the provider failed');
  assert.equal(agentChatReadiness(agentId).status, 'READY', 'the binding itself is still valid; the call failed, which is recorded on the job');
});

it('a metered binding is still refused without verified vendor billing', async () => {
  const agentId = agent(`finance-analyst-003`, 'Finance Data Analyst');
  const credential = storeCredential({ provider: 'google', label: 'metered', secret: SYNTHETIC_KEY, scope: ['model.call'], actorId: OWNER });
  const resource = requestResource({ agentId, provider: 'google', kind: 'api', credentialId: credential.id, limits: { requests: 5, tokens: 100000 }, actorId: OWNER });
  provisionResource({ id: String(resource.id), actualCostCents: 0, providerRef: 'synthetic-metered-fixture-ref', evidence: 'Synthetic fixture; no real purchase.', actorId: OWNER, actorType: 'owner' });
  const wallet = createWallet({ kind: 'agent', agentId, label: 'metered wallet', budgetCents: 500 });
  configureAgentChat(
    agentId,
    { enabled: true, resourceId: String(resource.id), walletId: wallet.id, model: CHAT_MODEL, maxInputBytes: 2000, maxOutputTokens: 128, maxCostCents: 40, costBasis: 'Synthetic metered cap for this test.', billing: 'metered' },
    { actorType: 'owner', actorId: OWNER },
  );
  appendAgentMessage({ agentId, actorType: 'owner', actorId: OWNER, body: 'Hello', idempotencyKey: randomUUID() });

  const job = await runNextAgentChat(googleChatAdapter(transportFixture('must not be reached', [])), { agentId });
  assert.equal(job!.status, 'blocked');
  assert.equal(job!.reason, 'verified_vendor_billing_not_configured');
  assert.equal(job!.call_id, null);
  assert.equal(heldResourceBudget(wallet.id), 0, 'a blocked job never holds money');
});

it('a free-tier claim over a chargeable resource is rejected at write time', () => {
  const agentId = agent('software-engineering-builder-008', 'Software Engineering Implementation Builder');
  const credential = storeCredential({ provider: 'google', label: 'paid', secret: SYNTHETIC_KEY, scope: ['model.call'], actorId: OWNER });
  const resource = requestResource({ agentId, provider: 'google', kind: 'api', plan: 'paid-tier', monthlyCostCents: 1500, credentialId: credential.id, limits: { requests: 5, tokens: 1000 }, actorId: OWNER });
  assert.throws(
    () =>
      configureAgentChat(
        agentId,
        { enabled: true, resourceId: String(resource.id), walletId: '', model: CHAT_MODEL, maxInputBytes: 2000, maxOutputTokens: 128, maxCostCents: 0, costBasis: 'Claiming free tier over a paid resource.', billing: 'free_tier' },
        { actorType: 'owner', actorId: OWNER },
      ),
    /zero recurring and zero provisioned cost/,
  );
});

it('the owner can switch chat off and revoke the stored key', async () => {
  const agentId = agent(`marketing-strategist-001`, 'Marketing Strategic Architect');
  enableAgentChatFreeTier({ agentId, apiKey: SYNTHETIC_KEY, actorId: OWNER });
  assert.equal(agentChatReadiness(agentId).ready, true);

  const result = disableAgentChat({ agentId, revokeKey: true, actorId: OWNER });
  assert.equal(result.credentialRevoked, true);
  assert.equal(result.readiness.ready, false);
  assert.equal(agentChatConfig(agentId)!.enabled, false);

  appendAgentMessage({ agentId, actorType: 'owner', actorId: OWNER, body: 'Still there?', idempotencyKey: randomUUID() });
  assert.equal(await runNextAgentChat(googleChatAdapter(transportFixture('must not be reached', [])), { agentId }), null, 'a disabled binding never enqueues a job');
  assert.equal(listAgentMessages(agentId, 0, 10).messages.some((message) => message.actor_type === 'agent'), false);
});

it('the owner can switch chat back on, rotating to the new key', async () => {
  const agentId = agent('marketing-copywriter-002', 'Marketing Content Writer');
  const first = enableAgentChatFreeTier({ agentId, apiKey: SYNTHETIC_KEY, actorId: OWNER, allowSupportActivity: true });
  disableAgentChat({ agentId, revokeKey: true, actorId: OWNER });

  // Re-enabling used to fail with duplicate_receipt: the provisioning
  // reference was fixed per agent, so a second binding could never be
  // recorded and an agent switched off could never be switched back on.
  const second = enableAgentChatFreeTier({ agentId, apiKey: `${SYNTHETIC_KEY}-rotated`, actorId: OWNER, allowSupportActivity: true });
  assert.notEqual(second.resourceId, first.resourceId);
  assert.equal(second.replaced?.resourceId, first.resourceId);
  assert.equal(second.readiness.ready, true, second.readiness.blockers.join('; '));
  assert.equal(second.config.billing, 'free_tier');
  assert.equal(second.config.maxCostCents, 0);
  assert.equal(second.config.walletId, '');

  // Exactly one live binding: the superseded resource is retired and its key
  // stays revoked, so the rotated-out key cannot be used by anything.
  const live = missionDb.all<{ id: string; status: string }>(`SELECT id, status FROM mission_resources WHERE agent_id = ? AND plan = 'gemini-free-tier'`, [agentId]);
  assert.equal(live.filter((row) => String(row.status) === 'active').length, 1);
  assert.equal(String(live.find((row) => String(row.id) === first.resourceId)?.status), 'retired');
  assert.equal(getCredentialPublic(first.credential.id)?.status, 'revoked');

  appendAgentMessage({ agentId, actorType: 'owner', actorId: OWNER, body: 'Are you back online?', idempotencyKey: randomUUID() });
  const job = await runNextAgentChat(googleChatAdapter(transportFixture('Yes — the rotated key is live.', [])), { agentId });
  assert.equal(job?.status, 'succeeded');
  assert.equal(listAgentMessages(agentId, 0, 20).messages.filter((message) => message.actor_type === 'agent').length, 1);
});

it('the briefing states the agent’s designed identity, not a generic label', () => {
  const agentId = agent('youtube-validator-011', 'YouTube Craft Validation Reviewer');
  const briefing = agentBriefing(agentId)!;
  assert.equal(briefing.identity?.name, 'YouTube Craft Validation Reviewer');
  assert.equal(briefing.identity?.specialization, 'YouTube / Craft Validation Reviewer');
  assert.match(briefing.identity!.purpose, /Validate outputs against declared expectations/);
  assert.ok(briefing.identity!.workflow.length > 0);
  assert.match(briefing.text, /Designed workflow:/);
  assert.match(briefing.text, /Verification rules you are held to:/);
});
