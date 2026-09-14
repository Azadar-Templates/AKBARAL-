import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { db } from '../db';
import { applyMigrations } from '../db/migrate';
import { syncAgentRegistry } from '../agents/registry';
import { startResearchFixture, type ResearchFixtureServer } from '../test-support/research-fixture';
import { createApiServer, type ApiServer } from '../app';

/**
 * PHASE 3 — complete real user-flow QA, as a permanent regression lock.
 *
 * Walks the entire launch journey over real HTTP against the real API
 * server (no mocks of OUR code; the only fixtures are the local model
 * provider + search endpoints, standing in for Gemini/search because the
 * sandbox has no external egress):
 *
 *   signup → login → session → dashboard → workspace → task creation →
 *   planner → agent selection → tool execution → model execution →
 *   verification → final result → task history/detail → retry →
 *   file upload/index/search → agents explorer → agent detail →
 *   Agent Factory → settings → billing/pricing → logout →
 *   refresh rotation/revocation
 *
 * Credit accounting rules verified end-to-end:
 *   - Free Trial = 5 tasks at signup
 *   - a credit is consumed ONLY after successful completion
 *   - a failed run refunds (never silently consumes) the task
 *   - usage accounting is accurate; no client-side bypass of credits
 *
 * Authorization negatives: anonymous 401s, cross-tenant 404s (task,
 * project, knowledge search), and no client-writable credit field.
 */

const SAVED_ENV: Record<string, string | undefined> = {};
const ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL'];

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

const MODEL_ANSWER = [
  '## AKBARAL! in 5 bullet points',
  '- **One intelligence system**: AKBARAL! is an autonomous operating system for work — a MASTER orchestrator that understands a goal, plans the mission and dispatches real specialist agents.',
  '- **4,001 specialists**: a real registry of focused agents, each with its own instructions, tools and verification rules.',
  '- **Verified output**: every step passes output verification before the result is presented.',
  '- **Honest accounting**: credits are consumed only for successfully completed work; failures refund.',
  '- **Workspace-first**: projects, files and knowledge stay isolated per user and workspace.',
].join('\n');

