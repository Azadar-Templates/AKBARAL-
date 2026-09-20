# Earning Opportunity Inventory — Comprehensive Discovery (2026-09-20)

> **Scope:** Systematic inventory *beyond* the existing 94 platform/tool integrations. Integrations are **infrastructure** (tools to perform work) — not earning claims. No listing is a job, no estimate is revenue, no platform integration is a customer. Verified USD only after independently verified provider settlement → mission wallet. No income guaranteed.

Base commit `63ac98b` + `OPPORTUNITY_REGISTRY` (src/mission/earning/opportunity-registry.ts) — 22 classes, each classified on 14 factual dimensions. Seed `db/seeds/earning-platforms.json` (194 rows: 6 verified, 179 candidate, 9 rejected) remains the platform catalog source of truth.

---

## 1) Integrations as Infrastructure (94+)

Existing integrations cover **research** (Tavily, Brave, Serper, Google Custom Search, Bing, Firecrawl, Browserbase, Browserless, Apify), **code/hosting** (GitHub, GitLab, Docker, AWS, GCP, Azure, Cloudflare, Vercel, Netlify, Modal, Neon, Supabase, PostgreSQL), **comms** (Slack, Discord, Telegram, Twilio, SendGrid, Resend, Gmail), **creator** (YouTube, Instagram, Facebook, X, TikTok, LinkedIn, Reddit, Pinterest, Canva, Adobe, ElevenLabs, Stability, Replicate, Hugging Face, Runway), **commerce/payments** (Shopify, WooCommerce, Amazon, eBay, Etsy, Walmart, Stripe, PayPal, Razorpay, Coinbase, Circle, Wise, Payoneer, Plaid), **ops** (Google Maps/Mapbox, Expedia/Booking.com/Airbnb/Uber, HubSpot/Salesforce/Zoho/Pipedrive, Mailchimp/Klaviyo, WordPress/Webflow/Wix/Squarespace), **AI** (Gemini, OpenAI, Claude, AssemblyAI, Deepgram, OpenRouter, MCP/A2A/ACP/UCP/AP2/x402/MPP). None is an earning claim.

---

## 2) Expanded Opportunity Classes — 14-field Classification

Each row: **(1) earning mechanism / (2) agent work / (3) customer source / (4) USD payment / (5) payout+evidence / (6) autonomous permitted / (7) human-controlled / (8) country / (9) API / (10) account / (11) costs / (12) fraud-ToS-KYC risks / (13) exclusive assignable / (14) payment verifiable.**

### Freelance / Client Work (fixed-price services)
1. Marketplace escrow (Upwork, Fiverr, Freelancer, Contra, Toptal, PeoplePerHour, Guru, 99designs) — client pays escrow → seller payout
2. Agent: proposal research, validator/report artifact, code fix via GitHub/Docker/Vercel — **no auto-bidding**
3. Buyer-initiated Project Catalog / funded contract
4. Escrow → platform fee 5-20% → payout
5. PayPal/Payoneer/Wise/bank; statement + payout-verification + receiving rail credit before treasury
6. **No** — ToS requires human seller identity
7. Owner: creates seller account (real KYC/tax), publishes listing manually, approves scope/price, accepts contract, handles payout
8. 18+, tax ID, payout country per platform
9. Read-only or owner-PAT (Freelancer API); no bulk bidding
10. Real seller account, payout method
11. Fees 5-20% + $0-3 or 1-2%
12. Fake buyer, off-platform diversion, KYC bypass, auto-bidding → deny-list
13. **Yes**
14. **Yes** (verified) — ranked 3.8

### Paid Research / Data Work (client-owned datasets)
1. Client pays for analysis of own/lawfully licensed data
2. Agent: offline deterministic validation, Tavily/Brave/Firecrawl research, Excel build — no prohibited scraping
3. Real client explicit request + data-rights permission (inbound/permitted_feed)
4. Direct agreement or marketplace escrow
5. Bank/Stripe/PayPal → payout-verification
6. **Yes** — bounded offline work on authorized non-sensitive data
7. Owner verifies lawful purpose, data rights, scope, approval
8. Agnostic; payout per processor (Stripe 46+ countries)
9. Full (Tavily/Brave/Firecrawl SSRF-guarded)
10. None for offline work
11. Inference $0.01-0.50 + search API
12. Invented results, personal-data harvesting → blocked
13. **Yes**
14. **Yes** — **4.7 TOP RANK**

