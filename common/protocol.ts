import { z } from "zod";
import type { BalanceConfig } from "./balance";
import type { ItemInstance, SkillId } from "./items";
import type { Stats } from "./progression";

export const PROTOCOL_VERSION = 1;
export type PlayerId = string;
export type CreepKind = "melee" | "bubbleShooter" | "rival";

export interface PlayerProgress {
  level: number; xp: number; stats: Stats; allocation: Stats; gold: number;
  equipped: ItemInstance; backpack: ItemInstance[]; learnedSkills: SkillId[]; learnedSkillLevels: Partial<Record<SkillId, number>>;
}
export interface PublicPlayer { id: PlayerId; name: string; score: number; waveNumber: number; level: number }
export interface ServerConfig { matchScoreGap: number; maxNeighbors: number; waveIntervalMs: number; protocolVersion: number; balance: BalanceConfig }

export interface UnitBuild {
  id: string; name: string; kind: CreepKind; level: number; stats: Stats;
  equipped: ItemInstance; backpack: ItemInstance[]; isRival: boolean; xpReward: number; goldReward: number; seed: number;
}
export interface WaveSpawn { build: UnitBuild; spawnAtMs: number }
export interface CreepWave { id: string; targetId: PlayerId; waveNumber: number; durationMs: number; spawns: WaveSpawn[] }
export interface GroundDrop { id: string; item: ItemInstance }

const statKeys = ["agility", "strength", "magic", "spirit", "intelligence"] as const;
const skillIds = ["bash", "sweep", "flurry", "arcaneBolt", "healing"] as const;
const statsSchema = z.object(Object.fromEntries(statKeys.map((key) => [key, z.number().finite()])) as Record<(typeof statKeys)[number], z.ZodNumber>);
const partialStatsSchema = z.object(Object.fromEntries(statKeys.map((key) => [key, z.number().finite().optional()])) as Record<(typeof statKeys)[number], z.ZodOptional<z.ZodNumber>>);
const modifiersSchema = z.object({ damageMultiplier: z.number(), attackSpeedMultiplier: z.number(), critChance: z.number(), manaRegenMultiplier: z.number(), magicAmp: z.number(), bleedChance: z.number(), poisonChance: z.number(), stunChance: z.number() });
const itemSchema = z.object({ id: z.string(), definitionId: z.enum(["club", "sword", "dagger", "mace", "staff"]), name: z.string(), level: z.number(), rarity: z.enum(["common", "uncommon", "rare", "epic"]), seed: z.number(), requirements: partialStatsSchema, statBonuses: partialStatsSchema, modifiers: modifiersSchema, skills: z.array(z.enum(skillIds)), staminaCost: z.number(), dropChance: z.number(), sellValue: z.number() });
const learnedLevelsSchema = z.object(Object.fromEntries(skillIds.map((key) => [key, z.number().optional()])) as Record<(typeof skillIds)[number], z.ZodOptional<z.ZodNumber>>);
const progressSchema = z.object({ level: z.number(), xp: z.number(), stats: statsSchema, allocation: statsSchema, gold: z.number(), equipped: itemSchema, backpack: z.array(itemSchema), learnedSkills: z.array(z.enum(skillIds)), learnedSkillLevels: learnedLevelsSchema });
const publicPlayerSchema = z.object({ id: z.string(), name: z.string(), score: z.number(), waveNumber: z.number(), level: z.number() });
const buildSchema = z.object({ id: z.string(), name: z.string(), kind: z.enum(["melee", "bubbleShooter", "rival"]), level: z.number(), stats: statsSchema, equipped: itemSchema, backpack: z.array(itemSchema), isRival: z.boolean(), xpReward: z.number(), goldReward: z.number(), seed: z.number() });
const waveSchema = z.object({ id: z.string(), targetId: z.string(), waveNumber: z.number(), durationMs: z.number(), spawns: z.array(z.object({ build: buildSchema, spawnAtMs: z.number() })) });
const balanceSchema = z.object({ id: z.enum(["normal", "dev"]), wave: z.object({ intervalMs: z.number(), prepareMs: z.number(), batchIntervalMs: z.number(), maxRegulars: z.number(), tierEveryWaves: z.number() }), combat: z.object({ heroDamageMultiplier: z.number(), enemyDamageMultiplier: z.number(), enemyHealthMultiplier: z.number() }), rewards: z.object({ xpMultiplier: z.number(), goldChanceMultiplier: z.number(), dropChanceMultiplier: z.number(), maxDropChance: z.number() }) });

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), name: z.string().max(100), sessionId: z.string().optional() }),
  z.object({ type: z.literal("updateAllocation"), allocation: statsSchema }),
  z.object({ type: z.literal("creepDefeated"), unitId: z.string().min(1) }),
  z.object({ type: z.literal("collectDrop"), dropId: z.string().min(1) }),
  z.object({ type: z.literal("equipItem"), itemId: z.string().min(1) }),
  z.object({ type: z.literal("sellItem"), itemId: z.string().min(1) }),
  z.object({ type: z.literal("extractSkill"), itemId: z.string().min(1) }),
  z.object({ type: z.literal("heroDefeated") }),
  z.object({ type: z.literal("requestWave") }),
  z.object({ type: z.literal("scoreSnapshot"), score: z.number(), health: z.number() })
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ServerMessage =
  | { type: "welcome"; playerId: PlayerId; player: PublicPlayer; progress: PlayerProgress; neighbors: PublicPlayer[]; config: ServerConfig }
  | { type: "neighbors"; neighbors: PublicPlayer[] }
  | { type: "incomingWave"; wave: CreepWave }
  | { type: "waveAdjusted"; waveNumber: number; reason: string }
  | { type: "creepDefeatResolved"; unitId: string; score: number; progress: PlayerProgress; drop?: GroundDrop; reason: string }
  | { type: "collectItemResult"; dropId: string; collected: boolean; reason: string }
  | { type: "progressionUpdated"; progress: PlayerProgress; reason: string }
  | { type: "scoreAwarded"; score: number; reason: string }
  | { type: "serverNotice"; message: string };

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("welcome"), playerId: z.string(), player: publicPlayerSchema, progress: progressSchema, neighbors: z.array(publicPlayerSchema), config: z.object({ matchScoreGap: z.number(), maxNeighbors: z.number(), waveIntervalMs: z.number(), protocolVersion: z.number(), balance: balanceSchema }) }),
  z.object({ type: z.literal("neighbors"), neighbors: z.array(publicPlayerSchema) }),
  z.object({ type: z.literal("incomingWave"), wave: waveSchema }),
  z.object({ type: z.literal("waveAdjusted"), waveNumber: z.number(), reason: z.string() }),
  z.object({ type: z.literal("creepDefeatResolved"), unitId: z.string(), score: z.number(), progress: progressSchema, drop: z.object({ id: z.string(), item: itemSchema }).optional(), reason: z.string() }),
  z.object({ type: z.literal("collectItemResult"), dropId: z.string(), collected: z.boolean(), reason: z.string() }),
  z.object({ type: z.literal("progressionUpdated"), progress: progressSchema, reason: z.string() }),
  z.object({ type: z.literal("scoreAwarded"), score: z.number(), reason: z.string() }),
  z.object({ type: z.literal("serverNotice"), message: z.string() })
]);

export function parseClientMessage(value: unknown): ClientMessage | undefined {
  const result = clientMessageSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function parseServerMessage(value: unknown): ServerMessage | undefined {
  const result = serverMessageSchema.safeParse(value);
  return result.success ? result.data as ServerMessage : undefined;
}

export function isSkillId(value: string): value is SkillId { return skillIds.includes(value as SkillId); }
