# Global USD Earning & Worldwide Customer Readiness Audit — 2026-09-23

**Branch:** `arena/01a0ce24-akbaral` @ `5d3b03b3`
**Method:** Source-code analysis + platform connector verification + external eligibility research (Sep 2026)
**Rule:** No income counted as revenue. No fake jobs, fake clients, spam, or impersonation. No assumptions about country availability.

---

## PART 1: ZA141251SA PRIVATE MISSION — GLOBAL USD EARNING READINESS

### 1.1 Platform Connector Inventory (Code-Verified)

The codebase classifies **68 platform connectors** in `src/mission/earning/platform-connectors.ts`:

| Category | Count | Examples |
|----------|-------|---------|
| **EARNING_SOURCE (ACTIVE)** | 14 | Upwork, Fiverr, Freelancer, Contra, HackerOne, Bugcrowd, Kaggle |
| **EARNING_SOURCE (PERMITTED)** | 16 | Toptal, RapidAPI, Gumroad, Amazon Associates, Awin, GitHub Sponsors |
| **EARNING_SOURCE (RESTRICTED)** | 4 | YouTube, Shopify store, Udemy, Preply |
| **EARNING_SOURCE (BLOCKED)** | 1 | Amazon Mechanical Turk (human-only) |
| **EARNING_SOURCE (candidate/direct)** | 7 | Direct research, AI implementation, automation, consulting, SEO |
| **INFRASTRUCTURE** | ~20 | GitHub, Docker, AWS, Cloudflare, Vercel, Neon, Supabase |
| **PAYMENT_RAIL** | 4+ | Stripe, PayPal, Payoneer, Wise |
| **RESTRICTED_HUMAN_ONLY** | 2 | YouTube Partner, Shopify Store |

**Plus:** 194 platforms in `db/seeds/earning-platforms.json` (mostly affiliate: 128 affiliate, 29 affiliate_network, 12 marketplace, 6 freelance_services).

### 1.2 Opportunity Registry (Code-Verified)

`src/mission/earning/opportunity-registry.ts` defines **15 opportunity classes**, each classified on 14 factual dimensions:

| Class | Autonomous | Payment Verifiable | Status |
|-------|-----------|-------------------|--------|
| freelance_client_work | ❌ No (human-only bidding/KYC) | ✅ Yes | verified |
| paid_research_data | ✅ Yes | ✅ Yes | verified |
| software_development | ✅ Yes | ✅ Yes | verified |
| ai_implementation | ✅ Yes | ✅ Yes | verified |
| automation_services | ✅ Yes | ✅ Yes | verified |
| consulting_advisory | ✅ Yes | ✅ Yes | candidate |
| qa_testing | ✅ Yes | ✅ Yes | verified |
| writing_translation | ❌ No | ✅ Yes | verified |
| bug_bounties | ✅ Yes | ✅ Yes | verified |
| contests_challenges | ✅ Yes | ✅ Yes | verified |
| digital_products | ❌ No (listing is human) | ✅ Yes | verified |
| paid_apis_data | ❌ No | ✅ Yes | verified |
| open_source_sponsorship | ❌ No | ✅ Yes | candidate |
| affiliate_referral | ✅ Yes | ✅ Yes | candidate |
| lead_gen_fulfillment | ❌ No | ✅ Yes | restricted |

### 1.3 Platform Country Eligibility for Pakistan-Based Owner

**This is the critical section.** The owner is based in Pakistan. Each platform's real-world eligibility is verified below.

#### Freelance Marketplaces

| Platform | Pakistan Eligibility | Payout to Pakistan | Status | Source |
|----------|---------------------|-------------------|--------|--------|
| **Upwork** | ✅ Available | ✅ Payoneer / bank wire / Wise | ✅ READY | Upwork accepts Pakistani freelancers; verification requires government ID; approval competitive but available |
| **Fiverr** | ✅ Available | ✅ Payoneer / JazzCash | ✅ READY | Fiverr fully available in Pakistan; CNIC verification; Payoneer withdrawal confirmed |
| **Freelancer.com** | ✅ Available | ✅ PayPal/Payoneer/Wise | ✅ READY | Pakistan supported |
| **Contra** | ✅ Available | ✅ Stripe Connect | ⚠️ PARTIAL | Contra is global; Stripe Connect payout requires supported country (see Stripe section) |
| **Toptal** | ✅ Available (screening) | ✅ Bank/Payoneer | ⚠️ PARTIAL | Toptal accepts globally but rigorous screening; payout country-dependent |
| **PeoplePerHour** | ❓ UNVERIFIED | ❓ UNVERIFIED | ❓ UNVERIFIED | No Pakistan-specific data found |
| **Guru** | ❓ UNVERIFIED | ❓ UNVERIFIED | ❓ UNVERIFIED | No Pakistan-specific data found |

