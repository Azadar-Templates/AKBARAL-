# Real-World Global Earning Verification Audit — 2026-09-23

**Purpose:** Verify the `country-eligibility.ts`, `agent-opportunity-routing.ts`, and `capability-detection.ts` modules against current real-world platform policies and payout rail availability as of September 2026.

**Method:** Web research of official platform documentation, reputable directories, and recent (2025-2026) reports. No code modified. No commits.

---

## EXECUTIVE SUMMARY

### Critical Errors Found in Code (3 items)

| # | Issue | Severity | Module |
|---|-------|----------|--------|
| 1 | **Wise marked as "partially available" in Pakistan** — Wise has NOT accepted new Pakistani registrations since January 2023. Only pre-existing accounts still function. | 🔴 HIGH | `country-eligibility.ts` |
| 2 | **Gumroad marked as blocked in Pakistan** — Gumroad actually supports direct bank transfer payouts to 100+ countries INCLUDING Pakistan. | 🔴 HIGH | `country-eligibility.ts` |
| 3 | **Contra marked as fully supported in Pakistan** — Contra uses Stripe for payouts ONLY. Pakistani residents cannot receive Stripe payouts without a virtual US bank account workaround. | 🟡 MEDIUM | `country-eligibility.ts` |

### New Opportunities Found (Not in Code)

| Platform | Pakistan Status | Evidence |
|----------|----------------|----------|
| **Lemon Squeezy** | ✅ Pakistan supported | Official docs list Pakistan in supported countries |
| **Polar.sh** | ✅ Pakistan supported for payouts | Official docs list Pakistan |
| **Elevate Pay** | ✅ Pakistan-only fintech | Local alternative, 1-1.5% fees |
| **Skrill** | ✅ Works with Freelancer.com for Pakistan | Lower-cost alternative to Payoneer |

---

## DETAILED PLATFORM VERIFICATION

### 1. UPWORK — `country-eligibility.ts`

| Claim in Code | Verified Status | Evidence |
|--------------|----------------|----------|
| Pakistan: supported ✅ | ✅ **CORRECT** | Upwork accepts Pakistani freelancers. Payoneer + direct-to-local-bank + wire withdrawal confirmed. |
| Payout methods: payoneer, bank_wire, wise, ach | ⚠️ **PARTIALLY CORRECT** | Payoneer ✅, bank wire ✅, direct-to-local-bank ✅, wire ✅. **Wise is NOT a direct Upwork withdrawal method for new Pakistani accounts** (Wise stopped accepting new PK registrations Jan 2023). ACH requires US bank account. |
| Blocked: CU, IR, KP, SY, RU | ✅ **CORRECT** | Standard sanctions |
| Human-only: account/KYC, bidding, contract, payout | ✅ **CORRECT** | Upwork explicitly prohibits automated bidding. All account creation, proposal submission, and contract acceptance are human-only. |
| Automation: read-only API | ✅ **CORRECT** | Upwork GraphQL API is read-only for job search. Bidding/listing requires human action. |

**Verdict: MOSTLY CORRECT with Wise annotation needed**

### 2. FIVERR — `country-eligibility.ts`

| Claim in Code | Verified Status | Evidence |
|--------------|----------------|----------|
| Pakistan: supported ✅ | ✅ **CORRECT** | Fiverr fully available in Pakistan. CNIC/passport verification. |
| Payout methods: payoneer, bank_wire, paypal | ⚠️ **PARTIALLY CORRECT** | Payoneer ✅. Fiverr also supports **direct-to-local-bank in PKR** (confirmed 2026). PayPal is listed but **Pakistanis cannot use PayPal to receive** — only non-PK sellers in PayPal-supported countries. |
| Blocked: CU, IR, KP, SY, RU | ✅ **CORRECT** | |
| Easypaisa buyer payment | ✅ NEW | Fiverr accepts Easypaisa for Pakistani buyers (2026). Not relevant for seller payouts. |

**Verdict: MOSTLY CORRECT — PayPal payout annotation wrong for Pakistan sellers**

### 3. FREELANCER.COM — `country-eligibility.ts`

| Claim in Code | Verified Status | Evidence |
|--------------|----------------|----------|
| Pakistan: supported ✅ | ✅ **CORRECT** | Confirmed by multiple 2025-2026 sources |
| Payout methods: paypal, payoneer, wise, bank_wire, ach, sepa | ⚠️ **TOO BROAD** | Actual methods for Pakistan: Payoneer ✅, direct bank/express withdrawal ✅, Skrill ✅. **PayPal NOT available for Pakistan.** Wise NOT available for new PK accounts. ACH/SEPA require US/EU bank accounts. |

