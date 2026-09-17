# TASK 3 — FINAL LAUNCH PREPARATION REPORT

**Project:** AKBARAL! / MASTER AI
**Branch:** `arena/01a0a045-akbaral`
**Execution window:** 15 September 2026, 09:00 → 21:00 (Asia/Karachi)
**Latest commit:** `c6267d4` — *Task 3: launch verification, real payment webhooks, payout verification, social OAuth, mission PostgreSQL* (plus the report commit that follows it)
**Continues from:** `82feb0c` (Task 2) → `952392a` (Task 1). Nothing was restarted, rebuilt from zero or redesigned.

---

## 1. What this window delivered

Task 3 took the seven external blockers from §5 of `TASK2_FINAL_REPORT.md` and did the only thing that is
technically possible without the owner's credentials or dashboard access: **the integration is now complete,
tested, and its state is measurable** — including the exact wording of what the owner must do, and an honest
refusal everywhere a credential does not exist. No credential, payment, revenue, payout, OAuth connection or
provider success was fabricated at any point.

| # | Blocker (Task 2 §5) | What was implemented | Status after this window |
| --- | --- | --- | --- |
| 1 | Gemini (`GOOGLE_API_KEY`) | `npm run launch:check` live-verifies the key (`GET /v1beta/models`) **and** performs a real `generateContent` call (`--deep`); `GOOGLE_API_KEY`/`GEMINI_API_KEY` accepted, `AKBARAL_VERIFY_GEMINI_MODEL` configurable; a rejection reports the provider's status code, a network failure reports `unreachable` — never "ready" | **Code complete + tested.** Blocked on the owner's key only |
| 2 | Search provider | Live probe per provider (Tavily → Brave → Serper → Google CSE → custom endpoint), auto-detected in the same precedence the runtime uses, with honest `provider_not_configured` when no key exists | **Code complete + tested.** Blocked on the owner's key only |
| 3 | Payments + webhook | Real Stripe-native webhook `POST /api/billing/webhook/stripe`: signature verified over the **raw** body (HMAC-SHA256 `t.payload`, constant-time, 5-minute replay tolerance, multiple `v1` signatures), event-id idempotency, normalization onto the internal contract, attribution rules, `503 webhook_not_configured` when the secret is missing. Checkout return URLs no longer use `akbaral.local` placeholders | **Code complete + tested.** Blocked on the Stripe account/key/webhook endpoint (owner) |
| 4 | Production secrets/domain | `AKBARAL_SITE_URL` now drives checkout returns as well as robots/sitemap; the launch check validates `SESSION_SECRET` strength, HTTPS, site URL, database persistence, upload/backup paths | **Code complete + tested.** Blocked on the production host + domain (owner) |
| 5 | Mission payout-slot verification | Evidence-based verification: named control checks + signed attestation (stored verbatim), partial submissions refused by name, 180-day expiry, invalidation when the destination changes (slot pauses), revocation pauses immediately. **Card numbers (Luhn) and IBANs (mod-97) are refused outright.** Owner-only, enforced at library level | **Code complete + tested + verified live.** Blocked on the owner configuring and verifying a real destination |
| 6 | Social OAuth preparation | Complete authorization-code flow for YouTube/Instagram/TikTok: minimum scopes, single-use owner-bound state + PKCE, AES-256-GCM token storage in the vault, tokens never returned by any read surface, honest `provider_not_configured` / `provider_rejected` / `provider_unreachable`, disconnect with provider-side revocation; dashboard Publishing tab shows the exact redirect URI to register | **Code complete + tested + verified live.** Blocked on each platform's app registration (owner) |
| 7 | Mission PostgreSQL (if required) | The mission runs on SQLite **or** PostgreSQL through the same driver bridge (isolation unchanged). The ledger's implicit `rowid` ordering became an explicit `seq` column with a backfilled hash chain; migration 0001 reordered by foreign-key dependency so one schema definition is valid on both engines | **Complete + proven end-to-end** on a real PostgreSQL server (`npm run mission:pg-check`: 10/10) |

### Added surfaces (all real, all tested)

* `npm run launch:check` — 13 checks, human table + markdown report + `--json`, `--offline`, `--deep`,
  `--only`, `--fail-on-broken`. Readiness is a percentage **over required checks only** and never reports
  higher than the evidence supports. Secrets are never printed: results carry **variable names**, lengths
  and provider status codes.
* `npm run smoke:task3` — the live smoke harness (`scripts/live-smoke-task3.mjs`) that exercises the above
  against a **running** deployment.
* `npm run mission:pg-check` — the mission's full money path on real PostgreSQL.
* Mission dashboard: **Publishing** tab + evidence-based **verify / re-verify / revoke** flow on Treasury.

