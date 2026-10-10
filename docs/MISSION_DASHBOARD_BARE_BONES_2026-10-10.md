# Mission console, bare bones — 4 sections that earn (2026-10-10)

Scope: the private mission dashboard (`mission-dashboard/`), the mission database
(`db/migrations-mission/` + `src/mission/`) and the per-agent specialty registry.
Nothing in the public AKBARAL! app was touched. No new dependencies, no new colours, no new
fonts — the existing green theme tokens are the only styling vocabulary used.

**Outcome in one line:** the owner console is four top-level sections — Overview, Bounty,
Approvals, Money — 15 folded `<details>` sub-sections, 1,421 mission tests green, every earning
and compliance control reachable in at most two clicks, every section measured inside its
height budget in real Chromium, and one forward-only migration (0049) that drops the dead table
and the two dead columns that the audit proved nobody reads.

---

## 1. Audit first (what the code looked like before this change)

All anchors below are `git show HEAD:<file>` line numbers, i.e. the state the strip started from.

| Finding | Anchor (before) | What it was |
| --- | --- | --- |
| Six primary nav entries, not four | `mission-dashboard/app.js:127` — `const PRIMARY_TABS = ['overview', 'bounties', 'agents', 'approvals', 'earnings', 'policy'];` | The console addressed 19 views across 19 panels; the section row and the sub-tab row were separate navigation systems. |
| Sub-tab row inside each panel | `mission-dashboard/app.js:130` — `const TAB_GROUPS = { … }` + `.subtabs` markup/CSS | A second nav layer, so "which screen am I on" needed two rows to answer. |
| Gate logic duplicated | `mission-dashboard/app.js:199` — `gateHidesNavEntry()` | Applied by two `$$('[data-…]')` loops over buttons only, so a folded view could be shown without its family. |
| Views that earned nothing | `app.js:915` `loadHeadAgentChat`, `:1070` `loadKnowledgePanel`, `:1099` `loadPlaybooksPanel`, `:1121` `loadLessonsPanel`, `:1406` `loadPublishing` | Each had a panel, loaders, CSS and API reads, and no control that produced or protected money. |
| Console size | `index.html` 568 lines · `app.js` 2,673 lines · `styles.css` 392 lines | 19 `<h2>`-level panel headings, 120+ distinct ids. |
| Dead data | `db/migrations-mission/0001_…sql` `mission_meta`; `agent_run_logs.tokens_used`; `mission_earning_intelligence.avg_settlement_hours` | 0 rows / no reader in any code path (proofs in §4). |
| Undocumented agent capability claim | `src/mission/earning/github-bounty-contracts.ts` | Not imported by anything; deleted rather than left as a decoy. |
| Specialty was decoration | `src/mission/earning/specialist-registry.ts` | Agents carried a free-text `specialization` that assignment never consulted. |

Everything that *earns or complies* was identified before deletion and stayed: the human approval
queue, the scope allowlist gate, the audit hash chain, the five payout slots, the withdrawal
request, the policy/kill-switch form, the credential vault, the KYC/verification surfaces, and the
owner-only session checks.

## 2. The four sections (after)

| Section | Contents always on screen | Folded sub-sections (`<details class="sub" data-view>`) |
| --- | --- | --- |
| **Overview** | one card row: Fleet, Ready to work, Blocked, Earned, Next action | — (deliberately one screen) |
| **Bounty** (owner-only) | programs, findings/quality gate | `bounty-registration`, `bounty-scope`, `bounty-catalogs`, `agents`, `specialist-records`, `customer-work`, `customer-intake` |
| **Approvals** | approval queue, expense requests, upgrade requests | `policy`, `tools` |
| **Money** | verified-cash summary, the money command surface | `earnings`, `treasury`, `withdraw`, `expenses`, `evidence`, `audit` |

`mission-dashboard/app.js` now reads: `PRIMARY_TABS` at `:156`, `TAB_GROUPS` at `:164`,
`TAB_ROUTE_ALIASES` at `:190`, `gateHidesNavEntry` at `:242`, `routeFromHash` at `:249`,
`applyTabChrome` at `:265`, `writeRoute` at `:292`, `activateTab` at `:308`, `loadTab` at `:1065`,
`wireSubSections` at `:1107`. `index.html`: nav `<nav class="tabs" id="tabs">` at `:46`, the four
panels at `:55`, `:63`, `:177`, `:248`.

