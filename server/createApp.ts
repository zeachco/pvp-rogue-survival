import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { balanceProfile, type BalanceProfileId } from "../common/balance.ts";
import { parseClientMessage, type PlayerId, type ServerMessage } from "../common/protocol.ts";
import { systemRandom } from "../common/random.ts";
import { InMemoryPlayerRepository } from "./domain.ts";
import { GameService } from "./GameService.ts";

interface PlayerSocket extends WebSocket { playerId?: PlayerId }
export interface AppOptions { root: string; balanceProfile?: BalanceProfileId }

export function createApp(options: AppOptions) {
  const publicRoot = existsSync(join(options.root, "dist")) ? join(options.root, "dist") : options.root;
  const sockets = new Map<string, PlayerSocket>();
  const repository = new InMemoryPlayerRepository();
  const sendToPlayer = (playerId: PlayerId, message: ServerMessage) => {
    for (const socket of sockets.values()) if (socket.playerId === playerId && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const game = new GameService({ repository, balance: balanceProfile(options.balanceProfile), random: systemRandom, send: sendToPlayer });
  const server = createServer((request, response) => serveStatic(request, response, publicRoot));
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket: PlayerSocket) => {
    const connectionId = crypto.randomUUID(); sockets.set(connectionId, socket);
    socket.on("message", (raw: RawData) => {
      const message = decode(raw);
      if (!message) { socket.send(JSON.stringify({ type: "serverNotice", message: "Ignored invalid message." } satisfies ServerMessage)); return; }
      if (message.type === "join") { game.join(message.name, message.sessionId, (playerId) => { socket.playerId = playerId; }); return; }
      if (!socket.playerId) { socket.send(JSON.stringify({ type: "serverNotice", message: "Join before playing." } satisfies ServerMessage)); return; }
      game.handle(socket.playerId, message);
    });
    socket.on("close", () => { sockets.delete(connectionId); if (socket.playerId && !hasSocket(sockets, socket.playerId)) game.disconnect(socket.playerId); });
  });
  const timer = setInterval(() => game.dispatchWaves(), balanceProfile(options.balanceProfile).wave.intervalMs);
  timer.unref();
  return { server, game, repository, close: () => new Promise<void>((resolve, reject) => {
    clearInterval(timer);
    if (!server.listening) { wss.close(); resolve(); return; }
    wss.close(() => server.close((error) => error ? reject(error) : resolve()));
  }) };
}

function decode(raw: RawData) { try { return parseClientMessage(JSON.parse(String(raw))); } catch { return undefined; } }
function hasSocket(sockets: Map<string, PlayerSocket>, playerId: PlayerId): boolean { return [...sockets.values()].some((socket) => socket.playerId === playerId && socket.readyState === WebSocket.OPEN); }
async function serveStatic(request: IncomingMessage, response: ServerResponse, publicRoot: string): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(publicRoot, pathname));
  if (!filePath.startsWith(publicRoot)) { response.writeHead(403); response.end("Forbidden"); return; }
  try { const body = await readFile(filePath); response.writeHead(200, { "content-type": contentType(filePath) }); response.end(body); }
  catch { const index = await readFile(join(publicRoot, "index.html")); response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(index); }
}
function contentType(filePath: string): string { const extension = extname(filePath); if (extension === ".html") return "text/html; charset=utf-8"; if (extension === ".js") return "text/javascript; charset=utf-8"; if (extension === ".css") return "text/css; charset=utf-8"; if (extension === ".svg") return "image/svg+xml"; return "application/octet-stream"; }
