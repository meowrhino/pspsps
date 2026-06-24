# pspsps

> mensajería para colectivos pequeños. small web, sin plataforma, sin frameworks.
> fusiona el motor de salas de `rumrum` con el shell de identidad de `toctoc`,
> y el patrón de cifrado/persistencia de `trackr`.

`pspsps.meowrhino.studio`

---

## qué es esto

Una PWA de chat instalable para un círculo pequeño de personas (un colectivo, decenas
de usuarios). No es Slack, no es WhatsApp, no aspira a escalar a millones. Aspira a ser
**bonita, soberana, ligera y offline-capable**, hecha a mano y sin dependencias de
plataforma (nada de Firebase, nada de SDKs propietarios).

Requisito innegociable: **los mensajes offline tienen que funcionar.** Si A está
desconectado y B le escribe, el mensaje espera en el servidor y le llega cuando A vuelve.
Esto descarta P2P puro. El estado vive en un backend mínimo propio.

## principios de diseño (no negociables)

1. **Vanilla.** HTML + CSS + JS. Sin React, sin Vue, sin build step, sin bundler.
   ES modules nativos (`<script type="module">`). Si hace falta una librería, que sea
   pequeña, auditable, importable por URL o como archivo único, y sin árbol de dependencias.
2. **Local-first.** El cliente funciona offline. El histórico vive en IndexedDB en el
   dispositivo. El servidor es un buzón sincronizador, no la fuente única de verdad.
3. **Zero-knowledge.** El servidor mueve blobs cifrados. Nunca ve texto plano de mensajes.
4. **Sin plataforma.** Backend = Cloudflare Workers + Durable Objects (infra propia,
   serverless, cero consumo en reposo). Push = Web Push + VAPID propio, sin Google/Firebase.
5. **Progressive enhancement.** Si JS falla a medias, que degrade con dignidad.
6. **Estética meowrhino.** Heredar la línea de `rumrum`/`toctoc`: fondo `#0d0c0a`,
   tema oscuro, tipografía cuidada (mono para datos, algo editorial para texto), grano
   sutil si encaja. Mascota: gato pixel-art (a dibujar). Tono juguetón, cute, "indie".

## stack

| capa | elección | por qué |
|---|---|---|
| front | HTML/CSS/JS vanilla, ES modules | filosofía meowrhino, sin build |
| PWA | manifest.json + service worker | instalable iOS 16.4+/Android, offline shell |
| persistencia cliente | **IndexedDB** (vía `idb` de Jake Archibald, ~1KB, o a pelo) | async, no bloquea UI, GB de capacidad, queries. NO localStorage para el histórico |
| transporte | **WebSocket** | menor consumo de batería para chat de texto; bidireccional |
| backend | **Cloudflare Worker + 1 Durable Object por sala** | serverless, cero en reposo, free tier holgado para decenas de usuarios |
| persistencia servidor | **SQLite del propio Durable Object** | el DO guarda el histórico cifrado de su sala |
| hibernación | **WebSocket Hibernation API** del DO | el DO se descarga de memoria en idle; el runtime responde pings solo; mínimo coste/energía |
| offline push | **Web Push API + VAPID propio** | avisa al usuario desconectado; el SO entrega aunque la app esté cerrada |
| cifrado | **fase 0: AEAD simple (Web Crypto AES-GCM). fase 1: NIP-44** (`@noble/ciphers`, JS puro) | autenticado, estándar, revisado, sin WASM |
| identidad | **fase 0: login ligero (como toctoc). fase 1: clave secp256k1 estilo Nostr** | sin contraseñas, soberano, portable; backup cifrado local estilo trackr |

> Decisiones ya tomadas (no re-litigar sin motivo): Cloudflare sobre VPS/relay propio
> por huella energética y free tier; IndexedDB sobre localStorage; WebSocket sobre
> SSE/polling/WebRTC; zero-knowledge desde el día 1; identidad por clave como norte
> pero login ligero para arrancar sin fricción.

## arquitectura

