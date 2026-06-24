# ROADMAP · pspsps

Fases incrementales. Cada una deja algo **funcionando y desplegable**. No saltes fases.
Marca `[x]` al completar y commitea la actualización de este archivo.

> **Estado (2026-06-24):** fases **0, 1 y 2 completas y desplegadas** en
> `https://pspsps.meowrhino.studio`. Verificado end-to-end: identidad, salas, invitaciones,
> realtime 2-personas, offline-first, reconexión por cursor, **cifrado AES-GCM zero-knowledge**
> (activo desde el primer mensaje) y **Web Push** (VAPID + aes128gcm hechos a mano, cripto
> auto-verificado). Único pendiente de fase 2: **probar el push en un iPhone/Android real**.
> Siguiente: fase 3 (cifrado fuerte NIP-44) cuando se quiera.
>
> **Decisiones de implementación** (desvían de la *propuesta* original con motivo):
> - **Deploy unificado** estilo rumrum: un solo Worker sirve `public/` (assets) + `/ws`
>   y se publica en `pspsps.meowrhino.studio` vía `custom_domain`. (La propuesta inicial
>   separaba front en Pages; el patrón unificado de rumrum es más simple y ya probado.)
> - **Salas soberanas sin servidor de cuentas**: `sala = id aleatorio + clave AES`. La
>   clave viaja en el fragmento `#` del link de invitación → nunca llega al servidor.
> - **Worker en JS puro** (sin TypeScript) para honrar el "sin build step".

---

## fase 0 — esqueleto local ✅ (hecha)
> objetivo: una PWA instalable que abre, tiene identidad ligera, guarda mensajes en
> IndexedDB, y simula una conversación local. Esto valida UI + persistencia.

- [x] estructura de carpetas (`public/`, `worker/`)
- [x] `index.html` + shell visual heredando estética de rumrum/toctoc (`#0d0c0a`, oscuro)
- [x] `manifest.webmanifest` (name "pspsps", icons gato pixel, `display: standalone`, theme `#0d0c0a`)
- [x] `sw.js`: cachea el app-shell (stale-while-revalidate), responde offline
- [~] instalable de verdad — shell/manifest/SW listos; **probar "Añadir a inicio" en iOS/Android real** pendiente
- [x] `db.js`: IndexedDB con stores `salas`, `mensajes`, `identidad`, `pushSub` + `onupgradeneeded`
- [x] `identity.js`: pantalla "¿quién eres?" (alias, sin contraseña) como toctoc
- [x] vista lista de chats + vista sala; pintar mensajes desde IndexedDB
- [x] enviar un mensaje = lo guarda en IndexedDB y lo pinta
- **deploy:** ⏳ pendiente (se publica junto con fase 1, deploy unificado)

## fase 1 — backend real + tiempo real ✅ (hecha)
> objetivo: dos dispositivos distintos hablan en vivo por WebSocket vía un Durable Object.

- [x] `worker/src/index.js`: Worker que hace upgrade a WebSocket y enruta a un DO por sala
- [x] `room.js`: Durable Object con Hibernation API (`acceptWebSocket`/`getWebSockets`)
- [x] SQLite del DO: tabla `messages` (blob cifrado) + `profiles` + `subs` (para fase 2)
- [x] protocolo WS: `history`/`msg`/`color`/`presence` (adaptado; ver README)
- [x] `ws.js` cliente: conectar, reconexión con backoff exponencial + jitter, cola de salida
- [x] backfill al reconectar (`since=<seq>` → DO devuelve pendientes → IndexedDB)
- [x] idempotencia por `id` (uuid de cliente) — `INSERT OR IGNORE`, sin duplicados
- **deploy:** ⏳ Worker + assets en Cloudflare (`wrangler deploy` → pspsps.meowrhino.studio)

## fase 0.5 — cifrado zero-knowledge ✅ (adelantada)
> objetivo (originalmente fase 3, parte simple): el servidor nunca ve texto plano.

- [x] `crypto.js`: AES-GCM 256 por sala, IV aleatorio por mensaje, AAD = sala+versión
- [x] clave de sala generada en cliente, exportada a b64url, transportada en el `#`
- [x] cifrar antes de enviar / descifrar al recibir; el DO solo guarda blobs opacos
- [x] verificado: lo que el servidor almacena es ciphertext; otro cliente con la clave lo descifra

## fase 2 — offline de verdad (push) ✅ (hecha, falta probar en dispositivo)
> objetivo: el requisito innegociable. B escribe a A (offline) y A recibe notificación.

