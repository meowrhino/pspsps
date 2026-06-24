// list.js — la lista de salas (heredada del sidebar de toctoc, pero a pantalla
// completa, mobile-first). Crear sala nueva, unirse con una invitación, y abrir
// una sala al tocarla.
import { $, hhmm } from "../util.js";
import * as db from "../db.js";
import { createSala, joinSala, parseInvite, buildInviteLink } from "../salas.js";
import { me } from "../identity.js";
import { openModal, closeModal } from "./modal.js";

let nav = { onOpen: () => {} };

export function initListView(opts) {
  nav = opts;
  $("#new-sala").addEventListener("click", newSala);
  $("#join-sala").addEventListener("click", joinFromLink);
}

export async function render() {
  const ul = $("#salas");
  const salas = await db.listSalas();
  $("#list-whoami").textContent = me() ? `tú: ${me().alias}` : "";
  $("#list-empty").classList.toggle("hidden", salas.length > 0);
  ul.innerHTML = "";
  for (const s of salas) {
    const li = document.createElement("li");
    li.style.borderLeftColor = "var(--accent)";

    const avatar = document.createElement("div");
    avatar.className = "sala-avatar";
    avatar.textContent = emojiFor(s.nombre);

    const main = document.createElement("div");
    main.className = "sala-main";
    const name = document.createElement("div");
    name.className = "sala-name";
    name.textContent = s.nombre;
    const last = document.createElement("div");
    last.className = "sala-last";
    last.textContent = s.ultimoTexto || "sala vacía — di hola";
    main.append(name, last);

    const time = document.createElement("div");
    time.className = "sala-time";
    time.textContent = s.ultimoTs ? hhmm(s.ultimoTs) : "";

    li.append(avatar, main, time);
    li.addEventListener("click", () => nav.onOpen(s));
    ul.appendChild(li);
  }
}

function emojiFor(nombre) {
  const cats = ["🐱", "🐈", "😺", "😸", "🐾", "🙀", "😻"];
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h + nombre.charCodeAt(i)) % cats.length;
  return cats[h];
}

// ── crear sala ──────────────────────────────────────────────────────────────
function newSala() {
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
      await render();
      showInvite(body, sala); // misma modal → muestra el link + "entrar"
    }
    create.addEventListener("click", go);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") go();
    });

    body.append(label, input, row);
    setTimeout(() => input.focus(), 50);
  });
}

// reemplaza el cuerpo de la modal por el link de invitación de la sala recién creada
function showInvite(body, sala) {
  body.innerHTML = "";
  $("#modal-title").textContent = "¡sala creada!";
  const p = document.createElement("p");
  p.textContent = "comparte este link por un canal de confianza. la clave va en el #, el servidor nunca la ve.";
  const link = buildInviteLink(sala);
  const row = document.createElement("div");
  row.className = "invite-link";
  const input = document.createElement("input");
  input.type = "text";
  input.readOnly = true;
  input.value = link;
  const copy = document.createElement("button");
  copy.textContent = "copiar";
  const ok = document.createElement("p");
  ok.className = "copied hidden";
  ok.textContent = "✓ copiado";
  copy.addEventListener("click", async () => {
    input.select();
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      document.execCommand("copy");
    }
    ok.classList.remove("hidden");
  });
  row.append(input, copy);

  const enterRow = document.createElement("div");
  enterRow.className = "modal-row";
  const enter = document.createElement("button");
  enter.textContent = "entrar a la sala";
  enter.addEventListener("click", () => {
    closeModal();
    nav.onOpen(sala);
  });
  enterRow.appendChild(enter);

  body.append(p, row, ok, enterRow);
  setTimeout(() => input.select(), 50);
}

// ── unirse con invitación ─────────────────────────────────────────────────
function joinFromLink() {
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
      await render();
      nav.onOpen(sala);
    }
    btn.addEventListener("click", go);

    body.append(label, ta, err, row);
    setTimeout(() => ta.focus(), 50);
  });
}
