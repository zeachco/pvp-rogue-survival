import type { ItemInstance, SkillId } from "./items";
import type { Stats } from "./progression";

export type PlayerId = string;
export type CreepKind = "melee" | "bubbleShooter" | "rival";

export interface PlayerProgress {
  level: number; xp: number; stats: Stats; allocation: Stats; gold: number;
  equipped: ItemInstance; backpack: ItemInstance[]; learnedSkills: SkillId[];
}
export interface PublicPlayer { id: PlayerId; name: string; score: number; waveNumber: number; level: number }
export interface ServerConfig { matchScoreGap: number; maxNeighbors: number; waveIntervalMs: number }

export interface UnitBuild {
  id: string; name: string; kind: CreepKind; level: number; stats: Stats;
  equipped: ItemInstance; backpack: ItemInstance[]; isRival: boolean; xpReward: number; seed: number;
}
export interface WaveSpawn { build: UnitBuild; spawnAtMs: number }
export interface CreepWave { id: string; targetId: PlayerId; waveNumber: number; durationMs: number; spawns: WaveSpawn[] }

export type ClientMessage =
  | { type: "join"; name: string; sessionId?: PlayerId }
  | { type: "updateAllocation"; allocation: Stats }
  | { type: "creepKilled"; unitId: string; isRival: boolean; xpReward: number; droppedItem?: ItemInstance }
  | { type: "collectItem"; item: ItemInstance }
  | { type: "equipItem"; itemId: string }
  | { type: "sellItem"; itemId: string }
  | { type: "scoreSnapshot"; score: number; health: number };

export type ServerMessage =
  | { type: "welcome"; playerId: PlayerId; player: PublicPlayer; progress: PlayerProgress; neighbors: PublicPlayer[]; config: ServerConfig }
  | { type: "neighbors"; neighbors: PublicPlayer[] }
  | { type: "incomingWave"; wave: CreepWave }
  | { type: "progressionUpdated"; progress: PlayerProgress; reason: string }
  | { type: "scoreAwarded"; score: number; reason: string }
  | { type: "serverNotice"; message: string };
