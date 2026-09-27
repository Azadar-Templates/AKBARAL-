// ─────────────────────────────────────────────────────────────────────────────
// API / provider dependency matrix
//
// One matrix for both systems, derived from the code that actually reads the
// variable. Every row answers the same eight questions:
//
//   provider · env var · used by · required or optional · free option ·
//   credential / OAuth needed · can this sandbox configure and test it ·
//   what breaks when it is missing
//
// `usedBy` is NOT hand-written: scanEnvUsage() reads the source tree, so a row
// cannot drift from reality. dependency-matrix.test.ts fails the build when a
// runtime variable is missing from the matrix or a row references a variable
// no longer read anywhere.
//
// Status values are the project's exact labels: REQUIRED, OPTIONAL,
// CREDENTIAL REQUIRED, NOT IMPLEMENTED, RUNTIME BLOCKED. Nothing here reads a
// secret value — only whether a name is set.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';

export type MatrixSystem = 'AKBARAL!' | 'ZA141251SA' | 'shared';

/** Whether this sandbox (no outbound network) can set it up and prove it works. */
export type SandboxVerdict =
  | 'configurable and testable here'
  | 'configurable here, not testable (no outbound network)'
  | 'owner action required (external account, KYC or OAuth consent)';

export interface DependencyRow {
  envVar: string;
  provider: string;
  system: MatrixSystem;
  /** What the value is for, in one line. */
  purpose: string;
  requirement: 'REQUIRED' | 'OPTIONAL' | 'CREDENTIAL REQUIRED';
  /** A genuinely free path, or null when none exists. */
  freeOption: string | null;
  /** What has to be obtained: API key, OAuth client, account, nothing. */
  credential: string;
  sandbox: SandboxVerdict;
  /** Exact behaviour with the variable unset — never "it fails". */
  breaksWithout: string;
}

/**
 * Rows are ordered by system then provider. Every entry was written against
 * the reading code, not against documentation.
 */
