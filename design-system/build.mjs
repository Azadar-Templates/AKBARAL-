#!/usr/bin/env node
/* ============================================================
 * AKBARAL! Design System — token compiler.
 *
 * Single source of truth: design-system/tokens.json
 * Generated consumers (committed so builds never depend on
 * running this script, but regenerate after every token edit):
 *   - public/tokens.css               (web CSS custom properties)
 *   - mobile/src/theme.ts             (Android / React Native theme)
 *   - design-system/ios/AKBARALTheme.swift (future iOS app tokens)
 *
 * Usage: node design-system/build.mjs
 * ============================================================ */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(join(root, 'design-system', 'tokens.json'), 'utf8'));

const DARK = tokens.color.dark;
const LIGHT = tokens.color.light;
const YEAR = new Date().getFullYear();

/** Explicit color mappings keep full control of emitted names. */
const cssColorMap = [
  ['bgDeep', '--bg-deep'], ['bg', '--bg'], ['bg2', '--bg-2'], ['bg3', '--bg-3'],
  ['surfaceRgba', '--surface'], ['surface2Rgba', '--surface-2'], ['surfaceStrong', '--surface-strong'],
  ['glassFill', '--glass'],
  ['line', '--line'], ['lineStrong', '--line-strong'], ['lineFaint', '--line-faint'], ['lineAccent', '--line-accent'],
  ['text', '--text'], ['text2', '--text-2'], ['textDim', '--text-dim'], ['textFaint', '--text-faint'],
  ['accent', '--accent'], ['accent2', '--accent-2'], ['accentSoft', '--accent-soft'], ['indigoSoft', '--indigo-soft'],
  ['onAccent', '--on-accent'], ['ivory', '--ivory'], ['onIvory', '--on-ivory'],
  ['telemetry', '--telemetry'], ['telemetrySoft', '--telemetry-soft'],
  ['green', '--green'], ['greenSoft', '--green-soft'],
  ['red', '--red'], ['redSoft', '--red-soft'],
  ['amber', '--amber'], ['amberSoft', '--amber-soft'],
  ['blue', '--blue'], ['blueSoft', '--blue-soft'],
];

function colorBlock(theme, selector) {
  const lines = cssColorMap.map(([key, cssVar]) => `  ${cssVar}: ${theme[key]};`);
  return `${selector} {\n${lines.join('\n')}\n}`;
}

/* ---------- Web: public/tokens.css ---------- */
const tokensCss = `/* ============================================================
   AKBARAL! Design System — generated design tokens (web).
   DO NOT EDIT BY HAND — edit design-system/tokens.json and run:
     node design-system/build.mjs
   Identity: obsidian foundation · indigo/violet atmosphere ·
   glass surfaces · cinematic lighting · technical elegance.
   Version ${tokens.version}
   ============================================================ */

${colorBlock(DARK, ':root')}

${colorBlock(LIGHT, '[data-theme="light"]')}

:root {
  /* Typography (families resolved per-platform; scale semantics in tokens.json) */
  --font-sans: ${tokens.typography.families.web.sans};
  --font-display: ${tokens.typography.families.web.display};
  --font-mono: ${tokens.typography.families.web.mono};

  /* Radii */
  --radius-sm: ${tokens.radius.sm}px;
  --radius: ${tokens.radius.md}px;
  --radius-lg: ${tokens.radius.lg}px;
  --radius-xl: ${tokens.radius.xl}px;

  /* Shadows & glows */
  --shadow: ${tokens.shadow.dark.shadow};
  --shadow-soft: ${tokens.shadow.dark.shadowSoft};
  --glow-accent: ${tokens.shadow.dark.glowAccent};
  --glow-telemetry: ${tokens.shadow.dark.glowTelemetry};

  /* Motion */
  --ease-out: ${tokens.motion.easing.out};
  --ease-soft: ${tokens.motion.easing.soft};
  --dur-fast: ${tokens.motion.duration.fast}ms;
  --dur-base: ${tokens.motion.duration.base}ms;
  --dur-slow: ${tokens.motion.duration.slow}ms;
  --dur-cinematic: ${tokens.motion.duration.cinematic}ms;

  /* Layout */
  --header-h: ${tokens.layout.web.headerHeight}px;
  --content-max: ${tokens.layout.web.contentMax}px;
  --nav-gap: 4px;
}

[data-theme="light"] {
  --shadow: ${tokens.shadow.light.shadow};
  --shadow-soft: ${tokens.shadow.light.shadowSoft};
  --glow-accent: ${tokens.shadow.light.glowAccent};
  --glow-telemetry: ${tokens.shadow.light.glowTelemetry};
}
`;

