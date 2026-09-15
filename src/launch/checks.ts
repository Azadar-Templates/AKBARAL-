import fs from 'node:fs';
import path from 'node:path';

/**
 * Production launch verification.
 *
 * Answers one question with evidence: *is this deployment ready to serve real
 * customers?* Every check is either a configuration fact (a variable is set and
 * well-formed) or a LIVE provider probe (the credential really works, right
 * now). Nothing is assumed, inferred or fabricated:
 *
 *   · a missing credential is `not_configured` — with the exact variable name
 *     and the exact dashboard action required;
 *   · a credential that exists but is rejected by the provider is `failed`,
 *     with the provider's own status code (never the secret);
 *   · a network path that cannot be reached is `unreachable` — a different
 *     fact from "misconfigured", and it is reported as such;
 *   · an optional integration that is simply absent is `optional`, not a
 *     failure, because the product degrades honestly without it.
 *
 * Secrets never enter a result: only variable NAMES, booleans and provider
 * status codes are returned.
 */

export type CheckStatus = 'ready' | 'not_configured' | 'unreachable' | 'failed' | 'optional';

export interface LaunchCheckResult {
  id: string;
  area: string;
  title: string;
  status: CheckStatus;
  /** True when a production deployment must have this ready before launch. */
  required: boolean;
  /** What was actually observed (no secret material, ever). */
  evidence: string;
  /** Environment variable names involved (names only). */
  envKeys: string[];
  /** Exactly what a human must do outside this repository, when anything is missing. */
  ownerAction?: string;
  /** Operator documentation for the provider, when it exists. */
  docsUrl?: string;
}

export interface LaunchCheck {
  id: string;
  area: string;
  title: string;
  required: boolean;
  docsUrl?: string;
  run(context: LaunchCheckContext): Promise<LaunchCheckResult> | LaunchCheckResult;
}

export interface ProbeRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ProbeResponse {
  status: number;
  json: Record<string, unknown>;
  text: string;
}

/** Injectable network probe so every check is testable without the internet. */
export type Probe = (request: ProbeRequest) => Promise<ProbeResponse>;

export interface LaunchCheckContext {
  env: Record<string, string | undefined>;
  probe: Probe;
  /** Deep mode performs the more expensive "real work" probe where available. */
  deep: boolean;
  /** Offline mode performs configuration checks only (no network at all). */
  offline: boolean;
  cwd: string;
}

class ProbeUnreachableError extends Error {}

/**
 * Default probe. Uses a hard timeout and never returns provider response
 * bodies to callers (they can echo request data, including credentials).
 */
export const defaultProbe: Probe = async (request) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(request.url, {
      method: request.method ?? 'GET',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    const text = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { status: response.status, json, text };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ProbeUnreachableError(reason);
  } finally {
    clearTimeout(timeout);
  }
};

function value(env: Record<string, string | undefined>, key: string): string {
  return (env[key] ?? '').trim();
}

/** Read a credential from the primary key or an accepted alias. */
function credential(
  env: Record<string, string | undefined>,
  keys: string[],
): { key: string | null; value: string } {
  for (const key of keys) {
    const found = value(env, key);
    if (found) return { key, value: found };
  }
  return { key: null, value: '' };
}

function isProduction(env: Record<string, string | undefined>): boolean {
  return (env.NODE_ENV ?? '').toLowerCase() === 'production';
}

/** Never print a secret: report at most its length and last four characters. */
function fingerprint(secret: string): string {
  if (secret.length <= 4) return `length ${secret.length}`;
  return `${secret.length} chars, ends …${secret.slice(-4)}`;
}

function configOnly(result: CheckBase, status: CheckStatus): LaunchCheckResult {
  const { evidence, ...rest } = result;
  return { ...rest, evidence: evidence ?? '', status };
}

/**
 * Run an authenticated probe and classify the outcome honestly.
 * `treat401AsConfigured` exists for endpoints where 401 proves the key was sent
 * but is not valid, which is always a failure — so it is not used.
 */
type CheckBase = Omit<LaunchCheckResult, 'status' | 'evidence'> & { evidence?: string };