### Software Development
1. Custom software / API integration / bug fix
2. Agent codes/tests via GitHub/GitLab/Docker, preview via Vercel/Cloudflare/Modal
3. Inbound client or marketplace contract where AI assistance disclosed
4. Escrow or Stripe/PayPal invoice
5. Payout-verification + bank credit
6. **Yes** where contract allows AI assistance + human review disclosed
7. Owner approves repo/hosting via vault, prod credentials, contract, payout
8. As freelance
9. Full (GitHub/GitLab/Docker/AWS/GCP/Azure etc.)
10. Owner-provided repo/hosting PAT via vault
11. $0.10-2 per task
12. Secret leakage, supply-chain → secret scan + vault
13. **Yes**
14. **Yes** — **4.5 TOP RANK**

### QA / Testing
1. Test execution / bug reproduction (uTest, Test.io, Tester Work, freelance QA)
2. Offline html-release-check, static analysis, Playwright/unit tests — no pen-testing
3. Marketplace QA project or direct client with explicit HTML source permission
4. PayPal/Payoneer/bank
5. Statement + verification
6. **Yes** — static offline checks only; crawling requires owner-authorized HTML source, not URL
7. Owner authorizes target (HTML source, not URL), reviews checklist, handles account
8. 18+, 50+ countries (Test.io)
9. Browserless/Browserbase if permitted, otherwise offline
10. Platform tester account if applicable
11. $0.05-1
12. Unauthorized testing → blocked by 128 KiB limit (no URLs)
13. **Yes**
14. **Yes** — 3.9

### Design / Video / Audio
1. Original creative (99designs, Dribbble, Fiverr, Contra)
2. Draft via Stability/Replicate/Runway/Canva/Adobe — human refines
3. Contest or direct brief with asset rights
4. Escrow/direct
5. Statement + verification
6. **No** — publishing/submission human
7. Owner holds designer account, approves rights, publishes
8. 18+, tax
9. Generation APIs yes, contest submission bots no
10. Portfolio account
11. $0.10-2 + fees
12. IP infringement, fake portfolio → manual gate
13. **Yes**
14. **Yes** — 2.9

### Writing / Translation
1. Original article/translation where AI draft disclosed
2. Draft via OpenAI/Claude/Gemini/OpenRouter + fact-check — human edits
3. Direct client or Smartcat/Gengo/Translated/Upwork with disclosure
4. Escrow/invoice
5. Payout-verification
6. **Yes** drafting where allowed; publication human-reviewed
7. Owner verifies competence, disclosure, publishing permission
8. 18+, payout country per platform
9. LLM APIs full; translation platform APIs owner-gated
10. Freelance/agency account if marketplace
11. $0.01-0.30/1k tokens + fees 5-20%
12. Plagiarism/hallucination → fact-check + approval
13. **Yes**
14. **Yes** — 4.2

### SEO / Marketing (no ranking guarantees)
1. Audit, content plan, analytics setup
2. Offline HTML checks, Tavily/Brave research, Excel reports — no fake backlinks
3. Direct client with site ownership proof
4. Invoice/marketplace
5. Stripe/PayPal → verification
6. **Yes** research/audit; outreach human-controlled consent-gated
7. Owner verifies ownership, approves outreach templates (no bulk spam)
8. GDPR/CAN-SPAM applies
9. Search APIs + HubSpot/Mailchimp APIs owner-gated
10. None for audit
11. Search + LLM
12. Spam/ToS → prohibition list
13. **Yes**
14. **Yes** — 3.7

### Virtual Assistance / Customer Support
1. Admin/support for client’s own customers (Belay, HubSpot Service Hub)
2. Draft from knowledge base, triage — human sends
3. Explicit support delegation from existing customer base
4. Retainer/per-ticket
5. Verified chain
6. **No** — auto-reply risks impersonation
7. Owner approves KB, templates, every outbound
8. Language/timezone
9. Gmail/Drive/Sheets/Graph/Slack APIs owner-gated
10. Scoped vault access, NDA
11. LLM + platform fees, higher oversight
12. Unauthorized access, impersonation → human-send gate
13. **Yes**
14. **Yes** — restricted (2.3/2.3)

