# AKBARAL! + ZA141251SA — Consolidation Audit

**Date:** 2026-09-23
**Repository:** `https://github.com/Azadar-Templates/AKBARAL-.git`
**Workspace:** `/home/user/AKBARAL-`
**Scope:** factual audit only. **No merge, rebase, reset, force-push, branch deletion, or file deletion was performed.** Every number below came from a command run in this workspace; the command is named next to the claim.

---

## 0. Executive summary

There are **three independent lines of real work** in this repository, and **none of them is a superset of the others**:

| Line | Tip | Files | What only it has |
|---|---|---|---|
| `origin/main` (== current HEAD) | `b92fb85` 2026-09-22 | 422 | Opportunity catalog + OmniRoute + billionaire-daily + Blitz/Docker port & permission fixes |
| `origin/arena/01a0bdde-akbaral` | `2f3e6bb` 2026-09-21 | 607 | Mission resource economy, workforce, earning engine, 6 platform connectors, owner safety gate, verified money, 25 mission migrations |
| `origin/arena/01a0b74e-akbaral` | `991dfe8` 2026-09-19 | 447 | 8 files never merged anywhere: command quotas, economy commands, inventory import |

**`main` is a single squashed commit with no common ancestor to any other branch** (`git merge-base origin/main origin/arena/01a0bdde-akbaral` → `fatal: no merge base`; `git merge-tree` → `fatal: refusing to merge unrelated histories`). Prior `main` history (`e118c35`, `c38a1cd`, `2917b93` — all named in Actions run titles) is **not fetchable** from the remote.

**`main` is red.** `npm test` at HEAD exits **1**. Cause identified and reproduced (see §5.4). `npm run typecheck` passes.

**There is no verified live production deployment.** The green `keep-alive` runs are vacuous — both ping steps are `skipped` (see §6).

A naive `git merge` of the trunk into `main` produces **56 add/add conflicts** (measured, §4.3) plus a **silent migration-ordinal collision** that git cannot see (§5.1).

---

## 1. Current branch and HEAD

| Item | Value | Command |
|---|---|---|
| Current branch | `arena/01a0cd5b-akbaral` | `git rev-parse --abbrev-ref HEAD` |
| HEAD | `b92fb85c96c9ff6e409278c045df38e930aeb849` | `git rev-parse HEAD` |
| Local branches | `arena/01a0cd5b-akbaral`, `main` — **both at `b92fb85`** | `git branch -vv` |
| Remotes | one: `origin` → `https://github.com/Azadar-Templates/AKBARAL-.git` (fetch+push) | `git remote -v` |
| Tags | none | `git tag` |
| Stash | empty | `git stash list` |
| Worktrees | only `/home/user/AKBARAL-` | `git worktree list` |
| Commits reachable from HEAD | **1** | `git rev-list --count HEAD` |
| Objects | 4026 in-pack, 2 packs, 0 dangling | `git count-objects -v`, `git fsck --lost-found` |

The original `fetch` refspec in `.git/config` was narrowed to `+refs/heads/main:refs/remotes/origin/main`, so **15 of 16 remote branches were invisible** until this audit widened the fetch (`git fetch origin 'refs/heads/*:refs/remotes/origin/*' 'refs/pull/*/head:refs/remotes/origin/pr/*'`). This is a fetch-config change only; no refs were rewritten.

---

## 2. Latest successful commit

**HEAD commit `b92fb85`** — `feat(mission): scalable 100M+ opportunity catalog (0009) merged with billionaire daily per-agent`

- Author / Committer: `Azadar-Templates <127788045+Azadar-Templates@users.noreply.github.com>`
- AuthorDate == CommitDate: **Tue Sep 22 19:40:28 2026 +0000**
- Co-authored-by: `arena-agent`
- It is a **root commit** (no parent) — the entire visible history of `main` is this one commit.

**CI status of that commit**

| Workflow | Result | Evidence |
|---|---|---|
| `docker-publish` on `main` @ `b92fb85` | **success**, 2026-09-22T19:40:32Z, run `35775302603` | `gh run list` |
| `keep-alive` on `main` | **success**, 2026-09-23T05:07:39Z, run `35821126500` — but see §6, it proves nothing | `gh run view 35821126500 --json jobs` |
| `npm run typecheck` locally at HEAD | **PASS** (exit 0, ~17 s) | run in this workspace |
| `npm test` locally at HEAD | **FAIL, exit 1** | run in this workspace |

> ⚠️ The commit message of `b92fb85` claims *"Tests: 68 PASS … Typecheck PASS, build PASS"*. That claim does not hold on this tree: the project's own `npm test` runner stops non-zero at the 12th test file. See §5.4.

**Lost history:** Actions run titles reference `merge main e118c35`, `merge main c38a1cd`, `Blitz user 1000 fix 2917b93`. `git fetch --depth=1 origin <sha>` fails for all three — those commits are unreachable. Whatever `main` looked like before the squash is not recoverable from this remote.

---

## 3. Uncommitted changes

**None.**

| Check | Result |
|---|---|
| `git status` | `nothing to commit, working tree clean` |
| `git diff --stat HEAD` | empty |
| `git status --porcelain` | empty |
| `git status --porcelain --ignored` | empty |
| `git stash list` | empty |
| `git fsck --lost-found` | no dangling objects |

