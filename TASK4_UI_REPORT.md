# Task 4 — the AKBARAL! application shell (UI/UX transformation)

**Branch** `arena/01a0a045-akbaral` · **base** `e4f804d` (Task 3) · every change below is committed on this branch, no pull request was opened.

---

## 1 · What the workspace is now

One compact application screen — the ChatGPT/Arena-shaped command centre, in
AKBARAL!'s own identity. No hero block, no card stack, no wall of scrolling
panels, no three-dot menus hiding things that are directly reachable.

| Zone | What it holds |
| --- | --- |
| **Left · sidebar** | AKBARAL! wordmark + “One Intelligence. Every Solution.”, **New chat**, **Search** (⌘K), **Library**, **Images & media**, **Projects**, **Files**, Agents, Automations, Billing, **Recent** (real task history), and the **account block** (profile, settings, owner console for the owner role, sign out) |
| **Centre · conversation** | the MASTER conversation: identity header, live activity stream, real user/MASTER turns, composer with attach · voice · *Files & artifacts* · **Plan & run** |
| **Right · artifact rail** | the **download/export control above the live preview canvas**, the versioned-artifact bar, and the **Files / Library / Images** panels selected from the rail tabs at the top |
| **Top bar** | compact: burger (phone), MASTER identity, pane switch (phone), search, project selector, core status, real credit count, rail toggle |

The marketing header/footer step aside while the shell owns the viewport
(`body.is-workspace`). Sidebar and rail preferences persist locally. Below
1080px the sidebar becomes an overlay drawer and the panes **switch** instead of
squeezing; nothing overflows at 320px.

**`/workspace` is a real route** (`src/app/workspace/page.tsx`, prerendered,
`noindex`) as well as `#/master`; an explicit hash still wins, so
`/workspace#/` reaches the landing page and sign-out from the app screen works.

## 2 · Every control is real (nothing simulated)

| Ask | What actually happens |
| --- | --- |
| “make me a calculator” / “build me an application” | the same real pipeline as before (`POST /api/workflows/master` → run → poll → `renderTaskOutcome`); the captured HTML document renders in the **sandboxed** (`allow-scripts`, never same-origin) preview frame, and the export control above it exports that exact version |
| “create a file” | the **Files** rail lists **Uploaded** *and* **Generated** (website / image / document / data) with real **Canvas**, **Download** and version actions |
| Attachments | fixed: the client posted to `/api/files/projects/:id/files` (**404**) — now `POST /api/projects/:id/files`, verified 201 → listed → fetchable → indexed → searchable |
| **Library** | `/api/tasks` rows with “Open” restoring the stored result |
| **Images & media** | image files and image artifacts across projects, thumbnails fetched through the authenticated API, Canvas/Download |
| **Search** (⌘K) | real tasks + projects + knowledge index, with honest “nothing indexed yet” / “no matches” / “search failed” states |
| **Projects / Agents / Automations / Billing** | the existing real screens; **New chat** clears the conversation and resets the canvas |

Honesty rules held everywhere: a failed/timed-out/cancelled run shows the
failure and keeps the credit; an artifact kind with no capture reports *empty*
rather than inventing content; capturing a kind the pipeline cannot produce is
refused (`400`).

## 3 · Auth, owner access, security

- Sign-in: email/password **+ Continue with Google / GitHub / Microsoft /
  Facebook / Apple** through the existing server-side OAuth flow. Configured
  providers are real links; unconfigured ones render **disabled and name the
  exact credentials** they need — never a button that silently does nothing.
- **Facebook added** to the provider registry (Graph API v19.0, same
  state/PKCE/link protections, `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET`).
  Facebook’s email is treated as unverified and never auto-links to an existing
  password account — same rule as Microsoft.
- **Owner access**: the owner signs in with the configured owner account, gets
  role `owner`, and reaches `/owner` (noindex console). Ordinary accounts see no
  entry and still receive **403** from `/api/owner/*` — RBAC untouched.
- No hardcoded credentials, no client-exposed secrets, nothing printed in chat.
  `npm run scan:secrets` → PASS.

## 4 · Colour system stays tokenized

The shell adds **no literal colours**: surfaces, borders, glass, radii and the
type ramp all come from the generated token layer
(`design-system/tokens.json` → `public/tokens.css` via
`node design-system/build.mjs`). The final background/accent palette is a
tokens-only edit — no layout work, no rebuild of the geometry.

