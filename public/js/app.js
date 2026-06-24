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
import { catSvg } from "./cat.js";
import { openCatMaker } from "./ui/catmaker.js";

let pendingInvite = null;

function renderAvatars() {
  const svg = catSvg(identity.me().cat);
  const la = $("#launcher-avatar");
  if (la) la.innerHTML = svg;
  const ma = $("#lm-avatar");
  if (ma) ma.innerHTML = svg;
}

// tema: "xp" (calidez Windows XP, por defecto) o "clasico" (limpio)
function applyTheme(theme) {
  document.body.classList.toggle("theme-xp", theme === "xp");
  const btn = $("#theme-toggle");
  if (btn) btn.textContent = theme === "xp" ? "tema: clásico" : "tema: XP cálido";
}

async function enterDesktop() {
  $("#boot").classList.add("hidden");
  $("#desktop").classList.remove("hidden");

  alerts.setup({ emoji: "🐱", base: "pspsps" }); // cablea el 🔔 del dock
  launcher.initLauncher({ onOpenSala: openRoomWindow });

  // tu gato es tu avatar: lo pintamos en el dock y el menú, y lo reeditas desde
  // el menú. Al cambiarlo, repintamos y propagamos el color a las salas abiertas.
  renderAvatars();
  $("#edit-cat").addEventListener("click", openCatMaker);
  document.addEventListener("identity-changed", () => {
    renderAvatars();
    setColorAll(identity.me().color);
  });

  // tema (calidez XP por defecto)
  let theme = localStorage.getItem("theme") || "xp";
  applyTheme(theme);
  $("#theme-toggle").addEventListener("click", () => {
    theme = theme === "xp" ? "clasico" : "xp";
    localStorage.setItem("theme", theme);
    applyTheme(theme);
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
