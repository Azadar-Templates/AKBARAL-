# First real execution through the sandbox and the four gates — 2026-10-10

This file records what was actually executed on 2026-10-10 against real infrastructure and
real GitHub data, and — just as important — what was **not** executed. Every number below
came from a command that ran in this environment; nothing here is inferred from
configuration, and no simulated or fixture run is presented as production work.

## 1. What this evidences

| Claim | Status |
| --- | --- |
| A repository archive was downloaded from GitHub and executed inside the sandbox | **evidenced** |
| Tests ran inside the sandbox and a failing test was refused by the verification gate | **evidenced** |
| The sandbox boundary (host visibility, PID namespace, egress) was probed, not assumed | **evidenced** |
| The live claim recheck ran against real GitHub issues and recorded fail-closed verdicts | **evidenced** |
| Migrations 0046/0047 apply cleanly to a pre-existing mission database | **evidenced** |
| A bounty fix was submitted to an upstream repository | **not done — owner action required** |
| Revenue was earned or a payout was settled | **no — ledger and revenue stay at zero** |

## 2. Sandbox capability, as probed

`node_modules/.bin/tsx scripts/mission-fleet-readiness.ts --backends` reported (live):

```
unshareVersion 2.38.1 · requiredUtilLinux 2.36 · maxUserNamespaces 15734
node /usr/local/bin/node · runtimes [node, sh, tar, gzip, python3] · namespaceSmoke NS_OK
docker: absent · podman: absent · runc: absent · bwrap: absent · firejail: absent
```

Because no container runtime exists here, the **OCI backend is reported unavailable** — it
is not silently counted as a sandbox. The kernel-namespace jail
(`src/mission/earning/namespace-bounty-sandbox.ts`) was selected only after the probe
passed, with its own staged rootfs:

```
rootfs digest 4777191c121a43668bc46f64d9880440bc4d512738ee46721204e697a07f3561 · 30 files
boundary: hostVisible [] · pids 1 · egress blocked
```

The boundary is self-checked before any repository content is executed: reading the host's
`/etc/passwd` from inside the jail is denied, a second process cannot see host PIDs, and
outbound network access fails closed.

## 3. Real archive, executed, tests run

The operator harness fetched the **published archive of this repository** (`main` at the
time of the run) through `GithubBountyClient.downloadRepositoryArchive`, staged it into
the jail, inspected it and ran commands inside the jail.

| Step | Result |
| --- | --- |
| Archive | 7,977,994 bytes · `sha256 dcae99c615e301bc7bb764992a208edbdbed16f03410eab3125de3aa3e2e9ba4` |
| Repository metadata | `defaultBranch main · archived false · fork false` |
| Inspection | `ok true` · `entries=200; package=akbaral-master-ai; scripts=dev,start,serve,next:dev,next:start,build,build:webpack,brand:build,brand:check,typecheck,test,db:migrate` · report `sha256 56b570efc9d5a84785948a2a606ffa6a2a6f44bd61471ea52ba9619d3205e261` |
| Verification (in jail) | `ok true` · `applied mission-sandbox-check.cjs; 2 command(s)` · report `sha256 42853549d96d3fffef7ea44acb205f9fbdd4c8d0d13446e6c3b0f3733d44b3ed` |
| Command 1 | `node mission-sandbox-check.cjs` → exit **0**, output `MIGRATIONS_ORDERED 1..45 (48 files)` / `CHECKS_PASSED 4/4` |
| Command 2 | `node --check scripts/start-prod.mjs` → exit **0** |

### The same gate refusing, verbatim

The first pass of that harness ran a check whose assertion was wrong for this repository.
It was **not** accepted:

```
verification.ok = false
argv ["node","mission-sandbox-check.cjs"] exitCode 1
AssertionError [ERR_ASSERTION]: migration numbering must be contiguous at index 8
  8 !== 9
report sha256 2760b7b5533f69701676d6754602a5856196498add3753301251c0ae97fcd7c5
```

The assertion was naive — `db/migrations-mission/` legitimately contains repeated numbers
(`0008_billionaire_daily_per_agent.sql` and `0008_payout_binding.sql`), and
`applyMissionMigrations` orders by filename — but the behaviour under test is the one that
matters: a non-zero exit inside the jail turns the verification red, and a red
verification cannot be promoted to work.

The check executed here is **operator-authored**, not model-generated, and it is a
dependency-free repository check. The repository's own suite needs `node_modules`, which
the network-less jail does not have; that is a stated limitation of this evidence, not a
passed test.

## 4. Live claim recheck on real GitHub leads

Against a throwaway copy of a mission database (production database untouched), the
recorded leads from the previous discovery pass were rechecked against the live API:

| Lead | Policy | Live claim verdict |
| --- | --- | --- |
| `tenstorrent/tt-metal#56908` — "[Bounty $3000] Fix distributed LayerNorm/RMSNorm 2D-core-grid …" | `CONTRIBUTING.md` · `ai_contributions_allowed 1` · `disclosure_required 1` | `not_payable` · `claimed_by_other_party` · evidence `label=bounty`, `assignees=adraca` · checked 2026-10-10T00:27:31Z |
| `tenstorrent/tt-metal#59732` — "[Bounty $3,000] Fix ttnn.sampling distribution bias from low…" | same policy result | `not_payable` · `claimed_by_other_party` · evidence `label=bounty`, `assignees=samiyadev786` · checked 2026-10-10T00:27:34Z |