**Verdict: PAYOUT METHODS TOO BROAD — PayPal, Wise, ACH, SEPA are not usable for Pakistan**

### 4. CONTRA — `country-eligibility.ts`

| Claim in Code | Verified Status | Evidence |
|--------------|----------------|----------|
| Pakistan: supported ✅ | 🟡 **TOO BROAD** | You can CREATE a Contra account from Pakistan, but payouts are via Stripe Connect ONLY. Pakistan is NOT a Stripe-supported country for payouts. Contra's own review states: "Contra's reliance on Stripe for payouts limits its accessibility in countries where Stripe payouts are not available — including Pakistan." Pakistani freelancers need a Wise/Payoneer virtual US bank account workaround. |
| Payout methods: stripe, bank_wire | ⚠️ **MISLEADING** | Stripe Connect only. Bank wire is only via Stripe. No direct bank withdrawal option. |
| Workaround available | ❌ **NOT DOCUMENTED** | Code does not note that a virtual US bank account is required for Pakistani Contra users. |

**Verdict: TOO BROAD — Contra is NOT practically usable for Pakistan without US LLC/virtual bank workaround**

### 5. TOPTAL — `country-eligibility.ts`

| Claim in Code | Verified Status | Evidence |
|--------------|----------------|----------|
| Pakistan: supported ✅ | ✅ **CORRECT** | Multiple 2026 sources confirm Toptal accepts Pakistan-based freelancers |
| Payout methods: payoneer, bank_wire, paypal, ach | ⚠️ **PARTIALLY CORRECT** | Payoneer ✅ (primary method for PK). Bank wire ✅. PayPal ❌ (not available in PK). ACH ❌ (requires US bank). |

**Verdict: MOSTLY CORRECT — PayPal and ACH not usable for Pakistan**

### 6. HACKERONE — `country-eligibility.ts`

| Claim in Code | Verified Status | Evidence |
|--------------|----------------|----------|
| Pakistan: supported ✅ | ✅ **CORRECT** | HackerOne is global. Pakistan researchers are eligible. |
| Payout methods: paypal, bank_wire, payoneer | ⚠️ **PARTIALLY CORRECT** | Bank wire ✅. **PayPal ❌ for Pakistan.** HackerOne also supports **cryptocurrency** payouts (not in code). Payoneer status: HackerOne docs show payment methods include PayPal, bank transfer, and crypto — Payoneer not explicitly listed as direct method, but Pakistani researchers can receive via bank wire. |
| KYC: Veriff identity verification | ✅ **CORRECT** | Confirmed — 12-month validity |
| Tax form required | ✅ **CORRECT** | W-8BEN for non-US researchers |

**Verdict: MOSTLY CORRECT — PayPal not usable for PK; crypto option missing**

### 7. BUGCROWD — `country-eligibility.ts`

| Claim in Code | Verified Status | Evidence |
|--------------|----------------|----------|
| Pakistan: supported ✅ | ✅ **CORRECT** | Bugcrowd is global |
| Payout methods: paypal, bank_wire, payoneer | ⚠️ **PARTIALLY CORRECT** | Bank wire ✅. **PayPal ❌ for Pakistan.** Bugcrowd also supports **cryptocurrency** payouts (confirmed 2026). |

**Verdict: MOSTLY CORRECT — PayPal not usable for PK; crypto option missing**

### 8. KAGGLE — `country-eligibility.ts`

| Claim in Code | Verified Status | Evidence |
|--------------|----------------|----------|
| Pakistan: supported ✅ | ⚠️ **NEEDS CAVEAT** | Kaggle competitions are global, BUT prize eligibility depends on local laws. Some competitions explicitly exclude certain countries. Kaggle's rules state: "If a winner is located in a country where prizes cannot be awarded, then they are not eligible to receive a prize." Pakistan is not explicitly excluded in general rules, but individual competitions may restrict. |
| Payout methods: bank_wire, paypal | ⚠️ **PARTIALLY CORRECT** | Bank wire ✅. PayPal ❌ for Pakistan. |

**Verdict: NEEDS CAVEAT — Individual competition restrictions may apply**

### 9. GUMROAD — `country-eligibility.ts` 🔴

