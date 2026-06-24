// room.js — una sala como VENTANA. Ahora multi-instancia: cada sala abierta es
// una ventana con su propio WebSocket, su clave, su estado y su DOM. Pueden
// coexistir varias (la plaza + privadas) y todas reciben en vivo aunque estén
// minimizadas. El cifrado es transparente: entra/sale texto, por el cable van
// blobs.
import { hhmm, dayKey, dayLabel, linkifyInto, colorFor, uuid } from "../util.js";
import * as db from "../db.js";
import { importKey, encrypt, decrypt, deriveDM } from "../crypto.js";
import { connectRoom } from "../ws.js";
import * as alerts from "../alerts.js";
import { me } from "../identity.js";
import { openModal } from "./modal.js";
import { buildInviteLink } from "../salas.js";
import { currentSub } from "../push.js";
import { catSvg, encodeCat, decodeCat } from "../cat.js";
import * as contactos from "../contactos.js";
import * as wm from "../wm.js";

const openRooms = new Map(); // sala.id → controlador

// Abre (derivando si hace falta) el DM 1:1 con alguien, dada su clave pública.
// La sala y la clave se derivan por ECDH (deriveDM): el servidor solo ve blobs.
// Lo usan el patio (clic en un gato) y la agenda de contactos.
export async function openDMWith(alias, theirPk) {
  const my = me();
  if (!theirPk || !my?.keys) {
    alert(`${alias} todavía no tiene clave para chat cifrado (que coincida contigo en la plaza o el patio).`);
    return;
  }
  const { id, keyB64 } = await deriveDM(my.keys.privJwk, my.keys.pubRaw, theirPk);
  let sala = await db.getSala(id);
  if (!sala) {
    sala = { id, nombre: alias, keyB64, dm: true, ultimoSeq: 0, ultimoTexto: "", ultimoTs: 0, creada: Date.now() };
    await db.putSala(sala);
    document.dispatchEvent(new CustomEvent("salas-changed"));
  }
  openRoomWindow(sala);
}

// Reenvía el perfil actual (color + gato) a todas las salas abiertas. Lo llama
// app.js cuando cambias tu gato/color, para que el resto te repinte.
export function broadcastProfileAll() {
  for (const ctrl of openRooms.values()) ctrl.sendProfile();
}

// Abre (o enfoca) la ventana de una sala.
export function openRoomWindow(sala) {
  const winId = "room:" + sala.id;
  if (wm.isOpen(winId)) {
    wm.focusWindow(winId);
    return;
  }
  wm.openWindow({
    id: winId,
    title: sala.nombre,
    icon: sala.publica ? "🌐" : "🔒",
    pinned: !!sala.pinned,
    build: (body) => openRooms.set(sala.id, createRoom(sala, body)),
    onClose: () => {
      openRooms.get(sala.id)?.destroy();
      openRooms.delete(sala.id);
    },
  });
}

const el = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};