### Tutoring / Education
1. Course/template or 1:1 tutoring where human delivers (Preply, Wyzant, Udemy, Teachable, Gumroad)
2. Agent builds curriculum/quizzes/templates — tutoring is human
3. Marketplace learner
4. Platform payout (Udemy 37-97%, Preply PayPal/Payoneer)
5. Statement + bank credit verified
6. **No** — credentialed teaching human-only
7. Owner verifies qualifications, publishes manually, handles payout
8. Tutoring 18+ + background check; courses global but payout-limited
9. No tutoring API; content via Docs/Sheets/YouTube
10. Instructor account (18+, tax, payout)
11. Revenue share 3-63%
12. Unlicensed advice, credential misrep — prohibition
13. **Yes**
14. **Yes** — 3.0

### Affiliate / Referral
1. Commission on referred sale (Amazon Associates 0-10%, Awin/ShareASale/Impact/ClickBank via SEPA/ACH/Payoneer)
2. Original content/demos, disclosure — no purchased traffic
3. Organic audience/client site with consent
4. Network payout (ACH/SEPA/PayPal/Wise)
5. Network statement → bank credit (Amazon fee schedule, Awin 1M publishers)
6. **No** — enrollment/link issuance human, fake engagement prohibited
7. Owner enrolls (website/social), discloses, places links manually, tax
8. Amazon 22 storefronts; Awin global via Payoneer; 18+
9. Product Advertising APIs require approved enrollment
10. Approved affiliate account
11. Content + hosting; minima $10-100
12. Fake clicks/cookie stuffing → deny-list
13. **No** (shared)
14. **Yes** — 3.5 (candidate, not auto)

### Digital Products
1. Original tool/template/course (Gumroad 10% + Stripe, Lemon Squeezy, Etsy digital, Shopify)
2. Build template/validator, docs, listing copy — owner lists manually
3. Marketplace discover / audience — no self-purchases
4. Merchant of record (Stripe/PayPal)
5. Payout after fees → bank verified
6. **No** — IP/support human
7. Owner verifies IP, lists manually (Gumroad Discover needs actual sales), refunds
8. Gumroad 90+ countries; 18+, tax
9. APIs exist but auto-listing disallowed
10. Merchant account
11. Fees 3.5-10%
12. Copied IP, self-purchase → audit
13. **No**
14. **Yes** — 3.4

### Creator Monetization (ads/memberships/tips)
1. Ad share, memberships, tips (YouTube Partner Program 1k subs+4k hrs, TikTok Rewards, Patreon, Ko-fi — YPP threshold $100)
2. Research/script/edit drafts via ElevenLabs/Stability — human publishes
3. Platform audience, eligibility required
4. AdSense/platform payout
5. AdSense for YouTube / PayPal/bank
6. **No** — channel ownership/publishing human
7. Owner owns channel, passes YPP review (18+, AdSense), publishes
8. YPP not in RU for ads; 18+
9. YouTube Data API but auto-publish violates ToS
10. Channel + AdSense + 18+
11. Production costs + 30-45% cut
12. Fake views/subs → deny-list
13. **No**
14. **Yes** — restricted (3.0)

### E-commerce / App Marketplaces / Paid APIs
1. Physical/app/data marketplace (Shopify 80/20, Atlassian 85/15, RapidAPI 80% — buyer pays for good/API)
2. Agent helps listing copy, inventory sheet, pipeline — human owns store/dataset
3. Store/marketplace buyer
4. Shopify Payments/Stripe/platform payout
5. Payout 2-3 days → bank verified
6. **No** — store ownership/fulfillment/support human
7. Owner owns store/dev account ($5-99), business verification, supplier, payout
8. 18+, business verification, tax
9. Shopify Admin API owner-gated
10. Store + verification + payout bank
11. Shopify $39/mo + 2.9% + fees 15-30%
12. Dropship quality, IP — blocked
13. **No**
14. **Yes** — ecommerce 2.8, apps 2.9, paid APIs 3.0

