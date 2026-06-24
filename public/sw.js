// Service worker de pspsps. Cachea el "app shell" (HTML/CSS/JS/iconos) para que
// la app cargue al instante y offline, e instalable como PWA. El tiempo real
// (/ws) nunca se intercepta. Incluye los handlers de Web Push (fase 2): cuando
// el Durable Object avise a un miembro desconectado, el SO entrega el push y
// este SW muestra la notificación aunque la app esté cerrada.
//
// Estrategia del shell: stale-while-revalidate (sirve cache al momento y
// actualiza en segundo plano). Sube la versión del CACHE al cambiar el shell.
const CACHE = "pspsps-v1";
const SHELL = [
  "/",
  "/css/pspsps.css",
  "/js/app.js",
  "/js/util.js",
  "/js/db.js",
  "/js/crypto.js",
  "/js/ws.js",
  "/js/salas.js",
  "/js/identity.js",
  "/js/alerts.js",
  "/js/ui/modal.js",
  "/js/ui/list.js",
  "/js/ui/room.js",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return; // mutaciones → red
  if (url.origin !== location.origin) return; // fuentes/terceros → red
  if (url.pathname === "/ws") return; // WebSocket → red (no cacheable)
  if (url.pathname === "/vapid-public") return; // siempre fresca

  e.respondWith(
    (async () => {
      const cached = await caches.match(e.request);
      const network = fetch(e.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => null);
      if (cached) return cached; // sirve cache; la red revalida en segundo plano
      const res = await network;
      if (res) return res;
      // offline y sin cache: para una navegación cae al shell ("/"); si no, 503.
      if (e.request.mode === "navigate") {
        return (await caches.match("/")) || new Response("offline", { status: 503 });
      }
      return new Response("offline", { status: 503 });
    })(),
  );
});

// ── Web Push (fase 2) ───────────────────────────────────────────────────────
// El payload que mandamos desde el DO es mínimo y NO lleva texto del mensaje
// (zero-knowledge: el servidor no puede leerlo). Solo el id de sala, para abrir
// la conversación correcta. El nombre legible se resuelve aquí si hace falta.
self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    /* payload no-JSON */
  }
  const sala = data.sala || "";
  const title = data.title || "pspsps";
  const body = data.body || "tienes un mensaje nuevo 🐱";
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: sala || "pspsps",
      data: { sala },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const sala = e.notification.data?.sala;
  const target = sala ? `/#/sala/${encodeURIComponent(sala)}` : "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if ("focus" in c) {
          c.navigate(target).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
