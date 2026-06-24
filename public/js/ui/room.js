// room.js — la sala abierta. Conecta su WebSocket, descifra el historial y los
// mensajes en vivo, cifra y envía (con cola offline + idempotencia), y pinta
// burbujas estilo Messenger (heredado de toctoc). El cifrado es transparente
// para el motor: aquí entra/sale texto plano, por el cable van blobs.
import { $, hhmm, dayKey, dayLabel, linkifyInto, colorFor, uuid } from "../util.js";
import * as db from "../db.js";
import { importKey, encrypt, decrypt } from "../crypto.js";
import { connectRoom } from "../ws.js";
import * as alerts from "../alerts.js";
import { me } from "../identity.js";
import { openModal } from "./modal.js";
import { buildInviteLink } from "../salas.js";
import { currentSub } from "../push.js";

let cur = null; // { sala, key, conn, colors, online }
let msgs = []; // mensajes en memoria, ordenados por ts
let rendered = new Map(); // id → <li>
let lastDay = null;
let nav = { onBack: () => {}, onLeft: () => {} };
// Cada open() incrementa esto. Los callbacks del WebSocket de una sala anterior
// (que pueden disparar tras cambiar de sala) capturan su epoch y se ignoran si ya
// no es el actual → no contaminan la sala nueva.
let openEpoch = 0;

const colorOf = (name) => (cur?.colors[name] || colorFor(name));

// Cablea los botones estáticos una sola vez.
export function initRoomView(opts) {
  nav = opts;
  $("#room-back").addEventListener("click", () => {
    close();
    nav.onBack();
  });
  $("#room-invite").addEventListener("click", invite);
  $("#room-leave").addEventListener("click", leave);

  $("#composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#body");
    const text = input.value.trim();
    if (!text || !cur) return;
    alerts.askNotifPermission(); // gesto del usuario → buen momento para pedir permiso
    send(text);
    input.value = "";
    input.focus();
  });
}

export async function open(sala) {
  await close();
  const epoch = ++openEpoch; // sella esta apertura
  cur = { sala, key: await importKey(sala.keyB64), conn: null, colors: {}, online: [] };
  msgs = [];
  rendered = new Map();
  lastDay = null;

  $("#room-name").textContent = sala.nombre;
  $("#messages").innerHTML = "";
  $("#presence").innerHTML = "";
  setConn("connecting");

  // 1) pinta lo que ya tenemos en local (instantáneo, offline-first)
  const local = await db.getMessages(sala.id);
  for (const m of local) {
    msgs.push(m);
    rendered.set(m.id, null);
  }
  renderAll();

  // 2) conecta y sincroniza desde nuestro cursor (lo que nos perdimos)
  const m = me();
  const fresh = () => epoch === openEpoch && cur; // ¿sigue siendo la sala actual?
  cur.conn = connectRoom({
    room: sala.id,
    name: m.alias,
    color: m.color,
    getCursor: () => cur?.sala.ultimoSeq || 0,
    onStatus: (s) => fresh() && setConn(s),
    onHistory: (messages, profiles, online, minSeq) => {
      if (!fresh()) return;
      cur.colors = { ...cur.colors, ...profiles };
      cur.online = online;
      // hueco por poda del servidor (ring buffer): nuestro cursor cayó por debajo
      // de lo que el DO aún conserva → perdimos un tramo irrecuperable. Al menos
      // lo sabemos (en vez de creernos al día en silencio).
      const cursor = cur.sala.ultimoSeq || 0;
      if (minSeq && cursor > 0 && minSeq > cursor + 1) {
        console.warn(`pspsps: hueco en el historial de "${cur.sala.nombre}" (perdidos seq ${cursor + 1}–${minSeq - 1})`);
      }
      ingestBatch(messages);
      paintPresence();
    },
    onMessage: (sm) => fresh() && ingestBatch([sm], { live: true }),
    onColor: ({ name, color }) => {
      if (!fresh()) return;
      cur.colors[name] = color;
      recolor(name, color);
      paintPresence();
    },
    onPresence: (online) => {
      if (!fresh()) return;
      cur.online = online;
      paintPresence();
    },
  });

  // registra nuestra suscripción de push en esta sala (si la hay), para que su DO
  // pueda avisarnos cuando estemos desconectados de ella
  const sub = currentSub();
  if (sub) cur.conn.sub(sub);

  // 3) reenvía la cola de salida (mensajes compuestos offline)
  const pend = await db.getPending(sala.id);
  for (const p of pend) {
    // reenvía el MISMO blob ya cifrado (estable entre reintentos); si es de una
    // versión vieja sin blob guardado, lo recifra como respaldo.
    const blob = p.blob || (await encrypt(cur.key, sala.id, { text: p.texto }));
    cur.conn.send({ id: p.id, ts: p.ts, blob });
  }

  setTimeout(() => $("#body")?.focus(), 50);
}

