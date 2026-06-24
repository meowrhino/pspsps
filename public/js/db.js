// db.js — persistencia local-first en IndexedDB (NO localStorage para histórico).
//
// El histórico vive en el dispositivo, descifrado. El servidor es solo un buzón
// sincronizador de blobs cifrados. Al reconectar, el cliente pide al DO "lo que
// hay después de mi último seq" y rellena lo que falte.
//
// object stores:
//   salas      { id, nombre, keyB64, ultimoSeq, ultimoTexto, ultimoTs, creada }
//   mensajes   { id(uuid), sala, autor, ts, seq, texto, mio, pendiente }
//   identidad  { id:"me", alias, color }
//   pushSub    { id:"me", endpoint, p256dh, auth }   (fase 2)

const DB_NAME = "pspsps";
const DB_VERSION = 1;

let _db = null;

export function init() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("salas")) {
        db.createObjectStore("salas", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("mensajes")) {
        const s = db.createObjectStore("mensajes", { keyPath: "id" });
        s.createIndex("sala", "sala", { unique: false });
      }
      if (!db.objectStoreNames.contains("identidad")) {
        db.createObjectStore("identidad", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("pushSub")) {
        db.createObjectStore("pushSub", { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

// Envuelve una transacción en una promesa (resuelve cuando la tx COMPLETA, así
// las escrituras están realmente persistidas antes de seguir).
function tx(stores, mode, fn) {
  return init().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(stores, mode);
        let result;
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
        result = fn(t);
      }),
  );
}

const done = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

// ── identidad ───────────────────────────────────────────────────────────────
export async function getIdentity() {
  return tx("identidad", "readonly", (t) => done(t.objectStore("identidad").get("me"))).then(
    (r) => r || null,
  );
}
export async function setIdentity(alias, color, cat, keys) {
  return tx("identidad", "readwrite", (t) =>
    t.objectStore("identidad").put({ id: "me", alias, color, cat, keys }),
  );
}

// ── salas ───────────────────────────────────────────────────────────────────
export async function listSalas() {
  const salas = await tx("salas", "readonly", (t) => done(t.objectStore("salas").getAll()));
  // más reciente primero (por último mensaje o, si no hay, por creación)
  return salas.sort((a, b) => (b.ultimoTs || b.creada || 0) - (a.ultimoTs || a.creada || 0));
}
export async function getSala(id) {
  return tx("salas", "readonly", (t) => done(t.objectStore("salas").get(id))).then((r) => r || null);
}
export async function putSala(sala) {
  return tx("salas", "readwrite", (t) => t.objectStore("salas").put(sala));
}
export async function deleteSala(id) {
  return tx(["salas", "mensajes"], "readwrite", (t) => {
    t.objectStore("salas").delete(id);
    // borra también sus mensajes
    const idx = t.objectStore("mensajes").index("sala");
    const cur = idx.openCursor(IDBKeyRange.only(id));
    cur.onsuccess = (e) => {
      const c = e.target.result;
      if (c) {
        c.delete();
        c.continue();
      }
    };
  });
}

// ── mensajes ────────────────────────────────────────────────────────────────
export async function getMessages(sala) {
  const msgs = await tx("mensajes", "readonly", (t) =>
    done(t.objectStore("mensajes").index("sala").getAll(IDBKeyRange.only(sala))),
  );
  // orden cronológico por ts (los compuestos offline caen en su hora real);
  // desempate por id para estabilidad.
  return msgs.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
}

// Inserta o actualiza un mensaje (idempotente por id). Devuelve true si era nuevo.
export async function putMessage(msg) {
  const existing = await tx("mensajes", "readonly", (t) =>
    done(t.objectStore("mensajes").get(msg.id)),
  );
  await tx("mensajes", "readwrite", (t) =>
    t.objectStore("mensajes").put({ ...(existing || {}), ...msg }),
  );
  return !existing;
}

// Cola de salida: mensajes míos aún sin confirmar por el servidor (compuestos
// offline o en vuelo). Se reenvían al reconectar.
export async function getPending(sala) {
  const all = await getMessages(sala);
  return all.filter((m) => m.pendiente);
}
export async function getAllPending() {
  const all = await tx("mensajes", "readonly", (t) => done(t.objectStore("mensajes").getAll()));
  return all.filter((m) => m.pendiente);
}

// ── push (fase 2) ───────────────────────────────────────────────────────────
export async function getPushSub() {
  return tx("pushSub", "readonly", (t) => done(t.objectStore("pushSub").get("me"))).then(
    (r) => r || null,
  );
}
export async function setPushSub(sub) {
  return tx("pushSub", "readwrite", (t) => t.objectStore("pushSub").put({ id: "me", ...sub }));
}