I did run `npm ci` (200 packages, 33 s) and `npm test` in this workspace to obtain the build-health datapoints. Both leave the tracked tree clean — `node_modules/`, `dist/`, `.next/` are gitignored (`.gitignore` lines 2, 5, 38) and `test.db` is likewise ignored. Verified after the runs: `git status --porcelain --ignored` still empty, HEAD still `b92fb85`.

**There are no local-only changes at risk.** All work worth preserving is on the remote.

---

## 4. Branch differences

### 4.1 All remote refs

`git ls-remote origin` returns **16 branches and 8 PR refs**.

| Branch | Commits | Tip date | Files | vs `main` (main-only / branch-only) | Merge base with `main` |
|---|---|---|---|---|---|
| `main` | 1 | 2026-09-22 | 422 | — | — |
| `arena/01a0bdde-akbaral` | 261 | 2026-09-21 | 607 | 1 / 261 | **NONE** |
| `arena/01a0ba0a-akbaral` | 250 | 2026-09-20 | 570 | 1 / 250 | **NONE** |
| `arena/01a0b74e-akbaral` | 163 | 2026-09-19 | 447 | 1 / 163 | **NONE** |
| `arena/01a0b101-akbaral-remote` | 160 | 2026-09-17 | 408 | 1 / 160 | **NONE** |
| `arena/01a0b101-akbaral` | 158 | 2026-09-18 | 407 | 1 / 158 | **NONE** |
| `arena/01a0af54-akbaral` | 153 | 2026-09-17 | 407 | 1 / 153 | **NONE** |
| `arena/stackhost-sh-disallow-fix` | 148 | 2026-09-17 | 406 | 1 / 148 | **NONE** |
| `arena/stackhost-3s-registry-fix` | 147 | 2026-09-17 | 406 | 1 / 147 | **NONE** |
| `arena/stackhost-yaml-schema-fix` | 146 | 2026-09-17 | 406 | 1 / 146 | **NONE** |
| `arena/stackhost-fix-1789648208` | 144 | 2026-09-17 | 406 | 1 / 144 | **NONE** |
| `arena/01a0aef5-akbaral` | 142 | 2026-09-17 | 406 | 1 / 142 | **NONE** |
| `arena/01a0a045-akbaral` | 140 | 2026-09-17 | 405 | 1 / 140 | **NONE** |
| `arena/01a085d2-akbaral` | 88 | 2026-09-14 | 301 | 1 / 88 | **NONE** |
| `arena/01a07c3c-akbaral` | 27 | 2026-09-08 | 133 | 1 / 27 | **NONE** |
| **`arena/01a0c510-akbaral`** | **3** | **2026-09-22** | **427** | **0 / 2** | **`b92fb85`** ✅ |

`refs/pull/1..8/head` resolve to the same tips as `a045`, `aef5`, `stackhost-fix-1789648208`, `stackhost-yaml-schema-fix`, `stackhost-3s-registry-fix`, `stackhost-sh-disallow-fix`, `af54`, `b101` respectively.

### 4.2 Pull requests (`gh pr list --state all`)

| PR | Title | Head | State |
|---|---|---|---|
| 1 | Deploy AKBARAL production | `arena/01a0a045-akbaral` | MERGED 2026-09-17 |
| 2 | fix(stackhost): resolve silent startup failure on deploy | `arena/01a0aef5-akbaral` | MERGED 2026-09-17 |
| 3 | fix(stackhost): resolve silent startup failure on deploy | `arena/stackhost-fix-1789648208` | MERGED 2026-09-17 |
| 4 | fix(stackhost): correct build schema — list not string | `arena/stackhost-yaml-schema-fix` | MERGED 2026-09-17 |
| 5 | fix(stackhost): make agent registry sync non-blocking so 3s probe passes | `arena/stackhost-3s-registry-fix` | MERGED 2026-09-17 |
| 6 | fix(stackhost): use direct Node start (StackHost disallows sh) | `arena/stackhost-sh-disallow-fix` | MERGED 2026-09-17 |
| 7 | fix(stackhost): use plain npm ci and disable strict engines | `arena/01a0af54-akbaral` | MERGED 2026-09-17 |
| **8** | **fix(stackhost): use Webpack build to fit free-tier memory ceiling** | `arena/01a0b101-akbaral` | **OPEN** since 2026-09-17, `build-and-push` check **pass** |

PRs 1–7 are marked merged, but because `main` was later squashed into one root commit, **those merges are not represented in `main`'s history** — the content survived only where the squash captured it, which (per §5) it did not do completely.

### 4.3 Internal ancestry (which branches are already contained)

`git merge-base --is-ancestor` proves the following are **fully contained** in `origin/arena/01a0bdde-akbaral`:

`01a085d2` · `01a0a045` · `01a0aef5` · `01a0af54` · `01a0ba0a` · `stackhost-3s-registry-fix` · `stackhost-fix-1789648208` · `stackhost-sh-disallow-fix` · `stackhost-yaml-schema-fix`

So `bdde` (261 commits) **is the trunk of the branch world**: it strictly contains `ba0a` (250) and 8 other branches. It does **not** contain `b74e`, `b101`, `b101-remote`, `07c3c`, `c510`, or `main`.

### 4.4 Content delta, `main` ↔ `bdde` (measured)

```
git diff --name-status origin/main origin/arena/01a0bdde-akbaral
  A (in bdde, absent from main) : 200
  D (in main, absent from bdde) :  15
  M (present in both, differs)  :  56
  common and byte-identical     : 351      (351+56+15 = 422 = main; 351+56+200 = 607 = bdde)
```

