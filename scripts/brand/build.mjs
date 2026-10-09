/**
 * Builds every AKBARAL! brand asset from the geometry in ./akbaral-mark.mjs.
 *
 *   node scripts/brand/build.mjs            write the assets
 *   node scripts/brand/build.mjs --check     fail if anything on disk is stale
 *
 * Why a build step instead of hand-drawn files: the SVGs, the PNGs, the .ico and
 * the path data the React component inlines are all produced from ONE polygon
 * set, so no surface can end up showing a different logo than another, and no
 * raster can drift from its vector. PNG and ICO are encoded here by hand
 * (node:zlib + a CRC32) so the repo gains no dependency.
 *
 * The rasters are the only reason this script exists at build time; every output
 * is committed, so nothing here runs in the app or in CI beyond `--check`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BRAND_COLORS,
  CAP,
  GRID,
  boundsOf,
  markShapes,
  plateShapes,
  rect,
  scaleAbout,
  toPath,
  translateShapes,
  wordShapes,
} from './akbaral-mark.mjs';
import { encodeIco, encodePng, renderLayers } from './render.mjs';

const root = process.cwd();
const check = process.argv.includes('--check');
const outDir = join(root, 'public', 'brand');

const hexToRgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

/* ── colour gate: reuse tokens, never invent one ─────────────────────────── */

const tokensCss = readFileSync(join(root, 'public', 'tokens.css'), 'utf8');
for (const [name, value] of Object.entries(BRAND_COLORS)) {
  if (!tokensCss.includes(value)) {
    throw new Error(`brand colour ${name} (${value}) is not a value in public/tokens.css — no new colour may be introduced`);
  }
}

const C = BRAND_COLORS;
const RGB = Object.fromEntries(Object.entries(C).map(([name, hex]) => [name, hexToRgb(hex)]));

/* ── geometry shared by the lockups ──────────────────────────────────────── */

const WORD = 'AKBARAL!';
const GAP = 16; // mark-to-word gap, grid units
const word = wordShapes(WORD, { x: GRID + GAP, tracking: 7 });
const LOCKUP = { width: GRID + GAP + word.width, height: GRID };

/* ── SVG assembly ────────────────────────────────────────────────────────── */

const SOURCE_NOTE = `AKBARAL! brand asset — GENERATED, do not hand-edit.
 Source of truth: scripts/brand/akbaral-mark.mjs (build: npm run brand:build).
 Original work authored in this repository: straight-edge polygons only, no
 third-party or trademarked shapes, no font, no raster, no external reference.
 Colour: values are existing public/tokens.css tokens, nothing new.`;

