import { parseServerMessage, type ClientMessage, type ServerMessage } from "../../common/protocol";

type MessageHandler = (message: ServerMessage) => void;
type OpenHandler = () => void;
type CloseHandler = () => void;
type ErrorHandler = (event: Event) => void;

export class SocketClient {
  private socket?: WebSocket;
  private handlers: MessageHandler[] = [];
  private openHandlers: OpenHandler[] = [];
  private closeHandlers: CloseHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  connected = false;

  connect(): void {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
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
