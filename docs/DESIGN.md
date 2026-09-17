# AKBARAL! — Cinematic Intelligence Design System

The platform's visual identity: **luxury cinematic AI operating system** —
near-black cinematic tones, muted olive / moss / antique-gold undertones,
warm off-white editorial typography, hairline borders, fine technical grids,
glass surfaces, restrained motion. Fully original design language (inspired
only by the *level* of premium composition, never by another designer's
assets, text or branding).

Applies uniformly to: homepage, dashboard, MASTER AI, Agent World, Agent
Factory, marketplace, workspace, CRM, billing, admin, settings and auth.

---

## Palette

| Token | Dark (default) | Purpose |
| --- | --- | --- |
| `--bg` | `#050604` | Page background — deep warm-green near-black |
| `--bg-2 / --bg-3 / --bg-deep` | `#080906 / #0c0e09 / #030402` | Elevated layers |
| `--text` | `#f2f1e9` | Warm off-white primary text |
| `--text-2 / --text-dim / --text-faint` | `#b9bab0 / #8b9188 / #6a7168` | Desaturated olive-gray secondary text |
| `--gold / --gold-2` | `#b5a042 / #d3bd72` | Antique gold accent (status, focus, primary CTA) |
| `--moss / --moss-deep / --olive / --sage` | `#9aa87b / #5b5518 / #544c33 / #7a827f` | Muted organic undertones |
| `--line / --line-strong / --line-gold` | hairlines at 13–34% alpha | 1px borders everywhere |

A full **light theme** (warm paper `#f2f1e9`, ink text, adjusted gold)
exists and stays functional via the header/settings theme toggle. The hero
keeps its dark cinematic backdrop in both themes (text over media uses
fixed light values for guaranteed contrast).

## Typography

- **Display:** Space Grotesk (500/600) — headlines, buttons, numerals.
- **Text:** Inter (400/500/600).
- **Technical readouts:** `--font-mono` stack — eyebrows, system chips,
  stats, badges, readout lines.

Loaded via Google Fonts with `display=swap` + preconnect (never a render
blocker; system fallbacks are metric-adjacent). Uppercase editorial
kickers use `data-kicker` (rendered by CSS `attr()`).

## Surfaces & structure

- Borders: 1px hairlines, never heavy. Cards `--radius: 5px` (no
  excessive rounding).
- Glass: header + auth card + toasts use `backdrop-filter` over darkened
  scrims.
- Grids: fine 56–72px grid-line overlays masked with radial gradients
  (hero, auth, agent-world panel).
- Targeting marks: hero corner brackets, cursor reticle (fine pointers
  only), bracket-style `PRO` tag, `·`-prefixed security stamps.

## Motion

- `[data-reveal]` — IntersectionObserver fade/translate reveals.
- Hero: canvas intelligence network (below), scroll parallax (`--scroll-par`),
  pointer parallax (`--px/--py`), magnetic CTAs (`--mx/--my` via the
  `translate` property so it composes with reveal transforms).
- Pipeline spine draws (`--pipe-progress`) as stages reveal; trace/lab
  rows stagger in.
- Counters (`.stat-count[data-count]`) animate only **real** numbers
  (4,001 agents / 80 disciplines / 1 orchestrator).
- **`prefers-reduced-motion`** disables all of the above: poster only,
  instant reveals, no marquee drift, no reticle.

## Hero background video — architecture & production placement

The hero ships a full-bleed background **video slot** with a layered
fallback chain (all original assets — nothing copyrighted):

```
<video id="hero-video" muted loop playsInline preload="none"
       poster="/media/hero-poster.jpg">      ← z2, fades in when playing
  <source src="/media/hero-loop.mp4" />
</video>
<canvas id="hero-canvas"></canvas>           ← z3, original network animation
<div class="hero-poster">                    ← z1, original still (base layer)
+ veil / gridlines / vignette overlays        ← z4–z6 (text readability)
```

**To enable the production video:** place a dark, cinematic, AI-themed
loop at `public/media/hero-loop.mp4` (H.264, ideally ≤ 4 MB, ~10–20 s,
no audio, 1920×1080 or wider). The server component checks the file at
render time and emits `<meta name="akbaral-hero-video" content="1">` only
when it exists — the client reads that meta tag (pure data: no inline
script, no pre-hydration mutation) and plays the video
(autoplay/muted/loop/playsInline, runtime errors fall back to the canvas)
with **no network probing** (a HEAD 404 on every visit would log console
errors). When the file is absent (current state) the original canvas
intelligence-network animation runs instead. Adding/removing the video
requires a dev-server restart or production rebuild for the flag to
update. The AdSense publisher id travels the same way, via
`<meta name="akbaral-adsense-client">`. Mobile / `saveData` /
reduced-motion users always get the lightweight path (light canvas budget
or still poster). No layout shift in any mode.

The still poster (`public/media/hero-poster.jpg`, ~92 KB progressive
JPEG) is an original AI-generated artwork in the platform palette.

## Honest-content rules carried by the design

- System status chip reflects the **real** `/api/health` response.
- Counters show only real registry numbers.
- The execution trace is labeled *representative run* — no fabricated
  live metrics.
