// Helpers minúsculos compartidos por el resto de módulos. Sin dependencias.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Crea un elemento con clase opcional (helper compartido por las vistas).
export const el = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};

// uuid v4 (idempotencia de mensajes). crypto.randomUUID existe en todos los
// navegadores con WebCrypto (los mismos donde corre esta PWA).
export const uuid = () => crypto.randomUUID();

// ── base64url (sin padding) ─────────────────────────────────────────────────
// Convención de trackr: todo blob/clave serializado va en base64url para que
// quepa en URLs (links de invitación) sin escapar nada.
export function b64u(bytes) {
  let bin = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64uDec(str) {
  const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Color estable por nombre (cada alias con su color). Hash simple → tono HSL, y
// de ahí a HEX para que el <input type="color"> pueda mostrarlo. Saturación y
// luz fijas para que siempre se lea sobre el fondo oscuro cálido. Es solo el
// color POR DEFECTO: cada quien puede elegir el suyo.
export function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return hslToHex(h, 55, 70);
}
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Mete `text` en `el` convirtiendo las URLs http(s) en enlaces clicables. Usa
// solo nodos de texto + <a> (nunca innerHTML) y la regex solo casa http(s):// →
// el href nunca puede ser javascript: ni nada inyectable.
const URL_RE = /(https?:\/\/[^\s<]+)/g;
export function linkifyInto(el, text) {
  let last = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElement("a");
    a.href = m[0];
    a.textContent = m[0];
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.className = "link";
    el.appendChild(a);
    last = m.index + m[0].length;
  }
  if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}

// Hora corta HH:MM a partir de un timestamp en ms.
export function hhmm(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Clave de día LOCAL (YYYY-MM-DD) para detectar el cambio de día entre mensajes.
export function dayKey(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// Etiqueta amable para el separador de día: "hoy" / "ayer" / "3 jun 2026".
export function dayLabel(ts, now = Date.now()) {
  const k = dayKey(ts);
  if (k === dayKey(now)) return "hoy";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (k === dayKey(yesterday.getTime())) return "ayer";
  const d = new Date(ts);
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

// Escapa para usar en un atributo/much; aquí solo para construir el hash de
// invitación de forma segura (los valores ya son b64url/limpios, pero por si).
export const enc = encodeURIComponent;
export const dec = decodeURIComponent;
