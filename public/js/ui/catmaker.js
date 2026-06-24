// catmaker.js — el editor de tu gato, como ventana. Preview en vivo + chips de
// rasgos + color. Guarda en vivo (cada cambio actualiza tu avatar en todas
// partes vía el evento "identity-changed").
import * as wm from "../wm.js";
import { CAT_OPTIONS, CAT_SWATCHES, catSvg, randomCatTraits, DEFAULT_CAT } from "../cat.js";
import { me, updateCat } from "../identity.js";

const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };

export function openCatMaker() {
  wm.openWindow({ id: "catmaker", title: "tu minino", icon: "🐱", build: buildEditor });
}

function buildEditor(body) {
  body.classList.add("catmaker");
  let cat = { ...DEFAULT_CAT, ...(me()?.cat || {}) };

  const preview = el("div", "cat-preview");
  const controls = el("div", "cat-controls");
  body.append(preview, controls);

  const paint = () => { preview.innerHTML = catSvg(cat); };
  const commit = async () => {
    paint();
    await updateCat(cat);
    document.dispatchEvent(new CustomEvent("identity-changed"));
  };

  // ── color ──
  const colorLabel = el("div", "cm-label");
  colorLabel.textContent = "color";
  const colorRow = el("div", "cm-swatches");
  const colorInput = el("input");
  colorInput.type = "color";
  colorInput.className = "swatch swatch-lg";
  colorInput.value = cat.color;
  colorInput.addEventListener("input", () => { cat = { ...cat, color: colorInput.value }; markSwatches(); commit(); });
  colorRow.appendChild(colorInput);
  const swatchEls = [];
  for (const c of CAT_SWATCHES) {
    const b = el("button", "cm-swatch");
    b.type = "button";
    b.style.background = c;
    b.dataset.color = c;
    b.addEventListener("click", () => { cat = { ...cat, color: c }; colorInput.value = c; markSwatches(); commit(); });
    swatchEls.push(b);
    colorRow.appendChild(b);
  }
  const markSwatches = () => swatchEls.forEach((b) => b.classList.toggle("active", b.dataset.color.toLowerCase() === cat.color.toLowerCase()));
  controls.append(colorLabel, colorRow);

  // ── rasgos (chips) ──
  const TRAIT_LABEL = { eyes: "ojos", mouth: "boca", cheeks: "mejillas", headTop: "cabeza", headwear: "sombrero" };
  const chipBoxes = {};
  for (const trait of Object.keys(CAT_OPTIONS)) {
    const label = el("div", "cm-label");
    label.textContent = TRAIT_LABEL[trait] || trait;
    const box = el("div", "cm-chips");
    chipBoxes[trait] = box;
    for (const [id, lbl] of CAT_OPTIONS[trait]) {
      const chip = el("button", "cm-chip");
      chip.type = "button";
      chip.textContent = lbl;
      chip.dataset.value = id;
      chip.addEventListener("click", () => { cat = { ...cat, [trait]: id }; markChips(trait); commit(); });
      box.appendChild(chip);
    }
    controls.append(label, box);
  }
  const markChips = (trait) => [...chipBoxes[trait].children].forEach((c) => c.classList.toggle("active", c.dataset.value === cat[trait]));
  const markAll = () => { markSwatches(); for (const t of Object.keys(chipBoxes)) markChips(t); };

  // ── acciones ──
  const actions = el("div", "cm-actions");
  const reroll = el("button", "ghost");
  reroll.type = "button";
  reroll.textContent = "🎲 al azar";
  reroll.addEventListener("click", () => { cat = randomCatTraits(); colorInput.value = cat.color; markAll(); commit(); });
  const done = el("button");
  done.type = "button";
  done.textContent = "listo";
  done.addEventListener("click", () => wm.closeWindow("catmaker"));
  actions.append(reroll, done);
  controls.append(actions);

  paint();
  markAll();
}
