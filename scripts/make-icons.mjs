/**
 * Generates the four static PNG icons from scratch — no image dependencies,
 * no third-party binaries. Output is deterministic and checked into dist/.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "public/icons");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function makePng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  const bg = [11, 15, 20, 255]; // #0B0F14
  const accent = [34, 211, 238, 255]; // #22D3EE
  const dark = [8, 11, 16, 255];

  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      const dx = nx - 0.5;
      const dy = ny - 0.5;
      let color = bg;
      if (dx * dx + dy * dy < 0.28 * 0.28) {
        color = accent;
        // Visor slit — reads as a masked/cloaked agent even at 16 px.
        if (Math.abs(dy) < 0.055 && Math.abs(dx) < 0.24) color = dark;
      }
      // 1px frame
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) color = [29, 42, 58, 255];
      raw[offset++] = color[0];
      raw[offset++] = color[1];
      raw[offset++] = color[2];
      raw[offset++] = color[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = join(outDir, `icon${size}.png`);
  writeFileSync(file, makePng(size));
  console.log(`generated ${file}`);
}
