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

// ── identidad por clave (ECDH P-256) para DMs derivados al vuelo ─────────────
// Cada dispositivo tiene un par de claves. La pública viaja (como metadato, no
// secreto); con ella y mi privada derivo, vía ECDH, la MISMA clave de sala 1:1
// que el otro deriva por su lado — sin intercambiar ningún secreto por la red.
// Es el núcleo de la fase 4 (identidad soberana), adelantado para el patio.

export async function genIdentityKeys() {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pubRaw = b64u(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
  const privJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { pubRaw, privJwk };
}

async function importPriv(jwk) {
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}
async function importPubRaw(raw) {
  return crypto.subtle.importKey("raw", b64uDec(raw), { name: "ECDH", namedCurve: "P-256" }, false, []);
}

// Deriva la sala 1:1 (id + clave) entre mi par y la pública del otro. Determinista
// y simétrica: ambos llegan al mismo id y la misma clave.
export async function deriveDM(privJwk, myPubRaw, theirPubRaw) {
  const priv = await importPriv(privJwk);
  const theirPub = await importPubRaw(theirPubRaw);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: theirPub }, priv, 256));
  // clave AES por HKDF del secreto ECDH
  const hk = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  const aesRaw = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: te.encode("pspsps-dm-v1") }, hk, 256),
  );
  const keyB64 = b64u(aesRaw);
  // id determinista: hash de las dos públicas ordenadas (igual en ambos lados)
  const [a, b] = myPubRaw < theirPubRaw ? [myPubRaw, theirPubRaw] : [theirPubRaw, myPubRaw];
  const idHash = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode("pspsps-dm|" + a + "|" + b)));
  return { id: "dm-" + b64u(idHash).slice(0, 22), keyB64 };
}
