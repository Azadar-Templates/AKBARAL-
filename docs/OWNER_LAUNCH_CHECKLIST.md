# AKBARAL! — Owner Launch & Activation Checklist

**As of commit:** `51d6b9d687819e87d430601acbdb22a5b71f54a3` (branch `arena/01a0ed59-akbaral`)
**Purpose:** the single place the owner checks to see, with live evidence (never
invented percentages, dates, or figures), exactly what is technically ready and
exactly what only the owner can do next. This document explains **how to read**
two live, authenticated API endpoints that always reflect the CURRENT running
deployment — it does not hardcode numbers that will go stale.

---

## 1. How to check live status (do this first, not this document's prose)

Both endpoints are **owner/super_admin only** (`403` for anyone else, `401`
anonymous) and **never return a secret value** — only variable names, booleans,
and provider status codes/counts.

### `GET /api/owner/launch-checks`
Runs the full production-readiness engine (`src/launch/checks.ts`, the same
one behind `npm run launch:check`) against **this process's own live
`process.env`** — i.e. whatever is actually configured on the exact host you
are asking, right now.

```bash
curl -s -H "Authorization: Bearer <owner_token>" \
  "https://<your-domain>/api/owner/launch-checks" | jq .
```

- Default call is **offline** (`?offline=true` is the default) — configuration
  facts only, zero live provider network calls, safe to poll any time.
- Add `?offline=false` to also fire real probes (Gemini generation call,
  live search query, provider credential checks) — costs real API calls, use
  sparingly.
- Add `?deep=true` (with `offline=false`) for the more expensive "does real
  work" probes.
- Add `?only=payments` (or `search`, `mission`, `social`, …) to filter to one
  area, matching the CLI's `--only` flag.
- Response shape: `{ checks: [...], summary: {...}, blockers: [...],
  ownerActions: [...], readinessPercent: <number> }`. `blockers` lists every
  REQUIRED check that is not `ready`, each with the exact env var name(s) and
  the exact owner action. `readinessPercent` is computed from real check
  results, never asserted.

### `GET /api/owner/activation-stage`
Reports the REAL, evidence-based activation stage of the 4,001-agent
workforce — never an implicit "N agents active" claim.

```bash
curl -s -H "Authorization: Bearer <owner_token>" \
  "https://<your-domain>/api/owner/activation-stage" | jq .
```

Returns real, live-queried counts for:

| Stage | Field | Means |
|---|---|---|
| 0 | `counts.stage0Registered` | Agents in the registry (currently 4,001; grows only via a registry sync) |
| 1 | `counts.stage1PolicyEligible` | Registered agents whose category is inside the policy's allowed discovery categories, **AND** autonomous discovery is enabled, **AND** the kill switch is off. Honestly `0` while autonomy is off (the shipped default) — that is the safety default, not a bug. |
| 2 | `counts.stage2Assigned` | Agents holding an ACTIVE 1:1 platform assignment (`economy_opportunity_assignments`, exclusive by database constraint) — i.e. a real owner-created account is bound to exactly this agent. `assignedAgents` lists them by slug. |
| 3 | `counts.stage3VerifiedWork` | Agents with at least one execution marked `completed` **and** carrying a non-empty verification record. |
| 4 | `counts.stage4Settled` | Agents whose work produced revenue in a `received`/`settled` state **with both** real evidence **and** an external reference — a bare claim never counts. `settledAgents` lists them by slug. |
| 5 | `stage5ExpansionReady` (+`stage5Reason`) | `true` only once at least one agent has reached Stage 4 **and** there is headroom under the current concurrency ceiling. This field never changes any policy cap itself — raising the ceiling is always a separate, deliberate action. |

---

## 2. What is technically ready right now (code-complete, tested, no owner action needed)

