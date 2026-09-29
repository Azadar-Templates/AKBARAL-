import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { activeSessionExists, appendAgentExecutionLog, getExecutionOwnerId, listExecutionLogsAfterCursor, type ExecutionLogCursor, type ExecutionLogRow } from '../db';
import { verifyAccessToken } from '../security';
import { publicLogLine } from '../server/safe-errors';

/**
 * Real-time execution log transport.
 *
 * A single WebSocketServer on `/ws/executions/:executionId` streams agent
 * execution logs as they are appended. In addition to the live socket, logs are
 * always persisted to `agent_execution_logs`, so a client can reconnect and
 * replay from the last-seen log timestamp.
 *
 * Free-tier mode (AKBARAL_REALTIME_TRANSPORT=sse): hosts whose edge proxy does
 * not pass WebSocket upgrades (e.g. SnapDeploy Free) run the identical stream
 * over the SSE endpoint (/api/executions/:id/events, src/routes/realtime.ts).
 * In that mode the authenticated upgrade path is not registered; WebSocket
 * attempts are refused immediately (403 + destroy) so the browser client's
 * built-in fallback switches to SSE without waiting. Payloads, authentication
 * and ownership isolation are identical on both channels.
 */

export interface ExecutionLogMessage {
  id: string;
  executionId: string;
  logType: string; // log | tool_call | tool_result | verification | system
  level: string;
  message: string;
  data: unknown;
  createdAt: string;
}

export interface ExecutionStatusMessage {
  type: 'status';
  executionId: string;
  status: string;
  message: string;
  errorMessage?: string | null;
  createdAt: string;
}

export type ExecutionStreamMessage =
  | (ExecutionLogMessage & { type: 'log' })
  | ExecutionStatusMessage;

interface ClientEntry {
  socket: WebSocket;
  // Keyset cursor (created_at, id). created_at alone is millisecond
  // resolution: a cursor without the id tie-break permanently skips every log
  // written in the same millisecond as the last delivered row.
  cursor: ExecutionLogCursor | null;
}