- Security section lists only implemented, tested controls and never
  claims the platform is unhackable.
- Advertising elements stay inert until a real AdSense publisher id is
  configured AND consent is granted (see `.env.example`).

---

## Build #6 — the application shell (MASTER workspace)

The workspace is **one compact application screen**, not a scrolling
dashboard. Three zones, each with a single job:

| Zone | Surface | Controls |
| --- | --- | --- |
| **Left — sidebar** (`.ak-sidebar`) | brand + tagline, primary navigation | New chat · Search (⌘K) · Library · Images & media · Projects · Files · Agents · Automations · Billing · **recent history** · account block (profile, settings, owner console when the role holds it, sign out) |
| **Center — conversation** (`.master-chat`) | the MASTER conversation: header, live activity stream, real chat turns | composer with attach / Files & artifacts controls, voice input when the browser supports it, Plan & run |
| **Right — artifact rail** (`.master-workspace`) | Preview + Files/Library/Images panels, chosen from the rail tabs at the top | download / export control **above** the canvas, artifact version bar, upload + file actions |

Layout mechanics (`public/styles.css`, section *Build #6*):

- `.ak-app` is a two-column frame (sidebar + main) filling `100dvh`; the
  marketing header/footer step aside with `body.is-workspace`.
- `.master-layout` is `minmax(0, 1fr) minmax(360px, 460px)` — a fluid
  conversation column plus a bounded artifact rail that scrolls internally.
- Below **1080px** the sidebar becomes an overlay drawer (`data-sidebar="drawer"`)
  and the panes **switch** (`.master-pane-switch`, `[data-pane]`) instead of
  shrinking; below 360px the top bar, rail tabs and icon buttons tighten so
  nothing overflows a 320px phone.
- The rail collapses from the top bar (`#master-rail-toggle`) and remembers the
  preference; the sidebar collapse likewise (both in browser storage only).

**Re-skinning.** The shell introduces **no literal colours**: every surface,
border, glass level, radius and type ramp comes from the generated token layer
(`design-system/tokens.json` → `public/tokens.css` via `node design-system/build.mjs`).
Changing the background/accent identity is a tokens-only edit — the layout keeps
working without a rebuild of the geometry. Branding rules enforced in the
markup: the product name is always **AKBARAL!** (never “AKBARAL AI”) and the
tagline is always **“One Intelligence. Every Solution.”**.

**Honesty rules in the shell.** Provider sign-in buttons render disabled with
the exact credential names they need when a provider is unconfigured; the
Library, Files, Images and Search panels only ever show data returned by the
authenticated APIs (with explicit empty states otherwise); the owner console
entry appears only for the owner / super_admin role.

## Application shell — the workspace model (Build #6, 2026-09-15)

The MASTER workspace is **one compact application screen**, not a long
scrolling page. Three zones, each with a single job:

| Zone | Contents |
| --- | --- |
| **Left · sidebar** (`#master-sidebar`) | AKBARAL! wordmark + "One Intelligence. Every Solution.", New chat, Search (⌘K), Library, Images & media, Projects, Files, Agents, Automations, Billing, real recent history, account block (profile, settings, owner console for the owner role, sign out) |
| **Centre · conversation** (`#master-chat`) | the MASTER conversation: identity header, live activity stream, real user/MASTER turns, composer with attach · voice · Plan & run |
| **Right · artifact rail** (`#master-workspace`) | the **download/export control above the live preview canvas**, the versioned-artifact bar, and the Files / Library / Images panels selected from the rail tabs at the top |

Layout rules (`public/styles.css`, section *Build #6*):

- `.ak-app { grid-template-columns: 264px minmax(0, 1fr) }` — a collapsible
  sidebar (72px when collapsed) beside the work area; the marketing header and
  footer step aside while `body.is-workspace`.
- `.master-layout { grid-template-columns: minmax(0, 1fr) minmax(360px, 460px) }`
  — a fluid conversation column and a bounded rail that scrolls internally.
- ≤1080px: the sidebar becomes an overlay drawer (`.ak-scrim`) and the panes
  **switch** (`.master-pane-switch`, `[data-pane]`) instead of shrinking; the
  rail is collapsible from the top bar. ≥320px: no horizontal overflow.

**Tokens only.** The shell introduces no literal colours — every surface,
border, glass level, radius and type ramp comes from the generated token layer
(`design-system/tokens.json` → `public/tokens.css` via `node design-system/build.mjs`).
Changing the background/accent identity later is a tokens-only edit and needs
no layout work.

**Honest content rules.** Every panel reads a real API: Library → `/api/tasks`
(opening a row restores the stored result), Files → `/api/projects/:id` plus
the four artifact kinds (uploaded **and** generated, with real canvas/download
actions), Images → image files and image artifacts across projects, Search →
tasks, projects and the knowledge index with explicit "nothing indexed yet" /
"no matches" / "search failed" states. Provider sign-in buttons render as real
server-side OAuth links when configured and disabled with the exact credential
names they need when not — never a control that silently does nothing.