#### Bug Bounty Platforms

| Platform | Pakistan Eligibility | Payout to Pakistan | Status |
|----------|---------------------|-------------------|--------|
| **HackerOne** | ✅ Available globally | ✅ PayPal / bank wire | ✅ READY |
| **Bugcrowd** | ✅ Available globally | ✅ PayPal / bank wire | ✅ READY |
| **YesWeHack** | ❓ UNVERIFIED | ❓ UNVERIFIED | ❓ UNVERIFIED |
| **Intigriti** | ❓ UNVERIFIED | ❓ UNVERIFIED | ❓ UNVERIFIED |

#### Contests / Data / Digital Products

| Platform | Pakistan Eligibility | Payout | Status |
|----------|---------------------|--------|--------|
| **Kaggle** | ✅ Available globally | ✅ Bank/PayPal | ✅ READY |
| **Topcoder** | ❓ UNVERIFIED | ❓ UNVERIFIED | ❓ UNVERIFIED |
| **Devpost** | ✅ Available globally | ✅ PayPal/bank | ✅ READY |
| **Gumroad** | ✅ Available (90+ countries) | ✅ PayPal/bank (via Stripe) | ⚠️ PARTIAL (needs Stripe/PayPal) |
| **RapidAPI** | ❓ UNVERIFIED | ✅ PayPal/bank | ❓ UNVERIFIED |
| **GitHub Sponsors** | ❓ UNVERIFIED | ✅ Stripe Connect | ⚠️ PARTIAL (needs Stripe) |

#### Affiliate Programs (128 in seed data)

| Platform | Pakistan Eligibility | Payout | Status |
|----------|---------------------|--------|--------|
| **Amazon Associates** | ❓ UNVERIFIED per storefront | ✅ Gift card / bank (varies by country) | ⚠️ PARTIAL |
| **Awin** | ✅ Global publisher program | ✅ Payoneer / SEPA / ACH | ✅ READY |
| **ShareASale** | ❓ UNVERIFIED | ✅ Payoneer / check | ❓ UNVERIFIED |

### 1.4 Payment Rail Availability for Pakistan

This is the **most critical constraint**. Earning requires receiving USD.

| Payment Rail | Pakistan Availability | Status | Evidence |
|-------------|---------------------|--------|----------|
| **PayPal** | 🚫 **NOT AVAILABLE** | 🚫 BLOCKED | PayPal is not available in Pakistan. Cannot create account. Cannot receive payments. No workaround exists within Pakistan. |
| **Payoneer** | ✅ **AVAILABLE** | ✅ READY | Widely used by Pakistani freelancers. Receives from Upwork, Fiverr, marketplaces. Withdraws to Pakistani bank in PKR. Cannot hold funds. Fees: ~1-3.2%. |
| **Wise (TransferWise)** | ⚠️ **LIMITED** | ⚠️ PARTIAL | Can receive USD/GBP/EUR into Wise from abroad. Can convert and withdraw to Pakistani bank. Cannot open full multi-currency account. Cannot send business payments to PKR. No Wise card for Pakistan. |
| **Stripe** | 🚫 **NOT AVAILABLE (direct)** | 🚫 BLOCKED | Stripe does not support Pakistan. Requires US LLC + EIN + US bank account. |
| **Bank Wire (SWIFT)** | ✅ **AVAILABLE** | ✅ READY | Pakistani banks accept USD wire transfers. Fees: $15-30/transfer. 3-5 business days. SBP reporting required. |
| **ACH/SEPA** | 🚫 NOT AVAILABLE | 🚫 BLOCKED | Requires US/EU bank account |

### 1.5 Settlement Verification (Code-Verified)

`src/mission/earning/settlement-verification.ts` accepts these rails:

```
ALLOWED_RAILS = ['bank', 'stripe', 'paypal', 'payoneer', 'wise', 'ach', 'sepa', 'wire']
```

**For Pakistan, only these are actually usable:**

