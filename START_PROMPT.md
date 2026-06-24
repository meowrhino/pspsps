# prompt de arranque para claude code

Copia esto en la primera sesión de Claude Code dentro de la carpeta `pspsps/`
(con `CLAUDE.md` y `ROADMAP.md` ya presentes).

---

Hola. Lee `CLAUDE.md` y `ROADMAP.md` enteros antes de escribir nada. Son la
especificación de este proyecto y mandan sobre cualquier suposición tuya.

Contexto rápido: soy un desarrollador freelance (meowrhino.studio) que hace webs
JAMstack a mano en HTML/CSS/JS vanilla, sin frameworks ni build steps, y despliega en
Cloudflare Pages y GitHub Pages. `pspsps` es una PWA de mensajería para un colectivo
pequeño, fusión de dos proyectos míos (`rumrum` = motor de salas, `toctoc` = shell de
identidad) con el patrón zero-knowledge de un tercero (`trackr`). El requisito
innegociable es que los mensajes offline funcionen.

Quiero que trabajemos **fase por fase** según `ROADMAP.md`, sin saltarnos ninguna y
desplegando algo funcional al final de cada una.

Empecemos por la **fase 0** (esqueleto local, sin servidor). Antes de teclear:

1. Confírmame que has leído y entendido las decisiones ya tomadas y los anti-scope
   de `CLAUDE.md` (vanilla, IndexedDB no localStorage, zero-knowledge, Cloudflare DO,
   nada de Firebase).
2. Proponme un plan concreto de la fase 0 en pasos pequeños (qué archivos, en qué orden).
3. Señálame cualquier decisión abierta donde necesites mi input (por ejemplo: cómo
   quiero exactamente la pantalla de "¿quién eres?", o el esquema inicial de IndexedDB).

No empieces a generar archivos hasta que validemos el plan de la fase 0. Cuando lo
validemos, vamos commit a commit, no en un volcado gigante.

Una cosa estética: hereda el look de `rumrum`/`toctoc` (fondo `#0d0c0a`, oscuro,
mobile-first, los `meta` de apple-mobile-web-app). El tono es juguetón e indie. La
mascota será un gato pixel-art (la dibujo yo aparte, déjame el hueco).
