export interface NoteEvent {
  timestamp_ms: number;
  event_type: string;
  pitch: number;
  velocity: number;
  duration_ms: number;
  pan: number;
  size_bytes: number;
  src_ip?: string;
  dst_ip?: string;
  src_port?: number;
  dst_port?: number;
}

export interface ControlMessage {
  type: "control";
  message: string;
}

export type WireSongMessage = NoteEvent | ControlMessage;

export type WireSongStatus = "connecting" | "open" | "closed" | "error";

export interface WireSongConnectionHandlers {
  onNoteEvent: (event: NoteEvent) => void;
  onControlMessage: (msg: ControlMessage) => void;
  onStatusChange: (status: WireSongStatus) => void;
}

export interface WireSongConnection {
  close: () => void;
}

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 5000;

export function connectWireSong(
  url: string,
  handlers: WireSongConnectionHandlers,
): WireSongConnection {
  let socket: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = INITIAL_BACKOFF_MS;

  const setStatus = (status: WireSongStatus) => handlers.onStatusChange(status);

  const scheduleReconnect = () => {
    if (closed || reconnectTimer !== null) {
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, backoffMs);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  };

  const open = () => {
    if (closed) {
      return;
    }
    setStatus("connecting");
    socket = new WebSocket(url);
    socket.onopen = () => {
      backoffMs = INITIAL_BACKOFF_MS;
      setStatus("open");
    };
    socket.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch (err) {
        console.warn("WireSong: malformed message dropped", err);
        return;
      }
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "type" in parsed &&
        (parsed as { type: unknown }).type === "control"
      ) {
        handlers.onControlMessage(parsed as ControlMessage);
      } else {
        handlers.onNoteEvent(parsed as NoteEvent);
      }
    };
    socket.onerror = () => {
      setStatus("error");
    };
    socket.onclose = () => {
      setStatus("closed");
      scheduleReconnect();
    };
  };

  open();

  return {
    close() {
      closed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket !== null) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
        socket = null;
      }
    },
  };
}