Sizes: `index.html` 568 → **465** lines · `app.js` 2,673 → **2,534** · `styles.css` 392 → **395**.
Exactly **4 `<h2>`** (one per panel); 20 former panel headings are now `<h3>`/summaries.
**15** collapsed blocks, each addressable by route (`#/tools`, `#/audit`, …) so every saved link and
every harness deep-link still lands where it did before.

## 3. Height and line budgets, measured

Rendered-line count with a deliberately hostile 40-row payload (`src/mission/mission-dashboard-bare.test.ts`,
cap 120): Overview 6 · Bounty 74 closed / 76 worst · Approvals 17 / 22 · Money 18 / 58.

Real Chromium (`npm run mission:dashboard:heights`, 1440×1000, identical thin stub payload served to
both versions so the only variable is the console itself; `scrollHeight` per section, closed and with
each block open; evidence `logs/mission-dashboard-heights/2026-10-10T07-03-12-243Z.json`):

| State | before (px) | after (px) | screens after (÷1000) |
| --- | --- | --- | --- |
| overview | 1,999 | **233** | 0.23 |
| bounties closed | 2,243 | **688** | 0.69 |
| bounties + `bounty-registration` | — | 1,493 | 1.49 |
| bounties + `bounty-scope` | — | 1,237 | 1.24 |
| bounties + `bounty-catalogs` | — | 1,233 | 1.23 |
| bounties + `agents` | 118 (own panel) | 974 | 0.97 |
| bounties + `specialist-records` | — | 772 | 0.77 |
| bounties + `customer-work` | 289 (own panel) | 1,029 | 1.03 |
| bounties + `customer-intake` | — | 700 | 0.70 |
| approvals closed | 345 | 438 | 0.44 |
| approvals + `policy` | 264 (own panel) | 780 | 0.78 |
| approvals + `tools` | 655 (own panel) | 1,176 | 1.18 |
| money closed | 481 | 778 | 0.78 |
| money + `earnings` | 630 (own panel) | 1,829 | 1.83 |
| money + `treasury` | 960 (own panel) | 1,844 | 1.84 |
| money + `withdraw` | 1,102 (own panel) | **1,868** (tallest) | 1.87 |
| money + `expenses` | — | 1,089 | 1.09 |
| money + `evidence` | — | 1,039 | 1.04 |
| money + `audit` | 36 (own panel) | 859 | 0.86 |
| knowledge / playbooks / lessons / guide / head-chat / resources-expiry / publishing | 638 + 350 + 209 + 403 + 147 + 312 + 74 = **2,133** | *deleted* | — |

Tallest measured state **2,243 → 1,868 px**; Overview went from 2.00 screens to 0.23 (one screen,
as specified). Seven whole panels (2,133 px of markup plus their loaders and CSS) are gone.
Money replaces seven panels with one section; Bounty absorbs `agents` + `customer-work` and pays for
it by folding its owner forms, so its closed state fell 2,243 → 688.

**With real seeded data** (`npm run mission:browser-check`, its own fixture DB, asserted at both
viewports): desktop limit 3,000 px — worst state `money:treasury` 2,755, `money:withdraw` 2,510,
`approvals:tools` 2,467, `bounties:agents` 2,430, `bounties:customer-work` 2,245,
`bounties:bounty-registration` 1,493 ⇒ **0 breaches**. Mobile (390×844, limit 2,532 px): worst
`money:*` 1,949, `bounties:customer-work` 1,393, `approvals:*` 1,173, `bounties:*` 1,374 ⇒
**0 breaches**. The figure for "the owner opened every disclosure" is recorded in the same evidence
file (`everything-open:worst = 5,323 px` desktop) and deliberately not asserted.

Three levers got the phone inside the budget without deleting a control:

1. `MAX_TABLE_ROWS = 8` for wide screens, `MAX_PHONE_ROWS = 2` at ≤ 500 px (`app.js:24`, `:35-36`),
   applied inside the `table()` primitive so no caller can forget it; each table prints how many rows
   were left out and the full rows stay in the API response and the database.
2. The agent report's nine read-only lists and the three customer-intake forms are disclosures
   (`app.js:548` `reportTable`, `MAX_REPORT_ROWS = 3`), so a drill-down does not stack a fourth screen.
3. `@media (max-width: 500px) { details.sub[open] { max-height: 58vh; overflow: auto } }` in
   `styles.css` — on a phone the open block scrolls inside itself, so the *section* stays the thing
   that fits three screens. No field, row, button or notice was removed for this.

Known property, not a defect: the Bounty section is the data-dense one. Its tallest desktop state is
`money:withdraw`/`bounties`-family at 1.5–1.9 screens; the owner registration form (`#bounty-program-form`,
979 px on a phone) is the reason, and every field of it is required on the earning screen, so it is a
block that is opened when used rather than a form that is cut up.

## 4. Forward-only migration 0049

`db/migrations-mission/0049_strip_dead_mission.sql` (41 lines, applied in filename order after 0048;
numbers are never renumbered). Bookkeeping stays in `mission_migrations`.

| Item | Proof it was dead | Action |
| --- | --- | --- |
| `mission_meta` | created in 0001 as a key/value scratch table; `grep -rn "mission_meta" src scripts mission-dashboard` returns only migration files; 0 rows on a migrated+seeded database | `DROP TABLE IF EXISTS mission_meta;` |
| `agent_run_logs.tokens_used` | no code or dashboard reads it; not in `idx_agent_run_logs_queue/_target/_platform`; no view or trigger references it | `ALTER TABLE agent_run_logs DROP COLUMN tokens_used;` |
| `mission_earning_intelligence.avg_settlement_hours` | written once by 0028, never read: `grep -rn "avg_settlement_hours" src scripts` → 0 hits outside migrations | `ALTER TABLE mission_earning_intelligence DROP COLUMN avg_settlement_hours;` |
| `mission_specialist_opportunities.opportunity_class` | the specialty gate needs the venue class on the row it screens | `ADD COLUMN … DEFAULT ''` |
| `mission_specialist_opportunities.payment_reference` | settlement evidence needs the payer's reference to be recorded, not inferred | `ADD COLUMN … DEFAULT ''` |

**Totals: 1 table dropped, 2 columns dropped, 2 columns added, 0 money/approval/audit/credential/
owner rows touched.** Nothing that holds funds, approvals, audit entries, credentials or owner
identity was dropped — the drop list is exactly the three objects above and nothing else.

Independent proof on a fresh stack (scratch DB `/tmp/strip-sim`, synthetic owner, never production):
`npm run db:migrate` → `db:seed` → `mission:init` (0049 in the applied list, **52** mission
migrations, 173 tables) → then querying the resulting database:

```
0049 applied? true | total mission migrations: 52
mission_meta exists? false
agent_run_logs.tokens_used? false
mission_earning_intelligence.avg_settlement_hours? false
opportunities has opportunity_class? true | payment_reference? true
 kept mission_ledger rows 0 · mission_wallets 4002 · mission_credentials 0 · mission_owner 1
 kept mission_kyc_submissions 0 · bounty_submissions 0 · mission_audit 12008 · mission_approvals 0
```

`DROP TABLE`/`DROP COLUMN` are irreversible, so the migration is forward-only by design: an existing
database keeps its data files, and the dropped objects are not re-created by any later migration.

## 5. One specialty per agent, from one config source

