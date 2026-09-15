# AKBARAL! launch verification report

Generated: 2026-09-15T11:44:54.431Z · environment: `development`

**Readiness (required checks): 11.1%** — 2 of 13 checks ready, 8 blocker(s).

| Check | Area | Required | Status | Evidence |
| --- | --- | --- | --- | --- |
| Session signing secret is production-grade | Secrets | yes | not configured | SESSION_SECRET is not set |
| Public site URL is configured for the production hostname | Domain | yes | not configured | AKBARAL_SITE_URL is not set; robots/sitemap and payment redirects fall back to the built-in default host |
| Application database is reachable and migrated | Database | yes | FAILED | DATABASE_URL is not set |
| Agent registry is seeded (4,001 specialists) | Registry | yes | not configured | DATABASE_URL is not set; registry state unknown |
| Gemini key is present and accepted by Google | Model provider | yes | not configured | neither GOOGLE_API_KEY nor GEMINI_API_KEY is set — MASTER AI and every model-backed agent return provider_not_configured |
| A production search provider is configured and answering | Search provider | yes | not configured | no search credential is set — web research falls back to the keyless provider, which is typically blocked from datacenter IPs |
| Payment provider key works and webhook signing is configured | Payments | yes | not configured | no payment provider credential is set — credit purchases return provider_not_configured and only manual admin settlement can mark an invoice paid |
| Checkout return URLs point at the real domain | Payments | yes | not configured | no AKBARAL_SITE_URL: completed payments would redirect to a local placeholder URL instead of the live site |
| Transactional email is configured (password reset, verification) | Email | no | optional / absent | SMTP_HOST is not set — password reset and email verification are unavailable (honest 503) |
| Upload directory is writable and persistent | Storage | yes | ready | data/uploads exists and is writable |
| Backup automation is not disabled and a backup directory is writable | Operations | no | ready | backup directory data/backups writable; automatic backups enabled |
| Private mission app: database, chains and payout destinations | Mission system | no | optional / absent | mission system is not configured on this deployment (it is a separate private application) |
| Publishing platform OAuth apps are registered (optional) | Social publishing | no | optional / absent | 0 configured; 3 pending (YouTube (video publishing), Instagram (Reels/posts via Graph API), TikTok (content posting API)) — publishing agents return provider_not_configured until then; no engagement is ever synthesized |

## Blockers

- **Session signing secret is production-grade** (`secret.session`) — not configured
  - SESSION_SECRET is not set
  - Owner action: Set SESSION_SECRET in the deployment secret store to 32+ random characters (`openssl rand -base64 48`).

- **Public site URL is configured for the production hostname** (`domain.public_url`) — not configured
  - AKBARAL_SITE_URL is not set; robots/sitemap and payment redirects fall back to the built-in default host
  - Owner action: Point the domain at the deployment, terminate TLS, then set AKBARAL_SITE_URL=https://your-domain (used by robots.txt, sitemap.xml and payment return URLs).

- **Application database is reachable and migrated** (`database.connection`) — FAILED
  - DATABASE_URL is not set
  - Owner action: Provision PostgreSQL (e.g. Neon), set DATABASE_URL, then run `npm run db:migrate && npm run db:seed`.

- **Agent registry is seeded (4,001 specialists)** (`registry.agents`) — not configured
  - DATABASE_URL is not set; registry state unknown
  - Owner action: Run `npm run db:seed` (and `npm run audit:registry`) against the production database.

- **Gemini key is present and accepted by Google** (`provider.gemini`) — not configured
  - neither GOOGLE_API_KEY nor GEMINI_API_KEY is set — MASTER AI and every model-backed agent return provider_not_configured
  - Owner action: Create a Gemini API key in Google AI Studio and set GOOGLE_API_KEY in the deployment secret store (GEMINI_API_KEY is accepted as an alias).

