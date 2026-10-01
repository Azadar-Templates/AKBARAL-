# P0 INTEGRATION REPORT — orphan branch `arena/01a0e6a0-akbaral` merged into session mainline

All evidence below is direct: live CI run output, local process output, and code reads — nothing here is
inferred from commit titles alone. No deploy, mission init, DB reset, credential change, or spend occurred.
Session branch is fixed to `arena/01a0ed59-akbaral` per this session's constraints; the merge was performed
on that branch instead of a separate throwaway branch, since creating another branch is out of scope for
this session — the effect (inspect → verify → merge → push → CI-build → report) is the same.

### BASELINE

- `main` @ `4acd993998ef4f0145d8068f2f08ffb57d7389b1` (unchanged, still the tip of `main`).
- Session branch `arena/01a0ed59-akbaral` started at the same commit.
- Orphan branch `arena/01a0e6a0-akbaral`: confirmed **8 commits ahead**, **0 commits behind** —
  `main` is a strict git ancestor of the orphan branch (`git merge-base --is-ancestor` = true). Clean
  fast-forward relationship; no divergence, no possible conflicts.

### ORPHAN BRANCH

8 commits, oldest → newest:
`6de6fe2` fix(realtime,security): keyset log cursor + production error boundary
`25c3d4a` ci(production-verify): install deps in real-gemini-direct; label provider failures honestly
`71de91e` fix(gemini): bounded backoff for transient 5xx + ListModels-driven model failover
`810f900` fix(research): enforce evidence freshness, source URLs and conflict reporting
`1535f76` feat(health): report the running build identity; probe Railway first
`4669924` test(production-verify): prove real tool execution, live freshness, image identity
`02c385c` test(gemini): make the SSE streaming failure diagnosable
`e49e481` ci(production-verify): serialise the two Gemini jobs (root cause: free-tier 429)

### DIFF

33 files changed, **3122 insertions(+), 280 deletions(-)**. New files:
`src/models/retry.ts`, `src/models/provider-retry.test.ts`, `src/orchestrator/research-evidence.ts`,
`src/orchestrator/research-freshness.test.ts`, `src/server/safe-errors.ts`,
`src/server/production-error-boundary.test.ts`, `scripts/verify-production-e2e.mjs` (new script).

Read every changed file's diff (not just titles) before merging:
- **No commit touches ZA141251SA/mission code** (`src/mission/*`, `src/routes/boss-dashboard.ts`,
  `src/routes/economy.ts` are all absent from the changed-file list).
- **No commit changes pricing** (no `$`, cents, plan-price, or Stripe-price edits anywhere in the diff).
- **No commit changes money/ledger logic** (`src/mission/money.ts`, `ledger-reconciliation.ts` untouched).
- **No commit weakens authentication/RBAC** — every `requireAuth`/`requireRole` call site in the diff is
  unchanged context; the actual changes in `src/routes/{admin,automations,master,realtime,tasks,workflows}.ts`
  only redact raw diagnostic text from API responses via the new `src/server/safe-errors.ts` module (a
  hardening, not a weakening).
- **Production behavior changes are all additive/observability**: new `build` field on `/api/health` and
  `/api/ready` (commit SHA/version/builtAt/source, no secrets); bounded provider retry (`maxAttempts` default
  3, no infinite loop); research-evidence freshness verdicts (`ok`/`no_date`/`stale`/`future`); a real bug fix
  in the SSE execution-log tailer (millisecond-collision cursor → keyset `(created_at, id)` cursor, so no log
  line is silently dropped).
- **No duplicate work**: none of these 8 commits' content already exists on `main` (checked by message and by
  the strict-ancestor relationship itself — if `main` already had this work, the ancestor check would show 0
  commits ahead).
- CORS default remains an explicit allow-list (unchanged); seeded admin account still has no password hash
  (unchanged, unrelated to this diff).

### SAFETY GATE (Phase 2) — PASS, nothing suspicious found