**A real merge was simulated** in a throwaway worktree (`git worktree add /tmp/mergeprobe origin/main`, then `git merge --no-commit --no-ff --allow-unrelated-histories origin/arena/01a0bdde-akbaral`) and then discarded (`git worktree remove --force`). Result: **exit 1, exactly 56 add/add conflicts**, matching the 56 `M` files one-for-one. The 200 + 15 unique files land without conflict. The primary workspace was never touched — `git status` clean and HEAD `b92fb85` before and after.

### 4.5 Unique content per branch (what would be lost by only merging the trunk)

Measured with `git diff --diff-filter=A origin/arena/01a0bdde-akbaral origin/<branch>`:

| Branch | Files it has that `bdde` lacks |
|---|---|
| `arena/01a0c510-akbaral` | **20** — opportunity catalog (4 modules + test), `0008_billionaire_daily_per_agent.sql`, `0009_opportunity_catalog.sql`, `0010_opportunity_catalog_postgres_scale.sql`, `src/models/omniroute.ts`, `scripts/exhaust-free-sources.ts`, `EXHAUST_REPORT.json`, `mirror-ghcr-to-dockerhub.yml`, `deploy/free-caasify/README.md`, 5 docs/reports |
| `arena/01a0b74e-akbaral` | **8** — `db/migrations/0022_command_quotas_inventory.sql`, `src/economy/commands.ts`, `src/economy/agent-report.ts`, `src/workforce/inventory-import.ts`, `src/workforce/inventory-import.test.ts`, `src/economy/za-autonomy.test.ts`, `src/economy/za-autonomy-routes.test.ts`, `src/app/economy-ui.test.ts` |
| `arena/01a0b101-akbaral-remote` | **1** — `.github/workflows/stackhost-install-diag.yml` (6 diagnostic commits, research artifact) |
| `arena/01a07c3c-akbaral` | **0** — content fully contained in `bdde` |
| `arena/01a0ba0a-akbaral`, `arena/01a0b101-akbaral` | **0** — ancestors of `bdde` |

`b74e`'s 8 files are **genuinely unmerged**: `git log origin/arena/01a0bdde-akbaral -- <path>` returns **0 commits** for each of them, i.e. `bdde`'s history never contained them, so they were never merged and never deliberately deleted. They exist only in `991dfe8`.

---

## 5. Missing or conflicting work

### 5.1 Migration ordinal collision — the most dangerous issue, and git cannot see it

`applyMissionMigrations()` in `src/mission/database.ts` does:

```ts
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
// … records each FILENAME in mission_migrations and applies it once
```

**Migration identity is the filename.** Both lines used the same ordinals for completely different work. A merge yields this directory (produced for real in the simulated merge):

```
0007_reinvestment_daily_target.sql          ← identical on both (verified: same blob)
0008_billionaire_daily_per_agent.sql        ← main line
0008_payout_binding.sql                     ← bdde line
0009_opportunity_catalog.sql                ← main line
0009_resource_provisioning.sql              ← bdde line
0010_agent_messages.sql                     ← bdde line
0010_opportunity_catalog_postgres_scale.sql ← c510 line
0011 … 0032                                 ← bdde line only
```

**Verified facts that bound the risk:**

- `db/migrations-mission/0001`–`0007` are **byte-identical** on both branches (7/7 same blob).
- `db/migrations/` and `db/migrations-pg/` `0001`–`0017` are **byte-identical**; `bdde` adds `0018_workforce`, `0019_production_blockers`, `0020_workforce_earning`, `0021_primary_assignments` to both directories.
- **No cross-line dependency:** `grep` over `bdde`'s `0008`–`0032` finds **zero** references to `mission_opportunities*` or `billionaire`. The catalog migrations reference only `mission_agents` (created in `0001`) and their own tables.
- Therefore **filename coexistence is functionally safe** — lexicographic order happens to be a valid dependency order.
- **But renumbering is unsafe:** `ALTER TABLE … ADD COLUMN` is **unguarded** in `0008_billionaire_daily_per_agent.sql` (3 statements, lines 21–23) and in `0010_opportunity_catalog_postgres_scale.sql` (3 statements, lines 16–18). Any database that already recorded `0009_opportunity_catalog.sql` in `mission_migrations` would treat a renamed `0033_opportunity_catalog.sql` as new, re-run it, and fail with *duplicate column name*.

→ **Do not renumber.** Keep the existing filenames. Duplicate ordinals are cosmetically ugly but inert; renaming risks breaking an already-migrated database.

### 5.2 Capability matrix — the two lines are disjoint, not overlapping

Checked by testing the existence of each path on both branches (`git cat-file -e`):

