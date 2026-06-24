import { DurableObject } from "cloudflare:workers";
import { sendPush } from "./push.js";

// No reavisar por push a la misma persona más de una vez cada PUSH_THROTTLE ms
// (una sala animada no debe disparar un push por cada mensaje).
const PUSH_THROTTLE = 25000;

// ── RoomDO — el MOTOR (una instancia por sala) ──────────────────────────────
//
// Portado del ConversationDO de rumrum y adaptado a pspsps:
//   · zero-knowledge: la columna `blob` es OPACA. El cliente cifra antes de
//     enviar y descifra al recibir; el servidor NUNCA ve texto plano.
//   · idempotencia: cada mensaje trae un `id` (uuid de cliente). INSERT OR
//     IGNORE evita duplicados al reenviar desde la cola offline.
//   · backfill por cursor: el cliente llega con `?since=<seq>` y el DO le manda
//     todo lo que se perdió (no solo los últimos N) → mensajes offline llegan.
//
// Realtime vía WebSocket Hibernation API (`acceptWebSocket`, NO `ws.accept()`):
// el DO se desaloja de memoria cuando no hay actividad aunque los clientes
// sigan conectados, así no se acumulan cargos de Duration mientras está idle.

// Tope de mensajes por sala (ring buffer): al pasarlo se borran los más viejos.
// Acota el storage del DO (y su coste). Generoso para que el backfill offline de
// un colectivo pequeño nunca pierda nada en la práctica.
const MAX_MESSAGES = 10000;

// Cuánto historial soltamos de golpe a quien hace backfill (si va MUY atrasado,
// recibe el tramo más antiguo que le falta y al reconectar pide el resto).
const BACKFILL_LIMIT = 1000;

// Snapshot inicial para un cliente nuevo (sin cursor): últimos N.
const RECENT_LIMIT = 50;

// Tamaño máximo del blob cifrado (caracteres). ~8 KB de ciphertext sobra para un
// mensaje de texto; corta payloads abusivos sin saber qué contienen.
const MAX_BLOB = 8000;

// Tope de conexiones simultáneas por sala (defensa anti-flood; un colectivo
// pequeño nunca lo roza). Cloudflare aguanta cientos de WS por DO.
const MAX_CONNECTIONS = 400;

// base64url válido: lo que produce crypto.js. Descarta blobs con basura sin
// tener que entenderlos (siguen siendo opacos para el servidor).
const B64URL = /^[A-Za-z0-9_-]+$/;

// Rate-limit por IP (token bucket): ráfaga de hasta RL_BURST, reponiendo
// RL_REFILL_PER_SEC por segundo.
const RL_BURST = 20;
const RL_REFILL_PER_SEC = 2;

// Color admitido = hex (#rgb / #rrggbb) o hsl(h, s%, l%). Validar en el servidor
// evita difundir algo que el cliente meta luego en un `style` y cuele CSS.
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const HSL = /^hsl\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*\)$/i;
function cleanColor(c) {
  if (typeof c !== "string") return null;
  const s = c.trim();
  if (s.length > 30) return null;
  return HEX.test(s) || HSL.test(s) ? s : null;
}

