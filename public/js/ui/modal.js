// modal.js — modal reutilizable (invitar / unirse). Minúsculo, sin librerías.
import { $ } from "../util.js";

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