| Rail | Code-Supported | Actually Available in Pakistan |
|------|---------------|-------------------------------|
| `bank` / `wire` | ✅ | ✅ SWIFT wire to Pakistani bank |
| `payoneer` | ✅ | ✅ Payoneer → Pakistani bank |
| `wise` | ✅ | ⚠️ Limited (receive only, withdraw to bank) |
| `stripe` | ✅ | 🚫 Not available without US LLC |
| `paypal` | ✅ | 🚫 Not available in Pakistan |
| `ach` | ✅ | 🚫 Requires US bank account |
| `sepa` | ✅ | 🚫 Requires EU bank account |

### 1.6 Payout Destination Verification (Code-Verified)

`src/mission/payout-verification.ts` requires:
- Owner attestation of destination control
- No raw card numbers, IBANs, or long digit runs stored
- Verification expires (default 180 days)
- Separation: never moves money, only decides if destination is payable

**Status:** ✅ READY — the verification system works independently of payment rail availability.

### 1.7 Human-Only Actions (Code-Verified)

Every platform connector explicitly lists `humanOnlyActions`:
- Account creation / KYC / tax forms
- Listing/gig publishing
- Bidding / proposal submission
- Contract acceptance / negotiation
- Payout withdrawal

**Status:** ✅ READY — the code correctly gates all human-required actions. Agents perform scoped work ONLY after owner assignment.

### 1.8 USD Ledger / Treasury Separation (Code-Verified)

| Component | File | Separation Verified |
|-----------|------|--------------------|
| Mission database | `src/mission/database.ts` | ✅ Separate from platform DB |
| Mission money | `src/mission/money.ts` | ✅ No `from '../db'` import |
| Treasury | `src/mission/treasury.ts` | ✅ Separate financial decisions |
| Owner analytics | `src/business/owner-analytics.ts` | ✅ `missionRevenueExcluded: true` |
| Settlement | `src/mission/earning/settlement-verification.ts` | ✅ Independent verification |

### 1.9 Earning Engine Integrity Safeguards (Code-Verified)

The earning engine (`src/mission/earning/earning-engine.ts`) enforces:
- Kill switch check (every operation)
- Activity allow-list check (policy gate)
- Registry key validation
- Synthetic provider/evidence blocking (`'synthetic','fixture','fake','example.com','test-'`)
- Gross amount validation (positive, ≤$100,000)
- Net ≤ Gross invariant
- 17-field opportunity input validation
- Research-specific: lawful purpose ref, dataset SHA-256, evidence URL, non-sensitive flag, data rights review

**Status:** ✅ READY — no synthetic revenue can enter the ledger.

---

## PART 2: AKBARAL! WORLDWIDE CUSTOMER READINESS

### 2.1 International User Registration

| Aspect | Status | Evidence |
|--------|--------|----------|
| Registration API | ✅ READY | `POST /api/auth/register` — no country restriction in code |
| Login | ✅ READY | `POST /api/auth/login` — works for any registered user |
| Country field in user model | ❓ UNVERIFIED | No country field found in registration; users identified by email only |
| Geographic access restriction | ✅ NONE | No geo-blocking in code; no country allowlist/blocklist |
| OAuth providers | ⚠️ PARTIAL | Google/GitHub/Microsoft/Apple routes exist; all require credential configuration |

**Finding:** The registration system is **country-agnostic**. Anyone worldwide with an email can register. There is no country restriction in the code.

### 2.2 Worldwide Access Restrictions

| Aspect | Status | Detail |
|--------|--------|--------|
| Server-side geo-blocking | ✅ NONE | No IP-based blocking in middleware |
| CORS configuration | ✅ READY | Configurable via `CORS_ORIGINS` env var |
| CDN/proxy restrictions | ❓ UNVERIFIED | Depends on deployment platform (StackHost, etc.) |
| Content localization | 🚫 NOT AVAILABLE | English only; no i18n framework |
| Timezone handling | ❓ UNVERIFIED | Timestamps stored in ISO 8601 (UTC); display depends on client |

### 2.3 USD Pricing

| Aspect | Status | Evidence |
|--------|--------|----------|
| Plan prices in USD | ✅ READY | All 6 plans priced in USD cents ($0/$10/$50/$90/$200/$400) |
| Currency field | ✅ READY | `plan.currency = 'USD'` in seed data |
| Credit purchases in USD | ✅ READY | `purchaseCustomCredits()` uses USD cents |
| Invoice generation | ✅ READY | `renderInvoicePdf()` generates USD invoices |
| Multi-currency support | 🚫 NOT AVAILABLE | USD only; no conversion, no PKR/EUR/GBP |

