// push.js — Web Push (VAPID + RFC 8291 "aes128gcm") hecho a mano con Web Crypto.
// Sin dependencias. El servidor firma un JWT VAPID y cifra el payload para el
// endpoint de cada miembro desconectado; el push service (Apple/Mozilla/Google)
// lo entrega aunque la PWA esté cerrada.
//
// El payload va CIFRADO de extremo a extremo entre este Worker y el navegador del
// destinatario (ECDH con las claves de la suscripción), e incluye solo el id de
// sala — ningún texto de mensaje (que de todos modos el servidor no puede leer).

const TE = new TextEncoder();

function b64u(bytes) {
  let bin = "";
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uDec(str) {
  const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...arrs) {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

// HKDF-SHA256 → `len` bytes.
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    len * 8,
  );
  return new Uint8Array(bits);
}

// JWT VAPID firmado ES256 para el `audience` (origen del endpoint de push).
export async function vapidJWT(env, audience) {
  const header = b64u(TE.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64u(
    TE.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: env.VAPID_SUBJECT || "mailto:hola@meowrhino.studio",
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    b64uDec(env.VAPID_PRIVATE),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // Web Crypto firma ECDSA en formato IEEE-P1363 (r||s) = justo lo que pide JOSE.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, TE.encode(signingInput));
  return `${signingInput}.${b64u(new Uint8Array(sig))}`;
}

// RFC 8291: cifra `payload` (Uint8Array) para la suscripción (p256dh, auth b64url).
export async function encryptPayload(p256dhB64, authB64, payload) {
  const uaPublic = b64uDec(p256dhB64); // clave pública del navegador (65 bytes)
  const authSecret = b64uDec(authB64); // secreto de auth (16 bytes)

  // par efímero del servidor para este push
  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey)); // 65 bytes
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256),
  );

  // IKM = HKDF(salt=auth, ikm=ecdh, info="WebPush: info\0" || ua || as)
  const keyInfo = concat(TE.encode("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(
    salt,
    ikm,
    concat(TE.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])),
    16,
  );
  const nonce = await hkdf(
    salt,
    ikm,
    concat(TE.encode("Content-Encoding: nonce"), new Uint8Array([0])),
    12,
  );

  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  // registro RFC 8188: payload || 0x02 (delimitador de último registro)
  const record = concat(payload, new Uint8Array([2]));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, record));

  // cabecera aes128gcm: salt(16) || rs(4, big-endian = 4096) || idlen(1)=65 || as_public(65)
  const header = concat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([asPublic.length]), asPublic);
  return concat(header, ct);
}

// Envía un push a una suscripción. Devuelve el status HTTP (404/410 = caducada).
export async function sendPush(env, sub, payloadObj) {
  if (!env.VAPID_PRIVATE || !env.VAPID_PUBLIC) return 0; // push no configurado
  const audience = new URL(sub.endpoint).origin;
  const jwt = await vapidJWT(env, audience);
  const body = await encryptPayload(sub.p256dh, sub.auth, TE.encode(JSON.stringify(payloadObj)));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      TTL: "86400",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`,
    },
    body,
  });
  return res.status;
}