```
                          ┌─────────────────────────────┐
   cliente A (PWA)        │   Cloudflare                │        cliente B (PWA)
  ┌──────────────┐  WS    │  ┌───────────────────────┐  │  WS   ┌──────────────┐
  │ UI (rumrum)  │◄──────►│  │ Worker (router)       │  │◄─────►│ UI (rumrum)  │
  │ IndexedDB    │        │  │   │                   │  │       │ IndexedDB    │
  │ ServiceWorker│        │  │   ▼                   │  │       │ ServiceWorker│
  │ cripto (cli) │        │  │ Durable Object /sala  │  │       │ cripto (cli) │
  └──────┬───────┘        │  │   • sessions (WS)     │  │       └──────────────┘
         │                │  │   • SQLite (histórico │  │
         │ Web Push       │  │     CIFRADO)          │  │
         │ (cuando offline)│  │   • dispara Web Push  │  │
         ▼                │  └───────────────────────┘  │
   push service (Apple/   └─────────────────────────────┘
   Mozilla/Google autopush — estándar, no Firebase)
```

- Cada **sala/conversación = un Durable Object** identificado por su nombre/id.
- El **Worker** solo enruta: recibe el WS, decide a qué DO va (`env.ROOMS.idFromName(sala)`),
  hace `stub.fetch()`.
- El **DO** mantiene la lista de WebSockets vivos de esa sala (Hibernation API:
  `state.acceptWebSocket(ws)`, `state.getWebSockets()`), persiste cada mensaje cifrado en
  su SQLite, y para cada miembro **no conectado** dispara un Web Push.
- El **cliente** cifra antes de enviar y descifra al recibir. Guarda todo en IndexedDB.
  Al reconectar, pide al DO "mensajes desde timestamp X" y rellena lo que se perdió.

## flujo de un mensaje

1. A escribe. Cliente cifra el texto (AEAD) → blob.
2. Cliente envía el blob por WebSocket al Worker → DO de la sala.
3. DO persiste el blob en SQLite con `(sala, autor, ts, blob)`.
4. DO reenvía el blob a todos los WS conectados de la sala (incluido eco a A para confirmar).
5. Para cada miembro de la sala **sin WS activo**: DO hace POST Web Push (firmado VAPID)
   a su endpoint guardado.
6. Receptores conectados: descifran, pintan, guardan en IndexedDB.
7. Receptor offline: recibe notificación push → abre PWA → cliente pide "desde ts X" →
   DO devuelve blobs pendientes → cliente descifra y rellena IndexedDB.

## estructura de archivos (propuesta)

```
pspsps/
├── CLAUDE.md                 ← este archivo
├── ROADMAP.md                ← fases
├── public/                   ← lo que sirve Cloudflare Pages / GitHub Pages (estático)
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js                 ← service worker (cache shell + push handler)
│   ├── css/
│   │   └── pspsps.css
│   ├── js/
│   │   ├── app.js            ← bootstrap, router de vistas
│   │   ├── identity.js       ← login ligero → (fase 1) claves
│   │   ├── ws.js             ← conexión WebSocket, reconexión con backoff
│   │   ├── crypto.js         ← cifrar/descifrar (AEAD → NIP-44)
│   │   ├── db.js             ← wrapper IndexedDB (salas, mensajes, contactos, claves)
│   │   ├── push.js           ← suscripción Web Push (cliente)
│   │   └── ui/               ← componentes de vista (lista de chats, sala, ...)
│   └── icons/                ← iconos PWA + gato pixel
└── worker/                   ← el backend (Cloudflare)
    ├── wrangler.toml
    └── src/
        ├── index.js          ← Worker: router, upgrade WS, enruta a DO
        ├── room.js           ← Durable Object: sessions + SQLite + push trigger
        └── push.js           ← firma VAPID + envío Web Push (servidor)
```

> El front (`public/`) es 100% estático y desplegable en GitHub Pages.
> El `worker/` es el único trozo dinámico y vive en Cloudflare. Separa los deploys.

## modelo de datos

**IndexedDB (cliente)** — object stores:
- `salas`: `{ id, nombre, tipo, claveCompartida?, ultimoTs }`
- `mensajes`: `{ id, sala, autor, ts, texto }` (texto YA descifrado en cliente; índice por `sala`+`ts`)
- `contactos`: `{ id, alias, pubkey? }`
- `identidad`: `{ alias, privkey?, pubkey? }` (privkey nunca sale sin cifrar)
- `pushSub`: `{ endpoint, p256dh, auth }`

