import { z } from "zod";
import type { BalanceConfig } from "./balance";
import type { ItemInstance, Rarity, SkillId } from "./items";
import type { Stats } from "./progression";

export const PROTOCOL_VERSION = 3;
export type PlayerId = string;
export type CreepKind = "melee" | "bubbleShooter" | "rival";
export type InventoryAutomation = "keep" | "sell" | "upgrade" | "purge";
export interface InventoryTile { id: string; key: string; item: ItemInstance; quantity: number; automation: InventoryAutomation }
export interface PlayerProgress {
  level: number; xp: number; stats: Stats; allocation: Stats; gold: number; souls: number; scraps: Record<Rarity, number>;
  mainHand: ItemInstance; offHand?: ItemInstance; inventoryTiles: InventoryTile[];
  learnedSkills: SkillId[]; learnedSkillLevels: Partial<Record<SkillId, number>>;
}
export interface PublicPlayer { id: PlayerId; name: string; score: number; waveNumber: number; level: number }
export interface RealmMember extends PublicPlayer { down: boolean }
export interface RealmState { mode: "training" | "waiting" | "competitive"; guards: RealmMember[]; attackers: RealmMember[]; outgoingQueued: number; incomingQueued: number; canLeave: boolean }
export interface ServerConfig { waveIntervalMs: number; protocolVersion: number; maxRealmAttackers: number; maxQueuedItems: number; balance: BalanceConfig }
export interface UnitBuild {
  id: string; name: string; kind: CreepKind; level: number; stats: Stats; mainHand: ItemInstance; offHand?: ItemInstance;
  carried: ItemInstance[]; isRival: boolean; xpReward: number; goldReward: number; seed: number;
  emitterId?: PlayerId; emitterName?: string; backlash?: boolean;
}
export interface WaveSpawn { build: UnitBuild; spawnAtMs: number }
export interface CreepWave { id: string; targetId: PlayerId; waveNumber: number; durationMs: number; mode: "competitive" | "training"; spawns: WaveSpawn[] }
export interface GroundDrop { id: string; item: ItemInstance }

const statsSchema = z.object({ agility: z.number(), strength: z.number(), magic: z.number(), spirit: z.number(), intelligence: z.number() });
const tileCommand = (type: "equipItem" | "sellItem" | "purgeItem" | "upgradeItem" | "sendItem" | "extractSkill") => z.object({ type: z.literal(type), tileId: z.string().min(1) });
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), name: z.string().max(100), sessionId: z.string().optional() }),
  z.object({ type: z.literal("updateAllocation"), allocation: statsSchema }), z.object({ type: z.literal("creepDefeated"), unitId: z.string().min(1) }),
  z.object({ type: z.literal("collectDrop"), dropId: z.string().min(1) }), tileCommand("equipItem"), tileCommand("sellItem"), tileCommand("purgeItem"), tileCommand("upgradeItem"), tileCommand("sendItem"), tileCommand("extractSkill"),
  z.object({ type: z.literal("setStackAutomation"), tileId: z.string().min(1), mode: z.enum(["keep", "sell", "upgrade", "purge"]) }),
  z.object({ type: z.literal("heroDefeated"), sourceUnitId: z.string().optional() }), z.object({ type: z.literal("requestWave") }), z.object({ type: z.literal("leaveRealm") }), z.object({ type: z.literal("enterRealm") }),
  z.object({ type: z.literal("scoreSnapshot"), score: z.number(), health: z.number() })
]);
const serverEnvelope = z.object({ type: z.enum(["welcome", "realmUpdated", "incomingWave", "waveAdjusted", "creepDefeatResolved", "collectItemResult", "progressionUpdated", "groundDropCreated", "scoreAwarded", "serverNotice"]) }).passthrough();
export const serverMessageSchema = serverEnvelope.transform((value) => value as unknown as ServerMessage);

export type ClientMessage =
  | { type: "join"; name: string; sessionId?: string }
  | { type: "updateAllocation"; allocation: Stats }
  | { type: "creepDefeated"; unitId: string }
  | { type: "collectDrop"; dropId: string }
  | { type: "equipItem" | "sellItem" | "purgeItem" | "upgradeItem" | "sendItem" | "extractSkill"; tileId: string }
  | { type: "setStackAutomation"; tileId: string; mode: InventoryAutomation }
  | { type: "heroDefeated"; sourceUnitId?: string }
  | { type: "requestWave" | "leaveRealm" | "enterRealm" }
  | { type: "scoreSnapshot"; score: number; health: number };

export type ServerMessage =
  | { type: "welcome"; playerId: PlayerId; player: PublicPlayer; progress: PlayerProgress; realm: RealmState; config: ServerConfig }
  | { type: "realmUpdated"; realm: RealmState }
  | { type: "incomingWave"; wave: CreepWave }
  | { type: "waveAdjusted"; waveNumber: number; reason: string }
  | { type: "creepDefeatResolved"; unitId: string; score: number; progress: PlayerProgress; drop?: GroundDrop; reason: string }
  | { type: "collectItemResult"; dropId: string; collected: boolean; reason: string }
  | { type: "progressionUpdated"; progress: PlayerProgress; reason: string }
  | { type: "groundDropCreated"; drop: GroundDrop }
  | { type: "scoreAwarded"; score: number; reason: string }
  | { type: "serverNotice"; message: string };

export function parseClientMessage(value: unknown): ClientMessage | undefined { const result = clientMessageSchema.safeParse(value); return result.success ? result.data : undefined; }
export function parseServerMessage(value: unknown): ServerMessage | undefined { const result = serverMessageSchema.safeParse(value); return result.success ? result.data : undefined; }
export function isSkillId(value: string): value is SkillId { return ["bash", "sweep", "flurry", "arcaneBolt", "healing"].includes(value); }
