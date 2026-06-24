// cat.js — motor de gato pixel-art (32×32 → SVG). Portado del generador de
// miaumiau ("poporings que maúllan": cuerpo redondito + orejas de gato siempre),
// pero con los rasgos EDITABLES (no aleatorios por seed) para que cada quien
// diseñe el suyo. Sin dependencias; devuelve un string SVG listo para inyectar.
//
// Tu gato es tu identidad: se ve en el dock, el menú y (fase C) en el patio.

const W = 32, H = 32;

// ── opciones editables (id → etiqueta para los chips del editor) ────────────
export const CAT_OPTIONS = {
  eyes: [["classic", "clásicos"], ["round", "redondos"], ["dot", "puntito"], ["sleepy", "dormilón"], ["star", "estrella"], ["heart", "corazón"], ["sparkle", "brillo"]],
  mouth: [["cat", ":3"], ["smile", "sonrisa"], ["smirk", "pícara"], ["o", "o"], ["open", "abierta"], ["tongue", "lengua"]],
  cheeks: [["none", "nada"], ["blush", "sonrojo"], ["freckles", "pecas"]],
  headTop: [["none", "nada"], ["leaf", "hoja"], ["droplet", "gota"], ["spike", "pincho"], ["antenna", "antena"]],
  headwear: [["none", "nada"], ["bow", "lazo"], ["crown", "corona"], ["flower", "flor"], ["halo", "halo"], ["santa", "gorro"]],
};

export const DEFAULT_CAT = { color: "#e8b04a", eyes: "classic", mouth: "cat", cheeks: "blush", headTop: "none", headwear: "none" };

export const CAT_SWATCHES = ["#e8b04a", "#a6c081", "#f0a0b0", "#80c0f0", "#c8a2ff", "#6fd3a0", "#f2c94c", "#ff8a3c", "#e06888", "#d8d2c4", "#a0a0b8", "#505060"];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
export function randomCatTraits() {
  return {
    color: pick(CAT_SWATCHES),
    eyes: pick(CAT_OPTIONS.eyes)[0],
    mouth: pick(CAT_OPTIONS.mouth)[0],
    cheeks: pick(CAT_OPTIONS.cheeks)[0],
    headTop: pick(CAT_OPTIONS.headTop)[0],
    headwear: pick(CAT_OPTIONS.headwear)[0],
  };
}

// compacto para viajar por el WebSocket (fase C): "color|eyes|mouth|cheeks|headTop|headwear"
export function encodeCat(c) {
  return [c.color, c.eyes, c.mouth, c.cheeks, c.headTop, c.headwear].join("|");
}
export function decodeCat(s) {
  if (typeof s !== "string") return null;
  const [color, eyes, mouth, cheeks, headTop, headwear] = s.split("|");
  if (!color) return null;
  return { ...DEFAULT_CAT, color, eyes, mouth, cheeks, headTop, headwear };
}

// ── color helpers ───────────────────────────────────────────────────────────
const h2r = (h) => { const c = h.replace("#", ""); return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]; };
const r2h = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const lt = (h, a) => { const [r, g, b] = h2r(h); return r2h(r + (255 - r) * a, g + (255 - g) * a, b + (255 - b) * a); };
const dk = (h, a) => { const [r, g, b] = h2r(h); return r2h(r * (1 - a), g * (1 - a), b * (1 - a)); };
const mkOL = (h) => { const [r, g, b] = h2r(h); return r2h(r * 0.95 + 10, g * 0.75 + 10, b * 0.8 + 15); };

function pal(c) {
  return {
    outline: mkOL(c), s1: dk(c, .32), s2: dk(c, .16), s3: c, s4: lt(c, .26), s5: lt(c, .5), shine: lt(c, .78),
    eye: "#1a1a22", eyeW: "#fff", heart: "#d84050", mouth: "#1a1a22", mouthIn: "#6a2838", tongue: "#d07088",
    cheek: "#e89098", freckle: dk(c, .35),
    leaf: "#7ac06a", leafD: "#3d7a3a", droplet: lt(c, .5), dropletW: "#fff", spike: dk(c, .45), spikeW: lt(c, .2),
    antenna: "#808080", antennaT: "#f0e060", earA: dk(c, .25), earB: dk(c, .45), shadow: "rgba(0,0,0,.2)",
    bow: "#e05080", bowD: "#a03060", crown: "#f0c830", crownD: "#b08810", gem: "#4080d0",
    petal: "#ffe860", petalC: "#e08030", halo: "#f0e060", haloD: "#c0b030",
    santa: "#d03030", santaD: "#a02020", santaW: "#fff",
  };
}

const px = (g, x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) g[y][x] = c; };