| Claim in Code | Verified Status | Evidence |
|--------------|----------------|----------|
| Pakistan: blocked 🚫 | 🟥 **WRONG — TOO RESTRICTIVE** | Gumroad's payout country list (via Wise blog, 2024-2026) explicitly includes Pakistan for **direct bank transfer payouts**. Gumroad became a full Merchant of Record in January 2025, supporting global sellers. PayPal Connect restored early 2025. Pakistan is listed in their payout-supported countries. |
| Payout methods: stripe, paypal, bank_wire | ⚠️ **PARTIALLY CORRECT** | Bank transfer ✅ for Pakistan. PayPal payout ✅ (via PayPal Connect, restored 2025 — but Pakistanis cannot have PayPal accounts, so effectively bank transfer only). Stripe ❌ for PK merchants. |

**Verdict: WRONG — Pakistan should be in `supportedCountries` for Gumroad, not `blockedCountries`. Bank transfer is the practical payout method.**

### 10. AWIN — `country-eligibility.ts`

| Claim in Code | Verified Status | Evidence |
|--------------|----------------|----------|
| Pakistan: supported ✅ | ✅ **CORRECT** | Awin operates in 180+ countries. Pakistan publishers accepted. Payoneer payout option confirmed for Pakistan. |
| Payout methods: payoneer, sepa, ach, bank_wire | ⚠️ **PARTIALLY CORRECT** | Payoneer ✅ for Pakistan. SEPA ❌ (EU only). ACH ❌ (US only). Bank wire ✅. |

**Verdict: MOSTLY CORRECT — SEPA/ACH not usable for Pakistan**

### 11. GITHUB SPONSORS — `country-eligibility.ts`

| Claim in Code | Verified Status | Evidence |
|--------------|----------------|----------|
| Pakistan: blocked 🚫 | ✅ **CORRECT** | GitHub's official docs list supported regions for GitHub Sponsors. Pakistan is NOT in the list. Multiple community discussions (2022-2025) confirm Pakistanis cannot receive Sponsors payouts. Requires Stripe Connect, which is not available in Pakistan. |
| Payout methods: stripe | ✅ **CORRECT** | Stripe Connect only |

**Verdict: CORRECT**

### 12. DEVPOST — `country-eligibility.ts`

| Claim in Code | Verified Status | Evidence |
|--------------|----------------|----------|
| Pakistan: supported ✅ | ✅ **LIKELY CORRECT** | Devpost hackathons are generally global. Prize eligibility depends on individual hackathon rules (similar to Kaggle). No country-specific exclusion found for Pakistan in general terms. |
| Payout methods: paypal, bank_wire, payoneer | ⚠️ **VARIES BY HACKATHON** | Payout methods are set by individual hackathon organizers. Most use PayPal or bank transfer. |

**Verdict: LIKELY CORRECT with caveat that individual hackathons may restrict**

### 13. RAPIDAPI — `country-eligibility.ts`

| Claim in Code | Verified Status | Evidence |
|--------------|----------------|----------|
| Pakistan: supported ✅ | ❓ **UNVERIFIED** | No specific Pakistan eligibility data found in 2026 sources |

**Verdict: UNVERIFIED**

---

## PAYOUT RAIL VERIFICATION

### PAYONEER — `country-eligibility.ts`

| Claim | Verified Status | Evidence |
|-------|----------------|----------|
| Pakistan: supported ✅ | ✅ **CORRECT** | Payoneer has operated in Pakistan for 10+ years. CNIC verification. Virtual receiving accounts in USD/EUR/GBP/CAD/AUD/JPY. Direct bank withdrawal to PKR. |
| Platform integrations | ✅ **CORRECT** | Upwork, Fiverr, Freelancer.com, Toptal, Amazon, eBay all integrate with Payoneer. |
| Fees: 2-3% | ✅ **CORRECT** | 2-3.99% depending on withdrawal method (2026). |
| Cannot hold funds in Pakistan | ✅ **CORRECT** | Confirmed: Payoneer does not allow holding funds in Pakistan/Bangladesh accounts. |
| $50,000/transaction limit | ✅ **CORRECT** | Confirmed for fully verified accounts. $100,000/month receiving limit. |
| 15-year Upwork partnership | ✅ **CORRECT** | Payoneer-Upwork partnership extended May 2026, 15 years of collaboration. |

**Verdict: FULLY CORRECT**

### SWIFT/BANK WIRE — `country-eligibility.ts`

