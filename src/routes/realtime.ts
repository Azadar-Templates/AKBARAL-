import { Router } from 'express';
import { listExecutionLogsAfterCursor, getAgentExecution, getExecutionOwnerId, type ExecutionLogCursor, type ExecutionLogRow } from '../db';
import { publicLogLine } from '../server/safe-errors';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError } from '../server/http';

/**
 * Server-sent-events endpoint for execution logs.
 *
 * The WebSocket path is the primary real-time channel. SSE is provided as a
 * simpler fallback for browsers/clients that cannot hold a WebSocket.
 *
 * Auth: the standard Authorization header, or `?token=<accessToken>` —
 * EventSource in browsers cannot set request headers, so the query parameter
 * mirrors the WebSocket channel's auth pattern exactly.
 */
export function createRealtimeRouter(): Router {
  const router = Router();

  // Promote ?token= to an Authorization header when the header is absent so
  // `requireAuth` applies unchanged (same token, same session checks).
  router.use((req, _res, next) => {
    if (!req.header('authorization')) {
      const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
      if (queryToken) {
        req.headers.authorization = `Bearer ${queryToken}`;
      }
    }
    next();
  });

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
    // `no-transform` is LOAD-BEARING, not decoration: the web tier runs with
    // compression enabled (next.config.mjs) and its compressor skips any
    // response that carries it. Without it this stream is gzipped and buffered
    // — the live execution log would arrive in one blob instead of streaming.
    // X-Accel-Buffering keeps intermediate proxies from buffering it either.
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Keyset cursor: (created_at, id). created_at alone is millisecond
    // resolution, so a `created_at > cursor` tail permanently drops every log
    // line an agent writes inside the same millisecond as the cursor row.
    let cursor: ExecutionLogCursor | null = null;
    const send = (rows: ExecutionLogRow[]) => {
      for (const row of rows) {
        // Production error boundary: the console is a UI surface.
        const safe = publicLogLine({ message: row.message, data: row.data ? JSON.parse(String(row.data)) : null, level: row.level });
        const payload = {
          type: 'log',
          id: String(row.id),
          executionId: String(row.execution_id),
          logType: String(row.type),
          level: String(row.level),
          message: safe.message,
          data: safe.data,
          createdAt: String(row.created_at),
        };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        cursor = { createdAt: String(row.created_at), id: String(row.id) };
      }
    };

    // Drain everything already persisted, then keep draining. A client that
    // subscribes BEFORE the first log (the normal browser flow: the stream is
    // opened the moment a task is dispatched) starts with a null cursor, which
    // reads from the beginning, so no log can be missed between the initial
    // read and the first poll.
    const drain = () => {
      // Keep draining while a poll fills the page limit, otherwise a burst
      // larger than the limit would be delivered one page per second.
      for (;;) {
        const rows = listExecutionLogsAfterCursor(req.params.id, cursor, 100);
        if (rows.length === 0) return;
        send(rows);
        if (rows.length < 100) return;
      }
    };

    drain();
    const interval = setInterval(drain, 1000);

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
