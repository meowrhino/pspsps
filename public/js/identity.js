// identity.js — shell de identidad ligera ("¿quién eres?"), heredado de toctoc
// pero SIN servidor de cuentas: el alias, el color y TU GATO viven en IndexedDB
// en este dispositivo. El gato (cat.js) es tu avatar. Su color y el color del
// usuario son el mismo (tu color = el de tu gato).
import { $ } from "./util.js";
import * as db from "./db.js";
import { DEFAULT_CAT, catSvg, randomCatTraits } from "./cat.js";
import { genIdentityKeys } from "./crypto.js";

let _me = null; // { alias, anon, color, cat, keys:{pubRaw, privJwk} }

export function me() {
  return _me;
}

// Apodo estable derivado de la clave pública (para entrar SIN nombre). Así dos
// anónimos no son "el mismo anon": cada uno es su gato·xxxx, único y reconocible
// (y el gato lo distingue a la vista). rumrum (anónimo) ↔ toctoc (con nombre).
export function handleFor(pubRaw) {
  let h = 0;
  for (let i = 0; i < (pubRaw || "").length; i++) h = (h * 31 + pubRaw.charCodeAt(i)) >>> 0;
  return "gato·" + (h.toString(36) + "0000").slice(0, 4);
}

function normalize(row) {
  const cat = row.cat ? { ...DEFAULT_CAT, ...row.cat } : { ...DEFAULT_CAT, color: row.color || DEFAULT_CAT.color };
  return { alias: row.alias, anon: !!row.anon, color: cat.color, cat, keys: row.keys || null };
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
    await db.setIdentity(_me.alias, _me.color, _me.cat, _me.keys, _me.anon);
  }
  return _me;
}

export async function updateColor(color) {
  if (!_me) return;
  _me.color = color;
  _me.cat = { ..._me.cat, color };
  await db.setIdentity(_me.alias, color, _me.cat, _me.keys, _me.anon);
}

export async function updateCat(cat) {
  if (!_me) return;
  _me.cat = { ...DEFAULT_CAT, ...cat };
  _me.color = _me.cat.color;
  await db.setIdentity(_me.alias, _me.color, _me.cat, _me.keys, _me.anon);
}

// Te pones (o cambias) nombre → dejas de ser anónimo. El nombre se lee al
// conectar a cada sala, así que el llamador recarga la app para aplicarlo limpio
// en todas partes (en vez de plumbing frágil de renombrado en vivo).
export async function setAlias(alias) {
  if (!_me) return;
  _me.alias = (alias || "").trim() || _me.alias;
  _me.anon = false;
  await db.setIdentity(_me.alias, _me.color, _me.cat, _me.keys, false);
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
    const keys = await genIdentityKeys();
    const typed = alias.value.trim();
    const anon = !typed; // sin nombre → entras como gato anónimo (apodo de su clave)
    const name = typed || handleFor(keys.pubRaw);
    await db.setIdentity(name, cat.color, cat, keys, anon);
    _me = { alias: name, anon, color: cat.color, cat, keys };
    onDone(_me);
  }

  const go = $("#identity-go");
  const syncBtn = () => (go.textContent = alias.value.trim() ? "entrar" : "entrar como gato");
  alias.addEventListener("input", syncBtn);
  syncBtn();
  go.addEventListener("click", enter);
  alias.addEventListener("keydown", (e) => {
    if (e.key === "Enter") enter();
  });
  setTimeout(() => alias.focus(), 50);
}
