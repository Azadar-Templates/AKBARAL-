/* AKBARAL! design tokens — GENERATED from design-system/tokens.json.
   Do not edit by hand: run `node design-system/build.mjs`.
   The website (public/tokens.css) and the future iOS app
   (design-system/ios/AKBARALTheme.swift) share this exact source.
   Identity: obsidian foundation · indigo/violet atmosphere ·
   glass surfaces · cinematic lighting. Dark is the platform identity. */

export const palette = {
  bgDeep: '#030409',
  bg: '#06070f',
  bg2: '#0a0c18',
  bg3: '#0e1122',
  surfaceStrong: '#10142a',
  glassFill: 'rgba(9,11,24,0.62)',
  line: 'rgba(148,158,235,0.14)',
  lineStrong: 'rgba(148,158,235,0.28)',
  lineFaint: 'rgba(148,158,235,0.07)',
  lineAccent: 'rgba(157,140,255,0.36)',
  text: '#eef0fc',
  text2: '#b9bfe2',
  textDim: '#8a92bb',
  textFaint: '#5f6790',
  accent: '#9d8cff',
  accent2: '#5d6ff0',
  accentSoft: 'rgba(157,140,255,0.12)',
  indigoSoft: 'rgba(93,111,240,0.16)',
  onAccent: '#f5f4ff',
  telemetry: '#6fd7ff',
  telemetrySoft: 'rgba(111,215,255,0.12)',
  green: '#62d99a',
  greenSoft: 'rgba(98,217,154,0.13)',
  red: '#ff6b81',
  redSoft: 'rgba(255,107,129,0.13)',
  amber: '#f2b95e',
  amberSoft: 'rgba(242,185,94,0.13)',
  blue: '#7f9dff',
  blueSoft: 'rgba(127,157,255,0.13)',
  surface: '#0d1126',
  surface2: '#121736',
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
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
    shadowColor: '#02030c',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  glow: {
    shadowColor: '#9d8cff',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
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
