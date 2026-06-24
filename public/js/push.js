// push.js (cliente) — suscripción a Web Push. Pide permiso, se suscribe con la
// clave pública VAPID del servidor, guarda la suscripción en IndexedDB y la
// registra en cada sala (vía {type:"sub"}) para que su Durable Object pueda
// avisar a este dispositivo cuando reciba un mensaje y no haya WS activo.
//
// iOS 16.4+: el push SOLO funciona con la PWA instalada ("Añadir a inicio")
// ANTES de suscribir, y requiere un gesto del usuario para pedir permiso.
import { $, b64uDec } from "./util.js";
import * as db from "./db.js";

let _sub = null; // { endpoint, p256dh, auth }

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function currentSub() {
  return _sub;
}

export async function loadSub() {
  _sub = await db.getPushSub();
  return _sub;
}

async function vapidKey() {
  const res = await fetch("/vapid-public", { cache: "no-store" });
  const k = (await res.text()).trim();
  if (!k) throw new Error("el servidor no tiene clave VAPID");
  return b64uDec(k);
}

// Crea (o recupera) la suscripción del navegador y la persiste. Asume permiso ya
// concedido (no lo pide aquí).
async function subscribe() {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: await vapidKey(),
    });
  }
  const j = sub.toJSON();
  _sub = { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth };
  await db.setPushSub(_sub);
  return _sub;
}

// Si ya hay permiso, asegura la suscripción en silencio (usuarios que vuelven).
export async function ensurePush() {
  if (!pushSupported() || Notification.permission !== "granted") return null;
  try {
    return await subscribe();
  } catch (e) {
    console.warn("pspsps push: no se pudo asegurar la suscripción", e);
    return null;
  }
}

// Pide permiso (gesto del usuario) y se suscribe.
export async function enablePush() {
  if (!pushSupported()) throw new Error("este navegador no soporta Web Push");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("permiso de notificaciones denegado");
  return subscribe();
}

// Banner de "activar avisos" en la lista. Se muestra si hay soporte, aún no hay
// permiso, y no se descartó antes.
export function mountPushBanner(onEnabled) {
  const banner = $("#push-banner");
  if (!banner) return;
  const dismissed = localStorage.getItem("pushDismissed") === "1";
  const show = pushSupported() && Notification.permission === "default" && !dismissed;
  banner.classList.toggle("hidden", !show);

  $("#push-enable").addEventListener("click", async () => {
    try {
      await enablePush();
      onEnabled?.();
    } catch (e) {
      console.warn("pspsps push:", e.message);
    }
    banner.classList.add("hidden");
  });
  $("#push-dismiss").addEventListener("click", () => {
    localStorage.setItem("pushDismissed", "1");
    banner.classList.add("hidden");
  });
}
