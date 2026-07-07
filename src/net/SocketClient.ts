import type { ClientMessage, ServerMessage } from "../../common/protocol";

type MessageHandler = (message: ServerMessage) => void;

export class SocketClient {
  private socket?: WebSocket;
  private handlers: MessageHandler[] = [];
  connected = false;

  connect(): void {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(`${protocol}//${window.location.host}`);
    this.socket.addEventListener("open", () => {
      this.connected = true;
    });
    this.socket.addEventListener("close", () => {
      this.connected = false;
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      for (const handler of this.handlers) {
        handler(message);
      }
    });
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }
}
