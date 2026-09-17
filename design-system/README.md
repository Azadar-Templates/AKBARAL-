# AKBARAL! Design System — One Identity, Every Surface

**AKBARAL! — One Intelligence. Every Solution.**

One visual identity across the **website**, the **Android app** and the **future iOS
app**. They must feel like different interfaces of the same futuristic intelligence
platform — never three separate products.

- **Single source of truth:** [`tokens.json`](./tokens.json)
- **Compiler:** `node design-system/build.mjs` (zero dependencies)
- **Generated consumers (committed):**
  | Surface | File | Notes |
  |---|---|---|
  | Website | `public/tokens.css` | CSS custom properties, dark `:root` + light `[data-theme="light"]`, linked before `styles.css` |
  | Android | `mobile/src/theme.ts` | Typed palette/scale/motion + status + agent-sigil helpers |
  | iOS (future) | `design-system/ios/AKBARALTheme.swift` | Prepared tokens only — **there is no iOS app yet and nothing pretends otherwise** |

Edit `tokens.json`, run the compiler, commit both the source and the generated
outputs. Never hand-edit the generated files.

---

## Identity

1. **Obsidian first.** Neutral deep-black canvas (`#050506` family, no color
   tint). Content floats on space, never on flat gray.
2. **Restraint is the accent.** One indigo/violet family
   (`accent2 #7378e8 → accent #9790f2`) for meaning, never decoration;
   the **ivory primary action** (`#ececee` solid, dark label — inverted in
   single theme) carries confidence on buttons.
3. **Premium glass, rarely.** Sticky header, auth card, dialogs and toasts
   get blur (web) / solid + sheen (mobile). Cards do not.
4. **Hairlines and fine grids** carry the technical elegance. 1px borders from the
   `line` ramp; fine background grids masked with radial fades.
5. **Cinematic, restrained motion.** Reveal on scroll, parallax whisper, pulsing
   telemetry dots. Everything honors reduced-motion.
6. **Honesty in visuals.** Every diagram on the site/app represents implemented,
   tested behavior. No fake metrics, no decorative "AI theater".
7. **One identity, native feel.** Same tokens everywhere; layouts stay native to
   each platform (the mobile app is a command center, not a shrunken website).

## Pricing architecture (public model, USD)

Six tiers — **Free Trial $0 · Starter $10 · Professional $50 · Business $90 ·
Scale $200 · Enterprise $400** — plus custom/manual credit purchase
($10/$50/$90/$200/$400). Tier presentation: mono tier rail, large display
price, spec grid (credits/agents/workspaces/seats), restrained CTA;
Professional is the featured tier. Money is always formatted via the shared
`usd()` helpers (web `public/app.js`, Android `BillingScreen`); never hardcode
symbols.

## Color (dark = platform identity)

| Role | Token | Value |
|---|---|---|
| Canvas | `bg` | `#06070f` |
| Raised | `bg2` / `bg3` | `#0d0d10` / `#121217` |
| Card surface | `surface` (solid) | `#101014` |
| Text ramp | `text` → `textFaint` | `#f0f0f2 → #5d5d66` |
| Primary action | `ivory` / `onIvory` | `#ececee` / `#0b0b0d` |
| Accent (violet) | `accent` | `#9790f2` |
| Accent (indigo) | `accent2` | `#7378e8` |
| Live telemetry (cyan) | `telemetry` | `#8fc7de` — running/live states only |
| Success | `green` | `#7fc9a4` |
| Failure | `red` | `#e58a97` |
| Pending/queued | `amber` | `#dcb26a` |

AKBARAL! ships **one signature luxury glass theme** — there is no light mode,
no theme toggle and no dual palette anywhere (web, Android, future iOS).
Depth comes from the layered atmosphere (fixed radial fields + grain) and a
three-level glass material system (`glass.level1/2/3`: fill, border, blur,
highlight, shadow) shared by every platform.

## Typography

- **Web:** Sora (display) + Inter (text) + Space Grotesk Mono (technical)
  via Google Fonts, system fallbacks.
- **Mobile:** the native system font (SF Pro / Roboto) with the same scale, weight
  and tracking semantics — native rendering, identical voice.
- Hierarchy: `micro 11/700/+2 upper` · `xs 13` · `body 15` · `md 17/600` ·
  `heading 19/800/-0.3` · `xl 24/800` · `xxl 30/900` · `display 34/900/-0.5`.
