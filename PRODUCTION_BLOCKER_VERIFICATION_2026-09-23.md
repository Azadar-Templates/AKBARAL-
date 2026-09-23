# Production Blocker Verification — 2026-09-23

**Branch:** `arena/01a0ce24-akbaral` @ `5d3b03b3`
**Method:** Read-only source-code audit of every execution path, credential check, error handler and fallback.

---

## Blocker 1: AI Model Provider

### Current Status: ❌ NOT CONFIGURED

No model provider credential is set. Every AI execution path correctly returns `provider_not_configured` with the exact missing variable name.

### Provider Architecture

The platform supports **4 providers** in a fallback chain, scored by capability/cost/latency:

| Provider | Env Variable | Base URL | Type |
|----------|-------------|----------|------|
| **OmniRoute Gateway** | `OMNIROUTE_API_KEY` | `http://127.0.0.1:20128/v1` | Private sidecar (OpenAI-compatible) |
| **Google Gemini** | `GOOGLE_API_KEY` | `https://generativelanguage.googleapis.com/v1beta` | Direct API |
| **OpenAI** | `OPENAI_API_KEY` | `https://api.openai.com/v1` | Direct API |
| **Anthropic** | `ANTHROPIC_API_KEY` | `https://api.anthropic.com` | Direct API |

### Models in Catalog

| Model | Provider | Context | Cost/M tokens | Default |
|-------|----------|---------|---------------|---------|
| gemini-3.8-flash | google | 1M tokens | $0.75 in / $3.75 out | ✅ Yes |
| gemini-3.5-flash | google | 1M tokens | $1.50 in / $9.00 out | No |
| gemini-3.1-flash-lite | google | 1M tokens | $0.25 in / $1.50 out | No |
| gpt-4o | openai | 128K tokens | $2.50 in / $10.00 out | No |
| claude-sonnet-4-20250514 | anthropic | 200K tokens | $3.00 in / $15.00 out | No |

Plus OmniRoute-aggregated free models (Qwen3 Coder Plus, Llama 4 Scout, Kimi K2) when gateway is enabled.

### Execution Flow (Verified in Code)

1. **Goal Analysis** (`src/orchestrator/goal-analyzer.ts`):
   - Attempts LLM call via `routerComplete()` (model router)
   - If provider throws `ProviderNotConfiguredError` → falls back to **heuristic** (deterministic keyword analysis)
   - Heuristic mode always disclosed: `mode: 'heuristic'` in response + note: "Analysis produced by the deterministic rule engine"
   - **Result:** Goal analysis works without any provider. Tasks can be planned.

2. **Task Execution** (`src/orchestrator/queue.ts` → `executor.ts`):
   - Agent tool execution calls `modelRouter.complete()` which iterates the fallback chain
   - If ALL providers unconfigured → throws aggregated error: `"AI providers are not configured; set at least one of GOOGLE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY"`
   - Error code: `provider_not_configured`
   - Task is marked failed, credit refunded (exactly once)
   - **Result:** Tasks plan but cannot execute AI work without at least one provider.

3. **Streaming** (`src/models/client.ts`):
   - Each provider implements `streamChat()` for SSE streaming
   - Same fallback chain applies
   - Google provider handles retired models (gemini-2.0-flash removed, replaced by gemini-3.x)

### Free / No-Card Options

| Option | Cost | Card Required? | Setup |
|--------|------|---------------|-------|
| **Google Gemini API** | Free tier (RPM-limited) | **NO** | Get key at https://aistudio.google.com/apikey |
| OmniRoute Gateway | Free (self-hosted) | No | Requires local sidecar installation |
| OpenAI | Paid | Yes | Requires billing setup |
| Anthropic | Paid | Yes | Requires billing setup |

**Recommended: `GOOGLE_API_KEY`** — explicitly documented in `.env.example` as "free tier, no card". Google AI Studio provides free API keys at https://aistudio.google.com/apikey with no credit card.

### Exact Missing Variables

```
# Minimum (one required):
GOOGLE_API_KEY=           # Free tier, no card — RECOMMENDED
OPENAI_API_KEY=           # Paid
ANTHROPIC_API_KEY=        # Paid

# Optional gateway:
OMNIROUTE_API_KEY=        # Self-hosted sidecar
OMNIROUTE_ENABLED=0       # Set to 1 to prefer gateway
```

### Security Assessment