const EYE = {
  classic: [[0, 0, "eye"], [1, 0, "eyeW"], [0, 1, "eye"], [1, 1, "eye"]],
  round: [[0, 0, "eye"], [1, 0, "eye"], [0, 1, "eye"], [1, 1, "eyeW"]],
  dot: [[0, 0, "eye"]],
  sleepy: [[0, 0, "eye"], [1, 0, "eye"], [2, 0, "eye"]],
  star: [[1, 0, "eye"], [0, 1, "eye"], [1, 1, "eye"], [2, 1, "eye"], [1, 2, "eye"]],
  heart: [[0, 0, "heart"], [2, 0, "heart"], [0, 1, "heart"], [1, 1, "heart"], [2, 1, "heart"], [1, 2, "heart"]],
  sparkle: [[0, 0, "eyeW"], [1, 0, "eye"], [0, 1, "eye"], [1, 1, "eyeW"]],
};
const MO = {
  smile: [[-1, 0, "mouth"], [0, 1, "mouth"], [1, 1, "mouth"], [2, 0, "mouth"]],
  open: [[0, 0, "mouth"], [1, 0, "mouth"], [0, 1, "mouthIn"], [1, 1, "tongue"], [0, 2, "mouth"], [1, 2, "mouth"]],
  smirk: [[-1, 1, "mouth"], [0, 0, "mouth"], [1, 0, "mouth"], [2, -1, "mouth"]],
  o: [[0, 0, "mouth"], [1, 0, "mouth"], [0, 1, "mouth"], [1, 1, "mouth"]],
  cat: [[-1, 0, "mouth"], [0, 1, "mouth"], [1, 0, "mouth"], [2, 1, "mouth"], [3, 0, "mouth"]],
  tongue: [[-1, 0, "mouth"], [0, 1, "mouth"], [1, 1, "mouth"], [2, 0, "mouth"], [0, 2, "tongue"], [1, 2, "tongue"]],
};

