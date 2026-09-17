# AKBARAL! — production launch status (final report)

Generated from the verified state of branch `arena/01a0a045-akbaral`.
Every number below was produced by a command that is named next to it. Anything
not verified is marked **UNVERIFIED** or **NOT CONFIGURED** — nothing here is
simulated, and nothing is described as working that was not exercised.

- **Commit:** `e59c1ff` (pushed; full chain this phase: `14efc41` → `483452d` →
  `8c1abb4` → `16d6396` → `336fe12` → `a40697f` → `e59c1ff`)
- **Container image:** `ghcr.io/azadar-templates/akbaral@sha256:a298c6c5…`
  (published by `docker-publish`, green on every push)
- **Production URL: NONE YET.** No public host serves AKBARAL!. The in-sandbox
  production build runs on `http://127.0.0.1:3000` (web) / `:4000` (API), and
  the sandbox preview URL is **not** publicly reachable (a GitHub runner gets
  HTTP 403 there — proof: `deployment-reachability` report below). The public
  URL appears the moment the owner runs the published image on a host with
  DNS/TLS, and the same workflow then proves it automatically.

## 1. Exact blockers remaining (all require the owner — none can be done from this sandbox)

The sandbox has no network egress to provider APIs (only `api.github.com`
answers), and the repository secret store is empty. Each item below is the
complete remaining action; the CI channel that will flip it to verified already
exists.

| # | Blocker | Exact owner action | How it is proven afterwards |
|---|---|---|---|
| 1 | Real Gemini | Create a key in Google AI Studio → GitHub repo secret `GOOGLE_API_KEY` (deployment env on the host) | `real-gemini-direct` job calls Google with the key and refuses a canned answer |
| 2 | Real search | Set one of `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` / `SERPER_API_KEY` | `real-providers` job exercises the real search API |
| 3 | Stripe payments + webhooks | Set `STRIPE_SECRET_KEY`; create a webhook endpoint at `https://<domain>/api/billing/webhook/stripe` subscribed to `checkout.session.completed`, `payment_intent.succeeded`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`; set `STRIPE_WEBHOOK_SECRET`; set `AKBARAL_SITE_URL` (return URLs) | `real-providers` job verifies the key; a real purchase then settles through the webhook |
| 4 | SMTP | Set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` (+ `SMTP_PORT`, `SMTP_FROM`) | `real-providers` job; until then password reset / verification return an honest 503 |
| 5 | Real reachable host + domain/TLS | Run the already-published image on a host (free tiers work: Fly.io / Render / Railway, or any VPS with `docker-compose.production.yml`), point DNS and TLS at it, set `AKBARAL_SITE_URL` + `PRODUCTION_BASE_URL` | `deployment-reachability` probes the host and, when it answers, `production-e2e` runs the full MASTER flow against it |
| 6 | Mission payout destination | Verify one of the four payout slots in the mission dashboard (owner decision; no account details are required before then) | `verify:mission-money` payout path |
| 7 | Social publishing OAuth (optional) | Register the YouTube / Instagram / TikTok apps and set their client IDs/secrets | publishing agents stop returning `provider_not_configured` |
| 8 | Android signing (optional) | Provide the signing keystore | release build |

`launch:check` (with `DATABASE_URL=file:./data/akbaral.db`):
**66.7 % required readiness (7/13)**; the three failing required checks are
exactly #1 (Gemini), #2 (search) and #3 (payments).

## 2. Exact verified items (blockers #6–#10, live against the production build)

