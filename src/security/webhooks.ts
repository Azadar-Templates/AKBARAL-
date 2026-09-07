import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../server/http';

/**
 * Verify a signed webhook payload.
 *
 * The expected signature is provided in `X-AKBARAL-Signature` as:
 *   sha256=<hex hmac>
 *
 * `BILLING_WEBHOOK_SECRET` must be set in the environment. The comparison is
 * timing-safe. If the secret is missing, the webhook handler fails honestly
 * with `webhook_not_configured` instead of silently accepting payloads.
 */
export function verifyWebhookSignature(input: { payload: string; signature?: string; secret?: string }): boolean {
  if (!input.secret) {
    throw new Error('BILLING_WEBHOOK_SECRET is not configured') as Error & { code?: string };
  }
  if (!input.signature) {
    return false;
  }
  const expected = createHmac('sha256', input.secret).update(input.payload, 'utf8').digest('hex');
  const actual = input.signature.replace(/^sha256=/, '');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function requireWebhookPayload(req: { headers: Record<string, string | string[] | undefined>; rawBody?: Buffer }): { payload: string; signature: string | undefined; secret: string | undefined } {
  const firstHeader = (name: string): string | undefined => {
    const value = req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };
  const signature = firstHeader('x-akbaral-signature');
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  if (!secret) {
    const error = new Error('BILLING_WEBHOOK_SECRET is not configured') as Error & { code?: string };
    error.code = 'webhook_not_configured';
    throw error;
  }
  const payload = req.rawBody ? req.rawBody.toString('utf8') : '';
  if (!payload) {
    throw new HttpError(400, 'webhook body is required', 'validation_error');
  }
  return { payload, signature, secret };
}