- ✅ Private bind enforced: OmniRoute must be `127.0.0.1:20128` unless `AKBARAL_ALLOW_PRIVATE_PROVIDER=1`
- ✅ API keys never returned in API responses or error messages
- ✅ Credential status reported as boolean only (configured/not-configured), never values
- ✅ Provider call errors never leak request/response bodies to client
- ✅ `ProviderCallError.retryable` prevents burning retry budget on permanent failures (4xx)
- ✅ SSRF protection on all external HTTP requests
- ✅ Provider timeouts enforced (default 60s, configurable, minimum 1s)

### User Action Required

1. Go to https://aistudio.google.com/apikey
2. Generate a free API key (Google account required, no card)
3. Set environment variable: `GOOGLE_API_KEY=AIza...`
4. Restart the server

---

## Blocker 2: Stripe (Payment Provider)

### Current Status: ❌ NOT CONFIGURED

Neither Stripe nor Razorpay is configured. Paid plan upgrades return honest 402 "payment_required".

### Stripe Architecture

#### Required Variables

| Variable | Purpose | Format |
|----------|---------|--------|
| `STRIPE_SECRET_KEY` | API authentication for Checkout Sessions | `sk_test_...` (test) or `sk_live_...` (production) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification | `whsec_...` |

#### Additional Variable

| Variable | Purpose |
|----------|---------|
| `BILLING_WEBHOOK_SECRET` | Generic billing webhook signature (alternative to Stripe-specific) |

### Payment Flow (Verified in Code)

1. **Plan Checkout** (`src/billing/service.ts` → `startPlanCheckout()`):
   ```
   POST /api/billing/switch { plan_key: "pro" }
   → plan.price_cents > 0?
     → stripeConfigured() == false?
       → Returns 402: { error: { code: "payment_required", requiredCredential: "STRIPE_SECRET_KEY" } }
     → stripeConfigured() == true?
       → createStripeCheckout() → Stripe API → checkout URL
       → Returns 201: { checkout_url, provider_reference }
   ```

2. **Credit Purchase** (`src/billing/providers.ts`):
   - `createStripeCheckout()` calls `POST https://api.stripe.com/v1/checkout/sessions`
   - Uses `STRIPE_SECRET_KEY` as Bearer token
   - Creates Checkout Session with `client_reference_id` = invoice number
   - Returns session URL for redirect
   - Timeout: 20 seconds (hardcoded, via `externalHttpRequest`)

3. **Webhook Processing** (`src/billing/stripe.ts` + `src/routes/billing.ts`):
   ```
   POST /api/billing/webhook/stripe
   → Parse Stripe-Signature header (timestamp + v1 signatures)
   → Verify HMAC-SHA256 over "${timestamp}.${rawBody}" using STRIPE_WEBHOOK_SECRET
   → Check timestamp within 5-minute tolerance (replay protection)
   → Constant-time comparison (timingSafeEqualHex)
   → Normalize event → internal billing event
   → Record payment/invoice/refund
   ```

4. **Supported Webhook Events:**
   - `checkout.session.completed` → invoice.paid
   - `payment_intent.succeeded` → invoice.paid
   - `payment_intent.payment_failed` → payment.failed
   - `invoice.paid` / `invoice.payment_succeeded` → invoice.paid
   - `invoice.payment_failed` → payment.failed
   - `charge.refunded` / `refund.created` → invoice.refunded
   - `customer.subscription.deleted` / `customer.subscription.canceled` → subscription.cancelled
   - Unknown events → acknowledged (200) but recorded as "ignored" (no effect)

### Razorpay Alternative

| Variable | Purpose |
|----------|---------|
| `RAZORPAY_KEY_ID` | API key ID |
| `RAZORPAY_KEY_SECRET` | API key secret |

Razorpay is fully implemented as an alternative payment provider. Same checkout flow, different API.

### Test Mode vs Production Mode

Stripe uses the **same key format** for both:
- Test mode: `sk_test_...` → charges use test cards (4242 4242 4242 4242)
- Production mode: `sk_live_...` → real charges

The code makes **no distinction** — it's determined entirely by which key you set. There is no `STRIPE_MODE` variable. The webhook endpoint URL differs:
- Test: `https://<your-domain>/api/billing/webhook/stripe` (configured in Stripe Dashboard with test key)
- Production: same URL (configured in Stripe Dashboard with live key)

### Free Plan Behavior (No Stripe Needed)

- **Free plan switch:** Works immediately without any payment provider
- **Free trial (5 credits):** Created automatically on registration
- **Credit consumption:** Internal ledger, no external payment needed
- **Refund on failure:** Automatic, no Stripe involved

### Security Assessment