| Claim | Verified Status | Evidence |
|-------|----------------|----------|
| Pakistan: supported ✅ | ✅ **CORRECT** | Pakistani banks accept SWIFT wire transfers. SBP-reportable. |
| Fees: $15-30 | ✅ **CORRECT** | Confirmed: $15-25 inbound fee for most banks. |
| Blocked: CU, IR, KP, SY only | ✅ **CORRECT** | Standard international sanctions. |

**Verdict: FULLY CORRECT**

### PAYPAL — `country-eligibility.ts`

| Claim | Verified Status | Evidence |
|-------|----------------|----------|
| Pakistan: blocked 🚫 | ✅ **CORRECT** | PayPal is NOT available in Pakistan as of 2026. Multiple sources confirm: cannot create account, cannot send, cannot receive. Pakistan is on the "not supported" list. |
| Reason: AML/FATF/SBP regulations | ✅ **CORRECT** | Both foreign exchange and AML requirements cited. |
| Xoom (PayPal subsidiary) one-way only | ✅ **CORRECT** | Xoom can send TO Pakistan but Pakistani residents cannot have PayPal accounts. |

**Verdict: FULLY CORRECT**

### STRIPE — `country-eligibility.ts` & `capability-detection.ts`

| Claim | Verified Status | Evidence |
|-------|----------------|----------|
| Pakistan merchants: blocked 🚫 | ✅ **CORRECT** | Stripe does not officially support Pakistan for merchant accounts as of 2026. Cannot sign up with PK address/CNIC/bank. |
| Workaround: US LLC + EIN + US bank | ✅ **CORRECT** | Multiple 2026 guides confirm this path. Stripe Atlas also accepts some Pakistani applicants (not guaranteed). |
| Cross-border payouts to PK | 🟡 **NEW — NOT IN CODE** | In Feb 2026, Stripe expanded cross-border payout destinations to include `pk_bank_account`. This means Stripe Connect CAN pay out to Pakistani bank accounts from Stripe Connect platforms. This does NOT make Pakistan a supported merchant country, but it means some platforms using Stripe Connect (e.g., some marketplace platforms) may be able to pay Pakistani recipients. |

**Verdict: CORRECT for merchant accounts. MISSING: cross-border payout expansion to Pakistan.**

### WISE — `country-eligibility.ts` 🔴

