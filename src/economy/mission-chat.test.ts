import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { db, findUserByEmail } from '../db';
import { applyMigrations } from '../db/migrate';
import { syncAgentRegistry, getAgentBySlug } from '../agents/registry';
import { listEconomyEvents, listMissionMessages } from '../db/economy-repositories';
import { missionChatWithAgent, missionChatHistory, MissionChatError } from './mission-chat';
import { configuredOwnerEmail, syncConfiguredOwnerIdentity } from '../auth/owner-identity';
import { createApiServer, type ApiServer } from '../app';

/**
 * ZA141251SA mission-chat + configured-owner-identity battery (production
 * build sections 4 and 5).
 *
 * Verified here:
 *   - the owner is identified ONLY by the configured email
 *     (AKBARAL_OWNER_EMAIL) — promotion is one-way, audited, and lands in the
 *     issued session; unset config promotes nobody
 *   - mission chat is owner-only at the HTTP layer (401 anonymous, 403 user
 *     and staff admin, 200 owner)
 *   - the agent must exist in the real registry (404 otherwise)
 *   - a missing provider fails HONESTLY (structured failed reply, owner
 *     message still stored + audited — never a fabricated answer)
 *   - a real provider endpoint produces a real reply; secrets in provider
 *     output are REDACTED before storage; the request context NEVER contains
 *     the agent's internal system instructions
 *   - every exchange writes economy_events audit rows
 */

const SAVED_ENV: Record<string, string | undefined> = {};
const ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AKBARAL_OWNER_EMAIL'];

function saveEnv(): void {
  for (const key of ENV_KEYS) SAVED_ENV[key] = process.env[key];
}
function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (SAVED_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED_ENV[key]!;
  }
}