### Bug Bounties / Security (permitted only)
1. Bounty for valid vuln report (HackerOne, Bugcrowd, YesWeHack, Intigriti — $50-10k+ variable)
2. Scoped static analysis, repro with owner-authorized target, draft report — no unauthorized testing
3. Official program with explicit scope/authorization
4. Platform bounty via PayPal/bank
5. Statement + bank credit verified
6. **Yes — ONLY in-scope, authorized**; disclosure/submission human-controlled
7. Owner verifies scope/authorization, approves target, submits manually, handles KYC
8. 18+, not sanctioned, tax/KYC
9. Program info APIs owner-gated; no out-of-scope scanning
10. Researcher account (real identity)
11. Compute only; no fees
12. Out-of-scope testing → blocked by authorization gate
13. **Yes**
14. **Yes** — **4.0** (candidate, needs researcher account)

### Open-Source Sponsorship
1. Recurring sponsorship (GitHub Sponsors via Stripe Connect, Open Collective, Polar)
2. Agent contributes code/docs via GitHub
3. Sponsor who values project
4. Stripe Connect payout
5. Statement + Stripe credit
6. **No** — sponsor relationship human; no fake stars
7. Owner owns repo, reputation, Sponsors KYC, engages sponsors
8. GitHub Sponsors 30+ regions, Stripe country, 18+
9. Sponsors API read-only
10. GitHub + Sponsors + Stripe + tax
11. Fees 0-10%
12. Fake engagement → deny-list
13. **No**
14. **Yes** — 2.8

### Contests / Challenges
1. Cash prize for winning submission (Kaggle $10k-100k, Topcoder, Devpost, XPRIZE)
2. Agent builds model/code where AI allowed — human submits
3. Organizer with prize pool
4. Prize via bank/PayPal
5. Statement + credit; prize not guaranteed
6. **Yes** where rules allow AI assistance
7. Owner verifies eligibility, AI-use rules, submits, handles KYC/tax
8. Varies; often excludes sanctioned; 18+
9. Kaggle API, Hugging Face
10. Contest account (real identity)
11. Compute (Modal/GPU) — variable
12. Plagiarism, undisclosed AI → rules check
13. **Yes**
14. **Yes** — 3.0

### Microtasks / Data Labeling
1. Per-task labeling (MTurk via Amazon Payments, Appen via Payoneer, Scale Rapid, Toloka, Clickworker)
2. Tooling assistance only — task completion is **human-only per ToS**; bots banned
3. Platform requester
4. Platform payout
5. Statement + bank
6. **No — prohibited** (automation = ToS violation, ban)
7. Human must complete tasks
8. MTurk mostly US/UK; Appen global 18+ + qual tests
9. MTurk Requester API exists but Worker automation prohibited
10. Worker account (18+, tax)
11. Low, minima $10
12. Automation → deny-list
13. **Yes**
14. **Yes** — restricted (2.4) — **NOT pursued autonomously**

### Lead-Gen / Service Fulfillment (consent-gated)
1. Retainer/per-lead for consented contacts (Apollo, Clearbit, HubSpot)
2. Research public business info where permitted, draft outreach for human review — no bulk spam
3. Business client with opted-in contacts only
4. Direct invoice
5. Stripe/bank → verified
6. **No** — outreach human-approved, bulk send prohibited
7. Owner approves every outreach, verifies consent, CRM vault
8. GDPR/CAN-SPAM/CASL
9. Apollo/HubSpot APIs owner-gated but bulk without consent blocked
10. CRM vault, suppression list
11. API + CRM fees
12. Spam/scraping prohibited → suppression + no-bulk
13. **Yes**
14. **Yes** — restricted (2.2)

---

## 3) Ranking (factual criteria only)

Weighted: genuine paid-work(2) + automation(2) + USD verifiability(2) + accessibility + scalability + setup(5=minimal) + operating cost(5=low) → /10.

| Rank | Class | Score | Status | Autonomous | Verifiable | Why top / limitation |
|------|-------|-------|--------|------------|------------|----------------------|
| **1** | **Paid Research / Data** | **4.7** | verified | **Yes** | Yes | Deterministic offline work, full API permission, low cost, immediate verifiable via existing customer-work |
| **2** | **Software Development** | **4.5** | verified | **Yes** | Yes | Same — maps to 2 existing service offers |
| **3** | **Writing / Translation** | 4.2 | candidate | Yes | Yes | Draft permitted with disclosure; needs fact-check gate |
| **4** | **Bug Bounties** | 4.0 | candidate | Yes* | Yes | *Only authorized scope; needs owner researcher account + payout KYC before assignment |
| **5** | **QA / Testing** | 3.9 | candidate | Yes | Yes | Offline checks yes; live crawl requires HTML source not URL |
| 6 | Freelance Client Work | 3.8 | verified | No | Yes | Highest genuine work but ToS blocks auto-bidding — owner publishes, agent executes |
| 7 | SEO/Marketing | 3.7 | candidate | Yes | Yes | Research/audit yes; outreach human |
| 8 | Affiliate/Referral | 3.5 | candidate | No | Yes | Scalable but needs owner enrollment + disclosure |
| 9 | Digital Products | 3.4 | candidate | No | Yes | Needs audience + IP clearance |
| — | *All others 2.2-3.0* | *restricted/candidate* | No | Yes but gated | Require store/channel/developer account, audience, or human-only task |

