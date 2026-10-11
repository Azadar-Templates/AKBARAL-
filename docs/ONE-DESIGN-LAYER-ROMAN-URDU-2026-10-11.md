# One design layer, two products — and the mission console speaks Roman Urdu

Date: 2026-10-11. Branch work: `arena/97b24ce2-akbaral`.
Brief: AKBARAL (public) and the private mission console (whose identifier is deliberately
never written into a tracked file — it is named by env-var name only where a script needs it) must
share ONE visual system while staying separate products; every human-facing mission string must be Roman Urdu.
No new palette, no new fonts, no new dependency, no cross-import between the two products.

## 1. What the audit found (before any edit)

| Finding | Evidence |
| --- | --- |
| Two `:root` ramps for the same product | `mission-dashboard/styles.css` carried 26 hexes including a second `--accent`, `--panel`, `--good/--warn/--bad`; `public/styles.css` carried 80 hexes and 377 `rgb()/rgba()` |
| A duplicate primitive per surface | `card` 59 definitions (56 public / 3 mission), `panel` 23, `btn` 23, `field` 12, `table` 7, `chip` 5, `pill` 4, `empty` 4, `badge` 2, `section-head` 2 |
| An orphaned React primitive layer | `src/app/_components/ui/{index.tsx,primitives.module.css}` — 0 of 54 `src/app/**/*.tsx` imported it, and it had no `danger` variant at all |
| Token drift *inside* the shared ramp | `public/styles.css:2060` re-declared `--header-h: 68px` over the token's 64px; `public/styles.css:1981-1985` re-declared the three `--glass-*-blur` values under a private `@media` `:root`; `public/styles.css:3786` swapped `--fs-micro` at 560px while the shared sheet used 414px |
| A colour hidden in a local var | `public/styles.css:962` `--h: var(--sigil-hue, 250)` — `--sigil-hue` was defined nowhere, so an undefined-var fallback carried the hue |
| A purple accent in a green product | `public/styles.css:2198` `background: var(--accent, #6c5ce7)` |
| A literal font family | `public/styles.css:2238` `font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px` |
| Copy with no translation seam | 722 sink sites in `mission-dashboard/app.js` (props, helpers, `textContent` assignments, `html:` chunks), `index.html` (text nodes + `placeholder/title/aria-label`), `mission-dashboard/styles.css` (`content:` — all glyphs, no prose) and the 13 `src/mission/*.ts` files' user-visible error/readiness strings |
| Tests anchored on copy | 82 mission test files hold 2,313 English string pins and 636 selector pins; 11 assertions across 7 files pin *rendered* text |

## 2. The shared layer (PART 2)

`design-system/tokens.json` is the only token source. `design-system/build.mjs` generates:

    public/tokens.css            mission-dashboard/tokens.css          (same declarations)
    public/akbaral-ui.css        mission-dashboard/ui.css              (byte-identical)
    mobile/src/theme.ts          design-system/ios/AKBARALTheme.swift

`design-system/ui.css` is the only primitive sheet: one card, panel, section head + intro,
button (primary/secondary/ghost/danger/small), badge + pill, banner, table (+`.table-wrap`),
field (+bare `label`), empty state, modal, focus ring, the 414px block, reduced-motion and
forced-colours, plus the `.ak-eyebrow`, `.ak-input`, `.ak-modal-sheet` atoms the React facade
composes. Every value is a `var()`; there is no hex or `rgb()` in the file.

The palette did not move: `--accent #2f8348`, the dark ramp, Inter + the mono family, the
radius/spacing ramps, and the `--gradient-hero` / glass-mask idiom are the existing ones.

**Deletions (losing duplicates), each with its former home:**
- `mission-dashboard/styles.css` — 24 copied primitive rules (card, panel×2, btn+variants, badge,
  empty, field, table+`th`/`td`, section-head, pills) and two private `:root` ramps (the second one
  carried a 22px blur against the public 50px). They now read the shared sheet.
- `public/styles.css:2060` (`--header-h: 68px`) — the token became 68px; the override is gone.
- `public/styles.css:1981-1985` (`:root` with three `--glass-*-blur` literals) — now generated
  from `tokens.glass.mobile` for both surfaces.
- `public/styles.css:3786` (`:root { --fs-micro: var(--fs-micro-phone) }` at 560px) — generated
  from `tokens.responsive.microFloorPx`, so both surfaces step at the same width.
- `src/app/_components/ui/primitives.module.css` — every rule replaced by
  `composes: ak-* from global`; 48 content lines, 0 hex, 0 `rgb()`. It was *not* deleted because
  `src/app/visual-redesign.test.ts:13-16` reads that path; it is now a facade over the shared
  sheet rather than a second implementation, and `src/app/_components/ui/index.tsx` grew the
  missing `danger` variant plus `Banner`, `EmptyState`, `Table`, `SectionHead`, `PageTitle`.

