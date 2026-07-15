import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { BALANCE } from "../common/balance.ts";
import { parseClientMessage, type PlayerId, type ServerMessage } from "../common/protocol.ts";
import { systemRandom } from "../common/random.ts";
import { InMemoryPlayerRepository } from "./domain.ts";
import type { PlayerRepository } from "./domain.ts";
import { SqlPlayerRepository } from "./SqlPlayerRepository.ts";
import { GameService } from "./GameService.ts";

interface PlayerSocket extends WebSocket { playerId?: PlayerId; lastSeen: number; commandChain: Promise<void> }
export interface AppOptions { root: string; databaseUrl?: string | false }
const PERSIST_INTERVAL_MS = 60_000;

export async function createApp(options: AppOptions) {
  const publicRoot = existsSync(join(options.root, "dist")) ? join(options.root, "dist") : options.root;
  const sockets = new Map<string, PlayerSocket>();
  let closing = false; let closePromise: Promise<void> | undefined;
  let repository: PlayerRepository;
  if (options.databaseUrl === false) repository = new InMemoryPlayerRepository();
  else { const databaseUrl = options.databaseUrl ?? `sqlite://${join(options.root, "server-data", "players.sqlite")}`; if (databaseUrl.startsWith("sqlite:") || databaseUrl.startsWith("file:")) mkdirSync(join(options.root, "server-data"), { recursive: true }); repository = await SqlPlayerRepository.open(databaseUrl); }
  const sendToPlayer = (playerId: PlayerId, message: ServerMessage) => {
    for (const socket of sockets.values()) if (socket.playerId === playerId && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const game = new GameService({
    repository,
    balance: BALANCE,
    random: systemRandom,
    send: sendToPlayer,
    logPlayerLifecycle: (event, player) => console.log(`[MLH][player] ${event} id=${player.id} name=${JSON.stringify(player.name)}`),
    logRealmLifecycle: (event, playerId, realmId, opponentIds) => console.log(`[MLH][realm] ${event} id=${playerId} realm=${realmId} opponents=${opponentIds.join(",")}`),
  });
  const broadcastLeaderboard = () => broadcastAnonymousLeaderboard(sockets.values(), game);
  const server = createServer((request, response) => serveStatic(request, response, publicRoot));
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket: PlayerSocket) => {
    if (closing) { socket.close(1012, "Server shutting down"); return; }
    const connectionId = crypto.randomUUID(); socket.lastSeen = Date.now(); socket.commandChain = Promise.resolve(); sockets.set(connectionId, socket);
    socket.on("pong", () => { socket.lastSeen = Date.now(); });
    socket.on("message", (raw: RawData) => {
      if (closing) return;
      socket.lastSeen = Date.now(); socket.commandChain = socket.commandChain.then(async () => {
        const message = decode(raw);
        if (!message) return sendSocket(socket, { type: "serverNotice", message: "Ignored invalid message." });
        if (message.type === "listHeroes") return sendLeaderboard(socket, game);
        if (message.type === "inspectHero") { const hero = game.publicHeroProfile(message.heroId); return hero ? sendSocket(socket, { type: "heroProfile", hero }) : sendSocket(socket, { type: "serverNotice", message: "That hero is unavailable." }); }
        if (message.type === "join") {
          const existing = game.findPlayer(message.heroId, message.name); if (existing?.connected) return sendSocket(socket, { type: "serverNotice", message: "That username is already logged in." });
          try { game.join(message.name ?? "", message.heroId, (playerId) => { socket.playerId = playerId; }); broadcastLeaderboard(); }
          catch { sendSocket(socket, { type: "serverNotice", message: message.heroId ? "That hero is unavailable." : "Username must use 1-20 letters, digits, underscores, or hyphens." }); }
          return;
        }
        if (message.type === "logout") { if (socket.playerId) { game.logout(socket.playerId); socket.playerId = undefined; } sendSocket(socket, { type: "loggedOut" }); return broadcastLeaderboard(); }
        if (!socket.playerId) return sendSocket(socket, { type: "serverNotice", message: "Join before playing." });
        game.handle(socket.playerId, message);
      }).catch((error) => { console.error("[MLH][database] command failed", error instanceof Error ? error.message : error); sendSocket(socket, { type: "serverNotice", message: "The server could not save that change." }); });
    });
    socket.on("close", () => { sockets.delete(connectionId); if (socket.playerId && !hasSocket(sockets, socket.playerId)) { game.disconnect(socket.playerId); broadcastLeaderboard(); } });
  });
  const waveTimer = setInterval(() => game.dispatchWaves(), BALANCE.wave.intervalMs); waveTimer.unref();
  const persistTimer = setInterval(() => { void Promise.resolve(repository.persist()).catch((error) => console.error("[MLH][database] periodic persist failed", error instanceof Error ? error.message : error)); }, PERSIST_INTERVAL_MS); persistTimer.unref();
  const heartbeat = setInterval(() => { const now = Date.now(); for (const socket of sockets.values()) { if (now - socket.lastSeen >= 300_000) socket.terminate(); else if (socket.readyState === WebSocket.OPEN) socket.ping(); } }, 30_000); heartbeat.unref();
  const realmStateTimer = setInterval(() => game.refreshRealmStates(), 1_000); realmStateTimer.unref();
  const close = (): Promise<void> => closePromise ??= (async () => {
    closing = true; clearInterval(waveTimer); clearInterval(persistTimer); clearInterval(heartbeat); clearInterval(realmStateTimer); wss.close();
    for (const socket of sockets.values()) if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1012, "Server shutting down");
    await Promise.all([...sockets.values()].map((socket) => socket.commandChain));
    await repository.persist(); await repository.close?.();
    for (const socket of sockets.values()) socket.terminate();
    await closeServer(server);
  })();
  return { server, game, repository, close };
}

function sendSocket(socket: PlayerSocket, message: ServerMessage): void { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function sendLeaderboard(socket: PlayerSocket, game: GameService): void { sendSocket(socket, { type: "leaderboard", heroes: game.leaderboard() }); }
export function broadcastAnonymousLeaderboard(sockets: Iterable<Pick<PlayerSocket, "playerId" | "readyState" | "send">>, game: GameService): void { for (const socket of sockets) if (!socket.playerId && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "leaderboard", heroes: game.leaderboard() } satisfies ServerMessage)); }

function decode(raw: RawData) { try { return parseClientMessage(JSON.parse(String(raw))); } catch { return undefined; } }
function hasSocket(sockets: Map<string, PlayerSocket>, playerId: PlayerId): boolean { return [...sockets.values()].some((socket) => socket.playerId === playerId && socket.readyState === WebSocket.OPEN); }
function closeServer(server: ReturnType<typeof createServer>): Promise<void> { return new Promise((resolve, reject) => { if (!server.listening) { resolve(); return; } server.close((error) => error ? reject(error) : resolve()); }); }
async function serveStatic(request: IncomingMessage, response: ServerResponse, publicRoot: string): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(publicRoot, pathname));
  if (!filePath.startsWith(publicRoot)) { response.writeHead(403); response.end("Forbidden"); return; }
  try { const body = await readFile(filePath); response.writeHead(200, { "content-type": contentType(filePath) }); response.end(body); }
  catch { const index = await readFile(join(publicRoot, "index.html")); response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(index); }
}
function contentType(filePath: string): string { const extension = extname(filePath); if (extension === ".html") return "text/html; charset=utf-8"; if (extension === ".js") return "text/javascript; charset=utf-8"; if (extension === ".css") return "text/css; charset=utf-8"; if (extension === ".svg") return "image/svg+xml"; return "application/octet-stream"; }