export const DEPENDENCY_ROWS: DependencyRow[] = [
  // ── shared runtime ────────────────────────────────────────────────────────
  {
    envVar: 'NODE_ENV',
    provider: 'Node.js runtime',
    system: 'shared',
    purpose: 'Selects production hardening (secret length checks, cookie flags, error detail).',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Runs in development mode: relaxed secret rules and verbose errors.',
  },
  {
    envVar: 'HOST',
    provider: 'Node.js runtime',
    system: 'AKBARAL!',
    purpose: 'Bind address of the public server.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Binds 0.0.0.0, which is what a container or preview proxy needs.',
  },
  {
    envVar: 'PORT',
    provider: 'Node.js runtime',
    system: 'AKBARAL!',
    purpose: 'Public HTTP port (frontend + /api proxy).',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Defaults to port 3000 for the public server.',
  },
  {
    envVar: 'TRUST_PROXY',
    provider: 'Node.js runtime',
    system: 'AKBARAL!',
    purpose: 'Whether X-Forwarded-For may be trusted for client IP and rate limiting.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Proxy headers are ignored; rate limits key on the socket address.',
  },
  {
    envVar: 'CORS_ORIGINS',
    provider: 'Node.js runtime',
    system: 'AKBARAL!',
    purpose: 'Allow-list of browser origins for the API.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Same-origin only; cross-origin browser calls are refused.',
  },
  {
    envVar: 'DATABASE_URL',
    provider: 'SQLite / PostgreSQL',
    system: 'AKBARAL!',
    purpose: 'Customer-side database connection (file: SQLite or postgres:// DSN).',
    requirement: 'OPTIONAL',
    freeOption: 'local SQLite file under DATA_DIR — no server, no account',
    credential: 'none for SQLite; DSN for PostgreSQL',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Falls back to the local SQLite file; no data is lost or invented.',
  },
  {
    envVar: 'DATA_DIR',
    provider: 'filesystem',
    system: 'shared',
    purpose: 'Root for databases, uploads and backups.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses the ./data folder inside the repository.',
  },
  {
    envVar: 'SESSION_SECRET',
    provider: 'AKBARAL! auth',
    system: 'AKBARAL!',
    purpose: 'Signs customer session and refresh tokens.',
    requirement: 'REQUIRED',
    freeOption: 'generated locally and persisted (no provider involved)',
    credential: 'none — a local random 32+ byte secret',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Production start is refused; in development a persisted local secret is generated so sessions survive restarts.',
  },
  {
    envVar: 'SESSION_SECRET_PREVIOUS',
    provider: 'AKBARAL! auth',
    system: 'AKBARAL!',
    purpose: 'Accepts tokens signed by the previous secret during rotation.',
    requirement: 'OPTIONAL',
    freeOption: 'generated locally',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'A secret rotation logs every session out immediately instead of draining.',
  },
  {
    envVar: 'AKBARAL_SESSION_SECRET_FILE',
    provider: 'AKBARAL! auth',
    system: 'AKBARAL!',
    purpose: 'Path of the persisted development session secret.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses the default path under DATA_DIR.',
  },

  // ── AKBARAL! — model providers ────────────────────────────────────────────
  {
    envVar: 'OPENAI_API_KEY',
    provider: 'OpenAI',
    system: 'AKBARAL!',
    purpose: 'LLM chat, vision and image generation for customer agents.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: null,
    credential: 'OpenAI account + API key (paid, card on file)',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'OpenAI-routed tools return provider_not_configured; nothing is faked and no other provider is silently substituted.',
  },
  {
    envVar: 'GOOGLE_API_KEY',
    provider: 'Google AI Studio (Gemini) / Google Places',
    system: 'AKBARAL!',
    purpose: 'Gemini model calls and Google Places text search for the tool registry.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'Google AI Studio free tier — no card, provider-enforced daily quota',
    credential: 'Google account + AI Studio API key',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Gemini and Places tools return provider_not_configured.',
  },
  {
    envVar: 'OMNIROUTE_ENABLED',
    provider: 'OmniRoute gateway (self-hosted)',
    system: 'AKBARAL!',
    purpose: 'Routes model calls through a private 127.0.0.1 gateway instead of direct providers.',
    requirement: 'OPTIONAL',
    freeOption: 'self-hosted, MIT licensed — free to run, still needs upstream provider accounts',
    credential: 'none for the gateway itself',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Model calls go directly to the configured provider.',
  },
  {
    envVar: 'OMNIROUTE_BASE_URL',
    provider: 'OmniRoute gateway (self-hosted)',
    system: 'AKBARAL!',
    purpose: 'Gateway endpoint; must stay private (loopback).',
    requirement: 'OPTIONAL',
    freeOption: 'self-hosted',
    credential: 'none',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Defaults to the loopback gateway address.',
  },
  {
    envVar: 'OMNIROUTE_API_KEY',
    provider: 'OmniRoute gateway (self-hosted)',
    system: 'AKBARAL!',
    purpose: 'Authenticates this app to the local gateway.',
    requirement: 'OPTIONAL',
    freeOption: 'self-issued by the gateway operator (the owner)',
    credential: 'gateway-issued key',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'The gateway path stays off; direct providers are used.',
  },
  {
    envVar: 'OMNIROUTE_MODEL_AUTO',
    provider: 'OmniRoute gateway (self-hosted)',
    system: 'AKBARAL!',
    purpose: 'Model id used for the gateway auto-routing strategy.',
    requirement: 'OPTIONAL',
    freeOption: 'self-hosted',
    credential: 'none',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Uses the gateway default model id.',
  },
  {
    envVar: 'AKBARAL_PROVIDER_TIMEOUT_MS',
    provider: 'model client',
    system: 'AKBARAL!',
    purpose: 'Hard timeout for a provider HTTP call.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses the built-in timeout.',
  },
  {
    envVar: 'AKBARAL_ALLOW_PRIVATE_PROVIDER',
    provider: 'SSRF guard',
    system: 'AKBARAL!',
    purpose: 'Permits provider/search/fetch endpoints on private addresses (local fixtures, local gateway).',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Private and loopback endpoints are refused by the SSRF guard — the safe default.',
  },

  // ── AKBARAL! — search and fetch ───────────────────────────────────────────
  {
    envVar: 'AKBARAL_SEARCH_PROVIDER',
    provider: 'web search',
    system: 'AKBARAL!',
    purpose: 'Explicitly selects the search backend (tavily, brave, serper, google_cse, duckduckgo).',
    requirement: 'OPTIONAL',
    freeOption: 'keyless DuckDuckGo HTML endpoint',
    credential: 'depends on the selected provider',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'The first provider with credentials is used, else the keyless default.',
  },
  {
    envVar: 'AKBARAL_SEARCH_ENDPOINT',
    provider: 'web search',
    system: 'AKBARAL!',
    purpose: 'Custom https:// search proxy endpoint.',
    requirement: 'OPTIONAL',
    freeOption: 'keyless DuckDuckGo default',
    credential: 'none (endpoint must be public https unless the private-provider flag is set)',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Uses the selected provider or the keyless default.',
  },
  {
    envVar: 'AKBARAL_SEARCH_RATE_LIMIT',
    provider: 'web search',
    system: 'AKBARAL!',
    purpose: 'Per-window cap on agent searches.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses the built-in limit.',
  },
  {
    envVar: 'AKBARAL_PAGE_FETCH_ENDPOINT',
    provider: 'page fetch',
    system: 'AKBARAL!',
    purpose: 'Optional readability proxy for page extraction.',
    requirement: 'OPTIONAL',
    freeOption: 'direct public fetch with SSRF protection',
    credential: 'none',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Pages are fetched directly from their public URL.',
  },

  // ── AKBARAL! — OAuth sign-in ──────────────────────────────────────────────
  {
    envVar: 'GOOGLE_CLIENT_ID',
    provider: 'Google OAuth',
    system: 'AKBARAL!',
    purpose: 'Sign in with Google.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free Google Cloud OAuth client (no charge, consent screen review for public use)',
    credential: 'OAuth client id + secret, registered redirect URI',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Google button renders disabled with the reason shown; email/password sign-in is unaffected.',
  },
  {
    envVar: 'GOOGLE_CLIENT_SECRET',
    provider: 'Google OAuth',
    system: 'AKBARAL!',
    purpose: 'Sign in with Google (token exchange).',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free Google Cloud OAuth client',
    credential: 'OAuth client secret',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Google button stays disabled.',
  },
  {
    envVar: 'GITHUB_CLIENT_ID',
    provider: 'GitHub OAuth',
    system: 'AKBARAL!',
    purpose: 'Sign in with GitHub.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free GitHub OAuth app',
    credential: 'OAuth client id + secret, registered callback URL',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The GitHub button renders disabled with the reason shown.',
  },
  {
    envVar: 'GITHUB_CLIENT_SECRET',
    provider: 'GitHub OAuth',
    system: 'AKBARAL!',
    purpose: 'Sign in with GitHub (token exchange).',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free GitHub OAuth app',
    credential: 'OAuth client secret',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The GitHub button stays disabled.',
  },
  {
    envVar: 'MS_CLIENT_ID',
    provider: 'Microsoft OAuth',
    system: 'AKBARAL!',
    purpose: 'Sign in with Microsoft.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free Entra ID app registration',
    credential: 'application (client) id + secret',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Microsoft button renders disabled with the reason shown.',
  },
  {
    envVar: 'MS_CLIENT_SECRET',
    provider: 'Microsoft OAuth',
    system: 'AKBARAL!',
    purpose: 'Sign in with Microsoft (token exchange).',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free Entra ID app registration',
    credential: 'client secret',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Microsoft button stays disabled.',
  },
  {
    envVar: 'APPLE_CLIENT_ID',
    provider: 'Apple OAuth',
    system: 'AKBARAL!',
    purpose: 'Sign in with Apple (services id).',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: null,
    credential: 'Apple Developer Program membership (paid yearly) + services id, key id, team id, private key',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Apple button renders disabled with the reason shown.',
  },
  {
    envVar: 'APPLE_CLIENT_SECRET',
    provider: 'Apple OAuth',
    system: 'AKBARAL!',
    purpose: 'Pre-generated Apple client assertion, when not derived from the private key.',
    requirement: 'OPTIONAL',
    freeOption: null,
    credential: 'derived from the Apple private key',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The assertion is derived from APPLE_PRIVATE_KEY instead.',
  },
  {
    envVar: 'APPLE_KEY_ID',
    provider: 'Apple OAuth',
    system: 'AKBARAL!',
    purpose: 'Key id of the Apple sign-in key.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: null,
    credential: 'Apple Developer Program key',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Apple button stays disabled.',
  },
  {
    envVar: 'APPLE_TEAM_ID',
    provider: 'Apple OAuth',
    system: 'AKBARAL!',
    purpose: 'Apple developer team id.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: null,
    credential: 'Apple Developer Program membership',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Apple button stays disabled.',
  },
  {
    envVar: 'APPLE_PRIVATE_KEY',
    provider: 'Apple OAuth',
    system: 'AKBARAL!',
    purpose: 'Signs the Apple client assertion.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: null,
    credential: 'Apple .p8 private key',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Apple button stays disabled.',
  },
  {
    envVar: 'OAUTH_GOOGLE_BASE_URL',
    provider: 'Google OAuth',
    system: 'AKBARAL!',
    purpose: 'Overrides the Google OAuth host (used by the local test fixture).',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Requests go to the real Google OAuth endpoint.',
  },
  {
    envVar: 'OAUTH_GITHUB_BASE_URL',
    provider: 'GitHub OAuth',
    system: 'AKBARAL!',
    purpose: 'Overrides the GitHub OAuth host (local fixture).',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Requests go to the real GitHub OAuth endpoint.',
  },
  {
    envVar: 'OAUTH_MS_BASE_URL',
    provider: 'Microsoft OAuth',
    system: 'AKBARAL!',
    purpose: 'Overrides the Microsoft OAuth host (local fixture).',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Requests go to the real Microsoft OAuth endpoint.',
  },
  {
    envVar: 'OAUTH_APPLE_BASE_URL',
    provider: 'Apple OAuth',
    system: 'AKBARAL!',
    purpose: 'Overrides the Apple OAuth host (local fixture).',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Requests go to the real Apple OAuth endpoint.',
  },
  {
    envVar: 'OAUTH_FACEBOOK_BASE_URL',
    provider: 'Facebook OAuth',
    system: 'AKBARAL!',
    purpose: 'Overrides the Facebook OAuth host (local fixture).',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Requests go to the real Facebook OAuth endpoint.',
  },

  // ── AKBARAL! — email ──────────────────────────────────────────────────────
  {
    envVar: 'SMTP_HOST',
    provider: 'SMTP mail server',
    system: 'AKBARAL!',
    purpose: 'Delivery host for verification, reset, security and billing email.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free SMTP tiers exist (e.g. Brevo, Resend, Gmail app password) — all need an account and sender verification',
    credential: 'SMTP host + user + password, verified sender domain',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'Email is NOT delivered. Verification and reset tokens are only recorded in development token mode; no message leaves the system.',
  },
  {
    envVar: 'SMTP_PORT',
    provider: 'SMTP mail server',
    system: 'AKBARAL!',
    purpose: 'TCP port used for SMTP submission.',
    requirement: 'OPTIONAL',
    freeOption: null,
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses the default submission port.',
  },
  {
    envVar: 'SMTP_SECURE',
    provider: 'SMTP mail server',
    system: 'AKBARAL!',
    purpose: 'Whether to use implicit TLS on connect instead of STARTTLS.',
    requirement: 'OPTIONAL',
    freeOption: null,
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'STARTTLS is negotiated instead.',
  },
  {
    envVar: 'SMTP_USER',
    provider: 'SMTP mail server',
    system: 'AKBARAL!',
    purpose: 'Login user for the SMTP server.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free tier account',
    credential: 'mailbox or API user',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'No mail is sent; nothing claims that email works.',
  },
  {
    envVar: 'SMTP_PASSWORD',
    provider: 'SMTP mail server',
    system: 'AKBARAL!',
    purpose: 'Password for the SMTP login (primary variable name).',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free tier account',
    credential: 'mailbox password or app password',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'No mail is sent; nothing claims that email works.',
  },
  {
    envVar: 'SMTP_PASS',
    provider: 'SMTP mail server',
    system: 'AKBARAL!',
    purpose: 'Alternate password name accepted by the workforce mailer.',
    requirement: 'OPTIONAL',
    freeOption: 'free tier account',
    credential: 'same as SMTP_PASSWORD',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'SMTP_PASSWORD is used.',
  },
  {
    envVar: 'SMTP_FROM',
    provider: 'SMTP mail server',
    system: 'AKBARAL!',
    purpose: 'Envelope/from address.',
    requirement: 'OPTIONAL',
    freeOption: null,
    credential: 'verified sender address',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Falls back to the configured SMTP user.',
  },
  {
    envVar: 'SMTP_EHLO',
    provider: 'SMTP mail server',
    system: 'AKBARAL!',
    purpose: 'EHLO hostname presented to the server.',
    requirement: 'OPTIONAL',
    freeOption: null,
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Presents the local hostname in EHLO.',
  },
  {
    envVar: 'SMTP_TIMEOUT_MS',
    provider: 'SMTP mail server',
    system: 'AKBARAL!',
    purpose: 'Socket timeout for the SMTP conversation.',
    requirement: 'OPTIONAL',
    freeOption: null,
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses the built-in timeout.',
  },
  {
    envVar: 'OWNER_ALERT_EMAIL',
    provider: 'SMTP mail server',
    system: 'AKBARAL!',
    purpose: 'Destination for workforce/system alerts.',
    requirement: 'OPTIONAL',
    freeOption: null,
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Alerts are recorded in the database but not emailed.',
  },

  // ── AKBARAL! — payments and webhooks ──────────────────────────────────────
  {
    envVar: 'STRIPE_SECRET_KEY',
    provider: 'Stripe',
    system: 'AKBARAL!',
    purpose: 'Customer credit purchases via Payment Intents.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'no platform fee to create an account, but Stripe is NOT available to Pakistan-resident accounts',
    credential: 'Stripe account (KYC) + secret key',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'Card checkout is unavailable; credits can only be settled manually by an admin. No fake payment is recorded.',
  },
  {
    envVar: 'STRIPE_WEBHOOK_SECRET',
    provider: 'Stripe',
    system: 'AKBARAL!',
    purpose: 'Verifies Stripe webhook signatures.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'included with a Stripe account',
    credential: 'webhook signing secret',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'Stripe webhooks are rejected as unverified — a payment can never be credited on an unsigned callback.',
  },
  {
    envVar: 'RAZORPAY_KEY_ID',
    provider: 'Razorpay',
    system: 'AKBARAL!',
    purpose: 'Alternative card/UPI checkout.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'account creation is free; Razorpay onboarding is India-only',
    credential: 'Razorpay account (KYC) + key id',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Razorpay path is unavailable; manual settlement only.',
  },
  {
    envVar: 'RAZORPAY_KEY_SECRET',
    provider: 'Razorpay',
    system: 'AKBARAL!',
    purpose: 'Signs and verifies Razorpay orders and callbacks.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'included with the account',
    credential: 'key secret',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'Razorpay callbacks cannot be verified and are refused.',
  },
  {
    envVar: 'BILLING_WEBHOOK_SECRET',
    provider: 'billing webhook',
    system: 'AKBARAL!',
    purpose: 'HMAC secret for the generic billing webhook.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'self-issued local secret',
    credential: 'shared secret agreed with the sender',
    sandbox: 'configurable and testable here',
    breaksWithout: 'The endpoint answers webhook_not_configured and credits nothing.',
  },
  {
    envVar: 'AKBARAL_CHECKOUT_SUCCESS_URL',
    provider: 'billing',
    system: 'AKBARAL!',
    purpose: 'Return URL after a successful checkout.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Derived from AKBARAL_SITE_URL.',
  },
  {
    envVar: 'AKBARAL_CHECKOUT_CANCEL_URL',
    provider: 'billing',
    system: 'AKBARAL!',
    purpose: 'Return URL after a cancelled checkout.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Derived from AKBARAL_SITE_URL.',
  },
  {
    envVar: 'AKBARAL_MARKETPLACE_COMMISSION_BPS',
    provider: 'marketplace',
    system: 'AKBARAL!',
    purpose: 'Commission taken on marketplace sales, in basis points.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses the built-in default rate.',
  },

  // ── AKBARAL! — agent tool providers ───────────────────────────────────────
  {
    envVar: 'TWILIO_ACCOUNT_SID',
    provider: 'Twilio',
    system: 'AKBARAL!',
    purpose: 'SMS/WhatsApp sending tool.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'trial credit only; production sending is paid and needs sender registration',
    credential: 'Twilio account (KYC) + account SID',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The messaging tool returns provider_not_configured.',
  },
  {
    envVar: 'TWILIO_AUTH_TOKEN',
    provider: 'Twilio',
    system: 'AKBARAL!',
    purpose: 'Twilio API authentication.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'trial credit only',
    credential: 'auth token',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The messaging tool returns provider_not_configured.',
  },
  {
    envVar: 'YOUTUBE_ACCESS_TOKEN',
    provider: 'YouTube Data API v3',
    system: 'AKBARAL!',
    purpose: 'Publishing tool for YouTube.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free API quota, but requires a Google Cloud project and OAuth consent',
    credential: 'OAuth access token for the channel owner',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The YouTube tool returns provider_not_configured.',
  },
  {
    envVar: 'INSTAGRAM_ACCESS_TOKEN',
    provider: 'Instagram Graph API',
    system: 'AKBARAL!',
    purpose: 'Publishing tool for Instagram.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free API, but requires a Meta app, business account and app review',
    credential: 'long-lived Graph API token',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Instagram tool returns provider_not_configured.',
  },
  {
    envVar: 'X_BEARER_TOKEN',
    provider: 'X API v2',
    system: 'AKBARAL!',
    purpose: 'Posting tool for X.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'the free X tier allows very limited posting; read access is paid',
    credential: 'X developer account + bearer token',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The X tool returns provider_not_configured.',
  },
  {
    envVar: 'SHOPIFY_STORE_DOMAIN',
    provider: 'Shopify Admin API',
    system: 'AKBARAL!',
    purpose: 'Target store for the commerce tool.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'development store is free; a live store is a paid plan',
    credential: 'store domain',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Shopify tool returns provider_not_configured.',
  },
  {
    envVar: 'SHOPIFY_ACCESS_TOKEN',
    provider: 'Shopify Admin API',
    system: 'AKBARAL!',
    purpose: 'Admin API authentication.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'included with a store',
    credential: 'custom app admin token',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Shopify tool returns provider_not_configured.',
  },
  {
    envVar: 'GITHUB_TOKEN',
    provider: 'GitHub REST API',
    system: 'ZA141251SA',
    purpose: 'Raises the GitHub search rate limit while ingesting public paid-issue opportunities.',
    requirement: 'OPTIONAL',
    freeOption: 'unauthenticated search works at a much lower rate limit',
    credential: 'personal access token (public scope is enough)',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Ingestion still runs unauthenticated and is throttled sooner.',
  },
  {
    envVar: 'GH_TOKEN',
    provider: 'GitHub REST API',
    system: 'ZA141251SA',
    purpose: 'Alternate name for the GitHub token.',
    requirement: 'OPTIONAL',
    freeOption: 'unauthenticated search',
    credential: 'personal access token',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'GITHUB_TOKEN is used, or the unauthenticated rate limit applies.',
  },
  {
    envVar: 'AKBARAL_EXPO_PUSH_URL',
    provider: 'Expo push service',
    system: 'AKBARAL!',
    purpose: 'Mobile push delivery endpoint.',
    requirement: 'OPTIONAL',
    freeOption: 'Expo push is free for reasonable volumes',
    credential: 'none for the default endpoint',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Uses the default Expo endpoint.',
  },
  {
    envVar: 'AKBARAL_ADSENSE_CLIENT',
    provider: 'Google AdSense',
    system: 'AKBARAL!',
    purpose: 'Publishes ads.txt for the site.',
    requirement: 'OPTIONAL',
    freeOption: 'free AdSense account (approval required)',
    credential: 'AdSense publisher id',
    sandbox: 'configurable and testable here',
    breaksWithout: 'ads.txt is served empty; no ad claim is made.',
  },

  // ── AKBARAL! — site and runtime wiring ────────────────────────────────────
  {
    envVar: 'AKBARAL_SITE_URL',
    provider: 'AKBARAL! site',
    system: 'AKBARAL!',
    purpose: 'Canonical public URL for robots.txt, sitemap and checkout returns.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses the local origin; sitemap/robots point at localhost.',
  },
  {
    envVar: 'AKBARAL_PUBLIC_WEB_URL',
    provider: 'AKBARAL! site',
    system: 'AKBARAL!',
    purpose: 'Public web origin used when building absolute links.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Falls back to AKBARAL_SITE_URL or the request origin.',
  },
  {
    envVar: 'AKBARAL_UPLOAD_DIR',
    provider: 'filesystem',
    system: 'AKBARAL!',
    purpose: 'Where customer uploads are written.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses the uploads folder under DATA_DIR.',
  },
  {
    envVar: 'AKBARAL_REALTIME_TRANSPORT',
    provider: 'realtime stream',
    system: 'AKBARAL!',
    purpose: 'Selects the execution-stream transport (SSE or WebSocket).',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses the default transport.',
  },
  {
    envVar: 'AKBARAL_ENABLE_MISSION_BOSS_BRIDGE',
    provider: 'mission bridge',
    system: 'shared',
    purpose: 'Opt-in, token-guarded read-only bridge that exposes mission status to the owner console.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'a dashboard token (below) as well',
    sandbox: 'configurable and testable here',
    breaksWithout: 'The bridge route is not mounted at all — mission data stays entirely off the public app. This is the safe default.',
  },
  {
    envVar: 'ZA141251SA_DASHBOARD_TOKEN',
    provider: 'mission bridge',
    system: 'shared',
    purpose: 'Bearer token the bridge demands before returning any mission status.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'self-issued local secret',
    credential: 'local random token',
    sandbox: 'configurable and testable here',
    breaksWithout: 'The bridge refuses every request even when enabled.',
  },
  {
    envVar: 'MISSION_DASHBOARD_TOKEN',
    provider: 'mission bridge',
    system: 'shared',
    purpose: 'Legacy name for the bridge token.',
    requirement: 'OPTIONAL',
    freeOption: 'self-issued local secret',
    credential: 'local random token',
    sandbox: 'configurable and testable here',
    breaksWithout: 'ZA141251SA_DASHBOARD_TOKEN is used.',
  },

  // ── ZA141251SA — private mission runtime ──────────────────────────────────
  {
    envVar: 'ZA141251SA_DATABASE_URL',
    provider: 'SQLite / PostgreSQL',
    system: 'ZA141251SA',
    purpose: 'Mission database — separate from the customer database by design.',
    requirement: 'OPTIONAL',
    freeOption: 'local SQLite file — no server, no account',
    credential: 'none for SQLite; DSN for PostgreSQL',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses the local mission SQLite file; it never shares the AKBARAL! database.',
  },
  {
    envVar: 'MISSION_DATABASE_URL',
    provider: 'SQLite / PostgreSQL',
    system: 'ZA141251SA',
    purpose: 'Alternate name for the mission database URL.',
    requirement: 'OPTIONAL',
    freeOption: 'local SQLite file',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'ZA141251SA_DATABASE_URL or the default file is used.',
  },
  {
    envVar: 'ZA141251SA_SESSION_SECRET',
    provider: 'mission auth',
    system: 'ZA141251SA',
    purpose: 'Signs mission owner sessions — never shared with AKBARAL! sessions.',
    requirement: 'REQUIRED',
    freeOption: 'generated locally',
    credential: 'local random 32+ byte secret',
    sandbox: 'configurable and testable here',
    breaksWithout: 'The mission server refuses to start rather than sign sessions with a weak or shared secret.',
  },
  {
    envVar: 'ZA141251SA_CREDENTIAL_KEY',
    provider: 'mission credential vault',
    system: 'ZA141251SA',
    purpose: 'Encrypts every provider key stored for an agent (including free-tier chat keys).',
    requirement: 'REQUIRED',
    freeOption: 'generated locally',
    credential: 'local random key',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Credential storage is refused — no key can be saved, so agent chat cannot be enabled.',
  },
  {
    envVar: 'ZA141251SA_OWNER_EMAIL',
    provider: 'mission auth',
    system: 'ZA141251SA',
    purpose: 'The single authorised owner identity; every other account is swept away at start.',
    requirement: 'REQUIRED',
    freeOption: null,
    credential: 'none (an email address, never a password in an env var)',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Identity lockdown cannot be enforced and the mission server refuses to run.',
  },
  {
    envVar: 'ZA141251SA_PORT',
    provider: 'mission server',
    system: 'ZA141251SA',
    purpose: 'Mission HTTP port (separate process from AKBARAL!).',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Defaults to port 4200 for the private mission server.',
  },
  {
    envVar: 'ZA141251SA_BIND_HOST',
    provider: 'mission server',
    system: 'ZA141251SA',
    purpose: 'Network interface the private mission server binds to.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses the default bind host.',
  },
  {
    envVar: 'ZA141251SA_SITE_URL',
    provider: 'mission server',
    system: 'ZA141251SA',
    purpose: 'Canonical mission URL used in owner access links.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Links are built from the request origin.',
  },
  {
    envVar: 'ZA141251SA_SESSION_TTL_HOURS',
    provider: 'mission auth',
    system: 'ZA141251SA',
    purpose: 'Owner session lifetime.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses the built-in session lifetime.',
  },
  {
    envVar: 'ZA141251SA_ACCESS_LINK_HOURS',
    provider: 'mission auth',
    system: 'ZA141251SA',
    purpose: 'Lifetime of a one-time owner access link.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses the built-in link lifetime.',
  },
  {
    envVar: 'ZA141251SA_CURRENCY',
    provider: 'mission treasury',
    system: 'ZA141251SA',
    purpose: 'Ledger currency for wallets, receipts and payouts.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'The mission ledger currency defaults to USD.',
  },
  {
    envVar: 'ZA141251SA_PAYOUT_VERIFICATION_DAYS',
    provider: 'mission treasury',
    system: 'ZA141251SA',
    purpose: 'How long a receipt must age before its money counts as verified.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses the built-in verification window.',
  },
  {
    envVar: 'ZA141251SA_STRIPE_SECRET_KEY',
    provider: 'Stripe (mission-only account)',
    system: 'ZA141251SA',
    purpose: 'Mission money provider — deliberately never falls back to the AKBARAL! Stripe key.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'no free option; Stripe is not available to Pakistan-resident accounts',
    credential: 'separate Stripe account (KYC) + secret key',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'No external money can be received or verified through Stripe. Verified revenue stays $0.00 and payouts stay unavailable.',
  },
  {
    envVar: 'ZA141251SA_STRIPE_ACCOUNT_ID',
    provider: 'Stripe (mission-only account)',
    system: 'ZA141251SA',
    purpose: 'Identifies the mission Stripe account for receipts and withdrawal methods.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'no free option',
    credential: 'Stripe account id',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Stripe withdrawal method cannot be configured.',
  },
  {
    envVar: 'ZA141251SA_CHAT_WORKER_ENABLED',
    provider: 'mission chat worker',
    system: 'ZA141251SA',
    purpose: 'Runs the queued agent-chat worker loop.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none (the agent still needs its own provider binding)',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Chat messages are recorded and queued but no reply is generated.',
  },
  {
    envVar: 'ZA141251SA_MONEY_WORKER_ENABLED',
    provider: 'mission money worker',
    system: 'ZA141251SA',
    purpose: 'Runs receipt verification and payout progression.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Receipts stay pending until the worker is run manually.',
  },
  {
    envVar: 'FACEBOOK_CLIENT_ID',
    provider: 'Facebook OAuth',
    system: 'AKBARAL!',
    purpose: 'Sign in with Facebook.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free Meta app',
    credential: 'Meta app id + secret, app review for public login',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Facebook button renders disabled with the reason shown.',
  },
  {
    envVar: 'FACEBOOK_CLIENT_SECRET',
    provider: 'Facebook OAuth',
    system: 'AKBARAL!',
    purpose: 'Sign in with Facebook (token exchange).',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free Meta app',
    credential: 'Meta app secret',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Facebook button stays disabled.',
  },

  // ── AKBARAL! — search backends (one of these, or the keyless default) ────
  {
    envVar: 'TAVILY_API_KEY',
    provider: 'Tavily search',
    system: 'AKBARAL!',
    purpose: 'Search backend for the agent web_search tool.',
    requirement: 'OPTIONAL',
    freeOption: 'Tavily has a free monthly credit tier (account required)',
    credential: 'Tavily account + API key',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Search falls through to the next configured provider, else the keyless DuckDuckGo default.',
  },
  {
    envVar: 'BRAVE_SEARCH_API_KEY',
    provider: 'Brave Search API',
    system: 'AKBARAL!',
    purpose: 'Search backend for the agent web_search tool.',
    requirement: 'OPTIONAL',
    freeOption: 'Brave offers a free query tier (card required on signup for some plans)',
    credential: 'Brave Search account + subscription token',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Search falls through to the next provider or the keyless default.',
  },
  {
    envVar: 'SERPER_API_KEY',
    provider: 'Serper.dev',
    system: 'AKBARAL!',
    purpose: 'Search backend for the agent web_search tool.',
    requirement: 'OPTIONAL',
    freeOption: 'Serper grants free starter credits (account required)',
    credential: 'Serper account + API key',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Search falls through to the next provider or the keyless default.',
  },
  {
    envVar: 'GOOGLE_CSE_API_KEY',
    provider: 'Google Programmable Search',
    system: 'AKBARAL!',
    purpose: 'Search backend for the agent web_search tool.',
    requirement: 'OPTIONAL',
    freeOption: '100 free queries/day, then paid',
    credential: 'Google Cloud API key',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Search falls through to the next provider or the keyless default.',
  },
  {
    envVar: 'GOOGLE_CSE_ID',
    provider: 'Google Programmable Search',
    system: 'AKBARAL!',
    purpose: 'Search engine id paired with the CSE key.',
    requirement: 'OPTIONAL',
    freeOption: 'free to create',
    credential: 'Programmable Search engine id',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'The Google CSE backend stays unavailable even if the key is set.',
  },
  {
    envVar: 'ANTHROPIC_API_KEY',
    provider: 'Anthropic',
    system: 'AKBARAL!',
    purpose: 'Claude model calls from the customer model catalog.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: null,
    credential: 'Anthropic account + API key (prepaid credit)',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'Anthropic models are listed as unavailable and calls return provider_not_configured.',
  },
  {
    envVar: 'GEMINI_API_KEY',
    provider: 'Google AI Studio (Gemini)',
    system: 'AKBARAL!',
    purpose: 'Accepted alias for GOOGLE_API_KEY in the launch checks.',
    requirement: 'OPTIONAL',
    freeOption: 'Google AI Studio free tier',
    credential: 'Google AI Studio API key',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'GOOGLE_API_KEY is used; if neither is set, MASTER AI and every model-backed agent return provider_not_configured.',
  },
  {
    envVar: 'AKBARAL_BACKUP_DIR',
    provider: 'filesystem',
    system: 'AKBARAL!',
    purpose: 'Backup directory checked by the launch readiness checks.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'The check inspects data/backups.',
  },

  // ── deployment / operations (no external provider) ───────────────────────
  {
    envVar: 'AKBARAL_ROLES',
    provider: 'process supervisor',
    system: 'AKBARAL!',
    purpose: 'Which tiers this container runs: both, web or api.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Runs both tiers in one container.',
  },
  {
    envVar: 'AKBARAL_WEB_PORT',
    provider: 'process supervisor',
    system: 'AKBARAL!',
    purpose: 'Public web port when it must differ from PORT.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses PORT, else 3000.',
  },
  {
    envVar: 'AKBARAL_API_PORT',
    provider: 'process supervisor',
    system: 'AKBARAL!',
    purpose: 'Internal API port the public tier proxies to.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Uses 4000, moving itself if that collides with the public port.',
  },
  {
    envVar: 'AKBARAL_AUTO_BUILD',
    provider: 'process supervisor',
    system: 'AKBARAL!',
    purpose: 'Rebuilds the bundle at container start when the build output is missing.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'A missing build output is reported and the process exits instead of self-healing.',
  },
  {
    envVar: 'SEED_DATABASE',
    provider: 'process supervisor',
    system: 'AKBARAL!',
    purpose: 'Seeds the agent registry and plans on first start.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'No seeding step runs; existing data is left untouched.',
  },
  {
    envVar: 'BACKUP_DIR',
    provider: 'filesystem',
    system: 'AKBARAL!',
    purpose: 'Destination of the scheduled database backup.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Backups are written to /data/backups.',
  },
  {
    envVar: 'BACKUP_KEEP',
    provider: 'filesystem',
    system: 'AKBARAL!',
    purpose: 'How many backup files to retain.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Keeps the last 30 backup files by default.',
  },
  {
    envVar: 'DISABLE_BACKUP_CRON',
    provider: 'filesystem',
    system: 'AKBARAL!',
    purpose: 'Turns the in-container backup schedule off.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'Backups run on their schedule (the safe default).',
  },
  {
    envVar: 'ZA141251SA_OWNER_PASSWORD',
    provider: 'mission auth (setup only)',
    system: 'ZA141251SA',
    purpose: 'One-shot input to the owner password setup script; stored only as a hash and never read at runtime.',
    requirement: 'OPTIONAL',
    freeOption: null,
    credential: 'the configured owner password, supplied once',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The setup script asks for the password instead; the running server never reads this variable.',
  },
  {
    envVar: 'YOUTUBE_CLIENT_ID',
    provider: 'Google (YouTube Data API v3)',
    system: 'shared',
    purpose: 'OAuth client id used to obtain a YouTube publishing token.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free Google Cloud project; YouTube Data API quota is free',
    credential: 'OAuth client (consent screen + verified app for public use)',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The YouTube connect button reports the platform as unavailable; nothing can be published.',
  },
  {
    envVar: 'YOUTUBE_CLIENT_SECRET',
    provider: 'Google (YouTube Data API v3)',
    system: 'shared',
    purpose: 'OAuth client secret paired with YOUTUBE_CLIENT_ID.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free',
    credential: 'OAuth client secret',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The authorization code cannot be exchanged, so no YouTube connection is ever created.',
  },
  {
    envVar: 'GOOGLE_OAUTH_CLIENT_ID',
    provider: 'Google OAuth',
    system: 'shared',
    purpose: 'Alternative name accepted for the Google/YouTube OAuth client id.',
    requirement: 'OPTIONAL',
    freeOption: 'free',
    credential: 'OAuth client',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'Only matters when YOUTUBE_CLIENT_ID is not set; the platform stays unavailable.',
  },
  {
    envVar: 'GOOGLE_OAUTH_CLIENT_SECRET',
    provider: 'Google OAuth',
    system: 'shared',
    purpose: 'Alternative name accepted for the Google/YouTube OAuth client secret.',
    requirement: 'OPTIONAL',
    freeOption: 'free',
    credential: 'OAuth client secret',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'Only matters when YOUTUBE_CLIENT_SECRET is not set.',
  },
  {
    envVar: 'INSTAGRAM_CLIENT_ID',
    provider: 'Meta (Instagram Graph API)',
    system: 'shared',
    purpose: 'OAuth client id for Instagram publishing.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free developer app; Graph API calls are free',
    credential: 'Meta app + business verification + app review for publishing scopes',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'Instagram is reported unavailable; the connect button is disabled rather than dead.',
  },
  {
    envVar: 'INSTAGRAM_CLIENT_SECRET',
    provider: 'Meta (Instagram Graph API)',
    system: 'shared',
    purpose: 'OAuth client secret for Instagram publishing.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free',
    credential: 'Meta app secret',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'No Instagram token can be exchanged or refreshed.',
  },
  {
    envVar: 'META_APP_ID',
    provider: 'Meta (Instagram Graph API)',
    system: 'shared',
    purpose: 'Alternative name accepted for the Instagram/Meta app id.',
    requirement: 'OPTIONAL',
    freeOption: 'free',
    credential: 'Meta app',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'Only matters when INSTAGRAM_CLIENT_ID is not set.',
  },
  {
    envVar: 'META_APP_SECRET',
    provider: 'Meta (Instagram Graph API)',
    system: 'shared',
    purpose: 'Alternative name accepted for the Instagram/Meta app secret.',
    requirement: 'OPTIONAL',
    freeOption: 'free',
    credential: 'Meta app secret',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'Only matters when INSTAGRAM_CLIENT_SECRET is not set.',
  },
  {
    envVar: 'TIKTOK_CLIENT_KEY',
    provider: 'TikTok for Developers',
    system: 'shared',
    purpose: 'Client key for the TikTok content posting OAuth flow.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free developer account',
    credential: 'TikTok app with approved scopes',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'TikTok is reported unavailable and no authorization URL is produced.',
  },
  {
    envVar: 'TIKTOK_CLIENT_SECRET',
    provider: 'TikTok for Developers',
    system: 'shared',
    purpose: 'Client secret paired with TIKTOK_CLIENT_KEY.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free',
    credential: 'TikTok app secret',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The TikTok token exchange and refresh both refuse to run.',
  },
  {
    envVar: 'ZA141251SA_AWIN_ENABLED',
    provider: 'Awin affiliate network',
    system: 'ZA141251SA',
    purpose: 'Feature switch for the Awin earning connector.',
    requirement: 'OPTIONAL',
    freeOption: 'free publisher account (subject to approval)',
    credential: 'none (switch only)',
    sandbox: 'configurable and testable here',
    breaksWithout: 'The Awin connector stays off, which is the default.',
  },
  {
    envVar: 'ZA141251SA_AWIN_PUBLISHER_ID',
    provider: 'Awin affiliate network',
    system: 'ZA141251SA',
    purpose: 'Publisher id used on every Awin API call.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free publisher account after approval',
    credential: 'approved Awin publisher account in the owner account name',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'Awin calls fail closed with awin_credentials_required; no commission can be read or recorded.',
  },
  {
    envVar: 'ZA141251SA_AWIN_ACCESS_TOKEN',
    provider: 'Awin affiliate network',
    system: 'ZA141251SA',
    purpose: 'OAuth2 token for the Awin publisher API.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free with an approved account',
    credential: 'Awin API token',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Awin connector refuses to run rather than estimating commission; no earning is recorded.',
  },
  {
    envVar: 'ZA141251SA_FREELANCER_ENABLED',
    provider: 'Freelancer.com API',
    system: 'ZA141251SA',
    purpose: 'Feature switch for the Freelancer earning connector.',
    requirement: 'OPTIONAL',
    freeOption: 'free account',
    credential: 'none (switch only)',
    sandbox: 'configurable and testable here',
    breaksWithout: 'The Freelancer connector stays off, which is the default.',
  },
  {
    envVar: 'ZA141251SA_FREELANCER_USER_ID',
    provider: 'Freelancer.com API',
    system: 'ZA141251SA',
    purpose: 'Numeric user id whose bids and milestones are read.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free account',
    credential: 'the owner Freelancer account',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The connector denies with credentials_required; no bid or settlement is ever submitted.',
  },
  {
    envVar: 'ZA141251SA_FREELANCER_ACCESS_TOKEN',
    provider: 'Freelancer.com API',
    system: 'ZA141251SA',
    purpose: 'OAuth token for the Freelancer API.',
    requirement: 'CREDENTIAL REQUIRED',
    freeOption: 'free with an account',
    credential: 'Freelancer OAuth token',
    sandbox: 'owner action required (external account, KYC or OAuth consent)',
    breaksWithout: 'The Freelancer connector denies with credentials_required: no bid, milestone read or settlement is attempted.',
  },
  {
    envVar: 'PGSSLMODE',
    provider: 'PostgreSQL / Neon',
    system: 'shared',
    purpose: 'TLS mode passed to the Postgres bridge (for example require).',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'The driver uses the mode encoded in the connection URL; managed providers normally require sslmode=require in the URL itself.',
  },
  {
    envVar: 'AKBARAL_LAUNCH_MODE',
    provider: 'AKBARAL! launch policy',
    system: 'AKBARAL!',
    purpose: 'Set to "free" to launch on free infrastructure only: paid customer billing is deferred (reported as deferred, never as ready) instead of blocking the launch gate.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'The launch gate treats a missing payment provider as a blocker, which is correct for a commercial launch but wrong for the $0 free-first launch.',
  },
  {
    envVar: 'SPACE_HOST',
    provider: 'Hugging Face Spaces',
    system: 'AKBARAL!',
    purpose: 'Injected by the host: the free public HTTPS hostname, used as the production site URL so no domain has to be bought.',
    requirement: 'OPTIONAL',
    freeOption: 'injected by the free host',
    credential: 'none',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'The public URL falls back to AKBARAL_SITE_URL or the built-in default host.',
  },
  {
    envVar: 'SPACE_ID',
    provider: 'Hugging Face Spaces',
    system: 'AKBARAL!',
    purpose: 'Injected by the host ("owner/space"); the public hostname is derived from it when SPACE_HOST is absent.',
    requirement: 'OPTIONAL',
    freeOption: 'injected by the free host',
    credential: 'none',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Detection falls back to the other platform variables.',
  },
  {
    envVar: 'RENDER_EXTERNAL_URL',
    provider: 'Render',
    system: 'AKBARAL!',
    purpose: 'Injected by the host: the free public HTTPS URL of the service.',
    requirement: 'OPTIONAL',
    freeOption: 'injected by the free host',
    credential: 'none',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'The public URL falls back to AKBARAL_SITE_URL or the built-in default host.',
  },
  {
    envVar: 'RENDER_EXTERNAL_HOSTNAME',
    provider: 'Render',
    system: 'AKBARAL!',
    purpose: 'Injected by the host: the free public hostname, used when RENDER_EXTERNAL_URL is absent.',
    requirement: 'OPTIONAL',
    freeOption: 'injected by the free host',
    credential: 'none',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Detection falls back to the other platform variables.',
  },
  {
    envVar: 'KOYEB_PUBLIC_DOMAIN',
    provider: 'Koyeb',
    system: 'AKBARAL!',
    purpose: 'Injected by the host: the public hostname of the service (Koyeb now requires a card, so this is detection only, not a recommendation).',
    requirement: 'OPTIONAL',
    freeOption: 'injected by the host',
    credential: 'none',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Detection falls back to the other platform variables.',
  },
  {
    envVar: 'FLY_APP_NAME',
    provider: 'Fly.io',
    system: 'AKBARAL!',
    purpose: 'Injected by the host: the app name, from which the public *.fly.dev hostname is derived.',
    requirement: 'OPTIONAL',
    freeOption: 'injected by the host',
    credential: 'none',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Detection falls back to the other platform variables.',
  },
  {
    envVar: 'RAILWAY_PUBLIC_DOMAIN',
    provider: 'Railway',
    system: 'AKBARAL!',
    purpose: 'Injected by the host: the public hostname of the service.',
    requirement: 'OPTIONAL',
    freeOption: 'injected by the host',
    credential: 'none',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Detection falls back to the other platform variables.',
  },
  {
    envVar: 'VERCEL_URL',
    provider: 'Vercel',
    system: 'AKBARAL!',
    purpose: 'Injected by the host: the deployment hostname.',
    requirement: 'OPTIONAL',
    freeOption: 'injected by the host',
    credential: 'none',
    sandbox: 'configurable here, not testable (no outbound network)',
    breaksWithout: 'Detection falls back to the other platform variables.',
  },
  {
    envVar: 'PUBLIC_URL',
    provider: 'generic host',
    system: 'AKBARAL!',
    purpose: 'Generic escape hatch: an absolute public URL supplied by any other host, used when no platform-specific variable is present.',
    requirement: 'OPTIONAL',
    freeOption: 'built in',
    credential: 'none',
    sandbox: 'configurable and testable here',
    breaksWithout: 'The public URL falls back to AKBARAL_SITE_URL or the built-in default host.',
  },
];

