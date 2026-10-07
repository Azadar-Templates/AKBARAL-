# Hero video — owner setup

**Status: OFF by default.** The site ships a CSS-only atmosphere. No video
file, no media request and no third-party asset is involved until you
explicitly opt in.

---

## How the atmosphere works today

The hero and every public inner page paint their depth with CSS only:
layered `radial-gradient` and `conic-gradient` fields built from the
existing design tokens (`--atmo-indigo`, `--atmo-violet`, `--atmo-cyan`,
`--atmo-charcoal`, `--accent-soft`, `--bg-deep`).

The component is `src/app/_components/atmosphere.tsx` (styles in
`atmosphere.module.css`). It renders:

```tsx
<Atmosphere variant="hero" enableVideo={heroVideoEnabled()} />
```

`heroVideoEnabled()` (same file) reads `AKBARAL_ENABLE_HERO_VIDEO` **on the
server**, so the flag is never inlined into the browser bundle.

---

## Opting in (two steps, no code change)

### 1. Provide the file

Put a self-hosted, owner-produced MP4 in the repository:

| Item | Value |
| --- | --- |
| Video | `public/media/hero-loop.mp4` |
| Poster (optional) | `public/media/hero-poster.jpg` |

### 2. Set the flag

```bash
AKBARAL_ENABLE_HERO_VIDEO=true
```

Accepted truthy values: `1`, `true`, `yes`, `on` (case-insensitive,
trimmed). Anything else — including unset — leaves the video off.

A rebuild / restart is required: the flag and the file-existence check are
resolved during the build, not per request.

---

## File budget

| Property | Recommended | Hard ceiling |
| --- | --- | --- |
| Resolution | 1920 × 1080 | 2560 × 1440 |
| Duration | 6–12 s (seamless loop) | 20 s |
| File size | ≤ 3 MB | 8 MB |
| Frame rate | 24–30 fps | 30 fps |
| Codec | H.264 (High) + faststart, AAC-LC audio or no audio track | — |
| Colour | Rec. 709, no HDR transfer | — |

Encode example:

```bash
ffmpeg -i source.mov \
  -an \
  -c:v libx264 -profile:v high -pix_fmt yuv420p \
  -movflags +faststart \
  -vf "scale=1920:-2" -r 30 -t 10 \
  -crf 30 \
  public/media/hero-loop.mp4
```

The poster should be the first frame at the same aspect ratio:

```bash
ffmpeg -i public/media/hero-loop.mp4 -frames:v 1 -q:v 4 public/media/hero-poster.jpg
```

---

## Rules the component enforces

The video is a decorative layer. These are enforced in code, not by
convention:

| Rule | Why |
| --- | --- |
| **Local paths only.** `isLocalOwnerAssetPath()` rejects `://`, protocol-relative `//host/...` and any `..` traversal. | No third-party CDN, no hotlinking, no path escape. |
| **Off unless the flag is set.** `enableVideo` defaults to `false`. | No surprise byte cost, no autoplay on a file you did not add. |
| **Never a broken layer.** If the flag is on but the path is rejected or the file is absent, no `<video>` element is rendered at all. | No broken-media icon, no failed network request. |
| **Decorative, always.** `aria-hidden="true"`, `tabIndex={-1}`, `muted`, `playsInline`, `autoPlay`, `loop`, `preload="none"`, `disablePictureInPicture`. | No accessibility noise; autoplay policies are satisfied. |
| **Reduced motion.** The layer is already static — there is no animation to disable. The grain overlay softens under `prefers-reduced-motion`. | Nothing pulses or drifts. |
| **No overflow risk.** The stage is `position: relative` + `overflow: hidden` + `contain: paint`; layers are `position: absolute` with `inset` only. | Decoration can never create horizontal scroll. |

---

## What is explicitly NOT allowed

- Any third-party video, image, logo or media asset. No hotlinking, ever.
- Remote URLs passed to `videoSrc` / `poster` — they are rejected and the
  layer is dropped.
- New `<link>`, `<script>` or `url()` entries pointing at a CDN.

The only remote origin the project reaches is **Google Fonts**
(`fonts.googleapis.com` / `fonts.gstatic.com`) for Inter and JetBrains Mono,
loaded exactly as before this redesign.

---

## Verify it worked

```bash
npm run typecheck
npm test
npm run audit:responsive
npm run scan:secrets
```

Targeted checks live in `src/app/glass-design-system.test.ts` and
`src/app/glass-application.test.ts`, including:

- no remote media URL anywhere in `src/`, `public/`, `mission-dashboard/`
  or `design-system/`;
- the owner-asset guard rejects remote and traversal paths;
- the video is opt-in and defaults to off.
