/**
 * Brand renderer: turns the mark's polygons into real rasters, and encodes the
 * PNG / ICO containers, with nothing outside node's stdlib.
 *
 * Only straight edges exist in this geometry, so a scanline walk is exact: per
 * subpixel row, collect edge crossings, accumulate winding, and count how many
 * subpixel columns of each pixel land inside. Coverage becomes alpha, which is
 * what both an antialiased 16px favicon and a legibility assertion need.
 */

import zlib from 'node:zlib';

/* ── coverage rasteriser ─────────────────────────────────────────────────── */

function crossingsFor(shapes, y, out) {
  out.length = 0;
  for (const shape of shapes) {
    const pts = shape.points;
    for (let i = 0; i < pts.length; i += 1) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      if (y1 === y2) continue;
      const [low, high, dir] = y1 < y2 ? [y1, y2, 1] : [y2, y1, -1];
      if (y >= low && y < high) out.push({ x: x1 + ((y - y1) / (y2 - y1)) * (x2 - x1), dir });
    }
  }
  out.sort((a, b) => a.x - b.x);
  return out;
}

/**
 * Fills polygon layers, bottom-first, into an RGBA buffer.
 *
 * @param {object} options
 * @param {number} [options.size]     square edge in pixels (shorthand)
 * @param {number} [options.width]    non-square canvas width
 * @param {number} [options.height]   non-square canvas height
 * @param {number} [options.viewBox]  grid units mapped across the canvas width
 * @param {Array}  options.layers     [{ shapes, color: [r,g,b] }] bottom-first
 * @param {number} [options.samples]  supersample factors per axis (antialiasing)
 */
export function renderLayers(options) {
  const { viewBox = 64, layers, samples = 4 } = options;
  const width = options.width ?? options.size;
  const height = options.height ?? options.size;
  const data = new Uint8ClampedArray(width * height * 4);
  const scale = width / viewBox;
  const hits = [];
  const coverage = new Float64Array(width);
  for (const layer of layers) {
    const [r, g, b] = layer.color;
    const shapes = layer.shapes.map((shape) => ({
      points: shape.points.map(([x, y]) => [x * scale, y * scale]),
    }));
    for (let row = 0; row < height; row += 1) {
      coverage.fill(0);
      for (let sy = 0; sy < samples; sy += 1) {
        const list = crossingsFor(shapes, row + (sy + 0.5) / samples, hits);
        // Columns are visited in increasing x, so the winding number is walked
        // forward once per subpixel row instead of restarted per pixel.
        let winding = 0;
        let edge = 0;
        for (let col = 0; col < width; col += 1) {
          let count = 0;
          for (let sx = 0; sx < samples; sx += 1) {
            const x = col + (sx + 0.5) / samples;
            while (edge < list.length && list[edge].x <= x) {
              winding += list[edge].dir;
              edge += 1;
            }
            if (winding !== 0) count += 1;
          }
          coverage[col] += count;
        }
      }
      for (let col = 0; col < width; col += 1) {
        const alpha = coverage[col] / (samples * samples);
        if (alpha <= 0) continue;
        const i = (row * width + col) * 4;
        const prevA = data[i + 3] / 255;
        const nextA = alpha + prevA * (1 - alpha);
        data[i] = (r * alpha + data[i] * prevA * (1 - alpha)) / nextA;
        data[i + 1] = (g * alpha + data[i + 1] * prevA * (1 - alpha)) / nextA;
        data[i + 2] = (b * alpha + data[i + 2] * prevA * (1 - alpha)) / nextA;
        data[i + 3] = Math.min(255, nextA * 255);
      }
    }
  }
  return { size: width === height ? width : undefined, width, height, data };
}

/* ── PNG ─────────────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const data = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(data));
  return Buffer.concat([len, data, crc]);
}

/** RGBA8, non-interlaced, filter 0 per scanline, one zlib IDAT. */
export function encodePng({ width, height = width, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + row * stride, stride).copy(raw, row * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── ICO (PNG-compressed frames) ─────────────────────────────────────────── */

/** Multi-size .ico; a 256 edge is written as 0, per the format. */
export function encodeIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);
  const offset = 6 + frames.length * 16;
  const entries = [];
  const images = [];
  for (const frame of frames) {
    const png = Buffer.from(frame.png);
    const entry = Buffer.alloc(16);
    entry[0] = frame.size % 256;
    entry[1] = frame.size % 256;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset + images.reduce((sum, image) => sum + image.length, 0), 12);
    entries.push(entry);
    images.push(png);
  }
  return Buffer.concat([header, ...entries, ...images]);
}

/* ── dev aid: look at a raster in the terminal ───────────────────────────── */

/** ASCII preview of an RGBA raster, used while tuning legibility at 16px. */
export function asciiPreview({ width, height = width, data }, { columns = width, threshold = 96 } = {}) {
  const rows = Math.max(1, Math.round((columns * height) / width / 2));
  const stepX = width / columns;
  const stepY = height / rows;
  const lines = [];
  for (let row = 0; row < rows; row += 1) {
    let line = '';
    for (let col = 0; col < columns * 2; col += 1) {
      const y = Math.min(height - 1, Math.floor(row * stepY));
      const x = Math.min(width - 1, Math.floor((col / 2) * stepX));
      const alpha = data[(y * width + x) * 4 + 3];
      line += alpha > threshold * 2 ? '#' : alpha > threshold ? '+' : '.';
    }
    lines.push(line);
  }
  return lines.join('\n');
}
