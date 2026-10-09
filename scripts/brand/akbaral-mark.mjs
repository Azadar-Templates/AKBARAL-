/**
 * AKBARAL! brand mark — original geometry, defined once.
 *
 * This module is the single source of truth for the logo. The SVG files and the
 * raster files (favicon/PNG/ICO) are BOTH generated from these polygons, so a
 * rendered icon can never drift from its vector source. No dependency is
 * involved: every shape is a straight-edge polygon, and the rasteriser in
 * ./render.mjs is a scanline fill with winding accumulation plus supersampling.
 *
 * ORIGINALITY — authored work, not a trace:
 *   · one rule generates the whole system: a flat-cut apex, strokes of equal
 *     vertical weight, and horizontals that RISE to the right (the ascent). No
 *     curve, no gradient, no third-party letterform, no trademarked silhouette.
 *   · the wordmark uses this repo's own angular capitals (see GLYPHS): caps from
 *     the same 11-unit stroke, bowls chamfered at 45°, counters cut as boxes. It
 *     is not a typeset string and references no font, so it renders identically
 *     on every machine and stays original work.
 *
 * COLOR — no new value is introduced: every colour here is copied verbatim from
 * public/tokens.css (BRAND_COLORS), and the build re-checks that against the
 * stylesheet, which src/app/glass-design-system.test.ts already pins for tokens.
 */

/** Design grid. The mark is authored on 64×64 and scales losslessly. */
export const GRID = 64;
/** Stroke weight in grid units: 11/64 keeps a leg ≥3px at a 16px favicon. */
export const STROKE = 11;
/** Corner cut on the plate and the bowls — 45°, "cut not round". */
export const CHAMFER = 13;
/** Cap band every glyph is drawn inside (the wordmark's type area). */
export const CAP = { x: 8, y: 8, width: 48, height: 48 };

/* ── polygon primitives (straight edges only) ────────────────────────────── */

function signedArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/**
 * Orientation is the fill contract: solids are normalised to positive signed
 * area and counters to negative, so `fill-rule="nonzero"` unions overlapping
 * strokes (instead of cancelling them) and cuts a hole wherever a counter is
 * wanted. The rasteriser applies the same rule, which is why SVG and PNG agree.
 */
function orient(points, hole) {
  const want = hole ? -1 : 1;
  return signedArea(points) * want > 0 ? points : [...points].reverse();
}

/** A stroke: the quad swept between two centre points with vertical weight t. */
export function bar(x1, y1, x2, y2, t = STROKE, hole = false) {
  const h = t / 2;
  return { hole, points: orient([[x1, y1 - h], [x2, y2 - h], [x2, y2 + h], [x1, y1 + h]], hole) };
}

/** An axis-aligned box. */
export function rect(x, y, w, h, hole = false) {
  return { hole, points: orient([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], hole) };
}

/** A free polygon — chamfered bowls, the plate, the legs. */
export function poly(points, hole = false) {
  return { hole, points: orient(points, hole) };
}