- [x] generar par de claves VAPID (`tools/make-vapid.mjs`); pública+subject como vars, privada como secret
- [x] `push.js` cliente: pedir permiso, suscribirse, registrar `{endpoint,p256dh,auth}` en cada sala (`{type:"sub"}`)
- [x] `worker/src/push.js`: firmar JWT VAPID (ES256) + cifrar payload (aes128gcm RFC 8291) + POST — hecho a mano con Web Crypto, sin dependencias
- [x] el DO dispara push a miembros sin WS activo al llegar un `msg` (con throttle anti-spam)
- [x] `sw.js`: handler `push` + `notificationclick` (abre la sala)
- [x] manejar 404/410 → borrar suscripción caducada de `subs`
- [x] verificado el cripto con round-trip (cifrar→descifrar) + firma/verificación del JWT
- [~] **probar iOS 16.4+ en dispositivo real**: instalar PWA antes de suscribir; validar `subject` VAPID — *pendiente (necesita un móvil de verdad)*
- **deploy:** ✅ desplegado. Mensajes offline → notificación. *Ya es un messenger de verdad.*

## fase 3 — cifrado fuerte
> objetivo: subir del AEAD simple a cifrado autenticado estándar (NIP-44).

- [ ] `crypto.js`: migrar a NIP-44 (`@noble/ciphers` + `@noble/hashes`, JS puro)
- [ ] derivación de clave de sala / por-conversación
- [ ] (opcional) NIP-17 gift-wrap para ocultar metadatos (alias/presencia)
- [ ] versionar el formato del blob para migrar (el AAD ya lleva versión "v1")
- **deploy:** mismo UX, cifrado serio por debajo.

## fase 4 — identidad soberana
> objetivo: pasar de alias-sin-contraseña a clave criptográfica portable (Nostr-like).

- [ ] generar par secp256k1 en el navegador (`@noble/curves`)
- [ ] identidad = pubkey; alias = etiqueta local
- [ ] backup cifrado de la privkey (patrón trackr) para mover entre dispositivos
- [ ] frase mnemónica (BIP-39) o export/import de clave cifrada
- **deploy:** usuarios soberanos, sin servidor de cuentas.

## fase 5 — pulido + opcionales
- [x] **pseudo-escritorio de ventanas** (window manager): salas como ventanas flotantes
      arrastrables, minimizables al dock; responsive (maximizan en móvil)
- [x] **plaza pública** anclada (id+clave conocidos): sala común siempre abierta
- [ ] presencia "escribiendo…" — extender el protocolo `presence`
- [x] mascota gato pixel-art (placeholder generado en `tools/make-icons.mjs` — sustituir por el tuyo)
- [ ] transferencia de ficheros (¿P2P WebRTC entre dos pares online?)
- [ ] sonidos (el "pspsps" real como notificación)
- [ ] recordar posición/tamaño de las ventanas entre sesiones

---

## limitaciones conocidas (de la revisión adversarial)
Decisiones conscientes para fase 0, no olvidos. A revisar en fase 2/3:

- **Rate-limit en memoria**: el token bucket vive en memoria del DO y se reinicia al
  hibernar (patrón heredado de rumrum). Mitigado por el id de sala secreto de 128 bits
  (solo miembros pueden conectarse). Persistir a SQLite si una sala sufre abuso.
- **`profiles`/`subs` sin poda**: crecen con cada alias/endpoint visto. Irrelevante para
  decenas de usuarios; añadir limpieza cuando llegue Web Push (borrar `subs` en 404/410).
- **Histórico descifrado en IndexedDB**: local-first ⇒ el texto vive descifrado en el
  dispositivo. El invariante de servidor se mantiene; para amenaza de dispositivo
  comprometido, usar cifrado de disco del SO (FileVault/BitLocker). Cifrado local en fase 3.
- **Mensaje rate-limiteado** se queda "enviando…" hasta el próximo `open()` (se reenvía
  desde la cola). Aceptable en un grupo pequeño; feedback explícito pendiente.
- **Hueco del ring buffer**: si pierdes >10 000 mensajes estando offline, se avisa por
  consola (el servidor manda `minSeq`); falta el aviso visual en la UI.

---

### criterios de "hecho" por fase
Una fase está hecha cuando: funciona en móvil real, está desplegada, no rompe las
anteriores, y ROADMAP.md está actualizado. No acumules fases sin desplegar.
