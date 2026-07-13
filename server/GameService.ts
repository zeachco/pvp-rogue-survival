import type { BalanceConfig } from "../common/balance.ts";
import { publicBalance } from "../common/balance.ts";
import { collectIntoBackpack, equipFromBackpack, extractFromBackpack, mergeBackpackTriples, sellFromBackpack } from "../common/inventory.ts";
import { generateItem, rollRarity, starterClub } from "../common/items.ts";
import { cumulativeXpForLevel, DEFAULT_ALLOCATION, levelForXp, STAT_KEYS, validAllocation, ZERO_STATS, type Stats } from "../common/progression.ts";
import { PROTOCOL_VERSION, type ClientMessage, type CreepWave, type GroundDrop, type PlayerId, type PlayerProgress, type PublicPlayer, type ServerMessage, type UnitBuild } from "../common/protocol.ts";
import { randomSeed, type RandomSource } from "../common/random.ts";
import { regularCount, regularLevel, rivalLevel, spawnAtMs } from "../common/waves.ts";
import type { Player, PlayerRepository } from "./domain.ts";

export interface GameServiceOptions {
  repository: PlayerRepository;
  balance: BalanceConfig;
  random: RandomSource;
  createId?: () => string;
  send: (playerId: PlayerId, message: ServerMessage) => void;
  matchScoreGap?: number;
  maxNeighbors?: number;
}

export class GameService {
  private readonly createId: () => string;
  private readonly matchScoreGap: number;
  private readonly maxNeighbors: number;