function svg({ width, height, children, label }) {
  const body = children.map((child) => `    <path${child.fill ? ` fill="${child.fill}"` : ''} fill-rule="nonzero" d="${child.d}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  ${SOURCE_NOTE}
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(height)}" width="${round(width)}" height="${round(height)}" role="img" aria-label="${label}">
  <title>${label}</title>
  <desc>Original AKBARAL! mark: flat-cut apex, equal-weight strokes, rising crossbar.</desc>
${body}
</svg>
`;
}

const round = (value) => Number(value.toFixed(3)).toString();

/* ── the files ───────────────────────────────────────────────────────────── */

const markPath = toPath(markShapes());
const platePath = toPath(plateShapes());
const wordPath = toPath(word.shapes);

/** @type {Array<{path: string, text?: string, bytes?: Buffer}>} */
const files = [];
const add = (path, contents) => files.push({ path, text: typeof contents === 'string' ? contents : undefined, bytes: Buffer.isBuffer(contents) ? contents : undefined });

add('public/brand/akbaral-mark.svg', svg({
  width: GRID,
  height: GRID,
  label: 'AKBARAL! monogram',
  children: [{ d: markPath, fill: C.accent }],
}));

add('public/brand/akbaral-mark-light.svg', svg({
  width: GRID,
  height: GRID,
  label: 'AKBARAL! monogram',
  children: [{ d: markPath, fill: C.light }],
}));

add('public/brand/akbaral-icon.svg', svg({
  width: GRID,
  height: GRID,
  label: 'AKBARAL! icon',
  children: [{ d: platePath, fill: C.ink }, { d: markPath, fill: C.accentBright }],
}));

add('public/brand/akbaral-logo.svg', svg({
  width: LOCKUP.width,
  height: LOCKUP.height,
  label: 'AKBARAL!',
  children: [{ d: markPath, fill: C.accentBright }, { d: wordPath, fill: C.light }],
}));

// Monochrome variants: one flat ink, no plate, no two-tone split.
add('public/brand/akbaral-logo-mono.svg', svg({
  width: LOCKUP.width,
  height: LOCKUP.height,
  label: 'AKBARAL!',
  children: [{ d: `${markPath}${wordPath}`, fill: C.light }],
}));

add('public/brand/akbaral-logo-ink.svg', svg({
  width: LOCKUP.width,
  height: LOCKUP.height,
  label: 'AKBARAL!',
  children: [{ d: `${markPath}${wordPath}`, fill: C.ink }],
}));

/* ── rasters ─────────────────────────────────────────────────────────────── */

const iconLayers = (size) => [
  { shapes: plateShapes(), color: RGB.ink },
  { shapes: markShapes(), color: RGB.accentBright },
];

const raster = (spec) => encodePng(renderLayers(spec));
const pngs = new Map();

for (const size of [16, 32, 48, 180, 192, 512]) {
  // Apple applies its own mask to the corners, so the 180 tile is a full square.
  const plate = size === 180 ? [rect(0, 0, GRID, GRID)] : plateShapes();
  const png = raster({
    size,
    viewBox: GRID,
    samples: size <= 48 ? 6 : 3,
    layers: [{ shapes: plate, color: RGB.ink }, { shapes: markShapes(), color: RGB.accentBright }],
  });
  pngs.set(size, png);
  add(`public/brand/akbaral-icon-${size}.png`, png);
}

// Maskable variant for the manifest: the mark must sit inside the 80% safe
// circle, so it is scaled about the centre before it is ever rasterised.
const SAFE = 0.74;
add('public/brand/akbaral-icon-maskable-512.png', raster({
  size: 512,
  viewBox: GRID,
  samples: 3,
  layers: [
    { shapes: plateShapes(), color: RGB.ink },
    { shapes: scaleAbout(markShapes(), SAFE, GRID / 2, GRID / 2), color: RGB.accentBright },
  ],
}));

// favicon.ico carries the three browser-chrome sizes as PNG-compressed frames.
add('public/favicon.ico', encodeIco([16, 32, 48].map((size) => ({ size, png: pngs.get(size) }))));

/* Open Graph / Twitter card: 1200×630, the lockup centred on the app's ink. */
const OG = { width: 1200, height: 630 };
const ogScale = OG.width * 0.72 / LOCKUP.width;
const ogViewBox = OG.width / ogScale;
const ogX = (ogViewBox - LOCKUP.width) / 2;
const ogY = (OG.height / ogScale - LOCKUP.height) / 2;
const ogBar = { width: LOCKUP.width - GRID - GAP, x: GRID + GAP };
add('public/brand/akbaral-og-1200x630.png', raster({
  ...OG,
  viewBox: ogViewBox,
  samples: 2,
  layers: [
    { shapes: [rect(0, 0, ogViewBox, OG.height / ogScale)], color: RGB.ink },
    { shapes: translateShapes(plateShapes(), ogX, ogY), color: RGB.surface },
    { shapes: translateShapes(markShapes(), ogX, ogY), color: RGB.accentBright },
    { shapes: translateShapes(word.shapes, ogX, ogY), color: RGB.light },
    {
      // A hairline of accent under the wordmark, exactly as wide as the word.
      shapes: [rect(ogX + GRID + GAP, ogY + GRID - 2, ogBar.width, 3)],
      color: RGB.accent,
    },
  ],
}));

/* ── the path data the app inlines (no second copy of the geometry) ──────── */

const bounds = boundsOf(markShapes());
add(
  'src/app/_components/brand-mark-data.ts',
  `/**
 * GENERATED by scripts/brand/build.mjs — do not hand-edit, and do not treat the
 * literals below as a place to change the brand. The geometry, the colours and
 * the rasters all come out of scripts/brand/akbaral-mark.mjs, which is why the
 * favicon and the header tile cannot drift apart.
 *
 * ${'`'}npm run brand:build${'`'} regenerates this file; ${'`'}npm run brand:check${'`'} (run by
 * src/app/brand-assets.test.ts) fails when a checked-in asset no longer matches
 * its source.
 */

/** Square grid the monogram is authored on. */
export const BRAND_MARK_VIEWBOX = ${GRID};

/** Ink box inside that grid — the mark never touches the edge of its own frame. */
export const BRAND_MARK_INK = { x: ${bounds.minX}, y: ${bounds.minY}, width: ${round(bounds.width)}, height: ${round(bounds.height)} } as const;

/** The monogram: three solids, nonzero fill, nothing knocked out. */
export const BRAND_MARK_PATH = '${markPath}';

/** Horizontal lockup — monogram plus the AKBARAL! wordmark in authored glyphs. */
export const BRAND_LOGO_VIEWBOX = '0 0 ${round(LOCKUP.width)} ${round(LOCKUP.height)}';
export const BRAND_LOGO_MARK_PATH = '${markPath}';
export const BRAND_LOGO_WORD_PATH = '${wordPath}';

/** Public file paths, kept next to the geometry so a wiring test can pin them. */
export const BRAND_ASSETS = {
  mark: '/brand/akbaral-mark.svg',
  markLight: '/brand/akbaral-mark-light.svg',
  icon: '/brand/akbaral-icon.svg',
  logo: '/brand/akbaral-logo.svg',
  logoMono: '/brand/akbaral-logo-mono.svg',
  logoInk: '/brand/akbaral-logo-ink.svg',
  favicon: '/favicon.ico',
  favicon16: '/brand/akbaral-icon-16.png',
  favicon32: '/brand/akbaral-icon-32.png',
  favicon48: '/brand/akbaral-icon-48.png',
  appleTouchIcon: '/apple-touch-icon.png',
  icon192: '/brand/akbaral-icon-192.png',
  icon512: '/brand/akbaral-icon-512.png',
  iconMaskable512: '/brand/akbaral-icon-maskable-512.png',
  ogImage: '/brand/akbaral-og-1200x630.png',
  manifest: '/manifest.webmanifest',
} as const;

export const BRAND_ICON_PNGS = [${[16, 32, 48, 180, 192, 512].map((size) => `'${`/brand/akbaral-icon-${size}.png`}'`).join(', ')}] as const;

export const BRAND_MANIFEST_ICONS = ${JSON.stringify(
    [
      { src: '/brand/akbaral-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/akbaral-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    null,
    2,
  )} as const;
`,
);

// The apple-touch path is the conventional one, so the file also lives at the root.
add('public/apple-touch-icon.png', pngs.get(180));

/* ── site manifest (the public app had none; the mission one stays put) ──── */

add(
  'public/manifest.webmanifest',
  `{
  "name": "AKBARAL!",
  "short_name": "AKBARAL!",
  "description": "One Intelligence. Every Solution.",
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "${C.ink}",
  "theme_color": "${C.accent}",
  "icons": ${JSON.stringify(
    [
      { src: '/brand/akbaral-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/akbaral-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/akbaral-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    null,
    4,
  ).replace(/\n/g, '\n  ')}
}
`,
);

/* ── write or verify ─────────────────────────────────────────────────────── */

let stale = 0;
for (const file of files) {
  const target = join(root, file.path);
  const contents = file.bytes ?? Buffer.from(file.text, 'utf8');
  const existing = (() => {
    try {
      return readFileSync(target);
    } catch {
      return null;
    }
  })();
  if (check) {
    if (!existing || !existing.equals(contents)) {
      stale += 1;
      console.error(`STALE ${file.path}`);
    }
    continue;
  }
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, contents);
  console.log(`wrote ${file.path} (${contents.length} bytes)`);
}

if (check) {
  if (stale > 0) {
    console.error(`\n${stale} of ${files.length} brand assets do not match scripts/brand/akbaral-mark.mjs — run npm run brand:build`);
    process.exit(1);
  }
  console.log(`all ${files.length} brand assets match their geometry source`);
}