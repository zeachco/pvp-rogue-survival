import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  CREEP_DEFINITIONS,
  type ClientMessage,
  type CreepKind,
  type PlayerId,
  type PublicPlayer,
  type ServerMessage
} from "../common/protocol.ts";

interface Player {
  id: PlayerId;
  name: string;
  score: number;
  income: number;
  neighbors: Set<PlayerId>;
}

interface PlayerSocket extends WebSocket {
  playerId?: PlayerId;
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = normalize(join(__dirname, ".."));
const publicRoot = existsSync(join(root, "dist")) ? join(root, "dist") : root;

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";
const MATCH_SCORE_GAP = 80;
const MAX_NEIGHBORS = 2;
const INCOME_INTERVAL_MS = 8000;

const sockets = new Map<string, PlayerSocket>();
const players = new Map<PlayerId, Player>();

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(publicRoot, pathname));

  if (!filePath.startsWith(publicRoot)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": contentType(filePath) });
    response.end(body);
  } catch {
    const index = await readFile(join(publicRoot, "index.html"));
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(index);
  }
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket: PlayerSocket) => {
  const connectionId = crypto.randomUUID();
  sockets.set(connectionId, socket);

  socket.on("message", (raw: RawData) => {
    const message = parseClientMessage(raw);
    if (!message) {
      send(socket, { type: "serverNotice", message: "Ignored invalid message." });
      return;
    }
    handleMessage(socket, message);
  });

  socket.on("close", () => {
    const playerId = socket.playerId;
    sockets.delete(connectionId);
    if (!playerId) return;

    const player = players.get(playerId);
    if (player) {
      for (const neighborId of player.neighbors) {
        players.get(neighborId)?.neighbors.delete(playerId);
      }
    }

    players.delete(playerId);
    rebalanceNeighbors();
    broadcastNeighborSummaries();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Multi-Line Tower server listening on http://${HOST}:${PORT}`);
});

function handleMessage(socket: PlayerSocket, message: ClientMessage): void {
  if (message.type === "join") {
    const player: Player = {
      id: crypto.randomUUID(),
      name: message.name.trim().slice(0, 20) || "Player",
      score: 0,
      income: 10,
      neighbors: new Set()
    };

    socket.playerId = player.id;
    players.set(player.id, player);
    rebalanceNeighbors();

    send(socket, {
      type: "welcome",
      playerId: player.id,
      player: publicPlayer(player),
      neighbors: neighborSummaries(player),
      config: {
        incomeIntervalMs: INCOME_INTERVAL_MS,
        matchScoreGap: MATCH_SCORE_GAP,
        maxNeighbors: MAX_NEIGHBORS
      }
    });

    broadcastNeighborSummaries();
    if (player.neighbors.size === 0) {
      send(socket, { type: "serverNotice", message: "No close-score neighbors yet. Neutral creeps will spawn locally." });
    }
    return;
  }

  const player = socket.playerId ? players.get(socket.playerId) : undefined;
  if (!player) {
    send(socket, { type: "serverNotice", message: "Join before playing." });
    return;
  }

  if (message.type === "buyCreep") {
    handleBuyCreep(socket, player, message.creepKind);
    return;
  }

  if (message.type === "creepKilled") {
    handleCreepKilled(player, message.creepKind);
    return;
  }

  if (message.type === "creepLeaked") {
    handleCreepLeaked(player, message.emitterId, message.creepKind);
  }
}

function handleBuyCreep(socket: PlayerSocket, player: Player, creepKind: CreepKind): void {
  const definition = CREEP_DEFINITIONS[creepKind];
  player.income += definition.incomeGain;

  send(socket, {
    type: "purchaseAccepted",
    creepKind,
    income: player.income,
    goldSpent: definition.cost
  });

  const targets = [...player.neighbors].map((id) => players.get(id)).filter(isPlayer);
  if (targets.length === 0) {
    send(socket, { type: "serverNotice", message: "No neighbors yet. Purchase increased income but sent no wave." });
    return;
  }

  for (const target of targets) {
    sendToPlayer(target.id, {
      type: "incomingWave",
      wave: {
        id: crypto.randomUUID(),
        emitterId: player.id,
        emitterName: player.name,
        targetId: target.id,
        creepKind,
        count: creepKind === "brute" ? 2 : 4,
        delayMs: 900
      }
    });
  }
}

function handleCreepKilled(defender: Player, creepKind: CreepKind): void {
  const definition = CREEP_DEFINITIONS[creepKind];
  defender.score += definition.scoreValue;
  sendToPlayer(defender.id, {
    type: "scoreAwarded",
    score: defender.score,
    reason: `Killed a ${creepKind}.`
  });

  rebalanceNeighbors();
  broadcastNeighborSummaries();
}

function handleCreepLeaked(defender: Player, emitterId: PlayerId | "neutral", creepKind: CreepKind): void {
  if (emitterId === "neutral" || emitterId === defender.id) return;
  const emitter = players.get(emitterId);
  if (!emitter) return;

  const definition = CREEP_DEFINITIONS[creepKind];
  emitter.score += definition.scoreValue;
  sendToPlayer(emitter.id, {
    type: "scoreAwarded",
    score: emitter.score,
    reason: `${defender.name} leaked your ${creepKind}.`
  });

  rebalanceNeighbors();
  broadcastNeighborSummaries();
}

function rebalanceNeighbors(): void {
  for (const player of players.values()) {
    player.neighbors.clear();
  }

  for (const player of players.values()) {
    const candidates = [...players.values()]
      .filter((candidate) => candidate.id !== player.id)
      .map((candidate) => ({ candidate, delta: Math.abs(candidate.score - player.score) }))
      .filter(({ delta }) => delta <= MATCH_SCORE_GAP)
      .sort((a, b) => a.delta - b.delta);

    for (const { candidate } of candidates) {
      if (player.neighbors.size >= MAX_NEIGHBORS) break;
      if (candidate.neighbors.size >= MAX_NEIGHBORS) continue;
      player.neighbors.add(candidate.id);
      candidate.neighbors.add(player.id);
    }
  }
}

function broadcastNeighborSummaries(): void {
  for (const socket of sockets.values()) {
    const player = socket.playerId ? players.get(socket.playerId) : undefined;
    if (!player) continue;
    send(socket, { type: "neighbors", neighbors: neighborSummaries(player) });
  }
}

function neighborSummaries(player: Player): PublicPlayer[] {
  return [...player.neighbors].map((id) => players.get(id)).filter(isPlayer).map(publicPlayer);
}

function publicPlayer(player: Player): PublicPlayer {
  return {
    id: player.id,
    name: player.name,
    score: player.score,
    income: player.income
  };
}

function sendToPlayer(playerId: PlayerId, message: ServerMessage): void {
  for (const socket of sockets.values()) {
    if (socket.playerId === playerId) {
      send(socket, message);
    }
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function parseClientMessage(raw: RawData): ClientMessage | undefined {
  try {
    const parsed = JSON.parse(String(raw)) as ClientMessage;
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function isPlayer(player: Player | undefined): player is Player {
  return Boolean(player);
}

function contentType(filePath: string): string {
  const extension = extname(filePath);
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}
