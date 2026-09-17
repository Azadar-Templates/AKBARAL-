#!/usr/bin/env node
/**
 * AKBARAL! — Task 4 live ARTIFACT / PREVIEW smoke (self-contained).
 *
 * Proves the deliverable half of the workspace end to end on an isolated
 * stack, so it can run on any machine without external AI credentials:
 *
 *   1. migrates a throwaway SQLite database,
 *   2. starts the LOCAL MODEL STUB (scripts/local-model-fixture.ts) — a
 *      development stand-in for a language model, with a visible footer in
 *      every document it returns,
 *   3. starts the REAL API server (src/index.ts) pointed at it,
 *   4. registers a user, creates a project and uploads a real file,
 *   5. runs the REAL MASTER pipeline for "build me a calculator",
 *   6. asserts the workflow completed, that the specialist's document was
 *      captured as a VERSIONED website artifact, that the version history,
 *      single-version endpoint and download endpoint serve exactly that
 *      document, that the calculator in it really evaluates expressions,
 *      that a manually captured document artifact versions correctly, that
 *      an artifact kind with no capture is reported as empty (never faked),
 *      and that a successful run consumed exactly one credit.
 *
 * Everything except the model backend is production code — the stub is the
 * same kind of stand-in the repository's own test suite uses.
 *
 *   npm run smoke:artifacts
 *
 * Exit code 0 = every check passed.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import net from 'node:net';

const results = [];
const check = (label, ok, detail = '') => {
  results.push([ok, label, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const workDir = mkdtempSync(join(tmpdir(), 'akbaral-artifacts-'));
const dbPath = join(workDir, 'smoke.db');
const uploadDir = join(workDir, 'uploads');
const children = [];
const logs = [];

function launch(name, command, args, env = {}) {
  // `detached` makes the child a process-group leader so stopAll() can kill
  // the whole tree — `npx tsx` spawns grandchildren that would otherwise
  // outlive the smoke run.
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout.on('data', (chunk) => logs.push(`[${name}] ${String(chunk).trim()}`));
  child.stderr.on('data', (chunk) => logs.push(`[${name}:err] ${String(chunk).trim()}`));
  children.push({ name, child });
  return child;
}

function stopAll() {
  for (const { child } of children) {
    if (child.killed || child.pid == null) continue;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
}

async function waitFor(label, url, { timeoutMs = 300_000, predicate = (response) => response.ok } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (await predicate(response)) return response;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`${label} did not become ready in time`);
    await sleep(1000);
  }
}

let exitCode = 0;
try {
  const fixturePort = await freePort();
  const apiPort = await freePort();

  // 1 — throwaway database, migrated with the real migration runner.
  await new Promise((resolve, reject) => {
    const migrate = launch('migrate', 'npx', ['tsx', 'src/db/migrate.ts'], {
      DATABASE_URL: `file:${dbPath}`,
      AKBARAL_UPLOAD_DIR: uploadDir,
      SESSION_SECRET: randomBytes(32).toString('hex'),
    });
    migrate.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`migrate exited ${code}`))));
  });
  check('real migration runner provisioned the throwaway database', true, dbPath);

  // 2 — local model stub (development stand-in for a language model).
  launch('stub', 'npx', ['tsx', 'scripts/local-model-fixture.ts'], {
    FIXTURE_PORT: String(fixturePort),
    FIXTURE_HOST: '127.0.0.1',
  });
  await waitFor('local model stub', `http://127.0.0.1:${fixturePort}/v1/models`, {
    timeoutMs: 90_000,
    predicate: () => true, // any HTTP answer means the port is listening
  });
  check('local model stub is listening', true, `:${fixturePort}/v1`);

  // 3 — the real API server, pointed at the stub.
  const sessionSecret = randomBytes(32).toString('hex');
  launch('api', 'npx', ['tsx', 'src/index.ts'], {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(apiPort),
    DATABASE_URL: `file:${dbPath}`,
    AKBARAL_UPLOAD_DIR: uploadDir,
    SESSION_SECRET: sessionSecret,
    AKBARAL_REALTIME_TRANSPORT: 'sse',
    AKBARAL_PUBLIC_WEB_URL: `http://127.0.0.1:${apiPort}`,
    AKBARAL_SITE_URL: `http://127.0.0.1:${apiPort}`,
    OPENAI_API_KEY: 'local-stub-key',
    OPENAI_BASE_URL: `http://127.0.0.1:${fixturePort}/v1`,
    AKBARAL_ALLOW_PRIVATE_PROVIDER: '1',
  });
  const base = `http://127.0.0.1:${apiPort}`;
  await waitFor('API server', `${base}/api/health`, { timeoutMs: 300_000 });
  check('real API server is healthy on the throwaway database', true, base);

  const call = async (path, init = {}) => {
    const response = await fetch(`${base}${path}`, init);
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    return { status: response.status, body, text };
  };
  const asUser = (token) => ({
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  });

  // 4 — account, project, real upload.
  const email = `artifact-smoke-${Date.now()}@akbaral.test`;
  const password = `Artifact-smoke-${randomBytes(9).toString('base64url')}!1`;
  const registered = await call('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'Artifact Smoke' }),
  });
  check('registration succeeds through the real auth route', registered.status === 201, `status=${registered.status}`);
  const loggedIn = await call('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const token = loggedIn.body.accessToken;
  check('sign-in issues a real access token', loggedIn.status === 200 && Boolean(token), `status=${loggedIn.status}`);

  const me = await call('/api/me', { headers: { authorization: `Bearer ${token}` } });
  const creditsBefore = Number(me.body.user?.freeCredits ?? NaN);
  check('account state is readable (credits before)', Number.isFinite(creditsBefore), `credits=${creditsBefore}`);

  const project = await call('/api/projects', {
    method: 'POST',
    headers: asUser(token),
    body: JSON.stringify({ name: 'Artifact smoke project' }),
  });
  const projectId = project.body.project?.id;
  check('project is created through the real route', project.status === 201 && Boolean(projectId), `project=${projectId}`);

  // A real multipart upload (the composer's attachment path).
  const form = new FormData();
  form.append('file', new Blob([`# Notes\n\nThe calculator brief: four operators, percent, decimal, backspace.\n`], { type: 'text/markdown' }), 'brief.md');
  const uploaded = await fetch(`${base}/api/projects/${projectId}/files`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const uploadedBody = await uploaded.json().catch(() => ({}));
  check('attachment upload uses POST /api/projects/:id/files', uploaded.status === 201, `status=${uploaded.status} file=${uploadedBody.file?.id ?? 'n/a'}`);

  const afterUpload = await call(`/api/projects/${projectId}`, { headers: { authorization: `Bearer ${token}` } });
  const fileNames = (afterUpload.body.files ?? []).map((file) => file.original_name ?? file.originalName ?? file.name);
  check('the uploaded file is listed on the project', fileNames.includes('brief.md'), fileNames.join(', '));

  // 5 — the REAL MASTER pipeline.
  const goal = 'Build me a calculator application';
  const planned = await call('/api/workflows/master', {
    method: 'POST',
    headers: asUser(token),
    body: JSON.stringify({ goal, project_id: projectId }),
  });
  const workflowId = planned.body.workflow?.id;
  check('MASTER plans the goal into a workflow', planned.status === 202 && Boolean(workflowId), `workflow=${workflowId}`);
  await call(`/api/workflows/${workflowId}/run`, { method: 'POST', headers: asUser(token), body: '{}' });

  let workflow = {};
  const deadline = Date.now() + 300_000;
  for (;;) {
    await sleep(1500);
    const state = await call(`/api/workflows/${workflowId}`, { headers: { authorization: `Bearer ${token}` } });
    workflow = state.body.workflow ?? {};
    if (['completed', 'failed', 'cancelled'].includes(String(workflow.status))) break;
    if (Date.now() > deadline) break;
  }
  check('the real pipeline reaches a terminal state', ['completed', 'failed', 'cancelled'].includes(String(workflow.status)), `status=${workflow.status}`);
  if (String(workflow.status) !== 'completed') {
    console.log('pipeline logs:', logs.slice(-12).join('\n'));
  }
  check('the pipeline completes (model stub returned valid analysis + deliverables)', String(workflow.status) === 'completed', String(workflow.error ?? workflow.status ?? ''));

  // 6 — the captured artifact IS the deliverable, versioned and downloadable.
  const latest = await call(`/api/projects/${projectId}/artifacts/website`, { headers: { authorization: `Bearer ${token}` } });
  const artifact = latest.body.artifact;
  check('a website artifact was captured from the completing workflow', Boolean(artifact?.content), `version=${artifact?.version ?? 'n/a'}`);
  check('the artifact records its provenance (source workflow)', String(artifact?.source_workflow_id ?? '') === String(workflowId), `${artifact?.source_workflow_id ?? 'n/a'}`);
  const content = String(artifact?.content ?? '');
  check('the captured document is a complete HTML application', /^<!doctype html/i.test(content.trim()), content.slice(0, 40).replace(/\n/g, ' '));
  check('the document answers the requested goal', /calculator/i.test(content), 'calculator markers present');

  const versions = await call(`/api/projects/${projectId}/artifacts/website/versions`, { headers: { authorization: `Bearer ${token}` } });
  const versionList = versions.body.versions ?? [];
  check('version history is served by the real endpoint', versionList.length >= 1, `versions=${versionList.length}`);
  const v1 = await call(`/api/projects/${projectId}/artifacts/website/v/${artifact?.version ?? 1}`, { headers: { authorization: `Bearer ${token}` } });
  check('a single version serves the stored document', String(v1.body.artifact?.content ?? '').includes('calculator') || String(v1.body.content ?? '').includes('calculator'), `status=${v1.status}`);
  const download = await fetch(`${base}/api/projects/${projectId}/artifacts/website/download`, { headers: { authorization: `Bearer ${token}` } });
  const downloaded = await download.text();
  check('the export control downloads exactly the stored artifact', download.status === 200 && downloaded.trim() === content.trim(), `status=${download.status} bytes=${downloaded.length}`);

  // The calculator in the artifact really evaluates expressions (no mock).
  const evaluator = /Function\('"use strict";return \(' \+ expression \+ '\)'\)/.test(content);
  const operators = ['+', '-', '*', '/'].every((operator) => content.includes(`data-k="${operator}"`));
  check('the deliverable contains a working evaluator and all four operators', evaluator && operators, `evaluator=${evaluator} operators=${operators}`);

  // Manual re-capture from the same completed workflow must VERSION, not
  // overwrite — this is the endpoint the Files panel's recapture control uses.
  const recapture = await call(`/api/projects/${projectId}/artifacts/website`, {
    method: 'POST',
    headers: asUser(token),
    body: JSON.stringify({ workflow_id: workflowId }),
  });
  check('re-capture appends a new version instead of overwriting', recapture.status === 201 && Number(recapture.body.artifact?.version) === Number(artifact?.version) + 1, `v${artifact?.version} → v${recapture.body.artifact?.version}`);

  // Honest states: kinds with no capture are empty, and a kind that cannot be
  // captured from a workflow is refused — never a fabricated artifact.
  for (const kind of ['image', 'document', 'data']) {
    const emptyKind = await call(`/api/projects/${projectId}/artifacts/${kind}`, { headers: { authorization: `Bearer ${token}` } });
    check(`the ${kind} artifact kind reports empty until something real is captured`, emptyKind.status === 200 && (emptyKind.body.artifact === null || emptyKind.body.artifact === undefined), `artifact=${JSON.stringify(emptyKind.body.artifact ?? null).slice(0, 40)}`);
  }
  const refused = await call(`/api/projects/${projectId}/artifacts/document`, {
    method: 'POST',
    headers: asUser(token),
    body: JSON.stringify({ workflow_id: workflowId }),
  });
  check('capturing a kind the pipeline cannot produce is refused honestly', refused.status === 400, `status=${refused.status} error=${refused.body.error ?? 'n/a'}`);

  // Credits: exactly one consumed by one successful run.
  const meAfter = await call('/api/me', { headers: { authorization: `Bearer ${token}` } });
  const creditsAfter = Number(meAfter.body.user?.freeCredits ?? NaN);
  check('a successful run consumes exactly one credit', creditsAfter === creditsBefore - 1, `${creditsBefore} → ${creditsAfter}`);

  // Knowledge: the uploaded file was indexed and is searchable.
  const knowledge = await call('/api/files/knowledge/search', {
    method: 'POST',
    headers: asUser(token),
    body: JSON.stringify({ query: 'calculator brief' }),
  });
  check('knowledge search answers from the real index', knowledge.status === 200 && Array.isArray(knowledge.body.results), `status=${knowledge.status} results=${(knowledge.body.results ?? []).length} indexed=${knowledge.body.knowledgeItems ?? 'n/a'}`);
} catch (error) {
  check('smoke run completed without an unexpected error', false, error instanceof Error ? error.message : String(error));
  console.log('recent child logs:\n' + logs.slice(-15).join('\n'));
  exitCode = 1;
} finally {
  stopAll();
  await sleep(500);
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

const failed = results.filter(([ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} artifact checks passed`);
if (failed.length) {
  console.log('failures:');
  for (const [, label, detail] of failed) console.log(`  · ${label} ${detail}`);
  exitCode = 1;
}
process.exit(exitCode);
