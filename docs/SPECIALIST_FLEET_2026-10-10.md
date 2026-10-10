# Specialist earning fleet — verified platforms, one venue per agent, measured readiness

Date: 2026-10-10. Branch `arena/97b24ce2-akbaral`.

This is the record of what was built to answer one question: **which registered agents can be
pointed at a real place that pays for real work today, and what exactly stops the rest?** It
replaces a fleet that had identities and prompts with a fleet that has a verified venue, a
measured competency certificate, and a readiness state that only moves when the gate behind it
passes.

## 1. What is in place

| Layer | Path | What it does |
| --- | --- | --- |
| Schema | `db/migrations-mission/0048_specialist_platform_fleet.sql` | 7 tables: platform verification records, 1:1 primary assignments, persistent specialist profiles, evaluation results, ranked opportunity queues, per-agent fleet states, state-transition audit |
| Verified catalog | `src/mission/earning/platform-catalog.ts` | 22 venues the owner named or that the mission needs, each with a dated evidence record: verdict, automation policy, account and payment conditions, submission requirements, scope rules, rejection vocabulary, deadline policy, skills, tool keys and source citations. Every venue is mapped onto an **existing** `OPPORTUNITY_REGISTRY` class (`bug_bounties`, `contests_challenges`, `github_issue_bounties`, `software_development`, `open_source_sponsorship`, `microtasks_labeling`) rather than a private taxonomy, so the engine's eligibility, autonomy and payout-verifiability model keeps applying to it |
| Assignment + ladder | `src/mission/earning/specialist-fleet.ts` | 1:1 platform assignment, profile materialization from venue rules, the readiness state machine, priority queue ranking, outcome and rejection recording, fleet refresh, owner report |
| Evaluation | `src/mission/earning/specialist-evaluation.ts` | Per-venue suites of 16 graders that run the **production engines** (scope gate, claim classifier, evidence digest, venue board screening, payout verification, class contracts), with critical graders that a good score cannot outweigh |
| Operator CLI | `scripts/mission-fleet-specialize.ts` (`npm run mission:fleet:specialize`) | `--apply-catalog`, `--priority`, `--assign`, `--certify`, `--rank`, `--state`, `--release`, `--refresh`, `--report`, `--json` |
| Tests | `src/mission/earning/{platform-catalog,specialist-evaluation,specialist-fleet}.test.ts` | 42 tests: 12 catalog-integrity, 14 evaluation (non-vacuity in both directions), 16 fleet (assignment, ladder, gates, owner-only actions, full walk to `WORKING`) |

Nothing in `fleet-readiness.ts`, the mission dashboard, the wallet, the ledger or the payout
controls was modified: the fleet module *consumes* `readinessFor()` so the dashboard and the state
machine cannot drift apart.

## 2. The venue picture as it was read today

Assignment is allowed only where a current evidence record says the venue is open **and** its
automation terms were read. Everything else is recorded with its reason.

| Venue | Group | Verdict | Today's finding |
| --- | --- | --- | --- |
| GitHub funded issue bounties | mission | active (live API read) | assignable — 3,807 labelled open issues, but farms/clones/honeypots dominate; the live claim recheck is the gate |
| Frantic agent bounty board | mission | active (live board read) | assignable — 6 open, 802 USD funded, 1,302.85 USD settled on a public receipt ledger; exactly one open row is engineering work (bounty 33, $20, 1 slot) |
| Immunefi | gmail-1 | active (program pages) | assignable for research; PoC required at every severity, per-program KYC is a precondition of payment |
| Sherlock | gmail-1 | active (secondary source) | **not** assignable: automation terms unread, and a $250 USDC stake per report makes entry an owner spending decision |
| CodeHawks | gmail-1 | active (secondary source) | not assignable: automation terms unread — discovered as the replacement for the venue below |
| Code4rena | gmail-1 | **inactive** | announced wind-down 13 May 2026, closed 12 Jul 2026; clients and wardens moved to Immunefi |
| Cantina | gmail-1 | **blocked** | advanced-only, invite-based; needs an auditor track record a newly enlisted identity cannot have |
| OpenZeppelin bug bounty | gmail-2 | **unsuitable** | not a platform — one program hosted on Immunefi ($25K max). Recorded so the mapping is answered, and deliberately given no second slot |
| Paladin | gmail-2 | unverified | nothing readable today, and the name is ambiguous; no status asserted |
| Hats Finance | gmail-2 | unverified | named among live contest platforms by a 2026 source; official listing unread |
| Spearbit | gmail-2 | **unsuitable** | an auditor network for named humans; its competitions now run under Cantina |
| Layer3 | gmail-3 | unverified | no current paid-quest listing read; much quest work pays points or tokens, which is not settleable revenue |
| DoraHacks | gmail-3 | **blocked** | refuses automated reads, so opportunities cannot be discovered from our side |
| HackerOne | gmail-3 | active | assignable for research; per-program scope, triage then payout, automation terms vary |
| Bugcrowd | gmail-3 | active | assignable for research |
| YesWeHack | gmail-4 | active | **profile only** — gmail-4 has no authorized identity, so access is an owner action |
| Intigriti | gmail-4 | active | same grouping gap as above |
| Patchstack | gmail-4 | active, **automation prohibited** | rules tightened 1 Jun 2026: rewards limited to the top five monthly reports and a one-week ban for untested or AI-assumed reports — the clearest case of a venue penalising exactly the failure mode an unattended agent produces |
| Wordfence | gmail-4 | active | automation terms unread → not assignable |
| Kaggle competitions | gmail-2 | unverified | kept because the reward rules distinguish medals (no revenue) from prize money |
| Devpost hackathons | gmail-3 | unverified | sponsor-paid, hard deadlines; many events pay credits or swag |
| Gitcoin Grants | gmail-3 | **inactive** | last round's donations ran Oct 2025 with distribution to 13 Nov 2025; no open round today |