| Capability | `main` | `bdde` |
|---|---|---|
| Owner safety gate (`owner-safety-gate.ts`, `0032_owner_safety_gate.sql`, disclosure doc) | **0/3** | 3/3 |
| Verified money / verified revenue (`money.ts`, `0016_verified_money.sql`, `settlement-verification.ts`) | **0/3** | 3/3 |
| Workforce wallets (`src/workforce/wallets.ts`) | **0/1** | 1/1 |
| Earning engine (`earning-engine.ts`, `0028_earning_engine.sql`) | **0/2** | 2/2 |
| Platform connectors (Upwork, Fiverr, AWIN, Contra, Toptal, Freelancer) | **0/6** | 6/6 |
| Resource calls / budgets / deadlines / periods | **0/3** | 3/3 |
| Continuous + workforce scheduler | **0/2** | 2/2 |
| Mission chat worker (`chat-worker.ts`, `chat-provider.ts`) | **0/2** | 2/2 |
| Workforce module (`execution.ts`, `delegation.ts`, `routes/workforce.ts`) | **0/3** | 3/3 |
| Resumable test runner (`test-resumable.mjs`, `lib/test-checkpoint.mjs`) | **0/2** | 2/2 |
| **Opportunity catalog** (`opportunity-catalog/ingestion/matching/sources.ts`, `0009_opportunity_catalog.sql`) | 5/5 | **0/5** |
| **OmniRoute provider fallback** (`omniroute.ts`, inventory docs) | 2/2 | **0/2** |
| **Billionaire daily per-agent** (`0008_billionaire_daily_per_agent.sql`) | 1/1 | **0/1** |

Present on **both**: ZA141251SA auth (`src/mission/auth.ts`, `identity-lock.ts`, `destination-safety.ts`), mission treasury & payout verification, `src/billing/`, `src/security/` (jwt, password, ssrf, webhooks, role-separation, mission-modules), `src/models/router.ts` + `client.ts` + `catalog.ts`, `src/realtime/`, `src/db/queue-repositories.ts`, all 22 Next.js routes (`src/app/**` — **identical file list on both branches**), `mission-dashboard/`, `deploy/` (10 of 11 files identical; `deploy/free-caasify/README.md` is main-only), `docker-compose.production.yml` (**identical blob**).

`registry-audit.json` (main): `totals.registered = 4013`, verdicts `ACTIVE 4000`, `FAILED 12`, `NEEDS_CONFIGURATION 1`, `activeShare 0.9968`; `agents` array length 4013. `src/agents/registry.test.ts` asserts `total >= 4001`.

### 5.3 The 56 conflicting files, classified by how they must be resolved

Classification from `git diff --numstat origin/main origin/arena/01a0bdde-akbaral --diff-filter=M` (`+bdde` = lines bdde has that main lacks, `-main` = lines main has that bdde lacks):

**A. bdde is a strict superset → take bdde (7 files)**

| File | +bdde | −main |
|---|---|---|
| `README.md` (repo root — note `deploy/free-snapdeploy/README.md` is a *different* file and is a true merge) | 2 | 0 |
| `mission-dashboard/styles.css` | 4 | 0 |
| `next.config.mjs` | 21 | 0 (`AKBARAL_LOW_MEMORY_BUILD` support) |
| `package-lock.json` | 275 | 0 |
| `src/business/owner-analytics.test.ts` | 30 | 0 |
| `src/economy/economy.test.ts` | 1 | 0 |
| `src/economy/policy.ts` | 65 | 0 |

**B. main is a strict superset → take main (1 file)**

| File | +bdde | −main | Why main must win |
|---|---|---|---|
| `src/agents/registry.ts` | 0 | 71 | main has `syncAgentRegistryNonBlocking()` — the fix from **PR #5** that yields to the event loop every 100 agents so the 4,001-agent catalog sync (~35–45 s) does not block `/api/ready` and kill the container on StackHost. **bdde does not have it.** `git grep -c syncAgentRegistryNonBlocking` → main: 1 hit, bdde: 0. |

**C. True bidirectional merge required (48 files)**

Highest-stakes, by churn:

| File | +bdde | −main | What each side uniquely holds |
|---|---|---|---|
| `src/mission/server.ts` | 949 | 430 | bdde: resource-call / chat / earning endpoints · main: opportunity-catalog endpoints |
| `src/mission/treasury.ts` | 735 | 723 | bdde: verified-money + allocation policy · main: billionaire-daily + verified-revenue-only counting |
| `mission-dashboard/app.js` | 697 | 55 | both extended the same dashboard |
| `src/mission/mission-server.test.ts` | 459 | 92 | both added suites |
| `src/economy/treasury.ts` | 456 | 221 | both reworked treasury |
| `src/mission/payout-verification.ts` | 197 | 181 | |
| `src/mission/self-management.ts` | 191 | 12 | |
| `src/mission/policy.ts` | 133 | 106 | |
| `src/app/stackhost-deploy.test.ts` | 123 | 7 | |
| `src/economy/operations.ts` | 99 | 160 | |
| `stackhost.yaml` | 64 | 14 | see §5.5 — main's is newer |
| `src/models/router.ts` | 52 | 55 | bdde: usage/cost plumbing · main: OmniRoute case |
| `src/db/database.ts` | 3 | 419 | see §5.6 — bdde split it into `driver.ts` |
| `src/mission/reporting.ts` | 1 | 113 | main: `opportunityCatalog` stats in `buildMissionOverview` |
| `src/models/catalog.ts` | 2 | 88 | main-only: OmniRoute + `auto` provider entries |
| `src/config/env.ts` | 5 | 42 | **both have a fix the other lacks** — bdde fixes `Number('')` silently disabling retry backoff; main adds `OMNIROUTE_BASE_URL`/`OMNIROUTE_API_KEY` resolution. **Must hand-merge, not pick a side.** |
| `package.json` | 14 | 7 | bdde: `test-resumable`, `@playwright/test`, `@sparticuz/chromium`, 3 new `mission:*` workers, expanded `test:pg`/`mission:pg-check` · main: inline `build` asset copy |
| `scripts/verify-mission-money.mjs` | 15 | 271 | |
| `Dockerfile` | 9 | 11 | see §5.5 |
| `.env.example`, `src/config/credentials.ts`, `src/app.ts`, `src/index.ts`, `src/server/health.ts`, `src/server/health.test.ts`, `src/tools/registry.ts`, `src/db/economy-repositories.ts`, `src/routes/economy.ts`, `scripts/start-prod.mjs`, `scripts/mission-sync-registry.ts`, `scripts/mission-init.ts`, `scripts/mission-pg-check.ts`, `src/mission/database.ts`, `src/mission/mission-treasury.test.ts`, `.github/workflows/docker-publish.yml`, `deploy/free-snapdeploy/README.md`, `mission-dashboard/index.html`, `src/models/client.ts`, `src/security/attack-surface.test.ts`, `src/security/role-separation.test.ts`, `src/billing/billing.test.ts`, `src/config/env.test.ts` | | | |

