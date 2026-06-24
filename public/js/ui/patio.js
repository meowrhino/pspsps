// patio.js — el PATIO: un espacio caminable (estilo miaumiau). Tu gato anda por
// el suelo, ves a quien esté conectado en tiempo real, y al clicar a alguien se
// abre su chat 1:1 — una sala derivada por ECDH entre vuestras claves públicas
// (E2E: el servidor solo mueve blobs, la clave del DM nunca viaja).
//
// Reusa el motor de salas: el patio es una "sala" (un DO) que solo mueve perfiles
// (gatos), presencia y posiciones (efímeras). No guarda mensajes.
import * as wm from "../wm.js";
import { connectRoom } from "../ws.js";
import { catSvg, encodeCat, decodeCat } from "../cat.js";
import { me } from "../identity.js";
import * as contactos from "../contactos.js";
import { openDMWith } from "./room.js";

const PATIO_ROOM = "patio-publico-pspsps";
let ctrl = null;

export function openPatio() {
  wm.openWindow({
    id: "patio",
    title: "el patio",
    icon: "🐾",
    build: (body) => (ctrl = buildPatio(body)),
    onClose: () => { ctrl?.destroy(); ctrl = null; },
  });
}

const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };

function buildPatio(body) {
  const state = { conn: null, cats: {}, pubs: {}, pos: {}, online: [], els: new Map() };
  const myName = me().alias;

  body.classList.add("patio-body");
  const floor = el("div", "patio-floor");
  const hint = el("div", "patio-hint");
  hint.textContent = "toca el suelo para pasear · toca un gato para hablarle";
  floor.appendChild(hint);
  body.append(floor);

  // mi posición inicial (centro-abajo)
  state.pos[myName] = { x: 0.5, y: 0.62 };
  state.cats[myName] = me().cat;

  // toca el suelo → camino allí
  floor.addEventListener("click", (e) => {
    if (e.target.closest(".patio-cat")) return;
    const r = floor.getBoundingClientRect();
    const x = Math.max(0.04, Math.min(0.96, (e.clientX - r.left) / r.width));
    const y = Math.max(0.12, Math.min(0.92, (e.clientY - r.top) / r.height));
    state.pos[myName] = { x, y };
    placeCat(myName);
    state.conn?.move(x, y);
  });

  function ensureCat(name) {
    let c = state.els.get(name);
    if (!c) {
      c = el("div", "patio-cat");
      const sprite = el("div", "patio-cat-sprite");
      const label = el("div", "patio-cat-label");
      label.textContent = name;
      c.append(sprite, label);
      c.dataset.name = name;
      if (name === myName) c.classList.add("me");
      c.addEventListener("click", (e) => {
        e.stopPropagation();
        if (name === myName) return; // tu propio gato: nada (edítalo desde el dock)
        openDM(name);
      });
      floor.appendChild(c);
      state.els.set(name, c);
    }
    const sprite = c.querySelector(".patio-cat-sprite");
    sprite.innerHTML = catSvg(state.cats[name] || me().cat);
    placeCat(name);
    return c;
  }

  function placeCat(name) {
    const c = state.els.get(name);
    const p = state.pos[name];
    if (!c || !p) return;
    c.style.left = p.x * 100 + "%";
    c.style.top = p.y * 100 + "%";
    c.style.zIndex = String(Math.round(p.y * 100)); // los de abajo, delante
  }

  function syncOnline() {
    const set = new Set(state.online);
    set.add(myName);
    // quita a los que se fueron
    for (const [name, c] of state.els) {
      if (!set.has(name)) { c.remove(); state.els.delete(name); delete state.pos[name]; }
    }
    // asegura a los presentes (posición por defecto si aún no la sabemos)
    for (const name of set) {
      if (!state.pos[name]) state.pos[name] = { x: 0.2 + Math.random() * 0.6, y: 0.3 + Math.random() * 0.5 };
      ensureCat(name);
    }
  }

  function mergeProfiles(profiles) {
    for (const [name, p] of Object.entries(profiles || {})) {
      if (!p) continue;
      if (p.cat) state.cats[name] = decodeCat(p.cat);
      if (p.pk) {
        state.pubs[name] = p.pk;
        contactos.note(name, p.cat, p.pk);
      }
    }
  }

  function openDM(name) {
    openDMWith(name, state.pubs[name]);
  }

  const m = me();
  state.conn = connectRoom({
    room: PATIO_ROOM,
    name: myName,
    color: m.color,
    cat: encodeCat(m.cat),
    pk: m.keys?.pubRaw || "",
    getCursor: () => 0,
    onHistory: (_messages, profiles, online) => {
      mergeProfiles(profiles);
      state.online = online;
      syncOnline();
      broadcastPos();
    },
    onProfile: ({ name, cat, pk }) => {
      if (cat) state.cats[name] = decodeCat(cat);
      if (pk) {
        state.pubs[name] = pk;
        contactos.note(name, cat, pk);
      }
      if (state.els.has(name)) ensureCat(name);
    },
    onPresence: (online) => {
      state.online = online;
      syncOnline();
      broadcastPos(); // que los recién llegados vean dónde estoy
    },
    onMove: ({ name, x, y }) => {
      state.pos[name] = { x, y };
      ensureCat(name);
    },
  });

  function broadcastPos() {
    const p = state.pos[myName];
    if (p) state.conn?.move(p.x, p.y);
  }

  ensureCat(myName);

  return { destroy: () => state.conn?.close() };
}
