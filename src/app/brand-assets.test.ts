import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';

/**
 * Brand-asset contract for the AKBARAL! logo (added 2026-10-10).
 *
 * The logo is generated: scripts/brand/akbaral-mark.mjs holds the polygons and
 * scripts/brand/build.mjs writes the SVGs, the PNGs, the .ico, the manifest and
 * the path data src/app/_components/brand-mark.tsx inlines. That removes "the
 * favicon and the header are different logos" as a failure mode, but it creates
 * two new ones, and this file locks both:
 *
 *   1. DRIFT — a checked-in asset that no longer matches its generator. Test 1.
 *   2. WIRING — a referenced path that the server cannot serve, a content type
 *      a browser will not accept as an icon, or a logo instance that is
 *      announced to assistive tech by accident. Tests 2-8.
 *
 * Everything below reads the SAME files the app reads. HTTP-level behaviour is
 * asserted structurally (asset under public/, no route shadowing it, Docker
 * copying public/ into the image) because both tiers serve `public/` verbatim:
 * Next from `public/` and the API tier through `express.static(publicDir)`
 * (src/app.ts). The live 200s for every path are in the task report, measured
 * with curl against `next start`.
 */

const root = process.cwd();
const read = (relative: string): string => readFileSync(join(root, relative), 'utf8');
const bytes = (relative: string): Buffer => readFileSync(join(root, relative));

const layout = read('src/app/layout.tsx');
const dataModule = read('src/app/_components/brand-mark-data.ts');
const brandComponent = read('src/app/_components/brand-mark.tsx');
const tokensCss = read('public/tokens.css');

/** Every asset path the generator publishes, read from the generated module. */
const publishedPaths = [
  ...Object.values(
    Object.fromEntries(
      [...dataModule.matchAll(/^\s{2}(\w+): '([^']+)',?$/gm)].map((match) => [match[1], match[2]]),
    ),
  ),
  ...[...dataModule.matchAll(/'\/brand\/akbaral-icon-(\d+)\.png'/g)].map((match) => `/brand/akbaral-icon-${match[1]}.png`),
] as string[];

const svgFiles = publishedPaths
  .filter((file) => file.endsWith('.svg'))
  .map((file) => join('public', file));

/* ── helpers: read back what was actually written to disk ────────────────── */

/** IHDR is fixed-offset in a PNG; this is the declared pixel box, not a guess. */
function pngDimensions(buffer: Buffer): { width: number; height: number } {
  assert.equal(buffer.subarray(1, 4).toString('latin1'), 'PNG', 'not a PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** RGBA8 for the subsets this repo generates (bit depth 8, colour type 6). */
function decodePng(buffer: Buffer): { width: number; height: number; data: Uint8ClampedArray } {
  const { width, height } = pngDimensions(buffer);
  const idat: Buffer[] = [];
  for (let pos = 8; pos + 8 <= buffer.length;) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('latin1', pos + 4, pos + 8);
    if (type === 'IDAT') idat.push(buffer.subarray(pos + 8, pos + 8 + length));
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const data = new Uint8ClampedArray(width * height * 4);
  const stride = width * 4;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const cur = raw[row * (stride + 1) + 1 + x];
      const left = x >= 4 ? data[row * stride + x - 4] : 0;
      const up = row > 0 ? data[(row - 1) * stride + x] : 0;
      const upLeft = row > 0 && x >= 4 ? data[(row - 1) * stride + x - 4] : 0;
      let predict = 0;
      if (filter === 1) predict = left;
      else if (filter === 2) predict = up;
      else if (filter === 3) predict = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predict = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      data[row * stride + x] = (cur + predict) & 255;
    }
  }
  return { width, height, data };
}

/**
 * Which ink the pixel belongs to, for the two-tone icon tiles: the mark is the
 * accent-bright green, the plate is the deep background.
 */
type Ink = 'mark' | 'plate' | 'empty';
function inkOf(pixel: Uint8ClampedArray, offset: number, markGreenAt: number): Ink {
  if (pixel[offset + 3] < 128) return 'empty';
  return pixel[offset + 1] >= markGreenAt ? 'mark' : 'plate';
}