// ── un controlador de sala, atado a su `body` de ventana ────────────────────
function createRoom(sala, body) {
  const state = { key: null, conn: null, colors: {}, cats: {}, pubs: {}, online: [], msgs: [], rendered: new Map(), lastDay: null };
  const colorOf = (name) => state.colors[name] || colorFor(name);

  // DOM de la ventana
  const tools = el("div", "room-tools");
  const connDot = el("span", "conn-dot");
  const presence = el("span", "presence-inline");
  const spacer = el("span", "spacer");
  const inviteBtn = el("button", "iconbtn");
  inviteBtn.type = "button";
  inviteBtn.title = "invitar";
  inviteBtn.textContent = "🔗";
  tools.append(connDot, presence, spacer, inviteBtn);
  if (!sala.pinned) {
    const leaveBtn = el("button", "iconbtn");
    leaveBtn.type = "button";
    leaveBtn.title = "salir de la sala";
    leaveBtn.textContent = "⋯";
    leaveBtn.addEventListener("click", leave);
    tools.append(leaveBtn);
  }
  const messages = el("ul", "messages");
  const form = el("form", "composer");
  form.autocomplete = "off";
  const input = el("input", "body");
  input.type = "text";
  input.placeholder = sala.publica ? "pspsps… (sala pública)" : "pspsps…";
  input.maxLength = 2000;
  const sendBtn = el("button");
  sendBtn.type = "submit";
  sendBtn.textContent = "enviar";
  form.append(input, sendBtn);
  body.append(tools, messages, form);

  inviteBtn.addEventListener("click", invite);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    alerts.askNotifPermission();
    send(text);
    input.value = "";
    input.focus();
  });

  start();

  async function start() {
    state.key = await importKey(sala.keyB64);
    setConn("connecting");
    const local = await db.getMessages(sala.id);
    for (const m of local) {
      state.msgs.push(m);
      state.rendered.set(m.id, null);
    }
    renderAll();

    const m = me();
    state.conn = connectRoom({
      room: sala.id,
      name: m.alias,
      color: m.color,
      cat: encodeCat(m.cat),
      pk: m.keys?.pubRaw || "",
      getCursor: () => sala.ultimoSeq || 0,
      onStatus: setConn,
      onHistory: (messages, profiles, online, minSeq) => {
        mergeProfiles(profiles);
        state.online = online;
        const cursor = sala.ultimoSeq || 0;
        if (minSeq && cursor > 0 && minSeq > cursor + 1) {
          console.warn(`pspsps: hueco en "${sala.nombre}" (perdidos seq ${cursor + 1}–${minSeq - 1})`);
        }
        ingestBatch(messages);
        paintPresence();
      },
      onMessage: (sm) => ingestBatch([sm], { live: true }),
      onProfile: ({ name, color, cat, pk }) => {
        if (color) state.colors[name] = color;
        if (cat) state.cats[name] = decodeCat(cat);
        if (pk) {
          state.pubs[name] = pk;
          contactos.note(name, cat, pk);
        }
        repaintAuthor(name);
        paintPresence();
      },
      onPresence: (online) => {
        state.online = online;
        paintPresence();
      },
    });

    const sub = currentSub();
    if (sub) state.conn.sub(sub);

    for (const p of await db.getPending(sala.id)) {
      const blob = p.blob || (await encrypt(state.key, sala.id, { text: p.texto }));
      state.conn.send({ id: p.id, ts: p.ts, blob });
    }
    setTimeout(() => input.focus(), 40);
  }

  async function send(text) {
    const m = me();
    const id = uuid();
    const ts = Date.now();
    let blob;
    try {
      blob = await encrypt(state.key, sala.id, { text });
    } catch (e) {
      console.error("pspsps: no se pudo cifrar", e);
      return;
    }
    const msg = { id, sala: sala.id, autor: m.alias, ts, seq: null, texto: text, blob, mio: true, pendiente: true };
    try {
      await db.putMessage(msg);
    } catch (e) {
      console.error("pspsps: IndexedDB", e);
    }
    upsert(msg);
    bumpPreview(text, ts).catch(() => {});
    state.conn.send({ id, ts, blob });
  }

  async function ingestBatch(serverMsgs, { live } = {}) {
    let maxSeq = sala.ultimoSeq || 0;
    let lastText = null;
    let lastTs = 0;
    for (const sm of serverMsgs) {
      if (sm.kind && sm.kind !== "user") continue;
      const mine = sm.author === me().alias;
      let payload = null;
      try {
        payload = await decrypt(state.key, sala.id, sm.blob);
      } catch {
        /* clave incorrecta o blob manipulado */
      }
      const msg = { id: sm.id, sala: sala.id, autor: sm.author, ts: sm.ts, seq: sm.seq ?? null, mio: mine, pendiente: false };
      if (payload) msg.texto = payload.text;
      else if (!mine) {
        msg.texto = "(no se pudo descifrar)";
        msg.undecryptable = true;
      }
      await db.putMessage(msg);
      upsert({ ...(state.rendered.has(msg.id) ? findMsg(msg.id) : {}), ...msg });
      if (sm.seq && sm.seq > maxSeq) maxSeq = sm.seq;
      if (msg.texto && !msg.undecryptable) {
        lastText = msg.texto;
        lastTs = sm.ts;
      }
      if (live && !mine && payload) alerts.incoming(sm.author, payload.text);
    }
    if (maxSeq !== (sala.ultimoSeq || 0) || lastText) {
      sala.ultimoSeq = maxSeq;
      if (lastText) {
        sala.ultimoTexto = lastText;
        sala.ultimoTs = lastTs;
      }
      await db.putSala(sala);
    }
  }

  const findMsg = (id) => state.msgs.find((m) => m.id === id) || {};

  async function bumpPreview(text, ts) {
    sala.ultimoTexto = text;
    sala.ultimoTs = ts;
    await db.putSala(sala);
  }

  function upsert(msg) {
    const idx = state.msgs.findIndex((m) => m.id === msg.id);
    const li = state.rendered.get(msg.id);
    if (idx >= 0) state.msgs[idx] = { ...state.msgs[idx], ...msg };
    else {
      state.msgs.push(msg);
      state.msgs.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
    }
    if (li) updateBubble(li, state.msgs[idx]);
    else if (state.msgs[state.msgs.length - 1].id === msg.id) appendBubble(msg);
    else renderAll();
  }

  function renderAll() {
    messages.innerHTML = "";
    state.rendered = new Map();
    state.lastDay = null;
    for (const m of state.msgs) appendBubble(m, true);
    messages.scrollTop = messages.scrollHeight;
  }

  function appendBubble(msg, bulk = false) {
    const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 90;
    const key = dayKey(msg.ts);
    if (key !== state.lastDay) {
      state.lastDay = key;
      const sep = el("li", "daysep");
      const span = el("span");
      span.textContent = dayLabel(msg.ts);
      sep.appendChild(span);
      messages.appendChild(sep);
    }
    const li = buildBubble(msg);
    messages.appendChild(li);
    state.rendered.set(msg.id, li);
    if (!bulk && atBottom) messages.scrollTop = messages.scrollHeight;
  }

  function buildBubble(msg) {
    const li = el("li", "bubble " + (msg.mio ? "mine" : "theirs"));
    if (msg.pendiente) li.classList.add("pending");
    if (msg.undecryptable) li.classList.add("undecryptable");
    li.dataset.author = msg.autor;
    if (!msg.mio) {
      const head = el("span", "bubble-head");
      const mini = el("span", "mini-cat");
      const traits = state.cats[msg.autor];
      if (traits) mini.innerHTML = catSvg(traits);
      const author = el("span", "author");
      author.textContent = msg.autor;
      author.style.color = colorOf(msg.autor);
      head.append(mini, author);
      li.appendChild(head);
    }
    const text = el("span", "text");
    linkifyInto(text, msg.texto || "");
    li.appendChild(text);
    const meta = el("span", "meta-line");
    meta.textContent = hhmm(msg.ts) + (msg.pendiente ? " · enviando…" : "");
    li.appendChild(meta);
    return li;
  }

  function updateBubble(li, msg) {
    li.classList.toggle("pending", !!msg.pendiente);
    const meta = li.querySelector(".meta-line");
    if (meta) meta.textContent = hhmm(msg.ts) + (msg.pendiente ? " · enviando…" : "");
  }

  function mergeProfiles(profiles) {
    for (const [name, p] of Object.entries(profiles || {})) {
      if (!p) continue;
      if (p.color) state.colors[name] = p.color;
      if (p.cat) state.cats[name] = decodeCat(p.cat);
      if (p.pk) {
        state.pubs[name] = p.pk;
        contactos.note(name, p.cat, p.pk); // a la agenda local
      }
    }
  }

  // repinta el nombre (color) y el mini-gato del autor en sus burbujas ya pintadas
  function repaintAuthor(name) {
    const color = colorOf(name);
    const traits = state.cats[name];
    for (const li of messages.querySelectorAll(".bubble.theirs")) {
      if (li.dataset.author !== name) continue;
      const a = li.querySelector(".author");
      if (a) a.style.color = color;
      const mc = li.querySelector(".mini-cat");
      if (mc && traits) mc.innerHTML = catSvg(traits);
    }
  }

  function paintPresence() {
    presence.innerHTML = "";
    const online = state.online || [];
    if (!online.length) return;
    const label = el("span", "pres-count");
    label.textContent = online.length === 1 ? "1 en línea" : `${online.length} en línea`;
    presence.appendChild(label);
    for (const name of online) {
      const dot = el("span", "presence-dot");
      dot.style.background = colorOf(name);
      dot.title = name;
      presence.appendChild(dot);
    }
  }

  function setConn(status) {
    connDot.classList.remove("online", "connecting", "offline");
    connDot.classList.add(status === "online" ? "online" : status === "connecting" ? "connecting" : "offline");
    connDot.title = status === "online" ? "en línea" : status === "connecting" ? "conectando…" : "sin conexión";
  }

  function invite() {
    const link = buildInviteLink(sala);
    openModal("invitar a " + sala.nombre, (b) => {
      const p = el("p");
      p.textContent = sala.publica
        ? "la plaza es pública: cualquiera con la app entra. comparte la app, no hace falta clave."
        : "comparte este link por un canal de confianza. la clave va en el #, el servidor nunca la ve.";
      const row = el("div", "invite-link");
      const inp = el("input");
      inp.type = "text";
      inp.readOnly = true;
      inp.value = link;
      const copy = el("button");
      copy.textContent = "copiar";
      const ok = el("p", "copied hidden");
      ok.textContent = "✓ copiado";
      copy.addEventListener("click", async () => {
        inp.select();
        try {
          await navigator.clipboard.writeText(link);
        } catch {
          document.execCommand("copy");
        }
        ok.classList.remove("hidden");
      });
      row.append(inp, copy);
      b.append(p, row, ok);
      if (!sala.publica) {
        const warn = el("p", "warn");
        warn.textContent = "⚠ cualquiera con el link puede leer la sala. trátalo como una llave.";
        b.append(warn);
      }
      setTimeout(() => inp.select(), 50);
    });
  }

  async function leave() {
    if (!confirm(`¿salir de "${sala.nombre}"? se borra de este dispositivo (el historial cifrado sigue en el servidor).`)) {
      return;
    }
    destroy();
    await db.deleteSala(sala.id);
    openRooms.delete(sala.id);
    wm.closeWindow("room:" + sala.id);
    document.dispatchEvent(new CustomEvent("salas-changed"));
  }

  function destroy() {
    state.conn?.close();
  }

  return {
    destroy,
    sendProfile: () => state.conn?.setProfile({ color: me().color, cat: encodeCat(me().cat) }),
  };
}
