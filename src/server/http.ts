import type { NextFunction, Request, Response } from 'express';

/**
 * HttpError carries an HTTP status that the response layer maps to a JSON body.
 */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(404, `route not found: ${req.method} ${req.path}`, 'not_found'));
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? undefined,
      },
    });
    return;
  }

  const message = err instanceof Error ? err.message : 'internal server error';
  // Keep implementation detail out of production responses.
  console.error('[server] unhandled error:', err);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: process.env.NODE_ENV === 'production' ? 'internal server error' : message,
    },
  });
}