`src/mission/earning/specialty-registry.ts` is the single source of truth: **20 named specialties**
(`github_bounty_engineer`, `agent_deliverable_specialist`, `defi_vulnerability_hunter`,
`evm_audit_contestant`, `beginner_audit_contestant`, `senior_audit_specialist`,
`audit_network_member`, `contract_library_reviewer`, `web_vulnerability_reporter`, `crowd_tester`,
`eu_disclosure_researcher`, `wordpress_plugin_auditor`, `wordpress_vulnerability_researcher`,
`quest_worker`, `hackathon_builder`, `open_contest_auditor`, `security_review_specialist`,
`audit_contest_specialist`, `ml_competition_modeler`, `grant_writer`) over **11 work kinds**
(`code-review`, `smart-contract-audit`, `test-authoring`, `doc-authoring`, `triage`,
`vulnerability-report`, `contest-submission`, `deliverable-build`, `data-labeling`, `model-eval`,
`grant-writing`). Each entry states its label, the work it does, the opportunity classes it may take,
and why that venue pays — no other file repeats the list (`specialtyFor()` is the only lookup,
`app.js`/`specialist-fleet.ts` never hardcode a specialty name).

* Assignment is gated: `assignOpportunity` refuses a mismatch (unmatched class →
  `NEEDS_OWNER_ACTION`-style refusal, proven by `src/mission/earning/specialist-fleet.test.ts`).
* Per agent the record holds specialty, work done, evidence count, verified count and earnings —
  read through `specialistRecord()` and `GET /api/specialists` (read-only: `POST` is `405
  method_not_allowed`), rendered in the Bounty section's `specialist-records` block.
* Human approval gates are unchanged: an agent never approves its own work, and no bucket is
  inferred — earnings only move from verified settlement rows.

## 6. Tests, sensitivity, live verification

| Gate | Result |
| --- | --- |
| `src/mission/**` + `src/mission/earning/**` + mission gateway tests | **1,421 tests, 1,421 pass, 0 fail, 0 cancelled** (was 1,310 pass before this task; +111) |
| `mission-dashboard-bare.test.ts` + `mission-dashboard-nav.test.ts` | 18 / 18 — exactly 4 nav items; ≤120 lines and ≤3 screens asserted; every folded view in exactly one family; deleted views stay deleted in markup, script and style; no orphan file in `src/mission/**` |
| `mission-dashboard-render.test.ts` | 14 / 14 (jsdom; includes the per-agent message thread and reply controls) |
| `mission-dashboard-bounty-registration.test.ts` | 5 / 5 |
| `mission-server.test.ts` | 45 / 45 — anonymous 401 across every remaining dashboard route, non-owner 403 on every mutation, read-only link 401 on a write attempt, `/api/specialists` 200-read/405-write |
| `specialty-registry.test.ts` 4/4 · `specialist-fleet.test.ts` 20/20 | specialty enforcement and zeroed buckets |
| `npm run mission:browser-check` | **exit 0** — both viewports, all height budgets met, no page errors, fixture-only (no external request) |
| `npm run mission:dashboard:heights` | 20 after-states + 38 before-states measured, 0 page errors |
| `node scripts/verify-mission-dashboard.mjs` against a scratch server | **32 / 32 PASS** (real HTTP, real DB, deep-link loop derives from the DOM) |
| `node scripts/verify-mission-login.mjs` | **12 / 12 PASS** |
| `npm run typecheck` | exit 0, no diagnostics |
| `npm run build` | exit 0 |
| `npm run scan:secrets` | PASS — 22 allow-listed synthetic placeholders, no real secret markers |
| `git diff --check` | exit 0 (one trailing-whitespace line found and fixed in `index.html`) |

**Sensitivity (each edited file reverted to `HEAD`, count of failing tests, then restored and
checksum-verified):** `index.html` 12/18 · `app.js` 13/18 · `styles.css` 3/18 · `reporting.ts` 1/53 ·
`server.ts` 3/53 · `specialist-fleet.ts` 3/24 · `specialty-registry.ts` 2/2 · `0049_….sql` 3/53 ·
restoring the deleted `github-bounty-contracts.ts` 2/18 · `nav.test.ts` 11/22. For the three *test*
files a revert removes assertions rather than breaking code, so the proof is the delta they add
(`bare` 18→10, `specialist-fleet` 24→21, `mission-server` 53→51) and the harness scripts are covered
by the live 32/32 + 12/12 runs instead of unit tests. Restored tree: 87 tests, 0 failing.

## 7. Not touched, not claimed, still the owner's to do

