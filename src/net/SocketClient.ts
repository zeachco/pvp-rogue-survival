import { parseServerMessage, type ClientMessage, type ServerMessage } from "../../common/protocol";

type MessageHandler = (message: ServerMessage) => void;
type OpenHandler = () => void;
type CloseHandler = () => void;
type ErrorHandler = (event: Event) => void;
export function gameSocketUrl(location: Pick<Location, "host" | "protocol" | "search">): string {
  const pageProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  const fallback = `${pageProtocol}//${location.host}/ws`;
  const candidate = new URLSearchParams(location.search).get("server")?.trim();
  if (!candidate) return fallback;
  try {
    const base = new URL(candidate.includes("://") ? candidate : `${location.protocol}//${candidate}`);
    if (base.username || base.password || !["http:", "https:", "ws:", "wss:"].includes(base.protocol)) return fallback;
    const protocol = base.protocol === "https:" || base.protocol === "wss:" ? "wss:" : "ws:";
    const path = base.pathname.replace(/\/+$/, "");
    return `${protocol}//${base.host}${path}/ws`;
  } catch { return fallback; }
}

export class SocketClient {
  private socket?: WebSocket;
  private handlers: MessageHandler[] = [];
  private openHandlers: OpenHandler[] = [];
  private closeHandlers: CloseHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  connected = false;
  private reconnectTimer?: number;

  connect(): void {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    clearTimeout(this.reconnectTimer);
    this.socket = new WebSocket(gameSocketUrl(window.location));
    this.socket.addEventListener("open", () => {
      this.connected = true;
      for (const handler of this.openHandlers) {
        handler();
      }
    });
    this.socket.addEventListener("close", () => {
      this.connected = false;
      for (const handler of this.closeHandlers) {
        handler();
      }
      this.reconnectTimer = window.setTimeout(() => this.connect(), 1000);
    });
    this.socket.addEventListener("error", (event) => {
      for (const handler of this.errorHandlers) {
        handler(event);
      }
    });
    this.socket.addEventListener("message", (event) => {
      let message: ServerMessage | undefined;
      try { message = parseServerMessage(JSON.parse(event.data as string)); } catch { return; }
      if (!message) return;
      for (const handler of this.handlers) {
        handler(message);
      }
    });
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  onOpen(handler: OpenHandler): void {
    this.openHandlers.push(handler);
  }

  onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }

  onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  send(message: ClientMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }
}