No guaranteed income claimed; scores reflect permission + verifiability, not earnings prediction.

---

## 4) What Agents Can Pursue Autonomously **Today** (highest-value PERMITTED)

With existing verified-money chain (`customer-work` → `fulfillService` deterministic artifact → multi-agent verify → payout-verification → receiving rail → treasury; owner approval ≥ $ threshold; kill-switch; frozen treasury; vault), the **only classes autonomously discoverable + executable without new payout integration are:**

- **Paid Research / Data** → `json-validation` (reusable validator, findings report, run instructions)
- **Software Development** → `json-validation` + `html-release-check` (release-check report)
- **Where rules allow:** Writing/Translation drafts, QA offline checks, SEO audits, Bug Bounty scoped analysis, Contest models — **all still funnel through the same 2 packs** until owner approves additional service packs.

All other 16 classes are **cataloged as candidate/restricted**: inventoried, not auto-pursued until owner (a) creates real payout-capable account (real identity, KYC, tax, country eligibility reviewed), (b) installs/enables payout verification for that rail, and (c) approves service scope. Microtasks are **never** auto-pursued (ToS prohibits bots).

Infrastructure: `src/mission/earning/opportunity-registry.ts` (22 classes, 14 fields, ranking) + `src/mission/earning/autonomous-discovery.ts` (`permittedAutonomousClassesWithService()`, `autonomousDiscover()`, `canAssignExclusively()`, `pursuitInfrastructureStatus()`) + `OpportunityDiscovery.discover()` filtered to `CLASS_TO_SERVICE` + `checkActivity('software_development')`. Existing 94 integrations remain **tools**, not claims.

Human remains for: identity/account/KYC/contracts/sensitive/restricted/payouts/withdrawals; every opportunity retains source/evidence/timestamp/provider/eligibility/dedup; one-agent exclusive via `qualified → promoted → customer_request source_ref unique` + `promoted_request_id`.

---

## 5) Pipeline (unchanged verifiability)

```
DISCOVER (registry-filtered, SSRF-guarded web_search where permitted)
→ QUALIFY (eligibility + consent window + secret/PII scan)
→ ASSIGN ONE AGENT (qualified → promote owner-only, source_ref unique)
→ EXECUTE REAL WORK (fulfillService deterministic, humanReviewRequired)
→ INDEPENDENT MULTI-AGENT VERIFY (quality/security/compliance checks)
→ DELIVER (where automation permitted, human send)
→ PROVIDER CONFIRMS PAYMENT
→ INDEPENDENTLY VERIFY USD SETTLEMENT (payout-verification)
→ MISSION WALLET → APPROVED OPERATING COSTS / OWNER WITHDRAWAL (owner-only, within policy caps, Agent Factory bounded)
```

No spam, scraping of prohibited sources, fake identities, KYC bypass, automated bidding, impersonation, fraudulent accounts, or ToS violation — enforced by compiled `PROHIBITED_ACTIVITY_KEYS` + `activity_not_allowed` + `providerActivation` + suppression/consent windows.

---

## 6) Settlement Evidence Today

- Verified customers (externally settled): **0**
- Real USD received (mission cash ledger): **$0**
- Treasury frozen check: `mission_cash_accounts.frozen`
- Audit: `mission_audit` hash-chained, `verifyMissionAudit()`

No order/revenue is counted until provider-confirmed, independently verified net USD lands in mission cash. This inventory does not create customers, leads, or earnings.

---

*Generated from official docs + db/seeds/earning-platforms.json (194 rows). Every platform URL above is its official domain. Candidate rows require re-fetch before assignment. This doc is not financial advice.*