* **Revenue: $0.00 received, $0.00 settled, 0 settlement proofs, 0 ledger revenue rows.** The ledger
  and the money surfaces render zeros because the data is zero. No account, credential, submission,
  acceptance, balance or payout has been invented, and nothing here was executed against a real
  platform: every number above comes from local fixtures, a synthetic scratch database or unit tests.
* No production setting, wallet, credential or deployment was changed. Autonomous production
  execution stays off. The scratch stack lives in `/tmp/strip-sim` with synthetic credentials that are
  not written into this repository.
* `src/mission/mission-dashboard/app.js` keeps `renderAgentMessages` / `renderAgentChatControls`
  (`:689`, `:744`) — they belong to the surviving per-agent report, not to the deleted head-agent
  chat panel, and a test guards that they stay.
* Still requires the owner (nothing here can or should be automated): verify at least one of the five
  payout slots; set the provider keys (Gemini/search) if live model calls are wanted; approve or
  refuse the 0 queued human-action tasks; decide the Code4rena/Sherlock-style contest accounts and
  the GoFrantic `runx` identity requirement (blocked for us by `runx-cli` not being installable — see
  `docs/FIRST_REAL_EXECUTION_EVIDENCE_2026-10-10.md`); and confirm before any paid tier is activated.

## 8. The credential name, and who a verdict is allowed to speak about

Registered here so the two follow-up changes are findable from the same page that told the owner what
was still missing.

**One GitHub credential name, and one precedence.** Every GitHub reader now resolves its token through
`src/mission/github-credential.ts`: `ZA141251SA_GITHUB_TOKEN` (authoritative, documented in
`.env.example`) → `GITHUB_TOKEN` → `GH_TOKEN`, first non-blank wins, so a set-but-empty variable falls
through instead of shadowing a usable one. The compatible names stay honoured by the read paths that
already used them. One rule is not the same as one name for every purpose: a **write-capable** caller —
the bounty client that forks, pushes and opens pull requests — accepts the authoritative name **only**,
because an ambient CI `GITHUB_TOKEN` is not an owner opt-in to act as the owner. That asymmetry is the
`scope: 'read' | 'write'` option, and `github-bounty-client.test.ts` still asserts it. Presence is all
any report gets: `githubCredentialStatus()` returns `present` and the winning **name**, and its object
has no field that could hold a value, a length, a prefix or a hash. A test walks `src/` and `scripts/`
and fails if any file outside the module touches those variables directly.

**A verdict says what it read.** `src/mission/data-source.ts` classifies the mission database as
`production` / `local` / `fixture` from the resolved path, `NODE_ENV`, the `/data` volume, and an
explicit `ZA141251SA_DATA_IS_FIXTURE` override that can only *lower* authority. The fleet readiness
verdict carries `dataSource`, `claimStatus`, `claimRefusal` and per-field `productionClaims` marks, so
a payout-slot count or credential count read from a scratch file is labelled
`FIXTURE / NOT PRODUCTION` instead of being stated as the deployment's state. Classification fails
closed: only a non-scratch path under the production volume on a production host earns `PRODUCTION`;
a managed Postgres URL is never echoed at all, because a DSN can carry a password.

**The owner activation path is one list, in three places.** `ownerActivationPath()` returns every gate
that stops the fleet with `cleared` measured from live rows and, for each open one, the exact
`env var` / `dashboard control` / `CLI command` that clears it plus a `file:line` citation — e.g.
`no_payout_slot_verified` → `#slot-form` + `#slot-verification` (`mission-dashboard/index.html:332`,
`:334`), `autonomy_disabled` → `#policy-autonomous` (`:211`, handled by `PATCH /api/policy`,
`src/mission/server.ts:1673`, audited as `policy.update`), `no_platform_credential` →
`ZA141251SA_GITHUB_TOKEN` (`.env.example:268`) or the vault form `#credential-form` (`:238`). It is
printed by `npm run fleet:readiness`, included in `npm run fleet:readiness -- --json`, and rendered in
the Overview under the five cards. A test asserts those citations resolve to real, non-blank lines in
the cited files, so "the control exists" cannot rot into a comment that no longer matches the markup.
