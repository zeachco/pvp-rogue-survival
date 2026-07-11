import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { generateItem, meetsRequirements, rollRarity, starterClub } from "../common/items.ts";
import { cumulativeXpForLevel, DEFAULT_ALLOCATION, levelForXp, STAT_KEYS, validAllocation, ZERO_STATS, type Stats } from "../common/progression.ts";
import type { ClientMessage, CreepKind, CreepWave, PlayerId, PlayerProgress, PublicPlayer, ServerMessage, UnitBuild } from "../common/protocol.ts";

interface Player { id: PlayerId; name: string; score: number; waveNumber: number; progress: PlayerProgress; neighbors: Set<PlayerId>; connected: boolean }
interface PlayerSocket extends WebSocket { playerId?: PlayerId }

const root = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const publicRoot = existsSync(join(root, "dist")) ? join(root, "dist") : root;
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";
const MATCH_SCORE_GAP = 80;
const MAX_NEIGHBORS = 2;
const WAVE_INTERVAL_MS = 60_000;
const BATCH_INTERVAL_MS = 5_000;
const WAVE_PREPARE_MS = 3_000;
const sockets = new Map<string, PlayerSocket>();
const players = new Map<PlayerId, Player>();

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(publicRoot, pathname));
  if (!filePath.startsWith(publicRoot)) { response.writeHead(403); response.end("Forbidden"); return; }
  try { const body = await readFile(filePath); response.writeHead(200, { "content-type": contentType(filePath) }); response.end(body); }
  catch { const index = await readFile(join(publicRoot, "index.html")); response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(index); }
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (socket: PlayerSocket) => {
  const connectionId = crypto.randomUUID(); sockets.set(connectionId, socket);
  socket.on("message", (raw: RawData) => { const message = parseClientMessage(raw); message ? handleMessage(socket, message) : send(socket, { type: "serverNotice", message: "Ignored invalid message." }); });
  socket.on("close", () => {
    sockets.delete(connectionId);
    const player = socket.playerId ? players.get(socket.playerId) : undefined;
    if (player) player.connected = hasOpenSocketForPlayer(player.id);
    rebalanceNeighbors(); broadcastNeighborSummaries();
  });
});
server.listen(PORT, HOST, () => console.log(`Multi-Line Hero server listening on http://${HOST}:${PORT}`));
setInterval(dispatchWaves, WAVE_INTERVAL_MS);

function handleMessage(socket: PlayerSocket, message: ClientMessage): void {
  if (message.type === "join") {
    const player = joinPlayer(message.name, message.sessionId); socket.playerId = player.id;
    rebalanceNeighbors();
    send(socket, { type: "welcome", playerId: player.id, player: publicPlayer(player), progress: player.progress, neighbors: neighborSummaries(player), config: { matchScoreGap: MATCH_SCORE_GAP, maxNeighbors: MAX_NEIGHBORS, waveIntervalMs: WAVE_INTERVAL_MS } });
    broadcastNeighborSummaries();
    if (player.waveNumber === 0) dispatchWave(player);
    return;
  }
  const player = socket.playerId ? players.get(socket.playerId) : undefined;
  if (!player) { send(socket, { type: "serverNotice", message: "Join before playing." }); return; }
  if (message.type === "updateAllocation") {
    if (!validAllocation(message.allocation)) { send(socket, { type: "serverNotice", message: "Allocation must be non-negative and total 5.0." }); return; }
    player.progress.allocation = copyStats(message.allocation); sendProgress(player, "Future level allocation updated.");
  } else if (message.type === "creepKilled") {
    player.score += message.isRival ? 10 : 2;
    grantXp(player, Math.max(0, Math.floor(message.xpReward)));
    sendToPlayer(player.id, { type: "scoreAwarded", score: player.score, reason: `Defeated ${message.isRival ? "a rival" : "a creep"}.` });
    rebalanceNeighbors(); broadcastNeighborSummaries();
  } else if (message.type === "collectItem") {
    if (player.progress.backpack.length >= 8) { send(socket, { type: "serverNotice", message: "Backpack is full." }); return; }
    player.progress.backpack.push(message.item); sendProgress(player, `Picked up ${message.item.name}.`);
  } else if (message.type === "equipItem") equipItem(player, message.itemId);
  else if (message.type === "sellItem") sellItem(player, message.itemId);
}