  constructor(private readonly options: GameServiceOptions) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.matchScoreGap = options.matchScoreGap ?? 80;
    this.maxNeighbors = options.maxNeighbors ?? 2;
  }

  join(name: string, sessionId?: PlayerId, onIdentified?: (playerId: PlayerId) => void): Player {
    const player = this.joinPlayer(name, sessionId);
    onIdentified?.(player.id);
    this.rebalanceNeighbors();
    this.options.send(player.id, {
      type: "welcome", playerId: player.id, player: this.publicPlayer(player), progress: player.progress,
      neighbors: this.neighborSummaries(player),
      config: { matchScoreGap: this.matchScoreGap, maxNeighbors: this.maxNeighbors, waveIntervalMs: this.options.balance.wave.intervalMs, protocolVersion: PROTOCOL_VERSION, balance: publicBalance(this.options.balance) }
    });
    this.broadcastNeighbors();
    if (player.waveNumber === 0) this.advanceWave(player);
    return player;
  }

  disconnect(playerId: PlayerId): void {
    const player = this.options.repository.get(playerId);
    if (player) player.connected = false;
    this.rebalanceNeighbors(); this.broadcastNeighbors();
  }

  handle(playerId: PlayerId, message: Exclude<ClientMessage, { type: "join" }>): void {
    const player = this.options.repository.get(playerId);
    if (!player) return;
    switch (message.type) {
      case "updateAllocation":
        if (!validAllocation(message.allocation)) return this.notice(player, "Allocation must be non-negative and total 5.0.");
        player.progress.allocation = { ...message.allocation }; return this.sendProgress(player, "Future level allocation updated.");
      case "creepDefeated": return this.resolveDefeat(player, message.unitId);
      case "collectDrop": return this.collectDrop(player, message.dropId);
      case "heroDefeated":
        player.waveNumber = Math.floor(player.waveNumber / 2); player.issuedUnits.clear(); player.groundDrops.clear();
        this.options.send(player.id, { type: "waveAdjusted", waveNumber: player.waveNumber, reason: `Wave reduced to ${player.waveNumber} after defeat.` });
        return this.broadcastNeighbors();
      case "requestWave": this.dispatchCurrentWave(player); return this.broadcastNeighbors();
      case "equipItem": return this.applyInventoryResult(player, equipFromBackpack(player.progress, message.itemId, () => this.seed()));
      case "sellItem": return this.applyInventoryResult(player, sellFromBackpack(player.progress, message.itemId));
      case "extractSkill": return this.applyInventoryResult(player, extractFromBackpack(player.progress, message.itemId));
      case "scoreSnapshot": return;
    }
  }

  dispatchWaves(): void {
    for (const player of this.options.repository.values()) if (player.connected) this.advanceWave(player);
    this.broadcastNeighbors();
  }

  private joinPlayer(name: string, sessionId?: PlayerId): Player {
    const trimmed = name.trim().slice(0, 20) || "Player";
    const existing = sessionId ? this.options.repository.get(sessionId) : undefined;
    if (existing) {
      existing.name = trimmed; existing.connected = true; this.migrateProgress(existing.progress);
      mergeBackpackTriples(existing.progress, () => this.seed()); return existing;
    }
    const player: Player = {
      id: this.createId(), name: trimmed, score: 0, waveNumber: 0, neighbors: new Set(), connected: true,
      issuedUnits: new Map(), groundDrops: new Map(),
      progress: { level: 0, xp: 0, stats: { ...ZERO_STATS }, allocation: { ...DEFAULT_ALLOCATION }, gold: 0, equipped: starterClub(), backpack: [], learnedSkills: ["healing"], learnedSkillLevels: { healing: 1 } }
    };
    this.options.repository.save(player); return player;
  }

  private advanceWave(player: Player): void { player.waveNumber += 1; this.dispatchCurrentWave(player); }

  private dispatchCurrentWave(player: Player): void {
    const count = regularCount(player.waveNumber, this.options.balance);
    const level = regularLevel(player.waveNumber, player.progress.level, count, this.options.balance);
    const seed = this.seed();
    const template = this.generateBuild("Perimeter creep", level, false, seed, undefined, true);
    const spawns: CreepWave["spawns"] = [];
    for (let index = 0; index < count; index += 1) {
      const build = { ...template, id: this.createId() };
      player.issuedUnits.set(build.id, build);
      spawns.push({ build, spawnAtMs: spawnAtMs(index, count, this.options.balance) });
    }
    const rivalBuildLevel = rivalLevel(player.waveNumber, player.progress.level, this.options.balance);
    const neighbor = [...player.neighbors].map((id) => this.options.repository.get(id)).find(isPlayer);
    const stats = neighbor ? scaledStats(neighbor.progress.allocation, rivalBuildLevel) : undefined;
    const rival = this.generateBuild(neighbor ? `${neighbor.name}'s echo` : "Wandering rival", rivalBuildLevel, true, this.seed(), stats, false);
    player.issuedUnits.set(rival.id, rival);
    spawns.push({ build: rival, spawnAtMs: this.options.balance.wave.prepareMs + Math.floor(7.5 * this.options.balance.wave.batchIntervalMs) });
    spawns.sort((a, b) => a.spawnAtMs - b.spawnAtMs);
    this.options.send(player.id, { type: "incomingWave", wave: { id: this.createId(), targetId: player.id, waveNumber: player.waveNumber, durationMs: this.options.balance.wave.intervalMs, spawns } });
  }

  private generateBuild(name: string, level: number, isRival: boolean, seed: number, suppliedStats?: Stats, fewerItems = false): UnitBuild {
    const stats = suppliedStats ?? scaledStats(randomAllocation(seed), level);
    const equipped = generateItem(level, rollRarity(seed + 11), seed + 17, { fewerAffixes: fewerItems });
    const backpack = isRival && level > 0 ? [generateItem(level, rollRarity(seed + 23), seed + 29, { fewerAffixes: true })] : [];
    return { id: this.createId(), name, kind: isRival ? "rival" : equipped.definitionId === "staff" ? "bubbleShooter" : "melee", level, stats, equipped, backpack, isRival, xpReward: isRival ? cumulativeXpForLevel(level) : 10 + level, goldReward: isRival ? 3 + Math.floor(level / 2) : 1 + Math.floor(level / 5), seed };
  }

  private resolveDefeat(player: Player, unitId: string): void {
    const build = player.issuedUnits.get(unitId);
    if (!build) return this.notice(player, "Ignored an unknown or already resolved enemy.");
    player.issuedUnits.delete(unitId);
    player.score += build.isRival ? 10 : 2;
    const xp = Math.floor(build.xpReward * this.options.balance.rewards.xpMultiplier);
    const goldChance = Math.min(1, (build.isRival ? 0.5 : 0.2) * this.options.balance.rewards.goldChanceMultiplier);
    const gold = this.options.random.next() < goldChance ? build.goldReward : 0;
    player.progress.gold += gold;
    this.grantXp(player, xp);
    const drop = this.rollDrop(player, build);
    const reason = gold ? `Gained ${xp} XP and found ${gold} gold.` : `Gained ${xp} XP.`;
    this.options.send(player.id, { type: "creepDefeatResolved", unitId, score: player.score, progress: player.progress, drop, reason });
    this.rebalanceNeighbors(); this.broadcastNeighbors();
  }

  private rollDrop(player: Player, build: UnitBuild): GroundDrop | undefined {
    for (const item of [build.equipped, ...build.backpack]) {
      const chance = Math.min(this.options.balance.rewards.maxDropChance, item.dropChance * this.options.balance.rewards.dropChanceMultiplier);
      if (this.options.random.next() >= chance) continue;
      const id = this.createId();
      const dropped = { ...item, id: `${item.id}-drop-${id}` };
      player.groundDrops.set(id, dropped);
      return { id, item: dropped };
    }
    return undefined;
  }

  private collectDrop(player: Player, dropId: string): void {
    const item = player.groundDrops.get(dropId);
    if (!item) return this.options.send(player.id, { type: "collectItemResult", dropId, collected: false, reason: "That drop is no longer available." });
    const result = collectIntoBackpack(player.progress, item, () => this.seed());
    if (result.changed) player.groundDrops.delete(dropId);
    this.options.send(player.id, { type: "collectItemResult", dropId, collected: result.changed, reason: result.reason });
    if (result.changed) this.sendProgress(player, result.reason);
  }

  private grantXp(player: Player, amount: number): void {
    const oldLevel = player.progress.level; player.progress.xp += amount;
    const newLevel = levelForXp(player.progress.xp);
    for (let level = oldLevel; level < newLevel; level += 1) for (const key of STAT_KEYS) player.progress.stats[key] += player.progress.allocation[key];
    player.progress.level = newLevel;
  }

  private applyInventoryResult(player: Player, result: { changed: boolean; reason: string }): void { result.changed ? this.sendProgress(player, result.reason) : this.notice(player, result.reason); }
  private sendProgress(player: Player, reason: string): void { this.options.send(player.id, { type: "progressionUpdated", progress: player.progress, reason }); }
  private notice(player: Player, message: string): void { this.options.send(player.id, { type: "serverNotice", message }); }
  private seed(): number { return randomSeed(this.options.random); }
  private migrateProgress(progress: PlayerProgress): void { progress.learnedSkillLevels ??= {}; for (const skill of progress.learnedSkills) progress.learnedSkillLevels[skill] ??= 1; }

  private rebalanceNeighbors(): void {
    for (const player of this.options.repository.values()) player.neighbors.clear();
    for (const player of this.options.repository.values()) {
      if (!player.connected) continue;
      const candidates = [...this.options.repository.values()].filter((candidate) => candidate.connected && candidate.id !== player.id && Math.abs(candidate.score - player.score) <= this.matchScoreGap).sort((a, b) => Math.abs(a.score - player.score) - Math.abs(b.score - player.score));
      for (const candidate of candidates) { if (player.neighbors.size >= this.maxNeighbors) break; if (candidate.neighbors.size >= this.maxNeighbors) continue; player.neighbors.add(candidate.id); candidate.neighbors.add(player.id); }
    }
  }
  private broadcastNeighbors(): void { for (const player of this.options.repository.values()) if (player.connected) this.options.send(player.id, { type: "neighbors", neighbors: this.neighborSummaries(player) }); }
  private neighborSummaries(player: Player): PublicPlayer[] { return [...player.neighbors].map((id) => this.options.repository.get(id)).filter(isPlayer).map((entry) => this.publicPlayer(entry)); }
  private publicPlayer(player: Player): PublicPlayer { return { id: player.id, name: player.name, score: player.score, waveNumber: player.waveNumber, level: player.progress.level }; }
}

function randomAllocation(seed: number): Stats { const values = STAT_KEYS.map((_, index) => ((seed >>> (index * 5)) & 15) + 1); const total = values.reduce((sum, value) => sum + value, 0); return Object.fromEntries(STAT_KEYS.map((key, index) => [key, 5 * values[index] / total])) as Stats; }
function scaledStats(allocation: Stats, level: number): Stats { return Object.fromEntries(STAT_KEYS.map((key) => [key, allocation[key] * level])) as Stats; }
function isPlayer(player: Player | undefined): player is Player { return Boolean(player); }