export interface EnvUsage {
  envVar: string;
  files: string[];
}

// Only the shipped runtime counts as a dependency: src/ plus the scripts that
// actually run the two systems. Test harnesses, probes and audit tooling
// configure the system under test — they are not provider dependencies.
const SCAN_ROOTS = ['src'];
const RUNTIME_SCRIPTS = [
  'scripts/mission-serve.ts',
  'scripts/mission-chat-worker.ts',
  'scripts/mission-money-worker.ts',
  'scripts/mission-init.ts',
  'scripts/mission-set-owner-password.ts',
  'scripts/start-dev.mjs',
  'scripts/start-prod.mjs',
  'scripts/lib/session-secret.mjs',
];
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'logs', 'data', '.git', '.next', 'coverage', 'testing', 'test-support']);
const ENV_PATTERN = /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[['"`]([A-Z][A-Z0-9_]*)['"`]\]|\benv\.([A-Z][A-Z0-9_]{2,})\b/g;
// Some variables are never named at a process.env site: the OAuth and
// integration registries declare the name as data and read it through a
// helper. Those declarations are real usage and must appear in the matrix.
const DECLARED_ENV_PATTERN = /(?:clientIdEnv|clientSecretEnv|envKey)\s*:\s*['"`]([A-Z][A-Z0-9_]*)['"`]|(?:requiredEnv|envKeys|clientIdKeys|clientSecretKeys|requiredCredentialEnvKeys)\s*:\s*\[([^\]]*)\]/g;
const LITERAL_NAME_PATTERN = /['"`]([A-Z][A-Z0-9_]{2,})['"`]/g;

function walk(directory: string, results: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      walk(full, results);
    } else if (/\.(ts|mjs|js)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) && entry.name !== 'dependency-matrix.ts') {
      results.push(full);
    }
  }
}

/**
 * Every environment variable the shipped runtime actually reads, with the files
 * that read it. Tests, fixtures and the browser/probe tooling are excluded:
 * they configure the system under test rather than depend on a provider.
 */
export function scanEnvUsage(root: string): EnvUsage[] {
  const files: string[] = [];
  for (const directory of SCAN_ROOTS) walk(path.join(root, directory), files);
  for (const script of RUNTIME_SCRIPTS) {
    const full = path.join(root, script);
    if (fs.existsSync(full)) files.push(full);
  }
  const usage = new Map<string, Set<string>>();
  for (const file of files.sort()) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(root, file);
    const add = (name: string | undefined): void => {
      if (!name) return;
      const entry = usage.get(name) ?? new Set<string>();
      entry.add(relative);
      usage.set(name, entry);
    };
    for (const match of source.matchAll(ENV_PATTERN)) add(match[1] ?? match[2] ?? match[3]);
    for (const match of source.matchAll(DECLARED_ENV_PATTERN)) {
      if (match[1]) { add(match[1]); continue; }
      const list = match[2] ?? '';
      for (const literal of list.matchAll(LITERAL_NAME_PATTERN)) add(literal[1]);
    }
  }
  return [...usage.entries()]
    .map(([envVar, set]) => ({ envVar, files: [...set].sort() }))
    .sort((a, b) => a.envVar.localeCompare(b.envVar));
}

