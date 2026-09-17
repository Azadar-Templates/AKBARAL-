import { WebSocket } from 'ws';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
const TOKEN = process.env.E2E_TOKEN ?? '';

async function api(path: string, options: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (response.status >= 400) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const created = await api('/api/tasks/research', {
    method: 'POST',
    body: { goal: 'Realtime websocket and sse verification' },
  });
  const executionId = created.task.executionId;
  console.log(`executionId=${executionId}`);

  // --- WebSocket live capture (authenticated via ?token=) ---
  const ws = new WebSocket(`ws://127.0.0.1:3000/ws/executions/${executionId}?token=${encodeURIComponent(TOKEN)}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const wsMessages: string[] = [];
  ws.on('message', (data) => {
    const parsed = JSON.parse(data.toString()) as { type?: string; message?: string; status?: string };
    wsMessages.push(parsed.message ?? parsed.status ?? '');
  });
  console.log('ws connected');

  // --- SSE live capture ---
  const controller = new AbortController();
  const sseMessages: string[] = [];
  const sseRunner = (async () => {
    const response = await fetch(`${BASE}/api/executions/${executionId}/events`, {
      headers: { authorization: `Bearer ${TOKEN}` },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`SSE status ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const payload = JSON.parse(line.slice(6)) as { type?: string; message?: string };
          sseMessages.push(payload.message ?? '');
        }
      }
    }
  })().catch(() => undefined);

  console.log('waiting for completion...');
  let taskStatus = '';
  for (let i = 0; i < 40; i += 1) {
    const task = await api(`/api/tasks/${created.task.id}`);
    if (task.task.status === 'completed' || task.task.status === 'failed') {
      taskStatus = task.task.status;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // Give the SSE poller enough cycles to deliver the final verification frame
  // (it polls persisted logs on an interval, so completion is not instant).
  const sseComplete = () => sseMessages.some((m) => /research complete|task completed|verification passed|result ready/i.test(m));
  for (let i = 0; i < 40 && !sseComplete(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  console.log(`taskStatus=${taskStatus}`);
  console.log(`ws_messages=${wsMessages.length}`);
  console.log(`ws_has_start=${wsMessages.some((m) => /started/i.test(m))}`);
  console.log(`ws_has_complete=${wsMessages.some((m) => /complete|verification/i.test(m))}`);
  console.log(`ws_sample=${JSON.stringify(wsMessages.slice(0, 4))}`);

  console.log(`sse_messages=${sseMessages.length}`);
  console.log(`sse_has_start=${sseMessages.some((m) => /started/i.test(m))}`);
  console.log(`sse_sample=${JSON.stringify(sseMessages.slice(0, 4))}`);

  ws.terminate();
  controller.abort();
  await sseRunner;

  if (wsMessages.length === 0 || sseMessages.length === 0) {
    throw new Error('realtime verification failed: no messages');
  }
  console.log('REALTIME_OK');
}

main().catch((error) => {
  console.error('REALTIME_FAIL', error);
  process.exit(1);
});
