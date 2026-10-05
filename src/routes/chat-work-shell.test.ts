import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiServer, type ApiServer } from '../app';
import { getCreditAccount } from '../db';

const suffix = randomBytes(6).toString('hex');
const email = `phase2b-${suffix}@akbaral.test`;
const password = 'correct-horse-battery-staple';

async function parseEvents(response: Response) {
  const text = await response.text();
  return text.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

describe('Phase 2B Chat and Work APIs', () => {
  let api: ApiServer;
  let baseUrl = '';
  let accessToken = '';
  let userId = '';
  const savedGoogleKey = process.env.GOOGLE_API_KEY;

  before(async () => {
    delete process.env.GOOGLE_API_KEY;
    api = createApiServer();
    const listening = await api.listen(0);
    baseUrl = `http://127.0.0.1:${listening.port}`;
    const registration = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Phase 2B User' }),
    });
    assert.equal(registration.status, 201);
    const registered = await registration.json() as { user: { id: string } };
    userId = registered.user.id;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    const session = await login.json() as { accessToken: string };
    accessToken = session.accessToken;
  });

  after(async () => {
    if (savedGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = savedGoogleKey;
    await api.close();
  });

  it('stores per-user chat history, reports unavailable capacity honestly, and uses no task credit', async () => {
    const beforeCredits = Number(getCreditAccount(userId)?.free_credits ?? 0);
    const streamed = await fetch(`${baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Explain the launch checklist.', model: 'gemini-3.8-flash' }),
    });
    assert.equal(streamed.status, 200);
    assert.match(streamed.headers.get('content-type') ?? '', /text\/event-stream/);
    const events = await parseEvents(streamed);
    assert.equal(events[0]?.type, 'start');
    assert.equal(events[0]?.creditsUsed, 0);
    assert.equal(events.at(-1)?.type, 'error');
    assert.match(String(events.at(-1)?.message), /No task credit was deducted/i);
    assert.equal(Number(getCreditAccount(userId)?.free_credits ?? 0), beforeCredits);

    const history = await fetch(`${baseUrl}/api/chat`, { headers: { authorization: `Bearer ${accessToken}` } });
    const listed = await history.json() as { conversations: Array<{ id: string; title: string }> };
    assert.equal(listed.conversations.length, 1);
    const id = listed.conversations[0]!.id;
    const detail = await fetch(`${baseUrl}/api/chat/${id}`, { headers: { authorization: `Bearer ${accessToken}` } });
    const body = await detail.json() as { messages: Array<{ role: string; content: string }> };
    assert.deepEqual(body.messages.map((message) => message.role), ['user']);

    const removed = await fetch(`${baseUrl}/api/chat/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
    assert.equal(removed.status, 200);
  });

  it('searches chat history with ?q= and scopes results to the caller', async () => {
    const seed = async (content: string) => {
      const response = await fetch(`${baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ content, model: 'gemini-3.8-flash' }),
      });
      await response.text();
    };
    await seed('Quarterly revenue forecast notes');
    await seed('Kubernetes rollout checklist');

    const matched = await fetch(`${baseUrl}/api/chat?q=revenue`, { headers: { authorization: `Bearer ${accessToken}` } });
    const matchedBody = await matched.json() as { conversations: Array<{ title: string }> };
    assert.equal(matchedBody.conversations.length, 1);
    assert.match(matchedBody.conversations[0]!.title, /revenue/i);

    const none = await fetch(`${baseUrl}/api/chat?q=${encodeURIComponent('zzz-no-such-term')}`, { headers: { authorization: `Bearer ${accessToken}` } });
    const noneBody = await none.json() as { conversations: unknown[] };
    assert.deepEqual(noneBody.conversations, []);

    // A LIKE wildcard typed by the user stays literal — it must not match all rows.
    const wildcard = await fetch(`${baseUrl}/api/chat?q=%25`, { headers: { authorization: `Bearer ${accessToken}` } });
    const wildcardBody = await wildcard.json() as { conversations: unknown[] };
    assert.deepEqual(wildcardBody.conversations, []);
  });

  it('reports attachment capability from the catalog and never drops a file silently', async () => {
    const support = await fetch(`${baseUrl}/api/chat/attachment-support`, { headers: { authorization: `Bearer ${accessToken}` } });
    assert.equal(support.status, 200);
    const supportBody = await support.json() as { maxAttachments: number; models: Array<{ key: string; supportsAttachments: boolean; reason: string | null }> };
    assert.equal(supportBody.maxAttachments, 5);
    assert.ok(supportBody.models.length > 0);
    const textOnly = supportBody.models.find((entry) => entry.key === 'qwen3-coder-plus');
    assert.equal(textOnly?.supportsAttachments, false);
    assert.equal(textOnly?.reason, 'model_does_not_support_attachments');
    const multimodal = supportBody.models.find((entry) => entry.key === 'gpt-4o');
    assert.equal(multimodal?.supportsAttachments, true);

    // An id the caller does not own is a 404 before anything is persisted.
    const foreign = await fetch(`${baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Read this file', model: 'gpt-4o', attachment_file_ids: ['file_does_not_exist'] }),
    });
    assert.equal(foreign.status, 404);

    // A text-only model refuses the attachment verbatim instead of ignoring it.
    const refused = await fetch(`${baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Read this file', model: 'qwen3-coder-plus', attachment_file_ids: ['file_does_not_exist'] }),
    });
    // Ownership is checked first, so a non-owned id still 404s on any model.
    assert.equal(refused.status, 404);
  });

  it('refuses attachments on a text-only model and names what it included on a capable one', async () => {
    const createdProject = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Attachment contract', description: 'Chat attachment test project.' }),
    });
    const project = await createdProject.json() as { project: { id: string } };
    const form = new FormData();
    form.append('file', new Blob(['ATTACHED-CONTRACT-TEXT'], { type: 'text/plain' }), 'note.txt');
    const uploaded = await fetch(`${baseUrl}/api/projects/${project.project.id}/files`, {
      method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: form,
    });
    assert.equal(uploaded.status, 201);
    const file = await uploaded.json() as { file: { fileId: string } };

    // Text-only model: verbatim provider code + machine-readable reason, and
    // NOTHING is persisted for the refused turn.
    const refusedStream = await fetch(`${baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Summarise the attached note', model: 'qwen3-coder-plus', attachment_file_ids: [file.file.fileId] }),
    });
    assert.equal(refusedStream.status, 200);
    const refusedEvents = await parseEvents(refusedStream);
    assert.equal(refusedEvents.length, 1);
    assert.equal(refusedEvents[0]?.type, 'error');
    assert.equal(refusedEvents[0]?.code, 'provider_not_configured');
    assert.equal(refusedEvents[0]?.reason, 'model_does_not_support_attachments');

    // Capable model: the stream names the attachment count and the real
    // delivery mode of each file before any provider work happens.
    const capableStream = await fetch(`${baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Summarise the attached note', model: 'gpt-4o', attachment_file_ids: [file.file.fileId] }),
    });
    const capableEvents = await parseEvents(capableStream);
    const attachmentEvent = capableEvents.find((event) => event.type === 'attachment');
    assert.ok(attachmentEvent, 'the stream names the attachments it included');
    assert.equal(attachmentEvent?.count, 1);
    assert.equal(attachmentEvent?.message, 'attachment count: 1');
    const delivered = (attachmentEvent?.attachments as Array<{ name: string; delivery: string }>)[0]!;
    assert.equal(delivered.name, 'note.txt');
    assert.equal(delivered.delivery, 'extracted_text');
  });

  it('creates a real MASTER plan and exposes the six persisted-progress stages over SSE', async () => {
    const planned = await fetch(`${baseUrl}/api/master`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'Prepare a concise launch risk register', auto_run: false }),
    });
    assert.equal(planned.status, 202);
    const body = await planned.json() as { workflow: { id: string } };
    const controller = new AbortController();
    const events = await fetch(`${baseUrl}/api/master/${body.workflow.id}/events`, {
      headers: { authorization: `Bearer ${accessToken}` }, signal: controller.signal,
    });
    assert.equal(events.status, 200);
    const reader = events.body!.getReader();
    const first = await reader.read();
    controller.abort();
    const text = new TextDecoder().decode(first.value);
    assert.match(text, /Understanding/);
    assert.match(text, /Planning/);
    assert.match(text, /Routing/);
    assert.match(text, /Executing/);
    assert.match(text, /Verifying/);
    assert.match(text, /Complete/);
  });
});