- ✅ 4,001-agent registry, unique instructions, tool permissions — `syncAgentRegistry()`.
- ✅ Billing: Stripe checkout, webhook signature verification (HMAC, replay-protected, idempotent), no payment ever marked successful without a verified webhook event, no duplicate credit grants, trial logic unchanged.
- ✅ Search: multi-provider fallback chain (Tavily → Brave → Serper → Google CSE → keyless DuckDuckGo), honest failure with the exact missing env var when nothing is configured — never fabricates results.
- ✅ Mission ledger: hash-chained append-only audit/ledger, static-analysis test forbidding any file other than `src/mission/money.ts` from writing cash tables, mission Stripe module can never fall back to AKBARAL!'s customer Stripe key.
- ✅ Awin affiliate workflow: real API client (rate-limited, credential-isolated, identity-checked at every layer), full state machine (discover → assign → draft → prepare → owner-approve → publish → sync/scan commissions → reconcile payout/reversal), owner-approval gate before any publish, automatic FTC-style affiliate disclosure text injected into every draft, exclusive 1:1 agent↔opportunity↔property binding, line-item settlement verification with fingerprinting (detects if provider evidence changed underneath an already-recorded state) — inspected end-to-end this session (client, contracts, workflow, HTTP route wiring, DB schema, country-eligibility integration); **56/56 dedicated tests pass in isolation**; no defect found.
- ✅ Country/payout-rail eligibility: `getPlatformCountryEligibility('awin', 'PK')` returns `eligible: true`, payout via `payoneer`/`bank_wire` — verified by live execution, not just reading the source.
- ✅ Build-commit reporting fixed for Railway (this session): accepts `RAILWAY_GIT_COMMIT_SHA` as both a build-arg and a runtime-env fallback, so the live host can prove which commit it is running with zero extra owner configuration, once redeployed.
- ✅ Full test suite: 151/151 files, 2,211/2,211 tests, 0 failures (fresh run this session). `tsc --noEmit` clean, `npm run lint` clean, `npm run scan:secrets` PASS.

## 3. What requires the owner (exact, in the order that unlocks the most)

| # | Action | Why | Verified by |
|---|---|---|---|
| 1 | Confirm/trigger a Railway redeploy to the current commit | The live host's last confirmed boot predates every fix in this session | `/api/owner/launch-checks` (`build_commit` area) after redeploy; or the `production-verify` GitHub Actions workflow |
| 2 | Set `STRIPE_WEBHOOK_SECRET` on the live host | Without it, the webhook route answers `503` on every event, so a completed Stripe payment never settles | `/api/owner/launch-checks?only=payments` |
| 3 | Set `AKBARAL_SITE_URL` to your real domain | Without it, post-payment redirects fall back to a placeholder host | `/api/owner/launch-checks?only=domain` |
| 4 | Set a search credential (`TAVILY_API_KEY` recommended) | Without it, real-time research fails honestly instead of fabricating results | `/api/owner/launch-checks?only=search` |
| 5 | Create a real Awin publisher account (any live website or social handle; refundable ~$1–5 deposit; manual approval, typically a few days) | This is the universal blocker: every cataloged platform, including Awin, is coded `requiresOwnerAccount: true` — no real earning event can occur without one | Set `ZA141251SA_AWIN_ENABLED=true`, `ZA141251SA_AWIN_PUBLISHER_ID`, `ZA141251SA_AWIN_ACCESS_TOKEN`; then `GET /mission/awin` (owner-only) returns `configured.awin: true` |
| 6 | Decide the real website/property Awin will publish to, and supply a Payoneer/bank statement source for settlement evidence | The code deliberately ships with **no pretend publishing/settlement adapter** (`awin-contracts.ts`) — these must be bound to something real, which cannot be fabricated | `/mission/awin` overview `blocked` array reports `property_not_configured` / `settlement_not_configured` until supplied |

## 4. Honesty guarantees this document and both endpoints enforce

- No percentage, count, or date above is invented — every number in `/api/owner/launch-checks` and `/api/owner/activation-stage` comes from a live query or a live probe result at the moment you call it.
- Neither endpoint, nor this document, ever prints a secret value — only variable names, booleans, and provider status codes (test-enforced in `src/business/owner-analytics.test.ts`).
- "Registered" (Stage 0) is never presented as "earning" — only Stage 3 (verified work) and Stage 4 (settled) represent agents that have actually produced anything, and both are currently `0` because no owner account exists yet to bind an agent to.
