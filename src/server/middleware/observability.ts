import type { NextFunction, Request, Response } from 'express';
import { recordSystemMetric } from '../../db';

/**
 * Request logging + structured metrics for the backend.
 * No tokens/secrets are logged.
 */
export function requestLog(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      console.log(
        JSON.stringify({
          level: 'info',
          ts: new Date().toISOString(),
          event: 'http.request',
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs,
          ip: req.ip,
          userAgent: (req.headers['user-agent'] ?? '').slice(0, 128),
        }),
      );
      recordSystemMetric('http_request_duration_ms', durationMs, {
        method: req.method,
        path: req.path,
        status: res.statusCode,
      });
    });
    next();
  };
}
