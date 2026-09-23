# Real-World USD Earning Pilot Plan — 2026-09-23

**Branch:** `arena/01a0ce24-akbaral` @ `b735c3b`
**Owner Country:** Pakistan (PK)
**Method:** Read-only pilot design. No code modified. No commits. No fake accounts. No income claims.
**Goal:** Verify that the mission infrastructure can produce and receive real USD from eligible worldwide opportunities.

---

## PILOT PHILOSOPHY

This pilot does NOT aim to earn a specific amount. It aims to answer ONE question:

> **Can the ZA141251SA mission produce legitimate, verified, received USD revenue from real-world opportunities while the owner is in Pakistan?**

Success = real money received in Payoneer/bank, independently verified, entering mission treasury.
Failure = infrastructure works but no real opportunity converts to paid work within the pilot window.

Neither outcome is a code defect. Both are valid results.

---

## SELECTED PILOT PATHS (3 paths, minimum viable)

### PATH A: Bug Bounty — HackerOne

| # | Field | Detail |
|---|-------|--------|
| 1 | **Platform** | HackerOne |
| 2 | **Official signup URL** | https://hackerone.com/users/sign_up |
| 3 | **Account type** | Individual researcher (free) |
| 4 | **KYC requirements** | Government-issued photo ID via Veriff (12-month validity); W-8BEN tax form (non-US taxpayer); bank account details for payout |
| 5 | **Payout method** | Bank wire (SWIFT) to Pakistani bank account — confirmed available for PK residents |
| 6 | **Exact owner action** | Create account → Complete Veriff identity verification → Submit W-8BEN → Add Pakistani bank account as payout method → Browse public programs → Select scope → Authorize testing |
| 7 | **Human participation mandatory?** | ✅ YES for: account creation, identity verification, scope acceptance, report submission, disclosure coordination, payout withdrawal |
| 8 | **What agents CAN legitimately automate** | (a) Research public programs and their scope/rules, (b) Analyze target technology stack from public information, (c) Run static analysis on authorized public endpoints, (d) Draft vulnerability reports with evidence, (e) Verify findings against known vulnerability patterns, (f) Prepare proof-of-concept documentation, (g) Cross-reference with CVE databases |
| 9 | **What agents MUST NOT automate** | (a) Account creation/KYC, (b) Actual report submission to HackerOne, (c) Active exploitation beyond authorized scope, (d) Denial-of-service testing, (e) Accessing/storing user data, (f) Public disclosure before program authorization, (g) Testing out-of-scope assets |
| 10 | **Required AKBARAL/ZA141251SA config** | `GOOGLE_API_KEY` set (for AI research); Security-focused agents provisioned with `web_search`, `page_fetch`, `code_repository_read` tools; Owner's HackerOne credentials stored in mission vault; Bounty program scope stored as owner-authorized configuration |
| 11 | **How received money is verified** | (a) HackerOne sends bank wire to Pakistani bank → (b) Owner confirms receipt in bank statement → (c) Owner records: bounty ID, program name, gross amount, date received → (d) `verifySettlementAgainstProvider()` validates against payout slot + external bank reference |
| 12 | **How it enters Mission Treasury** | Settlement verified → `reconcileSettlement()` updates opportunity state to `settlement_verified` → Net amount enters `mission_earning_ledger` → Treasury records verified USD receipt → ONLY NOW counted as mission revenue |
| 13 | **Setup complexity** | **Medium** — Account creation (15 min) + Veriff KYC (1-3 days) + W-8BEN (10 min) + bank account setup (10 min). Total: ~1 week for full verification. |
| 14 | **Exact blocker** | **None** — Pakistan eligible, bank wire available, free account. Owner must complete Veriff identity verification before any payout. |

---

### PATH B: Digital Products — Gumroad