**Literal → token, measured:**

| File | hex before → after | `rgb()/rgba()` before → after | `var()` before → after | px before → after |
| --- | --- | --- | --- | --- |
| `public/styles.css` | 80 → 1 (a `#000` mask stop) | 377 → 363 | 1,442 → 1,533+ | 298 spacing + 38 radius + 126 font-size literals snapped; 1,967 px remained before the snap |
| `mission-dashboard/styles.css` | 26 → 0 | 18 → 4 (mask stops) | 115 → 220 | 197 → 38 |
| `src/app/_components/ui/primitives.module.css` | → 0 | → 0 | 6 | 3, all outside a media query on purpose (`--tap-min`, `0`) |

**Focus ring:** one definition — `--focus-ring: 0 0 0 3px rgba(47,131,72,.32)` with
`--focus-ring-width`/`--focus-ring-offset` for the console — applied by the shared sheet to
`a[href], button, input, select, textarea, summary, [tabindex]` and to `.ak-btn`, so every
interactive element on either surface shows the same ring in the same green. Keyboard path is
unchanged (the console stays button-driven; no `<a href>` was added to it, which
`src/mission/mission-dashboard-nav.test.ts:353-357` pins).

**Contrast:** `--danger` and `.ak-btn--danger` were switched from the old red-on-dark pairing to
`--red-soft` + `--red` (3.74:1) and `--accent-bright #69ad7d` remains the only text-safe green;
the repo's own computed-contrast tests (`src/app/glass-application.test.ts`, 42 assertions) pass
unchanged. `audit:axe:jsdom` (8 server-rendered routes): 0 violation groups.

**Responsive:** `audit:responsive:matrix` — 90 route/width checks (10 routes × 9 widths
320/375/414/768/1024/1280/1440/1920 + 2 landing widths), `scrollWidth == viewport` at every
one, PASS. The console's own `src/mission/mission-dashboard-bare.test.ts` measures each section
against the three-screen budget (see §4).

## 3. Roman Urdu, one pairs file (PART 3)

Sources keep their English literals; those literals are the dictionary KEYS.
`design-system/mission-copy.pairs.json` (707 pairs) is the only translation source;
`scripts/mission-copy-build.mjs` compiles it to `mission-dashboard/copy.js`
(`window.MISSION_COPY`) and refuses to write when the set is incomplete. `mission-dashboard/app.js`
applies it at the DOM sinks: `el()` (`text`, `html`, `title/aria-label/placeholder/alt`),
`banner()`, `table()` cells and headers, every direct `textContent` assignment (25 of them), and
one boot pass over the authored `index.html` text nodes and attributes (`localizeStaticMarkup()`).
`/copy.js` loads before `/app.js`.

- Lookups: exact string, then the normalized string (every dynamic hole as `#`); the runtime's
  real numbers, ids and slugs are re-injected into the `#` holes in order, so "Attestation (64+
  characters…)" still says 64.
- Machine values are never translated, by construction: the inventory that produced the key set
  rejects anything with a code shape (env names, `file:line`, SQL, API fields, JSON keys, URLs,
  blocker/reason codes like `no_payout_slot_verified`, currency codes, vendor names).
  `src/mission/mission-copy-roman-urdu.test.ts` re-checks that every machine token in a key
  survives verbatim in its value.
- 67 keys map to themselves (product and domain names: `Mission Control`, `Wallet`, `Slot`,
  `Payout`, `APPROVED`-style enums, `gemini key`, `minor units`, `Field Operations Lead`). The
  test lists all 67 explicitly, so a string left in English by accident fails it.
- Nothing moved because of the wording: no route, id, class, `data-*`, storage key or test
  selector changed. The only test edits were re-pointings of assertions about *rendered* text or
  about a token that legitimately moved (all listed in §5).
- The server stays English: the mission API is a machine contract. What the console *displays*
  from it (`HttpProblem`/`MoneyError` messages, the readiness `label/action/verify/how` fields)
  has dictionary entries, so the owner still reads Urdu.
- Count: **722 sink sites, 707 distinct user-facing strings, 707 pairs — 0 missing, 0 stale**
  (`node scripts/mission-copy-build.mjs` prints the same numbers;
  `node scripts/mission-copy-inventory.mjs --count` re-derives the set).

## 4. Clarity (PART 4)

- Each of the four console sections now opens with one line saying what it is and naming the one
  action: `mission-dashboard/index.html` lines 58, 71, 189, 320 (`<p class="muted small">`,
  translated through the pairs file like any other copy).
- Decoration already stripped in the same tree: no illustrations, no "coming soon", no duplicate
  badges, one `<h2>` per section with an eyebrow instead of a second heading, and no
  `background-image` that is not the documented glass mask.