// Color por defecto determinista (mismo algoritmo y formato hex que el cliente
// en util.js) para quien aún no ha elegido uno.
function defaultColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return hslToHex(h, 55, 70);
}
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export class RoomDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Token bucket por IP, en memoria (se reinicia con la hibernación; basta
    // para frenar una ráfaga, que de todos modos mantiene el DO despierto).
    this.buckets = new Map();

    ctx.blockConcurrencyWhile(async () => {
      const sql = this.ctx.storage.sql;
      // `blob`: payload CIFRADO; el servidor no lo entiende. `id`: uuid de
      // cliente para idempotencia. `seq`: orden monotónico + cursor de backfill.
      sql.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          seq    INTEGER PRIMARY KEY AUTOINCREMENT,
          id     TEXT    UNIQUE,
          author TEXT    NOT NULL,
          ts     INTEGER NOT NULL,
          blob   TEXT    NOT NULL,
          kind   TEXT    NOT NULL DEFAULT 'user'
        );
      `);
      // Perfiles por alias (metadatos de presentación, no secretos): color, el
      // gato (cat.js, codificado) y la clave pública ECDH (pk, para DMs del
      // patio). Se actualizan al conectar y con {type:"setprofile"}.
      sql.exec(`
        CREATE TABLE IF NOT EXISTS profiles (
          name  TEXT PRIMARY KEY,
          color TEXT NOT NULL,
          cat   TEXT,
          pk    TEXT
        );
      `);
      // Migración para salas que crearon `profiles` sin cat/pk.
      try { sql.exec("ALTER TABLE profiles ADD COLUMN cat TEXT"); } catch { /* existe */ }
      try { sql.exec("ALTER TABLE profiles ADD COLUMN pk TEXT"); } catch { /* existe */ }
      // Suscripciones Web Push de los miembros. Se rellena con {type:"sub"}; el DO
      // la usa para avisar a quien está sin WS activo. `lastPush` da el throttle.
      sql.exec(`
        CREATE TABLE IF NOT EXISTS subs (
          endpoint TEXT PRIMARY KEY,
          p256dh   TEXT NOT NULL,
          auth     TEXT NOT NULL,
          name     TEXT,
          lastPush INTEGER NOT NULL DEFAULT 0
        );
      `);
      // Migración para salas que crearon `subs` sin la columna lastPush.
      try {
        sql.exec("ALTER TABLE subs ADD COLUMN lastPush INTEGER NOT NULL DEFAULT 0");
      } catch {
        // ya existe
      }
      // Meta clave→valor (guardamos el id de sala para el payload del push).
      sql.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          k TEXT PRIMARY KEY,
          v TEXT NOT NULL
        );
      `);
    });
  }

  // El Worker enruta aquí el upgrade de WebSocket (ver src/index.js).
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    // Defensa anti-flood: una sala no acepta conexiones sin límite.
    if (this.ctx.getWebSockets().length >= MAX_CONNECTIONS) {
      return new Response("room full", { status: 429 });
    }

    const url = new URL(request.url);
    const name = (url.searchParams.get("name") || "anon").slice(0, 25) || "anon";
    const color = cleanColor(url.searchParams.get("color")) ?? defaultColor(name);
    const cat = (url.searchParams.get("cat") || "").slice(0, 80) || null;
    const pk = (url.searchParams.get("pk") || "").slice(0, 120) || null;
    const ip = request.headers.get("CF-Connecting-IP") || "local";
    // Cursor de backfill: el cliente manda el `seq` más alto que ya tiene en su
    // IndexedDB para esta sala. 0/ausente → le mandamos el snapshot reciente.
    const since = Math.max(0, parseInt(url.searchParams.get("since") || "0", 10) || 0);

    // Recuerda el id de sala (lo usa el payload del push) la primera vez.
    const room = url.searchParams.get("room");
    if (room) {
      this.ctx.storage.sql.exec(
        "INSERT INTO meta (k, v) VALUES ('roomId', ?) ON CONFLICT(k) DO NOTHING",
        room,
      );
    }

    // Registra/actualiza el perfil (color, gato, clave pública) de este alias.
    this.touchProfile(name, color, cat, pk);

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server); // hibernable
    // Estado que sobrevive a la hibernación, atado a la conexión (máx 16 KB).
    server.serializeAttachment({ name, color, ip, cat, pk });

    // Snapshot inicial: lo que el cliente se perdió + colores + quién está en
    // línea. Con `since` manda solo lo nuevo (catch-up offline); sin él, los
    // últimos N para arrancar una sala recién abierta.
    server.send(
      JSON.stringify({
        type: "history",
        messages: since > 0 ? this.since(since) : this.recent(RECENT_LIMIT),
        profiles: this.profiles(),
        online: this.onlineNames(),
        cursor: since,
        // seq más antiguo que el DO aún conserva: si el cursor del cliente cae por
        // debajo, hubo poda (ring buffer) y el cliente sabe que perdió un tramo.
        minSeq: this.minSeq(),
      }),
    );

    // Difunde el perfil de quien entra (color + gato + clave pública) y la
    // presencia actualizada, para que todos lo pinten al instante.
    const row = this.ctx.storage.sql
      .exec("SELECT color, cat, pk FROM profiles WHERE name = ?", name)
      .toArray()[0];
    this.broadcast(
      JSON.stringify({ type: "profile", name, color: row?.color ?? color, cat: row?.cat ?? "", pk: row?.pk ?? "" }),
    );
    this.broadcastPresence();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string") return;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const att = ws.deserializeAttachment();
    const name = att?.name ?? "anon";
    const ip = att?.ip ?? "local";

    // Movimiento en el patio: efímero (NO se guarda) y muy frecuente → se reenvía
    // a los demás sin pasar por el rate-limit de mensajes. Coordenadas 0..1.
    if (data.type === "move") {
      const x = Number(data.x), y = Number(data.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      this.broadcastExcept(
        ws,
        JSON.stringify({ type: "move", name, x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) }),
      );
      return;
    }

    // Rate-limit por IP: si va por encima del presupuesto, descartamos en
    // silencio (vale para mensajes, perfiles y suscripciones).
    if (!this.allow(ip)) return;

    // Cambio de perfil (color o gato): persiste y difunde para que todos
    // repinten a esta persona (nombre, gato, burbujas).
    if (data.type === "setprofile") {
      const color = cleanColor(data.color) || att?.color || defaultColor(name);
      const cat = typeof data.cat === "string" ? data.cat.slice(0, 80) : att?.cat ?? null;
      this.ctx.storage.sql.exec(
        `INSERT INTO profiles (name, color, cat) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET color = excluded.color, cat = COALESCE(excluded.cat, profiles.cat)`,
        name,
        color,
        cat,
      );
      ws.serializeAttachment({ ...att, color, cat });
      const row = this.ctx.storage.sql
        .exec("SELECT color, cat, pk FROM profiles WHERE name = ?", name)
        .toArray()[0];
      this.broadcast(JSON.stringify({ type: "profile", name, color: row?.color ?? color, cat: row?.cat ?? "", pk: row?.pk ?? "" }));
      return;
    }

    // Registro de suscripción Web Push (fase 2). El DO la guarda para avisar a
    // este miembro cuando reciba un mensaje y no tenga WS activo.
    if (data.type === "sub") {
      const { endpoint, p256dh, auth } = data;
      if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
        return;
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO subs (endpoint, p256dh, auth, name) VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, name = excluded.name`,
        endpoint,
        p256dh,
        auth,
        name,
      );
      return;
    }

    // Mensaje nuevo. El cliente trae: id (uuid), ts (de composición, para que el
    // orden respete lo escrito offline) y blob (CIFRADO). El autor lo ponemos
    // nosotros desde el attachment (no se confía en el payload).
    if (data.type !== "msg") return;
    const id = typeof data.id === "string" ? data.id.slice(0, 64) : null;
    const blob = typeof data.blob === "string" ? data.blob : null;
    if (!id || !blob || blob.length > MAX_BLOB || !B64URL.test(blob)) return;
    // ts = hora de composición del cliente (respeta el orden de lo escrito
    // offline), pero nunca en el futuro: así nadie clava su mensaje arriba para
    // siempre. Un valor inválido o futuro cae a "ahora".
    const now = Date.now();
    const ts = Number.isFinite(data.ts) && data.ts > 0 && data.ts <= now + 5000 ? data.ts : now;

    this.append(id, name, ts, blob);
  }

  async webSocketClose(ws, code, reason) {
    try {
      ws.close(code, reason);
    } catch {
      // ya cerrado
    }
    // La presencia se actualiza al instante (sin gracia: en un messenger la
    // lista de "en línea" debe reflejar la realidad ya).
    this.broadcastPresence(ws);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  // Inserta un mensaje (idempotente por id) y lo reparte a los conectados.
  append(id, author, ts, blob) {
    const rows = this.ctx.storage.sql
      .exec(
        "INSERT OR IGNORE INTO messages (id, author, ts, blob, kind) VALUES (?, ?, ?, ?, 'user') RETURNING seq",
        id,
        author,
        ts,
        blob,
      )
      .toArray();

    // Duplicado (mismo id ya guardado): reenvía SOLO al emisor su eco con el seq
    // existente (confirma su envío) pero no re-difunde a la sala.
    if (rows.length === 0) {
      const existing = this.ctx.storage.sql
        .exec("SELECT seq FROM messages WHERE id = ?", id)
        .toArray();
      const seq = existing[0]?.seq;
      if (seq != null) this.echoTo(author, { type: "msg", seq, id, author, ts, blob, kind: "user" });
      return;
    }

    const seq = rows[0].seq;
    // Ring buffer: conserva solo los últimos MAX_MESSAGES.
    this.ctx.storage.sql.exec("DELETE FROM messages WHERE seq <= ?", seq - MAX_MESSAGES);
    this.broadcast(JSON.stringify({ type: "msg", seq, id, author, ts, blob, kind: "user" }));

    // Avisa por Web Push a los miembros suscritos sin WS activo (en segundo
    // plano: no bloquea la difusión, pero waitUntil garantiza que termina).
    this.ctx.waitUntil(this.notifyOffline());
  }

  // Dispara Web Push a cada suscripción cuyo dueño no está conectado ahora mismo.
  async notifyOffline() {
    if (!this.env.VAPID_PRIVATE) return; // push no configurado → nada que hacer
    const online = new Set(this.onlineNames());
    const now = Date.now();
    const roomId =
      this.ctx.storage.sql.exec("SELECT v FROM meta WHERE k = 'roomId'").toArray()[0]?.v || "";
    const subs = this.ctx.storage.sql
      .exec("SELECT endpoint, p256dh, auth, name, lastPush FROM subs")
      .toArray();
    for (const s of subs) {
      if (s.name && online.has(s.name)) continue; // está en la sala, ya lo ve
      if (s.lastPush && now - s.lastPush < PUSH_THROTTLE) continue; // throttle
      // marca antes de enviar para que mensajes en ráfaga no dupliquen el push
      this.ctx.storage.sql.exec("UPDATE subs SET lastPush = ? WHERE endpoint = ?", now, s.endpoint);
      try {
        const status = await sendPush(this.env, s, { sala: roomId });
        // suscripción caducada/baja → bórrala para no reintentar
        if (status === 404 || status === 410) {
          this.ctx.storage.sql.exec("DELETE FROM subs WHERE endpoint = ?", s.endpoint);
        }
      } catch {
        /* fallo de red puntual; se reintentará en el próximo mensaje */
      }
    }
  }

  // Manda un objeto solo a los sockets cuyo alias coincide (el emisor).
  echoTo(name, obj) {
    const blob = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (att?.name === name) {
        try {
          ws.send(blob);
        } catch {
          /* peer muerto */
        }
      }
    }
  }

  onlineNames(exclude) {
    const set = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      const att = ws.deserializeAttachment();
      if (att?.name) set.add(att.name);
    }
    return [...set];
  }

  broadcastPresence(exclude) {
    this.broadcast(JSON.stringify({ type: "presence", online: this.onlineNames(exclude) }));
  }

  // Registra/actualiza el perfil al conectar: color y gato siguen lo actual; la
  // clave pública (pk) se conserva si ya la teníamos (COALESCE no la pisa con "").
  touchProfile(name, color, cat, pk) {
    this.ctx.storage.sql.exec(
      `INSERT INTO profiles (name, color, cat, pk) VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         color = excluded.color,
         cat = COALESCE(excluded.cat, profiles.cat),
         pk  = COALESCE(excluded.pk, profiles.pk)`,
      name,
      color,
      cat || null,
      pk || null,
    );
  }

  allow(ip) {
    const now = Date.now();
    let b = this.buckets.get(ip);
    if (!b) {
      b = { tokens: RL_BURST, last: now };
      this.buckets.set(ip, b);
    }
    b.tokens = Math.min(RL_BURST, b.tokens + ((now - b.last) / 1000) * RL_REFILL_PER_SEC);
    b.last = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  broadcast(blob) {
    for (const peer of this.ctx.getWebSockets()) {
      try {
        peer.send(blob);
      } catch {
        // peer muerto; el cierre lo limpia
      }
    }
  }

  broadcastExcept(self, blob) {
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === self) continue;
      try {
        peer.send(blob);
      } catch {
        // peer muerto
      }
    }
  }

  profiles() {
    const out = {};
    for (const p of this.ctx.storage.sql.exec("SELECT name, color, cat, pk FROM profiles").toArray()) {
      out[p.name] = { color: p.color, cat: p.cat || "", pk: p.pk || "" };
    }
    return out;
  }

  // Últimos `limit` mensajes en orden cronológico ascendente.
  recent(limit) {
    return this.ctx.storage.sql
      .exec(
        "SELECT seq, id, author, ts, blob, kind FROM messages ORDER BY seq DESC LIMIT ?",
        limit,
      )
      .toArray()
      .reverse();
  }

  // seq más antiguo que aún conservamos (0 si la sala está vacía).
  minSeq() {
    const r = this.ctx.storage.sql.exec("SELECT MIN(seq) AS m FROM messages").toArray();
    return r[0]?.m || 0;
  }

  // Todo lo posterior al cursor del cliente (catch-up offline), ascendente.
  since(seq) {
    return this.ctx.storage.sql
      .exec(
        "SELECT seq, id, author, ts, blob, kind FROM messages WHERE seq > ? ORDER BY seq ASC LIMIT ?",
        seq,
        BACKFILL_LIMIT,
      )
      .toArray();
  }
}
