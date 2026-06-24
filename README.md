# pspsps 🐱

> mensajería cifrada para colectivos pequeños. small web, sin plataforma, sin frameworks.
>
> **[pspsps.meowrhino.studio](https://pspsps.meowrhino.studio)**

Una PWA de chat instalable para un círculo pequeño de personas. Bonita, soberana,
ligera y offline-capable, hecha a mano y **sin dependencias de plataforma** (nada de
Firebase, nada de SDKs propietarios). Fusiona el motor de salas de
[`rumrum`](https://github.com/meowrhino/rumrum) con el shell de identidad de
[`toctoc`](https://github.com/meowrhino/toctoc) y el patrón zero-knowledge de `trackr`.

## qué la hace distinta

- **Zero-knowledge de verdad.** Cada sala tiene una clave AES-GCM propia. El texto se
  cifra **en tu dispositivo** antes de salir; el servidor solo mueve cápsulas opacas que
  no puede leer. La clave viaja en el `#` del link de invitación → nunca llega al servidor.
- **Local-first.** El histórico (ya descifrado) vive en **IndexedDB** en tu dispositivo.
  El servidor es un buzón sincronizador, no la fuente única de verdad.
- **Offline real.** Si te escriben mientras estás desconectado, el mensaje espera en el
  Durable Object y te llega al reconectar (backfill por cursor). Lo que escribes sin red
  se encola y se envía solo al volver.
- **Avisos aunque cierres la app.** Web Push con VAPID propio (sin Firebase): el Durable
  Object firma el JWT y cifra la notificación (`aes128gcm`, RFC 8291) para cada miembro
  desconectado, todo hecho a mano con Web Crypto. El push **no lleva el texto** del mensaje
  (el servidor no puede leerlo) — solo el id de sala, para abrir la conversación al tocarlo.
- **Sin plataforma.** Backend = un Cloudflare Worker + un Durable Object por sala
  (WebSocket Hibernation API → cero consumo en reposo). Push = Web Push + VAPID propio.
- **Vanilla.** HTML + CSS + JS con ES modules nativos. Sin React, sin build step, sin
  bundler. El Worker es JS puro también.
- **Pseudo-escritorio.** No es una pantalla apilada de arriba abajo: es un pequeño
  escritorio donde cada sala es una **ventana** flotante (estilo rumrum) que arrastras,
  minimizas al dock o cierras. La **plaza pública** va anclada: siempre abierta para todo
  el colectivo. En móvil las ventanas se maximizan y el dock cambia entre ellas.

## arquitectura

```
 cliente A (PWA)            Cloudflare                  cliente B (PWA)
 ┌────────────┐    WS    ┌──────────────────┐   WS    ┌────────────┐
 │ UI vanilla │◄────────►│ Worker (router)  │◄───────►│ UI vanilla │
 │ IndexedDB  │          │   └► RoomDO/sala  │         │ IndexedDB  │
 │ crypto     │          │       • WS hibern │         │ crypto     │
 │ ServiceW.  │          │       • SQLite    │         │ ServiceW.  │
 └────────────┘          │         (CIFRADO) │         └────────────┘
                         └──────────────────┘
```

- Cada **sala = un Durable Object** (`env.ROOMS.idFromName(salaId)`).
- El **Worker** solo enruta: recibe el WebSocket y lo manda al DO de la sala; sirve el
  front estático para todo lo demás.
- El **DO** mantiene los WebSockets vivos (Hibernation API), persiste cada mensaje
  **cifrado** en su SQLite, y (fase 2) dispara Web Push a los miembros desconectados.
- El **cliente** cifra antes de enviar y descifra al recibir; guarda todo en IndexedDB y
  al reconectar pide "lo que hay después de mi último `seq`".

## estructura

```
public/                ← front 100% estático (lo sirve el Worker vía [assets])
  index.html
  css/pspsps.css
  js/
    app.js             ← bootstrap: puerta de identidad → escritorio
    wm.js              ← window manager (ventanas flotantes, dock, minimizar)
    identity.js        ← "¿quién eres?" (alias local, sin contraseña)
    db.js              ← IndexedDB (salas, mensajes, identidad, pushSub)
    crypto.js          ← AES-GCM por sala (zero-knowledge)
    ws.js              ← WebSocket con reconexión/backoff + cola offline
    salas.js           ← crear / invitar / unirse (clave en el #) + plaza pública
    push.js            ← suscripción Web Push (cliente)
    alerts.js          ← sonido + badge + notificación
    ui/launcher.js     ← menú del dock (salas, nueva, unirme, identidad)
    ui/room.js         ← una sala como ventana (multi-instancia)
    ui/modal.js
  sw.js                ← service worker (cache shell + handlers push)
  manifest.webmanifest
  icons/               ← gato pixel-art (placeholder, regenerable)
worker/src/
  index.js             ← Worker: router, upgrade WS → DO, /vapid-public
  room.js              ← RoomDO: WS hibernation + SQLite cifrado + disparo de push
  push.js              ← VAPID JWT + cifrado aes128gcm (RFC 8291), sin dependencias
wrangler.toml          ← un solo deploy: assets + DO en pspsps.meowrhino.studio
tools/make-icons.mjs   ← genera los iconos sin dependencias
tools/make-vapid.mjs   ← genera el par de claves VAPID para Web Push
```

## desarrollo

```bash
npm run dev          # wrangler dev → http://localhost:8787 (front + /ws)
npm run deploy       # despliega a Cloudflare (pspsps.meowrhino.studio)
npm run icons        # regenera los iconos del gato

# Web Push (una vez): genera las claves VAPID y guárdalas
node tools/make-vapid.mjs                 # escribe /tmp/pspsps-vapid.json
# pon la pública (+ subject) en wrangler.toml [vars], y la privada como secret:
cat /tmp/pspsps-vapid.json | npx wrangler secret put VAPID_PRIVATE   # pega el campo "private"
```

No hay build step en el front: son ES modules que el navegador carga tal cual.

## seguridad / modelo de amenaza (fase 0)

- El servidor **nunca** ve texto plano de los mensajes (AES-GCM en el cliente, AAD ata el
  blob a su sala).
- **Sí** ve metadatos: id de sala, alias y presencia (quién está conectado y cuándo).
  Ocultarlos (NIP-17 gift-wrap) es trabajo de una fase futura.
- **Cualquiera con el link de invitación** puede leer la sala: el link es una llave.
  Compártelo por un canal de confianza.
- Sin forward secrecy todavía: si se filtra la clave de una sala, se descifra su
  histórico. Aceptable para un colectivo pequeño de confianza; el roadmap sube a NIP-44.

Ver [`ROADMAP.md`](./ROADMAP.md) para las fases. Hecho con cariño por
[meowrhino](https://meowrhino.studio). 🐱
