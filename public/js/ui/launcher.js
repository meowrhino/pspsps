// launcher.js — el menú del dock (el botón 🐱). Tus salas (toca para abrir su
// ventana), crear una nueva, unirte con invitación, y tu alias + color. Sustituye
// a la antigua "vista de lista" a pantalla completa.
import { $, hhmm } from "../util.js";
import * as db from "../db.js";
import { createSala, joinSala, parseInvite, buildInviteLink, PLAZA } from "../salas.js";
import { me } from "../identity.js";
import { openModal, closeModal, inviteLinkField } from "./modal.js";
import * as contactos from "../contactos.js";
import { openDMWith } from "./room.js";
import { catSvg, decodeCat, DEFAULT_CAT } from "../cat.js";

let nav = { onOpenSala: () => {} };

export function initLauncher(opts) {
  nav = opts;
  const btn = $("#launcher");
  const menu = $("#launcher-menu");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
    if (!menu.classList.contains("hidden")) render();
  });
  // cerrar al hacer click fuera
  document.addEventListener("click", (e) => {
    if (!menu.classList.contains("hidden") && !menu.contains(e.target) && e.target !== btn) {
      menu.classList.add("hidden");
    }
  });

  $("#new-sala").addEventListener("click", newSala);
  $("#join-sala").addEventListener("click", joinFromLink);

  // refresca cuando algo cambia (crear/unir/salir; nuevo contacto)
  document.addEventListener("salas-changed", render);
  document.addEventListener("contactos-changed", renderContactos);
}

export async function render() {
  $("#lm-alias").textContent = me() ? me().alias : "";
  const ul = $("#salas");
  let salas = await db.listSalas();
  // la plaza siempre primero
  salas = salas.sort((a, b) => (b.id === PLAZA.id ? 1 : 0) - (a.id === PLAZA.id ? 1 : 0));
  ul.innerHTML = "";
  for (const s of salas) {
    const li = document.createElement("li");
    if (s.id === PLAZA.id) li.classList.add("plaza");

    const avatar = document.createElement("div");
    avatar.className = "sala-avatar";
    avatar.textContent = s.id === PLAZA.id ? "🌐" : emojiFor(s.nombre);

    const main = document.createElement("div");
    main.className = "sala-main";
    const name = document.createElement("div");
    name.className = "sala-name";
    name.textContent = s.nombre;
    const last = document.createElement("div");
    last.className = "sala-last";
    last.textContent = s.ultimoTexto || (s.id === PLAZA.id ? "la plaza del colectivo" : "sala vacía — di hola");
    main.append(name, last);

    const time = document.createElement("div");
    time.className = "sala-time";
    time.textContent = s.ultimoTs ? hhmm(s.ultimoTs) : "";

    li.append(avatar, main, time);
    li.addEventListener("click", () => {
      $("#launcher-menu").classList.add("hidden");
      nav.onOpenSala(s);
    });
    ul.appendChild(li);
  }
  renderContactos();
}

// Agenda: gente con la que has coincidido. Tocar → abre su DM (derivado por ECDH).
export async function renderContactos() {
  const ul = $("#contactos");
  if (!ul) return;
  const cs = await contactos.list();
  const empty = $("#contactos-empty");
  if (empty) empty.classList.toggle("hidden", cs.length > 0);
  ul.innerHTML = "";
  for (const c of cs) {
    const li = document.createElement("li");
    const avatar = document.createElement("div");
    avatar.className = "sala-avatar";
    avatar.innerHTML = catSvg(decodeCat(c.cat) || DEFAULT_CAT);
    const main = document.createElement("div");
    main.className = "sala-main";
    const name = document.createElement("div");
    name.className = "sala-name";
    name.textContent = c.alias;
    const last = document.createElement("div");
    last.className = "sala-last";
    last.textContent = "chat privado cifrado";
    main.append(name, last);
    li.append(avatar, main);
    li.addEventListener("click", () => {
      $("#launcher-menu").classList.add("hidden");
      openDMWith(c.alias, c.pk);
    });
    ul.appendChild(li);
  }
}

function emojiFor(nombre) {
  const cats = ["🐱", "🐈", "😺", "😸", "🐾", "🙀", "😻"];
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h + nombre.charCodeAt(i)) % cats.length;
  return cats[h];
}

function newSala() {
  $("#launcher-menu").classList.add("hidden");
  openModal("sala nueva", (body) => {
    const label = document.createElement("label");
    label.textContent = "nombre de la sala";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "p.ej. el colectivo";
    input.maxLength = 40;
    const row = document.createElement("div");
    row.className = "modal-row";
    const create = document.createElement("button");
    create.textContent = "crear";
    row.appendChild(create);
    async function go() {
      const nombre = input.value.trim() || "sala";
      const sala = await createSala(nombre);
      document.dispatchEvent(new CustomEvent("salas-changed"));
      showInvite(body, sala);
    }
    create.addEventListener("click", go);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") go();
    });
    body.append(label, input, row);
    setTimeout(() => input.focus(), 50);
  });
}

function showInvite(body, sala) {
  body.innerHTML = "";
  $("#modal-title").textContent = "¡sala creada!";
  const p = document.createElement("p");
  p.textContent = "comparte este link por un canal de confianza. la clave va en el #, el servidor nunca la ve.";
  const { row, ok, input } = inviteLinkField(buildInviteLink(sala));
  const enterRow = document.createElement("div");
  enterRow.className = "modal-row";
  const enter = document.createElement("button");
  enter.textContent = "abrir la sala";
  enter.addEventListener("click", () => {
    closeModal();
    nav.onOpenSala(sala);
  });
  enterRow.appendChild(enter);
  body.append(p, row, ok, enterRow);
  setTimeout(() => input.select(), 50);
}

function joinFromLink() {
  $("#launcher-menu").classList.add("hidden");
  openModal("unirme con invitación", (body) => {
    const label = document.createElement("label");
    label.textContent = "pega aquí el link de invitación";
    const ta = document.createElement("textarea");
    ta.placeholder = "https://pspsps.meowrhino.studio/#/join?s=…&k=…";
    const row = document.createElement("div");
    row.className = "modal-row";
    const btn = document.createElement("button");
    btn.textContent = "unirme";
    const err = document.createElement("p");
    err.className = "warn hidden";
    err.textContent = "ese link no parece válido.";
    row.appendChild(btn);
    async function go() {
      const inv = parseInvite(ta.value.trim());
      if (!inv) {
        err.classList.remove("hidden");
        return;
      }
      const sala = await joinSala(inv);
      closeModal();
      document.dispatchEvent(new CustomEvent("salas-changed"));
      nav.onOpenSala(sala);
    }
    btn.addEventListener("click", go);
    body.append(label, ta, err, row);
    setTimeout(() => ta.focus(), 50);
  });
}
