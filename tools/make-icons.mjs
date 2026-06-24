// make-icons.mjs — genera el icono del gato pixel-art (placeholder) en SVG y PNG
// sin dependencias: encodea PNG a mano con zlib. Reproducible: `node tools/make-icons.mjs`.
// Sustituye public/icons/* cuando tengas tu propio gato pixel-art.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

// 16×16. ' ' fondo · G dorado · i oreja interior · d ojo (=fondo) · p naricita
const GRID = [
  "  G          G  ",
  " GGG        GGG ",
  " GiG        GiG ",
  " GGGGGGGGGGGGGG ",
  "GGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGG",
  "GGddGGGGGGGGddGG",
  "GGddGGGGGGGGddGG",
  "GGGGGGGppGGGGGGG",
  "GGGGGGGppGGGGGGG",
  "GGGGGGGGGGGGGGGG",
  " GGGGGGGGGGGGGG ",
  " GGGGGGGGGGGGGG ",
  "  GGGGGGGGGGGG  ",
  "   GGGGGGGGGG   ",
  "    GGGGGGGG    ",
];
const N = 16;
const PAL = {
  " ": [13, 12, 10],
  d: [13, 12, 10],
  G: [232, 176, 74],
  i: [181, 136, 54],
  p: [232, 122, 122],
};
const hex = (c) => "#" + c.map((n) => n.toString(16).padStart(2, "0")).join("");

// ── SVG ─────────────────────────────────────────────────────────────────────
function svg(px = 512) {
  const cell = px / N;
  let r = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}" shape-rendering="crispEdges">`;
  r += `<rect width="${px}" height="${px}" fill="${hex(PAL[" "])}"/>`;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const ch = GRID[y][x];
      if (ch === " " || ch === "d") continue; // fondo / ojos = fondo
      r += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="${hex(PAL[ch])}"/>`;
    }
  return r + "</svg>\n";
}

// ── PNG (RGBA, sin dependencias) ─────────────────────────────────────────────
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const t = Buffer.from(type, "latin1");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function png(size) {
  // raster nearest-neighbor del grid a `size`×`size`
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro 0 por scanline
    for (let x = 0; x < size; x++) {
      const ch = GRID[Math.floor((y * N) / size)][Math.floor((x * N) / size)];
      const [r, g, b] = PAL[ch] || PAL[" "];
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── escribe ──────────────────────────────────────────────────────────────────
const dir = new URL("../public/icons/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("icon.svg", dir), svg(512));
writeFileSync(new URL("icon-192.png", dir), png(192));
writeFileSync(new URL("icon-512.png", dir), png(512));
writeFileSync(new URL("apple-touch-icon.png", dir), png(180));
console.log("iconos generados en public/icons/ 🐱");
