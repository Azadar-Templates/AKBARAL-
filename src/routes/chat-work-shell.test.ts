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