| # | Field | Detail |
|---|-------|--------|
| 1 | **Platform** | Gumroad |
| 2 | **Official signup URL** | https://gumroad.com/signup |
| 3 | **Account type** | Creator (free — 10% platform fee on sales) |
| 4 | **KYC requirements** | Government-issued photo ID + proof of residence in Pakistan; tax documentation (W-8BEN for non-US); local bank account for PKR payout |
| 5 | **Payout method** | Direct bank deposit in PKR (Pakistan Rupees) — confirmed in Gumroad official Help Center payout country list |
| 6 | **Exact owner action** | Create account → Upload photo ID + residence proof → Complete tax form → Add Pakistani bank account → Create product listing (manual) → Set price in USD → Publish → Handle customer support/refunds (human) → Receive PKR payouts on Tuesdays |
| 7 | **Human participation mandatory?** | ✅ YES for: account creation, product listing/publishing, pricing decisions, customer support, refund handling |
| 8 | **What agents CAN legitimately automate** | (a) Research profitable product ideas via web search, (b) Create product content: technical guides, code templates, automation scripts, data analysis reports, API documentation packs, (c) Write product descriptions and marketing copy, (d) Generate preview/sample content, (e) Research competitor pricing, (f) Build digital products: spreadsheets, checklists, technical ebooks, code snippet libraries |
| 9 | **What agents MUST NOT automate** | (a) Account creation, (b) Product listing/publishing (human clicks publish), (c) Pricing decisions (owner judgment), (d) Customer communication/refunds, (e) Claiming authorship of AI-generated content without disclosure, (f) Spam/promotion outside platform rules |
| 10 | **Required AKBARAL/ZA141251SA config** | `GOOGLE_API_KEY` set; Content-creation agents provisioned with `web_search`, `knowledge_search`, `file_parse_text`, `code_repository_read` tools; Gumroad credentials stored in mission vault; Product type and pricing strategy stored as owner-authorized configuration |
| 11 | **How received money is verified** | (a) Gumroad processes sale → (b) PKR deposited to Pakistani bank on Tuesday payout day → (c) Owner confirms receipt in bank statement → (d) Owner records: sale ID, product name, gross USD amount, PKR received, date, fees → (e) `verifySettlementAgainstProvider()` validates against payout slot |
| 12 | **How it enters Mission Treasury** | Settlement verified → `reconcileSettlement()` updates opportunity state → Net amount enters `mission_earning_ledger` → Treasury records verified receipt |
| 13 | **Setup complexity** | **Low** — Account creation (10 min) + ID verification (1-2 days) + bank account (5 min). First product can be listed same day. |
| 14 | **Exact blocker** | **None** — Pakistan confirmed in Gumroad's official bank payout list. No upfront cost. 10% platform fee applies to sales only. |

---

### PATH C: Affiliate Content — Awin

| # | Field | Detail |
|---|-------|--------|
| 1 | **Platform** | Awin (affiliate network) |
| 2 | **Official signup URL** | https://www.awin.com/gb/publishers |
| 3 | **Account type** | Publisher (free — £5 one-time verification deposit, refunded with first commission) |
| 4 | **KYC requirements** | Identity verification + payment details; website/blog or content platform where affiliate links will be published |
| 5 | **Payout method** | Payoneer (confirmed for Pakistan) or bank wire |
| 6 | **Exact owner action** | Apply as publisher → Pay £5 verification deposit (refunded) → Verify identity → Get approved → Apply to advertiser programs → Create content with affiliate links → Track clicks/conversions → Receive commission via Payoneer |
| 7 | **Human participation mandatory?** | ✅ YES for: account enrollment, FTC/local disclosure compliance, content approval, program applications |
| 8 | **What agents CAN legitimately automate** | (a) Research high-commission affiliate programs, (b) Create SEO-optimized content with legitimate affiliate links, (c) Generate product comparison articles, (d) Build technical review content, (e) Research trending products/categories, (f) Create email newsletter content with affiliate links, (g) Track and analyze conversion data |
| 9 | **What agents MUST NOT automate** | (a) Account creation, (b) Fake clicks or click fraud, (c) Cookie stuffing, (d) Misleading claims about products, (e) Spam distribution of affiliate links, (f) Self-referral (buying through own links), (g) Publishing without proper affiliate disclosure |
| 10 | **Required AKBARAL/ZA141251SA config** | `GOOGLE_API_KEY` set; Content/SEO agents provisioned with `web_search`, `page_fetch`, `knowledge_search` tools; Awin API key (after account approval) stored in mission vault; Content website/blog must exist or be created |
| 11 | **How received money is verified** | (a) Awin processes commission → (b) Payoneer receives funds → (c) Owner withdraws to Pakistani bank → (d) Owner confirms receipt → (e) Settlement verified via `verifySettlementAgainstProvider()` |
| 12 | **How it enters Mission Treasury** | Settlement verified → Net commission enters `mission_earning_ledger` → Treasury records receipt |
| 13 | **Setup complexity** | **Medium** — Application (15 min) + verification (1-3 days) + content website needed + program approval (variable). First commission may take weeks of content creation. |
| 14 | **Exact blocker** | **Requires a content platform** (blog/website/social media) where affiliate links can be legitimately published. No content platform = no legitimate affiliate earnings. Also requires £5 deposit (refunded). |

---

## PILOT AGENT SELECTION (Minimum: 5 agents)