/* ---------- Mobile: mobile/src/theme.ts ---------- */
const tsKeyMap = [
  ...cssColorMap
    .filter(([key]) => key !== 'surfaceRgba' && key !== 'surface2Rgba')
    .map(([key]) => [key === 'surfaceStrong' ? 'surfaceStrong' : key, key]),
  ['surface', 'surfaceSolid'],
  ['surface2', 'surface2Solid'],
];
const tsPalette = tsKeyMap
  .map(([tsKey, jsonKey]) => `  ${tsKey}: '${DARK[jsonKey]}',`)
  .join('\n');

const statusEntries = Object.entries(tokens.status.mapping)
  .map(([state, tone]) => `  ${JSON.stringify(state)}: '${tone}',`)
  .join('\n');

const themeTs = `/* AKBARAL! design tokens — GENERATED from design-system/tokens.json.
   Do not edit by hand: run \`node design-system/build.mjs\`.
   The website (public/tokens.css) and the future iOS app
   (design-system/ios/AKBARALTheme.swift) share this exact source.
   Identity: obsidian foundation · indigo/violet atmosphere ·
   glass surfaces · cinematic lighting. Dark is the platform identity. */

export const palette = {
${tsPalette}
};

export const radius = {
  sm: ${tokens.radius.sm},
  md: ${tokens.radius.md},
  lg: ${tokens.radius.lg},
  xl: ${tokens.radius.xl},
  pill: ${tokens.radius.pill},
};

export const spacing = {
  xs: ${tokens.spacing.xs},
  sm: ${tokens.spacing.sm},
  md: ${tokens.spacing.md},
  lg: ${tokens.spacing.lg},
  xl: ${tokens.spacing.xl},
  xxl: ${tokens.spacing.xxl},
  xxxl: ${tokens.spacing.xxxl},
};

export const shadow = {
  card: {
    shadowColor: '${tokens.shadow.mobile.card.color}',
    shadowOpacity: ${tokens.shadow.mobile.card.opacity},
    shadowRadius: ${tokens.shadow.mobile.card.radius},
    shadowOffset: { width: 0, height: ${tokens.shadow.mobile.card.offsetY} },
    elevation: ${tokens.shadow.mobile.card.elevation},
  },
  glow: {
    shadowColor: '${tokens.shadow.mobile.glow.color}',
    shadowOpacity: ${tokens.shadow.mobile.glow.opacity},
    shadowRadius: ${tokens.shadow.mobile.glow.radius},
    shadowOffset: { width: 0, height: ${tokens.shadow.mobile.glow.offsetY} },
    elevation: ${tokens.shadow.mobile.glow.elevation},
  },
};

/** Shared typographic scale (see tokens.json typography.scale). */
export const type = {
  micro: { fontSize: ${tokens.typography.scale.micro.size}, fontWeight: '${tokens.typography.scale.micro.weight}', letterSpacing: ${tokens.typography.scale.micro.tracking} },
  xs: { fontSize: ${tokens.typography.scale.xs.size}, fontWeight: '${tokens.typography.scale.xs.weight}', letterSpacing: ${tokens.typography.scale.xs.tracking} },
  body: { fontSize: ${tokens.typography.scale.body.size}, fontWeight: '${tokens.typography.scale.body.weight}', letterSpacing: ${tokens.typography.scale.body.tracking} },
  emphasis: { fontSize: ${tokens.typography.scale.emphasis.size}, fontWeight: '${tokens.typography.scale.emphasis.weight}', letterSpacing: ${tokens.typography.scale.emphasis.tracking} },
  md: { fontSize: ${tokens.typography.scale.md.size}, fontWeight: '${tokens.typography.scale.md.weight}', letterSpacing: ${tokens.typography.scale.md.tracking} },
  heading: { fontSize: ${tokens.typography.scale.heading.size}, fontWeight: '${tokens.typography.scale.heading.weight}', letterSpacing: ${tokens.typography.scale.heading.tracking} },
  xl: { fontSize: ${tokens.typography.scale.xl.size}, fontWeight: '${tokens.typography.scale.xl.weight}', letterSpacing: ${tokens.typography.scale.xl.tracking} },
  xxl: { fontSize: ${tokens.typography.scale.xxl.size}, fontWeight: '${tokens.typography.scale.xxl.weight}', letterSpacing: ${tokens.typography.scale.xxl.tracking} },
  display: { fontSize: ${tokens.typography.scale.display.size}, fontWeight: '${tokens.typography.scale.display.weight}', letterSpacing: ${tokens.typography.scale.display.tracking} },
};

/** Motion durations (ms) — respect reduced-motion everywhere (see ui.tsx). */
export const motion = {
  instant: ${tokens.motion.duration.instant},
  fast: ${tokens.motion.duration.fast},
  base: ${tokens.motion.duration.base},
  slow: ${tokens.motion.duration.slow},
  cinematic: ${tokens.motion.duration.cinematic},
  staggerMs: ${tokens.motion.staggerMs},
};

/** Status tone mapping shared with the web client. */
export type StatusTone = 'green' | 'red' | 'amber' | 'telemetry' | 'neutral';

const STATUS_TONES: Record<string, StatusTone> = {
${statusEntries}
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
  return 222 + (fnv1a(\`\${name}|\${category}\`) % 78);
}

/** Agent monogram: initials of the first two words (or first two chars). */
export function agentMonogram(name: string): string {
  const words = String(name || '').trim().split(/\\s+/).filter(Boolean);
  if (words.length === 0) return 'A';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function sigilColors(name: string, category = ''): { hue: number; border: string; fill: string; text: string; glow: string } {
  const hue = agentHue(name, category);
  return {
    hue,
    border: \`hsla(\${hue}, 90%, 74%, 0.42)\`,
    fill: \`hsla(\${hue}, 90%, 64%, 0.15)\`,
    text: \`hsla(\${hue}, 95%, 82%, 1)\`,
    glow: \`hsla(\${hue}, 95%, 74%, 0.45)\`,
  };
}
`;

