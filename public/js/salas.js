// salas.js — crear, invitar y unirse a salas. Una sala es un id ALEATORIO
// (token opaco, así nadie la "adivina") + una clave AES compartida. La clave
// viaja en el fragmento # del link de invitación: NUNCA llega al servidor.
import { b64u, enc, dec, uuid } from "./util.js";
import { genKey, exportKey } from "./crypto.js";
import * as db from "./db.js";

// id de sala impredecible (16 bytes aleatorios → b64url). Es el nombre con el
// que el Worker deriva el Durable Object (idFromName), así que quien no tenga el
// id ni siquiera puede conectarse a la sala.
function randomId() {
  return b64u(crypto.getRandomValues(new Uint8Array(16)));
}

// La PLAZA pública: una sala con id y clave CONOCIDOS (van en el código). Todos
// los que tienen la app la comparten → es pública. El servidor sigue moviendo
// solo blobs opacos (el cifrado es uniforme, aunque la clave sea pública). Va
// anclada en el escritorio: siempre abierta, no se puede cerrar ni borrar.
export const PLAZA = {
  id: "plaza-publica-pspsps",
  nombre: "plaza pública",
  keyB64: "xUUiQTkuSYvw7uJqajRh-b-UMqoSnCoxqg-BvgygAJw",
  publica: true,
  pinned: true,
};

// Asegura que la plaza esté en IndexedDB (sin pisar su cursor si ya existe).
export async function ensurePlaza() {
  const existing = await db.getSala(PLAZA.id);
  if (!existing) {
    await db.putSala({ ...PLAZA, ultimoSeq: 0, ultimoTexto: "", ultimoTs: 0, creada: Date.now() });
  }
  return db.getSala(PLAZA.id);
}

// Crea una sala nueva, genera su clave y la persiste localmente.
export async function createSala(nombre) {
  const key = await genKey();
  const keyB64 = await exportKey(key);
  const sala = {
    id: randomId(),
    nombre: (nombre || "sala").slice(0, 40),
    keyB64,
    ultimoSeq: 0,
    ultimoTexto: "",
    ultimoTs: 0,
    creada: Date.now(),
  };
  await db.putSala(sala);
  return sala;
}

// Link de invitación: la clave (k) y el nombre (n) van en el FRAGMENTO #, que
// los navegadores no envían al servidor. El id (s) identifica el Durable Object.
export function buildInviteLink(sala) {
  return (
    `${location.origin}/#/join?s=${enc(sala.id)}` +
    `&k=${enc(sala.keyB64)}` +
    `&n=${enc(sala.nombre)}`
  );
}

// Parsea una invitación desde un texto (link completo o solo el hash). Devuelve
// { s, k, n } o null si no es válida.
export function parseInvite(text) {
  if (!text) return null;
  let hash = text;
  const i = text.indexOf("#");
  if (i >= 0) hash = text.slice(i + 1); // tras la #
  // admite "#/join?..." o "/join?..." o "join?..."
  const q = hash.indexOf("?");
  if (q < 0) return null;
  const params = new URLSearchParams(hash.slice(q + 1));
  const s = params.get("s");
  const k = params.get("k");
  if (!s || !k) return null;
  return { s, k, n: params.get("n") ? dec(params.get("n")) : "sala" };
}

// Une (o recupera) una sala a partir de una invitación. Si ya la tenemos, no la
// pisa (conserva su cursor y nombre local).
export async function joinSala({ s, k, n }) {
  const existing = await db.getSala(s);
  if (existing) return existing;
  const sala = {
    id: s,
    nombre: (n || "sala").slice(0, 40),
    keyB64: k,
    ultimoSeq: 0,
    ultimoTexto: "",
    ultimoTs: 0,
    creada: Date.now(),
  };
  await db.putSala(sala);
  return sala;
}

export { uuid };