| # | Agent Role | Domain | Specialization | Purpose |
|---|-----------|--------|---------------|---------|
| 1 | **Pilot Coordinator** | enterprise-operations | strategist | Coordinate pilot activities, track progress, report to owner |
| 2 | **Security Researcher** | security | security-analyst | Bug bounty: authorized vulnerability research within scope |
| 3 | **Security Analyst** | security | risk-analyst | Bug bounty: risk assessment, finding prioritization, report drafting |
| 4 | **Content Creator** | writing | content-strategist | Gumroad: research product ideas, create digital product content |
| 5 | **SEO/Research Agent** | seo | seo-specialist | Awin/Gumroad: research profitable niches, SEO content, product descriptions |

**Why only 5:**
- Minimum needed to cover all 3 pilot paths
- Each agent has distinct capabilities matching specific opportunity requirements
- Owner can directly supervise 5 agents without coordination overhead
- If pilot succeeds, scale to 20-50 agents in earning-relevant domains

**All 5 agents require:**
- Active status in mission DB
- Active money grant (provisioned by owner)
- Explicit tool permissions (no blanket access)
- Activity allow-list alignment

---

## STRICT PHASED SEQUENCE

### PHASE 1 — Owner Account Setup (Week 1)

**Goal:** Create real accounts on selected platforms. No agents involved yet.

| Step | Action | Time | Verification |
|------|--------|------|-------------|
| 1.1 | Create **Payoneer** account with CNIC | 15 min | Account active, receiving accounts visible |
| 1.2 | Link Payoneer to Pakistani bank account | 10 min | Test withdrawal of PKR 1 successful |
| 1.3 | Create **HackerOne** researcher account | 15 min | Account active |
| 1.4 | Complete HackerOne Veriff identity verification | 1-3 days | KYC approved |
| 1.5 | Submit HackerOne W-8BEN tax form | 10 min | Tax form approved |
| 1.6 | Add Pakistani bank as HackerOne payout method | 10 min | Payout method verified |
| 1.7 | Create **Gumroad** creator account | 10 min | Account active |
| 1.8 | Complete Gumroad ID + residence verification | 1-2 days | Verification approved |
| 1.9 | Add Pakistani bank for PKR payout on Gumroad | 5 min | Bank details confirmed |
| 1.10 | (Optional) Apply to **Awin** as publisher | 15 min | Application submitted |

**PHASE 1 GATE:** All accounts created and verified. Payoneer tested. No agent activity yet.

---

### PHASE 2 — Provider/Model Setup (Day 1)

**Goal:** Enable real AI execution for agents.

| Step | Action | Time | Verification |
|------|--------|------|-------------|
| 2.1 | Get free `GOOGLE_API_KEY` from Google AI Studio | 5 min | Key valid, Gemini API responds |
| 2.2 | Set `GOOGLE_API_KEY` in environment | 2 min | `ModelRouter.complete()` succeeds |
| 2.3 | (Optional) Set up Brevo free SMTP | 10 min | Email sending works |
| 2.4 | Verify `ModelRouter` fallback chain works | 5 min | Test query returns response |

**PHASE 2 GATE:** AI execution confirmed working. No paid API keys required.

---

### PHASE 3 — Opportunity Verification (Week 2)

**Goal:** Identify specific, authorized opportunities within platform rules.

| Step | Action | Path | Verification |
|------|--------|------|-------------|
| 3.1 | Browse HackerOne public programs — select 2-3 with broad scope | A | Programs selected, scope documented |
| 3.2 | Verify each program allows testing from Pakistan | A | Program rules checked |
| 3.3 | Document authorized scope for each program | A | Scope stored as owner-authorized config |
| 3.4 | Research profitable Gumroad product categories | B | 3-5 product ideas identified |
| 3.5 | Verify product ideas are legitimate (no IP infringement) | B | Ideas validated against official sources |
| 3.6 | (If Awin approved) Browse advertiser programs | C | Programs selected, commission rates documented |

**PHASE 3 GATE:** Specific authorized opportunities identified. No agent work yet. Owner has reviewed and approved each opportunity.

---

### PHASE 4 — Limited Agent Provisioning (Week 2)

**Goal:** Provision exactly 5 agents with scoped permissions.

| Step | Action | Verification |
|------|--------|-------------|
| 4.1 | Run `npm run mission:sync-registry` (or manually create 5 agents) | 5 agents exist in mission DB |
| 4.2 | Provision money grants for each agent | Each agent has active grant |
| 4.3 | Set tool permissions per agent (no blanket access) | Tool allow-list verified |
| 4.4 | Set activity allow-list per agent | Activity gate verified |
| 4.5 | Test agent can execute a trivial task (e.g., web search) | Agent completes task successfully |