**SQLite (Durable Object, por sala)**:
```sql
CREATE TABLE IF NOT EXISTS mensajes (
  id TEXT PRIMARY KEY,        -- uuid generado en cliente (idempotencia)
  autor TEXT NOT NULL,
  ts INTEGER NOT NULL,        -- epoch ms
  blob TEXT NOT NULL          -- payload CIFRADO; el servidor no lo entiende
);
CREATE INDEX IF NOT EXISTS idx_ts ON mensajes(ts);

CREATE TABLE IF NOT EXISTS miembros (
  id TEXT PRIMARY KEY,
  endpoint TEXT,              -- web push endpoint (para offline)
  p256dh TEXT,
  auth TEXT
);
```

## protocolo de mensajes WebSocket (cliente ↔ DO)

JSON minúsculo, un campo `t` (tipo):
- `{ t:"hello", sala, alias, sinceTs }` → cliente entra y pide histórico desde `sinceTs`
- `{ t:"backfill", mensajes:[...] }` → DO responde con pendientes
- `{ t:"msg", id, autor, ts, blob }` → mensaje nuevo (en ambas direcciones)
- `{ t:"ack", id }` → confirmación de persistencia
- `{ t:"sub", endpoint, p256dh, auth }` → cliente registra su push subscription
- `{ t:"presence", quien, estado }` → (opcional) online/offline/escribiendo

## reglas para claude code

- **No introduzcas frameworks ni build steps.** Si propones una dependencia, justifica
  tamaño y por qué no se puede hacer a mano. Prefiere Web Platform APIs.
- **No uses localStorage para el histórico de mensajes.** localStorage solo para flags
  triviales (tema, último alias). El histórico va a IndexedDB.
- **No metas la clave privada en claro en ningún sitio que persista** sin cifrar.
- **El servidor nunca ve texto plano.** Si te encuentras descifrando en el Worker/DO,
  algo va mal.
- **Mobile-first.** Probar en viewport estrecho. Los `meta` de apple-mobile-web-app ya
  están en rumrum/toctoc; replícalos.
- **Commits pequeños y descriptivos.** Una fase = varios commits, no uno gigante.
- **Comenta en español** (el resto del proyecto está en español).
- **Cuando termines una fase, actualiza ROADMAP.md** marcando lo hecho.
- **Pregunta antes de**: borrar datos del usuario, cambiar el esquema de IndexedDB
  (necesita migración con `onupgradeneeded`), tocar el modelo de cifrado.

## cosas que NO hacemos (anti-scope)

- ❌ Vídeo/voz en tiempo real (WebRTC). Fuera de alcance. (Quizá fase futura: transfer
  de ficheros P2P entre dos pares online, nada más.)
- ❌ Federación tipo Matrix. Demasiado peso operativo para un colectivo pequeño.
- ❌ Servidor de cuentas con contraseñas hasheadas (rompe zero-knowledge).
- ❌ Analytics, tracking, telemetría de terceros.
- ❌ Dependencia de Firebase/servicios gestionados propietarios.

## referencias internas

- `rumrum` → motor de salas + estética base + meta PWA. Reutilizar look & feel.
- `toctoc` → shell de identidad ("¿quién eres?"), lista de chats, "empieza uno nuevo".
- `trackr` → patrón zero-knowledge + sync cifrado entre dispositivos + local-first.

## referencias externas clave

- Cloudflare "Edge Chat Demo" (DO + WebSocket, el patrón canónico de "un DO por sala").
- Durable Objects: WebSocket Hibernation API (docs Cloudflare).
- Web Push: protocolo VAPID; soporte iOS Safari desde 16.4 (PWA debe estar instalada
  para suscribir; cuidado con el formato del `subject` VAPID que Apple valida).
- IndexedDB: wrapper `idb` (Jake Archibald). Escrituras en lote para rendimiento.
- NIP-44 (cifrado Nostr) y NIP-17 (DMs privados) para la fase de cifrado fuerte;
  `@noble/ciphers` + `@noble/hashes` (Paul Millr), JS puro sin WASM.
