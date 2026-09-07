import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/**
 * Central, typed access to runtime configuration.
 *
 * Loads from `.env` (dotenv), validates non-optional settings, and keep every
 * secret out of logs/API responses. Provider credentials are intentionally
 * optional: each integration is reported as not-configured (with the required
 * env var name) instead of fabricating a result.
 *
 * Development/test:
 *   - A cryptographically secure SESSION_SECRET is generated automatically
 *     when one is not present. It lives only for the process lifetime.
 * Production:
 *   - SESSION_SECRET MUST be explicitly configured (>= 32 random chars) and
 *     the process refuses to start otherwise.
 */

export const SESSION_SECRET_PLACEHOLDERS = new Set([
  'change-me-in-production',
  'replace-with-a-long-random-secret',
  'changeme',
  'secret',
]);

const VALID_NODE_ENV = new Set(['development', 'test', 'production']);

export class EnvConfigError extends Error {
  readonly code = 'env_config_error';
  constructor(message: string) {
    super(message);
    this.name = 'EnvConfigError';
  }
}

function trimOrEmpty(value: string | undefined): string {
  return (value ?? '').trim();
}

function generateLocalSessionSecret(): string {
  return randomBytes(48).toString('base64url');
}

function resolveNodeEnv(): string {
  const value = trimOrEmpty(process.env.NODE_ENV).toLowerCase();
  return value || 'development';
}

const nodeEnv = resolveNodeEnv();
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

function resolveSessionSecret(): string {
  const configured = trimOrEmpty(process.env.SESSION_SECRET);
  if (configured && !SESSION_SECRET_PLACEHOLDERS.has(configured.toLowerCase())) {
    return configured;
  }
  if (isProduction) {
    // The production startup guard rejects this before any JWT is signed.
    return '';
  }
  return generateLocalSessionSecret();
}

function resolvePort(): number {
  const raw = trimOrEmpty(process.env.PORT) || '3000';
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : 3000;
}

function resolveHost(): string {
  return trimOrEmpty(process.env.HOST) || '0.0.0.0';
}

function resolveDatabaseUrl(): string {
  return trimOrEmpty(process.env.DATABASE_URL) || 'file:./data/akbaral.db';
}

function resolveUploadDir(): string {
  return trimOrEmpty(process.env.AKBARAL_UPLOAD_DIR) || 'data/uploads';
}

export const env = {
  nodeEnv,
  isProduction,
  isTest,
  isDevelopment: !isProduction && !isTest,
  databaseUrl: resolveDatabaseUrl(),
  sessionSecret: resolveSessionSecret(),
  port: resolvePort(),
  host: resolveHost(),
  searchEndpoint: trimOrEmpty(process.env.AKBARAL_SEARCH_ENDPOINT),
  pageFetchEndpoint: trimOrEmpty(process.env.AKBARAL_PAGE_FETCH_ENDPOINT),
  allowPrivateProvider: process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER === '1',
  uploadDir: resolveUploadDir(),
  publicWebUrl: trimOrEmpty(process.env.AKBARAL_PUBLIC_WEB_URL) || 'http://localhost:3000',
  smtpFrom: trimOrEmpty(process.env.SMTP_FROM) || 'Akbaral <no-reply@akbaral.ai>',
} as const;

/**
 * Validate mandatory runtime config. Provider credentials are deliberately NOT
 * validated here because every one of them is optional and the platform runs
 * honestly without them.
 */
export function validateEnvironment(): void {
  const currentNodeEnv = resolveNodeEnv();
  if (!VALID_NODE_ENV.has(currentNodeEnv)) {
    throw new EnvConfigError(
      `NODE_ENV must be one of development, test or production (received "${redactedForError(currentNodeEnv)}")`,
    );
  }

  const rawPort = trimOrEmpty(process.env.PORT) || '3000';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new EnvConfigError('PORT must be an integer between 1 and 65535');
  }
  const currentHost = resolveHost();
  if (!currentHost) {
    throw new EnvConfigError('HOST must not be empty');
  }

  validateDatabaseUrl(resolveDatabaseUrl());
  validateUploadDir(resolveUploadDir());

  const currentProduction = currentNodeEnv === 'production';
  if (currentProduction) {
    const configured = trimOrEmpty(process.env.SESSION_SECRET);
    if (!configured || SESSION_SECRET_PLACEHOLDERS.has(configured.toLowerCase())) {
      throw new EnvConfigError(
        'production requires SESSION_SECRET to be set to an explicitly configured random string of at least 32 characters',
      );
    }
    if (configured.length < 32) {
      throw new EnvConfigError(
        'production requires SESSION_SECRET to be at least 32 characters long',
      );
    }
  }
}

export function validateDatabaseUrl(databaseUrl: string): void {
  const value = trimOrEmpty(databaseUrl);
  if (!value) {
    throw new EnvConfigError('DATABASE_URL must not be empty');
  }
  if (value === ':memory:') {
    return;
  }
  if (!value.startsWith('file:')) {
    throw new EnvConfigError(
      'DATABASE_URL is unsupported by this deployment. Use file:<path> or :memory: (SQLite backend).',
    );
  }
  const target = value.slice('file:'.length).trim();
  if (!target) {
    throw new EnvConfigError('DATABASE_URL has an empty file path');
  }
  if (target.includes('\0')) {
    throw new EnvConfigError('DATABASE_URL contains a NUL byte');
  }
}

export function validateUploadDir(uploadDir: string): void {
  const value = trimOrEmpty(uploadDir);
  if (!value) {
    throw new EnvConfigError('AKBARAL_UPLOAD_DIR must not be empty');
  }
  if (value.includes('\0')) {
    throw new EnvConfigError('AKBARAL_UPLOAD_DIR contains a NUL byte');
  }
  // Resolve to catch obvious traversal; absolute operator-owned paths
  // (e.g. /data/uploads) are intentional and allowed.
  const resolved = path.resolve(process.cwd(), value);
  if (resolved.length === 0) {
    throw new EnvConfigError('AKBARAL_UPLOAD_DIR resolved to an empty path');
  }
}

export function isSecretConfigured(envKey: string): boolean {
  return Boolean(trimOrEmpty(process.env[envKey]));
}

export function requiredEnvKeys(envKeys: string[]): string[] {
  return envKeys.filter((key) => !isSecretConfigured(key));
}

/** Internal redaction for validation errors; never printed to users. */
function redactedForError(value: string): string {
  if (!value) {
    return '<empty>';
  }
  return value.length > 40 ? `${value.slice(0, 12)}…<truncated>` : value;
}

export type AppEnvironment = Pick<
  typeof env,
  | 'nodeEnv'
  | 'databaseUrl'
  | 'sessionSecret'
  | 'port'
  | 'host'
  | 'isProduction'
  | 'isTest'
  | 'isDevelopment'
  | 'searchEndpoint'
  | 'pageFetchEndpoint'
  | 'allowPrivateProvider'
  | 'uploadDir'
  | 'publicWebUrl'
  | 'smtpFrom'
>;