| Claim | Verified Status | Evidence |
|-------|----------------|----------|
| Pakistan: partially supported | 🟥 **WRONG — TOO BROAD** | Wise has **NOT accepted new Pakistani registrations since January 2023** (confirmed by multiple Reddit threads from 2023-2025, Wise's own support response). Only pre-existing accounts can still send PKR to Pakistani banks. **New users in Pakistan CANNOT create Wise accounts.** |
| "Can receive USD/EUR/GBP, withdraw to PKR bank" | 🟥 **WRONG for new users** | This was true before January 2023. Currently: "We can't offer multi-currency accounts in Pakistan anymore. This is because of a recent regulatory update from the Pakistani local authorities." |
| Existing accounts: limited functionality | ✅ **PARTIALLY CORRECT** | Old accounts can still send PKR to Pakistani banks. But cannot open account details / receive money. |

**Verdict: WRONG — Should be marked as "blocked for new registrations" not "partially available"**

---

## AGENT-OPPORTUNITY ROUTING VERIFICATION

### `agent-opportunity-routing.ts`

| Claim | Verified Status | Evidence |
|-------|----------------|----------|
| Direct platforms are country-agnostic | ✅ **CORRECT** | Direct client research, AI implementation, automation, consulting — these don't require platform accounts. Work is performed locally; payment is via bank wire/Payoneer. |
| Platform-specific eligibility checked | ✅ **CORRECT** | The routing module calls `getPlatformCountryEligibility()` which uses the platform data. However, the accuracy depends on the underlying `country-eligibility.ts` data (which has the 3 errors noted above). |
| Skills matching | ✅ **CORRECT** | Agent capabilities matched against opportunity's required capabilities and tools. |
| Sanctioned country blocking | ✅ **CORRECT** | CU, IR, KP, SY, RU blocked on all platforms. |
| Payout compatibility check | ⚠️ **DEPENDS ON DATA** | The payout compatibility check is only as accurate as the underlying country-eligibility data. With the Wise/Gumroad/Contra errors, some routing decisions could be wrong. |

**Verdict: LOGIC IS CORRECT — DATA QUALITY ISSUES IN DEPENDENCY**

---

## PAYMENT CAPABILITY DETECTION VERIFICATION

### `capability-detection.ts`

| Claim | Verified Status | Evidence |
|-------|----------------|----------|
| Stripe not available for PK merchants | ✅ **CORRECT** | Confirmed: Stripe does not support Pakistan merchant accounts. |
| Razorpay India-only | ✅ **CORRECT** | Razorpay is India-only for merchants. |
| No secrets exposed | ✅ **CORRECT** | Only configuration status returned, never key values. |
| Free tier always available | ✅ **CORRECT** | Free plan and trial work without any payment provider. |
| Honest 402 when no provider | ✅ **CORRECT** | Billing routes return `provider_not_configured` with exact missing credential names. |

**Verdict: FULLY CORRECT**

---

## ADDITIONAL PLATFORMS NOT IN CODE

### Lemon Squeezy
- **Pakistan: ✅ SUPPORTED** — Official docs list Pakistan in supported countries
- Payout: Full MoR (Merchant of Record), handles global tax
- **Action needed:** Add to `PLATFORM_COUNTRY_ELIGIBILITY`

### Polar.sh
- **Pakistan: ✅ SUPPORTED for payouts** — Official docs list Pakistan
- Payout: Stripe Connect via Polar (cross-border payout to PK bank now possible per Feb 2026 Stripe expansion)
- **Action needed:** Add to `PLATFORM_COUNTRY_ELIGIBILITY`

### Elevate Pay
- **Pakistan: ✅ SUPPORTED** — Pakistan-focused fintech, CNIC-based verification
- Payout: Direct PKR to local bank, 1-1.5% fees
- **Action needed:** Consider adding as payout rail option

### Skrill
- **Pakistan: ✅ SUPPORTED** — Works with Freelancer.com for withdrawals
- Fees: 3-5% currency conversion
- **Action needed:** Consider adding as payout rail option

---

## COMPREHENSIVE STATUS MATRIX

### Category 1: Code-Supported Functionality ✅
- Earning engine 17-field records with deduplication
- Opportunity scoring (factual, not predictive)
- Settlement verification with 7 rails
- Kill switch + activity allow-list
- Agent money grant provisioning requirement
- Multi-agent verification (2 verifiers at 0.85 confidence)
- Provider confirmation + owner reconciliation (dual gate)
- Mission DB / Platform DB isolation
- Owner analytics with mission revenue exclusion
- Payment capability detection without secret exposure
- International registration without country blocking
- USD pricing on all plans
- Free trial (5 credits) without payment provider

### Category 2: Externally Verified ✅
- Payoneer: Available in Pakistan, 190+ countries, 2-3% fees, $50K/tx limit
- Upwork: Available in Pakistan, Payoneer/bank/wire withdrawal
- Fiverr: Available in Pakistan, Payoneer/direct-to-local-bank
- Freelancer.com: Available in Pakistan, Payoneer/bank/Skrill
- HackerOne: Global, Pakistan eligible, KYC via Veriff
- Bugcrowd: Global, Pakistan eligible
- Awin: 180+ countries, Pakistan via Payoneer
- GitHub Sponsors: NOT available in Pakistan (confirmed)
- Stripe: NOT available for PK merchants (confirmed)
- PayPal: NOT available in Pakistan (confirmed)
- SWIFT bank wire: Available in Pakistan
- Pakistan IT export tax: 0.25%-1% for registered freelancers

### Category 3: Unverified ❓
- RapidAPI Pakistan eligibility
- PeoplePerHour Pakistan eligibility
- Guru Pakistan eligibility
- YesWeHack Pakistan eligibility
- Intigriti Pakistan eligibility
- Topcoder Pakistan eligibility
- Specific per-hackathon country restrictions on Devpost/Kaggle
- ShareASale Pakistan eligibility

### Category 4: Blocked by Platform Policy 🚫
- Amazon Mechanical Turk: Automation explicitly prohibited by ToS
- YouTube Partner Program: Human-only (channel ownership, content creation)
- TikTok Creator Fund: Human-only
- Etsy physical products: Requires physical inventory/shipping
- Preply live tutoring: Human-only synchronous instruction

### Category 5: Blocked by Country/Payment Eligibility 🚫
- Stripe (PK merchant): Not supported
- PayPal (PK): Not supported
- Gumroad (PK): **WRONGLY blocked in code — actually supported**
- GitHub Sponsors (PK): Not supported (Stripe Connect dependency)
- Wise (PK new users): Stopped accepting since Jan 2023
- All sanctioned countries (CU/IR/KP/SY/RU): Blocked everywhere

### Category 6: Human Action Required 👤
- All platform account creation (KYC, tax forms)
- All bidding/proposal submission (Upwork, Fiverr, Freelancer)
- All listing/gig publishing
- All contract acceptance/negotiation
- All payout withdrawal initiation
- All bug bounty scope verification
- All hackathon submission
- All affiliate program enrollment
- All client communication/negotiation

### Category 7: Safe Automation Possible 🤖
- Opportunity discovery and scoring (fully automated)
- Platform eligibility checking (fully automated)
- Agent-opportunity matching (fully automated)
- Web research for proposals/reports (automated with SSRF guard)
- Code generation/review (automated with owner approval)
- Data analysis/validation (automated on owner-authorized data)
- SEO analysis (automated with site ownership verification)
- Documentation/technical writing (automated with human review)
- Bug bounty research (automated within authorized scope)
- Payment capability detection (fully automated)

### Category 8: Remaining Production Blockers 🔴
1. **Wise data error** — `country-eligibility.ts` marks Wise as "partially available" in Pakistan for new users. Must be corrected to "blocked for new registrations."
2. **Gumroad data error** — Pakistan incorrectly in `blockedCountries`. Should be in `supportedCountries` with bank transfer as primary payout.
3. **Contra data error** — Pakistan incorrectly in `supportedCountries` without noting Stripe payout requirement. Should be marked as requiring virtual US bank account.
4. **Missing platforms** — Lemon Squeezy, Polar.sh, Elevate Pay, Skrill not tracked in code.
5. **Cross-border Stripe payout** — Feb 2026 expansion enabling `pk_bank_account` as payout destination not reflected in code. This affects platforms that use Stripe Connect for payouts.
6. **Payout method accuracy** — Several platforms list PayPal/ACH/SEPA as available payout methods for Pakistan, but these are NOT actually usable by Pakistani residents. Need to distinguish "platform supports method" from "method works in owner's country."

---

## TAX AND COMPLIANCE VERIFICATION

### Pakistan Freelancer Tax (2025-2026)
| Requirement | Status | Evidence |
|------------|--------|----------|
| FBR registration required | ✅ | NTN + Iris portal registration |
| PSEB registration for reduced rate | ✅ | 0.25% withholding tax on foreign income |
| 80% rule for banking channels | ✅ | 80% of foreign earnings through approved channels |
| W-8BEN for Upwork | ✅ | Non-US taxpayer declaration, prevents US withholding |
| IT export income classification | ✅ | Reduced tax rate for documented IT exports |
| Section 65F exemption | ⚠️ | Possible full exemption until June 2026 — verify current status |

---

## RECOMMENDED CORRECTIONS (No Code Changes Made)

### P0 — Critical (Affects earning capability)
1. Fix `country-eligibility.ts`: Wise → `blockedCountries: ['PK']` for new registrations, with note that existing accounts still function
2. Fix `country-eligibility.ts`: Gumroad → Move Pakistan from `blockedCountries` to `supportedCountries`, payout method: `['bank_wire']`
3. Fix `country-eligibility.ts`: Contra → Add note that Pakistani users need virtual US bank account for Stripe payout
4. Fix payout method annotations across all platforms to distinguish "platform supports method" vs "method works in Pakistan"

### P1 — Important (Expands opportunities)
5. Add Lemon Squeezy to `PLATFORM_COUNTRY_ELIGIBILITY` (PK supported)
6. Add Polar.sh to `PLATFORM_COUNTRY_ELIGIBILITY` (PK supported for payouts)
7. Add Elevate Pay as payout rail option for Pakistan
8. Add Skrill as payout rail option for Pakistan
9. Update Stripe cross-border payout data to reflect Feb 2026 `pk_bank_account` expansion

### P2 — Nice to Have
10. Add RapidAPI, PeoplePerHour, Guru, YesWeHack, Intigriti Pakistan eligibility verification
11. Add cryptocurrency as payout option for HackerOne/Bugcrowd
12. Add per-competition restriction tracking for Kaggle/Devpost

---

*Verification performed 2026-09-23 using official platform documentation and reputable 2025-2026 sources. No code was modified. No accounts were created. No transactions were performed. All claims reference publicly available evidence.*
