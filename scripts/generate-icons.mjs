#!/usr/bin/env node
// Yomibako logo — single vector source for every app icon.
//
// 読み箱 "reading box": an open book held inside the dark box of the icon,
// with a red bookmark ribbon running down the spine.
//
// No image dependencies: shapes are flattened to polygons, scan-converted with
// analytic horizontal coverage + 4x vertical supersampling, and written as PNG
// through node:zlib. Run `node scripts/generate-icons.mjs` after editing.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

// ——————————————————————————————————————— PNG

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels, alpha) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = alpha ? 6 : 2; // RGBA / RGB — iOS rejects app icons with alpha
  const stride = size * (alpha ? 4 : 3);
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ——————————————————————————————————————— paint

function hex(value) {
  const n = parseInt(value.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const solid = (color, alpha = 1) => {
  const [r, g, b] = hex(color);
  return () => [r, g, b, alpha];
};

function mix(stops, t) {
  const clamped = Math.max(0, Math.min(1, t));
  let i = 1;
  while (i < stops.length - 1 && clamped > stops[i][0]) i++;
  const [p0, c0, a0 = 1] = stops[i - 1];
  const [p1, c1, a1 = 1] = stops[i];
  const k = p1 === p0 ? 0 : (clamped - p0) / (p1 - p0);
  const from = hex(c0);
  const to = hex(c1);
  return [
    from[0] + (to[0] - from[0]) * k,
    from[1] + (to[1] - from[1]) * k,
    from[2] + (to[2] - from[2]) * k,
    a0 + (a1 - a0) * k,
  ];
}

const linear = (x0, y0, x1, y1, stops) => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = dx * dx + dy * dy;
  return (x, y) => mix(stops, ((x - x0) * dx + (y - y0) * dy) / len);
};

const radial = (cx, cy, r, stops) => (x, y) => mix(stops, Math.hypot(x - cx, y - cy) / r);

// ——————————————————————————————————————— geometry

function path() {
  const contours = [];
  let current = null;
  let px = 0;
  let py = 0;
  const api = {
    M(x, y) { current = [[x, y]]; contours.push(current); px = x; py = y; return api; },
    L(x, y) { current.push([x, y]); px = x; py = y; return api; },
    C(x1, y1, x2, y2, x, y) {
      const steps = 28;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const m = 1 - t;
        const a = m * m * m;
        const b = 3 * m * m * t;
        const c = 3 * m * t * t;
        const d = t * t * t;
        current.push([a * px + b * x1 + c * x2 + d * x, a * py + b * y1 + c * y2 + d * y]);
      }
      px = x;
      py = y;
      return api;
    },
    done() { return contours; },
  };
  return api;
}

const mirror = (contours) => contours.map((c) => c.map(([x, y]) => [1024 - x, y]));
const shift = (contours, dx, dy) => contours.map((c) => c.map(([x, y]) => [x + dx, y + dy]));

// ——————————————————————————————————————— canvas

class Canvas {
  constructor(size) {
    this.size = size;
    this.px = new Float32Array(size * size * 4); // premultiplied
  }

  blend(index, r, g, b, a) {
    if (a <= 0) return;
    const o = index * 4;
    const inv = 1 - a;
    const px = this.px;
    px[o] = r * a + px[o] * inv;
    px[o + 1] = g * a + px[o + 1] * inv;
    px[o + 2] = b * a + px[o + 2] * inv;
    px[o + 3] = a + px[o + 3] * inv;
  }

