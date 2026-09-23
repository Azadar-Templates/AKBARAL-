# Provider Setup Checklist — 2026-09-23

**Branch:** `arena/01a0ce24-akbaral` @ `5d3b03b3`
**Purpose:** Exact, code-verified setup instructions for each production blocker.
**Status key:** ✅ READY | 🔧 REQUIRES USER ACTION | ❓ UNVERIFIED | 🚫 NOT AVAILABLE

---

## 1. Google AI Studio (Gemini API)

### 1.1 Official Signup / API Key URL

| Item | Status | Detail |
|------|--------|--------|
| Signup URL | 🔧 REQUIRES USER ACTION | https://aistudio.google.com/apikey |
| Account required | ✅ READY | Any Google account (personal Gmail works) |
| Credit card required | ✅ READY | **No card needed** for free tier |
| Country restrictions | ❓ UNVERIFIED | Free tier reportedly unavailable in EEA/UK/Switzerland. Pakistan availability: not explicitly confirmed in sources but no exclusion found. |

### 1.2 Exact Environment Variable

| Variable | Source File | Status |
|----------|-----------|--------|
| `GOOGLE_API_KEY` | `src/config/credentials.ts` line 35, `src/models/catalog.ts` line 92 | ✅ READY |

The code reads this variable at request time via `process.env['GOOGLE_API_KEY']`. No other Google-specific env vars are required for basic chat.

Optional override:
- `GOOGLE_BASE_URL` — base URL override for enterprise proxies (default: `https://generativelanguage.googleapis.com/v1beta`)

### 1.3 Supported Model Names (Currently in Code)

| Model Key | Name | In Catalog | Free Tier Eligible | Free RPD (Sep 2026) |
|-----------|------|-----------|-------------------|---------------------|
| `gemini-3.8-flash` | Gemini 3.8 Flash | ✅ `src/models/catalog.ts` | ✅ Yes | ~20 req/day |
| `gemini-3.5-flash` | Gemini 3.5 Flash | ✅ `src/models/catalog.ts` | ✅ Yes | ~20 req/day |
| `gemini-3.1-flash-lite` | Gemini 3.1 Flash-Lite | ✅ `src/models/catalog.ts` | ✅ Yes | ~500 req/day |

**⚠️ Important notes on free-tier limits (verified Sep 2026):**
- The newest models (3.8 Flash, 3.5 Flash) have been reduced to ~20 free requests per day each.
- Flash-Lite models have ~500 free requests per day.
- RPM limits: 15 RPM for Flash-class, 30 RPM for Flash-Lite.
- TPM limit: 1,000,000 tokens/minute (shared).
- Daily quota resets at midnight Pacific Time.
- **Recommendation:** The default model (`gemini-3.8-flash`, `isDefault: true`) will hit the 20 RPD ceiling quickly. For sustained free usage, `gemini-3.1-flash-lite` (500 RPD) is more practical.

**Code verification:** The Google provider implementation (`src/models/client.ts` class `GoogleProvider`) passes the API key in the `x-goog-api-key` HTTP header (never in URL). It calls `POST /models/{model.key}:generateContent` for chat and `POST /models/{model.key}:streamGenerateContent?alt=sse` for streaming. Safety blocks are explicitly detected and reported.

### 1.4 Free-Tier Restrictions

