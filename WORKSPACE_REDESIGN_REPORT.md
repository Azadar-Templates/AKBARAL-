# AKBARAL! — Arena-style Workspace Redesign (Build #5)

**Date:** 2026-09-14
**Scope:** Web + Android workspace UX restructure to the platform workspace spatial pattern, inside AKBARAL!'s own identity. No backend, API, auth, billing, realtime or security behaviour was changed.

---

## 1. Where this work started (repository state)

The session branch `arena/01a0a045-akbaral` was branched from `main` (`6c3a544`, a skeleton containing only `README.md`), while the real product lives on the sibling Arena branch
`origin/arena/01a085d2-akbaral` (88 commits, last push 2026-09-14 11:52 UTC — the most recent commit in the repository).

This work therefore **fast-forwarded the session branch onto that state** (`git merge --ff-only origin/arena/01a085d2-akbaral`) instead of recreating anything, and continued from it. Nothing was overwritten or restarted:
the only product code touched is the workspace UI layer (web `page.tsx` / `styles.css` / `app.js`, Android screens and shared UI), plus one preview-only dev fixture.

The other sibling branch (`origin/arena/01a07c3c-akbaral`, 27 commits, 2026-09-08) is an older variant with **zero unique files**; its content is fully contained in the line above, so it was not merged.

---

## 2. The requested structure, as implemented

```
┌───────────────────────────────────────────────┬──────────────────────────┐
│ WORKSPACE (left)                              │ AKBARAL! header          │
│  · project selector · project controls        │  A! · wordmark · status  │
│  ┌───────────────┬─────────────────────────┐  ├──────────────────────────┤
│  │ project /     │ EXPORT / DOWNLOAD BAR   │  │ MASTER CHAT              │
│  │ book /        │ ─────────────────────── │  │  · your goal (turn)      │
│  │ file area     │ LIVE PREVIEW CANVAS     │  │  · plan · live activity  │
│  │ (files,       │ (website · image ·      │  │  · verified result       │
│  │  uploads,     │  document · data ·      │  │  · history / env drawers │
│  │  versions)    │  form)                  │  │  · composer (goal)       │
│  └───────────────┴─────────────────────────┘  │                          │
└───────────────────────────────────────────────┴──────────────────────────┘
```

* **Left** — the full project/book/file area with the live preview/canvas. The file rail lists the real project files (canvas preview, auth-fetched download), uploads land in the selected project, and the versioned artifact history (undo/rename/delete/export) sits under the canvas.
* **Download / export control above the preview** — `#master-export-actions` renders above `#master-preview` in markup, styles and DOM order; it exports the current website version (.html), opens a version, or pushes it back into the canvas. Every action is auth-fetched from the real API.
* **Right** — the AKBARAL! logo/header first (`brand-mark` + wordmark + MASTER status), then the main MASTER chat: real conversation turns (goal → plan → live step activity → verified result), a bounded scrolling log, an honest failure surface, history/environment drawers, and the goal composer pinned to the bottom.
* **Same interaction model on both platforms** — the Android `MasterScreen` implements the identical two-pane model from the same design tokens (`mobile/src/theme.ts`) and shared primitives (`mobile/src/components/ui.tsx`): brand header → pane switch → workspace (export bar → canvas → files) / chat (activity → turns → composer).

### Responsive behaviour (not a desktop shrink)

| Viewport | Web | Android |
|---|---|---|
| Wide | two panes side by side: fluid workspace + bounded chat rail (360–420px), chat rail sticky under the header | side-by-side split at ≥ 900dp |
| ≤ 1080px / phones | single column + **pane switch** (`Workspace` / `MASTER chat`), export bar wraps, composer becomes sticky with safe-area padding, touch targets ≥ 40px | **pane switch** (`Workspace` / `MASTER chat`), keyboard-avoiding composer, project chips instead of a select |

A finished run reveals the deliverable (workspace pane); starting a goal opens the conversation (chat pane). Nothing is auto-hidden on desktop, where both panes are always visible.

---

## 3. Files changed