| Blocker | Verifier | Result |
|---|---|---|
| #6 single identity (ZA141251SA: only `zanaveed555@gmail.com` authenticates, everyone else blocked with zero mission-data access) | `verify:mission-lock`, identity-lock unit tests | **17/17** live; 9/9 unit; foreign login → 403 `identity_restricted`; anonymous read → 401; foreign sessions revoked |
| #7 this Gmail is AKBARAL! Owner/Admin with unlimited usage; all other accounts are normal users | `verify:owner-identity`, **new** `verify:owner-entitlement` | **18/18** + **19/19** live; one owner row and it is the configured Gmail; staff rows carry no password; normal user refused on owner + staff planes (403); exhausted ordinary account honestly failed with **zero** credits consumed; owner run completed with a real step graph (2 steps, 2 695-char result) consuming **zero** credits, audited `owner.unlimited_execution` |
| #8 real-money wallet/ledger, governed spending, earning/reinvestment, fixed daily target | `verify:mission-money` + unit | **41/41** live; owner funding idempotent; 1 000 auto + 3 000 approved expense → wallet 8 000→4 000; double-pay 409; over-cap and kill-switch 409; unverified "received" 400; 4 001 verified revenue → 25 % to treasury reserve, mission keeps 3 001; daily target counts verified revenue only; both hash chains verify |
| #9 4 001 agents genuinely executable and routed through MASTER | `verify:agent-fleet` | **16/16** live; 4 001 agents in the registry, 4 001 distinct system instructions; dispatcher/verifier outcomes; every result document discloses its mode (`deterministic` under the preview fixture — real model answers appear once `GOOGLE_API_KEY` is set) |
| #10 complete production E2E / security / recovery | **new** `verify:recovery`, `verify-production-e2e.mjs`, `smoke:shell`, secret-scan gate | **25/25** recovery drill (below), production E2E all checks passed in labelled fixture mode, **71/71** shell checks, secret-scan 5/5 + `scan:secrets` PASS |
| #5 production build runs | `npm run build`, container `image-e2e` | build OK; container image E2E green at `e59c1ff`: USER JOURNEY **20/20**, REFRESH **23/23**, plans=6, agents=50, paid plan refused HTTP 402 |

Recovery drill (`npm run verify:recovery`, 25/25) — non-destructive, works on
copies of the live files: verified snapshot of the *serving* platform database
(38 703 104 B, `integrity ok`, row counts identical to live), an unverifiable
backup is refused, a deliberately damaged live file is restored over while the
unreadable original is preserved verbatim as `pre-restore-unreadable-<stamp>.db`,
the restored database is fully migrated, an API booted **on the restored file**
reports `/api/ready`, signs the owner in (200), refuses a wrong password (401)
and still serves 4 001 agents; the mission database snapshots the same way and
its hash-chained audit (152 rows) and ledger (35 rows) verify, with exactly one
ACTIVE owner (the configured email), the foreign owner suspended and zero
foreign live sessions. The drill also asserts it leaves no runaway process.

## 3. Tests

- **Unit/integration suite: 703/703 passing, 0 failures, exit 0** across all 73
  `src/**/*.test.ts` files (`npm test`, log `/tmp/full-suite9.log`).
  99 suites, including the security gate (`src/security/scan-secrets.test.ts`).
- Live batteries on the production runtime: refresh 23/23, user journey 20/20,
  owner identity 18/18, owner entitlement 19/19, mission lock 17/17, mission
  money 41/41, agent fleet 16/16, recovery 25/25, shell 71/71.
- CI at `e59c1ff`: `docker-publish` success, `production-verify` success
  (image-e2e, provider-inventory, deployment-reachability, real-providers);
  `real-gemini-direct` and `production-e2e` skipped — they require the owner
  credentials / a live host (items #1 and #5 above).

Defects found and fixed while producing the evidence above (each committed):

- `16d6396` — restore refused to run when the live file was corrupt (its
  pre-restore snapshot could not be taken); now the unreadable file is preserved
  and the restore proceeds.
- `a40697f` — the repository's own secret-scan gate was failing on a literal
  forged bearer token in a verifier (tokens are now built at runtime), and the
  recovery drill orphaned the verification API it started (now its own process
  group, port asserted released).
- `8c1abb4` — the shell smoke drove a non-website goal and then asserted the
  website-artifact path.
- `483452d` — the owner credential files held a 4-character placeholder
  password (register enforces length, login did not); the owner secret is now a
  24-character random value held only in the gitignored mode-600 file, and the
  mission credential mirror matches its secrets file.

## 4. Honest state of the launch decision

Every remaining blocker is an owner action outside this sandbox. Nothing in the
product is faked to fill the gap: missing providers return
`provider_not_configured`, missing SMTP returns an honest 503, the deployment
probe says the host is not serving, and MASTER results disclose when they came
from the deterministic path rather than a real model. **AKBARAL! is not
declared LIVE** — the GO/NO-GO call belongs to the owner, and it becomes a
genuine GO once items #1–#5 are configured and the push-triggered workflow
re-verifies them against the real host.
