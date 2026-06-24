// crypto.js — capa zero-knowledge de pspsps (fase 0: AEAD con Web Crypto).
//
// Cada sala tiene UNA clave simétrica AES-GCM de 256 bits. El cliente cifra el
// texto ANTES de mandarlo por el WebSocket y lo descifra AL recibirlo; el Worker
// y el Durable Object solo mueven el `blob` opaco. La clave viaja entre miembros
// en el fragmento `#` de un link de invitación (nunca llega al servidor) y se
// guarda en IndexedDB en este dispositivo.
//
// Formato del blob (string b64url):  IV(12 bytes) || ciphertext+tag(16 bytes)
// AAD = "pspsps|v1|<salaId>"  → ata el cifrado a su sala y versión: un blob no
// se puede "replantar" en otra sala ni reinterpretar con otro esquema.
//
// Heredado del patrón de trackr (AES-GCM + AAD + b64url), sin el envoltorio de
// contraseña/Argon2id que aquí no hace falta: la clave de sala ya es aleatoria.
//
// Fase 3 (roadmap): migrar a NIP-44 (@noble) e identidad por clave secp256k1.

import { b64u, b64uDec } from "./util.js";

const IV_BYTES = 12;
const VERSION = "v1";
const te = new TextEncoder();
const td = new TextDecoder();

function aad(salaId) {
  return te.encode(`pspsps|${VERSION}|${salaId}`);
}

// Genera una clave nueva de sala (extraíble para poder ponerla en el link).
export async function genKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

// Serializa/deserializa la clave a b64url (lo que viaja en la invitación).
export async function exportKey(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return b64u(new Uint8Array(raw));
}
export async function importKey(b64) {
  const raw = b64uDec(b64);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

// Cifra un objeto/valor JSON → blob b64url. IV aleatorio NUEVO en cada llamada
// (reutilizar IV con la misma clave rompe AES-GCM).
export async function encrypt(key, salaId, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = te.encode(JSON.stringify(payload));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(salaId) },
    key,
    data,
  );
  const out = new Uint8Array(IV_BYTES + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), IV_BYTES);
  return b64u(out);
}

// Descifra un blob b64url → objeto. Lanza si la clave es incorrecta, el blob
// está manipulado, o el AAD (sala/versión) no coincide.
export async function decrypt(key, salaId, blob) {
  const bytes = b64uDec(blob);
  const iv = bytes.slice(0, IV_BYTES);
  const ct = bytes.slice(IV_BYTES);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad(salaId) },
    key,
    ct,
  );
  return JSON.parse(td.decode(plain));
}