## 5 · Verification (this build)

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm test` | **65 files · 605 tests · 605 pass · 0 fail** |
| `npm run build` | green; `/workspace` prerendered as a static route |
| `npm run smoke:artifacts` (new) | **27/27** — real pipeline → versioned website artifact → versions / single version / download byte-exact → the calculator in the artifact really evaluates → re-capture versions instead of overwriting → impossible capture refused → un-captured kinds empty → one successful run consumes exactly one credit |
| `npm run smoke:shell` (new) | **43/43** with the local model stub configured (success path: real deliverable in the preview, export bar names `website v3`, Files lists it) and **39/39** with the provider unreachable (honest failure path) — **no runtime problems** in either run |
| Live HTTP | `/` 200 (177,701 B) · `/workspace` 200 (178,265 B) · `/owner` 200 · assets at `?v=akbaral-lux-10` 200 |
| Live RBAC | owner login → role `owner`, `/api/me` `owner`, `/api/owner/dashboard` **200**; ordinary account **403** |
| Live artifact flow | project → upload (201) → MASTER run (`completed`) → website artifact captured (v1→v2→v3 across runs) → listed in the Files rail with the export control naming the real version |

**Responsive verification note.** The sandbox could not download a headless
browser (Chrome CDN unreachable — `npx puppeteer browsers install chrome` fails
with ECONNRESET and no system Chromium exists), so no screenshot harness was
possible here. Responsiveness is therefore verified by: the 13-assertion
responsive contract suite (drawer, pane switch, 1080px/360px breakpoints,
320px floor), the jsdom shell smoke driving the narrow path for real (burger →
drawer → scrim → pane switch → rail reveal), and a static audit of the shell
section (no fixed width above 320px outside media queries; 40 `min-width: 0`
declarations; 7 breakpoints). Pixel-level rendering should be eyeballed once in
a normal browser.

New harnesses are committed so this can be re-run at any time:
`scripts/live-artifact-smoke.mjs` (`npm run smoke:artifacts`),
`scripts/live-shell-smoke.mjs` (`npm run smoke:shell`, jsdom against a running
stack), `scripts/local-model-fixture.ts` (`npm run fixture:model`).

### Contract tests (transparency)

`src/app/workspace-ux-contract.test.ts` (25) and
`src/app/responsive-contract.test.ts` (13) encoded the **previous** spatial
model (workspace left / chat right rail). They are re-specified to the Task-4
model at equal or greater strictness — CENTER conversation + bounded RIGHT rail,
sidebar mounts and real bindings, the `/workspace` route, the drawer and pane
switch, a 320px overflow floor, and the export-control-above-canvas order.
**Every behavioural assertion is retained**: real chat turns, the payload
driving both canvas and chat, honest failure copy, no-invented-actions export,
preview isolation (`allow-scripts`), pane switching and Android parity.

## 6 · One fix found by the new smoke

After a successful run the **export control above the canvas** kept showing
“No website version yet” until the project was re-selected — the artifact bar
refreshed but the export bar did not. Fixed in `public/app.js` (the run’s
completion path now refreshes `renderMasterExportBar` and the Files rail too);
the smoke now asserts the bar names a version that the server **really** stores.

## 7 · Preview stack and the offline model stub (please read)

The sandbox has **no external AI credentials**, and a preview that always ends
in an honest “AI providers are not configured” failure cannot demonstrate the
flows above. So the preview stack runs with
`scripts/local-model-fixture.ts` — a **development stand-in for a language
model** that speaks the OpenAI-compatible protocol:

- everything else is production code (planner, specialist registry, queue,
  verification, artifact capture/versioning, credits, refunds);
- **every document it returns carries a visible footer** saying a local stub
  produced it, so a deliverable can never be mistaken for real model output;
- it is wired only through the gitignored local ops file `.platform-owner.env`;
  **production sets `GOOGLE_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
  and never starts this** (documented in `docs/DEPLOYMENT.md`).

Image *generation* is not part of the pipeline in this environment (only
website artifacts are captured server-side), so “make me an image” produces the
honest outcome rather than a fabricated picture; the Images rail is fully wired
for image files and image artifacts when they exist.

## 8 · What is still external (and only that)

1. **OAuth apps** — redirect URI `https://<your-domain>/api/auth/oauth/<provider>/callback`,
   then set `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`,
   `FACEBOOK_CLIENT_ID/SECRET` (Microsoft/Apple optional).
2. **AI provider key** — `GOOGLE_API_KEY`, `OPENAI_API_KEY` or
   `ANTHROPIC_API_KEY`; without one MASTER honestly reports it cannot run.
3. `AKBARAL_OWNER_EMAIL` = the owner’s real sign-in address (mechanism already in
   place, no code change).
4. Unchanged from the Task-3 report: Stripe keys/webhook, TLS, persistent
   volume, SMTP, and the production database (`TASK3_FINAL_REPORT.md`).

## 9 · Preview URLs (live now, sandbox `igljjfx6slr2z5yarf5dh`)

- **Workspace** — https://3000-igljjfx6slr2z5yarf5dh.e2b.app/workspace
- Landing — https://3000-igljjfx6slr2z5yarf5dh.e2b.app/
- Owner console — https://3000-igljjfx6slr2z5yarf5dh.e2b.app/owner
- API health — https://4000-igljjfx6slr2z5yarf5dh.e2b.app/api/health

Owner sign-in credentials live in the gitignored local file
`.platform-owner-credentials.txt` — never printed in chat, never committed.
Preview URLs only resolve while the stack runs (ports :3000 + :4000) and the
offline stub runs on :4999; after a sandbox resume, restart both processes.