`active=11 · unverified=5 · blocked=2 · inactive=2 · unsuitable=2`, and **7 venues are
assignable today**. Those 15 non-assignable rows are not filler: they are why an agent was *not*
sent somewhere the owner's mapping named.

## 3. One agent, one venue — and the honest overflow

Two partial unique indexes make the rule physical rather than advisory:
`ux_one_primary_per_agent` and `ux_one_agent_per_primary_platform` (active rows, `slot_type='primary'`).
Released history stays for audit, so a released venue becomes assignable again without deleting
the record that it was ever held.

With 4,001 registered agents and 7 venues that are verified open today, **7 agents were assigned
and 3,994 were recorded as `UNASSIGNED_PLATFORM`** with the reason
`no_unassigned_verifiable_platform_left`. No placeholder platform, no renamed duplicate, no
second agent on one venue. Scaling the fleet is therefore a *verification* task (more venues with
current evidence, or owner permission on the 15 held-back rows), not a registration task.

## 4. A profile, not a rename

Each specialist row is materialized from the venue's own record:

* **rules** — discovery (venue listings + mandatory live claim recheck), eligibility (account and
  payment conditions), scope, submission (venue form + owner approval + disclosures), severity
  (venue rubric; informational and non-monetary outcomes are never revenue);
* **skills** — only skills that have a grader; a claimed skill with no evaluator fails the run;
* **tools** — every `toolKeys` entry must name a registered connector contract, and the profile
  stores the resolved set separately from the unresolved gaps (nothing is granted implicitly);
* **permissions** — exactly the class contract's grantable set (`bounty_research`: `report.submit`;
  `bounty_execution`: `tool.request`, `report.submit`; `evidence_verification`: `report.submit`),
  with the class's denied list persisted so the refusal is visible in the row;
* **workflow** — discover → verify open and payable → eligibility/scope → assign → requirements →
  execute → test → independent verify → evidence/report → owner-approved submission → track
  acceptance → verify payment → ledger, with the owner-approval and no-destructive-testing
  constraints recorded in the profile itself;
* **deadline / reward verification** — the venue's deadline policy plus freshness windows from the
  real claim-freshness rule; reward rules that *require* settlement evidence, refuse to treat
  points/medals as revenue, and state that an advertised ceiling is not a verified figure.

`rules_digest` binds the profile. An evaluation row stores that digest, so editing a profile after
the fact voids its certificate (`profile_changed_since_evaluation`) instead of inheriting it.

## 5. The ladder, and what each rung demands

`REGISTERED → PLATFORM_ASSIGNED → TRAINING → SKILLS_VERIFIED → ACCESS_READY → CONTRACT_APPROVED → EXECUTION_READY → WORKING`,
with `BLOCKED`, `INACTIVE` and `NEEDS_OWNER_ACTION` reachable from anywhere. Forward moves are
exactly one step (`specialist_state_skip` otherwise); backward moves need the owner. Every
transition — passed *or refused* — is written to `mission_agent_state_transitions`, and a refusal
also records its blockers and the owner action that would clear them.

| Rung | Requires (re-read every time) | Engine consulted |
| --- | --- | --- |
| `PLATFORM_ASSIGNED` | agent active, non-fixture; venue evidence says `active`, not stale, automation not prohibited/unknown; venue not owner-restricted; no other agent holds it | `mission_platform_evidence`, `mission_platforms.status` |
| `TRAINING` | a materialized profile with a non-empty suite | suite derivation |
| `SKILLS_VERIFIED` | a passing **non-fixture** suite for this exact profile digest, all critical graders green | scope gate, claim classifier, evidence digest, venue board screening, payout verification, class contracts |
| `ACCESS_READY` | authorized account grouping **and** an active registered credential for that venue **and** a current evidence record | `mission_credentials`, `AUTHORIZED_ACCOUNT_GROUPS` |
| `CONTRACT_APPROVED` | newest `mission_agent_contracts` row active and unexpired | existing contract authority |
| `EXECUTION_READY` | all of the above **plus** every fleet gate the owner policy imposes | `readinessFor()`: autonomy, kill switch, money grant, provider readiness, verified payout slot, owner-action queue |
| `WORKING` | an unblocked opportunity the **owner** placed on that specialist | `mission_specialist_opportunities.state='assigned'` |

