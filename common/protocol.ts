import { z } from "zod";
import type { BalanceConfig } from "./balance";
import type { ItemInstance, Rarity, SkillId } from "./items";
import type { Stats } from "./progression";

export const PROTOCOL_VERSION = 22;
export type PlayerId = string;
export type CreepKind = "melee" | "bubbleShooter" | "rival";
export interface InventoryTile { id: string; key: string; item: ItemInstance; quantity: number }
export interface PlayerProgress {
  level: number; xp: number; stats: Stats; allocation: Stats; gold: number; souls: number; scraps: Record<Rarity, number>;
  mainHand: ItemInstance; offHand?: ItemInstance; inventoryTiles: InventoryTile[];
  learnedSkills: SkillId[]; learnedSkillLevels: Partial<Record<SkillId, number>>; universalSkills: SkillId[];
}
export interface PublicPlayer { id: PlayerId; name: string; score: number; waveNumber: number; level: number; receivesDeathEchoes: boolean }
export interface HeroSummary { id: PlayerId; username: string; level: number; connected: boolean; receivesDeathEchoes: boolean }
export interface PublicHeroProfile { id: PlayerId; username: string; level: number; maxWaveReached: number; stats: Stats; mainHand: ItemInstance; offHand?: ItemInstance; learnedSkills: SkillId[]; learnedSkillLevels: Partial<Record<SkillId, number>>; universalSkills: SkillId[] }
export interface RealmMember extends PublicPlayer { down: boolean }
export interface RealmState { mode: "training" | "waiting" | "competitive"; guards: RealmMember[]; attackers: RealmMember[]; outgoingQueued: number; incomingQueued: number; canLeave: boolean }
export interface ServerConfig { waveIntervalMs: number; protocolVersion: number; maxRealmAttackers: number; maxQueuedItems: number; balance: BalanceConfig }
export interface UnitBuild {
  id: string; name: string; kind: CreepKind; level: number; stats: Stats; mainHand: ItemInstance; offHand?: ItemInstance;
  carried: ItemInstance[]; isRival: boolean; xpReward: number; goldReward: number; seed: number;
  bonusSkills?: SkillId[];
  emitterId?: PlayerId; emitterName?: string; backlash?: boolean;
}
export interface WaveSpawn { build: UnitBuild; spawnAtMs: number }
export interface CreepWave { id: string; targetId: PlayerId; waveNumber: number; durationMs: number; mode: "competitive" | "solo" | "training"; resetHero: boolean; spawns: WaveSpawn[] }
export type GroundDrop =
  | { id: string; kind: "item"; item: ItemInstance }
  | { id: string; kind: "gold"; amount: number }
  | { id: string; kind: "scrap"; rarity: Rarity; amount: number };

const statsSchema = z.object({ agility: z.number(), strength: z.number(), magic: z.number(), spirit: z.number(), intelligence: z.number() });
const joinSchema = z.object({ type: z.literal("join"), name: z.string().max(20).regex(/^[A-Za-z0-9_-]+$/).optional(), heroId: z.string().min(1).optional() }).refine((value) => Boolean(value.name) !== Boolean(value.heroId));
const tileCommand = (type: "equipItem" | "sellItem" | "purgeItem" | "upgradeItem" | "sendItem" | "extractSkill") => z.object({ type: z.literal(type), tileId: z.string().min(1), bulk: z.boolean().optional() });
export const clientMessageSchema = z.discriminatedUnion("type", [
  joinSchema,
  z.object({ type: z.literal("updateAllocation"), allocation: statsSchema }), z.object({ type: z.literal("respecStats"), allocation: statsSchema }), z.object({ type: z.literal("creepDefeated"), unitId: z.string().min(1) }),
  z.object({ type: z.literal("collectDrop"), dropId: z.string().min(1) }), z.object({ type: z.literal("reconcileDrops"), activeDropIds: z.array(z.string()), pendingDropIds: z.array(z.string()) }), z.object({ type: z.literal("deferDrop"), dropId: z.string().min(1) }), tileCommand("equipItem"), tileCommand("sellItem"), tileCommand("purgeItem"), tileCommand("upgradeItem"), tileCommand("sendItem"), tileCommand("extractSkill"),
  z.object({ type: z.literal("heroDefeated"), sourceUnitId: z.string().optional() }), z.object({ type: z.literal("suicide") }), z.object({ type: z.literal("requestWave") }), z.object({ type: z.literal("leaveRealm") }), z.object({ type: z.literal("enterRealm") }),
  z.object({ type: z.literal("scoreSnapshot"), score: z.number(), health: z.number() }), z.object({ type: z.literal("logout") }), z.object({ type: z.literal("listHeroes") }), z.object({ type: z.literal("inspectHero"), heroId: z.string().min(1) }), z.object({ type: z.literal("dismissPanelTrigger"), panel: z.enum(["character", "inventory"]) })
]);
const serverEnvelope = z.object({ type: z.enum(["welcome", "loggedOut", "leaderboard", "heroProfile", "realmUpdated", "incomingWave", "waveAdjusted", "creepDefeatResolved", "collectItemResult", "dropsReconciled", "progressionUpdated", "groundDropCreated", "scoreAwarded", "suicideResolved", "serverNotice"]) }).passthrough();
export const serverMessageSchema = serverEnvelope.transform((value) => value as unknown as ServerMessage);

