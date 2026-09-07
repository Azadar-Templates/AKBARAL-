import { Router } from 'express';
import { listExecutionLogsAfter, listExecutionLogs, getAgentExecution, getExecutionOwnerId } from '../db';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError } from '../server/http';

/**
 * Server-sent-events endpoint for execution logs.
 *
 * The WebSocket path is the primary real-time channel. SSE is provided as a
 * simpler fallback for browsers/clients that cannot hold a WebSocket.
 */
export function createRealtimeRouter(): Router {
  const router = Router();

  router.get('/executions/:id/events', requireAuth, (req: AuthenticatedRequest, res) => {
    const execution = getAgentExecution(req.params.id);
    if (!execution) {
      throw new HttpError(404, 'execution not found', 'not_found');
    }
    const ownerId = getExecutionOwnerId(execution.id);
    if (!ownerId || ownerId !== req.auth!.userId) {
      throw new HttpError(403, 'you do not have access to this execution', 'forbidden');
    }
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let cursor = '';
    const send = (rows: Array<Record<string, unknown>>) => {
      for (const row of rows) {
        const payload = {
          type: 'log',
          id: String(row.id),
          executionId: String(row.execution_id),
          logType: String(row.type),
          level: String(row.level),
          message: String(row.message),
          data: row.data ? JSON.parse(String(row.data)) : null,
          createdAt: String(row.created_at),
        };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        cursor = String(row.created_at);
      }
    };

    const initial = listExecutionLogs(req.params.id, 500);
    send(initial);

    const interval = setInterval(() => {
      const rows = cursor ? listExecutionLogsAfter(req.params.id, cursor, 100) : [];
      if (rows.length > 0) {
        send(rows as unknown as Array<Record<string, unknown>>);
      }
    }, 1000);

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 20_000);

    req.on('close', () => {
      clearInterval(interval);
      clearInterval(heartbeat);
      res.end();
    });
  });

  return router;
}