**PHASE 4 GATE:** 5 agents active, scoped, tested. No opportunity assignment yet.

---

### PHASE 5 — First Legitimate Work (Weeks 2-4)

**Goal:** Agents perform real work within authorized scope. Owner reviews everything.

#### Bug Bounty Work (Path A):

| Step | Who | Action | Verification |
|------|-----|--------|-------------|
| 5.1 | Agent | Research authorized program scope and technology stack | Owner reviews research output |
| 5.2 | Agent | Analyze public endpoints for potential vulnerabilities | Owner reviews analysis |
| 5.3 | Agent | Draft vulnerability report with evidence | Owner reviews draft |
| 5.4 | **Owner (HUMAN)** | Reviews report, verifies within scope, submits to HackerOne | Submission confirmed |
| 5.5 | **Owner (HUMAN)** | Manages triage communication with program | Updates tracked |

#### Digital Product Work (Path B):

| Step | Who | Action | Verification |
|------|-----|--------|-------------|
| 5.6 | Agent | Research profitable product category and create content draft | Owner reviews content |
| 5.7 | Agent | Build digital product (template, guide, tool) | Owner reviews product |
| 5.8 | **Owner (HUMAN)** | Reviews product quality, legality, originality | Quality gate passed |
| 5.9 | **Owner (HUMAN)** | Creates Gumroad listing, sets price, publishes | Listing live on Gumroad |

#### Affiliate Work (Path C, if approved):

| Step | Who | Action | Verification |
|------|-----|--------|-------------|
| 5.10 | Agent | Research advertiser programs, create SEO content with affiliate links | Owner reviews content |
| 5.11 | **Owner (HUMAN)** | Reviews content for accuracy, disclosure compliance, publishes | Content live with disclosure |

**PHASE 5 GATE:** Real work performed, owner-approved. Bug bounty report submitted. Digital product listed. No money yet.

---

### PHASE 6 — Payment Receipt Verification (Weeks 4-12+)

**Goal:** Verify that real money is received. This is the critical test.

#### If Bug Bounty Pays:

| Step | Action | Verification |
|------|--------|-------------|
| 6.1 | HackerOne accepts bounty → initiates bank wire | Bounty status: "Resolved" |
| 6.2 | Bank wire arrives in Pakistani bank (2-5 business days) | Bank statement shows credit |
| 6.3 | Owner confirms: amount, date, reference, program name | Owner attestation recorded |
| 6.4 | `verifySettlementAgainstProvider()` validates | Settlement row created |
| 6.5 | Opportunity state → `settlement_verified` | Ledger updated |

#### If Gumroad Sells:

| Step | Action | Verification |
|------|--------|-------------|
| 6.6 | Customer purchases product on Gumroad | Gumroad dashboard shows sale |
| 6.7 | Gumroad processes PKR payout on Tuesday | Bank statement shows PKR credit |
| 6.8 | Owner confirms: sale ID, gross USD, fees, net PKR, date | Owner attestation recorded |
| 6.9 | `verifySettlementAgainstProvider()` validates | Settlement row created |
| 6.10 | Opportunity state → `settlement_verified` | Ledger updated |

#### If No Payment Received:

| Step | Action |
|------|--------|
| 6.11 | Document why: no valid bounty found, no sales, program rejected report, etc. |
| 6.12 | This is a VALID outcome — the pilot tested whether real earning works |
| 6.13 | Analyze what needs to change: different programs, different products, more time |
| 6.14 | Do NOT fabricate revenue to make the pilot "succeed" |

**PHASE 6 GATE:** Either (a) real money received and verified, or (b) clear documentation of why no money was received. Both are valid outcomes.

---

### PHASE 7 — Treasury Settlement (After Phase 6 success)

**Goal:** Verified money enters mission treasury. Only now is it "mission revenue."

| Step | Action | Verification |
|------|--------|-------------|
| 7.1 | `reconcileSettlement()` completes | Opportunity → `settlement_verified` |
| 7.2 | Net USD recorded in `mission_earning_ledger` | Ledger entry with settlement reference |
| 7.3 | Treasury balance updated | `treasury.total_verified_usd` increases |
| 7.4 | Owner analytics updated (mission revenue excluded from platform) | `missionRevenue: 'excluded'` |
| 7.5 | Audit trail complete | Every step traceable in mission audit log |

**PHASE 7 GATE:** Real, verified, received USD is now in mission treasury. This is the FIRST real mission revenue.

---

### PHASE 8 — Scale ONLY After Verified Success

