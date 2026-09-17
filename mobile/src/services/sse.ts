import { api } from '../api/client';

/**
 * Live execution-log transport for the mobile client (M12).
 *
 * The server exposes the SAME channel as the web task center:
 *   GET /api/executions/:id/events?token=<access token>   (SSE)
 * which replays up to 500 existing logs and then tails new rows every second.
 *
 * React Native's fetch() does not expose streaming response bodies, so this
 * uses XMLHttpRequest with incremental onprogress parsing — the standard
 * technique for SSE on RN (no extra dependency). Auth uses ?token= because
 * EventSource-style requests here cannot carry headers.
 */

export interface ExecutionLogEvent {
  type: string;
  id: string;
  executionId: string;
  logType: string;
  level: string;
  message: string;
  data: unknown;
  createdAt: string;
}

export type LiveState = 'connecting' | 'live' | 'closed' | 'error';

export interface LiveSubscription {
  close(): void;
}

export function subscribeExecutionEvents(
  executionId: string,
  onEvent: (event: ExecutionLogEvent) => void,
  onStateChange?: (state: LiveState) => void,
): LiveSubscription {
  const token = api.getAccessToken();
  const url = api.url(`/api/executions/${encodeURIComponent(executionId)}/events${token ? `?token=${encodeURIComponent(token)}` : ''}`);

  const xhr = new XMLHttpRequest();
  let closedByClient = false;
  let parsedUpTo = 0;

  xhr.open('GET', url, true);
  xhr.setRequestHeader('accept', 'text/event-stream');
  xhr.setRequestHeader('cache-control', 'no-cache');

  const consume = (text: string) => {
    let boundary = text.indexOf('\n\n', parsedUpTo);
    while (boundary !== -1) {
      const block = text.slice(parsedUpTo, boundary);
      parsedUpTo = boundary + 2;
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue; // skip heartbeats (: ping) and comments
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          onEvent(JSON.parse(payload) as ExecutionLogEvent);
        } catch {
          // ignore malformed frames — never crash the log console
        }
      }
      boundary = text.indexOf('\n\n', parsedUpTo);
    }
  };

  xhr.onprogress = () => {
    onStateChange?.('live');
    consume(xhr.responseText ?? '');
  };
  xhr.onload = () => {
    consume(xhr.responseText ?? '');
    onStateChange?.(closedByClient ? 'closed' : 'closed');
  };
  xhr.onerror = () => {
    if (!closedByClient) onStateChange?.('error');
  };
  xhr.onabort = () => {
    if (!closedByClient) onStateChange?.('closed');
  };

  onStateChange?.('connecting');
  xhr.send();

  return {
    close() {
      closedByClient = true;
      try {
        xhr.abort();
      } catch {
        // already finished
      }
    },
  };
}
