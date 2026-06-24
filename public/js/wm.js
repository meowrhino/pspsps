// wm.js — gestor de ventanas del pseudo-escritorio. Cada cosa (una sala, el
// lanzador, la identidad) puede abrirse como ventana flotante: arrastrable por
// la barra de título, con foco por z-index, minimizable al dock y (si no está
// anclada) cerrable. En móvil las ventanas se maximizan (ver CSS) y el dock
// sirve para saltar entre ellas.
import { $ } from "./util.js";

const wins = new Map(); // id → { el, body, chip, pinned, minimized, onClose }
let zTop = 10;
let cascade = 0;

const desktop = () => $("#desktop");
const taskbar = () => $("#tasks");

export function isOpen(id) {
  return wins.has(id);
}

export function focusWindow(id) {
  const w = wins.get(id);
  if (!w) return;
  if (w.minimized) {
    w.minimized = false;
    w.el.style.display = "";
  }
  w.el.style.zIndex = ++zTop;
  syncChips();
}

function minimize(id) {
  const w = wins.get(id);
  if (!w) return;
  w.minimized = true;
  w.el.style.display = "none";
  syncChips();
}

export function closeWindow(id) {
  const w = wins.get(id);
  if (!w) return;
  w.onClose?.();
  w.el.remove();
  w.chip.remove();
  wins.delete(id);
}

// Abre una ventana (o enfoca la existente). `build(bodyEl)` rellena su cuerpo.
export function openWindow({ id, title, icon = "", pinned = false, build, onClose }) {
  if (wins.has(id)) {
    focusWindow(id);
    return wins.get(id);
  }

  const el = document.createElement("div");
  el.className = "win";
  const dk = desktop().getBoundingClientRect();
  const off = (cascade++ % 6) * 26;
  el.style.left = Math.max(8, Math.min(20 + off, dk.width - 320)) + "px";
  el.style.top = 16 + off + "px";
  el.style.zIndex = ++zTop;

  const bar = document.createElement("div");
  bar.className = "win-bar";
  const ic = document.createElement("span");
  ic.className = "win-ic";
  ic.textContent = icon;
  const ttl = document.createElement("span");
  ttl.className = "win-title";
  ttl.textContent = title;
  const ctrls = document.createElement("span");
  ctrls.className = "win-ctrls";
  const minB = document.createElement("button");
  minB.className = "win-btn";
  minB.type = "button";
  minB.title = "minimizar";
  minB.textContent = "–";
  minB.addEventListener("click", (e) => {
    e.stopPropagation();
    minimize(id);
  });
  ctrls.appendChild(minB);
  if (!pinned) {
    const closeB = document.createElement("button");
    closeB.className = "win-btn";
    closeB.type = "button";
    closeB.title = "cerrar";
    closeB.textContent = "×";
    closeB.addEventListener("click", (e) => {
      e.stopPropagation();
      closeWindow(id);
    });
    ctrls.appendChild(closeB);
  }
  bar.append(ic, ttl, ctrls);

  const body = document.createElement("div");
  body.className = "win-body";

  el.append(bar, body);
  desktop().appendChild(el);
  el.addEventListener("mousedown", () => focusWindow(id));
  makeDraggable(el, bar);

  // chip del dock
  const chip = document.createElement("button");
  chip.className = "task";
  chip.type = "button";
  const cic = document.createElement("span");
  cic.className = "chip-ic";
  cic.textContent = icon;
  const ct = document.createElement("span");
  ct.className = "chip-t";
  ct.textContent = title;
  chip.append(cic, ct);
  chip.addEventListener("click", () => {
    const w = wins.get(id);
    if (w.minimized) focusWindow(id);
    else if (Number(w.el.style.zIndex) === zTop) minimize(id); // al frente → minimiza
    else focusWindow(id);
  });
  taskbar().appendChild(chip);

  const w = { el, body, chip, pinned, minimized: false, onClose };
  wins.set(id, w);
  build(body);
  syncChips();
  return w;
}

function syncChips() {
  for (const [, w] of wins) {
    w.chip.classList.toggle("min", w.minimized);
    w.chip.classList.toggle("front", !w.minimized && Number(w.el.style.zIndex) === zTop);
  }
}

function makeDraggable(el, handle) {
  const start = (cx, cy) => {
    const dk = desktop().getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const ox = cx - r.left;
    const oy = cy - r.top;
    return (mx, my) => {
      const x = Math.max(0, Math.min(mx - dk.left - ox, dk.width - r.width));
      const y = Math.max(0, Math.min(my - dk.top - oy, dk.height - 52));
      el.style.left = x + "px";
      el.style.top = y + "px";
    };
  };
  handle.addEventListener("mousedown", (e) => {
    if (e.target.closest(".win-btn")) return;
    const move = start(e.clientX, e.clientY);
    document.body.style.userSelect = "none";
    const mv = (ev) => move(ev.clientX, ev.clientY);
    const up = () => {
      document.removeEventListener("mousemove", mv);
      document.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", mv);
    document.addEventListener("mouseup", up);
  });
}
