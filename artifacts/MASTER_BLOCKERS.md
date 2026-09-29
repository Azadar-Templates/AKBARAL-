# MASTER BLOCKERS — AKBARAL! + ZA141251SA

Generated during the second, stricter audit pass. Every item below was verified with direct evidence
(process output, code read, local disposable reproduction, or a live read-only HTTP call) — not inferred
and not trusted from prior report text alone. Where evidence could not be obtained from this sandbox, the
item is explicitly marked `UNKNOWN` rather than assumed.

Exact state at time of writing:
- HEAD: `4acd993998ef4f0145d8068f2f08ffb57d7389b1` (unchanged all session)
- Working tree: clean except `artifacts/` (this audit's own output) — confirmed via `git status --short`
- Test suite: `2103/2103 pass, 0 fail` (re-confirmed directly from the live process this pass)
- No deploy, mission init, DB reset, credential change, or spend occurred this session.

---

## B-1. [P0 — PRODUCTION BLOCKER] `/api/boss/*` fails open with no auth, mounted on the public AKBARAL! app

**Classification: PRODUCTION BLOCKER** (today: configuration/info-disclosure risk with limited blast radius
because mission has no data yet; **escalates to a full unauthenticated financial-data breach the instant
mission migrations/data exist in the same container** — must be fixed before that can ever be allowed to
happen).

- **What**: `src/app.ts` mounts `bossDashboardRouter` (`src/routes/boss-dashboard.ts`) at `/api/boss` on the
  same public Express app that serves AKBARAL! customer traffic (same process, same port, same container).
  Its `requireMissionAuth` middleware calls `next()` unconditionally whenever
  `ZA141251SA_DASHBOARD_TOKEN`/`MISSION_DASHBOARD_TOKEN` are unset — i.e. it fails open, not closed. There is
  no IP/origin allow-list actually implemented, despite an inline comment claiming "local-only access."
  Seven endpoints are affected: `/overview`, `/agents`, `/agents/:id`, `/treasury`, `/scheduler`, `/blocked`,
  `/opportunities`.
- **Contrast**: every other privileged router in this codebase (`src/routes/admin.ts`, `src/routes/owner*.ts`,
  `src/routes/economy.ts`) correctly uses `router.use(requireAuth, requireRole('owner'|'admin'|'super_admin'))`.
  `boss-dashboard.ts` is the one outlier using a bespoke, broken auth check instead of the standard idiom.
- **Proof (local, disposable, non-production)**: built an isolated sandbox at `/tmp/akbaral-boss-test`
  mirroring production defaults (customer DB migrated, no `ZA141251SA_*` env vars set — matching the
  Dockerfile, which never sets a dashboard token). An unauthenticated `GET /api/boss/overview` returned
  **HTTP 500** (`no such table: mission_agents`) instead of 401/403, and this single request **silently
  created `mission.db`/`-shm`/`-wal`** on disk. Sandbox and process fully cleaned up afterward; no repo,
  production DB, or production mission state was touched.
- **Not tested against live production**, deliberately: once the local reproduction showed a file-creation
  side effect, hitting the same route on the live Railway URL was avoided to comply with "do not initialize
  the mission" / "no production DB modification" (even a HEAD request risks triggering Express's default
  GET-handler execution). Therefore:
  **Whether Railway's production environment currently sets `ZA141251SA_DASHBOARD_TOKEN` /
  `MISSION_DASHBOARD_TOKEN` is `UNKNOWN`** — not checkable from this sandbox (no Railway dashboard/API
  access here), and not safe to probe live.
- **Zero test coverage** of this router's real HTTP/auth behavior. The only adjacent test
  (`src/security/three-plane-isolation.test.ts` ~L180-230) is a static regex check on SQL table names in
  source text and does not exercise `requireMissionAuth` at all.
- **Severity reasoning**: today, because mission migrations have never been run in production, hitting this
  route live would most likely also 500 — there is no real fleet/treasury/wallet/revenue data to leak yet.
  The danger is that (a) any internet caller can force the app to write a new file into the shared production
  `/data` volume, (b) the error response discloses the existence and internal naming of the mission system to
  an anonymous prober, and (c) if mission migrations/data are ever introduced into that same container while
  this bug is unfixed, `/api/boss/*` would hand real fleet/treasury/wallet/revenue figures to any
  unauthenticated visitor whenever the token env vars happen to be unset — a silent, easy-to-miss
  misconfiguration given the router's own comment incorrectly claims it's already safe.