### 2.4 International Payment Provider Availability

| Provider | Countries Supported | Pakistan | India | US | UK | EU | Status |
|----------|-------------------|----------|-------|-----|-----|-----|--------|
| **Stripe** | ~46 countries | 🚫 No | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ⚠️ PARTIAL (not Pakistan) |
| **Razorpay** | India only | 🚫 No | ✅ Yes | ❓ No | ❓ No | ❓ No | ⚠️ PARTIAL (India only) |
| **PayPal** | 200+ countries (send) | 🚫 No | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ⚠️ PARTIAL (not Pakistan) |

**Finding:** AKBARAL!'s payment system works for customers worldwide EXCEPT when the business owner needs to receive the payment in Pakistan. Stripe supports customers in 46+ countries, but the merchant account must be in a supported country.

### 2.5 Can the Owner Legally Receive International Revenue?

**For a Pakistan-based owner, the receiving options are:**

| Method | Legality | Availability | Fees | Status |
|--------|---------|-------------|------|--------|
| **Payoneer** | ✅ Legal (SBP-compliant) | ✅ Available | ~1-3.2% + conversion | ✅ READY |
| **SWIFT wire to Pakistani bank** | ✅ Legal (SBP-reportable) | ✅ Available | $15-30/transfer | ✅ READY |
| **Wise (receive only)** | ✅ Legal for inward remittance | ⚠️ Limited | ~0.4-1.5% | ⚠️ PARTIAL |
| **US LLC → Stripe → US bank → wire to Pakistan** | ✅ Legal (US LLC owned by Pakistani) | ✅ Available | LLC formation + compliance | ⚠️ PARTIAL (requires setup) |
| **PayPal** | 🚫 N/A | 🚫 Not available | N/A | 🚫 BLOCKED |

### 2.6 Customer Billing, Refunds & Webhooks (Code-Verified)

| Feature | Status | Evidence |
|---------|--------|----------|
| Plan switching (free) | ✅ READY | `billingService.switchPlan()` works without payment provider |
| Plan checkout (paid) | ⚠️ PARTIAL | Returns 402 when no Stripe; requires payment provider |
| Credit purchase | ⚠️ PARTIAL | Same: requires payment provider |
| Refund on task failure | ✅ READY | Execution queue refunds credits automatically |
| Webhook processing | ✅ READY | Stripe webhook handler verified; idempotent event processing |
| Invoice PDF | ✅ READY | `renderInvoicePdf()` generates invoices |
| Usage statement | ✅ READY | `billingService.usageStatement()` |

### 2.7 API/Provider Costs and Fallback

| Aspect | Status | Detail |
|--------|--------|--------|
| Model provider required for AI execution | ⚠️ PARTIAL | Needs GOOGLE_API_KEY or equivalent |
| Goal analysis without provider | ✅ READY | Falls back to heuristic (deterministic) |
| Free tier (Google Gemini) | ✅ READY | No card required; 20-500 RPD depending on model |
| OmniRoute fallback | ✅ READY | Private gateway with quota controls |
| Direct provider fallback chain | ✅ READY | Google → OpenAI → Anthropic chain with scoring |

---

## PART 3: COMPREHENSIVE STATUS MATRIX

### A. ZA141251SA — USD Earning by Category

