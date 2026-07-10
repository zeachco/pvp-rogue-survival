import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  type ClientMessage,
  type CreepWaveGroup,
  type CreepKind,
  type PlayerId,
  type PublicPlayer,
  type ServerMessage
} from "../common/protocol.ts";

interface Player {
  id: PlayerId;
  name: string;
  score: number;
  waveNumber: number;
  neighbors: Set<PlayerId>;
  connected: boolean;
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
const WAVE_INTERVAL_MS = 12000;
const WAVE_DELAY_MS = 700;
const WAVE_SPAWN_INTERVAL_MS = 460;
const BASELINE_MELEE_COUNT = 4;

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

const wss = new WebSocketServer({ server, path: "/ws" });

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
      player.connected = hasOpenSocketForPlayer(playerId);
    }

    rebalanceNeighbors();
    broadcastNeighborSummaries();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Multi-Line Hero server listening on http://${HOST}:${PORT}`);
});

setInterval(dispatchWaves, WAVE_INTERVAL_MS);

function handleMessage(socket: PlayerSocket, message: ClientMessage): void {
  if (message.type === "join") {
    const player = joinPlayer(socket, message.name, message.sessionId);
    socket.playerId = player.id;
    rebalanceNeighbors();
    logPlayer(player, "joined", {
      resumed: Boolean(message.sessionId),
      score: player.score,
      neighbors: [...player.neighbors].length
    });

    send(socket, {
      type: "welcome",
      playerId: player.id,
      player: publicPlayer(player),
      neighbors: neighborSummaries(player),
      config: {
        matchScoreGap: MATCH_SCORE_GAP,
        maxNeighbors: MAX_NEIGHBORS,
        waveIntervalMs: WAVE_INTERVAL_MS
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

  if (message.type === "creepKilled") {
    handleCreepKilled(player, message.creepKind);
    return;
  }

}

function joinPlayer(socket: PlayerSocket, name: string, sessionId: PlayerId | undefined): Player {
  const trimmedName = name.trim().slice(0, 20) || "Player";
  const existing = sessionId ? players.get(sessionId) : undefined;
  if (existing) {
    existing.name = trimmedName;
    existing.connected = true;
    socket.playerId = existing.id;
    return existing;
  }

  const player: Player = {
    id: crypto.randomUUID(),
    name: trimmedName,
    score: 0,
    waveNumber: 0,
    neighbors: new Set(),
    connected: true
  };

  socket.playerId = player.id;
  players.set(player.id, player);
  return player;
}

function dispatchWaves(): void {
  let sentWave = false;
  for (const player of players.values()) {
    if (!player.connected) continue;
    player.waveNumber += 1;
    const creeps: CreepWaveGroup[] = [
      {
        emitterId: "neutral",
        emitterName: "Neutral",
        creepKind: "melee",
        count: BASELINE_MELEE_COUNT + Math.floor(player.waveNumber / 2)
      }
    ];
    if (player.waveNumber >= 3) creeps.push({
      emitterId: "neutral", emitterName: "Neutral", creepKind: "bubbleShooter",
      count: 1 + Math.floor((player.waveNumber - 3) / 3)
    });

    logPlayer(player, "dispatch wave", {
      waveNumber: player.waveNumber,
      groups: creeps.map((group) => `${group.emitterName}:${group.creepKind}:${group.count}`)
    });
    sendToPlayer(player.id, {
      type: "incomingWave",
      wave: {
        id: crypto.randomUUID(),
        targetId: player.id,
        waveNumber: player.waveNumber,
        creeps,
        delayMs: WAVE_DELAY_MS,
        spawnIntervalMs: WAVE_SPAWN_INTERVAL_MS
      }
    });
    sentWave = true;
  }

  if (sentWave) {
    broadcastNeighborSummaries();
  }
}

function handleCreepKilled(defender: Player, creepKind: CreepKind): void {
  const scoreValue = creepKind === "bubbleShooter" ? 4 : 2;
  defender.score += scoreValue;
  logPlayer(defender, "creep killed", { creepKind, score: defender.score });
  sendToPlayer(defender.id, {
    type: "scoreAwarded",
    score: defender.score,
    reason: `Killed a ${creepKind}.`
  });

  rebalanceNeighbors();
  broadcastNeighborSummaries();
}

function rebalanceNeighbors(): void {
  for (const player of players.values()) {
    player.neighbors.clear();
  }

  for (const player of players.values()) {
    if (!player.connected) continue;
    const candidates = [...players.values()]
      .filter((candidate) => candidate.connected && candidate.id !== player.id)
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
    waveNumber: player.waveNumber
  };
}

function sendToPlayer(playerId: PlayerId, message: ServerMessage): void {
  for (const socket of sockets.values()) {
    if (socket.playerId === playerId) {
      send(socket, message);
    }
  }
}

function hasOpenSocketForPlayer(playerId: PlayerId): boolean {
  for (const socket of sockets.values()) {
    if (socket.playerId === playerId && socket.readyState === WebSocket.OPEN) {
      return true;
    }
  }
  return false;
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function logPlayer(player: Player, event: string, detail?: unknown): void {
  console.log(`[MLT][${player.name}] ${event}`, detail ?? "");
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