export class ExecutionStream {
  private readonly wss: WebSocketServer;
  private readonly clients = new Map<string, ClientEntry[]>();
  private readonly rawSockets = new Set<WebSocket>();

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (socket, request) => {
      this.rawSockets.add(socket);
      socket.on('close', () => this.rawSockets.delete(socket));
      socket.on('error', () => {
        // A malformed/closed socket should not crash the stream.
      });
      const url = new URL(request.url ?? '/', 'http://localhost');
      const match = url.pathname.match(/^\/ws\/executions\/([A-Za-z0-9_-]+)$/);
      const executionId = match?.[1] ?? null;
      if (!executionId) {
        socket.close(1008, 'invalid execution id');
        return;
      }

      const token = url.searchParams.get('token') ?? '';
      const payload = verifyAccessToken(token);
      if (!payload || !payload.sid || !activeSessionExists(payload.sid, payload.sub)) {
        socket.close(1008, 'unauthorized');
        return;
      }
      const ownerId = getExecutionOwnerId(executionId);
      if (!ownerId || ownerId !== payload.sub) {
        socket.close(1008, 'forbidden');
        return;
      }

      const after = url.searchParams.get('after') ?? '';
      const afterId = url.searchParams.get('afterId') ?? '';
      const entry: ClientEntry = {
        socket,
        // An `after` without `afterId` resumes from the lowest id in that
        // millisecond, which replays (never drops) same-millisecond rows.
        cursor: after.length > 0 ? { createdAt: after, id: afterId } : null,
      };
      const list = this.clients.get(executionId) ?? [];
      list.push(entry);
      this.clients.set(executionId, list);

      // Replay persisted logs. A reconnect with an explicit cursor resumes from
      // that point; a first-time subscriber also receives any logs that were
      // appended between task creation and the socket being registered so the
      // WebSocket channel stays consistent with the SSE fallback.
      const rowsToReplay: ExecutionLogRow[] = listExecutionLogsAfterCursor(executionId, entry.cursor, 500);
      for (const row of rowsToReplay) {
        if (socket.readyState === WebSocket.OPEN) {
          const safe = publicLogLine({ message: row.message, data: row.data ? JSON.parse(row.data) : null, level: row.level });
          const message: ExecutionStreamMessage = {
            type: 'log',
            id: row.id,
            executionId: row.execution_id,
            logType: row.type,
            level: row.level,
            message: safe.message,
            data: safe.data,
            createdAt: row.created_at,
          };
          socket.send(JSON.stringify(message));
          entry.cursor = { createdAt: String(row.created_at), id: String(row.id) };
        }
      }

      socket.on('close', () => {
        const existing = this.clients.get(executionId) ?? [];
        this.clients.set(
          executionId,
          existing.filter((item) => item !== entry),
        );
      });
    });

    // SSE-only free-tier mode: the full authenticated upgrade path below is
    // NOT registered. Instead a minimal refusal handler answers and destroys
    // every WebSocket attempt immediately — verified empirically: without any
    // handler Node leaves the handshake dangling until the client times out,
    // whereas an explicit 403 makes the browser's existing fallback switch to
    // the SSE channel instantly. Default (unset or any other value) registers
    // the WebSocket path exactly as before.
    if (process.env.AKBARAL_REALTIME_TRANSPORT === 'sse') {
      server.on('upgrade', (_request, socket) => {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
      });
      return;
    }
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/ws/executions/')) {
        socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
        return;
      }
      const token = url.searchParams.get('token') ?? '';
      const payload = verifyAccessToken(token);
      if (!payload || !payload.sid || !activeSessionExists(payload.sid, payload.sub)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
        return;
      }
      const match = url.pathname.match(/^\/ws\/executions\/([A-Za-z0-9_-]+)$/);
      const executionId = match?.[1] ?? null;
      const ownerId = executionId ? getExecutionOwnerId(executionId) : null;
      if (!executionId || !ownerId || ownerId !== payload.sub) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        const clientId = randomUUID();
        this.wss.emit('connection', ws as WebSocket, request, clientId);
      });
    });
  }

  /** Persist a log row and push it to every client subscribed to the execution. */
  pushLog(input: {
    executionId: string;
    message: string;
    level?: string;
    type?: string;
    data?: Record<string, unknown> | null;
  }): { id: string } {
    const inserted = appendAgentExecutionLog(input);
    // The row above keeps the raw operator text; what goes on the wire is the
    // display-safe line (production error boundary).
    const safe = publicLogLine({ message: input.message, data: input.data ?? null, level: input.level });
    // Broadcast the PERSISTED timestamp, never a freshly generated one: the
    // client turns createdAt into its reconnect cursor, and a value that
    // differs from the stored row makes the replay skip or duplicate logs.
    const createdAt = inserted.createdAt;
    const message: ExecutionStreamMessage = {
      type: 'log',
      id: inserted.id,
      executionId: input.executionId,
      logType: input.type ?? 'log',
      level: input.level ?? 'info',
      message: safe.message,
      data: safe.data,
      createdAt,
    };
    this.broadcast(input.executionId, message, { createdAt, id: inserted.id });
    return inserted;
  }

  pushStatus(input: {
    executionId: string;
    status: string;
    message: string;
    errorMessage?: string | null;
  }): void {
    const message: ExecutionStreamMessage = {
      type: 'status',
      executionId: input.executionId,
      status: input.status,
      message: input.message,
      errorMessage: input.errorMessage ?? null,
      createdAt: new Date().toISOString(),
    };
    this.broadcast(input.executionId, message, null);
  }

  private broadcast(
    executionId: string,
    message: ExecutionStreamMessage,
    cursor: ExecutionLogCursor | null,
  ): void {
    const list = this.clients.get(executionId) ?? [];
    const payload = JSON.stringify(message);
    for (const entry of list) {
      if (entry.socket.readyState === WebSocket.OPEN) {
        entry.socket.send(payload);
        if (cursor) {
          entry.cursor = cursor;
        }
      }
    }
  }

  close(): void {
    for (const socket of this.rawSockets) {
      try {
        socket.terminate();
      } catch {
        // already closed
      }
    }
    this.rawSockets.clear();
    for (const list of this.clients.values()) {
      for (const entry of list) {
        entry.socket.close(1001, 'server shutting down');
      }
    }
    this.clients.clear();
    this.wss.close();
  }
}
