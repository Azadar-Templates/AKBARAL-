import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/**
 * Minimal signed JWT (HS256) implementation.
 *
 * We use a small self-contained JWT rather than a heavy dependency. Tokens are
 * short-lived; session revocation is still enforced server-side by checking
 * the `session_id` in the `sessions` table.
 */

export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  role: string;
  sid: string; // session id
  iat: number;
  exp: number;
  jti: string;
}

const ALGORITHM = 'HS256';

function base64Url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

function base64UrlFromBytes(input: Uint8Array): string {
  return Buffer.from(input).toString('base64url');
}

function sign(input: string, secret: string): string {
  return base64UrlFromBytes(createHmac('sha256', secret).update(input).digest());
}

export function signAccessToken(payload: Omit<AccessTokenPayload, 'iat' | 'exp' | 'jti'>): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: AccessTokenPayload = {
    ...payload,
    iat: now,
    exp: now + 60 * 60, // 1 hour
    jti: createHash('sha256').update(`${payload.sub}:${payload.sid}:${now}:${Math.random()}`).digest('hex').slice(0, 32),
  };

  const header = base64Url(JSON.stringify({ alg: ALGORITHM, typ: 'JWT' }));
  const body = base64Url(JSON.stringify(fullPayload));
  const signingInput = `${header}.${body}`;
  const signature = sign(signingInput, env.sessionSecret);

  return `${signingInput}.${signature}`;
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [header, body, signature] = parts;

  // Pin the algorithm: a forged `{"alg":"none",...}` (or any non-HS256
  // header) is rejected outright instead of relying on the signature check
  // alone.
  try {
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: unknown; typ?: unknown };
    if (parsedHeader.alg !== ALGORITHM) {
      return null;
    }
    if (parsedHeader.typ !== undefined && parsedHeader.typ !== 'JWT') {
      return null;
    }
  } catch {
    return null;
  }

  const signingInput = `${header}.${body}`;

  // Constant-time signature comparison (timingSafeEqual requires equal
  // lengths, which itself must not leak the comparison result).
  const signatureBytes = Buffer.from(signature);
  const matchesSecret = (secret: string): boolean => {
    const expected = Buffer.from(sign(signingInput, secret));
    if (expected.length !== signatureBytes.length || expected.length === 0) {
      return false;
    }
    return timingSafeEqual(expected, signatureBytes);
  };

  // Current secret first; the optional previous secret stays valid for one
  // rotation cycle (SESSION_SECRET_PREVIOUS) so rotation does not hard-logout
  // every active session.
  if (!matchesSecret(env.sessionSecret) && !(env.sessionSecretPrevious && matchesSecret(env.sessionSecretPrevious))) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccessTokenPayload;
    if (typeof parsed.sub !== 'string' || typeof parsed.exp !== 'number') {
      return null;
    }
    if (parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
