// Alertas de mensaje entrante (solo de OTRAS personas):
//  - sonidito suave generado con Web Audio (sin archivos), conmutable
//  - badge en la pestaña: título "(N) pspsps" + puntito en el favicon
//  - notificación del sistema cuando la pestaña no está visible
// Portado de rumrum/toctoc. La preferencia de silencio se recuerda en
// localStorage (flag trivial; el histórico va a IndexedDB).
import { $ } from "./util.js";

let emoji = "🐱";
let base = "pspsps";
let muted = localStorage.getItem("muted") === "1";
let unread = 0;
let actx;

export function setup(opts = {}) {
  if (opts.emoji) emoji = opts.emoji;
  if (opts.base) base = opts.base;

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) clearBadge();
  });
  window.addEventListener("focus", clearBadge);

  const btn = $("#mute");
  if (btn) {
    paintMute(btn);
    btn.addEventListener("click", () => {
      muted = !muted;
      localStorage.setItem("muted", muted ? "1" : "0");
      paintMute(btn);
      if (!muted) blip();
    });
  }
}

// Llamar al recibir un mensaje de OTRA persona.
export function incoming(from, text) {
  if (!muted) blip();
  if (document.hidden) {
    badge();
    notify(from, text);
  }
}

// Pedir permiso de notificaciones ante un gesto del usuario (p.ej. al enviar).
export async function askNotifPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") return;
  try {
    await Notification.requestPermission();
  } catch {
    /* el navegador lo bloqueó */
  }
}

function paintMute(btn) {
  btn.textContent = muted ? "🔕" : "🔔";
  btn.title = muted ? "activar sonido" : "silenciar";
}

// Blip suave (dos tonos), generado sin assets. Volumen bajo.
function blip() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    const t = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(660, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g);
    g.connect(actx.destination);
    o.start(t);
    o.stop(t + 0.2);
  } catch {
    /* sin audio disponible */
  }
}

function badge() {
  unread++;
  document.title = `(${unread}) ${base}`;
  setFavicon(true);
}

function clearBadge() {
  if (!unread) return;
  unread = 0;
  document.title = base;
  setFavicon(false);
}

function setFavicon(dotOn) {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  const dot = dotOn ? "<circle cx='74' cy='26' r='24' fill='%23e8b04a'/>" : "";
  link.href =
    "data:image/svg+xml," +
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>` +
    `<text y='.9em' font-size='90'>${emoji}</text>${dot}</svg>`;
}

function notify(from, text) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const title = `${base} · ${from}`;
  const opts = { body: text, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: base };
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification(title, opts))
        .catch(() => new Notification(title, opts));
    } else {
      new Notification(title, opts);
    }
  } catch {
    /* notificaciones no disponibles */
  }
}
