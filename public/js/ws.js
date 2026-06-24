// ws.js — conexión WebSocket a la sala, con reconexión y backoff exponencial.
//
// El cliente NO sabe de cifrado: manda y recibe `blob`s opacos (los cifra/
// descifra la vista de sala). Protocolo (definido por el RoomDO):
//   ← history  { messages:[{seq,id,author,ts,blob,kind}], profiles, online, cursor }
//   ← msg      { seq, id, author, ts, blob, kind }     (mensaje nuevo / eco)
//   ← color    { name, color }
//   ← presence { online:[...] }
//   → msg      { id, ts, blob }       (lo envía el cliente; el autor lo pone el DO)
//   → color    { color }
//   → sub      { endpoint, p256dh, auth }   (fase 2, web push)

const MIN_BACKOFF = 500;
const MAX_BACKOFF = 15000;

export function connectRoom(opts) {
  const { room, name, color, getCursor, onHistory, onMessage, onColor, onPresence, onStatus } = opts;

  let ws = null;
  let closed = false; // cerrado a propósito (no reconectar)
  let backoff = MIN_BACKOFF;
  let reconnectTimer = null;
  const outbox = []; // mensajes pendientes de enviar mientras no hay socket abierto

  const proto = location.protocol === "https:" ? "wss" : "ws";

  function url() {
    const since = (getCursor && getCursor()) || 0;
    return (
      `${proto}://${location.host}/ws` +
      `?room=${encodeURIComponent(room)}` +
      `&name=${encodeURIComponent(name)}` +
      `&color=${encodeURIComponent(color)}` +
      `&since=${encodeURIComponent(since)}`
    );
  }

  function open() {
    if (closed) return;
    onStatus?.("connecting");
    ws = new WebSocket(url());

    ws.onopen = () => {
      backoff = MIN_BACKOFF; // conexión sana → resetea el backoff
      onStatus?.("online");
      // vacía la cola de salida acumulada offline
      while (outbox.length) ws.send(outbox.shift());
    };

    ws.onmessage = (e) => {
      let data;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      if (data.type === "history") {
        onHistory?.(data.messages || [], data.profiles || {}, data.online || [], data.minSeq || 0);
      } else if (data.type === "msg") {
        onMessage?.(data);
      } else if (data.type === "color") {
        onColor?.(data);
      } else if (data.type === "presence") {
        onPresence?.(data.online || []);
      }
    };

    ws.onclose = () => {
      if (closed) return;
      onStatus?.("offline");
      // reconexión con backoff exponencial + jitter (suaviza tormentas de
      // reconexión cuando el DO hiberna o se cae la red).
      const wait = Math.min(MAX_BACKOFF, backoff) * (0.7 + Math.random() * 0.6);
      backoff = Math.min(MAX_BACKOFF, backoff * 2);
      reconnectTimer = setTimeout(open, wait);
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ya cerrado */
      }
    };
  }

  function rawSend(obj) {
    const s = JSON.stringify(obj);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(s);
    else outbox.push(s); // se enviará al (re)abrir
  }

  open();

  return {
    // msg = { id, ts, blob }  (ya cifrado por la vista de sala)
    send(msg) {
      rawSend({ type: "msg", id: msg.id, ts: msg.ts, blob: msg.blob });
    },
    setColor(color) {
      rawSend({ type: "color", color });
    },
    sub(subscription) {
      rawSend({ type: "sub", ...subscription });
    },
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* ya cerrado */
      }
    },
  };
}
