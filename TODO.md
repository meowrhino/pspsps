# TODO · pspsps

Backlog vivo. Las **fases** están en [`ROADMAP.md`](./ROADMAP.md); aquí va lo transversal
(verificaciones, features encoladas y dirección de diseño). Marca `[x]` al hacer.

---

## 🔜 necesita un móvil real (no verificable desde el escritorio)
- [ ] **Probar Web Push** en iPhone (iOS 16.4+): instalar la PWA *antes* de activar avisos,
      escribir desde otro dispositivo con la app cerrada, ver que llega la notificación.
- [ ] **Probar el patio con dos personas reales**: ver los gatos moverse en vivo y que
      clicar a alguien abre su DM cifrado.
- [ ] **Instalar la PWA** ("Añadir a pantalla de inicio") en iOS y Android y confirmar que
      abre en modo standalone y carga offline.

## 🚪 features encoladas (acordadas, sin construir)
- [ ] **"Compartir mi contacto"**: un link (como el de invitación) con tu alias + clave
      pública, para añadir a alguien con quien aún no has coincidido en la plaza/patio.
      Cierra el caso "quiero hablar con X pero no nos hemos cruzado".
- [ ] **"Llamar a la puerta" (toctoc)**: clicar un gato no abre el DM directo, sino un
      *toctoc* deliberado ("toco a tu puerta porque…"); el otro lo ve y, si acepta, se abre
      el 1:1. Cambia el gesto de tap-instantáneo a algo recíproco y con intención.

## 🎨 dirección: salir del imaginario "Grindr" (de la lluvia de ideas)
> **Diagnóstico:** el verbo central "tocar a una persona → chat privado 1:1" evoca apps de
> ligue. La salida: el patio como **lugar que se habita** (no catálogo de gente) + cambiar
> el **gesto**. (La identidad por gato + clave ya evita el "lío de 1 anon".)

- [ ] **Lugares con nombre** en el patio (entrada · fuego · rincón · mesa): tu gato se
      *sienta* en una zona; la charla brota de "estar en el fuego juntos", no de seleccionar.
- [ ] **Gatos vivos**: idle animado (parpadeo, orejas, rascarse) + **rastros** que se
      desvanecen al caminar → criaturas que habitan, no perfiles. (todo cliente, barato)
- [ ] **Dejar recados/objetos en el suelo**: el gesto pasa a "dejo algo *para el colectivo*"
      (una nota, un dibujo, un regalo); respondes a la cosa, no tocas a la persona.
- [ ] **Ritmo ritual**: el patio o los lugares "se despiertan" a horas ("el fuego a las 21h",
      "café de los martes") → mata el always-on de disponibilidad.
- [ ] *(radical)* **DM como buzón asíncrono** en vez de chat de disponibilidad.

## 🧹 mejoras de código (diferidas)
Detalle en [`ROADMAP.md`](./ROADMAP.md) → *"mejoras anotadas (revisión profunda)"*. Resumen:
índices SQL (`subs(name)`, `mensajes(sala,pendiente)`), poda de `profiles`/`subs` por
`last_seen`, apodo anónimo a 6 caracteres, limpiar listeners de `alerts`/`modal`, domain
separation en el HKDF de `deriveDM`.

## 🗺️ fases pendientes
En [`ROADMAP.md`](./ROADMAP.md): **fase 3** (cifrado fuerte NIP-44), **fase 4 resto**
(backup/export de la clave privada entre dispositivos, frase mnemónica), **fase 5**
(presencia "escribiendo…", sonidos, transferencia de ficheros, recordar posición/tamaño de
las ventanas, escenografía del patio).

---

## ✅ hecho (a junio 2026) — para contexto
Fases 0–2 · cifrado zero-knowledge (AES-GCM por sala) · Web Push (VAPID + aes128gcm hechos a
mano) · pseudo-escritorio de ventanas · tema "XP cálido" conmutable · editor de gato (avatar)
· patio caminable + DMs E2E por ECDH · agenda de contactos · anónimo-hasta-ponerte-nombre ·
ronda de limpieza/rendimiento de la revisión profunda.

**Live:** https://pspsps.meowrhino.studio · **Repo:** https://github.com/meowrhino/pspsps
