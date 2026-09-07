import 'dotenv/config';

/**
 * Central, typed access to runtime configuration.
 *
 * Values are read from the environment (loaded by dotenv from `.env` in
 * development). Secrets are not logged or committed here; the local defaults
 * exist only to keep the dev database foundation runnable out of the box.
 */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: process.env.DATABASE_URL ?? 'file:./data/akbaral.db',
  sessionSecret: process.env.SESSION_SECRET ?? 'change-me-in-production',
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  isProduction: (process.env.NODE_ENV ?? 'development') === 'production',
  isTest: (process.env.NODE_ENV ?? 'development') === 'test',
  searchEndpoint: process.env.AKBARAL_SEARCH_ENDPOINT ?? '',
  pageFetchEndpoint: process.env.AKBARAL_PAGE_FETCH_ENDPOINT ?? '',
} as const;

export type AppEnvironment = Pick<
  typeof env,
  | 'nodeEnv'
  | 'databaseUrl'
  | 'sessionSecret'
  | 'port'
  | 'host'
  | 'isProduction'
  | 'isTest'
  | 'searchEndpoint'
  | 'pageFetchEndpoint'
>;