**D. Trivial / mechanical (7 files)**

Five test files differ by a **single byte at identical length** — no CRLF involved (`main=11187B bdde=11187B`, `grep -c $'\r'` = 0 on both): `src/billing/stripe-webhook.http.test.ts`, `src/models/models-api.test.ts`, `src/orchestrator/factory-templates.test.ts`, `src/routes/marketplace-world.test.ts`, `src/server/app.test.ts`. Take either side.

`src/security/attack-surface.test.ts` (−30) and `src/security/role-separation.test.ts` (−50): **main has the newer test-teardown fix** — *"stop queue and scheduler BEFORE closing servers and DB to avoid 'database is not open' async race"*. bdde has the older version. Take main for these two.

### 5.4 `main` is red — root cause found and reproduced

`npm test` at HEAD → **exit 1**, stopping at the 12th test file, `src/app/prod-roles.test.ts`:

```
not ok 4 - default ports are unchanged for every existing deployment
  error: PORT=<api port> must not move the web tier (no collision)
         4000 !== 3000
# tests 6  # pass 5  # fail 1
```

Reproduced in a clean environment (`env -u PORT -u AKBARAL_API_PORT -u AKBARAL_WEB_PORT`) → same failure, so it is **not** sandbox contamination (`PORT` is not set in this environment at all).

**Root cause — proven by experiment:**

- `src/app/prod-roles.test.ts` is **byte-identical** on `main` and `bdde` (blob `7ed7bb37` on both).
- `scripts/start-prod.mjs` differs. main's version carries a comment dated **2026-09-22**: *"Blitz fix … `web — AKBARAL_WEB_PORT, else PORT, else 3000` (always honors PORT)"*. bdde's version keeps the older contract: *"`PORT` when it does not collide with the API port, else 3000"*.
- Running the identical test against bdde's `scripts/start-prod.mjs` in a throwaway worktree: **6/6 pass**.
- Against main's version: **5/6, test 4 fails.**

→ **main's own 2026-09-22 Blitz port change altered the deployment contract without updating the contract-lock test.** This is a genuine semantic conflict, not a textual one: main's behaviour is what Blitz needs (`PORT=4000` → web on 4000, API moves to 4001), while the test still encodes the pre-Blitz contract. Resolving it is a **decision**, not a mechanical merge — either keep main's newer behaviour and rewrite test 4, or restore bdde's semantics and lose the Blitz fix.

### 5.5 Deployment files conflict, and main is newer

**`stackhost.yaml`**
- `main` (2026-09-22): `runtime.image: ghcr.io/azadar-templates/akbaral:latest`, `build: []` — *"source build needs ~1GB RAM and fails at 'Creating build environment' on the Free tier; use the already-published GHCR image so StackHost only creates the runtime container."*
- `bdde` (≈2026-09-19): `runtime.image: node:22` + a 5-step heap-capped source build (`npm cache clean` → `npm ci` → `tsc` at 384 MB → `copy-backend-runtime-assets.mjs` → `next build --webpack` at 320 MB), with measured RSS numbers per step.

main's approach is strictly newer and removes the build-RAM problem entirely. **Take main's `stackhost.yaml`.**

**`Dockerfile`** — main-only, dated 2026-09-22:
```dockerfile
# Blitz fix (2026-09-22): blitz.cloud runs as user 1000:1000 with all caps dropped, never as root.
RUN mkdir -p /data/uploads /data/backups /app/data && chown -R 1000:1000 /data /app && chmod -R 755 /app && chmod -R 777 /data
```
Without it, `/data/akbaral.db` open fails with `SQLITE_CANTOPEN` and the container shows *Internal Server Error* with no useful log. **This must survive the merge.** main also bumps `EXPOSE 3000 4000 8080` and `start-period=40s`, and its `HEALTHCHECK` mirrors main's port semantics — so the Dockerfile and `start-prod.mjs` decisions in §5.4 are **coupled** and must be resolved together.

