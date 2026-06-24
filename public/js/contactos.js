// contactos.js — la agenda local (el "shell de contactos" de toctoc, adaptado a
// zero-knowledge: no hay directorio en el servidor, así que la agenda se llena
// SOLA con la gente con la que coincides — en la plaza, el patio o cualquier
// sala. Guardamos su alias + gato + clave pública (pk), que ya viajan por el WS.
// Con la pk puedes derivar un DM cifrado (ECDH) y abrir su chat.
import * as db from "./db.js";
import { me } from "./identity.js";

// Apunta (o actualiza) a alguien que acabas de ver. `cat` es el gato codificado.
export async function note(alias, cat, pk) {
  const my = me();
  if (!pk || !my || pk === my.keys?.pubRaw) return; // sin clave o soy yo → nada
  const existing = await db.getContacto(pk);
  const changed = !existing || existing.alias !== alias || (cat && existing.cat !== cat);
  await db.putContacto({ pk, alias, cat: cat || existing?.cat || "", lastSeen: Date.now() });
  if (changed) document.dispatchEvent(new CustomEvent("contactos-changed"));
}

export function list() {
  return db.listContactos();
}