/** Runs of `mark` ink on a scan row — the shape a browser actually paints. */
function markRuns(image: { width: number; height: number; data: Uint8ClampedArray }, row: number): number[] {
  const runs: number[] = [];
  let run = 0;
  for (let x = 0; x < image.width; x += 1) {
    if (inkOf(image.data, (row * image.width + x) * 4, 120) === 'mark') run += 1;
    else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  if (run > 0) runs.push(run);
  return runs;
}

function contrast(hex: string, other: string): number {
  const luminance = (value: string) => {
    const n = Number.parseInt(value.slice(1), 16);
    const channel = (shift: number) => {
      const c = ((n >> shift) & 255) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  };
  const [high, low] = [luminance(hex), luminance(other)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

describe('brand assets — generated, wired, and serveable', () => {
  it('every checked-in asset matches the geometry it was generated from', () => {
    // The one test that makes hand-editing a PNG or an SVG pointless: re-run the
    // generator in --check mode and require it to find nothing stale.
    const stdout = execFileSync(process.execPath, [join(root, 'scripts', 'brand', 'build.mjs'), '--check'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.match(stdout, /all (\d+) brand assets match/, stdout);
    const count = Number(stdout.match(/all (\d+) brand assets match/)![1]);
    assert.ok(count >= 18, `the generator publishes the whole asset set (${count})`);
  });

  it('every referenced brand path exists under public/ and is non-empty', () => {
    const referenced = new Set<string>([
      ...publishedPaths,
      // …and only what the app actually references, so an unused file cannot
      // hide a broken reference.
      ...[...layout.matchAll(/BRAND_ASSETS\.(\w+)/g)].map((match) => {
        const value = new RegExp(`^  ${match[1]}: '([^']+)'`, 'm').exec(dataModule);
        assert.ok(value, `layout references BRAND_ASSETS.${match[1]}, which the generator does not publish`);
        return value![1];
      }),
      ...[...dataModule.matchAll(/"src": "(\/brand\/[^"]+)"/g)].map((match) => match[1]),
    ]);
    assert.ok(referenced.size >= 12, `the brand surface is real (${referenced.size} referenced paths)`);
    for (const file of referenced) {
      const target = join(root, 'public', file.replace(/^\//, ''));
      assert.ok(existsSync(target), `${file} is referenced but not present in public/`);
      assert.ok(statSync(target).size > 0, `${file} is empty`);
    }
  });

  it('serves with the right type from the repo itself: no CDN, no remote host', () => {
    for (const file of publishedPaths) {
      assert.ok(file.startsWith('/'), `${file} must be a repo-root-relative path`);
      assert.ok(!/^(https?:)?\/\//.test(file), `${file} must not point at a remote host`);
    }
    const all = read('src/app/_components/public-site-chrome.tsx') + brandComponent + layout;
    assert.ok(!/https?:\/\/[^\s"')]*\.(?:svg|png|ico)\b/.test(all), 'no remote brand image is referenced');
    // Next's `output` must stay unset and `assetPrefix` empty or the paths move.
    assert.doesNotMatch(read('next.config.mjs'), /output:\s*'(?:export|standalone)'/, 'public/ is served by the running server');
    // And the container must carry them: public/ is copied in both stages.
    const dockerfile = read('Dockerfile');
    const copies = [...dockerfile.matchAll(/^COPY public \.\/public$/gm)].length;
    assert.ok(copies >= 2, `public/ is copied into the image for build and runtime (${copies})`);
    // The API tier serves the same directory verbatim.
    assert.match(read('src/app.ts'), /express\.static\(publicDir/, 'the API tier serves public/ for /brand and /favicon.ico too');
    // No app route may shadow a brand path: /brand/* and the root files are
    // static, and src/app/assets/[file] is an explicit 3-name allowlist.
    assert.match(read(join('src', 'app', 'assets', '[file]', 'route.ts')), /'app\.js':/, 'the allowlisted asset route is the narrow one it claims to be');
    assert.ok(!existsSync(join(root, 'src', 'app', 'brand')), 'no route directory shadows /brand/*');
    assert.ok(!existsSync(join(root, 'src', 'app', 'favicon.ico')), 'no route shadows /favicon.ico');
  });

  it('declares PNG sizes that match the pixels on disk', () => {
    // Everything the metadata declares as an image/png icon must be true.
    const urlToPath = new Map([...dataModule.matchAll(/^ {2}(\w+): '([^']+)',?$/gm)].map((m) => [m[1], m[2]]));
    const declared = [...layout.matchAll(/\{ url: BRAND_ASSETS\.(\w+), type: 'image\/png', sizes: '(\d+)x(\d+)' \}/g)];
    assert.ok(declared.length >= 3, `metadata declares sized png icons (${declared.length})`);
    for (const [, key, width, height] of declared) {
      const file = urlToPath.get(key);
      assert.ok(file, `BRAND_ASSETS.${key} resolves from the generated module`);
      assert.deepEqual(
        pngDimensions(bytes(join('public', file.replace(/^\//, '')))),
        { width: Number(width), height: Number(height) },
        `${file} must match the ${width}x${height} the metadata declares`,
      );
    }
    for (const [file, size] of [
      ['/brand/akbaral-icon-16.png', 16],
      ['/brand/akbaral-icon-32.png', 32],
      ['/brand/akbaral-icon-48.png', 48],
      ['/apple-touch-icon.png', 180],
      ['/brand/akbaral-icon-192.png', 192],
      ['/brand/akbaral-icon-512.png', 512],
    ] as const) {
      const image = pngDimensions(bytes(join('public', file)));
      assert.deepEqual(image, { width: size, height: size }, `${file} must be ${size}×${size}`);
    }
    const og = pngDimensions(bytes(join('public', 'brand', 'akbaral-og-1200x630.png')));
    assert.deepEqual(og, { width: 1200, height: 630 }, 'the Open Graph card is the size the metadata declares');
    for (const [, , width, height] of declared) {
      assert.equal(width, height, 'icon sizes are square');
    }
  });

  it('keeps the mark legible at 16px and 512px by measuring the rasters', () => {
    const small = decodePng(bytes(join('public', 'brand', 'akbaral-icon-16.png')));
    const large = decodePng(bytes(join('public', 'brand', 'akbaral-icon-512.png')));
    const topology: number[][] = [];
    for (const [label, image] of [['16px', small], ['512px', large]] as const) {
      const markPixels = [...Array(image.width * image.height).keys()].filter(
        (i) => inkOf(image.data, i * 4, 120) === 'mark',
      ).length;
      const share = markPixels / (image.width * image.height);
      assert.ok(share > 0.04, `${label}: the mark is present, not a speck (${(share * 100).toFixed(1)}% of the tile)`);
      assert.ok(share < 0.45, `${label}: the mark has breathing room inside the plate (${(share * 100).toFixed(1)}%)`);
      // Topology, measured row by row, must hold at every size — a shape that
      // only reads at one of them is not a logo. Rows are described by their
      // runs of mark ink, which is what a browser actually paints.
      const runsByRow = Array.from({ length: image.height }, (_, row) => markRuns(image, row));
      const markRows = runsByRow.flatMap((runs, row) => (runs.length ? [row] : []));
      assert.ok(markRows.length > image.height * 0.5, `${label}: the mark fills its tile vertically`);
      const first = markRows[0];
      const last = markRows.at(-1)!;
      // A flat-cut apex: the first row is one block, not two meeting strokes.
      assert.deepEqual(runsByRow[first].length, 1, `${label}: the crown is solid (row ${first})`);
      // The crossbar is the widest thing in the mark and sits in its middle.
      const widest = Math.max(...runsByRow.map((runs) => Math.max(0, ...runs)));
      const barRow = runsByRow.findIndex((runs) => Math.max(0, ...runs) === widest);
      assert.ok(widest / image.width >= 0.5, `${label}: the crossbar spans the mark (${widest}px of ${image.width})`);
      assert.ok(barRow > first + 2 && barRow < last, `${label}: the crossbar sits between apex and feet (row ${barRow} of ${first}..${last})`);
      // The counter — the void between the legs above the bar — has to survive.
      const counter = runsByRow.slice(first + 2, barRow).filter((runs) => runs.length >= 2);
      assert.ok(counter.length >= 2, `${label}: the counter stays open for ${counter.length} rows above the crossbar`);
      // And the two feet stay two feet, not a blob.
      assert.deepEqual(runsByRow[last].length, 2, `${label}: the legs end as two strokes (row ${last}: ${runsByRow[last].join(',')})`);
      topology.push([runsByRow[first].length, runsByRow[last].length, counter.length > 1 ? 1 : 0, widest > 0 ? 1 : 0]);
    }
    // Identical topology at both sizes is the actual claim: the geometry is
    // scale-stable, not tuned to look right at one rendering size.
    assert.deepEqual(topology[0], topology[1], '16px and 512px must agree on the mark topology');
  });

  it('is legible in one colour on both grounds, measured against tokens.css', () => {
    // [ink, ground, what it is used for, required ratio]
    const pairs = [
      ['#69ad7d', '#020617', 'accent-bright on the ink plate (favicon, app icon, splash)', 4.5],
      ['#ffffff', '#2f8348', 'the sign-in tile paints with --on-accent', 4.5],
      ['#286f3d', '#f8fafc', 'accent-2 on a light ground (documents, print)', 4.5],
      ['#69ad7d', '#0f172a', 'the single-colour mark on the app surface', 4.5],
      // The one-colour master (/brand/akbaral-mark.svg, --accent) has to survive
      // ANY ground with no plate behind it, so it is graded against WCAG 1.4.11's
      // 3:1 for meaningful non-text objects rather than the 4.5 text bar — and it
      // clears 3:1 on both extremes of the palette, which is the whole point.
      ['#2f8348', '#020617', 'the single-colour mark on the darkest ground', 3.0],
      ['#2f8348', '#f8fafc', 'the single-colour mark on the lightest ground', 3.0],
    ] as const;
    for (const [ink, ground, label, floor] of pairs) {
      assert.ok(tokensCss.includes(ink), `${ink} must stay an existing token (${label})`);
      assert.ok(tokensCss.includes(ground), `${ground} must stay an existing token (${label})`);
      const ratio = contrast(ink, ground);
      assert.ok(ratio >= floor, `${label}: contrast ${ratio.toFixed(2)}:1, needs ${floor}:1`);
    }
    // The rasters use only those pairs — checked against the pixels themselves.
    // A raster can only ever contain the two layer colours plus antialiased
    // blends between them. Anything outside that channel-wise box would be a
    // new colour, which this task forbids.
    const plate = [2, 6, 23]; // #020617  (--bg-deep)
    const mark = [105, 173, 125]; // #69ad7d (--accent-bright)
    assert.ok(tokensCss.includes('#020617') && tokensCss.includes('#69ad7d'), 'the two icon colours stay tokens');
    const icon = decodePng(bytes(join('public', 'brand', 'akbaral-icon-32.png')));
    let purePlate = 0;
    let pureMark = 0;
    for (let i = 0; i < icon.width * icon.height; i += 1) {
      const o = i * 4;
      if (icon.data[o + 3] < 250) continue;
      for (let c = 0; c < 3; c += 1) {
        const low = Math.min(plate[c], mark[c]);
        const high = Math.max(plate[c], mark[c]);
        assert.ok(icon.data[o + c] >= low && icon.data[o + c] <= high, `pixel ${i} channel ${c} = ${icon.data[o + c]} is outside the token range ${low}..${high}`);
      }
      if (icon.data[o + 1] === mark[1]) pureMark += 1;
      if (icon.data[o + 1] === plate[1]) purePlate += 1;
    }
    assert.ok(pureMark > 20 && purePlate > 100, `both layers are painted (${pureMark} mark, ${purePlate} plate pixels)`);
  });

  it('ships SVG that parses, is self-contained, and is original geometry', async () => {
    assert.ok(svgFiles.length >= 6, `the SVG set is shipped (${svgFiles.join(', ')})`);
    // jsdom ships no types of its own (the repo declares the surface it needs in
    // src/app/mission-gateway/jsdom.d.ts), and src/app is an ES-module scope, so
    // this reaches it the way src/app/lemon-checkout.test.ts reaches react-dom.
    const { JSDOM } = await import('jsdom');
    // The repo's ambient stub types jsdom's window as the DOM `Window`; the
    // constructor lives on `typeof globalThis`, which is the honest intersection.
    const scope = new JSDOM('<!doctype html><html></html>').window as unknown as Window & typeof globalThis;
    const parser = new scope.DOMParser();
    // …and it is a real parser, not a no-op: a mismatched tag must be rejected,
    // otherwise every assertion in this loop would pass vacuously.
    assert.notEqual(parser.parseFromString('<svg><rect></svg>', 'image/svg+xml').querySelector('parsererror'), null, 'the XML check rejects malformed markup');
    for (const file of svgFiles) {
      const source = read(file);
      // Well-formed XML, checked with a real XML parser rather than a regex:
      // a standalone .svg is served as image/svg+xml, and an SVG the browser
      // cannot parse is not an asset at all.
      const parsed = parser.parseFromString(source, 'image/svg+xml');
      const parserError = parsed.querySelector('parsererror');
      assert.equal(parserError, null, `${file} must be well-formed XML${parserError ? `: ${parserError.textContent}` : ''}`);
      const svg = parsed.documentElement;
      assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg', `${file} must parse INTO the SVG namespace`);
      assert.equal(svg.tagName, 'svg', `${file} root element`);
      assert.ok(svg.getAttribute('viewBox'), `${file} needs a viewBox to scale from 16px to 512px`);
      assert.match(source, /fill-rule="nonzero"/, `${file} carries the fill rule the counters depend on`);
      assert.match(source, /<title>/, `${file} names itself for assistive tech`);
      assert.doesNotMatch(source, /<script|<style|onclick|onload/, `${file} must never execute`);
      assert.doesNotMatch(source, /<image|xlink|href=/, `${file} must embed no raster and link to nothing`);
      assert.doesNotMatch(source, /url\(/, `${file} must not reference anything outside itself`);
      // The only URL allowed in a standalone .svg is the XML namespace
      // declaration — an identifier browsers require, never a fetch.
      for (const url of source.match(/https?:\/\/[^"'\s>]+/g) ?? []) {
        assert.equal(url, 'http://www.w3.org/2000/svg', `${file} may not reference ${url}`);
      }
      assert.doesNotMatch(source.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, ''), /\/\/|@import|data:/, `${file} has no other external reference`);
      // Straight edges only — no curve command in any path.
      for (const [, d] of source.matchAll(/ d="([^"]+)"/g)) {
        assert.doesNotMatch(d, /[CcSsQqTtAa]/, `${file} must stay polygonal (curve commands would be a trace, not authored geometry)`);
        for (const subpath of d.split('Z').filter(Boolean)) {
          assert.match(subpath, /^M[\d .\-L]+$/, `${file}: every subpath is a closed polygon of line segments`);
        }
      }
      // Every colour is an existing token value.
      for (const [, fill] of source.matchAll(/fill="(#[0-9a-f]{6})"/g)) {
        assert.ok(tokensCss.includes(fill), `${file} uses ${fill}, which is not in public/tokens.css`);
      }
    }
  });

  it('publishes favicon.ico, apple-touch-icon and a site manifest with real icons', () => {
    const ico = bytes(join('public', 'favicon.ico'));
    assert.equal(ico.readUInt16LE(2), 1, 'ICO type must be 1 (icon)');
    const frames = ico.readUInt16LE(4);
    assert.equal(frames, 3, 'the .ico carries the 16/32/48 chrome sizes');
    let offset = 6;
    const sizes: number[] = [];
    for (let frame = 0; frame < frames; frame += 1) {
      const width = ico[offset] === 0 ? 256 : ico[offset];
      const length = ico.readUInt32LE(offset + 8);
      const dataAt = ico.readUInt32LE(offset + 12);
      sizes.push(width);
      const png = pngDimensions(ico.subarray(dataAt, dataAt + 24));
      assert.deepEqual(png, { width, height: width }, `frame ${frame} IHDR must agree with its directory entry`);
      assert.equal(ico.toString('latin1', dataAt + 12, dataAt + 16), 'IHDR', `frame ${frame} embeds a PNG`);
      assert.ok(length > 60, `frame ${frame} carries real pixel data (${length} bytes)`);
      offset += 16;
    }
    assert.deepEqual(sizes, [16, 32, 48], 'browser-chrome sizes are declared in order');

    const apple = pngDimensions(bytes(join('public', 'apple-touch-icon.png')));
    assert.deepEqual(apple, { width: 180, height: 180 }, 'apple-touch-icon must be 180×180');
    // iOS composites the tile onto black when it carries alpha, so it is opaque.
    const appleImage = decodePng(bytes(join('public', 'apple-touch-icon.png')));
    for (let i = 0; i < appleImage.width * appleImage.height; i += 1) {
      assert.equal(appleImage.data[i * 4 + 3], 255, 'apple-touch-icon must be fully opaque');
    }

    const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
      name: string;
      short_name: string;
      start_url: string;
      scope: string;
      display: string;
      background_color: string;
      theme_color: string;
      icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
    };
    assert.equal(manifest.name, 'AKBARAL!');
    assert.equal(manifest.short_name, 'AKBARAL!');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.display, 'standalone');
    for (const colour of [manifest.background_color, manifest.theme_color]) {
      assert.ok(tokensCss.includes(colour), `manifest colour ${colour} must stay a tokens.css value`);
    }
    assert.ok(manifest.icons.length >= 2, 'the manifest ships a standard and a maskable icon');
    for (const icon of manifest.icons) {
      assert.ok(existsSync(join(root, 'public', icon.src.replace(/^\//, ''))), `manifest icon ${icon.src} exists`);
      assert.deepEqual(pngDimensions(bytes(join('public', icon.src.replace(/^\//, '')))), {
        width: Number(icon.sizes.split('x')[0]),
        height: Number(icon.sizes.split('x')[1]),
      }, `manifest icon ${icon.src} matches its declared size`);
      assert.equal(icon.type, 'image/png');
      assert.ok(['any', 'maskable'].includes(icon.purpose), 'purpose is one browsers know');
    }
    // The maskable icon has to fit the 80% safe circle or Android crops the mark.
    const maskable = decodePng(bytes(join('public', 'brand', 'akbaral-icon-maskable-512.png')));
    const safeRadius = maskable.width * 0.4;
    const centre = maskable.width / 2;
    let outside = 0;
    for (let y = 0; y < maskable.height; y += 4) {
      for (let x = 0; x < maskable.width; x += 4) {
        const o = (y * maskable.width + x) * 4;
        if (maskable.data[o + 3] > 128 && maskable.data[o + 1] >= 120) {
          if (Math.hypot(x - centre, y - centre) > safeRadius) outside += 1;
        }
      }
    }
    assert.equal(outside, 0, 'no mark pixel may fall outside the maskable safe zone');
  });

  it('renders the icon, manifest and OG image out of the metadata', () => {
    assert.match(layout, /metadataBase: new URL\(siteBase\)/, 'relative asset URLs are only absolute if metadataBase exists');
    assert.match(layout, /const siteBase = process\.env\.AKBARAL_SITE_URL \?\? 'https:\/\/akbaral\.duckdns\.org'/, 'metadataBase follows the robots.ts/sitemap.ts convention');
    assert.equal((read('src/app/robots.ts').match(/AKBARAL_SITE_URL/g) ?? []).length >= 1, true);
    assert.match(layout, /manifest: BRAND_ASSETS\.manifest/);
    assert.match(layout, /apple: \[\{ url: BRAND_ASSETS\.appleTouchIcon, type: 'image\/png', sizes: '180x180' \}\]/);
    assert.match(layout, /shortcut:/, 'the legacy shortcut icon is still declared');
    for (const size of ['16x16', '32x32', '48x48']) {
      assert.ok(layout.includes(`sizes: '${size}'`), `metadata declares a ${size} icon`);
    }
    assert.match(layout, /openGraph:\s*\{[\s\S]*?images:\s*\[[\s\S]*?url: BRAND_ASSETS\.ogImage,[\s\S]*?width: 1200,[\s\S]*?height: 630,[\s\S]*?alt: 'AKBARAL![^']*'/, 'the OG card carries the logo image with alt text');
    assert.match(layout, /twitter:\s*\{\s*card: 'summary_large_image',\s*images:\s*\[\{ url: BRAND_ASSETS\.ogImage/, 'the Twitter card reuses the same image');
    // One theme-colour tag, not two: the hand-written one in <head> stays.
    assert.equal((layout.match(/name="theme-color"/g) ?? []).length, 1, 'theme-color is declared exactly once');
    assert.doesNotMatch(layout, /themeColor:/, 'metadata must not add a second theme colour');
  });

  it('places the logo on every brand surface, and marks each one correctly', () => {
    const surfaces: Array<[string, RegExp, string]> = [
      ['src/app/_components/app-shell.tsx', /<span className=\{styles\.mark\} aria-hidden="true"><BrandMark size=\{22\} \/><\/span>/g, 'workspace topbar + both card states'],
      ['src/app/_components/auth-card.tsx', /<span className=\{styles\.mark\} aria-hidden="true"><BrandMark size=\{30\} \/><\/span>/, 'sign-in / sign-up card'],
      ['src/app/_components/public-site-chrome.tsx', /<span className=\{styles\.mark\} aria-hidden="true"><BrandMark size=\{21\} \/><\/span>/, 'public header'],
      ['src/app/_components/public-site-chrome.tsx', /<BrandLogo className=\{styles\.footerMark\} decorative \/>/, 'public footer lockup'],
      ['src/app/_components/landing-reset.tsx', /<div className=\{styles\.orb\}><BrandMark size=\{26\} \/>/, 'hero orb sigil'],
    ];
    for (const [file, pattern, label] of surfaces) {
      const source = read(file);
      const hits = source.match(pattern) ?? [];
      assert.ok(hits.length >= 1, `${label} renders the logo (${file})`);
      if (label.includes('topbar')) assert.equal(hits.length, 3, 'the mark is wired at all three app-shell sites');
    }
    // No text placeholder survived anywhere the mark lives.
    for (const file of surfaces.map(([file]) => file)) {
      assert.doesNotMatch(read(file), /className=\{styles\.mark\}[^>]*>A!</, `${file} still renders the "A!" text placeholder`);
      assert.doesNotMatch(read(file), /styles\.orb\}><span>A!/, `${file} still renders the orb text placeholder`);
    }
    // Accessibility: a decorative mark is hidden, a meaningful one is named.
    assert.match(brandComponent, /aria-hidden=\{decorative \? true : undefined\}/);
    assert.match(brandComponent, /alt=\{decorative \? '' : label\}/);
    assert.match(brandComponent, /role=\{decorative \? undefined : 'img'\}/);
    // Every <img> in a brand surface has an explicit alt (never an inferred name
    // from the file name) and explicit width+height (so no layout shift).
    for (const file of ['src/app/_components/brand-mark.tsx', 'src/app/_components/public-site-chrome.tsx', 'src/app/_components/landing-reset.tsx', 'src/app/_components/auth-card.tsx', 'src/app/_components/app-shell.tsx']) {
      const source = read(file);
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/g, '');
      for (const tag of code.match(/<img[\s\S]*?\/>/g) ?? []) {
        assert.match(tag, /alt=\{/, `${file}: a brand <img> must set alt explicitly`);
        assert.match(tag, /width=\{/, `${file}: a brand <img> must reserve its box`);
        assert.match(tag, /height=\{/, `${file}: a brand <img> must reserve its box`);
      }
    }
    // The inline mark must inherit the surrounding colour instead of shipping a
    // new one — that is what keeps the palette at "no new colour".
    assert.match(brandComponent, /fill="currentColor"/);
    assert.doesNotMatch(brandComponent, /fill="#[0-9a-f]{3,6}"/i, 'no hard-coded fill in the component');
  });

  it('renders the mark and the lockup as real markup, not just source text', async () => {
    const React = (await import('react')).default;
    const { renderToString } = await import('react-dom/server');
    const { BrandMark, BrandLogo, BrandLogoInline } = await import('./_components/brand-mark');
    const markPath = /export const BRAND_MARK_PATH = '([^']+)'/.exec(dataModule)![1];

    const mark = renderToString(React.createElement(BrandMark, { size: 22 }));
    assert.ok(mark.includes(`d="${markPath}"`), 'the rendered path IS the generated geometry, verbatim');
    assert.match(mark, /aria-hidden="true"/, 'a decorative mark is hidden from assistive tech');
    assert.doesNotMatch(mark, /role="img"/, 'and not announced as an image');
    assert.match(mark, /fill="currentColor"/, 'colour comes from the surrounding token');
    assert.doesNotMatch(mark, /#[0-9a-f]{6}/i, 'the component may not hard-code a colour');
    assert.match(mark, /width="22" height="22"/, 'the box is reserved before paint, so nothing shifts');

    const named = renderToString(React.createElement(BrandMark, { size: 64, decorative: false }));
    assert.match(named, /role="img"/);
    assert.match(named, /aria-label="AKBARAL!"/);
    assert.match(named, /<title>AKBARAL!<\/title>/);

    const logo = renderToString(React.createElement(BrandLogo, { height: 28 }));
    assert.match(logo, /src="\/brand\/akbaral-logo\.svg"/, 'the footer lockup is the repo-served asset');
    assert.match(logo, /alt=""/, 'decorative where the brand name is already text');
    assert.match(logo, /width="191" height="28"/, 'the img carries the lockup aspect ratio (436:64) so it cannot reflow the footer');

    const namedLogo = renderToString(React.createElement(BrandLogo, { height: 32, decorative: false }));
    assert.match(namedLogo, /alt="AKBARAL!"/);
    assert.match(namedLogo, /width="218" height="32"/);

    const inline = renderToString(React.createElement(BrandLogoInline, { height: 24 }));
    assert.match(inline, /aria-hidden="true"/);
    assert.match(inline, /viewBox="0 0 436 64"/);
  });

  it('keeps the private mission surface deliberately unbranded and unpinned-by-me', () => {
    // mission-dashboard/index.html's asset list is deep-equalled by the gateway
    // proxy tests and by the nav contract; adding a <link> there would break
    // the HTML rebase. The dashboard's header mark also shows a state label by
    // design, so the public logo is deliberately NOT installed there.
    const dashboard = read('mission-dashboard/index.html');
    assert.doesNotMatch(dashboard, /\/brand\/|akbaral-logo|akbaral-icon/, 'the mission dashboard gains no brand reference');
    assert.deepEqual(
      [...dashboard.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]).sort(),
      ['/app.js', '/manifest.webmanifest', '/styles.css'],
      'the relayed asset list is untouched',
    );
  });

  it('fails if an asset disappears (sensitivity of the wiring above)', () => {
    // The reference list is derived from the sources, so deleting one file must
    // be caught by the same assertions rather than a hand-maintained list.
    // Proved here without mutating the tree: run the same derivation against a
    // path set with one entry removed and require the predicate to reject it.
    const referenced = [...publishedPaths, '/brand/does-not-exist.svg'];
    const missing = referenced.filter((file) => !existsSync(join(root, 'public', file.replace(/^\//, ''))));
    assert.deepEqual(missing, ['/brand/does-not-exist.svg'], 'a missing asset is detected by exactly this predicate');
    assert.ok(publishedPaths.every((file) => existsSync(join(root, 'public', file.replace(/^\//, '')))), 'and the real tree passes it');
  });
});