function startJsonServer(handler: (req: http.IncomingMessage, body: string) => unknown): Promise<{ url: string; close(): Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
      req.on('end', () => {
        const payload = handler(req, raw);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}

describe('ZA141251SA mission chat + configured owner identity', () => {
  const AGENT_SLUG = 'web-research-001';
  let modelFixture: { url: string; close(): Promise<void> };
  let capturedRequests: string[] = [];

  before(() => {
    saveEnv();
    applyMigrations(db);
    syncAgentRegistry(); // the real 4,001+ registry (idempotent)
    capturedRequests = [];
  });

  after(async () => {
    await modelFixture?.close();
    restoreEnv();
  });

  // ── Section 4: configured owner identity ─────────────────────────────────

  it('promotes ONLY the configured email, one-way and audited; unset config promotes nobody', () => {
    const ownerEmail = `mission-owner-${Date.now()}@akbaral.test`;
    const otherEmail = `mission-other-${Date.now()}@akbaral.test`;
    db.run("INSERT INTO users (id, email, password_hash, name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)", [
      `usr_mo_${Date.now()}`, ownerEmail, null, 'Mission Owner', new Date().toISOString(), new Date().toISOString(),
    ]);
    db.run("INSERT INTO users (id, email, password_hash, name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)", [
      `usr_mt_${Date.now()}`, otherEmail, null, 'Mission Other', new Date().toISOString(), new Date().toISOString(),
    ]);

    // Unset config: nobody is promoted.
    delete process.env.AKBARAL_OWNER_EMAIL;
    assert.equal(syncConfiguredOwnerIdentity(), null);
    assert.equal(findUserByEmail(ownerEmail)!.role, 'user');

    // Configured: only the matching active account is promoted (audited).
    process.env.AKBARAL_OWNER_EMAIL = ownerEmail;
    const result = syncConfiguredOwnerIdentity();
    assert.deepEqual(result, { promoted: true, email: ownerEmail });
    assert.equal(findUserByEmail(ownerEmail)!.role, 'owner');
    assert.equal(findUserByEmail(otherEmail)!.role, 'user');
    const audit = db.all("SELECT action FROM audit_logs WHERE action = 'owner_identity_promoted' ORDER BY created_at DESC LIMIT 1");
    assert.equal(audit.length, 1, 'promotion is audited');

    // One-way: a second sync promotes nothing (already owner).
    assert.equal(syncConfiguredOwnerIdentity()!.promoted, false);

    // Suspended accounts are never promoted.
    const suspendedEmail = `mission-susp-${Date.now()}@akbaral.test`;
    db.run("INSERT INTO users (id, email, password_hash, name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'user', 'suspended', ?, ?)", [
      `usr_ms_${Date.now()}`, suspendedEmail, null, 'Suspended', new Date().toISOString(), new Date().toISOString(),
    ]);
    process.env.AKBARAL_OWNER_EMAIL = suspendedEmail;
    syncConfiguredOwnerIdentity();
    assert.equal(findUserByEmail(suspendedEmail)!.role, 'user');

    assert.equal(configuredOwnerEmail(), suspendedEmail);
    delete process.env.AKBARAL_OWNER_EMAIL;
    assert.equal(configuredOwnerEmail(), null);
  });

  // ── Section 5: mission chat, service level ───────────────────────────────

  it('rejects unknown agents (the registry is the only source of agents)', async () => {
    const ownerId = 'usr_unknown_agent_test';
    await assert.rejects(
      () => missionChatWithAgent({ ownerUserId: ownerId, agentSlug: 'does-not-exist-9999', content: 'status?' }),
      (error: unknown) => error instanceof MissionChatError && error.statusCode === 404,
    );
  });

  it('fails honestly without a provider — owner message stored + audited, structured failure, never a fabricated reply', async () => {
    const ownerEmail = `mission-chat-noauth-${Date.now()}@akbaral.test`;
    db.run("INSERT INTO users (id, email, password_hash, name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?)", [
      `usr_mc1_${Date.now()}`, ownerEmail, null, 'Chat Owner', new Date().toISOString(), new Date().toISOString(),
    ]);
    const ownerId = findUserByEmail(ownerEmail)!.id;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;

    const { ownerMessage, agentMessage } = await missionChatWithAgent({ ownerUserId: ownerId, agentSlug: AGENT_SLUG, content: 'Report your current status.' });
    assert.equal(ownerMessage.direction, 'owner');
    assert.equal(agentMessage.direction, 'agent');
    assert.equal(agentMessage.status, 'failed');
    assert.equal(agentMessage.error_code, 'provider_not_configured');
    assert.match(agentMessage.content, /provider_not_configured|AI providers are not configured/i);
    // Both messages persisted + audited.
    const stored = listMissionMessages(ownerId, AGENT_SLUG);
    assert.equal(stored.filter((m) => m.direction === 'owner').length, 1);
    const kinds = listEconomyEvents(200).map((e) => e.kind);
    assert.ok(kinds.includes('mission_chat_owner_message'), 'owner message audited');
    assert.ok(kinds.includes('mission_chat_agent_reply_failed'), 'honest failure audited');
  });

  it('replies through a real provider endpoint, redacts secrets, never sends system instructions', async () => {
    const ownerEmail = `mission-chat-real-${Date.now()}@akbaral.test`;
    db.run("INSERT INTO users (id, email, password_hash, name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?)", [
      `usr_mc2_${Date.now()}`, ownerEmail, null, 'Chat Owner 2', new Date().toISOString(), new Date().toISOString(),
    ]);
    const ownerId = findUserByEmail(ownerEmail)!.id;

    const agent = getAgentBySlug(AGENT_SLUG)!;
    assert.ok(agent, 'registry agent exists');
    const fakeKey = `AIza${'Sy1234567890abcdefghijklm'}`; // redaction fixture, not a real key
    modelFixture = await startJsonServer((_req, body) => {
      capturedRequests.push(body);
      return {
        choices: [{ message: { content: `Status report: 3 tasks completed this week, earnings $0 (honest zero). Verification passed. Example redaction: ${fakeKey}` } }],
        usage: { prompt_tokens: 80, completion_tokens: 120 },
      };
    });
    process.env.OPENAI_API_KEY = 'mission-chat-fixture-key';
    process.env.OPENAI_BASE_URL = `${modelFixture.url}/v1`;
    try {
      const { ownerMessage, agentMessage } = await missionChatWithAgent({ ownerUserId: ownerId, agentSlug: AGENT_SLUG, content: 'Report your status and earnings.' });
      assert.equal(ownerMessage.status, 'completed');
      assert.equal(agentMessage.status, 'completed');
      assert.ok(agentMessage.model_key, 'the producing model is recorded');
      assert.ok(agentMessage.content.includes('Status report'), 'real provider reply stored');
      assert.ok(!agentMessage.content.includes(fakeKey), 'secret material in provider output is REDACTED before storage');
      assert.ok(agentMessage.content.includes('[REDACTED]'));

      // The model context NEVER contains the agent's internal system instructions.
      const systemPrompt = capturedRequests.join('\n');
      assert.ok(systemPrompt.includes(AGENT_SLUG), 'public agent identity is in the context');
      if (agent.systemInstructions && agent.systemInstructions.trim().length > 20) {
        assert.ok(!systemPrompt.includes(agent.systemInstructions), 'internal system instructions must never be sent');
      }

      // History + threads + audit.
      const history = missionChatHistory(ownerId, AGENT_SLUG);
      assert.ok(history.messages.length >= 2);
      assert.equal(history.agent.slug, AGENT_SLUG);
      const kinds = listEconomyEvents(200).map((e) => e.kind);
      assert.ok(kinds.includes('mission_chat_agent_reply'), 'successful reply audited');
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
      await modelFixture.close();
    }
  });

  // ── Section 5 + 10: HTTP isolation (owner-only surface) ──────────────────

  describe('HTTP surface (owner-only mission chat)', () => {
    let api: ApiServer;
    let baseUrl = '';
    const email = `mission-http-user-${Date.now()}@akbaral.test`;
    const ownerEmail = `mission-http-owner-${Date.now()}@akbaral.test`;
    const adminEmail = `mission-http-admin-${Date.now()}@akbaral.test`;

    before(async () => {
      api = createApiServer();
      await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', () => resolve()));
      baseUrl = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
      const accounts: Array<[string, string]> = [[email, 'user'], [ownerEmail, 'owner'], [adminEmail, 'admin']];
      for (const [accountEmail, role] of accounts) {
        await fetch(`${baseUrl}/api/auth/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: accountEmail, password: 'correct-horse-battery-staple', name: `Mission ${role}` }),
        });
      }
      db.run('UPDATE users SET role = ? WHERE email = ?', ['owner', ownerEmail]);
      db.run('UPDATE users SET role = ? WHERE email = ?', ['admin', adminEmail]);
    });

    after(async () => {
      await new Promise<void>((resolve) => api.server.close(() => resolve()));
    });

    async function loginAs(accountEmail: string): Promise<string> {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: accountEmail, password: 'correct-horse-battery-staple' }),
      });
      assert.equal(response.status, 200);
      return ((await response.json()) as { accessToken: string }).accessToken;
    }

    it('rejects anonymous access (401)', async () => {
      const response = await fetch(`${baseUrl}/api/economy/agents/${AGENT_SLUG}/chat`);
      assert.equal(response.status, 401);
    });

    it('rejects ordinary users and staff admins (403) — mission chat is invisible to non-owners', async () => {
      const userToken = await loginAs(email);
      const adminToken = await loginAs(adminEmail);
      for (const token of [userToken, adminToken]) {
        for (const path of [`/api/economy/agents/${AGENT_SLUG}/chat`, '/api/economy/chat/threads']) {
          const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
          assert.equal(response.status, 403, `${path} must reject non-owner roles (got ${response.status})`);
        }
        const post = await fetch(`${baseUrl}/api/economy/agents/${AGENT_SLUG}/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ content: 'hello' }),
        });
        assert.equal(post.status, 403);
      }
    });

    it('serves the owner: history, threads, and a chat exchange (provider missing → honest structured failure)', async () => {
      const ownerToken = await loginAs(ownerEmail);
      const history = await fetch(`${baseUrl}/api/economy/agents/${AGENT_SLUG}/chat`, { headers: { authorization: `Bearer ${ownerToken}` } });
      assert.equal(history.status, 200);
      const threads = await fetch(`${baseUrl}/api/economy/chat/threads`, { headers: { authorization: `Bearer ${ownerToken}` } });
      assert.equal(threads.status, 200);

      const send = await fetch(`${baseUrl}/api/economy/agents/${AGENT_SLUG}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ content: 'Summarize your week.' }),
      });
      assert.equal(send.status, 200);
      const body = (await send.json()) as { ownerMessage: { direction: string }; agentMessage: { direction: string; status: string; error_code: string | null } };
      assert.equal(body.ownerMessage.direction, 'owner');
      assert.equal(body.agentMessage.direction, 'agent');
      // No provider is configured in this HTTP test context → honest failure.
      assert.equal(body.agentMessage.status, 'failed');
      assert.equal(body.agentMessage.error_code, 'provider_not_configured');
    });

    it('404s for unknown agents (owner too)', async () => {
      const ownerToken = await loginAs(ownerEmail);
      const response = await fetch(`${baseUrl}/api/economy/agents/no-such-agent-xyz/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ content: 'hello' }),
      });
      assert.equal(response.status, 404);
    });
  });
});
