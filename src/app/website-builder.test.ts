import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { db } from '../db';
import { applyMigrations } from '../db/migrate';
import { syncAgentRegistry } from '../agents/registry';
import { startResearchFixture, type ResearchFixtureServer } from '../test-support/research-fixture';
import { createApiServer, type ApiServer } from '../app';

/**
 * PART 1 + PART 2 — the website-builder flow, end to end over real HTTP.
 *
 * "Build me a website" → MASTER plans web-development specialists → the
 * builder produces a complete HTML document → the workflow runner captures it
 * as a VERSIONED project artifact → the modification goal ("remove the
 * contact section") receives the CURRENT version as real context (verified
 * against the captured provider request) → the modified document becomes the
 * next version → undo (revert) and export (download) operate on real state.
 *
 * Also locks PART 4: the owner's unlimited entitlement is enforced at the
 * server-side credit reservation point — owner executions consume no credits
 * (audited), while normal users keep exact accounting.
 */

const WEBSITE_V1 = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Aurora Coffee</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><header><h1>Aurora Coffee</h1></header>
<main><section id="about"><h2>About</h2><p>Small-batch roastery.</p></section>
<section id="contact"><h2>Contact</h2><p>hello@aurora.example</p></section></main>
<footer><p>© 2026 Aurora Coffee</p></footer></body></html>`;

const WEBSITE_V2 = WEBSITE_V1
  .replace('<section id="contact"><h2>Contact</h2><p>hello@aurora.example</p></section>', '')
  .replace('<title>Aurora Coffee</title>', '<title>Aurora Coffee — refined</title>');

function startModelFixture(): Promise<{
  url: string;
  close(): Promise<void>;
  seenBodies: () => string[];
  nextHtml: () => string;
}> {
  const seenBodies: string[] = [];
  let htmlAnswer = WEBSITE_V1;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
    req.on('end', () => {
      seenBodies.push(raw);
      const wantsModification = /remove|delete|change|modify/i.test(raw);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: wantsModification ? htmlAnswer : htmlAnswer } }],
        usage: { prompt_tokens: 150, completion_tokens: 400 },
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
        seenBodies: () => seenBodies,
        nextHtml: () => { htmlAnswer = WEBSITE_V2; return htmlAnswer; },
      });
    });
  });
}

describe('PART 1/2: website-builder flow (versioned artifacts + iterative editing)', () => {
  let api: ApiServer;
  let baseUrl = '';
  let model: Awaited<ReturnType<typeof startModelFixture>>;
  let researchFixture: ResearchFixtureServer;
  const SAVED_ENV: Record<string, string | undefined> = {};
  const ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL'];

  const user = { email: `builder-${Date.now()}@akbaral.test`, password: 'correct-horse-battery-staple', token: '', projectId: '' };

  async function call(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, any> }> {
    const response = await fetch(`${baseUrl}${path}`, init);
    const text = await response.text();
    let body: Record<string, any> = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    return { status: response.status, body };
  }
  const authJson = (token: string): RequestInit['headers'] => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  async function runMasterWorkflow(token: string, goal: string, projectId: string): Promise<{ status: number; workflow: Record<string, any> }> {
    const plan = await call('/api/workflows/master', { method: 'POST', headers: authJson(token), body: JSON.stringify({ goal, project_id: projectId }) });
    if (plan.status !== 202) return { status: plan.status, workflow: plan.body };
    const workflowId = plan.body.workflow.id;
    await call(`/api/workflows/${workflowId}/run`, { method: 'POST', headers: authJson(token), body: '{}' });
    const deadline = Date.now() + 180_000;
    for (;;) {
      await sleep(1500);
      const state = await call(`/api/workflows/${workflowId}`, { headers: { authorization: `Bearer ${token}` } });
      const workflow = state.body.workflow ?? {};
      if (['completed', 'failed', 'cancelled'].includes(String(workflow.status))) return { status: 200, workflow };
      if (Date.now() > deadline) return { status: 408, workflow };
    }
  }

  before(async () => {
    for (const key of ENV_KEYS) SAVED_ENV[key] = process.env[key];
    applyMigrations(db);
    syncAgentRegistry();
    researchFixture = await startResearchFixture();
    model = await startModelFixture();
    process.env.OPENAI_API_KEY = 'website-builder-fixture-key';
    process.env.OPENAI_BASE_URL = `${model.url}/v1`;
    api = createApiServer();
    await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => api.server.close(() => resolve()));
    await researchFixture.close();
    await model.close();
    for (const key of ENV_KEYS) {
      if (SAVED_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = SAVED_ENV[key]!;
    }
  });

  it('1-3. "Build me a website": plans web specialists and completes', async () => {
    await call('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password: user.password, name: 'Builder' }) } as RequestInit);
    const login = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password: user.password }) });
    user.token = login.body.accessToken;
    // Test scaffolding: the multi-step website flow consumes one credit per
    // specialist step (real accounting) — give the builder account enough
    // credits for several full runs.
    db.run('UPDATE credit_accounts SET free_credits = 50 WHERE user_id = (SELECT id FROM users WHERE email = ?)', [user.email]);
    const project = await call('/api/projects', { method: 'POST', headers: authJson(user.token), body: JSON.stringify({ name: 'Aurora Coffee Site' }) });
    user.projectId = project.body.project.id;

    const plan = await call('/api/workflows/master', { method: 'POST', headers: authJson(user.token), body: JSON.stringify({ goal: 'Build me a one-page website for a coffee shop', project_id: user.projectId }) });
    assert.equal(plan.status, 202);
    const steps = plan.body.plan?.steps ?? [];
    assert.ok(steps.length >= 1, 'planner produced steps');
    assert.ok(steps.some((s: { categorySlug?: string; goal?: string }) => String(s.categorySlug ?? '') === 'web-development' || /website/i.test(String(s.goal ?? ''))), 'the plan routes to web-development specialists');
  });

  it('4. the completed workflow auto-captures a VERSIONED website artifact', async () => {
    const run = await runMasterWorkflow(user.token, 'Build me a one-page website for a coffee shop', user.projectId);
    assert.equal(run.workflow.status, 'completed', `workflow completed (error: ${run.workflow.error_message ?? 'none'})`);

    const latest = await call(`/api/projects/${user.projectId}/artifacts/website`, { headers: { authorization: `Bearer ${user.token}` } });
    assert.ok(latest.body.artifact, 'a website artifact was captured automatically');
    assert.equal(latest.body.artifact.version, 1, 'first version');
    assert.ok(/<!doctype html/i.test(latest.body.artifact.content), 'the artifact is the full HTML document');
    assert.ok(latest.body.artifact.content.includes('Aurora Coffee'));
    assert.equal(latest.body.artifact.source_workflow_id, run.workflow.id, 'provenance: captured from the completing workflow');

    const versions = await call(`/api/projects/${user.projectId}/artifacts/website/versions`, { headers: { authorization: `Bearer ${user.token}` } });
    assert.equal(versions.body.versions.length, 1);
  });

  it('5. "Remove the contact section": the CURRENT version is injected as real context and the edit becomes v2', async () => {
    model.nextHtml(); // the provider now returns the modified document
    const run = await runMasterWorkflow(user.token, 'Remove the contact section from the website', user.projectId);
    assert.equal(run.workflow.status, 'completed', `modification run completed (error: ${run.workflow.error_message ?? 'none'})`);

    // The real proof of iterative editing: the modification request the
    // provider received contained the CURRENT project artifact (v1 HTML).
    const modificationRequest = model.seenBodies().find((body) => /Remove the contact section/i.test(body));

    assert.ok(modificationRequest, 'the modification goal reached the provider');
    assert.ok(modificationRequest!.includes('CURRENT PROJECT ARTIFACT v1'), 'the current artifact version was injected as context');
    assert.ok(modificationRequest!.includes('Aurora Coffee'), 'the actual v1 HTML traveled with the request');

    const latest = await call(`/api/projects/${user.projectId}/artifacts/website`, { headers: { authorization: `Bearer ${user.token}` } });
    assert.equal(latest.body.artifact.version, 2, 'the edit was captured as version 2');
    assert.ok(!latest.body.artifact.content.includes('id="contact"'), 'the contact section is gone in v2');
    assert.ok(latest.body.artifact.content.includes('refined'));
  });

  it('6. version history + specific version fetch are real', async () => {
    const versions = await call(`/api/projects/${user.projectId}/artifacts/website/versions`, { headers: { authorization: `Bearer ${user.token}` } });
    assert.deepEqual(versions.body.versions.map((v: { version: number }) => v.version), [2, 1], 'history is append-only, newest first');
    const v1 = await call(`/api/projects/${user.projectId}/artifacts/website/v/1`, { headers: { authorization: `Bearer ${user.token}` } });
    assert.ok(v1.body.artifact.content.includes('id="contact"'), 'v1 still holds the original document');
    const missing = await call(`/api/projects/${user.projectId}/artifacts/website/v/99`, { headers: { authorization: `Bearer ${user.token}` } });
    assert.equal(missing.status, 404);
  });

  it('7. undo: revert to v1 creates v3 with the original content (history never rewritten)', async () => {
    const revert = await call(`/api/projects/${user.projectId}/artifacts/website/revert/1`, { method: 'POST', headers: { authorization: `Bearer ${user.token}` } });
    assert.equal(revert.status, 201);
    assert.equal(revert.body.artifact.version, 3, 'revert appends a new version');
    assert.ok(revert.body.artifact.content.includes('id="contact"'), 'v3 carries the v1 content back');
    const versions = await call(`/api/projects/${user.projectId}/artifacts/website/versions`, { headers: { authorization: `Bearer ${user.token}` } });
    assert.equal(versions.body.versions.length, 3, 'all three versions remain in history');
  });

  it('8. export: download serves the latest version as a real HTML attachment', async () => {
    const response = await fetch(`${baseUrl}/api/projects/${user.projectId}/artifacts/website/download`, { headers: { authorization: `Bearer ${user.token}` } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(response.headers.get('content-disposition') ?? '', /attachment/);
    const html = await response.text();
    assert.ok(/<!doctype html/i.test(html));
  });

  it('9. manual re-capture from a completed workflow is validated honestly', async () => {
    const latest = await call(`/api/projects/${user.projectId}/artifacts/website`, { headers: { authorization: `Bearer ${user.token}` } });
    const capture = await call(`/api/projects/${user.projectId}/artifacts/website`, {
      method: 'POST',
      headers: authJson(user.token),
      body: JSON.stringify({ workflow_id: latest.body.artifact.source_workflow_id }),
    });
    assert.equal(capture.status, 201, 're-capture from the same workflow appends a new version');
    assert.equal(capture.body.artifact.version, 4);
    const badWorkflow = await call(`/api/projects/${user.projectId}/artifacts/website`, {
      method: 'POST',
      headers: authJson(user.token),
      body: JSON.stringify({ workflow_id: 'wfl_does_not_exist' }),
    });
    assert.equal(badWorkflow.status, 404);
  });

  it('10. cross-tenant isolation: another user gets a clean 404 on every artifact route', async () => {
    const emailB = `builder-b-${Date.now()}@akbaral.test`;
    await call('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: emailB, password: 'another-horse-9', name: 'B' }) });
    const loginB = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: emailB, password: 'another-horse-9' }) });
    const tokenB = loginB.body.accessToken;
    for (const path of [`/api/projects/${user.projectId}/artifacts/website`, `/api/projects/${user.projectId}/artifacts/website/versions`, `/api/projects/${user.projectId}/artifacts/website/v/1`, `/api/projects/${user.projectId}/artifacts/website/download`]) {
      assert.equal((await call(path, { headers: { authorization: `Bearer ${tokenB}` } })).status, 404, `${path} → 404 for non-members`);
    }
    const revert = await call(`/api/projects/${user.projectId}/artifacts/website/revert/1`, { method: 'POST', headers: { authorization: `Bearer ${tokenB}` } });
    assert.equal(revert.status, 404);
  });
});

describe('PART 4: owner unlimited entitlement (server-side)', () => {
  let api: ApiServer;
  let baseUrl = '';
  let model: Awaited<ReturnType<typeof startModelFixture>>;
  let researchFixture: ResearchFixtureServer;
  const SAVED_ENV: Record<string, string | undefined> = {};
  const ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL'];

  const owner = { email: `owner-unlimited-${Date.now()}@akbaral.test`, password: 'correct-horse-battery-staple', token: '' };
  const plain = { email: `plain-unlimited-${Date.now()}@akbaral.test`, password: 'correct-horse-battery-staple', token: '' };

  async function call(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, any> }> {
    const response = await fetch(`${baseUrl}${path}`, init);
    const text = await response.text();
    let body: Record<string, any> = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    return { status: response.status, body };
  }
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  before(async () => {
    for (const key of ENV_KEYS) SAVED_ENV[key] = process.env[key];
    applyMigrations(db);
    syncAgentRegistry();
    researchFixture = await startResearchFixture();
    model = await startModelFixture();
    process.env.OPENAI_API_KEY = 'owner-unlimited-fixture-key';
    process.env.OPENAI_BASE_URL = `${model.url}/v1`;
    api = createApiServer();
    await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => api.server.close(() => resolve()));
    await researchFixture.close();
    await model.close();
    for (const key of ENV_KEYS) {
      if (SAVED_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = SAVED_ENV[key]!;
    }
  });

  it('owner executions consume ZERO credits (audited); normal users consume exactly one per success', async () => {
    for (const account of [owner, plain]) {
      await call('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password, name: 'Entitlement' }) });
      const login = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password }) });
      account.token = login.body.accessToken;
    }
    // Elevate the owner account directly (the configured-identity path is
    // covered by the owner-identity battery).
    db.run('UPDATE users SET role = ? WHERE email = ?', ['owner', owner.email]);

    // Owner runs SIX successful workflows — more than any trial could cover.
    for (let round = 1; round <= 6; round += 1) {
      const plan = await call('/api/workflows/master', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ goal: 'Summarize what AKBARAL! verification does' }) });
      assert.equal(plan.status, 202, `owner plan ${round} accepted`);
      const workflowId = plan.body.workflow.id;
      await call(`/api/workflows/${workflowId}/run`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` }, body: '{}' });
      const deadline = Date.now() + 120_000;
      let status = '';
      for (;;) {
        await sleep(1500);
        const state = await call(`/api/workflows/${workflowId}`, { headers: { authorization: `Bearer ${owner.token}` } });
        status = String(state.body.workflow?.status ?? '');
        if (['completed', 'failed', 'cancelled'].includes(status)) break;
        if (Date.now() > deadline) break;
      }
      assert.equal(status, 'completed', `owner workflow ${round} completed`);
    }
    const ownerMe = await call('/api/me', { headers: { authorization: `Bearer ${owner.token}` } });
    assert.equal(ownerMe.body.user.freeCredits, 5, 'owner consumed ZERO credits across six executions (unlimited entitlement, server-side)');
    const ownerAudits = db.all("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'owner.unlimited_execution'").map((r) => Number((r as { n: number }).n))[0];
    assert.ok(ownerAudits >= 6, `every unlimited execution is audited (${ownerAudits} rows)`);

    // The contrast: a normal user's FIRST success consumes exactly one.
    const plan = await call('/api/workflows/master', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${plain.token}` }, body: JSON.stringify({ goal: 'Summarize what AKBARAL! verification does' }) });
    const workflowId = plan.body.workflow.id;
    await call(`/api/workflows/${workflowId}/run`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${plain.token}` }, body: '{}' });
    const deadline = Date.now() + 120_000;
    for (;;) {
      await sleep(1500);
      const state = await call(`/api/workflows/${workflowId}`, { headers: { authorization: `Bearer ${plain.token}` } });
      if (['completed', 'failed', 'cancelled'].includes(String(state.body.workflow?.status ?? ''))) break;
      if (Date.now() > deadline) break;
    }
    const plainMe = await call('/api/me', { headers: { authorization: `Bearer ${plain.token}` } });
    assert.equal(plainMe.body.user.freeCredits, 4, 'normal user accounting is unchanged (5 → 4)');
  });
});
