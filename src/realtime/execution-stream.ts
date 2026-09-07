import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { appendAgentExecutionLog, getExecutionOwnerId, listExecutionLogs, listExecutionLogsAfter, type ExecutionLogRow } from '../db';
import { verifyAccessToken } from '../security';

/**
 * Real-time execution log transport.
 *
 * A single WebSocketServer on `/ws/executions/:executionId` streams agent
 * execution logs as they are appended. In addition to the live socket, logs are
 * always persisted to `agent_execution_logs`, so a client can reconnect and
 * replay from the last-seen log timestamp.
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
  lastLogAt: string | null;
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
      if (!payload) {
        socket.close(1008, 'unauthorized');
        return;
      }
      const ownerId = getExecutionOwnerId(executionId);
      if (!ownerId || ownerId !== payload.sub) {
        socket.close(1008, 'forbidden');
        return;
      }

      const after = url.searchParams.get('after') ?? '';
      const entry: ClientEntry = {
        socket,
        lastLogAt: after.length > 0 ? after : null,
      };
      const list = this.clients.get(executionId) ?? [];
      list.push(entry);
      this.clients.set(executionId, list);

      // Replay persisted logs. A reconnect with an explicit cursor resumes from
      // that point; a first-time subscriber also receives any logs that were
      // appended between task creation and the socket being registered so the
      // WebSocket channel stays consistent with the SSE fallback.
      const rowsToReplay: ExecutionLogRow[] = entry.lastLogAt
        ? listExecutionLogsAfter(executionId, entry.lastLogAt, 500)
        : (listExecutionLogs(executionId, 500) as unknown as ExecutionLogRow[]);
      for (const row of rowsToReplay) {
        if (socket.readyState === WebSocket.OPEN) {
          const message: ExecutionStreamMessage = {
            type: 'log',
            id: row.id,
            executionId: row.execution_id,
            logType: row.type,
            level: row.level,
            message: row.message,
            data: row.data ? JSON.parse(row.data) : null,
            createdAt: row.created_at,
          };
          socket.send(JSON.stringify(message));
          entry.lastLogAt = String(row.created_at);
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

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/ws/executions/')) {
        socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
        return;
      }
      const token = url.searchParams.get('token') ?? '';
      const payload = verifyAccessToken(token);
      if (!payload) {
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
    const createdAt = new Date().toISOString();
    const message: ExecutionStreamMessage = {
      type: 'log',
      id: inserted.id,
      executionId: input.executionId,
      logType: input.type ?? 'log',
      level: input.level ?? 'info',
      message: input.message,
      data: input.data ?? null,
      createdAt,
    };
    this.broadcast(input.executionId, message, createdAt);
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
    createdAt: string | null,
  ): void {
    const list = this.clients.get(executionId) ?? [];
    const payload = JSON.stringify(message);
    for (const entry of list) {
      if (entry.socket.readyState === WebSocket.OPEN) {
        entry.socket.send(payload);
        if (createdAt) {
          entry.lastLogAt = createdAt;
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