/* ---------- iOS: design-system/ios/AKBARALTheme.swift (future app) ---------- */
function swiftColor(key, dark, light, comment) {
  return `    /// ${comment}
    static let ${key} = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("${DARK[dark]}") : hex("${LIGHT[light]}")
    }`;
}

const swift = `// ============================================================
// AKBARALTheme.swift — AKBARAL! Design System tokens for iOS.
//
// GENERATED from design-system/tokens.json (v${tokens.version}) —
// run \`node design-system/build.mjs\` after token edits.
//
// STATUS: prepared design tokens for the FUTURE iOS app. There is
// no iOS application in production yet — this file intentionally
// ships no app, no screens and no fake functionality. When the iOS
// release begins, consume these tokens exactly as the Android app
// consumes mobile/src/theme.ts and the website consumes
// public/tokens.css: one identity, native feel.
//
// Identity: obsidian foundation · indigo/violet atmosphere ·
// glass surfaces · cinematic lighting · technical elegance.
// ============================================================//

import UIKit

enum AKBARALTheme {

    // MARK: - Foundation (obsidian)

    private static func hex(_ value: String) -> UIColor {
        var raw = value.trimmingCharacters(in: .whitespaces)
        if raw.hasPrefix("#") { raw.removeFirst() }
        var rgba: UInt64 = 0
        Scanner(string: raw).scanHexInt64(&rgba)
        let r = CGFloat((rgba & 0xff0000) >> 16) / 255
        let g = CGFloat((rgba & 0x00ff00) >> 8) / 255
        let b = CGFloat(rgba & 0x0000ff) / 255
        return UIColor(red: r, green: g, blue: b, alpha: 1)
    }

${swiftColor('bgDeep', 'bgDeep', 'bgDeep', 'Deepest obsidian layer (footers, wells).')}
${swiftColor('bg', 'bg', 'bg', 'Base obsidian canvas.')}
${swiftColor('bg2', 'bg2', 'bg2', 'Raised obsidian (cards, bars).')}
${swiftColor('bg3', 'bg3', 'bg3', 'Highest obsidian (hover, emphasis).')}
${swiftColor('surface', 'surfaceSolid', 'surfaceSolid', 'Card surface.')}
${swiftColor('surface2', 'surface2Solid', 'surface2Solid', 'Secondary surface.')}
${swiftColor('surfaceStrong', 'surfaceStrong', 'surfaceStrong', 'Strong surface (dialogs, sheets).')}

    // MARK: - Text ramp

${swiftColor('text', 'text', 'text', 'Primary text.')}
${swiftColor('text2', 'text2', 'text2', 'Secondary text.')}
${swiftColor('textDim', 'textDim', 'textDim', 'Muted text / labels.')}
${swiftColor('textFaint', 'textFaint', 'textFaint', 'Faint text / metadata.')}

    // MARK: - Atmosphere (the only accent family)

${swiftColor('accent', 'accent', 'accent', 'Violet — the AKBARAL! accent.')}
${swiftColor('accent2', 'accent2', 'accent2', 'Indigo — accent companion.')}
${swiftColor('onAccent', 'onAccent', 'onAccent', 'Text on accent fills.')}
${swiftColor('telemetry', 'telemetry', 'telemetry', 'Cyan — live/running telemetry only.')}

    // MARK: - Status

${swiftColor('statusGreen', 'green', 'green', 'Success / completed / active.')}
${swiftColor('statusRed', 'red', 'red', 'Failure / blocked / disabled.')}
${swiftColor('statusAmber', 'amber', 'amber', 'Pending / queued / retrying.')}
${swiftColor('statusBlue', 'blue', 'blue', 'Informational.')}

    // MARK: - Spacing (pt)

    enum Spacing {
        static let xs: CGFloat  = ${tokens.spacing.xs}
        static let sm: CGFloat  = ${tokens.spacing.sm}
        static let md: CGFloat  = ${tokens.spacing.md}
        static let lg: CGFloat  = ${tokens.spacing.lg}
        static let xl: CGFloat  = ${tokens.spacing.xl}
        static let xxl: CGFloat = ${tokens.spacing.xxl}
    }

    // MARK: - Radii (pt)

    enum Radius {
        static let sm: CGFloat   = ${tokens.radius.sm}
        static let md: CGFloat   = ${tokens.radius.md}
        static let lg: CGFloat   = ${tokens.radius.lg}
        static let xl: CGFloat   = ${tokens.radius.xl}
    }

    // MARK: - Typography scale

    enum Type {
        static let micro: CGFloat    = ${tokens.typography.scale.micro.size}   // uppercase, tracking +2
        static let xs: CGFloat       = ${tokens.typography.scale.xs.size}
        static let body: CGFloat     = ${tokens.typography.scale.body.size}
        static let md: CGFloat       = ${tokens.typography.scale.md.size}
        static let heading: CGFloat  = ${tokens.typography.scale.heading.size}
        static let xl: CGFloat       = ${tokens.typography.scale.xl.size}
        static let xxl: CGFloat      = ${tokens.typography.scale.xxl.size}
        static let display: CGFloat  = ${tokens.typography.scale.display.size}
    }

    // MARK: - Motion (honor UIAccessibility.isReduceMotionEnabled)

    enum Motion {
        static let instant: TimeInterval   = ${tokens.motion.duration.instant}.0 / 1000
        static let fast: TimeInterval      = ${tokens.motion.duration.fast}.0 / 1000
        static let base: TimeInterval      = ${tokens.motion.duration.base}.0 / 1000
        static let slow: TimeInterval      = ${tokens.motion.duration.slow}.0 / 1000
        static let cinematic: TimeInterval = ${tokens.motion.duration.cinematic}.0 / 1000
    }

    // MARK: - Agent identity (sigil)

    /// Deterministic indigo→violet band (222..299) for an agent.
    /// Mirrors agentHue() in mobile/src/theme.ts and public/app.js.
    static func agentHue(name: String, category: String = "") -> CGFloat {
        var hash: UInt32 = 0x811c9dc5
        for byte in (name + "|" + category).utf8 {
            hash ^= UInt32(byte)
            hash = hash &* 0x01000193
        }
        return CGFloat(222 + Int(hash % 78))
    }

    /// Agent monogram: initials of the first two words (or first two chars).
    static func agentMonogram(_ name: String) -> String {
        let words = name.trimmingCharacters(in: .whitespaces)
            .components(separatedBy: .whitespaces).filter { !$0.isEmpty }
        guard let first = words.first else { return "A" }
        if words.count == 1 { return String(first.prefix(2)).uppercased() }
        return String([first.first!, words[1].first!]).uppercased()
    }

    /// Primary gradient: indigo → violet (buttons, marks, emphasis).
    static let accentGradient = [accent2.cgColor, accent.cgColor]
}
`;

/* ---------- Write outputs ---------- */
function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`  wrote ${path} (${content.length} bytes)`);
}

console.log('AKBARAL! Design System — compiling tokens…');
write(join(root, 'public', 'tokens.css'), tokensCss);
write(join(root, 'mobile', 'src', 'theme.ts'), themeTs);
write(join(root, 'design-system', 'ios', 'AKBARALTheme.swift'), swift);
console.log('Done. Web, Android and (future) iOS now share one identity.');
