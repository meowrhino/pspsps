// identity.js — shell de identidad ligera ("¿quién eres?"), heredado de toctoc
// pero SIN servidor de cuentas: el alias y el color viven en IndexedDB en este
// dispositivo. Fase 4 (roadmap): migrar a clave criptográfica portable.
import { $, colorFor } from "./util.js";
import * as db from "./db.js";

let _me = null; // { alias, color }

export function me() {
  return _me;
}

export async function loadIdentity() {
  const row = await db.getIdentity();
  _me = row ? { alias: row.alias, color: row.color } : null;
  return _me;
}

export async function updateColor(color) {
  if (!_me) return;
  _me.color = color;
  await db.setIdentity(_me.alias, color);
}

// Monta la pantalla de identidad y resuelve cuando la persona entra.
export function mountIdentityScreen(onDone) {
  const alias = $("#identity-alias");
  const color = $("#identity-color");
  const go = $("#identity-go");

  // color inicial: uno bonito y determinista para que el picker no salga negro
  color.value = colorFor(String(Math.floor(Math.random() * 1e6)));

  // el color por defecto sigue al alias mientras no lo toquen a mano
  let colorTouched = false;
  color.addEventListener("input", () => (colorTouched = true));
  alias.addEventListener("input", () => {
    if (!colorTouched && alias.value.trim()) color.value = colorFor(alias.value.trim());
  });

  async function enter() {
    const name = alias.value.trim();
    if (!name) {
      alias.focus();
      return;
    }
    await db.setIdentity(name, color.value);
    _me = { alias: name, color: color.value };
    onDone(_me);
  }

  go.addEventListener("click", enter);
  alias.addEventListener("keydown", (e) => {
    if (e.key === "Enter") enter();
  });

  setTimeout(() => alias.focus(), 50);
}
