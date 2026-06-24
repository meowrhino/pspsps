// identity.js — shell de identidad ligera ("¿quién eres?"), heredado de toctoc
// pero SIN servidor de cuentas: el alias, el color y TU GATO viven en IndexedDB
// en este dispositivo. El gato (cat.js) es tu avatar. Su color y el color del
// usuario son el mismo (tu color = el de tu gato).
import { $ } from "./util.js";
import * as db from "./db.js";
import { DEFAULT_CAT, catSvg, randomCatTraits } from "./cat.js";
import { genIdentityKeys } from "./crypto.js";

let _me = null; // { alias, color, cat, keys:{pubRaw, privJwk} }

export function me() {
  return _me;
}

function normalize(row) {
  const cat = row.cat ? { ...DEFAULT_CAT, ...row.cat } : { ...DEFAULT_CAT, color: row.color || DEFAULT_CAT.color };
  return { alias: row.alias, color: cat.color, cat, keys: row.keys || null };
}

export async function loadIdentity() {
  const row = await db.getIdentity();
  if (!row) {
    _me = null;
    return _me;
  }
  _me = normalize(row);
  // migración: identidades viejas sin par de claves → genéralo y persiste
  if (!_me.keys) {
    _me.keys = await genIdentityKeys();
    await db.setIdentity(_me.alias, _me.color, _me.cat, _me.keys);
  }
  return _me;
}

export async function updateColor(color) {
  if (!_me) return;
  _me.color = color;
  _me.cat = { ..._me.cat, color };
  await db.setIdentity(_me.alias, color, _me.cat, _me.keys);
}

export async function updateCat(cat) {
  if (!_me) return;
  _me.cat = { ...DEFAULT_CAT, ...cat };
  _me.color = _me.cat.color;
  await db.setIdentity(_me.alias, _me.color, _me.cat, _me.keys);
}

// Monta la pantalla de identidad (alias + gato editable básico) y resuelve al entrar.
export function mountIdentityScreen(onDone) {
  const alias = $("#identity-alias");
  const preview = $("#identity-cat");
  let cat = randomCatTraits();

  const paint = () => {
    if (preview) preview.innerHTML = catSvg(cat);
  };
  paint();

  // re-tirar los rasgos del gato (color incluido)
  $("#identity-reroll")?.addEventListener("click", () => {
    cat = randomCatTraits();
    paint();
  });
  // el color del picker tiñe el gato
  const color = $("#identity-color");
  if (color) {
    color.value = cat.color;
    color.addEventListener("input", () => {
      cat = { ...cat, color: color.value };
      paint();
    });
  }

  async function enter() {
    const name = alias.value.trim();
    if (!name) {
      alias.focus();
      return;
    }
    const keys = await genIdentityKeys();
    await db.setIdentity(name, cat.color, cat, keys);
    _me = { alias: name, color: cat.color, cat, keys };
    onDone(_me);
  }

  $("#identity-go").addEventListener("click", enter);
  alias.addEventListener("keydown", (e) => {
    if (e.key === "Enter") enter();
  });
  setTimeout(() => alias.focus(), 50);
}
