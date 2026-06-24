// make-vapid.mjs — genera un par de claves VAPID (ECDSA P-256) para Web Push.
// Ejecuta UNA vez: `node tools/make-vapid.mjs [ruta-salida.json]`.
//
// La PÚBLICA va como var en wrangler.toml (es pública: el cliente la usa como
// applicationServerKey). La PRIVADA y el subject van como secrets del Worker:
//   cat out.json | jq -r .private | npx wrangler secret put VAPID_PRIVATE
//   echo "mailto:tu@email" | npx wrangler secret put VAPID_SUBJECT
// No commitees la privada. Por defecto se escribe fuera del repo (/tmp).
import { writeFileSync } from "node:fs";

const b64u = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);

const pub = b64u(await crypto.subtle.exportKey("raw", publicKey)); // 65 bytes (0x04||x||y)
const priv = b64u(await crypto.subtle.exportKey("pkcs8", privateKey));

const out = process.argv[2] || "/tmp/pspsps-vapid.json";
writeFileSync(out, JSON.stringify({ public: pub, private: priv, subject: "mailto:hola@meowrhino.studio" }, null, 2));

console.log("VAPID_PUBLIC =", pub);
console.log("privada (pkcs8) y subject escritos en:", out);