**`.github/workflows/docker-publish.yml`** — a hidden integration hazard:
- main's inline verification step hardcodes `/app/dist/src/db/database.js`.
- bdde refactored that module (see §5.6), so the compiled artifact becomes `dist/src/db/driver.js`. bdde therefore extracted the check into `scripts/verify-compiled-pg.mjs`, which does `require('../dist/src/db/driver.js')`.
- **If the db split is adopted and main's workflow is kept, `docker-publish` will fail.** Take bdde's version of this step (and keep main's two extra `paths:` triggers, minus the dangling one below).

**Dangling reference:** main's `docker-publish.yml` lists `.github/workflows/blitz-audit.yml` in its `paths:` filter, but that file **does not exist on any branch** (checked on `main`, `bdde`, `c510`). Harmless as a trigger path, but it is dead config.

### 5.6 Structural divergence: the `src/db` module split

`bdde` refactored the platform driver:

| Path | `main` | `bdde` |
|---|---|---|
| `src/db/database.ts` | **13,839 B** (monolith, exports `Database` + `export const db`) | **430 B** (facade: `export * from './driver'` + `export const db = new Database()`) |
| `src/db/driver.ts` | — | 14,633 B |
| `src/db/display-target.ts` | — | 762 B (credential-stripping for log output) |
| `src/db/financial-transaction.ts` | — | 1,079 B |

Verified: every exported symbol in main's `database.ts` (`RunResult`, `SqlValue`, `DbEngine`, `resolveDbEngine`, `translateSqlForPg`, `placeholdersToPg`, `class Database`) is present in bdde's `driver.ts`; the only main-only symbol is the `export const db` singleton, which bdde's 430-byte facade re-exports. **main's `database.ts` contains no logic bdde lacks** — the 419-line delta is the move, not new work.

Dependents of the split on `bdde`, counted by `git grep -nE "from '(\.\.?/)+db/driver'|from '\./driver'"` and the equivalent greps for the two helper modules:

- `db/driver` — **2** TypeScript importers: `src/db/database.ts` (the facade) and `src/mission/database.ts`.
- `db/financial-transaction` — **7** TypeScript importers: `src/db/economy-repositories.ts`, `src/economy/execution-accounting.ts`, `src/economy/operations.ts`, `src/economy/treasury.ts`, `src/mission/database.ts`, `src/workforce/execution.ts`, `src/workforce/platforms.ts`.
- `db/display-target` — **3** importers: `src/db/driver.ts`, `src/db/database-display.test.ts`, `src/mission/database.ts`.

(A wider `git grep -l "db/driver"` returns 8 paths, but 6 of those are docs and build/verify scripts — `GAP_REPORT.md`, three `docs/*.md`, `scripts/copy-backend-runtime-assets.mjs`, `scripts/verify-compiled-pg.mjs` — not importers. The importer count is 2, not 8.)

→ **Adopting bdde's split loses nothing from main, and ~10 bdde TypeScript files depend on it — including the 200-file mission/workforce/earning body that `main` does not have at all.**

### 5.7 `c510` — the latest opportunity-catalog work

`origin/arena/01a0c510-akbaral` is the **only** remote branch with a real merge base with `main` (`b92fb85`). It is `main` + 2 commits, both 2026-09-22:

- `1d070cb` 20:02 — *97 sources, 126 real opportunities, 15 connectors, postgres-scale migration, honest 100M path report*
- `ecf26ad` 20:18 — *expand to 107 free/no-card sources, 5021 genuine opportunities via exhaustive GitHub pagination*

`git merge-tree --write-tree origin/main origin/arena/01a0c510-akbaral` → **exit 0, clean** (fast-forward). Delta: 10 files, +6,185 / −245.

Files: `EXHAUST_REPORT.json` (+2,309), `MISSION_OPPORTUNITY_REPORT.md` (+217), `MISSION_OPPORTUNITY_REPORT_EXPANSION.md` (+179), `db/migrations-mission/0010_opportunity_catalog_postgres_scale.sql` (+82), `scripts/exhaust-free-sources.ts` (+149), and modifications to `opportunity-catalog.ts` / `.test.ts` / `opportunity-ingestion.ts` / `opportunity-sources.ts` / `server.ts`.

**Note on scale:** this is the "latest 100,000 opportunity-catalog work" referenced in the brief. The verified numbers in the commits are **107 sources and 5,021 opportunities**, not 100,000; `0009_opportunity_catalog.sql` is *designed* for 100M+ (42 tables, cursor pagination, dedup hash) but the committed honest count is 5,021. Both commits' `docker-publish` runs succeeded (runs `35777699771`, `35779470257`).

---

## 6. Deployment status

**Bottom line: no verified live deployment. Nothing proves the product is serving traffic today.**

| Evidence | Finding |
|---|---|
| `keep-alive` on `main`, latest run `35821126500` (2026-09-23T05:07Z), conclusion `success` | **Vacuous.** `gh run view --json jobs` shows steps: `Ping production /api/health` → **skipped**, `Ping the API container` → **skipped**, `Not configured yet — skip silently` → success. The workflow's own comment says *"Until they exist, every run skips gracefully (no failures, no noise)"* — the `PRODUCTION_PING_URL` secret is not set. **These green runs are not a heartbeat.** |
| `production-verify`, last run `35146300873` — **2026-09-16**, 7 days ago, on branch `arena/01a0a045-akbaral` | `image-e2e` **passed** (pulls the image for that commit, boots it, creates an owner account, runs real journeys). `real-providers` passed. `deployment-reachability` passed. **`production-e2e` → SKIPPED**, `real-gemini-direct` → SKIPPED. So CI has never once verified a live host. |
| `.github/production-targets.json` | 3 candidates: `https://3000-i32tynr9veyl7uq0oz1nb.e2b.app`, `https://akbaral.duckdns.org`, `https://azadar-templates--akbaral.modal.run`. The file's own comment warns the e2b hostname *"changes when the workspace is recreated"* — and this workspace's ID is `01a0cd5b`, so that entry is **stale by construction**. |
| Probing those 3 hosts from this sandbox | All returned **HTTP 000**, `curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL` (DNS resolved: 34.102.227.47 / 39.34.131.172 / 44.217.60.1). Control probe to `api.github.com` → **200**, so egress works in general. **I cannot distinguish "host is down" from "this sandbox's egress is filtered to an allowlist" — treat this result as inconclusive, not as proof the hosts are down.** |
| GHCR image `ghcr.io/azadar-templates/akbaral:latest` | Anonymous token request for `repository:azadar-templates/akbaral:pull` returned **no token** → the package is not publicly pullable. **I could not verify that a published image exists.** (`docker-publish` reports success, which is indirect evidence only.) |
| `docker-publish` on `main` @ `b92fb85` | **success**, run `35775302603`, 2026-09-22T19:40:32Z |
| PR #8 | **OPEN** since 2026-09-17, `build-and-push` check **pass** |
| `stackhost.yaml` on `main` | Points at the prebuilt GHCR image, `build: []` |

**Deploy assets present and identical on both lines:** `Dockerfile`, `docker-compose.production.yml` (identical blob), `scripts/entrypoint.sh`, `scripts/start-prod.mjs` (differs, see §5.4), `deploy/modal/akbaral_app.py`, `deploy/free-oracle/` (Caddyfile + compose + setup-vm.sh), `deploy/free-render|zeabur|clawcloud|snapdeploy/`, plus main-only `deploy/free-caasify/README.md`.

---

## 7. Exact recommended merge plan

**Principles:** never `--force`; never delete a branch; never rewrite `main`; merge into the session branch `arena/01a0cd5b-akbaral` first and let a PR be the promotion gate; each stage is independently revertible.

### Stage 0 — Safety net (no risk)
1. `git tag audit/pre-consolidation-2026-09-23 b92fb85` and push the tag. A tag is an immutable recovery point that costs nothing.
2. Record the pre-merge SHAs of all 16 branches (this document, §4.1) — that is the rollback table.
3. Widen the fetch refspec permanently so this blind spot cannot recur:
   `git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'`

### Stage 1 — Take `c510` (zero conflict, already proven)
`git merge --no-ff origin/arena/01a0c510-akbaral` → `git merge-tree` already proved this is clean.
Brings in: 107 sources / 5,021 opportunities, `0010_opportunity_catalog_postgres_scale.sql`, `exhaust-free-sources.ts`, the two mission reports, `EXHAUST_REPORT.json`.
**Gate:** `npm run typecheck` must stay green.

### Stage 2 — Bring in the trunk `bdde` with `--allow-unrelated-histories`
`git merge --no-commit --no-ff --allow-unrelated-histories origin/arena/01a0bdde-akbaral`
Expect **exactly 56 conflicts** (measured). Resolve per the classification in §5.3:

| Group | Count | Resolution |
|---|---|---|
| A — bdde superset | 7 | take bdde |
| B — main superset | 1 | take main (`src/agents/registry.ts` — do **not** lose `syncAgentRegistryNonBlocking`) |
| D — trivial | 7 | 5 byte-identical-length test files: either side · `attack-surface.test.ts` + `role-separation.test.ts`: take main (teardown race fix) |
| C — true merge | 41 | hand-merge, both sides carry unique logic |

(7 + 1 + 7 + 41 = 56, verified by `git diff --numstat … --diff-filter=M | awk` → A=7, B=1, C=48, of which 7 are the trivial group D.)

**Non-negotiables inside group C:**
- `src/config/env.ts` — keep **both** fixes (bdde's `Number('')` guard **and** main's OmniRoute resolvers).
- `src/models/catalog.ts`, `client.ts`, `router.ts` — keep main's OmniRoute entries **and** bdde's usage/cost plumbing.
- `src/mission/reporting.ts` — keep main's `opportunityCatalog` stats **and** bdde's 113 lines of mission reporting.
- `package.json` / `package-lock.json` — union the scripts and devDeps, then regenerate the lockfile with `npm install --package-lock-only` rather than picking a side.
- `src/db/*` — adopt bdde's `driver.ts` / `display-target.ts` / `financial-transaction.ts` split (proven to lose nothing, §5.6).
- `.github/workflows/docker-publish.yml` — take **bdde's** `scripts/verify-compiled-pg.mjs` step (mandatory once the db split lands), keep main's extra `paths:` triggers, **drop** the dangling `blitz-audit.yml` entry.
- `src/agents/registry.ts` — take **main**.

**Stage 2 gate (all must pass before committing):**
`npm ci` → `npm run typecheck` → `npm test` → `npx tsc -p tsconfig.backend.json --noEmit` → confirm `db/migrations-mission/` contains 35 files with **no duplicate table definitions** across the two 0008/0009/0010 pairs.

### Stage 3 — Decide the port contract (§5.4) — an explicit owner decision
This cannot be resolved mechanically. Two coherent options:

- **Option 3a (recommended): keep main's 2026-09-22 Blitz behaviour** — `PORT` always moves the web tier, API shifts to 4001 on collision. Then **rewrite `prod-roles.test.ts` test 4** to assert the new contract, keeping tests 5 and 6 (which already pass). Must also keep main's `Dockerfile` `HEALTHCHECK`, which mirrors the same arithmetic.
- **Option 3b: restore bdde's contract** — `PORT == apiPort` keeps web on 3000. Test 4 then passes unmodified (verified: 6/6 against bdde's script), but the Blitz `PORT=4000` deployment regresses.

