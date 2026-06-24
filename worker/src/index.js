import { RoomDO } from "./room.js";

// El Durable Object debe re-exportarse desde el entrypoint del Worker.
export { RoomDO };

// pspsps · Worker: solo enruta. Recibe el upgrade de WebSocket y lo manda al
// Durable Object de la sala correspondiente. Todo lo demás (HTML/CSS/JS, la PWA)
// lo sirve el binding de assets estáticos (public/). El servidor NUNCA descifra:
// los blobs pasan intactos por aquí y por el DO.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /ws?room=<id>&name=<alias>&since=<seq>&color=<hex> → DO de esa sala.
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      // El id de sala es un token opaco (idealmente aleatorio): mismo nombre →
      // siempre el mismo DO, así los miembros se reencuentran al reconectar.
      const room = (url.searchParams.get("room") || "lobby").slice(0, 128) || "lobby";
      const id = env.ROOMS.idFromName(room);
      return env.ROOMS.get(id).fetch(request);
    }

    // Clave pública VAPID para que el cliente se suscriba a Web Push (fase 2).
    // Es pública por diseño; se expone como endpoint para no incrustarla.
    if (url.pathname === "/vapid-public") {
      return new Response(env.VAPID_PUBLIC || "", {
        headers: { "content-type": "text/plain", "cache-control": "no-store" },
      });
    }

    // Todo lo demás: ficheros estáticos (public/).
    return env.ASSETS.fetch(request);
  },
};
