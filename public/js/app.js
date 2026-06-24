// app.js — bootstrap + router de vistas. Une identidad, lista y sala.
//
// Rutas (hash; el fragmento # nunca viaja al servidor → la clave de las
// invitaciones se queda en el cliente):
//   #/                      → lista de salas
//   #/sala/<id>             → sala abierta
//   #/join?s=&k=&n=         → unirse a una sala desde una invitación
import { $, enc, dec } from "./util.js";
import * as db from "./db.js";
import * as identity from "./identity.js";
import * as list from "./ui/list.js";
import * as room from "./ui/room.js";
import { joinSala, parseInvite } from "./salas.js";
import * as alerts from "./alerts.js";
import * as push from "./push.js";

let pendingInvite = null; // invitación recibida antes de tener identidad
let currentRoomId = null;

function showView(name) {
  for (const v of ["identity", "list", "room"]) {
    $("#view-" + v).classList.toggle("active", v === name);
  }
}

const go = (hash) => {
  if (location.hash === hash) route();
  else location.hash = hash;
};

// ── router ────────────────────────────────────────────────────────────────
async function route() {
  // sin identidad: la pantalla de identidad manda (guardando la intención)
  if (!identity.me()) {
    const inv = parseInvite(location.hash);
    if (inv) pendingInvite = inv;
    showView("identity");
    return;
  }

  const hash = location.hash.replace(/^#/, "") || "/";

  if (hash.startsWith("/join")) {
    const inv = parseInvite(location.hash);
    if (inv) {
      const sala = await joinSala(inv);
      go("#/sala/" + enc(sala.id));
    } else {
      go("#/");
    }
    return;
  }

  if (hash.startsWith("/sala/")) {
    const id = dec(hash.slice("/sala/".length));
    const sala = await db.getSala(id);
    if (!sala) {
      go("#/");
      return;
    }
    showView("room");
    if (currentRoomId !== id) {
      currentRoomId = id;
      await room.open(sala);
    }
    return;
  }

  // lista (por defecto)
  currentRoomId = null;
  await room.close();
  showView("list");
  await list.render();
}

// ── arranque ────────────────────────────────────────────────────────────────
async function boot() {
  await db.init();
  alerts.setup({ emoji: "🐱", base: "pspsps" });

  // service worker primero: la PWA instalable, la carga offline del shell y el
  // Web Push lo necesitan activo.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  // cablea las vistas una sola vez
  list.initListView({ onOpen: (sala) => go("#/sala/" + enc(sala.id)) });
  room.initRoomView({
    onBack: () => go("#/"),
    onLeft: () => go("#/"),
  });

  // selector de color (global del usuario) en la barra de la lista
  const picker = $("#my-color");
  picker.addEventListener("change", async () => {
    await identity.updateColor(picker.value);
  });

  await identity.loadIdentity();
  await push.loadSub();

  // al entrar a la app: refresca la suscripción de push (si ya hay permiso) y
  // ofrece activarla (si aún no). No bloquea la navegación.
  function enteredApp() {
    picker.value = identity.me().color;
    push.ensurePush().catch(() => {});
    push.mountPushBanner();
  }

  if (!identity.me()) {
    identity.mountIdentityScreen(async () => {
      enteredApp();
      // ¿llegó por una invitación? únete y entra; si no, a la lista
      if (pendingInvite) {
        const sala = await joinSala(pendingInvite);
        pendingInvite = null;
        go("#/sala/" + enc(sala.id));
      } else {
        go("#/");
      }
    });
    showView("identity");
  } else {
    enteredApp();
  }

  addEventListener("hashchange", route);
  await route();
}

boot();
