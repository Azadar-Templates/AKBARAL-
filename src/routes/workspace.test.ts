import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiServer, type ApiServer } from '../app';
import { startModelFixture, type ModelFixtureServer } from '../test-support/model-provider-fixture';
import { db } from '../db';
import { executionQueue } from '../orchestrator/queue';
import { syncAgentRegistry } from '../agents/registry';

/**
 * Milestone 5 — workspace/files/projects integration tests.
 *
 * Verifies through the real HTTP surface:
 *   - workspace membership: invite, list, role change, removal, self-leave,
 *     owner protection, and the owner/admin/member/viewer authorization matrix
 *   - member uploads (viewers denied), no-existence-leak 404s for outsiders
 *   - project-scoped knowledge search
 *   - task file attachments (attach/detach/list + ownership validation)
 *   - attachment content actually reaching the model as user-provided data
 *   - completed task outputs stored as downloadable project artifacts
 */

const suffix = randomBytes(6).toString('hex');
const password = 'correct-horse-battery-staple';

const savedEnv = new Map<string, string | undefined>();

async function register(baseUrl: string, label: string): Promise<{ id: string; token: string; email: string }> {
  const email = `m5-${label}-${suffix}@akbaral.test`;
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name: `M5 ${label}` }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as { user: { id: string } };
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200);
  const loginBody = (await login.json()) as { accessToken: string };
  return { id: body.user.id, token: loginBody.accessToken, email };
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`waitFor timed out waiting for ${label}`);
}