---

## 2. Verification evidence (all run in this window)

| Gate | Command | Result |
| --- | --- | --- |
| Full test suite | `npm test` | **598 / 598 pass, 0 fail, exit 0** (was 550 before this window) |
| Type check | `npx tsc --noEmit` | exit 0, no diagnostics |
| Production build | `npm run build` | exit 0, **20 routes** compiled |
| Platform PostgreSQL | `npm run test:pg` | **22 / 22 pass** |
| Mission PostgreSQL | `npm run mission:pg-check` | **10 / 10 steps, 0 failures** |
| Mission unit/integration | mission suites (core, treasury, server, social, payout-verification) | **55 / 55 pass** (39 → 55) |
| Registry integrity | `npm run audit:registry` (live DB) | **PASS** — 4,001 distinct slugs |
| Secret scan | `npm run scan:secrets` | **PASS** — 22 allow-listed synthetic placeholders, no real markers |
| Live smoke (both stacks) | `npm run smoke:task3` | **39 / 39 pass, 0 fail** |
| Launch verification (live env) | `npm run launch:check` | **44.4 % required-readiness, 5 blockers** (exactly the owner-credential gaps) |

New tests added in this window (48): Stripe verification + normalization (13), Stripe webhook over HTTP
end-to-end (8), payout-destination verification (7), social OAuth connections (9), launch checks (11).

### Live proof that nothing is faked

* **Payments.** Against the running stack: an unsigned Stripe webhook → `503 webhook_not_configured`; a
  forged signature → refused; a correctly signed local settlement event → `200 effect=settled` and
  `credits granted 0 → 250`; the **same** signed event replayed → `duplicate=true, effect=ignored_duplicate`
  with no extra credits; a differently-signed event for the same invoice → `effect=already_paid`.
* **Provider honesty.** With no key: `not_configured`. With a deliberately fake key in this sandbox:
  `unreachable` — *"the credential was not verified"* — because this environment has no egress to Google or
  Tavily. The check never degraded into a guess, and it never reported ready.
* **Payout destinations.** Configuring `4111111111111111` was refused (`400 unsafe_destination`); a partial
  verification was refused (`409 verification_incomplete`); a complete one activated the slot with a real
  expiry (`2027-03-14`) and `payable: true`; revocation paused it immediately.
* **Publishing.** All three platforms report `not_configured` and are never shown as connected; starting an
  authorization without a registered app returns `503 provider_not_configured`; `guaranteedEngagement:false`.
* **Isolation.** The public homepage contains no mention of the mission codename; mission routes answer
  `401` to anonymous callers.

---

## 3. Live previews

| Deployment | Port | Process | Verified |
| --- | --- | --- | --- |
| AKBARAL! platform (Next.js web + Express API) | **3000** (web) / **4000** (API) | `akbaral-platform-web-api-5f406e7f` | `/` → 200, `/owner` → 200, `/api/health` → `{"status":"ok"}` |
| ZA141251SA mission control (private) | **4200** | `za141251sa-mission-control-priva-6e33f147` | dashboard → 200, `/api/health` → audit ✓ ledger ✓ vault ✓, 1 owner |

Both bind `0.0.0.0` and are reachable through the workspace preview proxy (ports 3000 and 4200).
The mission is private by design: it demands the owner's sign-in, and it is never linked from the public app.

---

## 4. Exact remaining blockers

Five required checks are not ready. Every one of them is an **owner credential or host decision**; there is
no code left to write for any of them.

1. **Model provider — Gemini key.** `GOOGLE_API_KEY` (or `GEMINI_API_KEY`) is unset. Every model-backed agent
   and MASTER AI return `provider_not_configured`.