export async function close() {
  if (!cur) return;
  cur.conn?.close();
  cur = null;
}

// ── envío ─────────────────────────────────────────────────────────────────
async function send(text) {
  const m = me();
  const id = uuid();
  const ts = Date.now();
  let blob;
  try {
    blob = await encrypt(cur.key, cur.sala.id, { text });
  } catch (e) {
    console.error("pspsps: no se pudo cifrar el mensaje", e);
    return;
  }
  const msg = {
    id,
    sala: cur.sala.id,
    autor: m.alias,
    ts,
    seq: null,
    texto: text,
    blob, // se reenvía igual desde la cola tras reconectar
    mio: true,
    pendiente: true, // hasta que el servidor lo confirme (eco con seq)
  };
  // persiste antes de enviar (offline-first); si IndexedDB falla, igual lo
  // pintamos y mandamos para no perder el mensaje del usuario.
  try {
    await db.putMessage(msg);
  } catch (e) {
    console.error("pspsps: no se pudo guardar en IndexedDB", e);
  }
  upsert(msg);
  bumpPreview(text, ts).catch(() => {});
  cur.conn.send({ id, ts, blob }); // si no hay socket, queda en cola
}

// ── recepción ───────────────────────────────────────────────────────────────
async function ingestBatch(serverMsgs, { live } = {}) {
  let maxSeq = cur.sala.ultimoSeq || 0;
  let lastText = null;
  let lastTs = 0;
  for (const sm of serverMsgs) {
    if (sm.kind && sm.kind !== "user") continue; // por si llegan de sistema
    const mine = sm.author === me().alias;

    let payload = null;
    try {
      payload = await decrypt(cur.key, cur.sala.id, sm.blob);
    } catch {
      /* clave incorrecta o blob manipulado */
    }
    const msg = {
      id: sm.id,
      sala: cur.sala.id,
      autor: sm.author,
      ts: sm.ts,
      seq: sm.seq ?? null,
      mio: mine,
      pendiente: false,
    };
    // no pisar el texto de MIS mensajes si su eco no descifrara por lo que sea
    if (payload) msg.texto = payload.text;
    else if (!mine) {
      msg.texto = "(no se pudo descifrar)";
      msg.undecryptable = true;
    }

    await db.putMessage(msg);
    upsert({ ...(rendered.has(msg.id) ? findMsg(msg.id) : {}), ...msg });

    if (sm.seq && sm.seq > maxSeq) maxSeq = sm.seq;
    if (msg.texto && !msg.undecryptable) {
      lastText = msg.texto;
      lastTs = sm.ts;
    }
    if (live && !mine && payload) alerts.incoming(sm.author, payload.text);
  }

  // persiste el avance del cursor y el preview de la lista
  if (maxSeq !== (cur.sala.ultimoSeq || 0) || lastText) {
    cur.sala.ultimoSeq = maxSeq;
    if (lastText) {
      cur.sala.ultimoTexto = lastText;
      cur.sala.ultimoTs = lastTs;
    }
    await db.putSala(cur.sala);
  }
}

function findMsg(id) {
  return msgs.find((m) => m.id === id) || {};
}

async function bumpPreview(text, ts) {
  cur.sala.ultimoTexto = text;
  cur.sala.ultimoTs = ts;
  await db.putSala(cur.sala);
}

// ── render ──────────────────────────────────────────────────────────────────
function upsert(msg) {
  const idx = msgs.findIndex((m) => m.id === msg.id);
  const li = rendered.get(msg.id);
  if (idx >= 0) msgs[idx] = { ...msgs[idx], ...msg };
  else {
    msgs.push(msg);
    msgs.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  }

  if (li) {
    updateBubble(li, msgs[idx]);
  } else if (msgs[msgs.length - 1].id === msg.id) {
    appendBubble(msg); // caso común: el más nuevo va al final
  } else {
    renderAll(); // llegó desordenado (backfill) → reconstruye
  }
}