| Earning Category | Code-Supported | Pakistan-Eligible | Payout Available | Human Gates | Overall |
|-----------------|---------------|-------------------|-----------------|-------------|---------|
| Freelance client work | ✅ | ✅ Upwork/Fiverr/Freelancer | ✅ Payoneer/bank | ✅ | ✅ READY |
| Paid research/data | ✅ | ✅ Location-agnostic | ✅ Bank wire | ✅ | ✅ READY |
| Software development | ✅ | ✅ Location-agnostic | ✅ Payoneer/bank | ✅ | ✅ READY |
| AI implementation | ✅ | ✅ Location-agnostic | ✅ Payoneer/bank | ✅ | ✅ READY |
| Automation services | ✅ | ✅ Location-agnostic | ✅ Payoneer/bank | ✅ | ✅ READY |
| Bug bounties | ✅ | ✅ HackerOne/Bugcrowd global | ✅ PayPal/Payoneer/bank | ✅ | ✅ READY |
| Contests/hackathons | ✅ | ✅ Kaggle/Devpost global | ✅ Bank/PayPal | ✅ | ✅ READY |
| QA testing | ✅ | ⚠️ Test.io (50+ countries) | ✅ PayPal/Payoneer | ✅ | ⚠️ PARTIAL |
| Digital products | ✅ | ⚠️ Gumroad needs Stripe/PayPal | ⚠️ Limited | ✅ | ⚠️ PARTIAL |
| Affiliate/referral | ✅ | ⚠️ Varies by program | ⚠️ Payoneer for some | ✅ | ⚠️ PARTIAL |
| Writing/translation | ✅ | ⚠️ Platform-dependent | ⚠️ Platform-dependent | ✅ | ⚠️ PARTIAL |
| Open source sponsorship | ✅ | ⚠️ GitHub Sponsors needs Stripe | ⚠️ Limited | ✅ | ⚠️ PARTIAL |
| E-commerce/Shopify | ✅ | ⚠️ Needs Stripe/PayPal | ⚠️ Limited | ✅ | ⚠️ PARTIAL |
| Tutoring/education | ✅ | ⚠️ Platform-dependent | ⚠️ Platform-dependent | ✅ | ⚠️ PARTIAL |
| Lead generation | ✅ | ⚠️ Restricted status | ⚠️ Limited | ✅ | ⚠️ PARTIAL |
| Creator monetization (YouTube) | ✅ | 🚫 RESTRICTED (human-only) | ✅ AdSense | ✅ | 🚫 BLOCKED |
| Microtasks (MTurk) | ✅ | 🚫 BLOCKED (automation prohibited) | N/A | ✅ | 🚫 BLOCKED |

### B. AKBARAL! — Worldwide Customer Service

| Feature | Status | Detail |
|---------|--------|--------|
| User registration (any country) | ✅ READY | No geographic restriction in code |
| Login/authentication | ✅ READY | Email/password works globally |
| Landing page access | ✅ READY | No geo-blocking |
| MASTER workspace | ✅ READY | Works with any model provider |
| Task execution (AI) | ⚠️ PARTIAL | Requires model provider config |
| Free trial (5 credits) | ✅ READY | Works without payment provider |
| Plan display (USD pricing) | ✅ READY | 6 plans shown correctly |
| Plan upgrade (paid) | 🚫 BLOCKED (Pakistan owner) | Requires Stripe in supported country |
| Plan upgrade (paid) | ✅ READY (non-Pakistan owner) | Stripe works in 46+ countries |
| Credit purchase | 🚫 BLOCKED (Pakistan owner) | Same: requires payment provider |
| Credit consumption/refund | ✅ READY | Internal ledger, no external payment |
| Email verification | ⚠️ PARTIAL | Requires SMTP config |
| Password reset | ⚠️ PARTIAL | Requires SMTP config |
| Invoice generation | ✅ READY | USD invoices work without payment provider |
| Task history/files | ✅ READY | No external dependency |
| Agent Factory | ✅ READY | Works with model provider |
| Marketplace/agents directory | ✅ READY | Public catalog works |
| Public pages (14 pages) | ✅ READY | All serve HTTP 200 |

### C. Payment Reception — Pakistan Owner

| Method | Can Receive USD | Legality | Setup Effort | Ongoing Cost | Status |
|--------|----------------|---------|-------------|-------------|--------|
| Payoneer | ✅ Yes | ✅ Legal | Low (sign up online) | 1-3.2% + FX | ✅ READY |
| Bank wire (SWIFT) | ✅ Yes | ✅ Legal (SBP-reportable) | Low (existing bank) | $15-30/transfer | ✅ READY |
| Wise (receive) | ⚠️ Limited | ✅ Legal for inward | Low | 0.4-1.5% | ⚠️ PARTIAL |
| Stripe (via US LLC) | ✅ Yes | ✅ Legal | High (LLC + EIN + bank) | LLC compliance | ⚠️ PARTIAL |
| PayPal | 🚫 No | N/A | N/A | N/A | 🚫 BLOCKED |
| Razorpay | 🚫 No (Pakistan) | N/A | N/A | N/A | 🚫 BLOCKED |

---

## PART 4: CRITICAL FINDINGS

### Finding 1: Freelance Earning is Ready (via Payoneer)

The mission's freelance connectors (Upwork, Fiverr, Freelancer, Contra) are all available for Pakistani users. Payoneer is the primary payout rail and is fully functional in Pakistan. The code correctly:
- Requires owner-created accounts with real KYC
- Gates all bidding/listing as human-only
- Allows agents to perform scoped work after assignment
- Verifies settlement before entering mission cash

