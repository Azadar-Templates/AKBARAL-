/**
 * Creates one real owner project and runs the REAL MASTER pipeline into it, so
 * the workspace, artifact preview, download and export routes have real data
 * (a project, a completed workflow and a versioned website artifact). Uses the
 * platform's own public API with the configured owner account — no direct
 * database writes.
 *
 *   node scripts/seed-owner-project.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const API = (process.env.API_BASE ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const credentials = (() => {
  const file = path.resolve(process.cwd(), '.platform-owner-credentials.txt');
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((line) => line.trim());
  return { email: lines[0], password: lines[1] };
})();

const call = async (route, { method = 'GET', body, token } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const login = await call('/api/auth/login', { method: 'POST', body: credentials });
const token = login.body?.accessToken;
if (!token) throw new Error(`owner login failed: HTTP ${login.status}`);

const existing = await call('/api/projects', { token });
if ((existing.body?.projects ?? []).length > 0) {
  console.log(JSON.stringify({ project: existing.body.projects[0].id, reused: true }));
  process.exit(0);
}

const project = await call('/api/projects', { method: 'POST', token, body: { name: 'AKBARAL launch workspace', description: 'Real owner project used for workspace verification.' } });
console.log('project', project.status, project.body?.project?.id);

const master = await call('/api/workflows/master', {
  method: 'POST',
  token,
  body: { goal: 'Build a one-page product website for the AKBARAL platform', project_id: project.body.project.id },
});
const workflowId = master.body?.workflow?.id;
console.log('master plan', master.status, workflowId);
await call(`/api/workflows/${workflowId}/run`, { method: 'POST', token, body: {} });

const deadline = Date.now() + 300_000;
let workflow = {};
for (;;) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const state = await call(`/api/workflows/${workflowId}`, { token });
  workflow = state.body?.workflow ?? {};
  if (['completed', 'failed', 'cancelled'].includes(String(workflow.status)) || Date.now() > deadline) break;
}
const artifact = await call(`/api/projects/${project.body.project.id}/artifacts/website`, { token });
console.log(JSON.stringify({
  projectId: project.body.project.id,
  workflowId,
  workflowStatus: workflow.status,
  artifactBytes: artifact.body?.artifact?.content ? String(artifact.body.artifact.content).length : 0,
  artifactVersion: artifact.body?.artifact?.version ?? null,
}));
