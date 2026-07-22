/**
 * Generates PNG icons for the extension at 16, 48, and 128px.
 * Uses only Node.js built-in modules — no external dependencies.
 *
 * Design: dark ledger-brown background (#0d0b08) with a gold diamond frame and a
 * bold "V" crest — the extension's signature mark, doubling as both a monogram and
 * the Roman numeral for "Fifth".
 * Run with: node scripts/generate-icons.mjs
 */

import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'icons');

mkdirSync(OUT_DIR, { recursive: true });

// ── CRC32 ──────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

// ── PNG chunk builder ──────────────────────────────────────────────────────

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

// ── PNG encoder (RGBA, no interlace) ──────────────────────────────────────

function encodePNG(width, height, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;

  const rawSize = height * (1 + width * 4);
  const raw = Buffer.alloc(rawSize);
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = y * (1 + width * 4) + 1 + x * 4;
      raw[dst] = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
      raw[dst + 3] = pixels[src + 3];
    }
  }

  const compressed = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdrData),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Icon drawing ───────────────────────────────────────────────────────────

function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  const BG    = [13, 11, 8, 255];     // #0d0b08
  const GOLD  = [201, 168, 76, 255];  // #c9a84c — frame
  const AMBER = [251, 191, 36, 255];  // #fbbf24 — crest fill

  function setPixel(x, y, [r, g, b, a]) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
  }

  function fillRect(x, y, w, h, color) {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        setPixel(Math.round(x + dx), Math.round(y + dy), color);
  }

  // Fill background
  fillRect(0, 0, size, size, BG);

  // Soften corners (poor-man's rounded rect)
  const corner = Math.max(2, Math.round(size * 0.16));
  for (let y = 0; y < corner; y++) {
    for (let x = 0; x < corner - y; x++) {
      setPixel(x, y, BG);
      setPixel(size - 1 - x, y, BG);
      setPixel(x, size - 1 - y, BG);
      setPixel(size - 1 - x, size - 1 - y, BG);
    }
  }

  const cx = size / 2;

  // Gold diamond frame (rotated square outline)
  const half = size * 0.42;
  const frameWidth = Math.max(1, size * 0.035);
  for (let dy = -half; dy <= half; dy++) {
    const span = half - Math.abs(dy);
    // left edge of diamond at this row, right edge mirrored
    const leftX = cx - span;
    const rightX = cx + span;
    fillRect(leftX, cx + dy, frameWidth, 1, GOLD);
    fillRect(rightX - frameWidth, cx + dy, frameWidth, 1, GOLD);
  }

  // "V" crest — two thick diagonal strokes converging at bottom-center
  const vTop = size * 0.30;
  const vBottom = size * 0.68;
  const vLeftX = size * 0.32;
  const vRightX = size * 0.68;
  const vCenterX = size * 0.5;
  const stroke = Math.max(2, size * 0.11);

  for (let y = vTop; y <= vBottom; y++) {
    const t = (y - vTop) / (vBottom - vTop);
    const leftStrokeCenter = vLeftX + (vCenterX - vLeftX) * t;
    const rightStrokeCenter = vRightX + (vCenterX - vRightX) * t;
    fillRect(leftStrokeCenter - stroke / 2, y, stroke, 1.2, AMBER);
    fillRect(rightStrokeCenter - stroke / 2, y, stroke, 1.2, AMBER);
  }

  return pixels;
}

// ── Generate all sizes ─────────────────────────────────────────────────────

for (const size of [16, 48, 128]) {
  const pixels = drawIcon(size);
  const png = encodePNG(size, size, pixels);
  const outPath = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(outPath, png);
  console.log(`✓ ${outPath} (${size}×${size})`);
}

console.log('\nIcons generated successfully.');