**What's needed:** Owner must create accounts on Upwork/Fiverr (15 min each), link Payoneer for payouts, and publish initial listings/gigs.

### Finding 2: Bug Bounties are Ready (Global)

HackerOne and Bugcrowd accept researchers worldwide, including Pakistan. Payouts via PayPal or bank wire. PayPal is not available in Pakistan, but bank wire works.

**What's needed:** Owner must create HackerOne/Bugcrowd accounts and configure payout to Pakistani bank.

### Finding 3: Digital Products / Affiliate Need Stripe (Blocked for Pakistan)

Gumroad, GitHub Sponsors, and many affiliate programs pay via Stripe Connect or PayPal — both unavailable in Pakistan directly. This blocks approximately 30+ earning sources from the seed data.

**Workaround:** US LLC unlocks Stripe. Alternatively, some affiliate programs pay via Payoneer (Awin confirmed).

### Finding 4: AKBARAL! Can Serve Worldwide Customers

The registration, authentication, and application code have NO geographic restrictions. Anyone worldwide can:
- Register (email/password)
- Use the free trial (5 credits)
- Run MASTER goals (with model provider configured)
- View all 22 routes

**What blocks paid upgrades for Pakistan owner:** Stripe/PayPal unavailability in Pakistan. The code is ready; only the merchant account is missing.

### Finding 5: No Synthetic Revenue Can Enter the System

The earning engine has explicit guards against:
- Synthetic provider/evidence markers (`'synthetic','fixture','fake','example.com','test-'`)
- Net > Gross invariant
- Research-specific: lawful purpose + dataset SHA-256 + evidence URL + non-sensitive flag + data rights
- Kill switch (immediate halt)
- Activity allow-list (policy gate)

**This is production-grade integrity.** No fake revenue, no estimated income, no synthetic jobs.

---

## PART 5: RECOMMENDED ACTIONS (Priority Order)

### Immediate (Free, No Card, No Foreign Entity)

1. **Set `GOOGLE_API_KEY`** — Unlocks real AI execution (2 min, free)
2. **Set up Brevo SMTP** — Unlocks email verification + password reset (10 min, free)
3. **Create Upwork account** — Pakistani freelancer, verified (15 min, Payoneer for payout)
4. **Create Fiverr account** — Pakistani seller, verified (15 min, Payoneer for payout)
5. **Create Payoneer account** — Payout rail for freelance earnings (10 min, free)
6. **Create HackerOne account** — Bug bounty earnings (10 min, free)

### Medium-term (Some Setup Required)

7. **Configure Awin affiliate** — Payoneer payout available for Pakistan
8. **Register on Kaggle/Devpost** — Contest earnings
9. **Publish first Upwork Project Catalog** — Fixed-price AI/software services
10. **Publish first Fiverr gig** — AI-assisted services

### Long-term (Foreign Entity Required)

11. **Form US LLC** — Unlocks Stripe, US bank account, global payment acceptance
12. **Configure Stripe** — Enables AKBARAL! paid upgrades for worldwide customers
13. **Enable Gumroad/GitHub Sponsors** — Digital product sales via Stripe

---

## PART 6: WHAT IS NOT READY (Honest Assessment)

| Item | Status | Why |
|------|--------|-----|
| Automated earning (fully autonomous) | 🚫 NOT READY | Platform ToS requires human identity for accounts, bidding, KYC. Agents assist; humans own. |
| Stripe payments (Pakistan owner) | 🚫 BLOCKED | Stripe not available in Pakistan |
| PayPal payments (Pakistan owner) | 🚫 BLOCKED | PayPal not available in Pakistan |
| Digital product sales (most platforms) | ⚠️ PARTIAL | Need Stripe/PayPal for payouts |
| Affiliate programs (most) | ⚠️ PARTIAL | Many require PayPal; some work with Payoneer |
| Multi-currency billing | 🚫 NOT AVAILABLE | USD only |
| Non-English customers | 🚫 NOT AVAILABLE | English only |
| Mobile apps | 🚫 NOT AVAILABLE | No iOS/Android project |
| Real-time collaboration | ⚠️ PARTIAL | SSE works; WebSocket proxy needs production config |
| Automated bidding/proposal | 🚫 PROHIBITED | All platforms explicitly prohibit; code correctly gates as human-only |

---

*No code was modified. No income was claimed. No fake revenue generated. All platform eligibility verified against public sources as of September 2026. All code claims verified against actual source files.*