describe('Milestone 5: workspace/files/projects', () => {
  let api: ApiServer;
  let baseUrl = '';
  let fixture: ModelFixtureServer;
  let owner: { id: string; token: string; email: string };
  let admin: { id: string; token: string; email: string };
  let member: { id: string; token: string; email: string };
  let viewer: { id: string; token: string; email: string };
  let outsider: { id: string; token: string; email: string };
  let projectId = '';
  let otherProjectId = '';

  before(async () => {
    for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL']) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    syncAgentRegistry();
    fixture = await startModelFixture('ok');
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    process.env.OPENAI_BASE_URL = fixture.baseUrl;

    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;

    owner = await register(baseUrl, 'owner');
    admin = await register(baseUrl, 'admin');
    member = await register(baseUrl, 'member');
    viewer = await register(baseUrl, 'viewer');
    outsider = await register(baseUrl, 'outsider');
  });

  after(async () => {
    try {
      executionQueue.stop();
    } catch {
      // queue may already be stopped
    }
    db.run('DELETE FROM users WHERE id IN (?, ?, ?, ?, ?)', [owner.id, admin.id, member.id, viewer.id, outsider.id]);
    db.close();
    for (const [key, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await fixture.close();
    await api.close();
  });

  async function createProject(token: string, name: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as { project: { id: string } };
    return body.project.id;
  }

  async function invite(token: string, pid: string, email: string, role: string): Promise<number> {
    const response = await fetch(`${baseUrl}/api/projects/${pid}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ email, role }),
    });
    return response.status;
  }

  async function uploadTextFile(token: string, pid: string, name: string, content: string): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([content], { type: 'text/plain' }), name);
    const response = await fetch(`${baseUrl}/api/projects/${pid}/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as { file: { fileId: string } };
    return body.file.fileId;
  }

  it('creates projects and lists them with my role', async () => {
    projectId = await createProject(owner.token, 'M5 Workspace');
    otherProjectId = await createProject(owner.token, 'M5 Other');
    const response = await fetch(`${baseUrl}/api/projects`, { headers: { authorization: `Bearer ${owner.token}` } });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { projects: Array<{ id: string; my_role: string }> };
    const mine = body.projects.find((project) => project.id === projectId);
    assert.ok(mine);
    assert.equal(mine.my_role, 'owner');
  });

  it('hides projects from non-members (404, no existence leak)', async () => {
    const response = await fetch(`${baseUrl}/api/projects/${projectId}`, { headers: { authorization: `Bearer ${outsider.token}` } });
    assert.equal(response.status, 404);
    const upload = new FormData();
    upload.append('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
    const uploadResponse = await fetch(`${baseUrl}/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${outsider.token}` },
      body: upload,
    });
    assert.equal(uploadResponse.status, 404);
  });

  it('invites workspace members with roles and lists them', async () => {
    assert.equal(await invite(owner.token, projectId, admin.email, 'admin'), 201);
    assert.equal(await invite(admin.token, projectId, member.email, 'member'), 201);
    assert.equal(await invite(admin.token, projectId, viewer.email, 'viewer'), 201);
    assert.equal(await invite(admin.token, projectId, 'ghost@akbaral.test', 'member'), 404, 'unknown email honest 404');
    assert.equal(await invite(member.token, projectId, outsider.email, 'viewer'), 404, 'member cannot invite');
    assert.equal(await invite(admin.token, projectId, owner.email, 'member'), 409, 'owner already has access');

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/members`, { headers: { authorization: `Bearer ${viewer.token}` } });
    assert.equal(response.status, 200, 'viewers can list members');
    const body = (await response.json()) as { members: Array<{ user_id: string; role: string }> };
    const roles = new Map(body.members.map((entry) => [entry.user_id, entry.role]));
    assert.equal(roles.get(owner.id), 'owner');
    assert.equal(roles.get(admin.id), 'admin');
    assert.equal(roles.get(member.id), 'member');
    assert.equal(roles.get(viewer.id), 'viewer');
  });

  it('enforces the role matrix on project reads and uploads', async () => {
    for (const user of [owner, admin, member, viewer]) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}`, { headers: { authorization: `Bearer ${user.token}` } });
      assert.equal(response.status, 200, `${user.email} can read`);
    }
    // members+ can upload
    const memberFile = await uploadTextFile(member.token, projectId, 'member-notes.txt', 'member uploaded workspace notes');
    assert.ok(memberFile);
    // viewers cannot upload
    const form = new FormData();
    form.append('file', new Blob(['no'], { type: 'text/plain' }), 'no.txt');
    const denied = await fetch(`${baseUrl}/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${viewer.token}` },
      body: form,
    });
    assert.equal(denied.status, 404, 'viewer upload denied without leaking why');
  });

  it('changes roles, protects the owner, removes members and allows self-leave', async () => {
    const promote = await fetch(`${baseUrl}/api/projects/${projectId}/members/${viewer.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ role: 'member' }),
    });
    assert.equal(promote.status, 200);

    const ownerRoleChange = await fetch(`${baseUrl}/api/projects/${projectId}/members/${owner.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ role: 'member' }),
    });
    assert.equal(ownerRoleChange.status, 409, 'owner role immutable');

    const ownerRemoval = await fetch(`${baseUrl}/api/projects/${projectId}/members/${owner.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    assert.equal(ownerRemoval.status, 409, 'owner cannot be removed');

    // self-leave works for plain members (viewer was promoted to member)
    const selfLeave = await fetch(`${baseUrl}/api/projects/${projectId}/members/${viewer.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${viewer.token}` },
    });
    assert.equal(selfLeave.status, 200);
    const afterLeave = await fetch(`${baseUrl}/api/projects/${projectId}`, { headers: { authorization: `Bearer ${viewer.token}` } });
    assert.equal(afterLeave.status, 404, 'access revoked after leaving');

    // re-invite for later tests
    assert.equal(await invite(admin.token, projectId, viewer.email, 'viewer'), 201);
    const removed = await fetch(`${baseUrl}/api/projects/${projectId}/members/${viewer.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    assert.equal(removed.status, 200, 'admin removes member');
  });

  it('scopes knowledge search to a project', async () => {
    await uploadTextFile(owner.token, projectId, 'alpha-notes.txt', 'quantum.Widget calibration notes for project alpha');
    await uploadTextFile(owner.token, otherProjectId, 'beta-notes.txt', 'quantum.Gadget assembly notes for project beta');

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/knowledge/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ query: 'quantum' }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { results: Array<{ title: string; content: string; project_id: string }> };
    assert.ok(body.results.length >= 1);
    for (const result of body.results) {
      assert.equal(String(result.project_id), projectId, 'only project-alpha knowledge returned');
      assert.match(result.content, /alpha/);
    }

    // The personal knowledge-search endpoint reports the indexed-item count
    // so clients can distinguish an empty knowledge base from a no-match
    // query (the "No knowledge results" UX fix).
    const personal = await fetch(`${baseUrl}/api/files/knowledge/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ query: 'quantum' }),
    });
    assert.equal(personal.status, 200);
    const personalBody = (await personal.json()) as { results: unknown[]; knowledgeItems: number };
    assert.ok(Array.isArray(personalBody.results));
    assert.equal(
      typeof personalBody.knowledgeItems,
      'number',
      'knowledgeItems count must be present for honest empty states',
    );
    // Text uploads are auto-indexed into the owner's personal knowledge
    // base, so the count honestly reflects the two uploaded notes.
    assert.equal(personalBody.knowledgeItems, 2);

    // Shared workspace knowledge: the owner's project-scoped search must also
    // surface content uploaded by another member (uploaded in the role-matrix
    // test above as 'member uploaded workspace notes').
    const shared = await fetch(`${baseUrl}/api/projects/${projectId}/knowledge/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ query: 'workspace notes' }),
    });
    assert.equal(shared.status, 200);
    const sharedBody = (await shared.json()) as { results: Array<{ content: string }> };
    assert.ok(
      sharedBody.results.some((result) => /member uploaded workspace notes/.test(result.content)),
      'member-uploaded knowledge visible to the owner in the shared workspace',
    );
  });

  it('attaches and detaches task files with ownership validation', async () => {
    const create = await fetch(`${baseUrl}/api/api/../tasks/research`.replace('/api/../', '/'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ goal: 'attachment validation task', project_id: projectId }),
    });
    assert.equal(create.status, 202);
    const created = (await create.json()) as { task: { id: string } };
    const taskId = created.task.id;

    const fileId = await uploadTextFile(owner.token, projectId, 'attach-me.txt', 'quarterly revenue figures for Q3');

    const attach = await fetch(`${baseUrl}/api/tasks/${taskId}/files/${fileId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    assert.equal(attach.status, 200);

    const list = await fetch(`${baseUrl}/api/tasks/${taskId}/files`, { headers: { authorization: `Bearer ${owner.token}` } });
    assert.equal(list.status, 200);
    const listBody = (await list.json()) as { files: Array<{ id: string; original_name: string }> };
    assert.ok(listBody.files.some((file) => file.id === fileId));

    // outsiders cannot upload into the workspace at all
    const outsiderForm = new FormData();
    outsiderForm.append('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
    const outsiderUpload = await fetch(`${baseUrl}/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${outsider.token}` },
      body: outsiderForm,
    });
    assert.equal(outsiderUpload.status, 404);

    // outsider cannot attach to the owner's task
    const foreignTask = await fetch(`${baseUrl}/api/tasks/${taskId}/files/${fileId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${outsider.token}` },
    });
    assert.equal(foreignTask.status, 404);

    const detach = await fetch(`${baseUrl}/api/tasks/${taskId}/files/${fileId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    assert.equal(detach.status, 200);
    const afterDetach = await fetch(`${baseUrl}/api/tasks/${taskId}/files`, { headers: { authorization: `Bearer ${owner.token}` } });
    const afterDetachBody = (await afterDetach.json()) as { files: Array<{ id: string }> };
    assert.ok(!afterDetachBody.files.some((file) => file.id === fileId));
  });

  it('feeds attached file content to the agent as user data and stores an artifact', async () => {
    const fileId = await uploadTextFile(owner.token, projectId, 'context.txt', 'UNIQUE-MARKER-8f3k2 brand guidelines: always use the teal palette');

    // Dispatch a generic agent (research agent is search-driven; the generic
    // path consumes attachment context) through the workflow agent endpoint.
    // The queue is paused so the attachment can be registered before the job
    // starts — deterministic, no race with the worker poll loop.
    const requestCountBefore = fixture.requests.length;
    executionQueue.stop();
    const dispatch = await fetch(`${baseUrl}/api/workflows/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ agent_slug: 'research-researcher-002', goal: 'summarize the attached brand guidelines', project_id: projectId }),
    });
    assert.equal(dispatch.status, 202);
    const dispatched = (await dispatch.json()) as { task: { id: string } };
    const attachDispatched = await fetch(`${baseUrl}/api/tasks/${dispatched.task.id}/files/${fileId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    assert.equal(attachDispatched.status, 200);
    executionQueue.start();

    await waitFor(
      () => findTaskByIdSafe(dispatched.task.id)?.status === 'completed',
      30_000,
      'agent task completion',
    );

    // The attachment content must have reached the model as user-provided data.
    const relevantRequests = fixture.requests.slice(requestCountBefore);
    const sawMarker = relevantRequests.some((request) =>
      (request.body as { messages?: Array<{ content?: string }> }).messages?.some((message) =>
        String(message.content ?? '').includes('UNIQUE-MARKER-8f3k2'),
      ),
    );
    assert.ok(sawMarker, 'attached file content included in the model messages');

    // A project artifact must exist for the completed task and be downloadable.
    const artifactsResponse = await fetch(`${baseUrl}/api/projects/${projectId}/artifacts`, {
      headers: { authorization: `Bearer ${owner.token}` },
    });
    assert.equal(artifactsResponse.status, 200);
    const artifactsBody = (await artifactsResponse.json()) as { artifacts: Array<{ id: string; task_id: string; kind: string }> };
    const artifact = artifactsBody.artifacts.find((entry) => String(entry.task_id) === dispatched.task.id);
    assert.ok(artifact, 'artifact stored for the completed agent task');

    const download = await fetch(`${baseUrl}/api/files/${artifact.id}`, { headers: { authorization: `Bearer ${owner.token}` } });
    assert.equal(download.status, 200);
    const artifactJson = JSON.parse(await download.text()) as { type: string; agent: { slug: string } };
    assert.equal(artifactJson.type, 'agent_result');
    assert.equal(artifactJson.agent.slug, 'research-researcher-002');

    // Artifacts cannot be re-attached to tasks.
    const reattach = await fetch(`${baseUrl}/api/tasks/${dispatched.task.id}/files/${artifact.id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    assert.equal(reattach.status, 409);
  });

  it('denies workspace APIs without authentication', async () => {
    for (const path of [`/api/projects/${projectId}`, `/api/projects/${projectId}/members`, `/api/projects/${projectId}/artifacts`]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 401, `${path} requires auth`);
    }
  });
});

function findTaskByIdSafe(id: string): { status: string } | undefined {
  const row = db.get<{ status: string }>('SELECT status FROM tasks WHERE id = ?', [id]);
  return row ?? undefined;
}