  fillAll(paint) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const [r, g, b, a] = paint(x + 0.5, y + 0.5);
        this.blend(y * this.size + x, r, g, b, a);
      }
    }
  }

  // Scanline fill, nonzero winding. Exact horizontal coverage, 4 sub-rows.
  fill(contours, paint, transform) {
    const size = this.size;
    const edges = [];
    let top = Infinity;
    let bottom = -Infinity;
    for (const contour of contours) {
      const pts = contour.map(transform);
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % pts.length];
        if (y0 === y1) continue;
        edges.push([x0, y0, x1, y1]);
        top = Math.min(top, y0, y1);
        bottom = Math.max(bottom, y0, y1);
      }
    }
    if (!edges.length) return;

    const first = Math.max(0, Math.floor(top));
    const last = Math.min(size - 1, Math.ceil(bottom));
    const coverage = new Float32Array(size);
    const SUB = 4;
    const weight = 1 / SUB;
    const hits = [];

    for (let y = first; y <= last; y++) {
      coverage.fill(0);
      for (let s = 0; s < SUB; s++) {
        const sy = y + (s + 0.5) / SUB;
        hits.length = 0;
        for (const [x0, y0, x1, y1] of edges) {
          if ((sy >= y0 && sy < y1) || (sy >= y1 && sy < y0)) {
            hits.push([x0 + ((sy - y0) * (x1 - x0)) / (y1 - y0), y1 > y0 ? 1 : -1]);
          }
        }
        if (hits.length < 2) continue;
        hits.sort((a, b) => a[0] - b[0]);
        let winding = 0;
        for (let i = 0; i < hits.length - 1; i++) {
          winding += hits[i][1];
          if (winding !== 0) this.#span(coverage, hits[i][0], hits[i + 1][0], weight);
        }
      }
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const c = coverage[x];
        if (c < 0.0015) continue;
        const [r, g, b, a] = paint(x + 0.5, y + 0.5);
        this.blend(row + x, r, g, b, Math.min(1, c) * a);
      }
    }
  }

  #span(coverage, xa, xb, weight) {
    const lo = Math.max(0, xa);
    const hi = Math.min(this.size, xb);
    if (hi <= lo) return;
    const i0 = Math.floor(lo);
    const i1 = Math.ceil(hi) - 1;
    if (i0 === i1) {
      coverage[i0] += (hi - lo) * weight;
      return;
    }
    coverage[i0] += (i0 + 1 - lo) * weight;
    for (let i = i0 + 1; i < i1; i++) coverage[i] += weight;
    coverage[i1] += (hi - i1) * weight;
  }

  toPng(alpha = true) {
    const channels = alpha ? 4 : 3;
    const out = new Uint8Array(this.size * this.size * channels);
    for (let i = 0; i < this.size * this.size; i++) {
      const a = this.px[i * 4 + 3];
      if (a <= 0.0001) continue;
      const inv = 1 / a;
      for (let c = 0; c < 3; c++) {
        out[i * channels + c] = Math.max(0, Math.min(255, Math.round(this.px[i * 4 + c] * inv * 255)));
      }
      if (alpha) out[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
    }
    return encodePng(this.size, out, alpha);
  }
}

// ——————————————————————————————————————— the mark (1024 x 1024 design space)

const INK = '#0B0B12';
const PAPER = '#FFFFFF';
const PAPER_SHADE = '#DCE4FA';
const STACK = '#8E9AC9';
const RIBBON = '#FF4438';

// Open book: outer corners ride high, the spine dips — the classic reading pose.
const leftPage = path()
  .M(172, 268)
  .C(292, 240, 420, 274, 496, 332)
  .L(496, 700)
  .C(420, 642, 292, 610, 172, 636)
  .C(163, 520, 163, 384, 172, 268)
  .done();

const rightPage = mirror(leftPage);

// The same silhouette nudged down: reads as the stack of pages underneath.
const leftStack = shift(leftPage, 0, 30);
const rightStack = mirror(leftStack);

// Bookmark tucked in the spine, emerging below the book.
const ribbon = path()
  .M(488, 600)
  .L(536, 600)
  .L(536, 772)
  .L(512, 734)
  .L(488, 772)
  .done();

function drawMark(canvas, { scale, mono = null }) {
  const size = canvas.size;
  // Mark space is 1024 wide; content sits between y 268 and y 772.
  const k = (size / 1024) * scale;
  const cy = mono ? 484 : 500; // optical centre with / without the ribbon
  const tf = ([x, y]) => [size / 2 + (x - 512) * k, size / 2 + (y - cy) * k];

  if (mono) {
    const white = solid(mono);
    canvas.fill(leftPage, white, tf);
    canvas.fill(rightPage, white, tf);
    return;
  }

  canvas.fill(leftStack, solid(STACK), tf);
  canvas.fill(rightStack, solid(STACK), tf);
  canvas.fill(ribbon, solid(RIBBON), tf);
  canvas.fill(leftPage, solid(PAPER), tf);
  canvas.fill(rightPage, solid(PAPER_SHADE), tf);
}

function drawBackground(canvas) {
  const size = canvas.size;
  canvas.fillAll(linear(0, 0, size, size, [
    [0, '#2E3270'],
    [0.55, '#15162E'],
    [1, INK],
  ]));
  canvas.fillAll(radial(size * 0.36, size * 0.24, size * 0.92, [
    [0, '#6484FF', 0.38],
    [0.6, '#6484FF', 0.07],
    [1, '#6484FF', 0],
  ]));
}

const TARGETS = [
  { file: 'icon.png', size: 1024, background: true, scale: 0.92 },
  { file: 'android-icon-background.png', size: 512, background: true, scale: 0 },
  { file: 'android-icon-foreground.png', size: 512, background: false, scale: 0.77 },
  { file: 'android-icon-monochrome.png', size: 432, background: false, scale: 0.77, mono: '#FFFFFF' },
  { file: 'splash-icon.png', size: 1024, background: false, scale: 0.72 },
  { file: 'favicon.png', size: 48, background: true, scale: 0.9 },
];

mkdirSync(ASSETS, { recursive: true });
for (const target of TARGETS) {
  const canvas = new Canvas(target.size);
  if (target.background) drawBackground(canvas);
  if (target.scale > 0) drawMark(canvas, { scale: target.scale, mono: target.mono });
  // A full-bleed background is opaque everywhere, so drop the alpha channel.
  writeFileSync(join(ASSETS, target.file), canvas.toPng(!target.background));
  console.log(`${target.file.padEnd(32)} ${target.size}x${target.size}`);
}