- **A production search provider is configured and answering** (`provider.search`) — not configured
  - no search credential is set — web research falls back to the keyless provider, which is typically blocked from datacenter IPs
  - Owner action: Pick one search provider and set its key: TAVILY_API_KEY (recommended), BRAVE_SEARCH_API_KEY, or SERPER_API_KEY (+ GOOGLE_CSE_API_KEY & GOOGLE_CSE_ID for Google CSE). Without a key the platform falls back to keyless scraping, which datacenter IPs usually block.

- **Payment provider key works and webhook signing is configured** (`provider.payments`) — not configured
  - no payment provider credential is set — credit purchases return provider_not_configured and only manual admin settlement can mark an invoice paid
  - Owner action: In the Stripe dashboard: create the account, copy the secret key into STRIPE_SECRET_KEY, add a webhook endpoint pointing at https://<your-domain>/api/billing/webhook/stripe subscribed to checkout.session.completed, payment_intent.succeeded, invoice.paid, invoice.payment_failed and charge.refunded, then put its signing secret in STRIPE_WEBHOOK_SECRET.

- **Checkout return URLs point at the real domain** (`provider.payments.return_urls`) — not configured
  - no AKBARAL_SITE_URL: completed payments would redirect to a local placeholder URL instead of the live site
  - Owner action: Set AKBARAL_SITE_URL (or explicit AKBARAL_CHECKOUT_SUCCESS_URL / AKBARAL_CHECKOUT_CANCEL_URL) so Stripe redirects customers back to your domain, not a placeholder.

## Owner actions

1. Set SESSION_SECRET in the deployment secret store to 32+ random characters (`openssl rand -base64 48`).
2. Point the domain at the deployment, terminate TLS, then set AKBARAL_SITE_URL=https://your-domain (used by robots.txt, sitemap.xml and payment return URLs).
3. Provision PostgreSQL (e.g. Neon), set DATABASE_URL, then run `npm run db:migrate && npm run db:seed`.
4. Run `npm run db:seed` (and `npm run audit:registry`) against the production database.
5. Create a Gemini API key in Google AI Studio and set GOOGLE_API_KEY in the deployment secret store (GEMINI_API_KEY is accepted as an alias).
6. Pick one search provider and set its key: TAVILY_API_KEY (recommended), BRAVE_SEARCH_API_KEY, or SERPER_API_KEY (+ GOOGLE_CSE_API_KEY & GOOGLE_CSE_ID for Google CSE). Without a key the platform falls back to keyless scraping, which datacenter IPs usually block.
7. In the Stripe dashboard: create the account, copy the secret key into STRIPE_SECRET_KEY, add a webhook endpoint pointing at https://<your-domain>/api/billing/webhook/stripe subscribed to checkout.session.completed, payment_intent.succeeded, invoice.paid, invoice.payment_failed and charge.refunded, then put its signing secret in STRIPE_WEBHOOK_SECRET.
8. Set AKBARAL_SITE_URL (or explicit AKBARAL_CHECKOUT_SUCCESS_URL / AKBARAL_CHECKOUT_CANCEL_URL) so Stripe redirects customers back to your domain, not a placeholder.
9. Create a transactional email account (or SMTP relay), then set SMTP_HOST/SMTP_USER/SMTP_PASSWORD/SMTP_FROM. Until then password reset and email verification return 503 provider_not_configured rather than pretending to send.
10. Set the ZA141251SA_* variables (database URL, session secret, credential key, owner email/password) and run `npm run mission:init`, then verify a payout destination in the mission dashboard.
11. YouTube (video publishing): register an app, add redirect URI https://your-domain/api/social/oauth/youtube/callback, then set YOUTUBE_CLIENT_ID / GOOGLE_OAUTH_CLIENT_ID / YOUTUBE_CLIENT_SECRET / GOOGLE_OAUTH_CLIENT_SECRET. Instagram (Reels/posts via Graph API): register an app, add redirect URI https://your-domain/api/social/oauth/instagram/callback, then set INSTAGRAM_CLIENT_ID / META_APP_ID / INSTAGRAM_CLIENT_SECRET / META_APP_SECRET. TikTok (content posting API): register an app, add redirect URI https://your-domain/api/social/oauth/tiktok/callback, then set TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET.