No secrets exposed (all env-var references are variable **names**, e.g. `GOOGLE_API_KEY`,
`STRIPE_WEBHOOK_SECRET`; test fixtures use clearly synthetic values like `'test-google-key'`/`'FAKE_KEY'`).
No fake credentials, no demo/fabricated revenue, no mission-money change, no mission-isolation weakening, no
owner-safety-control weakening, no auth bypass, no RBAC removal, no verification disabling, no uncontrolled
agent spawning, no customer pricing change. **Cleared to merge.**

### MERGE RESULT

Merged with `git merge --no-ff origin/arena/01a0e6a0-akbaral` on `arena/01a0ed59-akbaral`.
**Zero conflicts** (expected, given the clean ancestor relationship).
New HEAD: **`cff96c0a839b4ba8313b2605382be240df11f816`**.
Source branch `arena/01a0e6a0-akbaral` left untouched, not deleted. No force-push used (confirmed via
`git reflog` on the remote-tracking ref — a plain fast-moving update). No history rewritten.

### TEST RESULTS

- Local, immediately after merge: `npm run typecheck` → 0 errors.
- Local full suite (`npm test -- --all`): **2158/2158 pass, 0 fail, 161 suites** (up from the pre-merge
  baseline of 2103/153). **Delta explained exactly**: the merge added 3 new test files
  (`src/models/provider-retry.test.ts`, `src/orchestrator/research-freshness.test.ts`,
  `src/server/production-error-boundary.test.ts`) plus additional assertions inside existing files
  (`execution-stream.test.ts`, `health.test.ts`, `launch/checks.test.ts`, three `app/*-contract.test.ts`
  files, `automation.test.ts`) → +55 tests, +8 suites, +3 files (143→146). No test was removed or skipped.
- `npm run scan:secrets` post-merge → `PASS`, 0 real secrets, 22 allow-listed placeholders.
- CI re-confirmation (`verify` workflow, run `36582266072`, commit `cff96c0`): **SUCCESS in 15m27s** — this is
  an independent, second execution of typecheck + the full test suite + mission/browser contract checks on
  GitHub's own runner, not a repeat of the same local process. Matches the local result.

### IMAGE

CI's `docker-publish` workflow (run `36582266310`, triggered automatically by the push to
`arena/01a0ed59-akbaral`) completed **SUCCESS in 2m33s** and published:

```
ghcr.io/azadar-templates/akbaral@sha256:294afa958f238db23021580bfd23f217829447fbc06217212badf6fc3711784f
(commit cff96c0a839b4ba8313b2605382be240df11f816)
```

Built with `--build-arg GIT_SHA=${{ github.sha }}`, which the Dockerfile writes to `/app/.image-version`.
**This is a build, not a deployment** — GHCR now holds an image for this exact commit; nothing was pointed at
Railway. A local Docker build could not be attempted directly (no Docker daemon in this sandbox — recorded as
an environmental limitation, not a project defect); the CI-published image is the authoritative build.

### DEPLOYMENT

**Not performed. `DEPLOYMENT ACTION REQUIRED`.**

