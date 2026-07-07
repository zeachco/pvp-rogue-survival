import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = normalize(join(__dirname, ".."));
const publicRoot = existsSync(join(root, "dist")) ? join(root, "dist") : root;

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";
const MATCH_SCORE_GAP = 80;
const MAX_NEIGHBORS = 2;
const INCOME_INTERVAL_MS = 8000;

const creepDefinitions = {
  basic: { cost: 18, incomeGain: 1, scoreValue: 2 },
  runner: { cost: 36, incomeGain: 3, scoreValue: 4 },
  brute: { cost: 62, incomeGain: 6, scoreValue: 9 }
};

/** @type {Map<string, import("ws").WebSocket & { playerId?: string }>} */
const sockets = new Map();
/** @type {Map<string, { id: string, name: string, score: number, income: number, neighbors: Set<string> }>} */
const players = new Map();

const server = createServer(async (request, response) => {
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

wss.on("connection", (socket) => {
  const connectionId = crypto.randomUUID();
  sockets.set(connectionId, socket);

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      send(socket, { type: "serverNotice", message: "Ignored invalid message." });
      return;
    }
    handleMessage(socket, message);
  });

  socket.on("close", () => {
    const playerId = socket.playerId;
    sockets.delete(connectionId);
    if (playerId) {
      const player = players.get(playerId);
      if (player) {
        for (const neighborId of player.neighbors) {
          players.get(neighborId)?.neighbors.delete(playerId);
        }
      }
      players.delete(playerId);
      rebalanceNeighbors();
      broadcastNeighborSummaries();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Multi-Line Tower server listening on http://${HOST}:${PORT}`);
});

function handleMessage(socket, message) {
  if (message.type === "join") {
    const player = {
      id: crypto.randomUUID(),
      name: String(message.name ?? "Player").slice(0, 20),
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
    const definition = creepDefinitions[message.creepKind];
    if (!definition) return;
    player.income += definition.incomeGain;
    send(socket, {
      type: "purchaseAccepted",
      creepKind: message.creepKind,
      income: player.income,
      goldSpent: definition.cost
    });
    const targets = [...player.neighbors].map((id) => players.get(id)).filter(Boolean);
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
          creepKind: message.creepKind,
          count: message.creepKind === "brute" ? 2 : 4,
          delayMs: 900
        }
      });
    }
    return;
  }

  if (message.type === "creepLeaked") {
    const emitter = players.get(message.emitterId);
    if (!emitter || emitter.id === player.id) return;
    const definition = creepDefinitions[message.creepKind] ?? creepDefinitions.basic;
    emitter.score += definition.scoreValue;
    sendToPlayer(emitter.id, {
      type: "scoreAwarded",
      score: emitter.score,
      reason: `${player.name} leaked your ${message.creepKind}.`
    });
    rebalanceNeighbors();
    broadcastNeighborSummaries();
  }
}

function rebalanceNeighbors() {
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

function broadcastNeighborSummaries() {
  for (const socket of sockets.values()) {
    const player = socket.playerId ? players.get(socket.playerId) : undefined;
    if (!player) continue;
    send(socket, { type: "neighbors", neighbors: neighborSummaries(player) });
  }
}

function neighborSummaries(player) {
  return [...player.neighbors]
    .map((id) => players.get(id))
    .filter(Boolean)
    .map((neighbor) => publicPlayer(neighbor));
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    score: player.score,
    income: player.income
  };
}

function sendToPlayer(playerId, message) {
  for (const socket of sockets.values()) {
    if (socket.playerId === playerId) {
      send(socket, message);
    }
  }
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function contentType(filePath) {
  const extension = extname(filePath);
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}