describe('PHASE 3: complete user journey (real HTTP, end to end)', () => {
  let api: ApiServer;
  let baseUrl = '';
  let modelFixture: { url: string; close(): Promise<void> };
  let researchFixture: ResearchFixtureServer;

  const journey = {
    email: '',
    password: '',
    accessToken: '',
    refreshToken: '',
    projectId: '',
    workflowId: '',
    taskId: '',
    fileId: '',
  };

  async function call(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, any> }> {
    const response = await fetch(`${baseUrl}${path}`, init);
    const text = await response.text();
    let body: Record<string, any> = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    return { status: response.status, body };
  }
  const authJson = (token: string): RequestInit['headers'] => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  before(async () => {
    saveEnv();
    applyMigrations(db);
    syncAgentRegistry();
    researchFixture = await startResearchFixture();
    modelFixture = await startJsonServer(() => ({
      choices: [{ message: { content: MODEL_ANSWER } }],
      usage: { prompt_tokens: 90, completion_tokens: 180 },
    }));
    process.env.OPENAI_API_KEY = 'journey-fixture-key';
    process.env.OPENAI_BASE_URL = `${modelFixture.url}/v1`;
    api = createApiServer();
    await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => api.server.close(() => resolve()));
    await researchFixture.close();
    await modelFixture.close();
    restoreEnv();
  });

  it('1-3. signup → login → session (free trial = 5 tasks)', async () => {
    journey.email = `journey-${Date.now()}@akbaral.test`;
    journey.password = 'correct-horse-battery-staple';
    const register = await call('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: journey.email, password: journey.password, name: 'Journey User' }),
    });
    assert.equal(register.status, 201, 'signup 201');

    const login = await call('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: journey.email, password: journey.password }),
    });
    assert.equal(login.status, 200, 'login 200');
    assert.ok(login.body.accessToken && login.body.refreshToken, 'session tokens issued');
    journey.accessToken = login.body.accessToken;
    journey.refreshToken = login.body.refreshToken;

    const me = await call('/api/me', { headers: { authorization: `Bearer ${journey.accessToken}` } });
    assert.equal(me.status, 200, 'session resolves');
    assert.equal(me.body.user.email, journey.email);
    assert.equal(me.body.user.role, 'user');
    assert.equal(me.body.user.freeCredits, 5, 'Free Trial grants exactly 5 tasks');
  });

  it('4. dashboard renders current user state (empty task history)', async () => {
    const tasks = await call('/api/tasks', { headers: { authorization: `Bearer ${journey.accessToken}` } });
    assert.equal(tasks.status, 200);
    assert.deepEqual(tasks.body.tasks, [], 'fresh account has no tasks');
  });

  it('5. workspace: create + list a project', async () => {
    const created = await call('/api/projects', {
      method: 'POST',
      headers: authJson(journey.accessToken),
      body: JSON.stringify({ name: 'Journey Workspace', description: 'PHASE 3 journey project' }),
    });
    assert.equal(created.status, 201, 'project created');
    journey.projectId = created.body.project.id;
    const list = await call('/api/projects', { headers: { authorization: `Bearer ${journey.accessToken}` } });
    assert.ok(list.body.projects.some((p: { id: string }) => p.id === journey.projectId), 'project listed');
  });

  it('6-8. task creation → planner → agent selection (MASTER flow)', async () => {
    const plan = await call('/api/workflows/master', {
      method: 'POST',
      headers: authJson(journey.accessToken),
      body: JSON.stringify({ goal: 'What is AKBARAL! in 5 short bullet points' }),
    });
    assert.equal(plan.status, 202, 'plan accepted');
    journey.workflowId = plan.body.workflow.id;
    assert.ok(journey.workflowId, 'workflow id present');
    const steps = plan.body.plan?.steps ?? [];
    assert.ok(steps.length >= 1, `planner produced ${steps.length} step(s)`);
    assert.ok(steps[0].agentSlug || steps[0].agent, 'a specialist agent was selected');
  });

  it('9-12. tool execution → model execution → verification → final result', async () => {
    const run = await call(`/api/workflows/${journey.workflowId}/run`, { method: 'POST', headers: authJson(journey.accessToken), body: '{}' });
    assert.equal(run.status, 202, 'run accepted');

    let workflow: Record<string, any> | null = null;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await sleep(1500);
      const state = await call(`/api/workflows/${journey.workflowId}`, { headers: { authorization: `Bearer ${journey.accessToken}` } });
      workflow = state.body.workflow;
      if (['completed', 'failed', 'cancelled'].includes(String(workflow?.status))) break;
    }
    assert.equal(workflow?.status, 'completed', `workflow completed (error: ${workflow?.error_message ?? 'none'})`);

    const parsed = workflow?.result_json ? JSON.parse(workflow.result_json) : {};
    const finalResult = parsed.finalResult ?? parsed;
    const sections = (finalResult.sections ?? []).filter((s: { status: string }) => s.status === 'completed');
    assert.ok(sections.length >= 1, 'a completed section exists');
    assert.ok(/AKBARAL/i.test(String(sections[0].content)), 'final answer addresses the goal');
    assert.ok(typeof finalResult.executiveSummary === 'string' && finalResult.executiveSummary.length > 0, 'executive summary for rendering');
  });

  it('13. task history + detail carry the record (model + verification + agent)', async () => {
    const list = await call('/api/tasks', { headers: { authorization: `Bearer ${journey.accessToken}` } });
    assert.equal(list.status, 200);
    const completed = (list.body.tasks ?? []).find((t: { status: string }) => ['completed', 'succeeded'].includes(String(t.status)));
    assert.ok(completed, 'task center lists the completed task');
    journey.taskId = completed.id;

    const detail = await call(`/api/tasks/${journey.taskId}`, { headers: { authorization: `Bearer ${journey.accessToken}` } });
    assert.equal(detail.status, 200);
    const detailText = JSON.stringify(detail.body);
    assert.ok(/research-researcher-\d+/.test(detailText), 'the dispatched agent is in the record');
    const logMessages = (detail.body.logs ?? []).map((l: { message?: string }) => String(l.message ?? '')).join('\n');
    assert.ok(/verification/i.test(logMessages), 'verification evidence present in logs');
    assert.ok(!/something went wrong/i.test(detailText), 'no error copy on result surfaces');
  });

  it('14. retry path: a second run also completes; credits account exactly (5 → 4 → 3)', async () => {
    const meAfterFirst = await call('/api/me', { headers: { authorization: `Bearer ${journey.accessToken}` } });
    assert.equal(meAfterFirst.body.user.freeCredits, 4, 'exactly one credit consumed by the first success');

    const second = await call('/api/workflows/master', {
      method: 'POST',
      headers: authJson(journey.accessToken),
      body: JSON.stringify({ goal: 'Summarize what AKBARAL! verification does in 3 bullets' }),
    });
    assert.equal(second.status, 202);
    const workflowId = second.body.workflow.id;
    await call(`/api/workflows/${workflowId}/run`, { method: 'POST', headers: authJson(journey.accessToken), body: '{}' });

    let workflow: Record<string, any> | null = null;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await sleep(1500);
      const state = await call(`/api/workflows/${workflowId}`, { headers: { authorization: `Bearer ${journey.accessToken}` } });
      workflow = state.body.workflow;
      if (['completed', 'failed', 'cancelled'].includes(String(workflow?.status))) break;
    }
    assert.equal(workflow?.status, 'completed', 'retry run completed');

    const meAfterSecond = await call('/api/me', { headers: { authorization: `Bearer ${journey.accessToken}` } });
    assert.equal(meAfterSecond.body.user.freeCredits, 3, 'second success consumed exactly one more credit');

    const usage = await call('/api/billing/usage', { headers: { authorization: `Bearer ${journey.accessToken}` } });
    assert.equal(usage.status, 200, 'usage statement available');
  });

  it('14b. failure path: provider failure refunds the task (credits unchanged)', async () => {
    // Break the provider (connection refused) → the run must fail honestly and
    // the credit must be restored, never silently consumed.
    const previousBaseUrl = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1'; // nothing listens on :9
    try {
      const doomed = await call('/api/workflows/master', {
        method: 'POST',
        headers: authJson(journey.accessToken),
        body: JSON.stringify({ goal: 'This goal will fail because the provider is down' }),
      });
      assert.equal(doomed.status, 202);
      const workflowId = doomed.body.workflow.id;
      await call(`/api/workflows/${workflowId}/run`, { method: 'POST', headers: authJson(journey.accessToken), body: '{}' });

      let workflow: Record<string, any> | null = null;
      const deadline = Date.now() + 240_000;
      while (Date.now() < deadline) {
        await sleep(2000);
        const state = await call(`/api/workflows/${workflowId}`, { headers: { authorization: `Bearer ${journey.accessToken}` } });
        workflow = state.body.workflow;
        if (['completed', 'failed', 'cancelled'].includes(String(workflow?.status))) break;
      }
      assert.equal(workflow?.status, 'failed', `run fails honestly (error: ${workflow?.error_message ?? 'none'})`);

      const meAfterFailure = await call('/api/me', { headers: { authorization: `Bearer ${journey.accessToken}` } });
      assert.equal(meAfterFailure.body.user.freeCredits, 3, 'failed run refunded — credits unchanged');
    } finally {
      process.env.OPENAI_BASE_URL = previousBaseUrl;
    }
  });

  it('15. file upload → knowledge index → knowledge search', async () => {
    const form = new FormData();
    form.append('file', new Blob(['The zanzibar-quantum compass points to the AKBARAL journey archive.'], { type: 'text/plain' }), 'journey-notes.txt');
    const upload = await call(`/api/projects/${journey.projectId}/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${journey.accessToken}` },
      body: form,
    });
    assert.equal(upload.status, 201, `upload 201 (got ${upload.status}: ${JSON.stringify(upload.body).slice(0, 200)})`);
    journey.fileId = upload.body.file.fileId;

    const index = await call(`/api/files/${journey.fileId}/knowledge`, {
      method: 'POST',
      headers: authJson(journey.accessToken),
      body: JSON.stringify({ content: 'The zanzibar-quantum compass points to the AKBARAL journey archive. It records every step of the user journey test.' }),
    });
    assert.equal(index.status, 201, 'knowledge indexed from the uploaded file');

    const search = await call('/api/files/knowledge/search', {
      method: 'POST',
      headers: authJson(journey.accessToken),
      body: JSON.stringify({ query: 'zanzibar-quantum' }),
    });
    assert.equal(search.status, 200);
    assert.ok((search.body.results ?? []).length >= 1, 'knowledge search finds the indexed document');
    assert.ok((search.body.knowledgeItems ?? 0) >= 1, 'knowledge base is non-empty');
  });

  it('16-17. agents explorer + agent detail (4,001+ registry)', async () => {
    const explore = await call('/api/agents?limit=5', { headers: { authorization: `Bearer ${journey.accessToken}` } });
    assert.equal(explore.status, 200);
    const agents = explore.body.agents ?? explore.body.results ?? [];
    assert.ok(agents.length >= 1, 'explorer returns agents');

    const detail = await call('/api/marketplace/web-research-001', { headers: { authorization: `Bearer ${journey.accessToken}` } });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.agent?.slug ?? detail.body.slug, 'web-research-001', 'agent detail resolves');
  });

  it('18. Agent Factory: templates + create-from-template', async () => {
    const templates = await call('/api/factory/templates', { headers: { authorization: `Bearer ${journey.accessToken}` } });
    assert.equal(templates.status, 200);
    const list = templates.body.templates ?? [];
    assert.ok(list.length >= 1, 'factory templates available');
    const slug = list[0].slug ?? list[0].template_slug;

    const created = await call('/api/factory/agents/from-template', {
      method: 'POST',
      headers: authJson(journey.accessToken),
      body: JSON.stringify({ template_slug: slug, name: 'Journey Custom Agent' }),
    });
    assert.equal(created.status, 201, `agent created from template (got ${created.status})`);
    assert.ok(created.body.agent?.slug, 'created agent has a slug');
  });

  it('18b. Agent Factory: business failures answer honestly (never a 500)', async () => {
    const authorized = { headers: authJson(journey.accessToken) };
    const token = journey.accessToken;
    // Unique per run: the agent is a durable row, so a fixed slug would make
    // this test non-repeatable against a persistent database.
    const slug = `journey-launch-check-${Date.now().toString(36)}`;
    const created = await call('/api/factory/agents', {
      method: 'POST',
      headers: authJson(token),
      body: JSON.stringify({
        name: 'Journey Launch Check Agent',
        specialization: 'launch-verification',
        description: 'Verifies factory lifecycle behaviour over real HTTP.',
        system_instructions: 'Report only verified findings.',
        slug,
      }),
    });
    assert.equal(created.status, 201, `factory agent created (got ${created.status})`);

    // Invalid input is a validation error, not an internal server error.
    const badStatus = await call(`/api/factory/agents/${slug}/status`, {
      method: 'POST',
      headers: authJson(token),
      body: JSON.stringify({ status: 'published' }),
    });
    assert.equal(badStatus.status, 400, `invalid status rejected as 400 (got ${badStatus.status})`);
    assert.equal(badStatus.body?.error?.code, 'validation_error');

    // Unknown version → 404, unknown agent → 404 (both used to be 500s).
    const badRollback = await call(`/api/factory/agents/${slug}/rollback`, {
      method: 'POST',
      headers: authJson(token),
      body: JSON.stringify({ version: '9.9.9' }),
    });
    assert.equal(badRollback.status, 404, `unknown version is a 404 (got ${badRollback.status})`);

    const missing = await call('/api/factory/agents/does-not-exist-xyz/status', {
      method: 'POST',
      headers: authJson(token),
      body: JSON.stringify({ status: 'active' }),
    });
    assert.ok([403, 404].includes(missing.status), `unknown agent refused with 403/404 (got ${missing.status})`);

    // A valid lifecycle transition still works: version then rollback.
    const versioned = await call(`/api/factory/agents/${slug}/version`, {
      method: 'POST',
      headers: authJson(token),
      body: JSON.stringify({ changelog: 'journey verification' }),
    });
    assert.equal(versioned.status, 200, `version bumped (got ${versioned.status})`);
    const rollback = await call(`/api/factory/agents/${slug}/rollback`, {
      method: 'POST',
      headers: authJson(token),
      body: JSON.stringify({ version: '1.0.0' }),
    });
    assert.equal(rollback.status, 200, `rollback succeeded (got ${rollback.status})`);

    const status = await call(`/api/factory/agents/${slug}/status`, {
      method: 'POST',
      headers: authJson(token),
      body: JSON.stringify({ status: 'active' }),
    });
    assert.equal(status.status, 200, `valid status change accepted (got ${status.status})`);

    // Ownership: another account may not manage this agent.
    const outsiderEmail = `journey-outsider-${Date.now()}@akbaral.test`;
    const registered = await call('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: outsiderEmail, password: 'correct-horse-battery-staple-1', name: 'Outsider' }),
    });
    assert.equal(registered.status, 201, `outsider registered (got ${registered.status})`);
    const outsiderLogin = await call('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: outsiderEmail, password: 'correct-horse-battery-staple-1' }),
    });
    assert.equal(outsiderLogin.status, 200, `outsider logged in (got ${outsiderLogin.status})`);
    const outsiderToken = outsiderLogin.body.accessToken as string;
    const foreign = await call(`/api/factory/agents/${slug}/status`, {
      method: 'POST',
      headers: authJson(outsiderToken),
      body: JSON.stringify({ status: 'disabled' }),
    });
    assert.equal(foreign.status, 403, `non-owner refused with 403 (got ${foreign.status})`);
    void authorized;
  });

  it('19. settings/profile: /api/me reflects account state', async () => {
    const me = await call('/api/me', { headers: { authorization: `Bearer ${journey.accessToken}` } });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.name, 'Journey User');
    // No client-side credit bypass: there is no writable endpoint, and any
    // rogue PATCH is refused while credits stay server-controlled.
    const rogue = await call('/api/me', {
      method: 'PATCH',
      headers: authJson(journey.accessToken),
      body: JSON.stringify({ freeCredits: 999 }),
    });
    assert.ok([404, 405].includes(rogue.status), ` rogue PATCH refused (${rogue.status})`);
    const still = await call('/api/me', { headers: { authorization: `Bearer ${journey.accessToken}` } });
    assert.equal(still.body.user.freeCredits, 3, 'credits are server-side only');
  });

  it('20. billing/pricing: public plans, account, honest manual credit order', async () => {
    const plans = await call('/api/billing/plans');
    assert.equal(plans.status, 200);
    assert.ok((plans.body.plans ?? []).length >= 6, 'six-tier plan catalog served');

    const account = await call('/api/billing/account', { headers: { authorization: `Bearer ${journey.accessToken}` } });
    assert.equal(account.status, 200, 'billing account state');

    const order = await call('/api/billing/credits', {
      method: 'POST',
      headers: authJson(journey.accessToken),
      body: JSON.stringify({ credits: 10, amount_cents: 1000, provider: 'manual' }),
    });
    assert.equal(order.status, 201, 'manual credit order creates a due invoice (honest: no provider configured)');
    assert.equal(order.body.order.status, 'pending', 'manual order awaits real external payment — never auto-granted');
  });

  it('21-22. logout + refresh rotation/revocation', async () => {
    // Rotate: the old refresh token must die immediately.
    const rotated = await call('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: journey.refreshToken }),
    });
    assert.equal(rotated.status, 200, 'refresh rotation issues a new pair');
    const newRefresh = rotated.body.refreshToken;
    const reused = await call('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: journey.refreshToken }),
    });
    assert.equal(reused.status, 401, 'the pre-rotation refresh token is revoked');

    // The rotated access token works, then logout kills the session.
    const me = await call('/api/me', { headers: { authorization: `Bearer ${rotated.body.accessToken}` } });
    assert.equal(me.status, 200, 'rotated access token valid');

    const logout = await call('/api/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: newRefresh }),
    });
    assert.equal(logout.status, 204, 'logout 204');

    const afterLogout = await call('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: newRefresh }),
    });
    assert.equal(afterLogout.status, 401, 'logged-out refresh token is revoked');
    const meAfter = await call('/api/me', { headers: { authorization: `Bearer ${rotated.body.accessToken}` } });
    assert.ok([401, 403].includes(meAfter.status), 'access token no longer authenticates after logout');
  });

  it('security negatives: anonymous 401s and cross-tenant isolation (indistinguishable 404s)', async () => {
    // Anonymous
    assert.equal((await call('/api/me')).status, 401, 'anonymous /api/me 401');
    assert.equal((await call('/api/workflows/master', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401, 'anonymous master 401');

    // Second, unrelated user
    const emailB = `journey-b-${Date.now()}@akbaral.test`;
    await call('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: emailB, password: 'another-horse-battery-9', name: 'User B' }),
    });
    const loginB = await call('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: emailB, password: 'another-horse-battery-9' }),
    });
    const tokenB = loginB.body.accessToken;

    // Cross-tenant access is a clean 404 (no existence leak)
    assert.equal((await call(`/api/tasks/${journey.taskId}`, { headers: { authorization: `Bearer ${tokenB}` } })).status, 404, 'user B cannot read A task');
    assert.equal((await call(`/api/projects/${journey.projectId}`, { headers: { authorization: `Bearer ${tokenB}` } })).status, 404, 'user B cannot read A project');
    assert.equal((await call(`/api/projects/${journey.projectId}/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenB}` },
      body: new FormData(),
    })).status, 404, 'user B cannot upload into A project');

    // Knowledge search is per-user: B finds nothing of A's
    const searchB = await call('/api/files/knowledge/search', {
      method: 'POST',
      headers: authJson(tokenB),
      body: JSON.stringify({ query: 'zanzibar-quantum' }),
    });
    assert.equal(searchB.status, 200);
    assert.equal((searchB.body.results ?? []).length, 0, 'knowledge search is tenant-isolated');
    assert.equal(searchB.body.knowledgeItems, 0, 'B has an empty knowledge base');

    // Ordinary users can NEVER reach ZA141251SA economy surfaces
    assert.equal((await call('/api/economy/dashboard', { headers: { authorization: `Bearer ${tokenB}` } })).status, 403, 'economy dashboard 403 for ordinary users');
  });
});