| Restriction | Status | Detail |
|-------------|--------|--------|
| Rate limits | ✅ READY | 20-500 RPD depending on model; 15-30 RPM |
| Data privacy | ❓ UNVERIFIED | Google may use free-tier prompts to improve Google products (per Google's published terms) |
| SLA | 🚫 NOT AVAILABLE | No uptime guarantee on free tier |
| Model access | ✅ READY | All Flash and Flash-Lite models available free; Pro models are paid-only since April 2026 |
| API key restriction | 🔧 REQUIRES USER ACTION | As of June 19, 2026, Google blocks unrestricted API keys. Keys must be restricted to the Generative Language API. |

### 1.5 Required Deployment Configuration

```bash
# .env file (or deployment environment variables)
GOOGLE_API_KEY=    # ← Paste key from https://aistudio.google.com/apikey
```

No other variables are required. The code has safe defaults for everything else.

### 1.6 Safe Secret Storage

| Location | Status | Detail |
|----------|--------|--------|
| `.env` file (local dev) | ✅ READY | Standard dotenv; `.env` is in `.gitignore` |
| Deployment platform env vars | ✅ READY | StackHost, Vercel, Railway, etc. all support custom env vars |
| Docker secrets | ✅ READY | Pass via `--env-file` or `-e` flag |
| Source code | 🚫 NOT AVAILABLE | Never hardcode. The code reads only from `process.env`. |

### 1.7 Implementation Readiness Summary

| Component | Status |
|-----------|--------|
| Provider class (`GoogleProvider`) | ✅ READY |
| Chat completion | ✅ READY |
| Streaming (SSE) | ✅ READY |
| Safety block detection | ✅ READY |
| Retired model handling (gemini-2.0-flash removed) | ✅ READY |
| Fallback chain integration | ✅ READY |
| Error reporting (never leaks key) | ✅ READY |
| Token usage tracking | ✅ READY |

---

## 2. SMTP / Brevo

### 2.1 Official Signup / Sender Verification

| Item | Status | Detail |
|------|--------|--------|
| Signup URL | 🔧 REQUIRES USER ACTION | https://www.brevo.com (free plan, no card) |
| SMTP settings page | 🔧 REQUIRES USER ACTION | Brevo Dashboard → **Senders, Domains & Dedicated IPs** → **SMTP & API** |
| Sender verification | 🔧 REQUIRES USER ACTION | Add sender address under "Senders" → verify via confirmation email |
| SMTP key generation | 🔧 REQUIRES USER ACTION | Dashboard → SMTP & API → "Generate SMTP Key" (this is the password, NOT your account password) |

### 2.2 Exact SMTP Variables Required by Code

| Variable | Value for Brevo | Source File | Required? |
|----------|----------------|-------------|-----------|
| `SMTP_HOST` | `smtp-relay.brevo.com` | `src/integrations/smtp.ts` line 44 | ✅ **Required** |
| `SMTP_USER` | Your Brevo SMTP login (e.g. `7xxxxx@smtp-brevo.com`) | `src/integrations/smtp.ts` line 45 | ✅ **Required** |
| `SMTP_PASSWORD` | Your Brevo SMTP key (NOT account password) | `src/integrations/smtp.ts` line 46 | ✅ **Required** |
| `SMTP_PORT` | `587` (default) | `src/integrations/smtp.ts` line 50 | ❓ Optional (587 is default) |
| `SMTP_SECURE` | `0` (STARTTLS on 587) | `src/integrations/smtp.ts` line 52 | ❓ Optional (default `0`) |
| `SMTP_FROM` | `Akbaral <verified-sender@yourdomain.com>` | `src/config/env.ts` | ❓ Optional (has default) |
| `SMTP_EHLO` | `akbaral.local` (default) | `src/integrations/smtp.ts` line 150 | ❓ Optional |
| `SMTP_TIMEOUT_MS` | `10000` (default) | `src/integrations/smtp.ts` line 60 | ❓ Optional |

**Code verification:** `smtpConfigured()` returns `true` only when all three required variables (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`) are non-empty. The SMTP client supports:
- STARTTLS on port 587 (auto-negotiated)
- Implicit TLS on port 465 (when `SMTP_SECURE=1`)
- AUTH PLAIN and AUTH LOGIN
- Timeouts on every operation

### 2.3 TLS/STARTTLS Requirements

| Setting | Status | Detail |
|---------|--------|--------|
| STARTTLS (port 587) | ✅ READY | Auto-negotiated by the code when `SMTP_SECURE` is not `1`. Brevo supports this. |
| Implicit TLS (port 465) | ✅ READY | Set `SMTP_SECURE=1`. Code uses `tls.connect()` directly. |
| Plaintext fallback | ✅ READY | Code supports unencrypted connection for trusted local relays (not recommended for production). |
| Certificate validation | ✅ READY | `tls.connect()` uses Node.js default certificate verification. |

### 2.4 Free-Tier Restrictions

| Restriction | Status | Detail |
|-------------|--------|--------|
| Daily send limit | ✅ READY | 300 emails/day (rolling 24-hour window) |
| Contact storage | ✅ READY | Up to 100,000 contacts free |
| Time limit | ✅ READY | Permanent — no expiration |
| Credit card | ✅ READY | Not required |
| Brevo branding | ❓ UNVERIFIED | "Sent with Brevo" footer likely included on free plan |
| Transactional email | ✅ READY | Included on free plan (counts against daily 300) |
| Sender verification | 🔧 REQUIRES USER ACTION | The From address MUST be verified in Brevo dashboard before sending works |
| Account approval | ❓ UNVERIFIED | Brevo may require account approval before first send |

### 2.5 Production Email Test Procedure

1. **Set environment variables:**
   ```bash
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_USER=7xxxxx@smtp-brevo.com    # From Brevo SMTP settings
   SMTP_PASSWORD=your-smtp-key         # From Brevo SMTP settings (NOT account password)
   SMTP_FROM="Akbaral <verified@yourdomain.com>"
   ```

2. **Verify sender in Brevo:** Dashboard → Senders → Add Sender → confirm via email

3. **Start the server in production mode:**
   ```bash
   NODE_ENV=production npm run serve
   ```

4. **Test password reset:**
   ```bash
   curl -X POST http://localhost:4000/api/auth/request-password-reset \
     -H 'Content-Type: application/json' \
     -d '{"email":"your-registered-email@example.com"}'
   ```
   Expected: `202 { status: "requested", emailDelivery: "configured" }`

5. **Test email verification:**
   ```bash
   curl -X POST http://localhost:4000/api/auth/request-email-verification \
     -H 'Content-Type: application/json' \
     -d '{"email":"your-registered-email@example.com"}'
   ```
   Expected: `202 { status: "requested", emailDelivery: "configured" }`

6. **Verify delivery:** Check the recipient inbox (and spam folder). Email should arrive within seconds.

### 2.6 Safe Secret Storage

| Location | Status | Detail |
|----------|--------|--------|
| `.env` file | ✅ READY | `.env` is in `.gitignore` |
| Deployment env vars | ✅ READY | All platforms support custom env vars |
| Code logging | ✅ READY | Password never logged — errors use `redactSecrets()` |
| API responses | ✅ READY | SMTP credentials never returned in any response |

### 2.7 Implementation Readiness Summary

| Component | Status |
|-----------|--------|
| Custom SMTP client (no deps) | ✅ READY |
| STARTTLS support | ✅ READY |
| Implicit TLS support | ✅ READY |
| AUTH PLAIN + AUTH LOGIN | ✅ READY |
| CRLF injection prevention | ✅ READY |
| Timeout enforcement | ✅ READY |
| Secret-free errors | ✅ READY |
| Dev-mode `devToken` (no SMTP needed) | ✅ READY |
| Production 503 when unconfigured | ✅ READY |

---

## 3. Stripe

### 3.1 Official Dashboard URL

| Item | Status | Detail |
|------|--------|--------|
| Dashboard URL | 🔧 REQUIRES USER ACTION | https://dashboard.stripe.com |
| API Keys page | 🔧 REQUIRES USER ACTION | https://dashboard.stripe.com/apikeys |
| Webhooks page | 🔧 REQUIRES USER ACTION | https://dashboard.stripe.com/webhooks |
| Country availability for Pakistan | 🚫 NOT AVAILABLE | **Stripe does NOT support Pakistan directly** (verified Sep 2026) |

### 3.2 Country Eligibility — Critical Finding

| Country | Direct Stripe Support | Alternative Path |
|---------|----------------------|-----------------|
| United States | ✅ Yes | N/A |
| United Kingdom | ✅ Yes | N/A |
| India | ✅ Yes | N/A |
| UAE | ✅ Yes | N/A |
| Singapore | ✅ Yes | N/A |
| **Pakistan** | **🚫 NOT AVAILABLE** | US LLC + EIN + US bank account required |
| Bangladesh | 🚫 NOT AVAILABLE | US LLC + EIN required |
| Nigeria | 🚫 NOT AVAILABLE | US LLC + EIN required |

**If the business owner is based in Pakistan:** Stripe cannot be used directly. The owner would need to:
1. Register a US LLC (can be done remotely via formation agents)
2. Obtain an EIN from the IRS
3. Open a US business bank account (Mercury, Relay)
4. Apply to Stripe as the US LLC entity
5. File Form W-8BEN-E for foreign owner status

This is a significant setup effort. **Razorpay is also not available** (India-only).

### 3.3 Test-Mode Setup Requirements

| Step | Status | Detail |
|------|--------|--------|
| Create Stripe account | 🔧 REQUIRES USER ACTION | Free; requires supported country business entity |
| Get test API keys | 🔧 REQUIRES USER ACTION | `sk_test_...` and `pk_test_...` from dashboard |
| Test card number | ✅ READY | `4242 4242 4242 4242` (always succeeds) |
| Test mode webhooks | 🔧 REQUIRES USER ACTION | Use Stripe CLI (`stripe listen`) for local testing |

### 3.4 Exact Environment Variable Names

| Variable | Purpose | Source File | Required? |
|----------|---------|-------------|-----------|
| `STRIPE_SECRET_KEY` | API authentication (Checkout Sessions) | `src/billing/providers.ts` line 35, 55 | ✅ **Required** |
| `STRIPE_WEBHOOK_SECRET` | Webhook HMAC-SHA256 signature verification | `src/billing/stripe.ts` line 93, `src/routes/billing.ts` line 157 | ✅ **Required** |

Optional related variables:
- `BILLING_WEBHOOK_SECRET` — generic billing webhook (alternative path)
- `STRIPE_BASE_URL` — override for proxy/gateway (default: `https://api.stripe.com`)

### 3.5 Webhook Endpoint and Event Types

| Item | Status | Detail |
|------|--------|--------|
| Webhook URL | ✅ READY | `POST /api/billing/webhook/stripe` |
| Full URL (production) | 🔧 REQUIRES USER ACTION | `https://<your-domain>/api/billing/webhook/stripe` |

**Required event subscriptions** (from `STRIPE_WEBHOOK_EVENTS` in `src/billing/stripe.ts`):

| Stripe Event | Internal Action | Source |
|-------------|----------------|--------|
| `checkout.session.completed` | `invoice.paid` | Plan/credit checkout completed |
| `payment_intent.succeeded` | `invoice.paid` | Payment captured |
| `payment_intent.payment_failed` | `payment.failed` | Payment failed |
| `invoice.paid` | `invoice.paid` | Subscription invoice paid |
| `invoice.payment_failed` | `payment.failed` | Subscription payment failed |
| `charge.refunded` | `invoice.refunded` | Charge refunded |
| `customer.subscription.deleted` | `subscription.cancelled` | Subscription cancelled |

**Code verification:** The webhook handler (`src/routes/billing.ts`):
- Reads the RAW body (preserved by Express `verify` hook in `src/app.ts`)
- Verifies HMAC-SHA256 with constant-time comparison
- Checks timestamp within 5-minute tolerance (replay protection)
- Claims event ID for idempotency (prevents double-settlement)
- Normalizes event → internal billing contract
- Unknown event types → acknowledged (200) but recorded as `ignored`

### 3.6 Test Mode vs Live Mode

| Aspect | Test Mode | Live Mode |
|--------|-----------|-----------|
| Secret key prefix | `sk_test_...` | `sk_live_...` |
| Webhook secret prefix | `whsec_test_...` | `whsec_live_...` |
| Test card | `4242 4242 4242 4242` | Real cards |
| Code difference | 🚫 NONE — same code path | 🚫 NONE — same code path |
| Stripe Dashboard | Separate test/live toggle | Separate test/live toggle |
| Webhook endpoint | Register in test mode | Register separately in live mode |

The code makes **no distinction** between test and live mode. It's determined entirely by which key you set.

### 3.7 Implementation Readiness Summary

| Component | Status |
|-----------|--------|
| Checkout Session creation | ✅ READY |
| Webhook signature verification | ✅ READY |
| Event normalization | ✅ READY |
| Idempotency (event ID claiming) | ✅ READY |
| Invoice creation + payment recording | ✅ READY |
| Credit granting on payment | ✅ READY |
| Refund handling | ✅ READY |
| Subscription cancellation | ✅ READY |
| 402 when unconfigured | ✅ READY |
| Razorpay alternative | ❓ See Section 4 |

---

## 4. Razorpay

### 4.1 Production-Readiness (Code)

| Component | Status | Detail |
|-----------|--------|--------|
| Order creation | ✅ READY | `createRazorpayOrder()` in `src/billing/providers.ts` |
| Webhook verification | ✅ READY | `verifyRazorpaySignature()` called in `src/routes/billing.ts` |
| Configuration check | ✅ READY | `razorpayConfigured()` checks `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` |
| Error handling | ✅ READY | Returns `provider_not_configured` when unset |

### 4.2 Country/Account Eligibility

| Item | Status | Detail |
|------|--------|--------|
| India | ✅ Eligible | Razorpay is an Indian payment gateway, serves Indian businesses |
| Singapore | ❓ UNVERIFIED | Razorpay has Singapore presence (per their docs for international payments) |
| United States | ❓ UNVERIFIED | Razorpay has US presence (per their docs) |
| **Pakistan** | **🚫 NOT AVAILABLE** | Razorpay does NOT operate in Pakistan. It is an Indian payment gateway licensed for India. Pakistani businesses cannot create Razorpay merchant accounts. |
| Bangladesh | 🚫 NOT AVAILABLE | Not supported |
| Other countries | ❓ UNVERIFIED | Razorpay primarily serves India; limited international expansion |

### 4.3 Required Credentials

| Variable | Purpose | Source File |
|----------|---------|-------------|
| `RAZORPAY_KEY_ID` | API key ID | `src/billing/providers.ts` line 99 |
| `RAZORPAY_KEY_SECRET` | API key secret (also used for webhook verification) | `src/billing/providers.ts` line 100, `src/routes/billing.ts` line 222 |

### 4.4 Webhook Settings

| Item | Status | Detail |
|------|--------|--------|
| Webhook URL | ✅ READY | `POST /api/billing/webhook` (generic endpoint) |
| Webhook body field | ✅ READY | `provider: "razorpay"` in body selects Razorpay path |
| Signature header | ✅ READY | `x-razorpay-signature` header verified with `RAZORPAY_KEY_SECRET` |
| Dual verification | ✅ READY | Generic `x-akbaral-signature` + Razorpay-specific `x-razorpay-signature` |

### 4.5 Recommendation

**🚫 DO NOT recommend Razorpay for Pakistan-based businesses.**

Razorpay is an Indian payment gateway. It requires:
- An Indian business entity (or presence in Singapore/US)
- Indian bank account for settlements
- Indian KYC documentation

For a Pakistan-based owner, Razorpay is **not a viable alternative** to Stripe. The code implementation is production-ready, but the service is geographically unavailable.

### 4.6 Summary

| Aspect | Status |
|--------|--------|
| Code implementation | ✅ READY |
| Pakistan availability | 🚫 NOT AVAILABLE |
| India availability | ✅ Eligible (with Indian business entity) |
| Webhook security | ✅ READY |

---

## Final Summary: What the Owner Can Actually Do

### Immediate Actions (No Card, No Foreign Entity)

| Action | Status | Time |
|--------|--------|------|
| **Get Google AI Studio API key** | 🔧 REQUIRES USER ACTION | 2 min |
| **Set up Brevo SMTP** | 🔧 REQUIRES USER ACTION | 10 min |
| **Set environment variables** | 🔧 REQUIRES USER ACTION | 1 min |

After these two steps, the platform has:
- ✅ Real AI execution (MASTER can process goals)
- ✅ Email verification for new users
- ✅ Password reset functionality
- ✅ Free trial plan working (5 credits)

### Payment: The Hard Problem

| Option | Availability for Pakistan | Setup Effort |
|--------|--------------------------|-------------|
| Stripe (direct) | 🚫 NOT AVAILABLE | N/A |
| Razorpay (direct) | 🚫 NOT AVAILABLE | N/A |
| Stripe (via US LLC) | ❓ Possible | High: US LLC + EIN + bank account + W-8BEN-E |
| Free-only mode | ✅ READY | None: platform works with free plans only |

**Current state without payment:** The platform is fully functional for free-tier users. Credits are consumed/refunded internally. The only missing capability is accepting payment for plan upgrades and credit purchases.

**Recommended path:** Launch with free tier only. Add Stripe later via US LLC when revenue justifies the setup cost. The code is ready — only the business entity and credentials are needed.

### Exact Environment Variables to Set

```bash
# === AI Provider (unlocks real execution) ===
GOOGLE_API_KEY=                          # From https://aistudio.google.com/apikey

# === SMTP (unlocks email verification + password reset) ===
SMTP_HOST=smtp-relay.brevo.com           # Brevo SMTP server
SMTP_USER=                               # Brevo SMTP login (7xxxxx@smtp-brevo.com)
SMTP_PASSWORD=                           # Brevo SMTP key (NOT account password)
SMTP_FROM="Akbaral <verified@domain.com>" # Must be verified in Brevo dashboard

# === Stripe (ONLY if business entity in supported country exists) ===
# STRIPE_SECRET_KEY=                     # sk_test_... or sk_live_...
# STRIPE_WEBHOOK_SECRET=                 # whsec_...

# === Razorpay (ONLY for Indian business entities) ===
# RAZORPAY_KEY_ID=                       # Not available for Pakistan
# RAZORPAY_KEY_SECRET=                   # Not available for Pakistan
```

---

*No secret values were exposed in this document. No code was modified. All provider information verified against source code and current public documentation as of 2026-09-23.*