- Empty states are honest and name the single filling action, e.g.
  `No payable (verified) slot — add/verify a destination before withdrawing. Balance
  accumulation continues; no account is required at setup.` → `Koi payable (verified) slot nahi —
  pehle destination jodein aur tasdeeq karein, phir withdraw karein. Balance banta rahega; setup
  par kisi account ki zaroorat nahi.`
- Height before/after, measured on the static markup with the same visible-lines model the
  console's own test uses (`SCROLL_SCREEN_PX = 1000`, line box 22.5px from `--fs-body` × 1.5):

      overview   1 → 2 lines   0.02 → 0.04 screens
      bounties  24 → 25 lines  0.54 → 0.56 screens
      approvals 34 → 35 lines  0.77 → 0.79 screens
      money     19 → 20 lines  0.43 → 0.45 screens
      page      81 → 85 lines  1.82 → 1.91 screens

  The +1 line per section is the purpose line; every section still reaches its primary action
  inside the first screen. `src/mission/mission-dashboard-bare.test.ts` measures the same four
  sections *after render*, with every collapsed block opened, against `MAX_VISIBLE_LINES = 120`
  and the 3,000px three-screen cap: worst section 2,700px → 2.70 screens, and no content was cut
  to achieve it (the tables bound themselves at `MAX_TABLE_ROWS = 8` and say how many rows were
  left out).
- Public pages already carry a one-line purpose above the fold on each of the six marketing pages
  and the four app pages (`audit:routes`, `src/app/public-six-page.test.ts`), so no second
  heading layer was added there; the shared sheet's `.ak-section-intro` is what any new page uses.
- Limit, stated plainly: `scripts/mission-dashboard-heights.ts` and
  `scripts/mission-browser-check.ts` need Playwright's Chromium, whose binary is not installed in
  this sandbox and cannot be downloaded here. The numbers above are jsdom-measured, not
  browser-measured, and `npm run mission:dashboard:heights -- --ref HEAD` is the command that
  reproduces them in Chromium on a machine that has it.

## 5. Tests (PART 5)

New, in this change:
- `src/app/single-source.test.ts` (6) — both surfaces load the same generated bytes; no product
  sheet re-declares a shared token or hides a colour in a local var; every primitive exists in the
  shared sheet and is not redefined by the console or the facade; no colour literal outside the
  ramp beyond a **ratcheted** count of the off-palette residue (197, see §7); no spacing/radius/
  border/font-family literal that a token already defines; the two products do not read each
  other's files.
- `src/mission/mission-copy-roman-urdu.test.ts` (7) — pairs coverage and staleness; machine values
  survive verbatim and every deliberately-untranslated string is named; no Devanagari, no markup,
  hole counts match; the console renders Roman Urdu **per section** (each `section[data-panel]`'s
  text nodes are compared before and after boot, so a string left in English fails); dynamic parts
  are re-injected; no id/class/route/storage key moved; `copy.js` is exactly the pairs file and no
  other file carries translations.
- `scripts/mission-copy-inventory.mjs` — the same set the runtime resolves, four modes
  (`--list/--json/--scaffold/--count`), reused by both the build and the test.
- `npm run mission:copy`, `mission:copy:check`, `mission:copy:audit`.

Existing pins that had to move, with the reason, each in the same commit as the change it tracks:

| Test | Was | Now | Why |
| --- | --- | --- | --- |
| `src/app/brand-assets.test.ts:524-528` | `['/app.js','/manifest.webmanifest','/styles.css']` | the same list plus `/copy.js`, `/tokens.css`, `/ui.css` | the console gained three generated assets it must load |
| `src/app/mission-gateway/proxy.test.ts:540-541` | same list + rebase regex | same six, regex extended | the gateway rebase must cover every root-absolute reference; `route.ts:262` was extended in the same commit |
| `src/mission/mission-dashboard-nav.test.ts:356` | same list | same six | one document, three pins |
| `src/mission/mission-dashboard-nav.test.ts:~333` | `var(--panel)` inside `details.sub` | `var(--surface-strong)` | `--panel` was a private duplicate of a shared token |
| `src/app/glass-design-system.test.ts:259-270` | `--accent` / `--panel` / `--good` read out of the console's own `:root` | read from `mission-dashboard/tokens.css`, plus "no dangling `var()`" | the console has no private ramp any more; the stronger form checks every token it references exists |
| `src/app/glass-application.test.ts:169-174, 379-386` | `.pill{…999px}`, `--accent`, `--good/--warn/--bad` in `styles.css` | the same three claims against the shared sheet the console links | the primitive moved to `ui.css`, the ramp to `tokens.css` |
| `src/app/asset-delivery.test.ts` | three allow-listed assets | four (`akbaral-ui.css` added) | the public surface now links its copy of the shared sheet |
| `src/app/_components/ui/primitives.module.css` | its own rules | `composes` only | one definition |

