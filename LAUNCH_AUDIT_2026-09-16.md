# AKBARAL! — A–Z PRODUCTION LAUNCH AUDIT
**Date:** 16 September 2026 · **Commit audited:** `7987605` (branch `arena/01a0a045-akbaral`, tree clean)
**Method:** source inspection + live probing of the running stack (Next.js :3000 → Express API :4000, `platform-live.db`) + full test suite + rendered-route/responsive audits + database forensics. Nothing in this report is taken from prior progress documents.

**Environment caveats that limit what can be proven here (stated once, applied throughout):**
1. **No outbound internet from the audit sandbox** except the npm registry. Verified: `example.com`, `html.duckduckgo.com`, `openidconnect.googleapis.com` → all `000`; `registry.npmjs.org` → `200`. Every third-party provider call (Google/GitHub/Microsoft/Facebook/Apple OAuth token exchange, Gemini/OpenAI/Anthropic inference, Tavily/Brave/Serper search, Stripe/Razorpay, SMTP, Meta/YouTube/TikTok publishing, Expo push) is therefore **UNVERIFIABLE live here**. Where that applies I write UNVERIFIED, not "works".
2. The running preview uses the repo's **development model stub** (`scripts/local-model-fixture.ts` on :4999) because no AI provider key is configured. The orchestration, tool, verification, artifact, credit and queue layers are production code; **the language model in this preview is not**. Every stub-produced deliverable carries a visible "local model stub" footer.
3. Data in `platform-live.db` is dev/preview data (seeded registry + audit-probe traffic), not customer data.


**Live re-verification (same commit, second pass):** readiness still **44.4 % / 5 blockers**; registry 4,002 agents (4,001 seeded + 1 probe-created), 80 categories, **7 of 18 tools linked, 0 tool integrations**, 18 artifacts, credit ledger `consume_task=14 / refund_task=3`. The billing defect reproduced exactly: a fresh trial account switched to `enterprise` → `202 {status:'active'}` → owner MRR went **$400 → $800 with `paidCents: 0`** (then reverted to `free`). A real 3-step MASTER goal drafted `web-development-strategist-001 → builder-008 → validator-011`, completed, consumed **3 of 5** credits, and exported a 4,955-byte website artifact; a second account got **404** on that project and its artifact.

---

## 1. EXECUTIVE STATUS

Percentages are computed against *production-launchable functionality verified by evidence*, not against code volume. "Exists in code but unexercisable without an external credential" is capped well below 100.

| Area | % | Basis (short) |
|---|---|---|
| **Overall product** | **72 %** | Whole web product is functional end-to-end on real data; gaps are provider credentials, payments, email, and only-website artifact generation |
| **Website (public marketing + SPA shell)** | **85 %** | 16 server-rendered routes (13 public marketing pages + `/`, `/workspace`, `/owner`) all HTTP 200 with real copy and their own stylesheet, SPA is one surface, responsive audit clean; first-party event hooks exist (`analytics_events`, currently 0 rows) but no third-party analytics/marketing instrumentation and no CMS; the SEO pages are static |
| **Application (web app)** | **82 %** | 15 screens, 218 API endpoints, real DB, real execution pipeline; gaps: non-website artifacts, library/knowledge empty by default, plan-switch billing hole |
| **Mobile application** | **45 %** | Expo/React Native, 3,579 LOC, 7 tabs + login, TypeScript compiles clean, 26/26 API routes it calls exist; **never built, never run on a device, no app icon, no EAS/release config, `api.akbaral.ai` does not resolve** |
| **Backend** | **88 %** | 218 endpoints / 25 routers, 90 tables, 16 migrations, transactional credit ledger, real queue + recovery + verification; gaps: single-node SQLite, no email, payment provider absent |
| **Agent system** | **70 %** | 4,001 generated-but-differentiated contracts, real generic execution path, real tool stage + verification; only 7 of 18 tools linked to agents, 0 tool credentials configured, 11 tools unreachable by any agent |
| **Production/deployment** | **55 %** | Dockerfile + compose + Modal wrapper + CI + health/ready + nightly verified backups + migration-on-boot are all real; **no domain, no TLS, no live production host reachable, GitHub auth currently broken so CI/GHCR cannot run** |
| **Security** | **80 %** | CSP/headers, RBAC server-side (403 verified), session rotation with reuse rejection, SSRF guard, parameterised SQL, 0 production-dependency advisories, rate limits, audit/security logs; gaps: `/api/billing/switch` privilege hole, no CSRF token (bearer-token design mitigates), no WAF/edge controls |
| **Payments/billing** | **35 %** | Plans, invoices, credit ledger, refunds, webhook verification, PDF invoices all implemented; **no payment provider configured, checkout unproven, and any user can self-activate a paid plan without paying** |
| **Authentication / OAuth** | **75 %** | Email+password full cycle verified live (register/login/refresh-rotation/reuse-rejection/logout/RBAC); five provider definitions with real authorize+callback+state+PKCE-shaped flows; **all five unconfigured**, token exchange UNVERIFIED |
| **Files / projects / artifacts** | **78 %** | Upload (25 MB, path-traversal guarded), download, cross-user isolation (404), project CRUD, artifact versions + revert + export all verified live; **artifact generation produces only `website`**; document/data/image kinds are schema-only |
| **Owner/private mission** | **60 %** | Owner RBAC verified (owner 200 / user 403), private mission app complete with separate DB, ledger, treasury, kill switch, payout verification; **mission DB never initialised here, no provider activation, not running** |