2. **Search provider key.** None of `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `SERPER_API_KEY`,
   `GOOGLE_CSE_API_KEY`+`GOOGLE_CSE_ID`, `AKBARAL_SEARCH_ENDPOINT` is set. Web research falls back to the
   keyless provider, which datacenter IPs typically block.
3. **Payment provider.** No Stripe/Razorpay credential and no webhook signing secret. Credit purchases
   return `provider_not_configured`; only manual/admin settlement can mark an invoice paid.
4. **Database persistence confirmation.** `DATABASE_URL` points at a SQLite file (absolute path). This is a
   legitimate single-node production configuration **only** on a host with a persistent volume; the check
   cannot confirm the volume from inside the process.
5. **Upload persistence.** `AKBARAL_UPLOAD_DIR` is relative (`data/uploads`), so customer uploads would live
   on the container filesystem and be lost on redeploy.

Optional (not blockers, reported honestly as absent): transactional email/SMTP (password reset and email
verification answer `503 provider_not_configured`), a verified mission payout destination on the production
mission host, and the three publishing OAuth apps.

---

## 5. Exact owner actions

Run `npm run launch:check` on the production host after each step; it prints this same list with live
evidence. Values go into the deployment's secret store — **never into chat, and never into the repository**.

1. **Gemini:** Google AI Studio → create an API key → set `GOOGLE_API_KEY`. Then
   `npm run launch:check -- --only provider.gemini --deep` must report *ready* with a live `generateContent`.
2. **Search:** create a Tavily (recommended), Brave or Serper account → set its key (`TAVILY_API_KEY` /
   `BRAVE_SEARCH_API_KEY` / `SERPER_API_KEY`). Re-run the search check.
3. **Stripe:** create the account → set `STRIPE_SECRET_KEY` → add a webhook endpoint
   `https://<your-domain>/api/billing/webhook/stripe` subscribed to `checkout.session.completed`,
   `payment_intent.succeeded`, `payment_intent.payment_failed`, `invoice.paid`, `invoice.payment_failed`,
   `charge.refunded`, `customer.subscription.deleted` → set `STRIPE_WEBHOOK_SECRET` from that endpoint. Keep
   `BILLING_WEBHOOK_SECRET` set for the generic/manual path.
4. **Domain + URL:** point the domain at the deployment, terminate TLS, set `AKBARAL_SITE_URL=https://<domain>`
   (checkout returns, robots, sitemap). Optionally set `AKBARAL_CHECKOUT_SUCCESS_URL` / `_CANCEL_URL`.
5. **Persistence:** mount persistent volumes and set absolute paths — `DATABASE_URL=file:/data/akbaral.db`,
   `AKBARAL_UPLOAD_DIR=/data/uploads`, `AKBARAL_BACKUP_DIR=/data/backups` — or provision PostgreSQL (Neon)
   and migrate. Then confirm the backup cron writes to the volume.
6. **SMTP (optional):** create a transactional email account → `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/
   `SMTP_PASSWORD`/`SMTP_FROM` to enable password reset and email verification.
7. **Mission payout destination:** on the mission host, open the dashboard → **Treasury & payouts** →
   configure slot 1 with a *provider reference* or a *masked* description (`****4821`) → **Verify / re-verify**
   → confirm every control check and sign the attestation. Payouts remain refused until then; agents cannot
   perform this step.
8. **Publishing apps (optional):** register one OAuth app per platform and add the redirect URI the
   Publishing tab shows (`https://<domain>/api/social/oauth/<platform>/callback`), then set
   `YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET`, `INSTAGRAM_CLIENT_ID`/`INSTAGRAM_CLIENT_SECRET`
   (or `META_APP_ID`/`META_APP_SECRET`), `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`, then *Connect* in the
   dashboard. Publishing stays unavailable (never simulated) until then.

---

## 6. Production launch readiness

**44.4 % of required launch checks are verified ready (5 / 13).**

The number is deliberately conservative and evidence-based: all seven engineering items of Task 3 are
implemented, tested and verified live, but five required checks cannot pass without credentials or host
decisions that only the owner can make. When those five are done — every one of them a configuration change,
not development — the same command will report 100 %.

| Layer | Readiness |
| --- | --- |
| Code / integration (all seven Task-3 items) | **100 % — implemented, tested, committed** |
| Automated verification (`npm test`, build, PG, registry, secret scan) | **100 % pass** |
| Live behaviour on this deployment (both stacks) | **39 / 39 smoke checks pass** |
| Production credential + host configuration | **5 of 13 required checks ready → 44.4 %** |
| Overall production launch readiness | **44.4 % — blocked only by owner credentials/host decisions** |

---

## 7. Preservation guarantees (unchanged)

Everything from Tasks 1 and 2 remains intact and re-verified in this window: `renderTaskOutcome`, Knowledge
Search, the Google provider security model, the free-task refund policy, auth refresh rotation, the 4,001
agent registry (`audit:registry` PASS), the public agent API, Agent Factory lifecycle, platform↔mission
isolation and codename scrubbing, the Modal/Neon pipelines, Supervisor, secret handling, owner unlimited
execution, credit ledger/refund logic, the owner console, the private mission system and its invariants
(14 allowed activities / 15 prohibitions, realized revenue requiring `received` + verifier, payouts requiring
a verified slot + owner approval + settlement reference, permanently blocked card/bank APIs, hash-linked
ledger and audit chains, `recordRevenue` wallet sweep). Customer revenue and mission revenue remain in
separate ledgers, destinations and treasuries.

---

**Latest commit:** `c6267d4` on `arena/01a0a045-akbaral` (pushed), plus the commit carrying this report.