## 6. Gates (PART 6), sensitivity (PART 5.8), delivery (PART 7)

Commands, in order, each run against the final tree:

    npm run typecheck                     tsc --noEmit -p tsconfig.json            → 0 errors
    npm run build                         tsc -p tsconfig.backend.json && copy-backend-runtime-assets && next build → 0 errors
    npm run scan:secrets                  → PASS, no real secret markers; 22 allow-listed synthetic placeholders
    git diff --check                      → clean (no whitespace errors, no conflict markers)
    npm test  (scripts/test-resumable.mjs --all --prune-working-copies --compress-snapshots)
                                          → 211/211 test files, 2,785 tests, 209 suites
                                            2,780 pass, 0 fail, 5 skipped, 0 cancelled, 0 todo
    AUDIT_BASE=http://127.0.0.1:3000 npm run audit:axe:jsdom → 8 routes, 0 violation groups
    npm run audit:responsive:matrix       → 90/90 route-width checks, scrollWidth == viewport
    node design-system/build.mjs          → 6 files written, reproducible
    npm run mission:copy:check            → copy.js in step with the pairs file (707 pairs)

Sensitivity, measured by reverting one edited file at a time and re-running its guard (every
restore returned the tree to green, and `git status` afterwards matched the intended file list):

| Reverted / removed | Guard re-run | Failures while reverted |
| --- | --- | --- |
| `public/styles.css` | `src/app/single-source.test.ts` | 3 of 6 |
| `design-system/tokens.json` + `build.mjs` | `glass-design-system` + `single-source` | 1 of 26 |
| `design-system/ui.css` (removed) | same pair | 2 of 26 |
| `mission-dashboard/app.js` | `mission-copy-roman-urdu` | 2 of 7 |
| `mission-dashboard/index.html` | `mission-copy-roman-urdu` | 2 of 7 |
| `src/app/layout.tsx` | `single-source` (the link/allow-list test) | 1 of 7 |
| `design-system/mission-copy.pairs.json` (removed) | `mission-copy-roman-urdu` | the file cannot load: 1 failure at import |
| `scripts/mission-copy-inventory.mjs` (removed) | `mission-copy-roman-urdu` | 1 failure at import |
| `src/app/_components/ui/primitives.module.css` | `single-source` | 1 of 7 |
| `mission-dashboard/app.js` (before the fix) also moved | `brand-assets`, `mission-gateway/proxy`, `mission-dashboard-nav`, `mission-dashboard-bounty-registration` | 4 asset/shell pins, by design: one document, four pins |

The two "cannot load" rows are stated as what they are — a guard that fails at import, not an
assertion — because claiming a red assertion there would overstate the measurement.
The `layout.tsx` row was 0 failures on the first pass: the guard did not check the wiring, only the
files. The link/allow-list test above was added to close that gap, and the row is the re-measured
result.

## 7. Debt this slice did not remove (ratchet, do not pretend)

- 197 off-palette colour literals remain in `public/styles.css`: a second generation of the design
  (violet `rgba(151,144,242,…)`, `rgba(115,120,232,…)`) and near-black scrims (`rgba(5,5,8,…)`,
  `rgba(10,10,14,…)`, `rgba(13,13,18,…)`). Replacing them means swapping hues, which the brief
  forbids ("keep the existing palette"). `single-source.test.ts` pins the count so it can only go
  down.
- 69 off-scale `border-radius` literals (6, 7, 9, 10, 11, 13, 14, 15, 16, 20px) in
  `public/styles.css`: one-off optical radii with no token on the scale; snapping them would move
  pixels on purposelessly, so they stay and the test only forbids literals that *are* a scale step.
- 363 `rgb()/rgba()` in `public/styles.css`: 98 sit in `linear/radial-gradient()` mask geometry,
  63 in `box-shadow` geometry, 7 are byte-identical to a token value, the rest are the scrim
  families above. In `mission-dashboard/styles.css` 4 remain — all mask stops.
- ~1,380 px in `public/styles.css` are not spacing/radius declarations at all: `box-shadow` (365),
  `transition` (215), backdrop blur (83), element sizes (width/height/min-width for icons,
  hit areas, panels), and `calc()`/`@media` lengths, which CSS cannot tokenize. Every value that
  matched a shared scale step was replaced.
- The glass *material* stays physically duplicated (`src/app/glass.css`, `src/app/glass-material.css`
  for the SPA, the mask idiom inside both sheets) because the two products may not import each
  other's files; both read the shared `--glass-*` tokens, and
  `src/app/glass-application.test.ts` pins that every styled surface resolves to them.