Both leads are *accepted by discovery* and still *unpayable* — the distinction the
eligibility gate exists to enforce. After the run the database read
`claimStates: never_checked=22, not_payable=2`, `apiRequests: 24` (each request audited),
`assignments: 1` (pre-existing), `revenueCents: 0`.

`assign()` on the same lead was refused with **`agent_authority_inactive`** before the
claim check could matter: no active scoped contract exists for that agent, so the
contract gate is what fired. Both gates deny; neither was bypassed.

## 4b. Contracts prepared, one approved — measured on a live 4,001-agent copy

`--contracts` was run against a throwaway copy of the mission database that carries the
registered fleet, then one proposal was approved through the owner command:

```
class bounty_research: considered 25, eligible 25, prepared 25, skipped 0
contract ctr_cfbbf51ee2304870a6 activated for agent agt_reg_000a8dad… (class:bounty_research:5c4587d5)
  — expires 2026-11-09T00:30:29.930Z
this is a permission grant; it was authorized by the owner running this command, not by the fleet.
```

The row that was written is the whole grant — nothing wider:

```
permissions      ["report.submit"]
budget_cents     0
resource_limits  maxChildren 0 · maxDepth 1 · maxSpendCents 0 · maxConcurrentRuns 1 · requiresSandbox false
approved_by      own_81c913f4ac204d40b0
```

and the fleet counters moved exactly as they should:

```
scoped contracts ........ 1 active · 74 prepared and awaiting owner approval
no_scoped_contract ...... 4000 agent(s)      (was 4001 — one agent per approved proposal)
execution-ready agents .. 0                   (that agent still lacks credential + connector + payout path)
mission_human_action_tasks 4 × manual_approval pending (one per class batch) + the pre-existing rows
```

Approving 74 more proposals would raise `scopedContract` to 75 and lower the blocker count
by 74 — it would not make a single agent execution-ready, because the other gates are
independent. That is the property the class design is built around: contracts are granted
per class, per agent, on top of proven prerequisites, never en masse.

## 5. The bug this run exposed and fixed

`downloadRepositoryArchive` requested `/repos/{repo}/tarball/{ref}` with
`redirect: 'error'`, but that endpoint answers **302 → `codeload.github.com`**. No archive
could ever have been fetched, for any repository, so every execution died before
inspection. `redirect: 'follow'` would have been wrong too: it forwards the
`Authorization` header to the CDN hop. The client now walks the hop by hand, validates it
against `ARCHIVE_REDIRECT_HOSTS`, sends it without credentials, bounds it with
`ARCHIVE_MAX_HOPS`, and caps the body via `#readBoundedArchiveBody`. The tarball host was
confirmed directly (`GET codeload.github.com/…/refs/heads/main` → `200`,
`application/x-gzip`, chunked) before the fix was written. Pinned by
`src/mission/earning/github-bounty-client.test.ts` (16/16).

## 6. Validation totals for this change set

| Check | Result |
| --- | --- |
| `npx tsx --test --test-concurrency=1` over every `src/mission/**/*.test.ts` | **1451 tests, 1451 pass, 0 fail**, 25 suites |
| `npm test` (platform suite) | **196 files, 2626 tests, 2621 pass, 0 fail, 5 skipped**, 209 suites |
| `npm run typecheck` / `npm run lint` (`tsc --noEmit -p tsconfig.json`) | clean |
| `npm run build` | clean (backend `tsc` + `next build`) |
| `npm run scan:secrets` | PASS — no real secret markers, 22 allow-listed synthetic placeholders |

## 7. What still needs an owner action

* A GitHub credential that can fork, write contents and open a pull request — the current
  token's headers show **no scopes at all** on a fine-grained PAT and read-only permission
  on third-party repositories, so submission is impossible by design, not by omission.
* `mission_agent_contracts` rows for `bounty_execution` (prepared proposals exist; the
  fleet's `scopedActive` count is 0 until the owner approves them).
* One verified payout slot (`--payout` evidence, `owner_attestation` or `provider_reference`).
* Free-tier model configuration per executing agent (`ZA141251SA_CHAT_FREE_TIER` plus a
  free-tier model and cost basis) before any model-generated patch is claimed.
* A **legitimate payable bounty**: the pool was surveyed live the same day
  (`label:bounty state:open is:issue no:assignee` → 3,807; `label:"💎 Bounty" …` → 541) and
  every strong candidate was a farming or clone repository, or a live-fire honeypot. The
  correct output of the pipeline against that pool is refusal, which is what it produced.

## 8. Reproducing

```bash
DATA_DIR=/tmp/live2/data npm run fleet:readiness -- --backends
DATA_DIR=/tmp/live2/data npm run fleet:readiness -- --contracts
NODE_OPTIONS="--use-system-ca" ZA141251SA_GITHUB_TOKEN=… DATA_DIR=/tmp/live2/data \
  npx tsx scripts/mission-fleet-readiness.ts --discover
```

The jail run in this document used an operator-authored harness; the digests above are the
ones it recorded, and the repository tree it executed against is the published archive
whose sha256 is in §3.
