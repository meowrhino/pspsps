// modal.js — modal reutilizable (invitar / unirse). Minúsculo, sin librerías.
import { $, el } from "../util.js";

// Campo de link de invitación con botón de copiar (compartido por la sala y el
// lanzador). Devuelve { row, ok, input } para componer dentro de una modal.
export function inviteLinkField(link) {
  const row = el("div", "invite-link");
  const input = el("input");
  input.type = "text";
  input.readOnly = true;
  input.value = link;
  const copy = el("button");
  copy.type = "button";
  copy.textContent = "copiar";
  const ok = el("p", "copied hidden");
  ok.textContent = "✓ copiado";
  copy.addEventListener("click", async () => {
    input.select();
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      document.execCommand("copy");
    }
    ok.classList.remove("hidden");
  });
  row.append(input, copy);
  return { row, ok, input };
}

const root = () => $("#modal");

export function openModal(title, build) {
  const m = root();
  $("#modal-title").textContent = title;
  const body = $("#modal-body");
  body.innerHTML = "";
  build(body);
  m.classList.remove("hidden");
}

export function closeModal() {
  root().classList.add("hidden");
}

// cierre por botón ×, por click en el fondo y por Escape
addEventListener("DOMContentLoaded", () => {
  $("#modal-close").addEventListener("click", closeModal);
  root().addEventListener("click", (e) => {
    if (e.target === root()) closeModal();
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !root().classList.contains("hidden")) closeModal();
});
