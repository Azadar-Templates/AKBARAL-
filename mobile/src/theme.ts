/* AKBARAL! design tokens — GENERATED from design-system/tokens.json.
   Do not edit by hand: run `node design-system/build.mjs`.
   The website (public/tokens.css) and the future iOS app
   (design-system/ios/AKBARALTheme.swift) share this exact source.
   Identity: obsidian foundation · indigo/violet atmosphere ·
   glass surfaces · cinematic lighting. Dark is the platform identity. */

export const palette = {
  bgDeep: '#050506',
  bg: '#08080a',
  bg2: '#0d0d10',
  bg3: '#121217',
  surfaceStrong: '#15151b',
  glassFill: 'rgba(10,10,13,0.7)',
  line: 'rgba(226,226,234,0.08)',
  lineStrong: 'rgba(226,226,234,0.16)',
  lineFaint: 'rgba(226,226,234,0.045)',
  lineAccent: 'rgba(151,144,242,0.3)',
  text: '#f0f0f2',
  text2: '#b8b8c0',
  textDim: '#87878f',
  textFaint: '#5d5d66',
  accent: '#9790f2',
  accent2: '#7378e8',
  accentSoft: 'rgba(151,144,242,0.10)',
  indigoSoft: 'rgba(115,120,232,0.12)',
  onAccent: '#0b0b0d',
  ivory: '#ececee',
  onIvory: '#0b0b0d',
  telemetry: '#8fc7de',
  telemetrySoft: 'rgba(143,199,222,0.11)',
  green: '#7fc9a4',
  greenSoft: 'rgba(127,201,164,0.12)',
  red: '#e58a97',
  redSoft: 'rgba(229,138,151,0.12)',
  amber: '#dcb26a',
  amberSoft: 'rgba(220,178,106,0.12)',
  blue: '#9db1e0',
  blueSoft: 'rgba(157,177,224,0.12)',
  surface: '#101014',
  surface2: '#17171d',
};

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 18,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 30,
  xxxl: 44,
};

export const shadow = {
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.42,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  glow: {
    shadowColor: '#9790f2',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
};

/** Shared typographic scale (see tokens.json typography.scale). */
export const type = {
  micro: { fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  xs: { fontSize: 13, fontWeight: '400', letterSpacing: 0 },
  body: { fontSize: 15, fontWeight: '400', letterSpacing: 0 },
  emphasis: { fontSize: 15, fontWeight: '700', letterSpacing: 0 },
  md: { fontSize: 17, fontWeight: '600', letterSpacing: 0 },
  heading: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  xl: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  xxl: { fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
  display: { fontSize: 34, fontWeight: '900', letterSpacing: -0.5 },
};

/** Motion durations (ms) — respect reduced-motion everywhere (see ui.tsx). */
export const motion = {
  instant: 120,
  fast: 200,
  base: 320,
  slow: 560,
  cinematic: 900,
  staggerMs: 80,
};

/** Status tone mapping shared with the web client. */
export type StatusTone = 'green' | 'red' | 'amber' | 'telemetry' | 'neutral';

const STATUS_TONES: Record<string, StatusTone> = {
  "live": 'telemetry',
  "running": 'telemetry',
  "streaming": 'telemetry',
  "queued": 'amber',
  "pending": 'amber',
  "planned": 'amber',
  "scheduled": 'amber',
  "retrying": 'amber',
  "needs_review": 'amber',
  "completed": 'green',
  "succeeded": 'green',
  "active": 'green',
  "enabled": 'green',
  "published": 'green',
  "failed": 'red',
  "blocked": 'red',
  "disabled": 'red',
  "error": 'red',
  "cancelled": 'neutral',
  "paused": 'neutral',
  "idle": 'neutral',
  "unknown": 'neutral',
};

export function statusTone(status: string): StatusTone {
  return STATUS_TONES[String(status || '').toLowerCase()] ?? 'neutral';
}

export function statusColor(status: string): string {
  const tone = statusTone(status);
  if (tone === 'green') return palette.green;
  if (tone === 'red') return palette.red;
  if (tone === 'amber') return palette.amber;
  if (tone === 'telemetry') return palette.telemetry;
  return palette.textDim;
}

/* ---------- Agent identity (sigil) — identical formula on every platform ---------- */

/** FNV-1a 32-bit hash — deterministic across web/mobile/iOS. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic indigo→violet band (222..299) for an agent. */
export function agentHue(name: string, category = ''): number {
  return 222 + (fnv1a(`${name}|${category}`) % 78);
}

/** Agent monogram: initials of the first two words (or first two chars). */
export function agentMonogram(name: string): string {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'A';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function sigilColors(name: string, category = ''): { hue: number; border: string; fill: string; text: string; glow: string } {
  const hue = agentHue(name, category);
  return {
    hue,
    border: `hsla(${hue}, 90%, 74%, 0.42)`,
    fill: `hsla(${hue}, 90%, 64%, 0.15)`,
    text: `hsla(${hue}, 95%, 82%, 1)`,
    glow: `hsla(${hue}, 95%, 74%, 0.45)`,
  };
}