function joinPlayer(name: string, sessionId?: PlayerId): Player {
  const trimmed = name.trim().slice(0, 20) || "Player";
  const existing = sessionId ? players.get(sessionId) : undefined;
  if (existing) { existing.name = trimmed; existing.connected = true; return existing; }
  const player: Player = {
    id: crypto.randomUUID(), name: trimmed, score: 0, waveNumber: 0, neighbors: new Set(), connected: true,
    progress: { level: 0, xp: 0, stats: copyStats(ZERO_STATS), allocation: copyStats(DEFAULT_ALLOCATION), gold: 0, equipped: starterClub(), backpack: [], learnedSkills: ["healing"] }
  };
  players.set(player.id, player); return player;
}

function dispatchWaves(): void { for (const player of players.values()) if (player.connected) dispatchWave(player); broadcastNeighborSummaries(); }
function dispatchWave(player: Player): void {
  player.waveNumber += 1;
  const count = 10 + 2 * player.waveNumber;
  const regularLevel = Math.floor(player.progress.level / count);
  const seed = randomSeed();
  const template = generateBuild("Perimeter creep", regularLevel, false, seed, undefined, true);
  const spawns: CreepWave["spawns"] = [];
  for (let index = 0; index < count; index += 1) {
    const batch = Math.min(9, Math.floor(index * 10 / count));
    spawns.push({ build: { ...template, id: crypto.randomUUID() }, spawnAtMs: WAVE_PREPARE_MS + batch * BATCH_INTERVAL_MS });
  }
  const rivalLevel = Math.floor(player.progress.level * 0.8);
  const neighbor = [...player.neighbors].map((id) => players.get(id)).find(isPlayer);
  const rivalStats = neighbor ? scaledStats(neighbor.progress.allocation, rivalLevel) : undefined;
  spawns.push({ build: generateBuild(neighbor ? `${neighbor.name}'s echo` : "Wandering rival", rivalLevel, true, randomSeed(), rivalStats, false), spawnAtMs: WAVE_PREPARE_MS + Math.floor(7.5 * BATCH_INTERVAL_MS) });
  spawns.sort((a, b) => a.spawnAtMs - b.spawnAtMs);
  sendToPlayer(player.id, { type: "incomingWave", wave: { id: crypto.randomUUID(), targetId: player.id, waveNumber: player.waveNumber, durationMs: WAVE_INTERVAL_MS, spawns } });
  console.log(`[MLH][${player.name}] wave ${player.waveNumber}`, { count, regularLevel, rivalLevel });
}

function generateBuild(name: string, level: number, isRival: boolean, seed: number, suppliedStats?: Stats, fewerItems = false): UnitBuild {
  const stats = suppliedStats ?? scaledStats(randomAllocation(seed), level);
  const itemLevel = Math.max(0, level);
  const equipped = generateItem(itemLevel, rollRarity(seed + 11), seed + 17, { fewerAffixes: fewerItems });
  const backpack = isRival && level > 0 ? [generateItem(itemLevel, rollRarity(seed + 23), seed + 29, { fewerAffixes: true })] : [];
  return { id: crypto.randomUUID(), name, kind: isRival ? "rival" : equipped.definitionId === "staff" ? "bubbleShooter" : "melee", level, stats, equipped, backpack, isRival, xpReward: isRival ? cumulativeXpForLevel(level) : 10 + level, seed };
}