function buildGrid(t) {
  const cx = 16, cy = 22, rx = 8, ry = 7, nT = 2, nB = 2.8;
  const raw = Array.from({ length: H }, () => Array(W).fill(0));
  const clip = Math.min(cy + ry, H - 4);
  for (let y = 0; y < H; y++) {
    if (y > clip) continue;
    for (let x = 0; x < W; x++) {
      const dx = Math.abs((x + 0.5 - cx) / rx), dy = (y + 0.5 - cy) / ry, n = dy < 0 ? nT : nB;
      if (Math.pow(dx, n) + Math.pow(Math.abs(dy), n) < 1) raw[y][x] = 1;
    }
  }
  let bL = W, bR = 0, bT = H, bB = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (raw[y][x]) { if (x < bL) bL = x; if (x > bR) bR = x; if (y < bT) bT = y; if (y > bB) bB = y; }
  const bW = Math.max(1, bR - bL), bH = Math.max(1, bB - bT);
  const g = raw.map((r) => r.map((v) => (v ? "s3" : null)));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!raw[y][x]) continue;
    const br = 1 - ((x - bL) / bW * 0.55 + (y - bT) / bH * 0.45);
    g[y][x] = br > 0.78 ? "s5" : br > 0.58 ? "s4" : br > 0.38 ? "s3" : br > 0.2 ? "s2" : "s1";
  }
  const hlx = cx - rx * 0.3, hly = cy - ry * 0.35, hlr = Math.max(2, rx * 0.2), hlry = Math.max(2, ry * 0.18);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!g[y][x]) continue;
    const d2 = (x + 0.5 - hlx) / hlr, d3 = (y + 0.5 - hly) / hlry;
    if (d2 * d2 + d3 * d3 < 1) g[y][x] = "shine";
  }
  const eyeY = Math.round(cy - ry * 0.18), gap = Math.max(2, Math.round(rx * 0.28));
  const eL = { x: cx - gap - 1, y: eyeY }, eR = { x: cx + gap, y: eyeY }, mo = { x: cx, y: Math.round(cy + ry * 0.15) }, tt = bT;

  // mejillas
  const csp = Math.round(rx * 0.5), ccy = eyeY + 3;
  if (t.cheeks === "blush") { px(g, cx - csp, ccy, "cheek"); px(g, cx - csp + 1, ccy, "cheek"); px(g, cx + csp - 1, ccy, "cheek"); px(g, cx + csp, ccy, "cheek"); }
  else if (t.cheeks === "freckles") { px(g, cx - csp, ccy, "freckle"); px(g, cx - csp + 1, ccy + 1, "freckle"); px(g, cx + csp, ccy, "freckle"); px(g, cx + csp - 1, ccy + 1, "freckle"); }

  // ojos / boca
  const es = EYE[t.eyes] || EYE.classic;
  for (const [dx, dy, c] of es) { px(g, eL.x + dx, eL.y + dy, c); px(g, eR.x + dx, eR.y + dy, c); }
  const ms = MO[t.mouth] || MO.cat;
  for (const [dx, dy, c] of ms) px(g, mo.x + dx, mo.y + dy, c);

  // adorno de cabeza
  if (t.headTop === "leaf") { px(g, cx + 1, tt - 4, "leafD"); px(g, cx, tt - 3, "leaf"); px(g, cx + 1, tt - 3, "leafD"); px(g, cx - 1, tt - 2, "leaf"); px(g, cx, tt - 2, "leaf"); px(g, cx, tt - 1, "leafD"); }
  else if (t.headTop === "droplet") { px(g, cx - 2, tt - 2, "droplet"); px(g, cx, tt - 3, "dropletW"); px(g, cx + 2, tt - 2, "droplet"); }
  else if (t.headTop === "spike") { px(g, cx, tt - 4, "spike"); px(g, cx, tt - 3, "spikeW"); px(g, cx - 1, tt - 2, "spike"); px(g, cx, tt - 2, "spikeW"); px(g, cx + 1, tt - 2, "spike"); px(g, cx, tt - 1, "spike"); }
  else if (t.headTop === "antenna") { px(g, cx, tt - 4, "antennaT"); px(g, cx + 1, tt - 4, "antennaT"); px(g, cx, tt - 3, "antenna"); px(g, cx, tt - 2, "antenna"); px(g, cx, tt - 1, "antenna"); }

  // sombrero
  if (t.headwear === "bow") { const bx = cx + rx - 2; px(g, bx - 1, tt, "bow"); px(g, bx, tt, "bowD"); px(g, bx + 1, tt, "bow"); px(g, bx - 1, tt + 1, "bow"); px(g, bx + 1, tt + 1, "bow"); }
  else if (t.headwear === "crown") { for (let d = -4; d <= 4; d++) px(g, cx + d, tt, d % 2 ? "crown" : "crownD"); for (let d = -3; d <= 3; d++) px(g, cx + d, tt - 1, d % 2 ? "crown" : "crownD"); px(g, cx - 3, tt - 2, "crown"); px(g, cx, tt - 2, "gem"); px(g, cx + 3, tt - 2, "crown"); }
  else if (t.headwear === "flower") { const fx = cx - rx + 1; px(g, fx, tt, "petal"); px(g, fx + 1, tt, "petal"); px(g, fx - 1, tt + 1, "petal"); px(g, fx, tt + 1, "petalC"); px(g, fx + 1, tt + 1, "petalC"); px(g, fx + 2, tt + 1, "petal"); px(g, fx, tt + 2, "petal"); px(g, fx + 1, tt + 2, "petal"); }
  else if (t.headwear === "halo") { for (let d = -4; d <= 4; d++) { px(g, cx + d, tt - 3, "halo"); px(g, cx + d, tt - 1, "halo"); } px(g, cx - 5, tt - 2, "haloD"); px(g, cx + 5, tt - 2, "haloD"); }
  else if (t.headwear === "santa") { for (let d = -5; d <= 5; d++) px(g, cx + d, tt, "santaW"); for (let d = -4; d <= 4; d++) px(g, cx + d, tt - 1, "santa"); for (let d = -3; d <= 3; d++) px(g, cx + d, tt - 2, "santa"); for (let d = -2; d <= 2; d++) px(g, cx + d, tt - 3, "santaD"); px(g, cx + 4, tt - 4, "santaW"); px(g, cx + 5, tt - 5, "santaW"); }

  // orejas de gato (SIEMPRE — la identidad "miau")
  px(g, bL, tt - 2, "earA"); px(g, bL + 1, tt - 2, "earB"); px(g, bL, tt - 1, "earA"); px(g, bL + 1, tt - 1, "earA");
  px(g, bR, tt - 2, "earB"); px(g, bR - 1, tt - 2, "earA"); px(g, bR, tt - 1, "earA"); px(g, bR - 1, tt - 1, "earA");

  // contorno (solo píxeles de cuerpo)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!g[y][x]) continue;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !raw[ny][nx]) { if (raw[y][x]) g[y][x] = "outline"; break; }
    }
  }
  // sombra
  const shCy = cy + ry + 2, shRx = Math.round(rx * 0.65);
  for (let x = cx - shRx; x <= cx + shRx; x++) if (x >= 0 && x < W && shCy < H && !g[shCy][x]) g[shCy][x] = "shadow";
  return g;
}

function gridToSvg(g, p) {
  let body = "";
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const k = g[y][x];
      if (!k) { x++; continue; }
      let run = 1;
      while (x + run < W && g[y][x + run] === k) run++;
      body += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${p[k] || k}"/>`;
      x += run;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges" style="image-rendering:pixelated;display:block">${body}</svg>`;
}

// Devuelve el SVG (string) del gato con esos rasgos.
export function catSvg(traits) {
  const t = { ...DEFAULT_CAT, ...(traits || {}) };
  return gridToSvg(buildGrid(t), pal(t.color));
}