- Eyebrows/kickers are always micro: uppercase, mono (web), tracking +2.

## Spacing · Radii · Shadows

- Spacing: `4 · 8 · 12 · 16 · 22 · 30 · 44`.
- Radii: `sm 6 · md 10 · lg 14 · xl 20 · pill 999` (identical on all platforms).
- Cards: soft deep shadow (`0 24px 70px rgba(2,3,12,.55)` web / RN elevation 6).
- Emphasis glow: violet `glowAccent` — buttons, brand mark, active nodes.

## Status language (identical mapping everywhere)

| Tone | States |
|---|---|
| Telemetry (cyan, pulsing dot) | `running`, `live`, `streaming` |
| Amber | `queued`, `pending`, `planned`, `scheduled`, `retrying`, `needs_review` |
| Green | `completed`, `succeeded`, `active`, `enabled`, `published` |
| Red | `failed`, `blocked`, `disabled`, `error` |
| Neutral | `cancelled`, `paused`, `idle`, unknown |

Web: `.badge` + `badge()` in `public/app.js`. Mobile: `Badge`/`StatusDot` in
`mobile/src/components/ui.tsx`. Never invent per-screen status colors.

## Agent identity — the sigil

Every agent gets a deterministic visual mark — no per-agent hand-tuning across
4,001 contracts:

```
hue      = 222 + (fnv1a(name + '|' + category) % 78)   // indigo → violet band
monogram = initials of the first two words (or first two characters)
container = rounded-square, hairline border hsla(hue,90%,74%,.42),
            fill hsla(hue,90%,64%,.15), text hsla(hue,95%,82%,1)
```

Same formula in three places: `agentSigil()` in `public/app.js`,
`AgentSigil`/`sigilColors()` in `mobile/src/theme.ts` + `ui.tsx`, and
`AKBARALTheme.agentHue/agentMonogram` for iOS.

## Iconography

Geometric unicode glyphs shared by web and mobile navigation — always with a text
label: dashboard `▣` · master `◉` · tasks `◍` · agents `⬡` · workspace `▤` ·
automation `◆` · billing `◈` · settings `⚙` · security `⬢` · theme `◐`.
Status is always a colored dot, never a glyph.

## Motion

- Durations: `120 · 200 · 320 · 560 · 900` ms. Stagger: 80 ms.
- Easings: `out cubic-bezier(.22,.61,.36,1)` and `soft cubic-bezier(.33,1,.68,1)`.
- Reduced motion: web `@media (prefers-reduced-motion: reduce)` settles everything
  instantly; mobile `useReducedMotion()` (AccessibilityInfo) disables pulses,
  shimmers and entrances; iOS will check `UIAccessibility.isReduceMotionEnabled`.
- Performance: entrances and pulses run on the native driver (RN) / compositor
  (CSS transform/opacity only). No layout-thrashing animation on low-end devices.

## Components (shared recipes)

| Component | Web | Mobile |
|---|---|---|
| Buttons (primary gradient / outline / ghost / danger) | `.btn` + variants | `Button` tones |
| Cards | `.panel`, `.agent-card`, `.trust-card` | `Card` (+ sheen) |
| Glass surface | `.site-header`, `.auth-card`, `.modal-card`, `.toast` | `ScreenShell` atmosphere, `LoginScreen` card |
| Status badge + dot | `.badge`, `.live-indicator` | `Badge`, `StatusDot` |
| Loading | `.skeleton` | `Skeleton` (shimmer) |
| Empty state | `.empty` | `EmptyState` |
| Error state | `.danger-panel`, toasts | `ErrorState` |
| Dialogs/modals | `.modal-scrim`/`.modal-card` | `Alert` (native) |
| Agent sigil | `.agent-sigil` | `AgentSigil` |
| Progress | `.pipe-stage` spine, `.trace-step` | `ProgressBar` |
| Navigation | header + section rail | bottom tabs (glyph set above) |

## Responsive rules (standing)

- Target widths: **320 · 375 · 390 · 430 px** and tablets, on web and Android.
- Never solve overflow with global hiding; scrollable regions (tables, logs,
  marquees) scroll inside their own container only.
- Preserve animations, accessibility (focus rings, labels, contrast) and touch
  ergonomics. No desktop-breaking hacks, no functionality removal.

## Loading identity (all platforms)

The same boot choreography opens every surface — web, Android, and iOS when it ships:

1. **Mark**: the A! monogram in a hairline ring, breathing glow.
2. **Rings**: two staggered ring pulses expanding outward (the "system waking").
3. **Wordmark**: `AKBARAL!` wide-tracked display type + `ONE INTELLIGENCE · EVERY SOLUTION` micro tagline.
4. **Progress**: an indeterminate light sweep on a hairline track.
5. **Transition**: crossfade into the live UI (web: `#boot-veil` dissolves after boot, CSS
   safety animation hides it even without JS, `pointer-events: none` always; Android:
   `BootVisual` in `App.tsx` fades over the pre-rendered UI — no white flash, no layout
   jump; native splash image bridges the cold start with the same `#06070f` canvas).
   Reduced motion skips all animation on every platform.

## Hero film (original, generated)

`public/media/hero-loop.mp4` is REAL, fully original footage rendered procedurally from
code (no stock, no third-party assets, no license questions): obsidian depths, drifting
indigo/violet nebula fog, a 3D constellation of agents with hairline filaments, data
pulses travelling between nodes, breathing core orbs, a horizon light band, cinematic
vignette and exposure breathing. 1920×1080, 30 fps, 12 s, H.264 +faststart (~272 KB),
mathematically seamless loop (every term is periodic over the clip). The poster is
extracted from the film itself, so the still and the motion always match.

The renderer lives outside the repo (`render-hero.mjs`, pure Node + a static ffmpeg);
regeneration notes: render 360 frames of periodic phase, pipe RGBA to
`libx264 -crf 25 -preset slow -pix_fmt yuv420p -movflags +faststart`, then extract the
poster with `-ss 6.2 -frames:v 1 -q:v 2`. Serving: the server exposes the
`akbaral-hero-video` meta flag only when the file exists; the client plays it muted/
looping/inline, cross-dissolves it in on `canplay` (poster is the loading state), and
falls back to the canvas network on error, save-data, or reduced motion. Range
requests are supported (206) for iOS seeking.

## iOS readiness (honest status)

There is **no iOS application in production scope today** — and nothing here
pretends otherwise. What exists is real preparation:

- `design-system/ios/AKBARALTheme.swift` — every color (dynamic dark/light),
  spacing, radius, typography, motion and the agent-sigil formula as Swift
  constants, generated from the same `tokens.json`.
- The identity contracts above (status mapping, sigil, iconography, motion) are
  platform-neutral by construction.

When the iOS release begins, consume these tokens exactly as Android consumes
`mobile/src/theme.ts` and the website consumes `public/tokens.css`.


## Component tokens (v4.0.0)

The third layer of the token architecture (primitive → semantic →
**component**): button heights (40/44/52px + coarse-pointer 44), panel
padding/radius, focus ring, chip instrument — emitted to `tokens.css`
and consumed by the SIGNATURE-7 layer. Component state matrices
(default/hover/active/disabled/focus) are defined per interactive class.

## Responsive contract (web · Android · future iOS)

The responsive system is a token contract, not per-platform improvisation
(`tokens.json → responsive`):

- **Breakpoints**: 320 · 390 · 430 (phones) → 600 · 768 (tablets portrait)
  → 1024+ (laptop/desktop) → 1920+/2560+ (large/ultrawide, centered
  compositions with atmospheric sides — never stretched).
- **Touch**: minimum 44px targets on coarse pointers; 40px rows on
  desktop hover UI. Inputs render at ≥16px (no iOS focus zoom).
- **Typography**: no visible text below 0.62rem (~10px); display sizes
  via `clamp()`.
- **Safe areas**: every anchored surface (nav, sheets, footers, consent
  banners) adds `safe-area-inset` padding; Android consumes the same
  contract via `react-native-safe-area-context`.
- **Composition per class**: phones = single column, full-width primary
  actions ≤560px, horizontal scroll only inside a component's own
  container; tablets = generous stacked panels (768–1023); desktop =
  one-row nav, cinematic hero; ultrawide = centered, max-width 1200.
- **Glass**: three material levels survive at every size, with lighter
  blur/shadow budgets below 768px (performance).
- **Media**: hero video covers, clips inside its container, poster
  fallback, honors `prefers-reduced-motion`.

Verified widths (real headless Chromium, production build): 320, 360,
375, 390, 393, 414, 430, 568/844/932 landscape, 600, 640, 768, 820,
834, 912, 1024, 1152, 1280, 1366, 1440, 1536, 1600, 1920, 2560, 3440 —
zero horizontal page overflow across all public and app routes.