| File | Change |
|---|---|
| `src/app/page.tsx` | `#screen-master` rebuilt as the Arena-style workspace shell (top bar, pane switch, workspace pane with files/export/canvas, chat rail with brand header, drawers, composer). All pre-existing mounts (`master-output`, `master-result`, `master-console-state`, `master-info-body`, `master-files`, `master-artifact-bar`, `master-goal`, …) are preserved. |
| `public/styles.css` | New “Build #5 — Arena-style workspace” design section (≈370 lines): top bar, pane switch, file rail, export bar, preview surface, chat rail, turns, composer + the responsive/pointer/reduced-motion behaviour. Superseded three-pane geometry removed. |
| `public/app.js` | Workspace shell controller: `chatAppend`, `masterPaneSet` / `masterPaneIsNarrow`, `canvasSetState`, `outcomeChatTurn`, `extractHtmlDeliverable`, `openArtifactBlob`, `previewWebsiteArtifact`, `renderMasterExportBar`, `previewProjectFile`, `bindMasterWorkspaceShell`; `renderMasterResult` now drives canvas **and** chat from the same payload; file rail gains real canvas preview. |
| `mobile/src/screens/MasterScreen.tsx` | Rebuilt as the same two-pane workspace: brand header, pane switch, project chips, export bar above a real WebView/image/text canvas, file area, chat turns, live step activity, history, keyboard-avoiding composer, real orchestration polling. |
| `mobile/src/components/ui.tsx` | `ScreenShell` gains an optional `bare` (full-bleed) mode for the workspace surface. |
| `mobile/App.tsx` | MASTER tab owns the full surface (`headerShown: false`, screen applies the safe-area inset); `akbaral://master/:projectId` deep link. |
| `mobile/src/screens/WorkspaceScreen.tsx` | The project vault opens a project in the MASTER workspace (same workspace, reachable from the vault). |
| `mobile/package.json` | `react-native-webview@^13.8.6` (the Expo SDK 51 / RN 0.74 build) for real HTML preview in the canvas. |
| `src/app/layout.tsx` | Asset cache-busting version bumped `akbaral-lux-7` → `akbaral-lux-8` (one shared version across tokens/styles/app). |
| `src/app/responsive-contract.test.ts` | Layout contract updated to the new geometry (workspace + chat rail), pane switching, export-above-preview and bounded chat log; all other invariants kept. |
| `src/app/workspace-ux-contract.test.ts` | **New** 21-test contract suite (see §5). |
| `scripts/preview/gemini-fixture-server.mjs` | Preview-only model fixture now returns a real HTML document for website goals so the preview can exercise the website-builder path (artifact capture → canvas → export → versions). Production still uses the real provider key. |

---

## 4. Real bug fixed while restructuring

The artifact version bar previously offered **Export** and **Open vN** as plain `<a href="/api/projects/…">` links. The API authenticates exclusively with `Authorization: Bearer` (no token in a query string), so those two controls returned `401` — a fake button in practice. Both are now auth-fetched:

* `Export` → `authedDownload('/api/projects/:id/artifacts/website/download')` (verified: `200` with `content-disposition: attachment; filename="…-v1.html"`, and `401` without the bearer token).
* `Open vN` → `openArtifactBlob()` fetches `…/artifacts/website/v/:version` and opens the real HTML from a blob URL.
* The new export bar uses the same real path, and a contract test now forbids `href="/api/…"` links in the client.

Also corrected: `setCoreState('success')` wrote `data-state="success"` while the stylesheet keys success on `[data-state="ok"]`, so completed runs never showed the success colour.

---

## 5. Verification (evidence, not claims)

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS (with the committed `next-env.d.ts`) |
| `npm run build` (Next 16) | PASS — all 17 routes + `/` compiled |
| `npm test` (full suite, 53 test files) | PASS (exit 0) |
| `src/app/workspace-ux-contract.test.ts` (new) | **21/21 PASS** — source contract, executed client behaviour in a VM, Android parity |
| `src/app/responsive-contract.test.ts` | 12/12 PASS |
| `src/app/result-state-contract.test.ts` | 20/20 PASS (result rendering untouched) |
| `src/app/preview-stack.test.ts`, `preview-supervisor.test.ts` | PASS |
| Mobile `tsc --noEmit` | PASS |
| `npx expo export --platform android` | PASS — Metro bundled 904 modules into the Android bundle (production build path) |
| Live API journey (preview stack, real HTTP) | register → project `Aurora Coffee` → MASTER plan → run → `completed` (3/3 steps verified) → **website artifact v1 captured (2 538 chars real HTML)** → `/versions` OK → authenticated download `200` (2 545 bytes) → unauthenticated download `401` |
| Served page (`:3000/`, 186 KB) | 14/14 structural checks PASS (workspace pane, file rail, export bar, preview canvas, chat rail, brand header, chat log, composer; export before preview; workspace before chat) |
| Served assets | `/styles.css` and `/app.js` contain the new shell code; all assets served at one version (`akbaral-lux-8`) |

**Preserved functionality:** MASTER orchestration, the 4 001-agent registry, Agent Factory, marketplace, auth/OAuth, credits + automatic refunds, SSE/WebSocket realtime, billing, admin, CRM, automations and every API/security test remain green — no server-side module changed.

**Honest scope note:** the Android app was verified by TypeScript compilation, a real Metro/Expo production bundle, and code-level contract tests. It was **not** run on a device or emulator in this sandbox (no Android runtime available), so on-device rendering is the one thing a maintainer should confirm on a device.
