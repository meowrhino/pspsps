// app.js — arranque del pseudo-escritorio. Puerta de identidad → escritorio con
// la plaza pública siempre abierta. Las salas se abren como ventanas (no hay
// router de vistas: lo gestiona el window manager).
//
// Invitaciones por link: #/join?s=&k=&n= — el fragmento # nunca viaja al
// servidor, así que la clave de la sala se queda en el cliente.
import { $ } from "./util.js";
import * as db from "./db.js";
import * as identity from "./identity.js";
import * as launcher from "./ui/launcher.js";
import { openRoomWindow, setColorAll } from "./ui/room.js";
import { joinSala, parseInvite, ensurePlaza } from "./salas.js";
import * as alerts from "./alerts.js";
import * as push from "./push.js";

let pendingInvite = null;

async function enterDesktop() {
  $("#boot").classList.add("hidden");
  $("#desktop").classList.remove("hidden");

  alerts.setup({ emoji: "🐱", base: "pspsps" }); // cablea el 🔔 del dock
  launcher.initLauncher({ onOpenSala: openRoomWindow });

  // color global del usuario (en el menú del lanzador) → propaga a salas abiertas
  const picker = $("#my-color");
  picker.value = identity.me().color;
  picker.addEventListener("change", async () => {
    await identity.updateColor(picker.value);
    setColorAll(picker.value);
  });

  // web push
  await push.loadSub();
  push.ensurePush().catch(() => {});
  push.mountPushBanner();

  // la plaza pública va anclada: siempre abierta al entrar
  const plaza = await ensurePlaza();
  openRoomWindow(plaza);

  // ¿llegamos por una invitación? únete y ábrela
  if (pendingInvite) {
    const sala = await joinSala(pendingInvite);
    pendingInvite = null;
    history.replaceState(null, "", location.pathname); // limpia el link de la URL
    document.dispatchEvent(new CustomEvent("salas-changed"));
    openRoomWindow(sala);
  }
}

async function boot() {
  await db.init();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  await identity.loadIdentity();
  const inv = parseInvite(location.hash);
  if (inv) pendingInvite = inv;

  if (!identity.me()) {
    identity.mountIdentityScreen(() => enterDesktop()); // #boot ya está visible
  } else {
    await enterDesktop();
  }
}

boot();