**Prerequisites for scaling (ALL must be true):**

- [ ] At least $1 of real, verified, received USD in mission treasury
- [ ] Settlement verification completed independently
- [ ] Owner has confirmed bank receipt matches mission records
- [ ] No safety gate was bypassed during pilot
- [ ] All agent work was within authorized scope
- [ ] All human-only actions were performed by owner
- [ ] Audit trail is complete and unbroken

**If all prerequisites met:**

| Scale Step | Action |
|-----------|--------|
| 8.1 | Provision 15-20 more agents in earning-relevant domains |
| 8.2 | Expand to additional platforms: Bugcrowd, Freelancer.com, Kaggle, Devpost |
| 8.3 | Create more Gumroad products based on pilot learnings |
| 8.4 | Apply to more HackerOne programs |
| 8.5 | Consider Toptal application (if owner has qualifying experience) |
| 8.6 | Continue verifying each dollar independently before treasury entry |

**If prerequisites NOT met:**

| Action | Reason |
|--------|--------|
| Do NOT scale | Infrastructure unproven |
| Analyze failure | What blocked revenue? Platform rejection? No findings? No sales? |
| Adjust strategy | Different programs, different products, different approach |
| Re-pilot | Try again with corrected approach |
| Accept result | The pilot answered its question honestly |

---

## WHAT THIS PILOT DOES NOT DO

| Not Done | Reason |
|----------|--------|
| ❌ Provision 4,001 agents | Pilot uses 5 agents — scale after proof |
| ❌ Estimate income | No revenue projections — real money or nothing |
| ❌ Automate bidding/listing | All human-only actions remain human |
| ❌ Create fake accounts | Every account is real, owner-operated |
| ❌ Bypass KYC | Full KYC on every platform |
| ❌ Use paid APIs | Only free Google Gemini API |
| ❌ Require foreign company | All paths work with Pakistan-based owner |
| ❌ Fabricate revenue | Only verified received money enters treasury |
| ❌ Guarantee results | Pilot may produce $0 — that's a valid outcome |
| ❌ Create spam/fake content | All content is legitimate, original, disclosed |

---

## TIMELINE SUMMARY

| Phase | Week | Activity | Money Expected |
|-------|------|----------|----------------|
| Phase 1 | Week 1 | Owner creates accounts (Payoneer, HackerOne, Gumroad) | $0 |
| Phase 2 | Week 1 | Set `GOOGLE_API_KEY`, verify AI works | $0 |
| Phase 3 | Week 2 | Identify authorized opportunities | $0 |
| Phase 4 | Week 2 | Provision 5 agents with scoped permissions | $0 |
| Phase 5 | Weeks 2-4 | Agents perform real work, owner submits/publishes | $0 |
| Phase 6 | Weeks 4-12+ | Wait for payment (bounty or sales) | $0 or real USD |
| Phase 7 | After Phase 6 | Verified money enters treasury | Real USD |
| Phase 8 | After Phase 7 | Scale if and only if verified success | N/A |

**Total setup cost: $0** (excluding optional £5 Awin deposit, refunded)
**Total time to first work attempt: ~2 weeks**
**Total time to first possible payment: ~4-12 weeks** (depends on bounty acceptance or product sales)

---

## RISK ACKNOWLEDGMENT

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| No valid bug bounty found | High | Try multiple programs, broaden research |
| Bug bounty report rejected | Medium | Follow program rules precisely, quality reports |
| No Gumroad sales | High | Create quality products, realistic pricing, patience |
| KYC verification delayed | Medium | Complete early, follow up |
| Bank wire delayed | Low | SWIFT is reliable, 2-5 business days |
| Agent work quality insufficient | Medium | Owner reviews ALL output before submission |
| Pilot produces $0 | Possible | Valid outcome — infrastructure verified, earning not yet |

---

## DECISION TREE

```
PILOT START
    │
    ├── Phase 1-4: Setup (owner actions + config)
    │
    ├── Phase 5: Real work performed
    │
    ├── Phase 6: Did real money arrive?
    │       │
    │       ├── YES → Phase 7: Treasury settlement
    │       │           │
    │       │           └── Phase 8: Scale (prerequisites met)
    │       │
    │       └── NO → Document why
    │                   │
    │                   ├── Fixable? → Adjust & re-pilot
    │                   │
    │                   └── Structural? → Accept result, preserve infrastructure
    │
    └── AT NO POINT: fabricate revenue, bypass safety, or claim success without verification
```

---

*Pilot plan designed 2026-09-23. No code modified. No accounts created. No income promised. Every step requires real owner action. Every dollar must be independently verified before entering treasury.*