function renderAll() {
  const box = $("#messages");
  box.innerHTML = "";
  rendered = new Map();
  lastDay = null;
  for (const m of msgs) appendBubble(m, true);
  box.scrollTop = box.scrollHeight;
}

function appendBubble(msg, bulk = false) {
  const box = $("#messages");
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;

  const key = dayKey(msg.ts);
  if (key !== lastDay) {
    lastDay = key;
    const sep = document.createElement("li");
    sep.className = "daysep";
    const span = document.createElement("span");
    span.textContent = dayLabel(msg.ts);
    sep.appendChild(span);
    box.appendChild(sep);
  }

  const li = buildBubble(msg);
  box.appendChild(li);
  rendered.set(msg.id, li);
  if (!bulk && atBottom) box.scrollTop = box.scrollHeight;
}

function buildBubble(msg) {
  const li = document.createElement("li");
  li.className = "bubble " + (msg.mio ? "mine" : "theirs");
  if (msg.pendiente) li.classList.add("pending");
  if (msg.undecryptable) li.classList.add("undecryptable");
  li.dataset.author = msg.autor;

  if (!msg.mio) {
    const author = document.createElement("span");
    author.className = "author";
    author.textContent = msg.autor;
    author.style.color = colorOf(msg.autor);
    li.appendChild(author);
  }

  const text = document.createElement("span");
  text.className = "text";
  linkifyInto(text, msg.texto || "");
  li.appendChild(text);

  const meta = document.createElement("span");
  meta.className = "meta-line";
  meta.textContent = hhmm(msg.ts) + (msg.pendiente ? " · enviando…" : "");
  li.appendChild(meta);

  return li;
}

function updateBubble(li, msg) {
  li.classList.toggle("pending", !!msg.pendiente);
  const meta = li.querySelector(".meta-line");
  if (meta) meta.textContent = hhmm(msg.ts) + (msg.pendiente ? " · enviando…" : "");
}

// recolorea el nombre de quien cambió de color en las burbujas ya pintadas
function recolor(name, color) {
  for (const li of $("#messages").querySelectorAll(".bubble.theirs")) {
    if (li.dataset.author === name) {
      const el = li.querySelector(".author");
      if (el) el.style.color = color;
    }
  }
}

function paintPresence() {
  const box = $("#presence");
  if (!box) return;
  box.innerHTML = "";
  const online = cur.online || [];
  if (!online.length) return;
  const label = document.createElement("span");
  label.textContent = online.length === 1 ? "1 en línea" : `${online.length} en línea`;
  box.appendChild(label);
  for (const name of online) {
    const chip = document.createElement("span");
    chip.className = "presence-chip";
    const dot = document.createElement("span");
    dot.className = "presence-dot";
    dot.style.background = colorOf(name);
    const nm = document.createElement("span");
    nm.textContent = name;
    chip.append(dot, nm);
    box.appendChild(chip);
  }
}

function setConn(status) {
  const dot = $("#conn-dot");
  if (!dot) return;
  dot.classList.remove("online", "connecting", "offline");
  if (status === "online") dot.classList.add("online");
  else if (status === "connecting") dot.classList.add("connecting");
  else dot.classList.add("offline");
  dot.title =
    status === "online" ? "en línea" : status === "connecting" ? "conectando…" : "sin conexión";
}

// ── invitar / salir ───────────────────────────────────────────────────────
function invite() {
  if (!cur) return;
  const link = buildInviteLink(cur.sala);
  openModal("invitar a " + cur.sala.nombre, (body) => {
    const p = document.createElement("p");
    p.textContent = "comparte este link por un canal de confianza. lleva la clave de la sala en el #, así que el servidor nunca la ve.";
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
    const warn = document.createElement("p");
    warn.className = "warn";
    warn.textContent = "⚠ cualquiera con el link puede leer la sala. trátalo como una llave.";
    body.append(p, row, ok, warn);
    setTimeout(() => input.select(), 50);
  });
}

async function leave() {
  if (!cur) return;
  const nombre = cur.sala.nombre;
  if (!confirm(`¿salir de "${nombre}"? se borra de este dispositivo (el historial cifrado sigue en el servidor).`)) {
    return;
  }
  const id = cur.sala.id;
  await close();
  await db.deleteSala(id);
  nav.onLeft();
}