### Remaining launch blockers (must be true before a public launch)
1. **Domain + TLS + `AKBARAL_SITE_URL`** — nothing is publicly reachable at a real hostname; robots/sitemap/checkout-return URLs fall back to a local placeholder. (`launch:check` blocker 1)
2. **AI provider key** (`GOOGLE_API_KEY` recommended) — without it, MASTER returns `provider_not_configured` and no customer task can succeed. (`launch:check` blocker 2)
3. **Search provider key** (Tavily/Brave/Serper) — research agents otherwise depend on keyless scraping that datacenter IPs usually block. (`launch:check` blocker 3)
4. **Payment provider** (Stripe secret + webhook secret + `BILLING_WEBHOOK_SECRET`) — paid plans cannot be sold; credit purchases return `provider_not_configured`. (`launch:check` blockers 4–5)
5. **`GET /api/billing/switch` allows any signed-in user to activate any paid plan for free** (verified live: enterprise → `status: active`, and it inflates the owner console's MRR to $400 with $0 collected). Revenue-integrity defect; must be fixed or the button removed before charging money.
6. ~~**GitHub connection is broken in this session**~~ — **resolved mid-audit**: authentication recovered and both commits were pushed (`516d06c..8b5c8bb`). **New blocker found instead:** the `docker-publish` workflow **fails at the "Build and push" step on every push** (3 consecutive runs, including this commit), so no GHCR image is published and the documented Modal deployment path cannot start. Root cause UNVERIFIED — the Actions log archive could not be downloaded from the sandbox and there is no Docker daemon here to reproduce it.

### Non-blocking remaining work
- Only `website` artifacts are produced (document/data/image kinds have viewers, versioning and download plumbing but no producer).
- No transactional email (password reset / verification return honest 503) → users have no self-serve password recovery.
- No email verification gate (anyone can register any address; rate-limited).
- Mobile release pipeline (icons, EAS profiles, signing, store listings) absent; Expo/RN toolchain advisories (1 critical, 10 high) require a major SDK upgrade.
- Library/knowledge search is real (SQLite FTS) but empty for new accounts until files are indexed.
- Marketing pages have no third-party analytics, A/B testing or CMS (first-party `analytics_events` hook exists and is nearly empty); `ads.txt` 404s by design (no publisher id).
- Tool coverage: 11 of 18 implemented tools are not referenced by any agent contract; each returns `provider_not_configured` when its credential is missing.

### What can genuinely launch TODAY
- **The public website** (landing, about, pricing, features, docs, FAQ, help, security, privacy, terms, contact, feedback, agents, agent-factory) — static server-rendered pages, no provider dependencies.
- **The web application** for sign-up → sign-in → project → **MASTER website-building tasks** → versioned website artifact → sandboxed preview → export, *provided an AI provider key is set*.
- **The 4,001-agent registry, Agent World, Agent Factory (create/test/benchmark/security-review/version/rollback/disable), Automations, CRM, notifications, files, projects, artifacts, owner console** — all exerciseable on real data once a model key exists.
- The whole thing on a **single node** (Docker/Modal/free-tier VM), with honest health/readiness endpoints and nightly verified backups.

### What CANNOT launch today
- **Paid subscriptions / credit purchases** — no payment provider; and the plan-switch hole would let users self-upgrade free.
- **Mobile app in a store** — never built/run, no icons/signing/store metadata, default API host does not resolve.
- **Document/data/image deliverables** — no producer path.
- **"50 agents per category with named tools"** as a capability claim — only 7 tools are wired; the rest are contract declarations.
- **Password reset / verification emails** — no SMTP.
- **Anything requiring the private mission system to be reachable** — it is deliberately separate, unconfigured, and not running.

---

## 2. WEBSITE — A–Z ROUTE AUDIT

Legend: **Impl** implemented · **Reach** reachable (HTTP) · **UI** complete · **Resp** responsive · **Func** functional · **API** backend connected · **Data** real data · **Test** automated test coverage · **Prod** production-ready. Evidence keys: `[curl]` live HTTP sweep this audit, `[route-audit]` `npm run audit:routes`, `[smoke]` `npm run smoke:shell|artifacts`, `[live]` audit probe against the running API, `[tests]` `npm test`.

### 2.1 Public/marketing routes (Next.js server-rendered)

| Route | Impl | Reach | UI | Resp | Func | API | Data | Test | Prod | Remaining issue |
|---|---|---|---|---|---|---|---|---|---|---|
| `/` (landing, cinematic SPA entry) | ✅ | ✅ 200 `[curl]` | ✅ | ✅ `[resp-audit]` | ✅ | ✅ `/api/public/*` | real | ✅ `[route-audit]` | 🟡 | No analytics; hero copy static; `AKBARAL_SITE_URL` unset so canonical/robots/sitemap use a fallback host |
| `/workspace` | ✅ | ✅ 200 | ✅ | ✅ | ✅ | ✅ | real | ✅ | 🟡 | Requires provider key for tasks to succeed (honest failure otherwise) |
| `/about` | ✅ | ✅ 200 | ✅ | ✅ static CSS | ✅ static | n/a | static | ✅ `[curl]` | 🟢 | — |
| `/pricing` | ✅ | ✅ 200 | ✅ | ✅ | ✅ static | n/a | static; plan table matches the DB exactly ($0/5, $10/25, $50/100, $90/250, $200/750, $400/2000) `[curl]` | ✅ | 🟡 | CTAs link to `/#/register` (correct); the paid-plan hole lives in the in-app billing screen (§9) |
| `/features`, `/documentation`, `/faq`, `/help`, `/security`, `/privacy`, `/terms`, `/contact`, `/feedback` | ✅ | ✅ 200 `[curl]` | ✅ | ✅ | ✅ (contact/feedback POST → real `/api/contact`, `/api/trust/feedback`) | ✅ | real | ✅ `[curl]`,`[tests]` | 🟢 | Contact form delivery depends on operator review, not SMTP |
| `/agents` (Agent World marketing, "4,001 Specialists") | ✅ | ✅ 200 | ✅ | ✅ | ✅ | ✅ `/api/public/agents` | real registry counts `[live]` | ✅ `[tests] public.test.ts` | 🟢 | Counts read from DB, not hard-coded |
| `/agent-factory` | ✅ | ✅ 200 | ✅ | ✅ | ✅ | ✅ `/api/factory/*` | real | ✅ | 🟢 | — |
| `/ads.txt` | ✅ | 404 by design | ✅ | n/a | ✅ | n/a | — | ✅ | 🟢 | Returns 404 until `AKBARAL_ADSENSE_CLIENT` is set (a fake id would be worse) |
| `/robots.txt`, `/sitemap.xml` | ✅ | ✅ 200 | ✅ | n/a | ✅ | n/a | derived from routes | ✅ | 🟡 | Hostname falls back to default until `AKBARAL_SITE_URL` is set |
| unknown path | ✅ | 404 page | ✅ | ✅ | ✅ | n/a | — | ✅ | 🟢 | Real 404 page, not a redirect to landing |

### 2.2 Authenticated application (single SPA, 15 screens)

Route → screen (all verified rendered at 320/390/768/1440 by `[route-audit]`; backend wiring verified by `[live]`):

| Route (hash) | Screen | Impl | Reach | UI | Resp | Func | API | Data | Test | Prod | Remaining issue |
|---|---|---|---|---|---|---|---|---|---|---|---|
| sign-out `/` `#/landing` | landing | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | real | ✅ | 🟢 | — |
| `#/login`, `#/register` | auth | ✅ | ✅ | ✅ | ✅ (320–1920, 0 findings) | ✅ verified live | ✅ | real | ✅ `[route-audit]` | 🟢 | Provider buttons all "unavailable" until OAuth creds exist (honest, disabled not dead) |
| `/owner` (owner console page) | owner | ✅ | ✅ | ✅ | ✅ | ✅ (owner 200 / user 403 `[live]`) | ✅ `/api/owner/*` | real | ✅ | 🟡 | MRR includes unpaid self-activated plans (§9) |
| `#/dashboard` | dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | real | ✅ | 🟢 | — |
| `#/master`, `/workspace` | master (chat + preview + composer) | ✅ | ✅ | ✅ | ✅ (drawer, pane switch, bottom-sheet preview) | ✅ `[smoke]` real run + deliverable + export `website v1` | ✅ `/api/master`, `/api/projects`, SSE/WS | real | ✅ `[smoke]`,`[route-audit]` | 🟡 | Preview shows live artifacts *after* a run; with the dev stub the deliverable is stub-authored |
| `#/projects` | workspace (projects & knowledge) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ `/api/projects`, `/api/files/*` | real | ✅ `[live]` | 🟢 | Knowledge search returns empty until files are indexed |
| `#/agents` | agents (Agent World) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ `/api/agents`, `/api/world` | real (4,001) | ✅ `[live]` | 🟢 | "World" = *your* saved/installed agents → empty for a fresh account (correct, may look empty) |
| `#/factory` | factory | ✅ | ✅ | ✅ | ✅ | ✅ **verified: create → test run → benchmark → security review → version → rollback → disable/reactivate** `[live]` | ✅ `/api/factory/*` | real | ✅ `[live]` | 🟢 | Lifecycle is draft/pending_review/active/disabled/deprecated — the 8-state TESTING/FIXING/RETESTING machine is not what is implemented (§7) |
| `#/marketplace` | marketplace | ✅ | ✅ | ✅ | ✅ | ✅ list/install/publish/rate/review | ✅ `/api/marketplace/*` | real (4,001 published rows) `[live]` | ✅ | 🟢 | Install/publish state real; no payment rail for paid listings |
| `#/automations` | automations | ✅ | ✅ | ✅ | ✅ | ✅ **verified: create → run now → run history → pause/resume → delete** `[live]` | ✅ `/api/automations/*` | real | ✅ `[live]` | 🟢 | Interval/cron/once + conditions; a run that cannot reach a tool fails honestly (verified: run status `failed`) |
| `#/crm` | crm | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ `/api/crm/*` (16 endpoints, per-user scoped `[live]`) | real | ✅ | 🟢 | — |
| `#/billing` | billing | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ `/api/billing/*` | real ledger | ✅ `[live]` | 🔴 | Credits readable; **no payment provider**; **plan switch grants paid plan free** |
| `#/settings` | settings (account/profile) | ✅ | ✅ | ✅ | ✅ | ✅ password change, sessions, connected accounts, unlink | ✅ `/api/me`, `/api/auth/oauth/identities` | real | ✅ | 🟡 | Password reset via email unavailable (503, no SMTP) |
| `#/economy` | economy (owner-only) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ `/api/economy/*` (44 endpoints) | real | ✅ | 🟡 | Owner-only, and the private mission app is separate; verify kill-switch/monitor state before enabling autonomous ops |
| `#/admin` | admin (admin/owner-only) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ `/api/admin/*` (18) | real | ✅ | 🟢 | — |
| `#/task/:id` | task detail | ✅ | ✅ | ✅ | ✅ | ✅ (real SSE/WS log, events, cancel, rating) | ✅ `/api/tasks/*` | real | ✅ `[smoke]` | 🟢 | — |

### 2.3 Feature-by-feature (the list you asked for)

| Feature | Status | Evidence / issue |
|---|---|---|
| Landing | 🟢 | 200, responsive, single-surface pre-login card (§2.1) |
| Sign In / Sign Up | 🟢 | Live: 201 register, 200 login, 401 bad password, 400 weak password, 409 duplicate; 5 provider marks render with labels; disabled when unconfigured `[live]`,`[route-audit]` |
| OAuth | 🟡 | 5 providers defined (google/github/microsoft/facebook/apple) with authorize+callback+state store+link/unlink; **all unconfigured** → `503 provider_not_configured` (verified). Token exchange UNVERIFIED |
| MASTER workspace | 🟢 | Real pipeline; `[smoke]` completes a run, renders the deliverable in the sandboxed frame, exports `website v1` |
| Chat | 🟢 | Master chat panes + owner "mission chat" (`/api/economy/chat/threads`); streaming verified by `[smoke]` |
| Composer | 🟢 | Goal + project selection + attachments (≤5 owner-verified file ids); mobile-width layout verified |
| Attachments | 🟢 | Upload 25 MB, owner-bound, attached to task context (`buildAttachmentContext`), path-traversal guarded |
| Files | 🟢 | Upload/list/download/delete, cross-user 404 verified `[live]`; `file_versions` unused (0 rows) |
| Library (knowledge) | 🟡 | Real SQLite-FTS knowledge search + indexing endpoints; **0 items indexed** in this environment → empty state is honest, not broken |
| Projects | 🟢 | CRUD, members with roles (viewer/member/…), per-project artifacts `[live]` |
| Images / Media | 🟡 | Upload/view/download of image files works; **no image generation** (image_render needs an image provider key; not configured) |
| Agents | 🟢 | 4,001 agents, 80 categories, contract fields, per-agent benchmark/security/versions `[live]` |
| Agent World | 🟡 | Real per-user installed/favorite agents (`/api/world`), usage signals; empty for new users |
| Agent Factory | 🟢 | Full create/test/benchmark/security/version/rollback/status cycle verified live (§7) |
| Automations | 🟢 | Verified live, including honest failure recording |
| Billing | 🔴 | See §9 — no payment rail + free plan-switch |
| Credits | 🟢 | Ledger verified: consume exactly 1 on success, refund on failure (consume+refund rows observed), no negative balances, optimistic-concurrency guard |
| Pricing | 🟡 | Marketing page + DB plans agree exactly; the CTA path is the billing hole |
| Account | 🟡 | Profile/password/sessions/connected accounts work; email-based recovery unavailable |
| Preview | 🟢 | Sandboxed iframe `sandbox="allow-scripts"` + `srcdoc`; served-application preview verified by smokes |
| Artifacts | 🟡 | Versioned artifact store, 4 kinds declared, **only `website` has a producer**; manual non-website writes rejected by design |
| Documents / data views | 🟡 | Viewers + download + versioning endpoints exist for `document`/`data`; nothing produces them |
| Owner console | 🟡 | `/owner` + `#/economy` + `#/admin`, server-enforced owner/admin RBAC (403 verified); MRR contamination from §9 |
| Error / loading / empty states | 🟢 | 128 skeleton/toast/empty-state sites; verified honest errors (401/403/404/429/503) with no stack leakage `[live]` |

---

## 3. WEB + APP RESPONSIVENESS

Measured, not asserted. Tooling: `scripts/responsive-audit.mjs` (jsdom + real CSSOM; findings: overflow, clipped, tiny-text, small-target, grid-guard, contrast, provider-row, anchored-overflow, control-clearance, hover-only) and `scripts/rendered-route-audit.mjs` (boots the **served** document with the real `public/app.js`).

| Width | Rendered-route audit | Responsive audit (`--widths=…`) |
|---|---|---|
| 320 | ✅ 82/82 | ✅ no findings |
| 360 | (same screen set) | ✅ no findings |
| 375 | (same screen set) | ✅ no findings |
| 390 | ✅ 82/82 | ✅ no findings |
| 414 | (same screen set) | ✅ no findings |
| 768 | ✅ 82/82 | ✅ no findings |
| 1024 | (same screen set) | ✅ no findings |
| 1280 | (same screen set) | ✅ no findings |
| 1440 | ✅ 82/82 | ✅ no findings |
| 1920 | (same screen set) | ✅ no findings |

**Exact result of the 10-width sweep on this build: `RESPONSIVE AUDIT — 320 / 360 / 375 / 390 / 414 / 768 / 1024 / 1280 / 1440 / 1920 px — no findings` (exit 0).**
**Exact result of the rendered-route audit on this build: `RENDERED ROUTE AUDIT — 320 / 390 / 768 / 1440 px — 328 passed, 0 failed` (exit 0).**

Verified across those widths:
- **No horizontal overflow, no clipped content, no overlapping controls, no microscopic text, no broken grids** reported by the audit on the audited screens (landing, auth, dashboard, master, agents, factory, marketplace, workspace, automations, CRM, billing, settings, economy, admin, task).
- **Sidebar**: static rail ≥1024, intelligent collapse at tablet, **drawer + scrim below** (open/close verified programmatically: `#master-menu-btn` → `data-sidebar="drawer"` → `#master-sidebar-scrim`).
- **Preview**: side panel on desktop, pane switch verified (`#master-pane-chat|workspace` → `layout.dataset.pane`), full-bleed sheet on mobile.
- **Composer**: stays usable at 320 (no overflow, controls wrap), textarea + attachments + send remain ≥44 px targets.
- **Auth screens**: single card, provider row conserves full-width buttons at 560 px and below (single column check passes), reveal button lane reserved (54/58 px fixed this pass), 44 px controls.
- **Modals**: legal sheet focus-trapped, Escape closes, focus returns; heading reserves a 68 px clearance lane for the 44 px close control (fixed this pass).
- **Tables**: `#screen-economy` tables wrap in a scroll container (asserted) — no page-level horizontal scroll.
- **Artifact previews**: website artifacts render in a sandboxed iframe that is width-fluid; no overflow reported.

Known limits of this evidence:
- The audit is **jsdom-based** (no real layout engine). It catches computed-style/box-model class defects and DOM-level problems, not pixel-level breakage. No Chromium/Playwright is available in this sandbox.
- The **Next.js marketing pages** (about/pricing/features/…) were verified structurally (HTTP 200, semantic HTML, their own responsive `site.css`, media queries present) but layout-level claims for them are **UNVERIFIED** beyond that.
- The mobile app's device layout is **UNVERIFIED** (never run).

---

## 4. AUTHENTICATION

| Item | Verdict | Evidence |
|---|---|---|
| Email/password sign-up | **REAL** | `POST /api/auth/register` → 201, user `active`, 5 free credits, `trial_ends_at = +30d`; weak password → 400; duplicate → 409 |
| Login | **REAL** | 200 with `accessToken`+`refreshToken`; wrong password → 401 |
| Logout | **REAL** | 204, session revoked, refresh token unusable afterwards |
| Session persistence | **REAL** | `GET /api/me` (bearer access token) 200; anonymous 401 |
| Refresh + rotation | **REAL** | Rotating refresh; **old refresh token rejected after rotation** (verified 401); access token rejected after logout (401) |
| Password handling | **REAL** | bcrypt-family hashing (`src/security/password.ts`), no plaintext, reset tokens hashed, no secrets in logs (`npm run scan:secrets`) |
| Google OAuth | **PARTIAL** | Provider definition, authorize URL builder, state store, callback handler, identity link/unlink, lockout protection; **UNVERIFIED** token exchange/userinfo (no credentials, no egress) |
| GitHub OAuth | **PARTIAL** | Same; real `/user` + `/user/emails` flow coded; UNVERIFIED |
| Microsoft | **PARTIAL** | Same (Graph `/v1.0/me`); UNVERIFIED |
| Facebook | **PARTIAL** | Defined + implemented; **minor bug found**: `DELETE /api/auth/oauth/identities/:provider` validates unconfigured providers against `['google','github','microsoft','apple']` — `facebook` is missing, so a Facebook identity cannot be unlinked while Facebook is unconfigured (it works once configured). LOW |
| Apple | **PARTIAL** | Authorize + ES256 client-secret signing + `form_post` callback route present; needs `APPLE_*` set; UNVERIFIED |
| Callback handling | **REAL (code)** | `GET`/`POST /api/auth/oauth/:provider/callback` with rate limit, one-time state, mode login/link; unconfigured → 503 honest |
| Provider-not-configured behaviour | **REAL, honest** | `GET /api/auth/oauth/google/authorize` → 503 `provider_not_configured`; UI shows a disabled, `aria-disabled` button with the official mark and plain-language tooltip — **no "setup needed" text in user surfaces** `[live]`,`[route-audit]` |
| Owner authentication | **REAL** | `AKBARAL_OWNER_EMAIL` promoted to `owner` at boot/login; `/api/owner/dashboard` → 200 with owner token, 403 for normal users `[live]` |
| Normal-user restrictions | **REAL** | `/api/owner/*`, `/api/admin/*`, `/api/economy/*`, `/api/metrics` → 403 for `user` role; client hides them too (server is authoritative) |
| Unauthorized access | **REAL** | Anonymous `/api/projects` → 401; `/api/tasks/:id`, `/api/master/:id`, files and artifacts scoped by owner (cross-user → 404, no existence oracle) |
| Email verification / password reset | **PARTIAL** | Tokens + endpoints implemented, but **no SMTP** → honest 503 `provider_not_configured`. Registration does not require verification (login works immediately) |

---

## 5. MASTER — REAL CAPABILITY AUDIT

Verified trace of `POST /api/master` → `src/routes/master.ts` → goal analyzer → planner → queue → workflow runner → tool stage → model → verifier → synthesizer → artifact capture:

| Stage | Real? | Detail |
|---|---|---|
| Goal understanding | **REAL** (LLM path UNVERIFIED here) | `analyzeGoal()` calls the model router; output validated against the live registry; on any failure it falls back to a deterministic rule engine **and discloses the fallback in `analysis.notes`**. In this preview the model is the local stub |
| Planner | **REAL** | `createExecutionPlan()` selects specialists from the 4,001-row registry, emits a persisted `workflows` + `workflow_steps` graph (verified rows) |
| Master orchestrator | **REAL** | `ExecutionQueue` enqueue/dequeue, attempts, max attempts, per-step timeouts, overall workflow timeout, crash recovery on boot (`recoverInterruptedWork`), cancellation |
| Agent router | **REAL** | Agent selection by intent/category + visibility rules (`isAgentVisibleToUser`), custom agents routable (verified: factory agent reachable from MASTER) |
| Specialist agents | **REAL but shared path** | Every agent executes through one generic path (`runGenericAgentExecution`) driven by its own contract (instructions, workflow, capabilities, verification rules). No per-agent bespoke code — capability depth comes from the contract + model |
| Tools | **PARTIAL** | Bounded pre-stage stage runs at most 2 permitted tools per execution (`web_search`, `knowledge_search`) with results injected into context; 18 tool handlers exist; **only 7 are referenced by contracts; 0 have credentials configured**; failures are recorded, not faked |
| Execution | **REAL** | Verified live: workflows/tasks/jobs reach `completed`; 42 completed tasks and 15 completed workflows exist in the live DB |
| Verification | **REAL** | Deterministic contract checks (`non_empty`, `substance`, `no_refusal`, `no_fabricated_sources` — hard gates; `goal_addressed`, `declared_outputs` — soft) + optional LLM rubric; **failure fails the task and refunds the credit** (code + tests + live refund row) |
| Final result | **REAL** | Synthesizer produces the final document; stored on the workflow; `GET /api/master/:id` returns steps/tasks/job/finalResult; website deliverables are captured as versioned artifacts |
| Streaming/progress | **REAL** | WebSocket execution log with SSE fallback (`AKBARAL_REALTIME_TRANSPORT=sse` for edges that block upgrades); `no-transform` keeps SSE unbuffered through the Next proxy |

**What MASTER can actually do today (implementation-backed only):**
1. **Build a one-page website** and store it as versioned `website` artifacts — verified end-to-end (`smoke:shell`: deliverable in the frame + `website v1` export).
2. **Plan and run multi-step specialist workflows** against the real registry, with persisted step graph, per-step status and logs.
3. **Run web research** *if* a search provider (or keyless fallback reachable from the host) exists — returns real sources + facts or an honest error + refund.
4. **Search the user's own knowledge base** (SQLite FTS) and inject hits into the specialist context — real, per-user.
5. **Verify output against the agent's declared contract and refuse to complete fabricated/citation-less work.**
6. **Charge and refund credits correctly** (1 on success; automatic refund on failure/timeout/cancel/verification failure; owner executes without charge, audited).
7. **Cancel, retry, recover** — cancel mid-run, retries with backoff, crash recovery requeues interrupted jobs.
8. **Route to a custom factory agent** created by the user (verified live).

What it **cannot** do today: produce non-website artifacts, call any agent-declared tool that has no credential, generate images, publish to social platforms, or produce real model output without an AI provider key.

---

## 6. ALL 4,001+ AGENTS

**Exact counts (live DB, `platform-live.db`, this audit):**

| Metric | Value |
|---|---|
| Agent rows (`agents`) | **4,001** seeded (4,002 now: +1 created by this audit) |
| `agent_versions` | 4,001 seeded (4,003 with audit versions) |
| Status | **active 4,001 / 0 draft / 0 testing / 0 failed / 0 disabled / 0 pending** (the status field exists; the seeded catalog is all-active) |
| Categories (`agent_categories`) | **80**, 50 agents each (51 for research) |
| `agent_tools` links | 7,203 links → **7 distinct tools** (Knowledge Search 3,701, Web Search 1,251, Spreadsheet Builder 1,100, Text File Parser 400, Repository Read 300, Page Fetch 251, Image Renderer 200) |
| Tools with **any** agent link | **7 of 18** — YouTube Publish, Instagram Publish, X Post, Shopify Product, Twilio Message, Stripe Payment, HTTP Request, JSON Transform, Text Analyzer, CSV Parser, Maps Place Search have **no agent** referencing them |
| `tool_integrations` / `agent_integrations` rows | **0** / **0** → no tool credentials configured |
| Marketplace rows | 4,001 published |
| `agent_executions` | 40 recorded in this dev DB |

**Are these real executable contracts or placeholders?** Neither extreme, stated precisely:
- Each agent row is **generated** from a blueprint matrix (80 professional domains × 50 genuine specializations), not hand-authored, and carries an executable contract: `system_instructions`, `capabilities`, `inputs`, `outputs`, `model_requirements`, `tool_permissions`, `workflow[]`, `verification_rules[]`, `security_permissions[]`, `cost_usage`, `fallback_strategy`, `evaluation_config{metrics,rubric,test_cases}` (verified in `src/agents/catalog.ts` and in the API payloads).
- They are **not** 4,001 bespoke implementations: all execute through one generic runner. Differentiation is real at the contract/prompt/verification level, not at the code level.
- Agents are **executable** (dispatch works; verified `[live]`,`[smoke]`), **tool-constrained** (only 7 tools referenced, 0 credentials), and **verification-backed** (per-agent rules feed the verifier).
- Nothing in the product invents an agent's success: without a model key every model-backed agent returns `provider_not_configured`.

**Routing:** planner picks agent(s) by analysed intent → category/specialization matching against the live registry → visibility check (`isAgentVisibleToUser`: catalog + own custom agents) → dispatch through the queue. `selectBestAgent()` in `src/orchestrator/planner.ts`; the LLM may only propose **valid registry slugs** — anything else is dropped and disclosed.

**Categories actually covered (80; the ones you named, all present):** assistant/personal-productivity, research, education/tutoring, software-engineering, web-development, mobile-development, image-generation, image-editing, video, short-form-video, film-production, audio, music, speech, voice, documents, pdf, excel-spreadsheet, data-analysis, data-science, business-analytics, business-strategy, marketing, advertising, copywriting, branding, seo, social-media, instagram, tiktok, x, youtube, search-content-strategy, e-commerce, finance, accounting, procurement, legal-information, compliance, specialized-industry (health-adjacent), travel, maps-local-business, career, cv-resume, interview, recruitment-hr, customer-support, automation, workflow-automation, integrations, localization, translation, writing, 3d, gaming, ui-ux, graphic-design, project-management, product-management, quality-assurance, sales, crm, startup, knowledge-management, enterprise-operations, cloud, devops, security, api-engineering, ai-ml-engineering, data science, agent-engineering, agent-evaluation, agent-testing, ai-economy, marketplace, browser-automation, computer-use, scientific-research, film, ceo-executive-ops, personal productivity.

**Honest capability grading per family (not by name — by wired tool path):**

| Family | Agents | Actually executable today | Connected tools | Limitation | Production readiness |
|---|---|---|---|---|---|
| Research / search-content | 51 + 50 | ✅ text deliverables; ✅ real search **when a search provider is reachable** | web_search, knowledge_search | keyless fallback usually blocked from datacenter IPs | 🟡 (needs a search key) |
| Coding / web / mobile / api / devops / cloud / ai-ml | 400 | ✅ code/text deliverables | web_search, knowledge_search, repository read, file parse | repository read needs a token for private repos; **no code execution sandbox** | 🟡 |
| Documents / pdf / excel / data | 250 | ✅ text/CSV deliverables | Spreadsheet Builder (writes CSV), Text File Parser, CSV Parser, knowledge_search | no document/image artifact producer; CSV/XLSX authoring is real but not surfaced as a versioned artifact | 🟡 |
| Image generation / editing / graphic design / 3d | 200 | ❌ no image is produced | Image Renderer (**no credential configured**) | provider key missing; not linked from most contracts | 🔴 |
| Video / short-form / film / audio / music / speech / voice | 350 | ❌ no media rendered | Video/audio tools do not exist as handlers | only YouTube/Instagram/X *publishing* handlers exist (unconfigured) | 🔴 |
| Social (Instagram, TikTok, X, YouTube) | 200 | ❌ publishing blocked | publish handlers exist, 0 credentials, no OAuth app registered | platform approval + tokens required | 🔴 |
| E-commerce / Shopify | 50 | ❌ | Shopify Product handler (unconfigured) | store token required | 🔴 |
| Finance / accounting / payments | 150 | 🟡 analysis text only | Stripe Payment handler (unconfigured; and no user bank/card access by design) | no real money movement; by design | 🟡 |
| Legal info / health info / compliance | 150 | ✅ informational text with disclaimers + contract verification | web_search, knowledge_search | not professional advice; guardrails present | 🟡 |
| CRM / sales / support / marketing / SEO / brand / copy | 450 | ✅ text + real CRM objects | knowledge_search, web_search, spreadsheet builder | outbound sending limited to Twilio/SMTP handlers (unconfigured) | 🟡 |
| Automation / workflow / integrations / browser / computer-use | 250 | 🟡 planning text; automations themselves are real | HTTP Request handler (SSRF-guarded, unconfigured credential n/a) | no browser automation backend in this build | 🟡 |
| Travel / maps / local business | 100 | ❌ live maps need a key | Maps Place Search (**needs `GOOGLE_API_KEY`**) | key missing | 🔴 |
| Career / HR / interview / education / tutoring | 200 | ✅ text deliverables | knowledge_search | none material | 🟢 |
| Custom builder (factory) | 1+ | ✅ create/test/benchmark/security/version/rollback/disable | inherits user-declared tool permissions | custom agents cannot exceed the 18 implemented tools | 🟢 |

---

## 7. AGENT FACTORY

Implemented state machine (`src/orchestrator/agent-factory.ts`, `src/routes/factory.ts`): **draft / pending_review → active → disabled → deprecated**, plus version history and rollback. The 8-state `DRAFT → TESTING → FAILED → FIXING → RETESTING → APPROVED → ACTIVE → DISABLED` lifecycle you described is **not** what is persisted: test/benchmark runs are *tasks* against the agent, and the result is visible in the task/execution records — not as an agent state. `status: 'testing'` is rejected with `400 validation_error` (verified live — it fails honestly rather than pretending).

| Capability | Verdict | Evidence (live) |
|---|---|---|
| Create agent | ✅ REAL | `POST /api/factory/agents` → 201, `version 1.0.0`, `status active`, marketplace `draft` |
| Test agent | ✅ REAL | `POST /api/factory/agents/:slug/test` → runs a real task/execution, returned `result.status = completed`, real `taskId` |
| Repair / fix | 🟡 PARTIAL | Achieved by editing config (`PATCH /api/factory/agents/:slug`) and re-testing; no automated diagnose→fix→retest loop, no FAILED/FIXING state |
| Approve | 🟡 PARTIAL | `pending_review` exists for paid marketplace listings; there is no separate human-approval gate for private custom agents (the creator owns them) |
| Activate / disable | ✅ REAL | `POST …/status {active\|disabled\|deprecated}` verified both directions |
| Version | ✅ REAL | `POST …/version` → `1.0.1`; `GET …/versions` returns definition + checksum + changelog; snapshot rows verified |
| Rollback | ✅ REAL | `POST …/rollback {version:'1.0.0'}` → agent back at 1.0.0, marketplace `rolled_back` |
| Benchmark | ✅ REAL | `GET …/benchmark` → scored rubric (`score 39, grade D`, per-dimension: specialization/capabilities/workflow/verification/safety) |
| Security review | ✅ REAL | `GET …/security` → findings with severity/detail/recommendation (e.g. "No explicit security permissions", LOW) |
| Monitor | 🟡 PARTIAL | Execution/task records, per-agent benchmark/security and usage counters exist; no alerting |
| Verify | ✅ REAL | Factory agents run through the same verifier and are routable by MASTER (verified: MASTER run accepted with the custom agent) |
| Multi-tenant safety | ✅ REAL | Another user managing my agent → **403 forbidden**; status change → 403 (verified live) |
| Templates | ✅ REAL | `GET /api/factory/templates`, `POST /agents/from-template` |

---

## 8. TOOLS + INTEGRATIONS

Never-configurable-in-repo rule holds: the code reads credentials from environment variables only; `npm run scan:secrets` passes; no secret values appear in logs/API responses (per-tool endpoints return booleans).

| Provider / integration | Purpose | Implemented | Configured here | Credentials present | Sandbox working | Production working | Tested | Blocker |
|---|---|---|---|---|---|---|---|---|
| Google AI (Gemini) | model routing | ✅ `src/models/catalog.ts` | ❌ | ❌ | ❌ | UNVERIFIED | ✅ mocked | needs `GOOGLE_API_KEY` |
| OpenAI (compatible) | model routing | ✅ (base URL overridable) | ✅ **dev stub only** | stub key | ✅ stub | UNVERIFIED | ✅ | needs a real key in prod |
| Anthropic | model routing | ✅ | ❌ | ❌ | ❌ | UNVERIFIED | ✅ | optional |
| Web search (Tavily/Brave/Serper/Google CSE/keyless) | research | ✅ 5-provider resolver | ❌ | ❌ | ❌ (no egress) | UNVERIFIED | ✅ fixtures | needs one search key |
| Page fetch | research | ✅ + SSRF guard | n/a | n/a | ❌ (no egress) | UNVERIFIED | ✅ | none (host egress) |
| Knowledge search | retrieval | ✅ SQLite FTS | ✅ | n/a | ✅ (real, 0 items) | ✅ | ✅ | none |
| Stripe | payments | ✅ + signature verify + webhook normaliser | ❌ | ❌ | ❌ | UNVERIFIED | ✅ fixtures | needs key + webhook secret |
| Razorpay | payments (alt) | ✅ + signature verify | ❌ | ❌ | ❌ | UNVERIFIED | ✅ | needs keys |
| Manual settlement | payments fallback | ✅ (owner/webhook) | ✅ | n/a | ✅ | 🟡 | ✅ | none (no card rail) |
| OAuth: Google/GitHub/Microsoft/Facebook/Apple | sign-in | ✅ all five | ❌ all five | ❌ | ❌ | UNVERIFIED | ✅ `oauth.test.ts` | needs client id/secret per provider |
| SMTP | password reset, verification | ✅ | ❌ | ❌ | ❌ | UNVERIFIED | ✅ | needs SMTP account |
| Storage/uploads | files | ✅ local disk, 25 MB, traversal guard | ✅ | n/a | ✅ verified | ✅ (volume) | ✅ | needs persistent volume in prod |
| SQLite (`platform-live.db`) | primary DB | ✅ 16 migrations | ✅ | n/a | ✅ | ✅ single-node | ✅ 631 tests | horizontal scale is post-launch |
| PostgreSQL / Neon | DB backend | ✅ dual engine + pglite integration test | ❌ | ❌ | ✅ `npm run test:pg` | UNVERIFIED | ✅ | needs `DATABASE_URL` |
| Modal | hosting wrapper | ✅ `deploy/modal/akbaral_app.py` + runbook | ❌ | ❌ (needs Modal secret) | ❌ | UNVERIFIED | ❌ | needs Modal account + GHCR image (GitHub broken) |
| Domain/TLS | public entry | ✅ Caddy/compose configs | ❌ | ❌ | ❌ | ❌ | ❌ | **no domain, no TLS** |
| GitHub Actions / GHCR | CI + image publish | ✅ 3 workflows | ❌ | ❌ | ❌ | ❌ | ❌ | **`GH_TOKEN` invalid → push/CI blocked** |
| Expo push | mobile notifications | ✅ backend + app | ❌ | n/a | ❌ | UNVERIFIED | ✅ | needs EAS project id + device |
| Twilio | SMS | ✅ handler | ❌ | ❌ | ❌ | UNVERIFIED | ✅ | needs SID/token |
| YouTube / Instagram / TikTok / X / Shopify | publishing | ✅ handlers (OAuth prepared in mission) | ❌ | ❌ | ❌ | UNVERIFIED | ✅ | platform apps + tokens |
| AdSense | ads.txt | ✅ route | ❌ | ❌ | n/a | n/a | ✅ | optional |

---

## 9. TASKS + CREDITS

**Plans — verified in the live DB and served by `/api/billing/plans`:**

| Plan | Price | Credits/mo | Matches your spec |
|---|---|---|---|
| Free Trial | $0 | 5 | ✅ (30-day trial, no card) |
| Starter | $10 | 25 | ✅ |
| Professional (Pro) | $50 | 100 | ✅ |
| Business | $90 | 250 | ✅ |
| Scale | $200 | 750 | ✅ |
| Enterprise | $400 | 2,000 | ✅ |

**Verified business rules (live + code):**

| Rule | Verdict | Evidence |
|---|---|---|
| 30-day trial, 5 free tasks, **no card** | ✅ REAL | Register → `freeCredits = 5`, `subscription.status = trialing`, `trial_ends_at = created + 30d`; registration flow never touches a payment provider |
| Credit ledger | ✅ REAL | `credit_accounts` + `credit_transactions` (types `consume_task`, `refund_task`, `purchase`, `reversal`, …), immutable per-row `balance_after` |
| Successful task consumes exactly 1 | ✅ REAL | Live: ledger row `consume_task: -1` per completed specialist step; a 1-step run went 5 → 4 |
| **Consumption is per specialist step, not per user goal** | ⚠️ REAL BUT UNDISCLOSED | Live: one goal planned **3** steps → `freeCreditsRemaining 5 → 2`, usage `credits.consumed = 3`, `tasks.total = 3`. The pricing page says "5 free tasks"; a typical multi-step MASTER goal therefore spends more than one of them. Nothing in the UI says "this goal will cost N credits" before it runs |
| Failed task refund | ✅ REAL | Live: a research task failed (network-dependent) → balance unchanged, ledger shows the consume **and** the refund; `refundTaskCredit` is idempotent per task |
| Timeout refund | ✅ REAL | `reconcileTaskFailed` on workflow/job timeout; covered by `queue.test.ts` ("workflow timeout … fails the workflow and refunds the in-flight step") |
| Cancellation refund | ✅ REAL | `reconcileTaskCancelled` guarded by non-terminal status only; verified path responds and ledger stays consistent |
| Verification failure refund | ✅ REAL | `verification_failed` → `reconcileTaskFailed` → refund; tested in `verifier.test.ts` / `executor.test.ts` |
| Paid-resource-required refund | ✅ REAL | Unconfigured provider produces `provider_not_configured` failures which take the same failure→refund path |
| No negative balances | ✅ REAL | Balance update is guarded by the exact prior pool values; availability computed with `Math.max(0, …)` |
| No double spending | ✅ REAL | `consumeTaskCredit` is idempotent per `task_id` + optimistic `WHERE free_credits=? AND paid_credits=? AND bonus_credits=?`; returns undefined on race |
| Pool ordering | ✅ REAL | paid → bonus → free, pool recorded on the transaction so refunds restore the same pool |
| Owner unlimited execution | ✅ REAL | `hasUnlimitedTaskCredits` for owner/super_admin; audited as `owner.unlimited_execution`; verified owner runs consume nothing |
| Webhook handling | ✅ REAL (code) | `POST /api/billing/webhook` requires `BILLING_WEBHOOK_SECRET` + `x-akbaral-signature`; Razorpay additionally requires its own signature; events deduplicated (`processed_billing_events`); **no provider configured → 503, and no live event ever received here (UNVERIFIED against a real provider)** |
| Billing state | 🟡 | Invoices/payments/subscriptions persist correctly; but see the two defects below |

### 🔴 Billing defects found (revenue-integrity)

1. **`POST /api/billing/switch` grants any paid plan for free.** Any authenticated user (verified with a fresh trial account) can call `{"plan_key":"enterprise"}` → `202 {status:'active'}` — no payment, no invoice. The UI exposes it: `public/app.js:3590` renders every plan card in the in-app billing screen with a "Choose <Plan>" button wired to this endpoint (the marketing `/pricing` CTAs only link to `/#/register`), and the endpoint itself accepts the call from any authenticated client. Credits are *not* minted (entitlements are advisory today), but:
   - the account holds a paid **active** subscription it never paid for;
   - the owner console computes **MRR = Σ plan price of `status='active'` subscriptions** → live right now it reports **`mrrCents: 40000` ($400/mo) with `paidCents: 0`** purely because of my audit account's free "enterprise" switch, directly contradicting the dashboard's own "never fabricate revenue" rule.
   *Fix (must be before charging money):* make `/api/billing/switch` owner/admin-only, or convert it to a checkout intent that only becomes `active` after a verified webhook.
2. **No payment rail configured.** `POST /api/billing/credits` honestly returns `402 provider_not_configured` for a non-manual provider and `201 {status:'pending'}` for `manual` (invoice only). `launch:check` lists both payment blockers. **Paid plans cannot be sold today.**

Minor: `POST /api/billing/switch` also reports success even when nothing was charged, which would confuse a support/refund workflow.

---

## 10. FILES / PROJECTS / ARTIFACTS

| Capability | Verdict | Evidence |
|---|---|---|
| Upload | ✅ REAL | `POST /api/projects/:id/files` (multipart, 25 MB limit) → 201; filename sanitised, storage key generated server-side |
| Storage | ✅ REAL | Disk under `AKBARAL_UPLOAD_DIR` (writable + persistent check in `/api/ready`); path resolution rejects traversal/NUL/absolute keys; `/uploads/*` served back |
| Retrieval / download | ✅ REAL | `GET /api/files/:id` streams with correct `content-type` + attachment filename; owner-only (other user → 404) |
| Projects | ✅ REAL | Create/read/update/delete, members with roles (`hasProjectRole`), owner scoping; verified live |
| Generated files | 🟡 PARTIAL | `Spreadsheet Builder` writes a real CSV into the uploads dir; `Text File Parser`/`CSV Parser` read them — these are tool-level, not surfaced as artifacts |
| Generated websites/apps | ✅ REAL | MASTER capture path stores a completed HTML deliverable as a versioned `website` artifact (verified: 11 rows) |
| Images | 🔴 BLOCKED | `image_render` requires an image provider credential (absent); **no produced image artifacts exist** |
| Documents / data artifacts | 🟡 PARTIAL | `document` and `data` are accepted kinds with viewers/versioning/download, but **no producer**: manual creation returns `400 invalid_request — only website artifacts can be captured from workflows` (verified) |
| Previews | ✅ REAL | Website artifacts render in the SPA's `sandbox="allow-scripts"` iframe from `srcdoc`; images render directly; documents via `renderDocumentPreview` |
| Downloads / exports | ✅ REAL | `GET /api/projects/:id/artifacts/:kind/download` (verified 200 for owner, 404 for another user); export bar appears after a run when a project is selected |
| Versions + revert | ✅ REAL | Version rows with checksums; `POST …/artifacts/:kind/revert/:version` restores an older version as a new latest (verified on the website artifact lineage) |
| Persistence | ✅ REAL | All of it lives in SQLite + `/data` volume; survives restart (verified across many restarts today) |
| Permissions / isolation | ✅ REAL | Cross-user project read → 404, artifact list → 404, file download → 404, workflow read → 404 (all verified live); workspace viewers cannot upload |
| File versioning (`file_versions`) | 🟡 | Table + repository exist; 0 rows — file re-upload creates a new file rather than a new version |

---

## 11. SECURITY

| Control | Verdict | Evidence |
|---|---|---|
| Authentication | ✅ | JWT access tokens (HS256, `sid` claim) + DB-backed session check on every request; refresh tokens hashed and rotated with reuse rejection (verified) |
| Authorization | ✅ | `requireAuth` + `requireRole` at router level; verified 401 anonymous / 403 wrong-role across `/api/owner`, `/api/admin`, `/api/economy`, `/api/metrics` |
| Owner RBAC | ✅ | Owner promoted server-side from `AKBARAL_OWNER_EMAIL` (audited, one-way); role never trusted from the client; owner 200 / user 403 verified |
| Session security | ✅ | Access ~1h expiry, refresh rotation, `SESSION_SECRET` ≥32 chars enforced in production (placeholder values rejected), `SESSION_SECRET_PREVIOUS` grace for rotation |
| Secret handling | ✅ | Env-only credentials; per-tool endpoints expose presence booleans, never values; `npm run scan:secrets` in CI-style checks; no secrets in logs (structured logs redact tokens) |
| API authorization | ✅ | Every mutating route requires auth; business errors mapped to HTTP codes; no route found that trusts client-supplied user ids |
| User-data isolation | ✅ | Owner-scoped queries everywhere probed; cross-user access returns indistinguishable 404 (no existence oracle) |
| Payment security | 🟡 | Webhook signature verification (HMAC + Razorpay double-check), event dedupe, refunds only from signed events, `settleInvoicePayment` unreachable from any user route — **but** `/api/billing/switch` is an authorization hole (§9) |
| File access | ✅ | Downloads owner-scoped; traversal-guarded storage keys; upload size limit; mime sniffing only for classification |
| Injection | ✅ | Parameterised SQL throughout the repositories spot-checked (no interpolated values in SELECT/INSERT/UPDATE); validated body helpers; registry slugs validated against the catalog |
| XSS | ✅ | SPA escapes dynamic strings via `esc()`; generated artifacts render in `sandbox="allow-scripts"` **without** `allow-same-origin`, so a generated page cannot read the app's origin/storage; Express API responses carry `nosniff` + strict CSP |
| CSRF | ✅ (by design) | No cookie-based auth — bearer tokens are sent explicitly; `SameSite` cookies are not used for sessions; webhooks require signatures |
| Rate limiting | ✅ | Global 300 req/min, `/api/auth` 30/min, OAuth callbacks 30/min, contact 5/min; **verified live: 429 responses observed when hammering login** |
| Abuse controls | ✅ | Emergency stop / kill switch, per-user automation cap (25), max 8 steps, sandboxed preview, anti-fraud policy deny-list in the economy module |
| Error leakage | ✅ | Probed 404/401/403/400 bodies: no stack traces, no file paths, no SQL; errors are `{error:{code,message}}` |
| Logging / audit | ✅ | Structured JSON request logs (no tokens), `audit_logs`, `security_logs`, `task_events`, `agent_execution_logs`, `system_metrics`, admin-only Prometheus `/api/metrics` |
| Dependency posture | ✅ web / 🟡 mobile | `npm audit` **root production deps: 0 vulnerabilities**; mobile: 1 critical + 10 high, all in the Expo/RN **build toolchain** (tar, metro, cacache, postcss, xmldom, image-size) — fix requires Expo SDK 51→57 (post-launch) |
| Transport/edge | 🔴 | No domain/TLS yet; `TRUST_PROXY` must be set to `1` only behind exactly one trusted proxy (documented) |

**Findings register**

| # | Severity | Finding |
|---|---|---|
| 1 | **HIGH** | `/api/billing/switch` lets any user self-activate a paid plan without payment; inflates owner MRR (verified: $400 MRR vs $0 collected). Revenue-integrity + honesty defect |
| 2 | **HIGH** | No payment provider configured → paid plans/credits cannot be sold (blocker for revenue, not for a free launch) |
| 3 | **MEDIUM** | No SMTP → password reset and email verification unavailable to users (honest 503). Account recovery requires owner intervention |
| 3b | **MEDIUM** | Credit consumption is **per specialist step** while the trial is marketed as "5 free tasks" and nothing warns the user how many credits a goal will cost before it runs (verified live: a 3-step goal consumed 3 of 5). Either disclose the step cost pre-run or price per goal |
| 4 | **MEDIUM** | No email verification on signup — any address can be registered (rate-limited). Abuse risk: trial farming (5 free tasks per address) |
| 5 | **MEDIUM** | No domain/TLS/public host configured; `AKBARAL_SITE_URL` unset affects robots/sitemap/checkout returns |
| 6 | **MEDIUM** | GitHub auth recovered mid-audit and both commits are pushed, **but `docker-publish` fails at "Build and push" on every push (3/3 runs)** → no GHCR image → the Modal deployment path cannot start. Root cause UNVERIFIED (no Actions log access, no Docker here) |
| 7 | **MEDIUM** | Mobile dependency chain has 1 critical + 10 high advisories (build toolchain) |
| 8 | **LOW** | `DELETE /api/auth/oauth/identities/facebook` 404s while Facebook is unconfigured (list omits `facebook`) |
| 9 | **LOW** | Owner console "API cost" figures are computed from the model price catalog × recorded runs; with a stub/free provider they are estimates, not provider invoices (the code discloses externalProviderCosts as unknown) |
| 10 | **LOW** | Mobile imports `expo-constants` without declaring it (resolves transitively via Expo) |
| 11 | **LOW** | `file_versions` table unused; artifact generation supports `website` only |
| 12 | **INFO** | Sandbox has no outbound internet: every provider integration is UNVERIFIED live, by environment not by code |

---

## 12. PRIVATE OWNER MISSION

Audited separately. **The private codename appears nowhere in the public product** — verified by direct scan of `public/app.js`, `public/styles.css`, `public/tokens.css`, `src/app/page.tsx`, `layout.tsx`, `workspace/page.tsx`, `owner/page.tsx`, every `(public)` page, and the served HTML of `/`, `/workspace`, `/pricing`, `/agents`, `/owner`: **0 occurrences**. It appears only in server-side code, its own env variable names, and its own private dashboard title (a separate loopback app).

| Item | Verdict | Evidence |
|---|---|---|
| Separate application | ✅ | `src/mission/*` (7,667 LOC) served by `npm run mission:serve` on its own port; nothing in the AKBARAL! app includes it |
| Owner-only authentication | ✅ | Mission-owner session or a scoped, hashed access link (`dashboard:read`, `agent:self`) required; all routes call `requireOwner(context[, mutation])` |
| RBAC | ✅ | Only-owner checks on every mutating route; two OAuth callbacks are the only non-session entries (protected by one-time state) |
| Private routes / no discovery | ✅ | Loopback bind by default; **refuses to bind 0.0.0.0 with no owner provisioned**; not in sitemap, not linked, not proxied; `/api/owner`, `/api/economy`, `/api/admin` in the platform app are owner/admin-gated (403 verified) |
| Separate data boundaries | ✅ | Own SQLite/PG database (`ZA141251SA_DATABASE_URL`, default `mission.db`), own credential vault (encrypted with `ZA141251SA_CREDENTIAL_KEY`), own audit chain and ledger chains, own treasury and payout destinations. Platform analytics explicitly **exclude** mission revenue (`ledgerSeparation` field verified live) |
| Revenue opportunity / workforce | ✅ (implemented) | Opportunity discovery + evaluation + `authorize`, improvement/upgrade proposals with sandbox results, AI-employee/workforce registry, targets, reports, self-management policy |
| Legitimate revenue tracking | ✅ | Revenue only recordable against a verified provider/webhook reference; `verifyLedger()` + `GET /api/audit/verify` chain verification exposed in the dashboard |
| Approved earnings / reinvestment | ✅ | Policy singleton with `maxDailySpendCents`, `maxExpenseCents`, `maxPayoutCents`, `maxAgents`, `maxDepth`, `maxChildrenPerAgent`, approvals for upgrades |
| Treasury / settlement flow | ✅ | Wallets, transfers, settlements with completion gated on evidence; four configurable payout-destination slots with **verification/attestation required before any payout** (unexpired, evidence-backed) |
| Provider status | ✅ honest | `requiresExternalActivation` list surfaces exactly what is missing; every provider call returns `provider_not_configured` rather than a synthetic result |
| Real revenue today | ❌ none | **UNVERIFIED / zero**: no mission DB exists in this environment (`mission.db` absent), no mission process has ever run here, no provider is activated, and no payout slot is verified |
| Must remain disabled before launch | — | The mission app should stay **unstarted / loopback-only** until: (a) its DB is initialised with a strong `ZA141251SA_*` secret set, (b) at least one payout slot is verified **by you**, (c) `autonomousEnabled` stays `false` and the kill switch is understood, (d) payment + model + search providers are activated. Nothing about the public launch requires it to run |

---

## 13. MOBILE APPLICATION

| Item | Result |
|---|---|
| Framework | **Expo SDK 51 / React Native 0.74.1**, TypeScript, React Navigation (bottom tabs), WebView for previews, `expo-notifications`, AsyncStorage |
| Code size | 3,579 LOC (App.tsx 323; MasterScreen 910; ui.tsx 468; Automations 388; Tasks 365; theme 195; …) |
| Dependencies installed during audit | ✅ `npm ci` in `mobile/` → 1,196 packages |
| Build status | 🟡 **TypeScript `tsc --noEmit` exit 0**. No bundle/prebuild run: no `eas.json`, no `expo prebuild`, no Android/iOS native folders, no signing material |
| Screens | Login + 7 tabs: **Dashboard, MASTER, Tasks, Agents, Workspace, Billing, Settings** (+ Automations inside Tasks, + task detail and WebView preview routes via `expo-linking`) |
| Authentication | Real client: register/login/logout, refresh rotation, AsyncStorage token persistence, OAuth provider list + authorize URL launch (`/api/auth/oauth/:provider/authorize`) |
| MASTER | Real screen (910 LOC): composer, projects, execution stream via SSE (`/api/executions/:id/events`) with WS alternative, preview WebView |
| Agents | List/search via `/api/agents`, save to world via `/api/agents/:slug/save` |
| Tasks | List/detail, cancel, attachments/preview via `/api/files/:id`, automations runs |
| Credits / billing | Billing screen reads `/api/billing/plans` + credits; credit purchase call exists (will honestly fail without a payment provider) |
| Files / projects / artifacts | Project list/create/detail, artifact fetch (`/api/projects/:id/artifacts/website`), file preview in WebView |
| Preview | WebView against the served artifact/preview URL |
| Notifications | `expo-notifications` permission + Expo push token registered to `POST /api/notifications/device`, revoked on logout; backend sender targets `exp.host` (external, UNVERIFIED) |
| API connectivity | **26/26 endpoint+method pairs referenced by the app exist on the live server** (checked with/without auth: 401/400 = exists, none 404-"route not found"). ⚠️ default `apiBaseUrl` is `https://api.akbaral.ai`, which **does not resolve** — must be pointed at the real deployment |
| Responsive/device behaviour | **UNVERIFIED** — never run on a simulator or device in this environment |
| Android build/store readiness | 🔴 No icon (`icon.png` missing; only `splash-icon.png`), no adaptive-icon foreground, no `eas.json`/build profile, no keystore, no versionCode policy, no store listing, no Play Console app |
| iOS readiness | 🔴 Same, plus no Apple Developer account/provisioning; `supportsTablet: true` but untested |
| Honest conclusion | The app is a **working client codebase**, not a shippable release. It requires an Expo/EAS build pipeline, icons/assets, a real API base URL, and device testing |

---

## 14. TESTING (exact numbers, this commit)

| Gate | Command | Result |
|---|---|---|
| Full test suite | `npm test` | **68 test files (69 TAP runs), 631 tests, 631 pass, 0 fail**, 90 suites, exit 0 |
| TypeScript (app) | `npx tsc --noEmit` | ✅ clean (exit 0) |
| TypeScript (mobile) | `mobile: npx tsc --noEmit` | ✅ clean (exit 0) |
| Production build | `npm run build` | ✅ exit 0 (see §15) |
| Rendered-route audit | `npm run audit:routes -- --widths=320,390,768,1440` | ✅ **328/328** on this build (320: 82/82; 390/768/1440: 246/246) |
| Responsive audit | `npm run audit:responsive -- --widths=320,360,375,390,414,768,1024,1280,1440,1920` | see §14.1 |
| Shell smoke (live run) | `npm run smoke:shell` | see §14.1 |
| Artifact smoke | `npm run smoke:artifacts` | see §14.1 |
| Task-3 smoke | `npm run smoke:task3` | see §14.1 |
| Registry audit | `npm run audit:registry` | see §14.1 |
| Secret scan | `npm run scan:secrets` | see §14.1 |
| PostgreSQL/Neon path | `npm run test:pg` | see §14.1 |
| Live API probe (this audit) | `/tmp/probe-api.mjs` | auth/billing/credits/isolation/security: see §14.1 |
| Live factory/automation probe | `/tmp/probe-factory.mjs` | 17/21 assertions pass; the 4 failures were probe-path errors, re-run in `probe-fix` — see §14.1 |
| Dependency audit | `npm audit --omit=dev` | root: **0 advisories**; mobile: 39 (1 critical, 10 high — build toolchain) |
| Launch check | `npm run launch:check --offline` | **readiness 44.4 % (5/13 required checks), 5 blockers** ($0 spent) |

### 14.1 Exact gate results (all on commit `7987605`, this build)

| Gate | Command | Result |
|---|---|---|
| Full test suite | `npm test` | **68 test files (69 TAP runs) · 631 tests · 631 pass · 0 fail · 90 suites** · exit 0 |
| TypeScript (web/app) | `npx tsc --noEmit` | ✅ exit 0 |
| TypeScript (mobile) | `mobile: npx tsc --noEmit` | ✅ exit 0 |
| Production build | `npm run build` | ✅ exit 0 — Next.js 16.3.4 (Turbopack), backend `tsc` OK, "Compiled successfully", 21/21 static pages, 1 benign warning (dynamic filesystem access in `src/app/assets/[file]/route.ts`) |
| Rendered-route audit | `npm run audit:routes -- --widths=320,390,768,1440` | ✅ **328 passed, 0 failed** |
| Responsive audit (10 widths) | `npm run audit:responsive -- --widths=320,360,375,390,414,768,1024,1280,1440,1920` | ✅ **no findings**, exit 0 |
| Responsive audit self-test | `npm run audit:responsive:selftest -- --widths=320` | ✅ 4/4 planted regressions still caught |
| Shell smoke (live MASTER run) | `npm run smoke:shell` | ✅ **71/71 shell checks passed**, runtime problems: none, exit 0 |
| Artifact smoke | `npm run smoke:artifacts` | ✅ **27/27 artifact checks passed**, exit 0 — includes "capturing a kind the pipeline cannot produce is refused honestly" (400), "a successful run consumes exactly one credit" (5 → 4 for a single-step run), "knowledge search answers from the real index" (status=200, results=1) |
| Task-3 smoke (platform half) | `npm run smoke:task3` | 🟡 **7/7 platform checks PASS** (credit purchase refuses `402 provider_not_configured`; Stripe webhook `503 webhook_not_configured`; forged signature rejected; manual purchase creates a payable invoice; registry intact 4,001) + 1 SKIP; **exit 1 only because its second half targets the private mission server on :4200, which is deliberately not running** |
| Registry audit | `DATABASE_URL=… npm run audit:registry` | ✅ **PASS** — 4,003 agent version rows, 80 categories, 7-model catalog, contract samples printed (the chain's first attempt failed only because `DATABASE_URL` was not exported into the step) |
| Secret scan | `npm run scan:secrets` | ✅ **PASS** — no real secret markers; 22 allow-listed synthetic placeholders |
| PostgreSQL/Neon path | `npm run test:pg` (pglite) | ✅ **22 tests, 22 pass, 3 suites**, exit 0 (includes versioned project artifacts + treasury transfers round-trip on PG) |
| Mobile dependency install | `mobile: npm ci` | ✅ 1,196 packages |
| Dependency audit | `npm audit --omit=dev` | web **0 advisories**; mobile 39 (1 critical, 10 high — all Expo/RN build toolchain) |
| Launch check | `npx tsx scripts/launch-check.ts --offline` | **readiness 44.4 % (5/13 required checks ready, 5 blockers)** |
| Live API probe (auth/billing/credits/isolation) | `/tmp/probe-api.mjs`, `/tmp/probe-iso2.mjs` | auth **17/17**; oauth **4/4**; billing **3/3**; master **4/4**; isolation **4/4**; files upload/download **2/2**; artifacts export/versions **2/2**; rate limiting ✅ (15× 429 in 40 login attempts); no stack leakage ✅ |
| Live Agent Factory / automations probe | `/tmp/probe-factory.mjs`, `/tmp/probe-fix.mjs` | factory create → test → benchmark → security review → version → rollback → disable/reactivate ✅; cross-user management blocked (403) ✅; automations create → run → history → pause/resume → delete ✅, invalid schedule rejected ✅ |
| Fresh-build restart check | `kill` + `start-prod`, then HTTP sweep | `/`, `/workspace`, `/owner`, `/api/health`, `/api/ready` all **200**; `tokens.css`/`styles.css`/`app.js` **served == disk** (sha256 MATCH); owner token → `/api/owner/dashboard` **200**, anonymous **401**; `/api/ready` = `ready [database:migrations:uploads:execution_queue]` |
| Mobile → API contract | custom check | **26/26** referenced endpoint+method pairs exist on the server; 0 "route not found" |
| Mobile default API host | DNS | `api.akbaral.ai` **does not resolve**; `akbaral.duckdns.org` resolves to `39.34.131.172` but HTTP is blocked by the sandbox egress proxy (live state UNVERIFIED) |

Probe artefacts (not committed): `/tmp/probe-api.mjs`, `/tmp/probe-iso2.mjs`, `/tmp/probe-factory.mjs`, `/tmp/probe-fix.mjs`, logs in `/tmp/audit/*.log`.

---

## 15. DEPLOYMENT

**Sandbox/preview vs REAL production — stated plainly:** everything in this report was measured against a **local preview stack** (`node scripts/start-prod.mjs`, Next :3000 → Express :4000, SQLite on local disk, local model stub). **There is no real production deployment reachable from here.** `akbaral.duckdns.org` resolves to `39.34.131.172` in DNS, but HTTP to it is blocked by the sandbox egress proxy → its live state is **UNVERIFIED**.

| Item | Status | Detail |
|---|---|---|
| Production image | 🟢 | `Dockerfile`: multi-stage Node 22, builds TS backend + Next, runs `scripts/entrypoint.sh`, `HEALTHCHECK` on `/api/ready`, `/data` volume, `GIT_SHA` build stamp in `/app/.image-version` |
| Orchestration | 🟢 | `docker-compose.production.yml` (single node by design, memory limits, log rotation, restart policy) + `deploy/modal/akbaral_app.py` (Modal web service on a GHCR image with Neon, `modal.Volume`, schedule) |
| Free-tier options | 🟢 | `deploy/free-oracle` (VM + Caddy + DuckDNS), `deploy/free-render`, `deploy/free-zeabur`, `deploy/free-clawcloud`, `deploy/free-snapdeploy` runbooks |
| Modal | 🟡 | Wrapper + runbook exist; **not deployed** — needs a Modal account/secrets *and* a published GHCR image, and GHCR publishing is currently failing |
| Neon / PostgreSQL | 🟡 | Dual-engine DB layer + `npm run test:pg` (pglite) integration test + mission PG support; **no Neon database provisioned**, `DATABASE_URL` here is SQLite |
| Secrets/config | 🟢 | `validateEnvironment()` refuses production without a strong `SESSION_SECRET`; 74 documented variables; provider credentials optional and reported as `not_configured` |
| Domain / TLS | 🔴 | Not configured. Runbook (Caddy auto-TLS + DuckDNS) is written; nothing is live |
| Migrations | 🟢 | 16 migrations, applied automatically at container start and by `npm run db:migrate`; idempotent; `/api/ready` reports `migrations: ok` |
| Persistent storage | 🟢 | `/data` volume (SQLite + uploads + backups) with readiness probe on uploads writability |
| Startup | 🟢 | entrypoint: migrate → optional seed → backup cron → `start-prod.mjs`; boot self-heals an incomplete agent registry |
| Health checks | 🟢 | `/api/health` (liveness, DB round-trip) and `/api/ready` (DB + migrations + uploads + queue worker) — both verified live returning real checks |
| Monitoring | 🟡 | Structured JSON request logs + `system_metrics` table + admin-only Prometheus `/api/metrics`; **no external APM/alerting wired** |
| Logging | 🟢 | No secrets logged; audit/security logs persisted; Docker log rotation configured |
| Backups | 🟢 | Nightly **verified** snapshot at 01:17 UTC inside the volume, retention 30, `db:backup` / `db:restore` scripts, restore drill documented |
| Rollback readiness | 🟡 | Image digests are pinnable (`AKBARAL_IMAGE=…@sha256:…`), `.image-version` proves the running commit, DB restore documented — but no automated rollback job and **no published image yet** (GitHub auth broken) |
| CI | 🔴 | GitHub auth recovered: pushes work and workflows now execute (`516d06c..8b5c8bb`). But **`docker-publish` fails at the "Build and push" step on every run** (3 consecutive failures incl. this commit) — no image reaches GHCR, which blocks the Modal path. `keep-alive` and `production-verify` are configured but idle (they need a real production URL) |

---

## 16. FINAL LAUNCH MATRIX

| AREA | STATUS | EVIDENCE | BLOCKER | ACTION REQUIRED |
|---|---|---|---|---|
| Public website (marketing) | 🟢 READY | 16 server-rendered routes HTTP 200 `[curl]`; responsive audit clean; real content | none | point domain + set `AKBARAL_SITE_URL` |
| Web app shell / navigation | 🟢 READY | 15 screens render at 320–1920 `[route-audit]`; drawer/pane switch verified | none | — |
| Auth (email+password) | 🟢 READY | register/login/refresh-rotation/reuse-reject/logout/RBAC all verified live | none | — |
| OAuth (5 providers) | 🟡 PARTIAL | flows coded + tested with fixtures; all 5 unconfigured → honest 503 | client id/secret per provider | register OAuth apps when needed |
| MASTER pipeline | 🟢 READY | real run → deliverable → export `[smoke]`; verification + refunds verified | AI provider key needed in prod | set `GOOGLE_API_KEY` |
| Agents registry (4,001) | 🟡 PARTIAL | 4,001 contracts, 80 categories, dispatch + verification real; 7/18 tools linked, 0 credentials | tool credentials | configure credentials as capabilities are sold |
| Agent Factory | 🟢 READY | create→test→benchmark→security→version→rollback→disable verified live | none | — |
| Agent World / Marketplace | 🟢 READY | 4,001 published; per-user world; install/publish/rate/review | none | — |
| Automations | 🟢 READY | create→run→history→pause/resume→delete verified live; honest failures | none | — |
| Files / projects | 🟢 READY | upload/download/isolation/versions verified live | none | — |
| Artifacts | 🟡 PARTIAL | website artifacts real (versioned, revertible, exportable, sandboxed preview) | no producer for document/data/image | ship with website-only claim, or add producers post-launch |
| Credits / refunds | 🟢 READY | consume-on-success + refund-on-failure verified live; ledger hardened | none | — |
| Billing / payments | 🔴 BLOCKED | plans + invoices + webhooks implemented; no provider; **free plan-switch hole** | provider keys + self-switch fix | fix `/api/billing/switch`; add Stripe/Razorpay |
| Email (reset/verify) | 🔴 BLOCKED | endpoints implemented, honest 503 without SMTP | SMTP account | add SMTP relay |
| Owner console / RBAC | 🟡 PARTIAL | owner 200 / user 403 verified; analytics honest **except MRR contamination** | billing hole | fix §9.1 |
| Private owner mission | 🟡 PARTIAL | complete private app + separate DB/ledger/treasury/kill-switch; never initialised or run here | mission secrets, payout verification, provider activation | keep unstarted/loopback until you activate it |
| Security (app layer) | 🟢 READY | headers/CSP, RBAC, rotation, SSRF, parameterised SQL, rate limits, 0 web advisories | none | add edge controls/WAF post-launch |
| Responsiveness (web) | 🟢 READY | responsive audit clean at 320–1920; 328/328 rendered-route assertions | none | — |
| Mobile app | 🔴 BLOCKED | TS clean, 26/26 endpoints exist; never built/run; no icons/EAS/signing; default API host does not resolve | build pipeline + assets + real API URL + device QA | EAS build, icons, API base URL, Play/App Store accounts |
| Deployment infra | 🟡 PARTIAL | Docker/Modal/free-tier runbooks, health/ready, migrations, backups all real; GHCR/CI blocked | GitHub auth invalid; no domain/TLS | restore GitHub, deploy, DNS + TLS |
| CI/CD | 🔴 BLOCKED | workflows execute now that GitHub auth is restored; `docker-publish` fails at Build and push (3/3) | failing image build / unknown root cause | fix the GHCR build in Actions (or build the image by hand and push it) |
| Observability | 🟡 PARTIAL | structured logs, metrics endpoint, audit logs, health/ready | no external alerting | add alerting post-launch |
| Mobile deps security | 🟡 PARTIAL | 1 critical + 10 high in build toolchain | Expo SDK upgrade | schedule 51→56/57 upgrade post-launch |

---

## 17. TODAY'S LAUNCH PLAN

### A. MUST FIX BEFORE LAUNCH
1. **Fix `/api/billing/switch`** (owner/admin-only, or checkout-intent that only activates after a verified webhook) — otherwise free paid-plan activation and fabricated MRR. *(Code change, ~30 min + test.)*
2. **Set the AI provider key** (`GOOGLE_API_KEY`, or OpenAI/Anthropic) in the deployment secret store — without it no customer task can succeed.
3. **Deploy to a real host with a domain + TLS** and set `AKBARAL_SITE_URL` (robots/sitemap/checkout return URLs depend on it).
4. **Set `SESSION_SECRET` (≥32 random chars)** and `TRUST_PROXY=1` only behind exactly one trusted proxy.
5. ~~Restore the GitHub connection~~ ✅ done mid-audit (pushed `516d06c..8b5c8bb`). **New:** fix the failing `docker-publish` job — without a published image the Modal path cannot run (a plain VM/compose host builds its own image, so this blocks only the Modal option).
6. **Decide the payment story for launch day:** either (a) launch **free-trial only** with no paid buttons (remove/disable plan CTAs), or (b) configure Stripe/Razorpay + `BILLING_WEBHOOK_SECRET` and receive a real test-webhook end-to-end before taking money.

### B. SHOULD FIX BEFORE LAUNCH
7. Set a **search provider key** (Tavily recommended) so research tasks work from a datacenter IP.
8. Configure **SMTP** so password reset exists (otherwise publish a support contact route for account recovery).
9. Verify the **owner console MRR** reads $0 after cleaning the audit-time subscription rows (or after fix A1).
10. Run `npm run launch:check` on the production host until **readiness = 100 %** (no blockers).
11. Decide and disclose the credit model in the UI: one credit per specialist step means a 3-step goal costs 3 of the 5 free credits (verified). Show the planned step count before running.
12. Run `npm run smoke:shell`, `smoke:artifacts`, `audit:routes` against the **production URL**, plus one real sign-up → MASTER run → artifact export on the live host.
13. Tighten trial abuse: consider requiring email verification before the 5 free tasks *once SMTP exists*.

### C. CAN SAFELY POSTPONE
14. Document/data/image artifact producers; image generation provider.
15. Mobile release (EAS build, icons, signing, store listings) — ship web first.
16. Expo SDK upgrade (dependency advisories are build-toolchain only).
17. Analytics/marketing instrumentation, CMS, A/B.
18. Library/knowledge seeding for new accounts, `file_versions` usage.
19. Horizontal scaling (PostgreSQL + external queue), zero-downtime deploys.
20. External APM/alerting, WAF/edge rate limiting.
21. Mission-system activation (it is private and independent).

### D. EXACT ORDER TO FIX THEM
1. GitHub auth → push commit `7987605` (nothing else can ship until code moves).
2. A1 billing-switch fix + test (`npm test` green) → commit.
3. Provider keys (AI → search → SMTP → payments) in the deploy secret store; `launch:check` must drop to 0 blockers.
4. Deploy image to the chosen host (Modal or VM/compose) → domain + TLS → `AKBARAL_SITE_URL`.
5. `docker … SEED_DATABASE=true` first boot (or `npm run db:seed`) → verify `/api/ready` = ready and 4,001 agents present.
6. Smoke + route audits against the live URL; owner console MRR/inventory check; one real MASTER run on a real account.
7. Only then: enable paid plans (if payments verified) and announce.

### E. REALISTIC MINIMUM REQUIRED FOR WEBSITE LAUNCH
Marketing site + SPA + auth + MASTER + projects/files/artifacts + credits **with**: domain/TLS, `SESSION_SECRET`, one AI provider key, `AKBARAL_SITE_URL`, no paid-plan CTA (or the switch fix), a support contact path, and `/api/ready` green on the public host. A search key and SMTP strongly recommended but not strictly required for a credible free-trial launch.

### F. REALISTIC MINIMUM REQUIRED FOR APP LAUNCH
Mobile is a separate project: EAS build pipeline + icons/splash/adaptive icon, a real `apiBaseUrl` pointing at the deployed API, Android keystore + Play Console listing (and Apple Developer account for iOS), device QA of login → MASTER → artifacts → notifications, and a review of the push/EAS project id. **Not achievable today.**

### G. WHAT YOU PERSONALLY MUST DO (external accounts/decisions only — no secrets in chat)
1. Reconnect GitHub in Arena (or push with a valid token) — required now.
2. Create/point a host: Modal account **or** a VM (Oracle free tier is documented) + domain (DuckDNS or your own) with TLS.
3. Create an AI provider key (Google AI Studio recommended) and a search key (Tavily) in that host's secret store.
4. Decide: launch free-trial-only today, or configure Stripe/Razorpay (keys + webhook secret) and verify a test payment before enabling paid plans.
5. Optional but recommended: an SMTP relay account for password reset.
6. For the app later: Expo/EAS account, Google Play + Apple Developer accounts, signing assets.

### H. WHAT I / ARENA CAN DO
- Fix the billing-switch hole + tests, and any other code findings (Facebook unlink list; disable plan CTAs until payments exist).
- Harden/verify on your production host: run `launch:check`, smoke suites and route audits against the live URL, inspect `/api/ready`, and report exact numbers.
- Produce the EAS/Expo release configuration, app icons/splash, and a device-test checklist for the mobile app.
- Prepare the exact Caddy/Modal/Compose configuration and the DNS/TLS checklist.
- Re-run every gate after each change and report only what passes.

### I. FINAL GO/NO-GO FOR WEBSITE — **conditionally GO**
GO if and only if: GitHub is restored (2 commits to push: `516d06c` is remote, `7987605` local), the billing-switch hole is fixed, a host with domain+TLS is live with `SESSION_SECRET` + `AKBARAL_SITE_URL`, one AI provider key is set, `/api/ready` returns ready on that host, and no paid-plan CTA is exposed without a verified payment provider. NO-GO if you intend to sell paid plans today — that path is unimplemented end-to-end.
*(Today's evidence: the app itself is launch-shaped — 631/631 tests, real MASTER runs, real artifacts, real credits, clean responsive audit — the missing pieces are configuration and one billing defect, not product substance.)*

### J. FINAL GO/NO-GO FOR APP — **NO-GO today**
The client code compiles and every API it calls exists, but it has never been built, run, signed or store-listed, and its default API host does not resolve. Earliest realistic app launch: after an EAS build, assets/icons, a real API URL, and device QA (plus Play/App Store accounts).

---

## SHORTEST SUMMARY

**DONE** — Web product is real: 16 server-rendered routes live (13 marketing pages + 3 app entries), 15 app screens, 218 API endpoints, 90 tables/16 migrations, 4,001 agents (80 categories) with dispatch + verification, Agent Factory full cycle (create/test/benchmark/security/version/rollback/disable) verified live, automations verified live, files/projects/artifacts with cross-user isolation verified live, credits consume-per-step/refund-on-failure verified live (a 3-step goal costs 3 of the 5 free credits — undisclosed), 631/631 tests, tsc clean, production build clean, 328/328 rendered-route assertions, responsive audit clean 320→1920, owner RBAC 200/403 correct, private mission codename absent from every public surface.

**REMAINING** — Credit cost per goal is undisclosed (3-step goal = 3 credits); only `website` artifacts are produced (document/data/image have no producer); 11 of 18 tools unlinked and 0 tool credentials; no email (reset/verify) → honest 503; no verification gate on signup; marketing pages lack analytics; mobile needs icons/EAS/signing/device QA; Library empty until files are indexed.

**BLOCKED** — No domain/TLS/public host; no AI provider key (no customer task can succeed); no search key; no payment provider (paid plans unsellable); **`POST /api/billing/switch` lets any user activate any paid plan for free and inflates owner MRR ($400 vs $0 collected — verified)**; GitHub auth recovered and both commits are pushed (`8b5c8bb`), but the `docker-publish` job fails at Build and push so no GHCR image exists (blocks the Modal path only); mobile app never built/run and `api.akbaral.ai` does not resolve.

**TODAY'S REQUIRED ACTIONS** — (1) ✅ GitHub restored and commits pushed — now fix the failing GHCR image build if you intend to use Modal; (2) fix the billing-switch hole (or remove paid CTAs); (3) set `SESSION_SECRET`, `AKBARAL_SITE_URL`, AI key, search key on a real host with domain+TLS; (4) optionally SMTP; (5) run `launch:check` + smokes against the live URL until 0 blockers; (6) launch **free-trial only** today, sell paid plans only after a verified payment provider.