export type ClientMessage =
  | { type: "join"; name?: string; heroId?: string }
  | { type: "updateAllocation"; allocation: Stats }
  | { type: "respecStats"; allocation: Stats }
  | { type: "creepDefeated"; unitId: string }
  | { type: "collectDrop"; dropId: string }
  | { type: "reconcileDrops"; activeDropIds: string[]; pendingDropIds: string[] }
  | { type: "deferDrop"; dropId: string }
  | { type: "equipItem" | "sellItem" | "purgeItem" | "upgradeItem" | "sendItem" | "extractSkill"; tileId: string; bulk?: boolean }
  | { type: "heroDefeated"; sourceUnitId?: string }
  | { type: "suicide" }
  | { type: "requestWave" | "leaveRealm" | "enterRealm" }
  | { type: "scoreSnapshot"; score: number; health: number }
  | { type: "logout" | "listHeroes" }
  | { type: "inspectHero"; heroId: string }
  | { type: "dismissPanelTrigger"; panel: "character" | "inventory" };

export type ServerMessage =
  | { type: "welcome"; playerId: PlayerId; player: PublicPlayer; progress: PlayerProgress; panelTriggers: { character: boolean; inventory: boolean }; realm: RealmState; config: ServerConfig }
  | { type: "loggedOut" }
  | { type: "leaderboard"; heroes: HeroSummary[] }
  | { type: "heroProfile"; hero: PublicHeroProfile }
  | { type: "realmUpdated"; realm: RealmState }
  | { type: "incomingWave"; wave: CreepWave }
  | { type: "waveAdjusted"; waveNumber: number; reason: string }
  | { type: "creepDefeatResolved"; unitId: string; score: number; progress: PlayerProgress; drop?: GroundDrop; reason: string }
  | { type: "collectItemResult"; dropId: string; collected: boolean; reason: string }
  | { type: "dropsReconciled"; drops: GroundDrop[]; removeDropIds: string[]; resolvedDropIds: string[] }
  | { type: "progressionUpdated"; progress: PlayerProgress; reason: string }
  | { type: "groundDropCreated"; drop: GroundDrop }
  | { type: "scoreAwarded"; score: number; reason: string }
  | { type: "suicideResolved" }
  | { type: "serverNotice"; message: string };

export function parseClientMessage(value: unknown): ClientMessage | undefined { const result = clientMessageSchema.safeParse(value); return result.success ? result.data : undefined; }
export function parseServerMessage(value: unknown): ServerMessage | undefined { const result = serverMessageSchema.safeParse(value); return result.success ? result.data : undefined; }
export function isSkillId(value: string): value is SkillId { return ["bash", "sweep", "flurry", "shockwave", "cleave", "rendingThrow", "orbitingHammers", "arcaneBolt", "gravityPull", "thorns", "reflectiveSurge", "frostOrb", "fireBreath", "voodoo", "healing", "rent", "blocking"].includes(value); }