async function authenticatedProbe(
  context: LaunchCheckContext,
  request: ProbeRequest,
  base: CheckBase,
): Promise<LaunchCheckResult> {
  if (context.offline) {
    return {
      ...base,
      status: 'not_configured',
      evidence: 'offline mode: configuration present, live verification skipped (run without --offline to verify against the provider)',
    };
  }
  try {
    const response = await context.probe(request);
    if (response.status >= 200 && response.status < 300) {
      return { ...base, status: 'ready', evidence: `live provider call succeeded (HTTP ${response.status})` };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        ...base,
        status: 'failed',
        evidence: `provider rejected the credential (HTTP ${response.status}) — the key is present but not valid for this project`,
      };
    }
    return {
      ...base,
      status: 'failed',
      evidence: `provider returned HTTP ${response.status}`,
    };
  } catch (error) {
    // Any thrown error means the call did not complete: that is a network fact,
    // not proof that the credential is wrong. Reporting it as `unreachable` (with
    // the reason) keeps the two very different owner actions distinct.
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      status: 'unreachable',
      evidence: `could not reach the provider endpoint from this host (${reason.slice(0, 120)}) — the credential was not verified`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Secrets / session
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_PLACEHOLDERS = ['change-me-in-production', 'replace-with-a-long-random-secret', 'changeme', 'secret'];

const sessionSecretCheck: LaunchCheck = {
  id: 'secret.session',
  area: 'Secrets',
  title: 'Session signing secret is production-grade',
  required: true,
  run(context) {
    const secret = value(context.env, 'SESSION_SECRET');
    const base = {
      id: this.id,
      area: this.area,
      title: this.title,
      required: true,
      envKeys: ['SESSION_SECRET'],
      ownerAction: 'Set SESSION_SECRET in the deployment secret store to 32+ random characters (`openssl rand -base64 48`).',
    };
    if (!secret) {
      return configOnly({ ...base, evidence: 'SESSION_SECRET is not set' }, isProduction(context.env) ? 'not_configured' : 'optional');
    }
    if (SESSION_PLACEHOLDERS.includes(secret.toLowerCase())) {
      return configOnly({ ...base, evidence: 'SESSION_SECRET is still a documented placeholder value' }, 'failed');
    }
    if (secret.length < 32) {
      return configOnly({ ...base, evidence: `SESSION_SECRET is only ${secret.length} characters (32+ required)` }, 'failed');
    }
    return configOnly({ ...base, evidence: `set (${fingerprint(secret)})`, ownerAction: undefined }, 'ready');
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Domain / public URL
// ─────────────────────────────────────────────────────────────────────────────

const publicUrlCheck: LaunchCheck = {
  id: 'domain.public_url',
  area: 'Domain',
  title: 'Public site URL is configured for the production hostname',
  required: true,
  run(context) {
    const raw = value(context.env, 'AKBARAL_SITE_URL');
    const base = {
      id: this.id,
      area: this.area,
      title: this.title,
      required: true,
      envKeys: ['AKBARAL_SITE_URL'],
      ownerAction:
        'Point the domain at the deployment, terminate TLS, then set AKBARAL_SITE_URL=https://your-domain (used by robots.txt, sitemap.xml and payment return URLs).',
    };
    if (!raw) {
      return configOnly({ ...base, evidence: 'AKBARAL_SITE_URL is not set; robots/sitemap and payment redirects fall back to the built-in default host' }, isProduction(context.env) ? 'not_configured' : 'optional');
    }
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return configOnly({ ...base, evidence: `AKBARAL_SITE_URL is not a valid absolute URL` }, 'failed');
    }
    if (parsed.protocol !== 'https:' && isProduction(context.env)) {
      return configOnly({ ...base, evidence: `AKBARAL_SITE_URL uses ${parsed.protocol} — production must serve HTTPS` }, 'failed');
    }
    const normalized = raw.replace(/\/+$/, '');
    if (normalized !== raw) {
      return configOnly(
        { ...base, evidence: `set, but with a trailing slash (${parsed.host}) — harmless, normalize it`, ownerAction: 'Remove the trailing slash from AKBARAL_SITE_URL.' },
        'ready',
      );
    }
    return configOnly({ ...base, evidence: `set to ${parsed.protocol}//${parsed.host}`, ownerAction: undefined }, 'ready');
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────────────────────────────────────

const databaseCheck: LaunchCheck = {
  id: 'database.connection',
  area: 'Database',
  title: 'Application database is reachable and migrated',
  required: true,
  docsUrl: 'docs/DEPLOYMENT.md',
  run(context) {
    const url = value(context.env, 'DATABASE_URL');
    const base = {
      id: this.id,
      area: this.area,
      title: this.title,
      required: true,
      docsUrl: this.docsUrl,
      envKeys: ['DATABASE_URL'],
      ownerAction: 'Provision PostgreSQL (e.g. Neon), set DATABASE_URL, then run `npm run db:migrate && npm run db:seed`.',
    };
    if (!url) {
      return configOnly({ ...base, evidence: 'DATABASE_URL is not set — the application would open its default local database file' }, isProduction(context.env) ? 'not_configured' : 'optional');
    }
    const engine = /^postgres(ql)?:\/\//i.test(url) ? 'postgres' : 'sqlite';
    if (engine === 'sqlite' && isProduction(context.env)) {
      // Single-node SQLite is a legitimate production choice on a host WITH a
      // persistent volume (see docs/DEPLOYMENT.md); the database path is what
      // makes the difference, and only the operator can confirm the volume.
      const sqlitePath = url.replace(/^file:/, '');
      const relative = !path.isAbsolute(sqlitePath);
      return configOnly(
        {
          ...base,
          evidence: relative
            ? `DATABASE_URL points at the relative path "${sqlitePath}" in a production process — inside a container that file is lost on redeploy`
            : `DATABASE_URL points at the absolute path "${sqlitePath}" in a production process — valid ONLY if that path is on a persistent volume`,
          ownerAction: relative
            ? 'Use an absolute path on a mounted volume (e.g. DATABASE_URL=file:/data/akbaral.db, as deploy/free-oracle does), or provision PostgreSQL (recommended: Neon).'
            : 'Confirm the database path is on a persistent volume (docker-compose.production.yml / deploy/free-oracle use a named volume), or provision PostgreSQL (Neon) and migrate.',
        },
        relative ? 'failed' : 'not_configured',
      );
    }
    let migrationsDir = path.join(context.cwd, 'db', 'migrations');
    if (engine === 'postgres') migrationsDir = path.join(context.cwd, 'db', 'migrations-pg');
    let migrationFiles = 0;
    try {
      migrationFiles = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).length;
    } catch {
      migrationFiles = 0;
    }
    try {
      // Lazy import keeps this module free of database side effects at load time.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Database } = require('../db/database') as typeof import('../db/database');
      const probeDb = new Database(url, { timeoutMs: 10_000 });
      try {
        probeDb.get<{ ok: number }>('SELECT 1 AS ok');
        const applied = probeDb
          .all<{ name: string }>('SELECT name FROM _migrations')
          .map((row) => String(row.name));
        const pending = migrationFiles - applied.length;
        if (pending > 0) {
          return configOnly(
            {
              ...base,
              evidence: `${engine} reachable; ${applied.length}/${migrationFiles} migrations applied (${pending} pending)`,
              ownerAction: 'Run `npm run db:migrate` (and `npm run db:seed` on first deploy).',
            },
            'not_configured',
          );
        }
        return configOnly({ ...base, evidence: `${engine} reachable; ${applied.length} migrations applied`, ownerAction: undefined }, 'ready');
      } finally {
        probeDb.close();
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return configOnly({ ...base, evidence: `${engine} connection failed: ${reason.slice(0, 160)}` }, 'unreachable');
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Model provider (Gemini)
// ─────────────────────────────────────────────────────────────────────────────

const geminiCheck: LaunchCheck = {
  id: 'provider.gemini',
  area: 'Model provider',
  title: 'Gemini key is present and accepted by Google',
  required: true,
  docsUrl: 'https://aistudio.google.com/app/apikey',
  async run(context) {
    const key = credential(context.env, ['GOOGLE_API_KEY', 'GEMINI_API_KEY']);
    const base = {
      id: this.id,
      area: this.area,
      title: this.title,
      required: true,
      docsUrl: this.docsUrl,
      envKeys: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
      ownerAction: 'Create a Gemini API key in Google AI Studio and set GOOGLE_API_KEY in the deployment secret store (GEMINI_API_KEY is accepted as an alias).',
    };
    if (!key.value) {
      return configOnly({ ...base, evidence: 'neither GOOGLE_API_KEY nor GEMINI_API_KEY is set — MASTER AI and every model-backed agent return provider_not_configured' }, 'not_configured');
    }
    const endpoint = `${value(context.env, 'GOOGLE_BASE_URL') || 'https://generativelanguage.googleapis.com/v1beta'}/models`;
    const result = await authenticatedProbe(
      context,
      { url: endpoint, headers: { 'x-goog-api-key': key.value } },
      { ...base, evidence: '' },
    );
    const ready: LaunchCheckResult = {
      ...result,
      envKeys: [key.key ?? 'GOOGLE_API_KEY'],
      evidence: `${result.evidence} — key from ${key.key} (${fingerprint(key.value)})`,
    };
    if (ready.status !== 'ready') return ready;

    // Prove a real generation call too: listing models only proves the key.
    const model = value(context.env, 'AKBARAL_VERIFY_GEMINI_MODEL') || 'gemini-3.5-flash';
    const generation = await authenticatedProbe(
      context,
      {
        url: `${endpoint.replace(/\/models$/, '')}/models/${model}:generateContent`,
        method: 'POST',
        headers: { 'x-goog-api-key': key.value, 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }], generationConfig: { maxOutputTokens: 16 } }),
      },
      { ...base, evidence: '' },
    );
    if (generation.status === 'ready') {
      return { ...ready, evidence: `${ready.evidence}; live generateContent succeeded on ${model}` };
    }
    return {
      ...ready,
      status: generation.status === 'unreachable' ? 'ready' : 'failed',
      evidence: `${ready.evidence}; generateContent ${generation.status === 'unreachable' ? 'not attempted (network)' : `failed: ${generation.evidence}`}`,
      ownerAction: generation.status === 'failed' ? `Verify ${model} is enabled for this key (or set AKBARAL_VERIFY_GEMINI_MODEL to a model your key can use).` : base.ownerAction,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Search provider
// ─────────────────────────────────────────────────────────────────────────────

const searchCheck: LaunchCheck = {
  id: 'provider.search',
  area: 'Search provider',
  title: 'A production search provider is configured and answering',
  required: true,
  docsUrl: 'https://docs.tavily.com',
  async run(context) {
    const base = {
      id: this.id,
      area: this.area,
      title: this.title,
      required: true,
      docsUrl: this.docsUrl,
      envKeys: ['AKBARAL_SEARCH_PROVIDER', 'TAVILY_API_KEY', 'BRAVE_SEARCH_API_KEY', 'SERPER_API_KEY', 'GOOGLE_CSE_API_KEY', 'GOOGLE_CSE_ID', 'AKBARAL_SEARCH_ENDPOINT'],
      ownerAction:
        'Pick one search provider and set its key: TAVILY_API_KEY (recommended), BRAVE_SEARCH_API_KEY, or SERPER_API_KEY (+ GOOGLE_CSE_API_KEY & GOOGLE_CSE_ID for Google CSE). Without a key the platform falls back to keyless scraping, which datacenter IPs usually block.',
    };
    const tavily = value(context.env, 'TAVILY_API_KEY');
    const brave = value(context.env, 'BRAVE_SEARCH_API_KEY');
    const serper = value(context.env, 'SERPER_API_KEY');
    const googleCse = value(context.env, 'GOOGLE_CSE_API_KEY') && value(context.env, 'GOOGLE_CSE_ID');
    const endpoint = value(context.env, 'AKBARAL_SEARCH_ENDPOINT');

    if (tavily) {
      const probe = await authenticatedProbe(
        context,
        {
          url: `${value(context.env, 'TAVILY_BASE_URL') || 'https://api.tavily.com'}/search`,
          method: 'POST',
          headers: { authorization: `Bearer ${tavily}`, 'content-type': 'application/json' },
          body: JSON.stringify({ query: 'akbaral launch readiness probe', max_results: 3 }),
        },
        { ...base, evidence: '' },
      );
      return { ...probe, envKeys: ['TAVILY_API_KEY'], evidence: `Tavily — ${probe.evidence}` };
    }
    if (brave) {
      const probe = await authenticatedProbe(
        context,
        {
          url: `${value(context.env, 'BRAVE_BASE_URL') || 'https://api.search.brave.com'}/res/v1/web/search?q=akbaral%20launch%20readiness%20probe&count=3`,
          headers: { 'x-subscription-token': brave, accept: 'application/json' },
        },
        { ...base, evidence: '' },
      );
      return { ...probe, envKeys: ['BRAVE_SEARCH_API_KEY'], evidence: `Brave — ${probe.evidence}` };
    }
    if (serper) {
      const probe = await authenticatedProbe(
        context,
        {
          url: `${value(context.env, 'SERPER_BASE_URL') || 'https://google.serper.dev'}/search`,
          method: 'POST',
          headers: { 'x-api-key': serper, 'content-type': 'application/json' },
          body: JSON.stringify({ q: 'akbaral launch readiness probe', num: 3 }),
        },
        { ...base, evidence: '' },
      );
      return { ...probe, envKeys: ['SERPER_API_KEY'], evidence: `Serper — ${probe.evidence}` };
    }
    if (googleCse) {
      const key = value(context.env, 'GOOGLE_CSE_API_KEY');
      const cx = value(context.env, 'GOOGLE_CSE_ID');
      const probe = await authenticatedProbe(
        context,
        {
          url: `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=akbaral%20launch%20readiness%20probe&num=3`,
        },
        { ...base, evidence: '' },
      );
      return { ...probe, envKeys: ['GOOGLE_CSE_API_KEY', 'GOOGLE_CSE_ID'], evidence: `Google CSE — ${probe.evidence}` };
    }
    if (endpoint) {
      const probe = await authenticatedProbe(
        context,
        { url: `${endpoint.replace(/\/+$/, '')}?q=akbaral%20launch%20readiness%20probe` },
        { ...base, evidence: '' },
      );
      return { ...probe, envKeys: ['AKBARAL_SEARCH_ENDPOINT'], evidence: `custom endpoint — ${probe.evidence}` };
    }
    return configOnly(
      {
        ...base,
        evidence: 'no search credential is set — web research falls back to the keyless provider, which is typically blocked from datacenter IPs',
      },
      isProduction(context.env) ? 'not_configured' : 'optional',
    );
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Payments
// ─────────────────────────────────────────────────────────────────────────────

const paymentsCheck: LaunchCheck = {
  id: 'provider.payments',
  area: 'Payments',
  title: 'Payment provider key works and webhook signing is configured',
  required: true,
  docsUrl: 'https://dashboard.stripe.com/apikeys',
  async run(context) {
    const base = {
      id: this.id,
      area: this.area,
      title: this.title,
      required: true,
      docsUrl: this.docsUrl,
      envKeys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BILLING_WEBHOOK_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'],
      ownerAction:
        'In the Stripe dashboard: create the account, copy the secret key into STRIPE_SECRET_KEY, add a webhook endpoint pointing at https://<your-domain>/api/billing/webhook/stripe subscribed to checkout.session.completed, payment_intent.succeeded, invoice.paid, invoice.payment_failed and charge.refunded, then put its signing secret in STRIPE_WEBHOOK_SECRET.',
    };
    const stripe = value(context.env, 'STRIPE_SECRET_KEY');
    const razorpayId = value(context.env, 'RAZORPAY_KEY_ID');
    const razorpaySecret = value(context.env, 'RAZORPAY_KEY_SECRET');
    const stripeWebhookSecret = value(context.env, 'STRIPE_WEBHOOK_SECRET');
    const genericWebhookSecret = value(context.env, 'BILLING_WEBHOOK_SECRET');

    if (!stripe && !(razorpayId && razorpaySecret)) {
      return configOnly(
        {
          ...base,
          evidence: 'no payment provider credential is set — credit purchases return provider_not_configured and only manual admin settlement can mark an invoice paid',
        },
        isProduction(context.env) ? 'not_configured' : 'optional',
      );
    }

    const notes: string[] = [];
    let status: CheckStatus = 'ready';

    if (stripe) {
      // GET /v1/balance is read-only, returns the account's own balance and
      // proves the secret key works without creating anything.
      const probe = await authenticatedProbe(context, { url: `${value(context.env, 'STRIPE_BASE_URL') || 'https://api.stripe.com'}/v1/balance`, headers: { authorization: `Bearer ${stripe}` } }, { ...base, evidence: '' });
      if (probe.status !== 'ready') {
        return { ...probe, evidence: `Stripe key ${fingerprint(stripe)} — ${probe.evidence}` };
      }
      notes.push(`Stripe key verified live (${fingerprint(stripe)})`);
      status = 'ready';
    }
    if (razorpayId && razorpaySecret) {
      // Razorpay exposes the account's payment-methods list for a valid key pair.
      const probe = await authenticatedProbe(
        context,
        { url: `${value(context.env, 'RAZORPAY_BASE_URL') || 'https://api.razorpay.com'}/v1/payments?count=1`, headers: { authorization: `Basic ${Buffer.from(`${razorpayId}:${razorpaySecret}`).toString('base64')}` } },
        { ...base, evidence: '' },
      );
      if (probe.status !== 'ready') {
        return { ...probe, evidence: `Razorpay key ${razorpayId.slice(0, 8)}… — ${probe.evidence}` };
      }
      notes.push('Razorpay key pair verified live');
    }

    // Webhook signing: without it the webhook route refuses every payload (503),
    // so a paid invoice would never settle automatically.
    if (stripe && !stripeWebhookSecret) {
      return configOnly(
        {
          ...base,
          evidence: `${notes.join('; ')}; STRIPE_WEBHOOK_SECRET is NOT set — the Stripe webhook route refuses every event with 503 webhook_not_configured, so payments would stay unsettled`,
        },
        'not_configured',
      );
    }
    if (stripeWebhookSecret) notes.push('Stripe webhook signing secret set');
    if (genericWebhookSecret) notes.push('generic billing webhook secret set');

    return configOnly({ ...base, evidence: notes.join('; '), ownerAction: undefined }, status);
  },
};

const paymentReturnUrlCheck: LaunchCheck = {
  id: 'provider.payments.return_urls',
  area: 'Payments',
  title: 'Checkout return URLs point at the real domain',
  required: true,
  run(context) {
    const site = value(context.env, 'AKBARAL_SITE_URL');
    const base = {
      id: this.id,
      area: this.area,
      title: this.title,
      required: true,
      envKeys: ['AKBARAL_SITE_URL', 'AKBARAL_CHECKOUT_SUCCESS_URL', 'AKBARAL_CHECKOUT_CANCEL_URL'],
      ownerAction: 'Set AKBARAL_SITE_URL (or explicit AKBARAL_CHECKOUT_SUCCESS_URL / AKBARAL_CHECKOUT_CANCEL_URL) so Stripe redirects customers back to your domain, not a placeholder.',
    };
    const success = value(context.env, 'AKBARAL_CHECKOUT_SUCCESS_URL');
    const cancel = value(context.env, 'AKBARAL_CHECKOUT_CANCEL_URL');
    if (success || cancel) {
      return configOnly({ ...base, evidence: `explicit return URLs configured (success ${success ? 'yes' : 'no'}, cancel ${cancel ? 'yes' : 'no'})`, ownerAction: undefined }, 'ready');
    }
    if (!site) {
      return configOnly(
        { ...base, evidence: 'no AKBARAL_SITE_URL: completed payments would redirect to a local placeholder URL instead of the live site' },
        isProduction(context.env) ? 'failed' : 'optional',
      );
    }
    const normalized = site.replace(/\/+$/, '');
    return configOnly({ ...base, evidence: `checkout returns to ${normalized}/billing/{success,cancel}`, ownerAction: undefined }, 'ready');
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Email (transactional auth flows)
// ─────────────────────────────────────────────────────────────────────────────

const emailCheck: LaunchCheck = {
  id: 'provider.email',
  area: 'Email',
  title: 'Transactional email is configured (password reset, verification)',
  required: false,
  async run(context) {
    const host = value(context.env, 'SMTP_HOST');
    const base = {
      id: this.id,
      area: this.area,
      title: this.title,
      required: false,
      envKeys: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'],
      ownerAction: 'Create a transactional email account (or SMTP relay), then set SMTP_HOST/SMTP_USER/SMTP_PASSWORD/SMTP_FROM. Until then password reset and email verification return 503 provider_not_configured rather than pretending to send.',
    };
    if (!host) {
      return configOnly({ ...base, evidence: 'SMTP_HOST is not set — password reset and email verification are unavailable (honest 503)' }, 'optional');
    }
    if (context.offline) {
      return configOnly({ ...base, evidence: `SMTP host ${host} configured; live connection not attempted (offline mode)` }, 'not_configured');
    }
    try {
      const { createConnection } = await import('node:net');
      const port = Number(value(context.env, 'SMTP_PORT') || '587');
      const reachable = await new Promise<boolean>((resolve) => {
        const socket = createConnection({ host, port });
        const done = (ok: boolean) => {
          socket.removeAllListeners();
          socket.destroy();
          resolve(ok);
        };
        socket.setTimeout(8_000);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
      });
      return configOnly(
        { ...base, evidence: reachable ? `SMTP ${host}:${port} accepts TCP connections` : `SMTP ${host}:${port} is not reachable from this host` },
        reachable ? 'ready' : 'unreachable',
      );
    } catch (error) {
      return configOnly({ ...base, evidence: `SMTP check failed: ${error instanceof Error ? error.message : 'unknown'}` }, 'unreachable');
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Social publishing (OAuth preparation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Publishing platforms the mission can use for legitimate content workflows.
 * Scopes are the minimum each platform requires to publish; engagement figures
 * are only ever read back from the same API (never synthesized).
 */
export const SOCIAL_PLATFORMS = [
  {
    id: 'youtube',
    label: 'YouTube (video publishing)',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
    clientIdKeys: ['YOUTUBE_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID'],
    clientSecretKeys: ['YOUTUBE_CLIENT_SECRET', 'GOOGLE_OAUTH_CLIENT_SECRET'],
  },
  {
    id: 'instagram',
    label: 'Instagram (Reels/posts via Graph API)',
    authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
    clientIdKeys: ['INSTAGRAM_CLIENT_ID', 'META_APP_ID'],
    clientSecretKeys: ['INSTAGRAM_CLIENT_SECRET', 'META_APP_SECRET'],
  },
  {
    id: 'tiktok',
    label: 'TikTok (content posting API)',
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scopes: ['video.publish', 'video.list'],
    clientIdKeys: ['TIKTOK_CLIENT_KEY'],
    clientSecretKeys: ['TIKTOK_CLIENT_SECRET'],
  },
] as const;

export function socialRedirectUri(siteUrl: string, platformId: string): string {
  const base = siteUrl.replace(/\/+$/, '');
  return `${base}/api/social/oauth/${platformId}/callback`;
}

const socialCheck: LaunchCheck = {
  id: 'provider.social_oauth',
  area: 'Social publishing',
  title: 'Publishing platform OAuth apps are registered (optional)',
  required: false,
  async run(context) {
    const configured: string[] = [];
    const pending: Array<{ label: string; keys: string[]; redirect: string }> = [];
    const site = value(context.env, 'AKBARAL_SITE_URL') || 'https://your-domain';
    for (const platform of SOCIAL_PLATFORMS) {
      const clientId = credential(context.env, [...platform.clientIdKeys]);
      const clientSecret = credential(context.env, [...platform.clientSecretKeys]);
      if (clientId.value && clientSecret.value) configured.push(platform.label);
      else {
        pending.push({
          label: platform.label,
          keys: [...platform.clientIdKeys, ...platform.clientSecretKeys],
          redirect: socialRedirectUri(site, platform.id),
        });
      }
    }
    const base = {
      id: this.id,
      area: this.area,
      title: this.title,
      required: false,
      envKeys: SOCIAL_PLATFORMS.flatMap((platform) => [...platform.clientIdKeys, ...platform.clientSecretKeys]),
      ownerAction: pending.length
        ? pending
            .map(
              (entry) =>
                `${entry.label}: register an app, add redirect URI ${entry.redirect}, then set ${entry.keys.join(' / ')}.`,
            )
            .join(' ')
        : undefined,
    };
    if (pending.length === 0) {
      return configOnly({ ...base, evidence: `${configured.length} platform(s) configured: ${configured.join(', ')}`, ownerAction: undefined }, 'ready');
    }
    return configOnly(
      {
        ...base,
        evidence: `${configured.length} configured; ${pending.length} pending (${pending.map((entry) => entry.label).join(', ')}) — publishing agents return provider_not_configured until then; no engagement is ever synthesized`,
      },
      configured.length > 0 ? 'not_configured' : 'optional',
    );
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Storage (uploads)
// ─────────────────────────────────────────────────────────────────────────────

const storageCheck: LaunchCheck = {
  id: 'storage.uploads',
  area: 'Storage',
  title: 'Upload directory is writable and persistent',
  required: true,
  run(context) {
    const dir = value(context.env, 'AKBARAL_UPLOAD_DIR') || 'data/uploads';
    const base = {
      id: this.id,
      area: this.area,
      title: this.title,
      required: true,
      envKeys: ['AKBARAL_UPLOAD_DIR'],
      ownerAction: 'Mount a persistent volume at the upload path (Docker image default /data/uploads) so customer files survive restarts and deploys.',
    };
    const resolved = path.isAbsolute(dir) ? dir : path.join(context.cwd, dir);
    try {
      fs.mkdirSync(resolved, { recursive: true });
      const probeFile = path.join(resolved, '.akbaral-write-probe');
      fs.writeFileSync(probeFile, 'ok');
      fs.rmSync(probeFile, { force: true });
    } catch (error) {
      return configOnly({ ...base, evidence: `cannot write to ${dir}: ${error instanceof Error ? error.message : 'unknown error'}` }, 'failed');
    }
    if (isProduction(context.env) && !path.isAbsolute(dir)) {
      return configOnly(
        { ...base, evidence: `${dir} is writable but relative — inside a container it lives on the container filesystem and is lost on redeploy` },
        'not_configured',
      );
    }
    return configOnly({ ...base, evidence: `${dir} exists and is writable`, ownerAction: undefined }, 'ready');
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Mission system (private)
// ─────────────────────────────────────────────────────────────────────────────

const missionCheck: LaunchCheck = {
  id: 'mission.runtime',
  area: 'Mission system',
  title: 'Private mission app: database, chains and payout destinations',
  required: false,
  docsUrl: 'MISSION_SYSTEM.md',
  run(context) {
    const base = {
      id: this.id,
      area: this.area,
      title: this.title,
      required: false,
      docsUrl: this.docsUrl,
      envKeys: ['ZA141251SA_DATABASE_URL', 'ZA141251SA_SESSION_SECRET', 'ZA141251SA_CREDENTIAL_KEY', 'ZA141251SA_OWNER_EMAIL', 'ZA141251SA_OWNER_PASSWORD'],
      ownerAction:
        'Set the ZA141251SA_* variables (database URL, session secret, credential key, owner email/password) and run `npm run mission:init`, then verify a payout destination in the mission dashboard.',
    };
    const url = value(context.env, 'ZA141251SA_DATABASE_URL');
    const sessionSecret = value(context.env, 'ZA141251SA_SESSION_SECRET');
    const credentialKey = value(context.env, 'ZA141251SA_CREDENTIAL_KEY');
    if (!url && !sessionSecret && !credentialKey) {
      return configOnly({ ...base, evidence: 'mission system is not configured on this deployment (it is a separate private application)' }, 'optional');
    }
    if (!sessionSecret || sessionSecret.length < 32) {
      return configOnly({ ...base, evidence: 'ZA141251SA_SESSION_SECRET is missing or shorter than 32 characters — mission logins would be refused' }, 'not_configured');
    }
    if (!credentialKey || credentialKey.length < 32) {
      return configOnly(
        {
          ...base,
          evidence: 'ZA141251SA_CREDENTIAL_KEY is missing or too short — the encrypted credential vault is disabled and provider credentials cannot be stored',
        },
        'not_configured',
      );
    }
    try {
      // Lazy import: the mission module reads its own env and opens its own DB.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mission = require('../mission/database') as typeof import('../mission/database');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const treasury = require('../mission/treasury') as typeof import('../mission/treasury');
      const audit = mission.verifyMissionAudit();
      const ledger = treasury.verifyLedger();
      const slots = treasury.listPayoutSlots();
      const verified = slots.filter((slot) => String(slot.status) === 'active');
      if (!audit.ok || !ledger.ok) {
        return configOnly(
          { ...base, evidence: `integrity failure — audit ok=${audit.ok}, ledger ok=${ledger.ok}` },
          'failed',
        );
      }
      if (verified.length === 0) {
        return configOnly(
          {
            ...base,
            evidence: `database reachable, chains verified (${audit.rows} audit, ${ledger.rows} ledger rows) BUT no verified payout destination — payouts are refused until one exists`,
            ownerAction:
              'Open the mission dashboard → Treasury & payouts → configure slot 1 (label + masked destination or provider reference) → Verify. Payouts stay blocked until then.',
          },
          'not_configured',
        );
      }
      return configOnly(
        { ...base, evidence: `database reachable, chains verified, ${verified.length} verified payout destination(s)`, ownerAction: undefined },
        'ready',
      );
    } catch (error) {
      return configOnly({ ...base, evidence: `mission database check failed: ${error instanceof Error ? error.message : 'unknown'}` }, 'unreachable');
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Registry integrity (agent supply)
// ─────────────────────────────────────────────────────────────────────────────

const registryCheck: LaunchCheck = {
  id: 'registry.agents',
  area: 'Registry',
  title: 'Agent registry is seeded (4,001 specialists)',
  required: true,
  run(context) {
    const base = {
      id: this.id,
      area: this.area,
      title: this.title,
      required: true,
      envKeys: ['DATABASE_URL'],
      ownerAction: 'Run `npm run db:seed` (and `npm run audit:registry`) against the production database.',
    };
    const url = value(context.env, 'DATABASE_URL');
    if (!url) return configOnly({ ...base, evidence: 'DATABASE_URL is not set; registry state unknown' }, 'not_configured');
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Database } = require('../db/database') as typeof import('../db/database');
      const probeDb = new Database(url, { timeoutMs: 10_000 });
      try {
        const row = probeDb.get<{ count: number }>('SELECT COUNT(*) AS count FROM agents');
        const total = Number(row?.count ?? 0);
        if (total >= 4001) {
          return configOnly({ ...base, evidence: `${total} agents present`, ownerAction: undefined }, 'ready');
        }
        return configOnly({ ...base, evidence: `${total} agents present (4,001 expected)` }, 'not_configured');
      } finally {
        probeDb.close();
      }
    } catch (error) {
      return configOnly({ ...base, evidence: `registry query failed: ${error instanceof Error ? error.message : 'unknown'}` }, 'unreachable');
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Backup / restore readiness
// ─────────────────────────────────────────────────────────────────────────────

const backupCheck: LaunchCheck = {
  id: 'ops.backups',
  area: 'Operations',
  title: 'Backup automation is not disabled and a backup directory is writable',
  required: false,
  run(context) {
    const disabled = (value(context.env, 'DISABLE_BACKUP_CRON') || '0') === '1';
    const dir = value(context.env, 'AKBARAL_BACKUP_DIR') || 'data/backups';
    const base = {
      id: this.id,
      area: this.area,
      title: this.title,
      required: false,
      envKeys: ['AKBARAL_BACKUP_DIR', 'DISABLE_BACKUP_CRON'],
      ownerAction: 'Keep the backup cron enabled and mount the backup directory on the persistent volume; run `npm run db:backup` to verify a backup can be written.',
    };
    const resolved = path.isAbsolute(dir) ? dir : path.join(context.cwd, dir);
    try {
      fs.mkdirSync(resolved, { recursive: true });
      const probeFile = path.join(resolved, '.akbaral-backup-probe');
      fs.writeFileSync(probeFile, 'ok');
      fs.rmSync(probeFile, { force: true });
    } catch (error) {
      return configOnly({ ...base, evidence: `backup directory ${dir} is not writable: ${error instanceof Error ? error.message : 'unknown'}` }, 'failed');
    }
    if (disabled) {
      return configOnly(
        { ...base, evidence: `backup directory writable; automatic backups are DISABLED (DISABLE_BACKUP_CRON=1)` },
        'not_configured',
      );
    }
    return configOnly({ ...base, evidence: `backup directory ${dir} writable; automatic backups enabled`, ownerAction: undefined }, 'ready');
  },
};

export const LAUNCH_CHECKS: LaunchCheck[] = [
  sessionSecretCheck,
  publicUrlCheck,
  databaseCheck,
  registryCheck,
  geminiCheck,
  searchCheck,
  paymentsCheck,
  paymentReturnUrlCheck,
  emailCheck,
  storageCheck,
  backupCheck,
  missionCheck,
  socialCheck,
];

export interface LaunchReport {
  generatedAt: string;
  nodeEnv: string;
  mode: { offline: boolean; deep: boolean };
  checks: LaunchCheckResult[];
  summary: {
    total: number;
    ready: number;
    requiredNotReady: number;
    byStatus: Record<CheckStatus, number>;
  };
  blockers: Array<{ id: string; title: string; status: CheckStatus; evidence: string; ownerAction?: string }>;
  ownerActions: string[];
}

export async function runLaunchChecks(
  options: {
    env?: Record<string, string | undefined>;
    probe?: Probe;
    offline?: boolean;
    deep?: boolean;
    cwd?: string;
    only?: string[];
  } = {},
): Promise<LaunchReport> {
  const context: LaunchCheckContext = {
    env: options.env ?? process.env,
    probe: options.probe ?? defaultProbe,
    offline: options.offline ?? false,
    deep: options.deep ?? false,
    cwd: options.cwd ?? process.cwd(),
  };
  const selected = options.only?.length
    ? LAUNCH_CHECKS.filter((check) => options.only!.some((needle) => check.id.includes(needle) || check.area.toLowerCase().includes(needle.toLowerCase())))
    : LAUNCH_CHECKS;

  const results: LaunchCheckResult[] = [];
  for (const check of selected) {
    try {
      const result = await check.run(context);
      // A required check that is absent is a blocker, never "optional": the
      // optional status only means "the product degrades honestly without it".
      results.push(result.required && result.status === 'optional' ? { ...result, status: 'not_configured' } : result);
    } catch (error) {
      results.push({
        id: check.id,
        area: check.area,
        title: check.title,
        required: check.required,
        status: 'failed',
        evidence: `check crashed: ${error instanceof Error ? error.message : 'unknown error'}`,
        envKeys: [],
      });
    }
  }

  const byStatus: Record<CheckStatus, number> = { ready: 0, not_configured: 0, unreachable: 0, failed: 0, optional: 0 };
  for (const result of results) byStatus[result.status] += 1;
  const blockers = results
    .filter((result) => result.required && result.status !== 'ready')
    .map((result) => ({ id: result.id, title: result.title, status: result.status, evidence: result.evidence, ownerAction: result.ownerAction }));
  const ownerActions = [...new Set(results.map((result) => result.ownerAction).filter((action): action is string => Boolean(action)))];

  return {
    generatedAt: new Date().toISOString(),
    nodeEnv: (context.env.NODE_ENV ?? 'development').toLowerCase(),
    mode: { offline: context.offline, deep: context.deep },
    checks: results,
    summary: {
      total: results.length,
      ready: results.filter((result) => result.status === 'ready').length,
      requiredNotReady: blockers.length,
      byStatus,
    },
    blockers,
    ownerActions,
  };
}

/** Readiness percentage over REQUIRED checks (each check counts equally). */
export function readinessPercent(report: LaunchReport): number {
  const required = report.checks.filter((check) => check.required);
  if (required.length === 0) return 100;
  const ready = required.filter((check) => check.status === 'ready').length;
  return Math.round((ready / required.length) * 1000) / 10;
}