- **Required fix (not performed this session — audit only)**: replace `requireMissionAuth` with the standard
  `requireAuth + requireRole('owner','super_admin')` idiom already used by `admin.ts`/`owner*.ts`/
  `economy.ts`, OR make the middleware fail **closed** (reject with 401/403) when no token is configured, and
  add an HTTP-level auth test for every route in this file before any mission data is ever allowed to exist
  in the same container. This must ship before mission initialization in production is ever considered.
- **Owner action required**: confirm (via the Railway dashboard, not this sandbox) whether
  `ZA141251SA_DASHBOARD_TOKEN`/`MISSION_DASHBOARD_TOKEN` is currently set on the live service, and treat an
  unset value as an active incident requiring an immediate token or a hotfix deploy.

## B-2. [UNKNOWN — cannot be resolved from this sandbox] Deployment identity of the live Railway build

- Per this session's explicit instruction, deployment identity may **not** be inferred from image tag,
  latest-timestamp, a successful push, or matching runtime behavior. No endpoint on the live app exposes a
  build/commit identifier (`/api/version` returns 404; no `X-Build-Sha` or similar header was observed).
- Live health/ready checks and the `/api/public/registry-stats` 4001-agent match are strong circumstantial
  evidence the deployed build is consistent with this repo's current agent catalog, but this is explicitly
  **not** proof of exact commit identity per the instructed evidentiary bar.
- **Classification: `DEPLOYMENT IDENTITY = UNKNOWN`** (stated exactly as required, not guessed).

## B-3. [UNKNOWN] GHCR image publish/visibility

- `gh api /orgs/Azadar-Templates/packages/container/akbaral-` and `/user/packages/container/akbaral-` both
  return 404 in this sandbox. This is inconclusive — most likely a missing `read:packages`/org-scope on the
  `gh` token here — and is **not** proof the image doesn't exist or isn't visible.
- The `docker-publish` CI workflow on `main`@`4acd993` completed with a green/SUCCESS run, which is evidence a
  publish attempt succeeded from CI's perspective.
- **Classification: GHCR image digest/visibility = `UNKNOWN`** (do not report as confirmed published or
  confirmed missing).

## B-4. [UNKNOWN] Railway production environment variable values

- No access to the Railway dashboard/API from this sandbox. All Railway-side environment variable values
  (dashboard token, mission DB URL override, seed flag, CORS origins, etc.) are **UNKNOWN** and were not
  assumed from the Dockerfile defaults, which only describe the image's baked-in defaults, not what Railway
  actually has configured at runtime.
- This directly affects the real-world severity of B-1 — see above.

## B-5. [RESOLVED / NOT A BLOCKER] `src/routes/economy.ts` mission-chat import

- Investigated as an open thread from the previous continuation. **Confirmed safe**: the entire router is
  gated by `router.use(requireAuth, requireRole('owner','super_admin'))` (L90), applied uniformly to all
  routes including the three mission-chat functions it imports. No fix needed here.

## B-6. [INFORMATIONAL — not a blocker] Tool-to-agent assignment asymmetry

- 11 of 18 registered tool handlers (`youtube_publish, instagram_publish, x_post, shopify_product,
  twilio_message, stripe_payment, http_request, json_transform, text_analyze, csv_parse, maps_place`) are not
  referenced by any of the 4,001 catalog agents; they are used instead by the smaller workforce/primary
  platform-account agent population (`src/workforce/execution.ts`, `src/social/platforms.ts`). Not a defect,
  but worth keeping in the merge-plan documentation so nobody assumes all 18 tools are catalog-agent-usable.

---

## Summary table

| ID | Item | Classification | Confirmed by |
|----|------|----------------|--------------|
| B-1 | `/api/boss/*` fails open, publicly mounted | **PRODUCTION BLOCKER** | Code read + local disposable HTTP reproduction |
| B-2 | Deployed commit identity | **UNKNOWN** | No build-identity endpoint exists |
| B-3 | GHCR image visibility/digest | **UNKNOWN** | `gh api` 404s, inconclusive |
| B-4 | Railway production env values | **UNKNOWN** | No dashboard/API access from sandbox |
| B-5 | `economy.ts` mission-chat auth | **RESOLVED — safe** | Code read, router-wide RBAC confirmed |
| B-6 | 11/18 tools unused by 4,001 catalog | **INFORMATIONAL** | Direct registry vs. catalog cross-reference |

**Recommended next phase order**: fix B-1 first (small, isolated, testable change) and add an HTTP-level auth
test for `boss-dashboard.ts` before anything else touches the mission system; resolve B-2/B-3/B-4 by asking
the human owner to check the Railway dashboard and GHCR package settings directly (outside this sandbox's
reach); then proceed with the rest of the P0/P1/P2/P3 roadmap in `artifacts/MASTER_MERGE_PLAN.md`.
