import type { Request } from 'express';
import { HttpError } from '../http';

/**
 * Small validation helper for the JSON APIs.
 * Keep it dependency-free for now; add a schema library only when the surface
 * grows beyond what these helpers cover cleanly.
 */

export function requireString(obj: Record<string, unknown>, key: string, label = key): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, `${label} is required`, 'validation_error');
  }
  return value.trim();
}

export function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, `${key} must be a string`, 'validation_error');
  }
  return value;
}

export function optionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, `${key} must be a number`, 'validation_error');
  }
  return parsed;
}

export function getBody(req: Request): Record<string, unknown> {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    return req.body as Record<string, unknown>;
  }
  return {};
}