Either way, `Dockerfile`, `scripts/start-prod.mjs`, `stackhost.yaml` and `prod-roles.test.ts` must be changed **together** — they encode the same contract in four places.

### Stage 4 — Cherry-pick the orphans
1. `origin/arena/01a0b74e-akbaral` commit `991dfe8` — the **only** home of 8 files (`db/migrations/0022_command_quotas_inventory.sql`, `src/economy/commands.ts`, `src/economy/agent-report.ts`, `src/workforce/inventory-import.ts` + 4 tests). `git checkout origin/arena/01a0b74e-akbaral -- <the 8 paths>` is safer than `cherry-pick` here, because the commit also touches 57 files that `bdde` has since superseded. Verify each of the 8 compiles against the merged tree before keeping it.
2. `.github/workflows/stackhost-install-diag.yml` from `arena/01a0b101-akbaral-remote` — a 2026-09-17 memory-diagnostic artifact. Its measurements already live in bdde's `stackhost.yaml` comments. **Recommend retiring it**, but preserve it in the tag from Stage 0 either way.

### Stage 5 — Do **not** touch migration filenames
Leave `0008_billionaire_daily_per_agent.sql`, `0009_opportunity_catalog.sql`, `0010_opportunity_catalog_postgres_scale.sql` exactly as they are. Duplicate ordinals are inert (no cross-line dependency, verified); renaming them would re-trigger 6 unguarded `ALTER TABLE … ADD COLUMN` statements against any already-migrated database. Instead, add a short comment header to each of the three files recording the ordinal collision and why the names are frozen.