- ✅ Raw request body preserved for webhook signature (never re-serialized)
- ✅ HMAC-SHA256 with constant-time comparison
- ✅ Timestamp tolerance (5 min) prevents replay attacks
- ✅ Multiple v1 signatures accepted (supports key rotation)
- ✅ `v0` (deprecated scheme) explicitly rejected
- ✅ Payment provider errors never leak secrets (redacted by `externalHttpRequest`)
- ✅ `client_reference_id` ties checkout to invoice (prevents orphan payments)
- ✅ Paid plans NEVER activated by request body alone — requires verified provider payment
- ✅ Free plans are the ONLY plans a caller can self-assign

### Exact Missing Variables

```
# Stripe (recommended for international):
STRIPE_SECRET_KEY=sk_test_...       # Get from https://dashboard.stripe.com/apikeys
STRIPE_WEBHOOK_SECRET=whsec_...     # Get from Stripe Dashboard → Webhooks

# OR Razorpay (recommended for India/South Asia):
RAZORPAY_KEY_ID=rzp_...
RAZORPAY_KEY_SECRET=...

# Webhook URL to register with provider:
# https://<your-domain>/api/billing/webhook/stripe
```

### User Action Required

1. **Stripe:** Sign up at https://dashboard.stripe.com/register (free account, test mode available)
2. Create API keys at https://dashboard.stripe.com/apikeys (use `sk_test_` first)
3. Register webhook endpoint at https://dashboard.stripe.com/webhooks
   - URL: `https://<your-domain>/api/billing/webhook/stripe`
   - Events: select all 7 events listed above
4. Copy signing secret (`whsec_...`)
5. Set environment variables: `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
6. Test with card `4242 4242 4242 4242`
7. Switch to `sk_live_` when ready for production

### Free / No-Card Options

Stripe test mode requires **no real payment** — you can fully test the checkout flow with test cards. However, creating a Stripe account does require identity verification for live mode.

---

## Blocker 3: SMTP (Email)

### Current Status: ❌ NOT CONFIGURED

No SMTP credentials are set. Password reset and email verification return 503 in production, or `devToken` in development.

### SMTP Architecture

#### Required Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `SMTP_HOST` | Mail server hostname | `smtp.gmail.com` |
| `SMTP_USER` | Authentication username | `you@gmail.com` |
| `SMTP_PASSWORD` | Authentication password or app password | `abcd-efgh-ijkl-mnop` |

#### Optional Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `SMTP_PORT` | Server port | `587` (or `465` if `SMTP_SECURE=1`) |
| `SMTP_SECURE` | Use implicit TLS (port 465) | `0` |
| `SMTP_FROM` | Sender address | `Akbaral <no-reply@akbaral.ai>` |
| `SMTP_EHLO` | EHLO hostname | `akbaral.local` |
| `SMTP_TIMEOUT_MS` | Connection/operation timeout | `10000` |

### Email Verification Flow (Verified in Code)

```
POST /api/auth/request-email-verification { email: "user@example.com" }

Production + no SMTP:
  → 503: "email delivery requires SMTP_HOST, SMTP_USER and SMTP_PASSWORD"
  → Code: provider_not_configured

Development + no SMTP:
  → 202: { status: "requested", emailDelivery: "not_configured", devToken: "aut_..." }
  → The devToken can be used directly with POST /api/auth/verify-email

With SMTP configured:
  → Creates auth token (purpose: 'email_verify', expires 30 min)
  → Sends email via SMTP: "Verify your email address... {verifyUrl}"
  → Returns 202: { status: "requested", emailDelivery: "configured" }

POST /api/auth/verify-email { token: "..." }
  → Verifies token, marks email_verified_at, consumes token
  → Returns 200: { status: "verified" }
```

### Password Reset Flow (Verified in Code)

```
POST /api/auth/request-password-reset { email: "user@example.com" }

Production + no SMTP:
  → 503: "email delivery requires SMTP_HOST, SMTP_USER and SMTP_PASSWORD"
  → Code: provider_not_configured

Development + no SMTP:
  → 202: { status: "requested", emailDelivery: "not_configured", devToken: "aut_..." }

With SMTP configured:
  → Creates auth token (purpose: 'password_reset', expires 30 min)
  → Sends email: "You requested a password reset... {resetUrl}"
  → Returns 202: { status: "requested", emailDelivery: "configured" }

POST /api/auth/reset-password { token: "...", password: "new-password" }
  → Verifies token, hashes new password (scrypt), updates user
  → Revokes ALL existing sessions
  → Consumes token (single-use)
  → Returns 200: { status: "password_reset_successful" }