function grantXp(player: Player, amount: number): void {
  const oldLevel = player.progress.level; player.progress.xp += amount;
  const newLevel = levelForXp(player.progress.xp);
  for (let level = oldLevel; level < newLevel; level += 1) for (const key of STAT_KEYS) player.progress.stats[key] += player.progress.allocation[key];
  player.progress.level = newLevel; sendProgress(player, amount > 0 ? `Gained ${amount} XP.` : "Progress updated.");
}
function equipItem(player: Player, itemId: string): void {
  const index = player.progress.backpack.findIndex((item) => item.id === itemId);
  if (index < 0) return;
  const item = player.progress.backpack[index];
  if (!meetsRequirements(item, player.progress.stats)) { sendToPlayer(player.id, { type: "serverNotice", message: "You do not meet that weapon's requirements." }); return; }
  player.progress.backpack[index] = player.progress.equipped; player.progress.equipped = item; sendProgress(player, `Equipped ${item.name}.`);
}
function sellItem(player: Player, itemId: string): void {
  const index = player.progress.backpack.findIndex((item) => item.id === itemId); if (index < 0) return;
  const [item] = player.progress.backpack.splice(index, 1); player.progress.gold += item.sellValue; sendProgress(player, `Sold ${item.name} for ${item.sellValue} gold.`);
}
function sendProgress(player: Player, reason: string): void { sendToPlayer(player.id, { type: "progressionUpdated", progress: player.progress, reason }); }
function randomAllocation(seed: number): Stats { const values = STAT_KEYS.map((_, index) => ((seed >>> (index * 5)) & 15) + 1); const total = values.reduce((sum, value) => sum + value, 0); return Object.fromEntries(STAT_KEYS.map((key, index) => [key, 5 * values[index] / total])) as unknown as Stats; }
function scaledStats(allocation: Stats, level: number): Stats { return Object.fromEntries(STAT_KEYS.map((key) => [key, allocation[key] * level])) as unknown as Stats; }
function copyStats(stats: Stats): Stats { return { ...stats }; }
function randomSeed(): number { return Math.floor(Math.random() * 0x7fffffff); }

function rebalanceNeighbors(): void {
  for (const player of players.values()) player.neighbors.clear();
  for (const player of players.values()) {
    if (!player.connected) continue;
    const candidates = [...players.values()].filter((candidate) => candidate.connected && candidate.id !== player.id && Math.abs(candidate.score - player.score) <= MATCH_SCORE_GAP).sort((a, b) => Math.abs(a.score - player.score) - Math.abs(b.score - player.score));
    for (const candidate of candidates) { if (player.neighbors.size >= MAX_NEIGHBORS) break; if (candidate.neighbors.size >= MAX_NEIGHBORS) continue; player.neighbors.add(candidate.id); candidate.neighbors.add(player.id); }
  }
}
function broadcastNeighborSummaries(): void { for (const socket of sockets.values()) { const player = socket.playerId ? players.get(socket.playerId) : undefined; if (player) send(socket, { type: "neighbors", neighbors: neighborSummaries(player) }); } }
function neighborSummaries(player: Player): PublicPlayer[] { return [...player.neighbors].map((id) => players.get(id)).filter(isPlayer).map(publicPlayer); }
function publicPlayer(player: Player): PublicPlayer { return { id: player.id, name: player.name, score: player.score, waveNumber: player.waveNumber, level: player.progress.level }; }
function sendToPlayer(playerId: PlayerId, message: ServerMessage): void { for (const socket of sockets.values()) if (socket.playerId === playerId) send(socket, message); }
function send(socket: WebSocket, message: ServerMessage): void { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function hasOpenSocketForPlayer(playerId: PlayerId): boolean { return [...sockets.values()].some((socket) => socket.playerId === playerId && socket.readyState === WebSocket.OPEN); }
function parseClientMessage(raw: RawData): ClientMessage | undefined { try { const value = JSON.parse(String(raw)) as ClientMessage; return value && typeof value === "object" && "type" in value ? value : undefined; } catch { return undefined; } }
function isPlayer(player: Player | undefined): player is Player { return Boolean(player); }
function contentType(filePath: string): string { const extension = extname(filePath); if (extension === ".html") return "text/html; charset=utf-8"; if (extension === ".js") return "text/javascript; charset=utf-8"; if (extension === ".css") return "text/css; charset=utf-8"; if (extension === ".svg") return "image/svg+xml"; return "application/octet-stream"; }
