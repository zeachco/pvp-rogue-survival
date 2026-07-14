import { parseServerMessage, type ClientMessage, type ServerMessage } from "../../common/protocol";

type MessageHandler = (message: ServerMessage) => void;
type OpenHandler = () => void;
type CloseHandler = () => void;
type ErrorHandler = (event: Event) => void;
export const DEFAULT_GAME_SERVER_HOST = "localhost";
export function gameServerHost(search: string): string { const candidate = new URLSearchParams(search).get("ip")?.trim(); return candidate && isIpv4(candidate) ? candidate : DEFAULT_GAME_SERVER_HOST; }
export function gameSocketUrl(location: Pick<Location, "protocol" | "port" | "search">): string { const protocol = location.protocol === "https:" ? "wss:" : "ws:"; const port = location.port ? `:${location.port}` : ""; return `${protocol}//${gameServerHost(location.search)}${port}/ws`; }
function isIpv4(value: string): boolean { const parts = value.split("."); return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255 && String(Number(part)) === part); }

export class SocketClient {
  private socket?: WebSocket;
  private handlers: MessageHandler[] = [];
  private openHandlers: OpenHandler[] = [];
  private closeHandlers: CloseHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  connected = false;

  connect(): void {
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

  send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }
}