export interface MatrixEntry extends DependencyRow {
  usedBy: string[];
  /** Name-only configuration state; values are never read. */
  configured: boolean;
}

/**
 * The matrix as data: the declared row joined to the real call sites and the
 * current (name-only) configuration state.
 */
export function dependencyMatrix(root: string, environment: Record<string, string | undefined> = process.env): MatrixEntry[] {
  const usage = new Map(scanEnvUsage(root).map((entry) => [entry.envVar, entry.files]));
  return DEPENDENCY_ROWS.map((row) => ({
    ...row,
    usedBy: usage.get(row.envVar) ?? [],
    configured: String(environment[row.envVar] ?? '').trim().length > 0,
  }));
}

/** Variables read by the runtime that no matrix row documents. */
export function undocumentedEnvVars(root: string): string[] {
  const documented = new Set(DEPENDENCY_ROWS.map((row) => row.envVar));
  return scanEnvUsage(root)
    .map((entry) => entry.envVar)
    .filter((name) => !documented.has(name))
    .sort();
}

/** Matrix rows whose variable is no longer read anywhere in the runtime. */
export function staleMatrixRows(root: string): string[] {
  const used = new Set(scanEnvUsage(root).map((entry) => entry.envVar));
  return DEPENDENCY_ROWS.filter((row) => !used.has(row.envVar))
    .map((row) => row.envVar)
    .sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Earning-platform credentials (derived, never hand-copied)
//
// The mission already keeps one registry of the external platforms it may work
// with, including each one's credential variable, ToS automation rule and
// country eligibility. Restating those here by hand would create a second
// truth that drifts, so this section is generated from that registry.
// ─────────────────────────────────────────────────────────────────────────────

export interface EarningPlatformDependency {
  platform: string;
  category: string;
  envVar: string | null;
  apiAvailable: boolean;
  /** 0 = manual only, 1 = automation allowed via public API, 2 = conditional. */
  automationAllowed: number;
  automationNotes: string;
  accountRules: string;
  countryEligibility: string[];
  payoutMethods: string[];
  docsUrl: string | null;
  tosUrl: string | null;
}

/**
 * When a registry entry does not state its own condition, the level's own
 * definition is used verbatim. No platform-specific permission is invented.
 */
function automationDefinition(level: number): string {
  if (level === 1) return 'Automation permitted through the platform’s public API (registry level 1 definition; no platform-specific note recorded).';
  if (level === 2) return 'Official API only — account and API approval required; scraping and any ToS bypass are not permitted (registry level 2 definition; no platform-specific note recorded).';
  return 'Manual, owner-performed work only — no automated account action (registry level 0 definition; no platform-specific note recorded).';
}

export function earningPlatformDependencies(
  sources: Array<Record<string, unknown>>,
): EarningPlatformDependency[] {
  return sources
    .map((source) => ({
      platform: String(source.name ?? source.key ?? ''),
      category: String(source.category ?? ''),
      envVar: source.requires_api_key ? String(source.api_key_env_var ?? '') || null : null,
      apiAvailable: Boolean(source.api_available),
      automationAllowed: Number(source.automation_allowed ?? 0),
      automationNotes: String(source.automation_notes ?? '').trim() || automationDefinition(Number(source.automation_allowed ?? 0)),
      accountRules: String(source.account_rules ?? ''),
      countryEligibility: Array.isArray(source.country_eligibility) ? source.country_eligibility.map(String) : [],
      payoutMethods: Array.isArray(source.payout_methods) ? source.payout_methods.map(String) : [],
      docsUrl: source.docs_url ? String(source.docs_url) : null,
      tosUrl: source.tos_url ? String(source.tos_url) : null,
    }))
    .sort((a, b) => a.platform.localeCompare(b.platform));
}