```

### SMTP Client Implementation

The platform uses a **custom minimal SMTP client** (`src/integrations/smtp.ts`) with zero external dependencies:
- Pure Node.js `net`/`tls` sockets
- Supports: implicit TLS (port 465), STARTTLS (port 587), plaintext
- Auth: AUTH PLAIN and AUTH LOGIN
- Header sanitization (CRLF injection prevention)
- Address parsing (RFC-compliant)
- Timeouts on every operation
- **Passwords never appear in error messages** (`redactSecrets()` applied)

### Development Mode Behavior

In development (`NODE_ENV !== 'production'`), when SMTP is not configured:
- The API returns a `devToken` in the response body
- This token can be used directly with the verify/reset endpoints
- No email is sent
- This is explicitly documented: "Only present in development/test environments"

In production (`NODE_ENV === 'production'`):
- The API returns 503 with the exact missing credentials
- No token is generated or returned
- User must configure SMTP

### Free / No-Card SMTP Options

| Provider | Free Tier | Card Required? | Limit |
|----------|-----------|---------------|-------|
| **Brevo (ex-Sendinblue)** | 300 emails/day | **No** | 300/day, 3,000/month |
| **SendGrid** | 100 emails/day | **No** | 100/day forever |
| **Gmail SMTP** | 500 emails/day | No (Google account) | 500/day (personal), 2,000/day (Workspace) |
| **Mailgun** | 100 emails/day (first 3 months) | Yes | 100/day |
| **Elastic Email** | 100 emails/day | No | 100/day |

**Recommended: Brevo** — 300 emails/day free, no card, SMTP on `smtp-relay.brevo.com:587`.

For Gmail SMTP: use an "App Password" (requires 2FA enabled on Google account). No card needed.

### Security Assessment

- ✅ SMTP password never logged or included in error messages
- ✅ Auth tokens are single-use (consumed after verification)
- ✅ Auth tokens expire after 30 minutes
- ✅ Password reset revokes ALL sessions (prevents session hijacking after compromise)
- ✅ Password minimum 8 characters enforced
- ✅ Password hashing uses scrypt (memory-hard, brute-force resistant)
- ✅ CRLF injection prevented in email headers (`sanitizeHeader`)
- ✅ Email addresses truncated to 254 chars (RFC limit)
- ✅ STARTTLS automatically negotiated when available
- ✅ 503 in production prevents silent email non-delivery

### Exact Missing Variables

```
SMTP_HOST=smtp-relay.brevo.com    # Or smtp.gmail.com, etc.
SMTP_USER=your-email@example.com
SMTP_PASSWORD=your-app-password
SMTP_FROM="Akbaral <no-reply@yourdomain.com>"   # Optional, has default
SMTP_PORT=587                    # Optional, default 587
```

### User Action Required

**Option A: Brevo (recommended — 300/day free, no card)**
1. Sign up at https://www.brevo.com (email only, no card)
2. Verify your domain or use Brevo's shared domain
3. Go to SMTP & API → SMTP settings
4. Copy SMTP relay credentials
5. Set: `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_USER=...`, `SMTP_PASSWORD=...`

**Option B: Gmail SMTP (free with Google account)**
1. Enable 2FA on your Google account
2. Generate an App Password at https://myaccount.google.com/apppasswords
3. Set: `SMTP_HOST=smtp.gmail.com`, `SMTP_USER=you@gmail.com`, `SMTP_PASSWORD=abcd-efgh-ijkl-mnop`

**Option C: Development mode (no SMTP needed)**
- Set `NODE_ENV=development` (or leave unset)
- The API returns `devToken` directly in the response
- Use this token to verify email / reset password manually
- Suitable for testing but NOT for production users

---

## Summary Matrix

| Blocker | Status | Minimum Fix | Free Option? | Complexity |
|---------|--------|-------------|-------------|------------|
| AI Provider | ❌ Unconfigured | Set `GOOGLE_API_KEY` | ✅ Google AI Studio (no card) | 2 minutes |
| Stripe | ❌ Unconfigured | Set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Test mode (no real charges) | 15 minutes |
| SMTP | ❌ Unconfigured | Set `SMTP_HOST` + `SMTP_USER` + `SMTP_PASSWORD` | ✅ Brevo 300/day (no card) | 5 minutes |

## Recommended Fix Order

1. **Google Gemini API key** (2 min) — Unlocks the core product: MASTER can execute real AI work
2. **Brevo SMTP** (5 min) — Enables email verification and password reset for real users
3. **Stripe test mode** (15 min) — Enables paid plan upgrades with test cards; switch to live mode when ready

After these three steps, the platform is production-functional for registered users with real AI execution, email verification, and paid upgrade paths.