Production autonomy remains off, so the observed outcome is the correct one: **7 agents reached
`SKILLS_VERIFIED`, 0 reached `EXECUTION_READY`** — every candidate is held by `autonomy_disabled`
plus the grant/payout/provider gates. That is the design, not a shortfall to hide: an unverified or
unpermitted agent cannot become executable by argument.

## 6. Priority queue

`rankOpportunityQueue` reads the continuous discovery registry (`mission_opportunities`) for the
specialist's venue and scores each candidate with capped, stored factors —
`30` verified funding, up to `35` reward weight (against a $5,000 reference, so a $25M headline
cannot dominate), up to `25` skill fit, `5` for permitted automation — and writes `rank`,
`factors_json` and the exact `blockers_json` per row. Unknown stays unknown: an unverified funding
state, a reward with no floor, an unread eligibility set or a `disallowed` automation term makes the
row `blocked` rather than quietly dropped. **Advertised rewards are never revenue**: nothing in this
module writes the ledger, and `recordOutcome` refuses `payment_verified` unless a row in
`mission_settlement_verifications` with that external reference is `verified=1`.

## 7. What was executed for real, today

Against a **scratch mission database** rebuilt for this run (`DATA_DIR` in a temp directory:
`db:migrate` → `db:seed` → `mission:init` → `mission:sync-registry`, 4,001 identities) — not
production, and not the dashboard's database:

* catalog applied: 22 venues registered with evidence. Re-applying an *unchanged* reading writes
  nothing (`created=0`, `evidenced=0` — asserted in the catalog tests), while a changed reading adds
  a new row instead of overwriting: three passes today (one after the tool-key correction) left 39
  evidence records for 22 venues. The lifecycle stopped at `POLICY_REVIEW`, the ceiling a
  code-driven write may reach;
* `--priority`: 7 assignments, one per assignable venue, in the owner's grouping order —
  `github-issue-bounties`, `frantic`, `bugcrowd`, `hackerone`, `immunefi` (→ `PLATFORM_ASSIGNED`) and
  `intigriti`, `yeswehack` (→ `NEEDS_OWNER_ACTION`, gmail-4);
* `--certify`: 7 deterministic suites run, **7 passed**, `skill_level` set from the graded score;
  during development this same gate caught a real inconsistency — the builder wrote
  `advertised_reward_ceiling_verified` while the grader asserted a separate
  `treats_advertised_reward_as_revenue` claim — so three suites failed at 67–75 until the profile
  stated both, and re-grading was required. The gate worked as intended; the profile was fixed,
  not the gate loosened;
* `--rank=all`: every queue returned `registry_empty` for this scratch database, which is the truth
  (no discovery had been run into it) and is reported as such rather than padded;
* the report also *reads* the existing adapter registry for the assigned venues — 5 of 7 have an
  adapter row, each in status `unavailable_public_source`, which is the honest description of what
  the fleet can do there today (read a public source, not submit). The fleet creates and mutates no
  adapter: that table drives background workers, and changing it is an owner decision;
* `--refresh --report`: 4,001 readiness rows — `SKILLS_VERIFIED=7`, `UNASSIGNED_PLATFORM=3,994`,
  one aggregated owner action covering all 3,994, revenue **0 cents against 0 settlement proofs**;
* the fleet test suite proves the top of the ladder is reachable when every gate genuinely holds:
  it satisfies credential, contract, grant, provider readiness, verified payout slot and the owner
  policy, and walks to `WORKING` — then shows the state is taken away again by the kill switch.

## 8. Owner actions outstanding

1. **Authorize or reassign the `gmail-4` grouping.** YesWeHack, Intigriti, Patchstack and Wordfence
   sit there; the profiles and evidence are built and wait only on the grouping decision. Nothing
   in this work distributes passwords, bypasses KYC, or puts two accounts on one inbox.
2. **Read the automation terms** for Sherlock, CodeHawks and Wordfence (or grant an exception):
   they are active but their policy is unread, so assignment is refused today.
3. **Decide on the one real engineering lead** at Frantic (bounty 33, $20, funded, 1 slot,
   `requires_identity`): enlistment, the deliverable, and the submission are owner actions —
   `docs/FRANTIC_BOUNTY_VENUE_2026-10-10.md` holds the sequence.
4. **Keep autonomy off until the rest of the gates pass**, or enable it deliberately: no setting was
   changed here, and `EXECUTION_READY` was refused for all seven specialists because of it.
5. **Re-verify at 30 days.** Evidence older than `EVIDENCE_MAX_AGE_DAYS` blocks assignment on its
   own — a venue's status is a reading with a date, not a permanent property.
6. For scale, the constraint is venue verification, not agent registration: 3,994 agents wait on
   venues that can be proven open, permitted and payable.

## 9. What this build does not claim

No accounts were created, no credential was issued or read, no KYC step was performed, nothing was
submitted to any venue, no bounty was accepted, no payment was received, and no revenue or balance
is asserted anywhere in this document. The `active` verdicts describe venues, not our standing in
them. Test results are graded exercises of production code paths in a scratch database — they are
not evidence that live work was performed. Production remains exactly as configured before this
change: no new deployment was triggered, and autonomous execution stays off.
