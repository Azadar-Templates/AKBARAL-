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
render time and exposes `window.__AKBARAL_HERO_VIDEO__ = true` only when
it exists — the client then plays it (autoplay/muted/loop/playsInline,
runtime errors fall back to the canvas) with **no network probing** (a
HEAD 404 on every visit would log console errors). When the file is
absent (current state) the original canvas intelligence-network animation
runs instead. Adding/removing the video requires a dev-server restart or
production rebuild for the flag to update. Mobile / `saveData` /
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