- Image digest: `sha256:294afa958f238db23021580bfd23f217829447fbc06217212badf6fc3711784f`
- Commit: `cff96c0a839b4ba8313b2605382be240df11f816`
- Railway target (only one proven live by CI's own `deployment-reachability` job this run):
  `https://akbaral-production.up.railway.app`
- This sandbox has no Railway deploy permission/access. The owner must deploy the image above to that target.

### LIVE IDENTITY

**`UNKNOWN` / NOT YET VERIFIED — and this was checked directly, not assumed.** CI's live `production-e2e` job
(run `36582266083`, against `https://akbaral-production.up.railway.app`) fetched the live `/api/health` and
found `build.commit: MISSING (source: n/a)` — the running Railway container does **not** yet have this
feature at all, confirming Railway is still serving a pre-merge image. `EXPECTED_COMMIT` was empty on this
push-triggered run (by design — it can only be supplied via manual `workflow_dispatch`, since an
asynchronously-deployed host can't be assumed to already be running the commit that just finished building).
By contrast, CI's **local** `image-e2e` job (image built fresh from `cff96c0` inside the CI runner) asserted
`live_commit === github.sha` as a **hard gate** and **PASSED**, with annotation
`container reports build commit cff96c0a839b4ba8313b2605382be240df11f816` — proving the build-identity
mechanism itself works correctly on the exact code just merged. Live identity will only become `VERIFIED`
once the owner deploys the image above and a subsequent `production-verify` run (ideally with
`expected_commit=cff96c0a839b4ba8313b2605382be240df11f816` supplied) shows `/api/health.build.commit` equal
to that value on the live host.

### RESEARCH

`src/orchestrator/research-evidence.ts` (new) implements exactly the required behavior, verified by reading
the code (not assumed from the commit message): a `verdict` of `'ok' | 'no_date' | 'stale' | 'future'` is
computed per piece of evidence — `'future'` when the evidence date is ahead of now, `'stale'` when older than
`maxAgeDays`, `'ok'` otherwise — and `src/orchestrator/research-freshness.test.ts` (391 new lines) exercises
all four paths. Live confirmation the *system* obeys "permit an honest refusal when fresh information cannot
be obtained, never manufacture current information": CI's `production-e2e` run against the live Railway host
reported `live current-data request did not complete; honest failure is the required behaviour when current
evidence cannot be established` — the system refused rather than fabricating, and the test explicitly treats
that refusal as the correct behavior while still surfacing the underlying gap (`search tool could not run on
the live host — configure a search credential`) as a visible, named blocker rather than hiding it.

### GEMINI

`src/models/retry.ts` (new, 153 lines) confirms **bounded** backoff: `maxAttempts` defaults to 3
(`DEFAULT_RETRY_POLICY`), configurable via `AKBARAL_PROVIDER_MAX_ATTEMPTS`, no unbounded/infinite retry loop
in the code. `.github/workflows/production-verify.yml` now runs `real-gemini-direct` strictly **after**
`real-providers` (`needs: [provider-inventory, real-providers]`) specifically to stop the two jobs from
racing the same free-tier Gemini key and self-inflicting 429s — documented in-line with the root-cause run id
that motivated it.

**Live result this run**: the 429 self-inflicted-concurrency problem is gone (no 429 appeared). `real-providers`
(the local-build, CI-secrets-based real Gemini call) **passed**, live-confirming the pinned model
`gemini-3.5-flash` actually works today (`live generateContent succeeded on gemini-3.5-flash`) — this
independently resolves the previously-flagged `gemini-3.8-flash` vs `gemini-3.5-flash` discrepancy in favor of
**`gemini-3.5-flash`**, the id that answered a real API call. `real-gemini-direct` (the direct streaming
check) **failed** this run with a **different, genuine, visible** transient error:
`streaming failed on gemini-3.5-flash after 7888ms with 0 token(s) received: google returned a server error
(HTTP 503)`. This is Google's own infrastructure returning a 503 mid-run, reported honestly with an exact
duration and token count — not a 429, not hidden, not retried away silently past its bounded attempt count.
Classified as a **transient external provider failure**, not a defect introduced by the merge; a re-run is
the appropriate next step, not a code change.

### BILLING

CI's `real-providers` job (local build, GitHub Actions secrets — **this is the CI test environment, not
Railway's production environment**, kept as separate classifications per this session's standing rule):
- `STRIPE_SECRET_KEY`: **CONFIGURED** (verified live in CI's test environment).
- `STRIPE_WEBHOOK_SECRET`: **not configured** (in CI's test environment) — `src/billing/stripe.ts` confirmed
  to reject with `503 webhook_not_configured` when absent, so payments would stay unsettled if this state
  persisted in a real deployment.
- `AKBARAL_SITE_URL`: **not configured** (in CI's test environment) — completed payments would redirect to a
  placeholder URL.
- **Railway's actual production values for all three remain `UNKNOWN`** — CI's `production-e2e` job (the one
  that does hit the live Railway host) did not report on Stripe/site-URL state this run, and this sandbox has
  no Railway dashboard access. Do not infer Railway's Stripe config from CI's.
- **Billing is not being claimed live.** No webhook/checkout/return round-trip was verified end-to-end.

### MISSION

ZA141251SA was **not** initialized, started, migrated, or touched. `src/mission/*`, `src/routes/economy.ts`
and `src/routes/boss-dashboard.ts` are absent from this merge's changed-file list — confirmed unchanged both
by the diff and by a direct post-merge diff check against the pre-merge commit. The previously-reported
`/api/boss/*` fail-open-auth finding (see `artifacts/MASTER_BLOCKERS.md` §B-1) is **unaffected by this merge**
and remains an open, separate item — it was not part of these 8 commits and was not fixed here.

### BLOCKERS

1. **Railway deployment is stale relative to `main`/this session branch** — confirmed live: `build.commit`
   is `MISSING` on the running container. Owner action required: deploy
   `ghcr.io/azadar-templates/akbaral@sha256:294afa958f238db23021580bfd23f217829447fbc06217212badf6fc3711784f`
   to `https://akbaral-production.up.railway.app`.
2. **Railway is missing a search credential** (`TAVILY_API_KEY` / `AKBARAL_SEARCH_ENDPOINT` or equivalent) —
   confirmed live via `production-e2e`; CI's own test environment has one configured, Railway does not.
3. **Railway's Stripe/site-URL configuration is `UNKNOWN`** — not checked this run; needs a
   production-verify pass that specifically probes the live host, or direct Railway dashboard confirmation.
4. **`real-gemini-direct` failed on a transient Google HTTP 503** this run — recommend re-running that single
   job; not a merge defect.
5. **`/api/boss/*` fail-open auth (MASTER_BLOCKERS.md §B-1)** remains open and unaffected by this merge —
   still the top-priority fix before any mission activation.
6. Stale PRs #8, #9, #13 (see below) still open on GitHub — not closed per instruction, classified only.

### NEXT ACTION

1. **Owner**: deploy the published image (digest above) to
   `https://akbaral-production.up.railway.app`, then re-run `production-verify` with
   `expected_commit=cff96c0a839b4ba8313b2605382be240df11f816` to move LIVE IDENTITY from UNKNOWN to VERIFIED.
2. **Owner**: decide whether to configure a search credential and Stripe webhook secret + site URL on Railway
   before treating research/billing as production-ready there.
3. Re-run `real-gemini-direct` alone to confirm the HTTP 503 was transient.
4. Fix `/api/boss/*` (MASTER_BLOCKERS.md §B-1) as the next code change, independent of this integration.
5. Do not merge PRs #8, #9, #13 — all three are superseded (see below); leave open per instruction, no
   automatic closure.

---

## Stale PR review (Phase 15)

| PR | Title | Ahead/behind vs current HEAD | Evidence | Recommendation |
|----|-------|------------------------------|----------|-----------------|
| #13 | feat(mission): verified-cash ledger reconciliation + fail-closed money gate (`arena/01a0e4e1-akbaral`) | 1 ahead / 1 behind (diverged) | Its one commit (`b1deedf`, "independent verified-cash ledger reconciliation") and `main`'s already-merged commit `4acd993` ("fail-closed ledger reconciliation per operation (#14)") share the same parent (`de88ec0`) and implement the **same feature**; PR #13's version is a **net -134 lines** relative to what `main` already has, i.e. a smaller/earlier take on the same problem that a different, already-merged PR (#14) superseded. | **SUPERSEDED** |
| #9 | Consolidate AKBARAL! + ZA141251SA: merge bdde+c510+b74e orphans, 1939 tests green (`arena/01a0cd5b-akbaral`) | 1 ahead / 16 behind | 16 commits behind current HEAD; merging would **delete 11,874 lines**, including all of `three-plane-isolation.test.ts` and large chunks of mission/workforce code that now exist on `main`. Predates the current architecture (1939 tests vs. today's 2158). | **SUPERSEDED** |
| #8 | fix(stackhost): use Webpack build to fit free-tier memory ceiling (`arena/01a0b101-akbaral`) | 4 ahead / 156 behind | 156 commits behind; merging would **delete 87,378 lines**. From Sept 17, predates nearly the entire current codebase. The underlying idea (a webpack build path for low-memory hosts) already exists independently on `main` today as the `build:webpack` npm script, confirmed working in this very session (used to complete the production build after the default Turbopack build was OOM-killed in this sandbox). | **SUPERSEDED** |

None were closed, per instruction — classification only, all left open for the owner to close.