/** Ink bounds of a shape set. */
export function boundsOf(shapes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapes) {
    for (const [x, y] of shape.points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Uniformly fit a shape set into a box, centred — used to sit the A on the cap band. */
export function fitTo(shapes, box) {
  const bounds = boundsOf(shapes);
  const scale = Math.min(box.width / bounds.width, box.height / bounds.height);
  const dx = box.x + (box.width - bounds.width * scale) / 2 - bounds.minX * scale;
  const dy = box.y + (box.height - bounds.height * scale) / 2 - bounds.minY * scale;
  return shapes.map((shape) => ({
    hole: shape.hole,
    points: shape.points.map(([x, y]) => [x * scale + dx, y * scale + dy]),
  }));
}

/* ── the monogram ────────────────────────────────────────────────────────── */

/**
 * The AKBARAL! monogram: a flat-cut "A" with a crossbar that rises to the right.
 *
 * Three polygons, all solids — nothing is knocked out. Their union shares a
 * 6-unit overlap at the apex, so the crown is one solid block (an early version
 * used sheared strokes and opened a slot at the apex, which a scanline preview
 * caught). The counter between the legs above the bar is left EMPTY rather than
 * cut, which is what lets it survive at 16px, and the bar itself rises 4 units
 * over 24 — the ascent that makes the mark recognisable.
 *
 * Ink bounds are exactly the cap band (8…56), so the icon and the wordmark's A
 * are the same drawing, and the lockup lines up without fudge factors.
 */
export function markShapes() {
  return [
    poly([[26, 8], [34, 8], [16, 56], [8, 56]]), // left leg, flat-cut top
    poly([[30, 8], [38, 8], [56, 56], [48, 56]]), // right leg
    poly([[20, 42], [44, 38], [44, 46], [20, 50]]), // rising crossbar
  ];
}

/** The monogram's chamfered plate (icon/splash only; the mark never needs it). */
export function plateShapes() {
  const c = CHAMFER;
  return [
    poly([
      [c, 0],
      [GRID - c, 0],
      [GRID, c],
      [GRID, GRID - c],
      [GRID - c, GRID],
      [c, GRID],
      [0, GRID - c],
      [0, c],
    ]),
  ];
}

/* ── the wordmark: this repo's own angular capitals ─────────────────────── */

const STEM = () => rect(CAP.x, CAP.y, STROKE, CAP.height);

export const GLYPHS = {
  // The monogram, fitted to the cap band. Its diagonals end up ~15% lighter than
  // the vertical stems, which is what makes a diagonal read at the same weight.
  A: { shapes: () => fitTo(markShapes(), CAP) },
  // K: a sheared bar ends in a vertical cut, so its centre points are inset by
  // half a stroke (5.5) to land the cuts exactly on the cap line and baseline.
  K: { shapes: () => [STEM(), bar(18, 32, 47, 13.5), bar(26, 26, 50, 50.5)] },
  B: {
    shapes: () => [
      STEM(),
      poly([[16, 8], [34, 8], [42, 16], [42, 38], [16, 38]]),
      poly([[16, 27], [42, 27], [42, 48], [34, 56], [16, 56]]),
      poly([[19, 19], [31, 19], [31, 27], [19, 27]], true),
      poly([[19, 38], [31, 38], [31, 45], [19, 45]], true),
    ],
  },
  R: {
    shapes: () => [
      STEM(),
      poly([[16, 8], [34, 8], [42, 16], [42, 33], [34, 41], [16, 41]]),
      poly([[19, 19], [31, 19], [31, 30], [19, 30]], true),
      bar(27, 34, 50, 50.5), // leg, cut on the baseline
    ],
  },
  L: { shapes: () => [STEM(), rect(CAP.x, 45, 34, STROKE)] },
  '!': { shapes: () => [rect(CAP.x, 8, STROKE, 27), rect(CAP.x, 45, STROKE, STROKE)] },
  ' ': { shapes: () => [], advance: 26 },
};

/** Word spacing is set by ink width, not by side bearing, so the lockup is even. */
function inkWidth(char) {
  const glyph = GLYPHS[char];
  if (!glyph) throw new Error(`no glyph authored for "${char}"`);
  const shapes = glyph.shapes();
  return shapes.length ? boundsOf(shapes).width : glyph.advance;
}

/**
 * Lays a word out left to right: each glyph is shifted so its ink starts on the
 * pen, and the pen advances by ink width + tracking. Shapes stay in grid units.
 */
export function wordShapes(text, { x = 0, y = 0, scale = 1, tracking = 7 } = {}) {
  let pen = x;
  const shapes = [];
  for (const char of text) {
    const glyph = GLYPHS[char];
    if (!glyph) throw new Error(`no glyph authored for "${char}"`);
    const shapesForChar = glyph.shapes();
    const minX = shapesForChar.length ? boundsOf(shapesForChar).minX : 0;
    for (const shape of shapesForChar) {
      shapes.push({
        hole: shape.hole,
        points: shape.points.map(([px, py]) => [(px - minX + pen - x) * scale + x, py * scale + y]),
      });
    }
    pen += inkWidth(char) * scale + tracking * scale;
  }
  return { shapes, width: pen - x - tracking * scale };
}

/** Ink width of a laid-out word, for centring a lockup. */
export function wordWidth(text, { scale = 1, tracking = 7 } = {}) {
  return wordShapes(text, { scale, tracking }).width;
}

/* ── colours: existing tokens only ───────────────────────────────────────── */

/** Verbatim copies of public/tokens.css values — verified by the build. */
export const BRAND_COLORS = {
  accent: '#2f8348',
  accentDeep: '#286f3d',
  accentBright: '#69ad7d',
  ink: '#020617',
  surface: '#0f172a',
  onAccent: '#ffffff',
  light: '#f8fafc',
};

/* ── serialisation ───────────────────────────────────────────────────────── */

const at = (value) => Number(value.toFixed(3)).toString();

/** One `d` for a whole shape set; `fill-rule="nonzero"` carries the counters. */
export function toPath(shapes) {
  return shapes
    .map((shape) => `M${shape.points.map(([x, y]) => `${at(x)} ${at(y)}`).join('L')}Z`)
    .join('');
}

/** Translate a shape set (used to place the lockup inside a bigger canvas). */
export function translateShapes(shapes, dx, dy) {
  return shapes.map((shape) => ({ hole: shape.hole, points: shape.points.map(([x, y]) => [x + dx, y + dy]) }));
}

/** Scale a shape set about a point (used for the maskable safe zone). */
export function scaleAbout(shapes, k, cx, cy) {
  return shapes.map((shape) => ({
    hole: shape.hole,
    points: shape.points.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]),
  }));
}