### Stage 6 — Verify, then promote
1. Full local gate: `npm ci && npm run typecheck && npm test && npm run build`.
2. `npm run mission:pg-check` and `npm run test:pg` (bdde adds several test files to both).
3. Open a PR from `arena/01a0cd5b-akbaral` → `main`. Let `docker-publish` and `production-verify` run on the PR.
4. Merge with a **regular merge commit** (`--no-ff`). No force-push, no history rewrite.
5. Only then consider closing PR #8 (superseded if Stage 3 picks option 3a with main's image-based `stackhost.yaml`).

### Stage 7 — Fix the deployment blind spot (independent of the merge)
- Set the `PRODUCTION_PING_URL` repository secret, or the `keep-alive` heartbeat stays vacuous.
- Update `.github/production-targets.json` — the `e2b.app` entry is stale by construction.
- Trigger `production-verify` with `workflow_dispatch` so `production-e2e` actually runs against a live host for the first time since 2026-09-16.

---

## 8. What I could not verify

Stated plainly rather than guessed:

1. **Whether the three production hosts are actually up.** All three returned HTTP 000 with a TLS `SSL_ERROR_SYSCALL`, while `api.github.com` returned 200. I cannot separate "host down" from "sandbox egress allowlist".
2. **Whether the GHCR image exists.** The package is not anonymously pullable, so I could not fetch a manifest. `docker-publish` success is indirect evidence only.
3. **Whether any live database has already applied `0009_opportunity_catalog.sql`.** That determines how much Stage 5 matters; it needs an operator with database access. No credentials were requested or used.
4. **The pre-squash history of `main`.** `e118c35`, `c38a1cd`, `2917b93` are unreachable from the remote and not present locally. If they matter, recovery would have to come from a clone that still has them.
5. **Whether `b74e`'s 8 orphan files still compile** against the merged tree — they were written on 2026-09-19 against a `src/db/database.ts` monolith that Stage 2 replaces with the `driver.ts` split. This is exactly why Stage 4 gates on a compile.

---

## 9. Commands run (all read-only unless noted)

```
git status / branch -vv / log / rev-parse / rev-list --count / ls-tree / cat-file -e
git remote -v / tag / stash list / worktree list / count-objects -v / fsck --lost-found
git fetch origin 'refs/heads/*:refs/remotes/origin/*' 'refs/pull/*/head:refs/remotes/origin/pr/*'   # widened fetch
git ls-remote origin
git merge-base --is-ancestor / merge-base / rev-list --left-right --count
git diff --name-status|--numstat|--shortstat|--diff-filter=A|D|M
git merge-tree --write-tree
git show <ref>:<path>
git worktree add --detach /tmp/mergeprobe|/tmp/mp2|/tmp/mp3 … then git worktree remove --force   # throwaway, discarded
git merge --no-commit --no-ff --allow-unrelated-histories   # inside throwaway worktrees only, then --abort/removed
gh auth status / pr list --state all / pr checks 8 / run list / run view --json jobs
npm ci          # 200 packages, 33 s        (gitignored artifacts only)
npm run typecheck   # exit 0
npm test            # exit 1 — src/app/prod-roles.test.ts test 4
curl probes of the 3 production targets + api.github.com control
```

**Nothing was pushed. No branch was deleted, reset, rebased, or force-pushed. `main` was not modified. The working tree is clean and HEAD is still `b92fb85`.**
