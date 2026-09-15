# Task 4 — AKBARAL! application shell (UI/UX transformation)

Branch `arena/01a0a045-akbaral` · HEAD `0ac2b9f` (pushed) · previous HEAD `e4f804d`

## What changed

### One compact application screen (was a long scrolling page)
| Zone | What it is |
| --- | --- |
| **Left sidebar** | AKBARAL! wordmark + "One Intelligence. Every Solution.", **New chat**, **Search** (⌘K), **Library**, **Images & media**, **Projects**, **Files**, Agents, Automations, Billing, **real recent history**, and the **account block** at the bottom (profile, settings, owner console for the owner role, sign out) |
| **Center** | the MASTER conversation: header with live core state, real chat turns, live activity/progress stream, and a compact composer (attach, Files & artifacts, voice when supported, Plan & run) |
| **Right rail** | **Preview** (download/export control ABOVE the canvas, artifact version bar) plus **Files / Library / Images** panels selected from the rail tabs at the top |
| **Top bar** | compact: burger (phone), MASTER identity, pane switch (phone), search, project selector, core status, real credit count, rail toggle |

The marketing header/footer get out of the way on the app screen; layout preferences (sidebar collapsed, rail collapsed) persist locally. No hero blocks, no card stacks, no decorative sections — and no 3-dot menus hiding directly reachable items.

### Real behaviour, not mockups
- **"make me an image"** → the run's real result renders in **Preview**; image files/artifacts also appear as cards in **Images & media** with real thumbnails fetched with the bearer token, plus Canvas and Download actions.
- **"make me a calculator"** / **"build me an application"** → the same real execution pipeline as before (`/api/workflows/master` → run → poll → `renderTaskOutcome`), rendering HTML apps in the sandboxed (`allow-scripts`, never same-origin) preview frame.
- **"create a file"** → the **Files** tab lists uploaded files *and* AKBARAL!-generated artifacts (website/image/document/data) with real Canvas/Download/Export actions; knowledge indexing and search stay real.
- **Library** = `/api/tasks` with "Open" restoring the stored result; **Search** = real tasks + projects + knowledge index (with honest "nothing indexed yet" / "no matches" / "search failed" states).
- **New chat** clears the conversation and resets the canvas; **Enter** sends, **Shift+Enter** adds a line; ⌘/Ctrl+K search, ⌘/Ctrl+B sidebar.

### Fixed along the way
- **Attachment uploads were broken**: the client posted to `/api/files/projects/:id/files` (404). Now `/api/projects/:id/files` — verified 201, file listed, fetchable, indexed, searchable.
- **`/workspace` is a real route** (`src/app/workspace/page.tsx`, prerendered, `noindex`); an explicit hash still wins, so `/workspace#/` reaches the landing page and sign-out works from the app screen.
- **Auth screen**: Google/GitHub/Microsoft/**Facebook**/Apple buttons; configured providers are real server-side OAuth links, unconfigured ones render disabled with the exact credential names they need — never a button that silently does nothing. Sign-in honours an explicit same-origin `next` (used by the owner console).
- **Facebook provider added** to the existing secure OAuth registry (Graph API v19.0, same state/PKCE/link protections). Its email is treated as unverified (never auto-links to an existing password account) — same rule as Microsoft. Needs `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET`.
- **Owner access**: the owner account (configured `AKBARAL_OWNER_EMAIL`) signs in, gets role `owner`, and sees the **Owner console** entry → `/owner`. Ordinary accounts get 403 from `/api/owner/*` and never see the entry. RBAC untouched.

### Colour system stays tokenized
No literal colours in the shell: every surface/border/glass/radius/type value comes from `public/tokens.css` (generated from `design-system/tokens.json`). The new background/accent palette you will supply later is a tokens-only edit — no layout rebuild.

## Verification (all green)
- `tsc --noEmit` clean; `npm run scan:secrets` PASS.
- **`npm test` → 65 files, 605 tests, 0 failures** (Task 3 baseline 598).
- **`npm run build`** → production build green, `/workspace` prerendered as a static route.
- **`npm run smoke:shell` → 34/34** against the live stack with **no runtime problems**: signed-out gate, sign-in, identity/credits, Library/Images/Files panels, search, a real MASTER run (honest `provider_not_configured` failure, canvas `failed`, no fake success), New chat, sidebar collapse/expand, rail collapse/expand, phone drawer + scrim, pane switch, account menu, sign-out.
- Live API smoke: projects, uploads, project detail, all four artifact kinds, knowledge search, tasks, `/api/me`, `/api/owner/dashboard` (owner 200 / ordinary user 403), workflow failure + credit refund intact.
- `/` 200, `/workspace` 200 (`Workspace — AKBARAL!`), `/owner` 200, styles/app.js served at `?v=akbaral-lux-9`.

### Contract tests (transparency)
`src/app/workspace-ux-contract.test.ts` and `src/app/responsive-contract.test.ts` encoded the *previous* spatial model (workspace left / chat right rail). They are re-specified to the Task-4 model at equal or greater strictness — CENTER conversation + bounded RIGHT rail, sidebar mounts and real bindings, the `/workspace` route, the drawer and pane switch, plus a 320px overflow floor. Every behavioural assertion is retained: real chat turns, the payload driving both canvas and chat, honest failure copy, no-invented-actions export, preview isolation, pane switching and Android parity. New coverage: 2 sidebar/shell tests, 1 responsive shell test, 2 Facebook OAuth tests (+7 tests net).

## Only external configuration still required
1. **OAuth apps** (any you want live): redirect URI `https://<your-domain>/api/auth/oauth/<provider>/callback`; then set `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, `FACEBOOK_CLIENT_ID/SECRET` (Microsoft/Apple optional). Until then the buttons stay disabled and say exactly what they need.
2. `AKBARAL_OWNER_EMAIL` must be the owner's real sign-in address (already supported; no code change).
3. AI provider keys / Stripe / TLS / persistent volume / SMTP: unchanged from the Task-3 report (`TASK3_FINAL_REPORT.md`).

## Preview URLs (live now, sandbox `igljjfx6slr2z5yarf5dh`)
- Workspace: https://3000-igljjfx6slr2z5yarf5dh.e2b.app/workspace
- Landing: https://3000-igljjfx6slr2z5yarf5dh.e2b.app/
- Owner console: https://3000-igljjfx6slr2z5yarf5dh.e2b.app/owner
- API health: https://4000-igljjfx6slr2z5yarf5dh.e2b.app/api/health

The owner sign-in credentials live in the gitignored local file
`.platform-owner-credentials.txt` — never printed in chat or committed.
Preview URLs only resolve while the stack is running and its ports are
registered; restart the platform process (see the session notes) after a
sandbox resume.
