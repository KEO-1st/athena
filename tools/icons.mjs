#!/usr/bin/env node
/** Draws ATHENA's app icons with no image libraries: raw RGBA + zlib PNG. */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function png(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const put = (x, y, rgb, alpha = 1) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const a = Math.min(1, Math.max(0, alpha));
    pixels[i] = Math.round(pixels[i] * (1 - a) + rgb[0] * a);
    pixels[i + 1] = Math.round(pixels[i + 1] * (1 - a) + rgb[1] * a);
    pixels[i + 2] = Math.round(pixels[i + 2] * (1 - a) + rgb[2] * a);
    pixels[i + 3] = Math.round(pixels[i + 3] * (1 - a) + 255 * a);
  };

  const radius = size * 0.46;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      // base rounded-square ink with a soft magenta atmosphere
      const inSquare = Math.max(Math.abs(dx), Math.abs(dy)) < size * 0.47;
      if (!inSquare) continue;
      const glow = Math.max(0, 1 - dist / (size * 0.34));
      put(x, y, [8, 8, 12], 1);
      put(x, y, [255, 45, 126], 0.22 * glow * glow);
      put(x, y, [53, 224, 224], 0.05 * glow);

      // outer ring
      const ring = Math.abs(dist - radius) < size * 0.008;
      if (ring) put(x, y, [255, 255, 255], 0.24);
      // orbital arc (only lower-right quadrant sweep)
      const angle = Math.atan2(dy, dx);
      const arc = Math.abs(dist - radius) < size * 0.016 && angle > -0.4 && angle < 2.2;
      if (arc) {
        const strength = Math.min(1, (angle + 0.4) / 2.6);
        put(x, y, [255, 45, 126], 0.92 * strength);
        put(x, y, [255, 190, 220], 0.25 * strength);
      }
      // inner circle
      if (Math.abs(dist - size * 0.2) < size * 0.006) put(x, y, [255, 45, 126], 0.5);
      // core dot
      if (dist < size * 0.055) put(x, y, [255, 90, 150], 0.95);
      if (dist < size * 0.09) put(x, y, [255, 45, 126], 0.3);
    }
  }

  // diagonal ticks (a nod to the HUD corners)
  for (let i = 0; i < Math.round(size * 0.14); i += 1) {
    const thickness = Math.max(1, Math.round(size * 0.008));
    for (let t = 0; t < thickness; t += 1) {
      put(Math.round(size * 0.16) + i, Math.round(size * 0.84) - i + t, [53, 224, 224], 0.5);
      put(Math.round(size * 0.84) - i, Math.round(size * 0.16) + i + t, [53, 224, 224], 0.18);
    }
  }
  return png(size, size, pixels);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [180, 192, 512]) {
  const file = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log("wrote", file);
}
