import { z } from "zod";
import type { BalanceConfig } from "./balance";
import type { ItemInstance, Rarity, SkillId } from "./items";
import type { Stats } from "./progression";

export const PROTOCOL_VERSION = 39;
export type PlayerId = string;
export type EnemyRole = "creep" | "champion" | "invader" | "clone" | "boss";
export type PanelTrigger = "character" | "inventory" | "multiplayer";
export type PanelTriggers = Record<PanelTrigger, boolean>;
export type CreepKind = "melee" | "bubbleShooter" | "rival";
export type RarityAction = "keep" | "auto-sell" | "auto-purge" | "auto-send";
export interface InventoryTile {
	id: string;
	key: string;
	item: ItemInstance;
	quantity: number;
}
export interface PlayerProgress {
	level: number;
	xp: number;
	stats: Stats;
	allocation: Stats;
	gold: number;
	souls: number;
	scraps: Record<Rarity, number>;
	mainHand?: ItemInstance;
	offHand?: ItemInstance;
	amulet?: ItemInstance;
	charm?: ItemInstance;
	inventoryTiles: InventoryTile[];
	learnedSkills: SkillId[];
	learnedSkillLevels: Partial<Record<SkillId, number>>;
	universalSkills: SkillId[];
	disabledSkills?: SkillId[];
	equippedSkills?: SkillId[];
	autoFireSkills?: SkillId[];
	rarityActions?: Record<Rarity, RarityAction>;
}
export interface XpSendBuff {
	multiplier: number;
	expiresAt: number;
}
export interface PublicPlayer {
	id: PlayerId;
	name: string;
	score: number;
	waveNumber: number;
	maxWaveReached: number;
	level: number;
	receivesDeathEchoes: boolean;
}
export interface HeroSummary {
	id: PlayerId;
	username: string;
	level: number;
	connected: boolean;
	receivesDeathEchoes: boolean;
}
export interface PublicHeroProfile {
	id: PlayerId;
	username: string;
	level: number;
	maxWaveReached: number;
	stats: Stats;
	mainHand?: ItemInstance;
	offHand?: ItemInstance;
	amulet?: ItemInstance;
	charm?: ItemInstance;
	learnedSkills: SkillId[];
	learnedSkillLevels: Partial<Record<SkillId, number>>;
	universalSkills: SkillId[];
	disabledSkills?: SkillId[];
	equippedSkills?: SkillId[];
	autoFireSkills?: SkillId[];
}
export interface RealmMember extends PublicPlayer {
	down: boolean;
}
export interface RealmState {
	mode: "training" | "waiting" | "competitive";
	guards: RealmMember[];
	attackers: RealmMember[];
	outgoingQueued: number;
	incomingQueued: number;
	canLeave: boolean;
}
export interface ServerConfig {
	waveIntervalMs: number;
	protocolVersion: number;
	maxRealmAttackers: number;
	maxQueuedItems: number;
	balance: BalanceConfig;
}
export interface UnitBuild {
	id: string;
	name: string;
	kind: CreepKind;
	level: number;
	stats: Stats;
	mainHand?: ItemInstance;
	offHand?: ItemInstance;
	amulet?: ItemInstance;
	charm?: ItemInstance;
	carried: ItemInstance[];
	isRival: boolean;
	enemyRole?: EnemyRole;
	xpReward: number;
	goldReward: number;
	seed: number;
	bonusSkills?: SkillId[];
	skillLevels?: Partial<Record<SkillId, number>>;
	emitterId?: PlayerId;
	emitterName?: string;
	backlash?: boolean;
}
export interface WaveSpawn {
	build: UnitBuild;
	spawnAtMs: number;
}
export interface CreepWave {
	id: string;
	targetId: PlayerId;
	waveNumber: number;
	durationMs: number;
	mode: "competitive" | "solo" | "training";
	resetHero: boolean;
	spawns: WaveSpawn[];
}
export type GroundDrop =
	| { id: string; kind: "item"; item: ItemInstance }
	| { id: string; kind: "gold"; amount: number }
	| { id: string; kind: "scrap"; rarity: Rarity; amount: number };

const statsSchema = z.object({
	agility: z.number(),
	strength: z.number(),
	magic: z.number(),
	spirit: z.number(),
	intelligence: z.number(),
});
const joinSchema = z
	.object({
		type: z.literal("join"),
		name: z
			.string()
			.max(20)
			.regex(/^[A-Za-z0-9_-]+$/)
			.optional(),
		heroId: z.string().min(1).optional(),
		password: z.string().min(8).max(128).optional(),
		passwordConfirmation: z.string().min(8).max(128).optional(),
	})
	.refine((value) => Boolean(value.name) !== Boolean(value.heroId))
	.refine((value) => !value.heroId || !value.password)
	.refine((value) => !value.passwordConfirmation || Boolean(value.password));
const tileCommand = (
	type:
		| "equipItem"
		| "sellItem"
		| "purgeItem"
		| "upgradeItem"
		| "sendItem"
		| "extractSkill"
		| "rerollItem",
) =>
	z.object({
		type: z.literal(type),
		tileId: z.string().min(1),
		bulk: z.boolean().optional(),
	});
export const clientMessageSchema = z.discriminatedUnion("type", [
	joinSchema,
	z.object({ type: z.literal("updateAllocation"), allocation: statsSchema }),
	z.object({ type: z.literal("respecStats"), allocation: statsSchema }),
	z.object({ type: z.literal("creepDefeated"), unitId: z.string().min(1) }),
	z.object({ type: z.literal("collectDrop"), dropId: z.string().min(1) }),
	z.object({
		type: z.literal("reconcileDrops"),
		activeDropIds: z.array(z.string()),
		pendingDropIds: z.array(z.string()),
	}),
	z.object({ type: z.literal("deferDrop"), dropId: z.string().min(1) }),
	z.object({
		type: z.literal("promoteScrap"),
		target: z.enum(["common", "uncommon", "rare", "epic", "unique"]),
		bulk: z.boolean().optional(),
	}),
	tileCommand("equipItem"),
	tileCommand("sellItem"),
	tileCommand("purgeItem"),
	tileCommand("upgradeItem"),
	tileCommand("sendItem"),
	tileCommand("extractSkill"),
	tileCommand("rerollItem"),
	z.object({
		type: z.literal("heroDefeated"),
		sourceUnitId: z.string().optional(),
	}),
	z.object({ type: z.literal("suicide") }),
	z.object({ type: z.literal("requestWave") }),
	z.object({ type: z.literal("leaveRealm") }),
	z.object({ type: z.literal("enterRealm") }),
	z.object({
		type: z.literal("scoreSnapshot"),
		score: z.number(),
		health: z.number(),
	}),
	z.object({ type: z.literal("logout") }),
	z.object({ type: z.literal("listHeroes") }),
	z.object({ type: z.literal("inspectHero"), heroId: z.string().min(1) }),
	z.object({
		type: z.literal("dismissPanelTrigger"),
		panel: z.enum(["character", "inventory", "multiplayer"]),
	}),
	z.object({
		type: z.literal("setSkillEquipped"),
		skillId: z.string().min(1),
		equipped: z.boolean(),
		slot: z.number().int().min(1).max(6).optional(),
	}),
	z.object({
		type: z.literal("toggleSkillAutoFire"),
		skillId: z.string().min(1),
	}),
	z.object({
		type: z.literal("setRarityAction"),
		rarity: z.enum(["common", "uncommon", "rare", "epic", "unique"]),
		action: z.enum(["keep", "auto-sell", "auto-purge", "auto-send"]),
	}),
	z.object({ type: z.literal("chat"), text: z.string().min(1).max(200) }),
]);
const serverEnvelope = z
	.object({
		type: z.enum([
			"welcome",
			"loggedOut",
			"authenticationRequired",
			"leaderboard",
			"heroProfile",
			"realmUpdated",
			"incomingWave",
			"waveAdjusted",
			"creepDefeatResolved",
			"collectItemResult",
			"dropsReconciled",
			"progressionUpdated",
			"groundDropCreated",
			"scoreAwarded",
			"suicideResolved",
			"serverNotice",
			"chatMessage",
		]),
	})
	.passthrough();
export const serverMessageSchema = serverEnvelope.transform(
	(value) => value as unknown as ServerMessage,
);

export type ClientMessage =
	| {
			type: "join";
			name?: string;
			heroId?: string;
			password?: string;
			passwordConfirmation?: string;
	  }
	| { type: "updateAllocation"; allocation: Stats }
	| { type: "respecStats"; allocation: Stats }
	| { type: "creepDefeated"; unitId: string }
	| { type: "collectDrop"; dropId: string }
	| {
			type: "reconcileDrops";
			activeDropIds: string[];
			pendingDropIds: string[];
	  }
	| { type: "deferDrop"; dropId: string }
	| { type: "promoteScrap"; target: Rarity; bulk?: boolean }
	| {
			type:
				| "equipItem"
				| "sellItem"
				| "purgeItem"
				| "upgradeItem"
				| "sendItem"
				| "extractSkill"
				| "rerollItem";
			tileId: string;
			bulk?: boolean;
	  }
	| { type: "heroDefeated"; sourceUnitId?: string }
	| { type: "suicide" }
	| { type: "requestWave" | "leaveRealm" | "enterRealm" }
	| { type: "scoreSnapshot"; score: number; health: number }
	| { type: "logout" | "listHeroes" }
	| { type: "inspectHero"; heroId: string }
	| { type: "dismissPanelTrigger"; panel: PanelTrigger }
	| {
			type: "setSkillEquipped";
			skillId: string;
			equipped: boolean;
			slot?: number;
	  }
	| { type: "toggleSkillAutoFire"; skillId: string }
	| {
			type: "setRarityAction";
			rarity: Rarity;
			action: RarityAction;
	  }
	| { type: "chat"; text: string };

export type ServerMessage =
	| {
			type: "welcome";
			playerId: PlayerId;
			player: PublicPlayer;
			progress: PlayerProgress;
			xpSendBuffs: XpSendBuff[];
			panelTriggers: PanelTriggers;
			realm: RealmState;
			config: ServerConfig;
	  }
	| { type: "loggedOut" }
	| {
			type: "authenticationRequired";
			username: string;
			mode: "create" | "login";
	  }
	| { type: "leaderboard"; heroes: HeroSummary[]; onlineCount: number }
	| { type: "heroProfile"; hero: PublicHeroProfile }
	| { type: "realmUpdated"; realm: RealmState }
	| { type: "incomingWave"; wave: CreepWave }
	| { type: "waveAdjusted"; waveNumber: number; reason: string }
	| {
			type: "creepDefeatResolved";
			unitId: string;
			score: number;
			progress: PlayerProgress;
			xpSendBuffs: XpSendBuff[];
			drop?: GroundDrop;
			reason: string;
	  }
	| {
			type: "collectItemResult";
			dropId: string;
			collected: boolean;
			reason: string;
	  }
	| {
			type: "dropsReconciled";
			drops: GroundDrop[];
			removeDropIds: string[];
			resolvedDropIds: string[];
	  }
	| {
			type: "progressionUpdated";
			progress: PlayerProgress;
			xpSendBuffs: XpSendBuff[];
			reason: string;
	  }
	| { type: "groundDropCreated"; drop: GroundDrop }
	| { type: "scoreAwarded"; score: number; reason: string }
	| { type: "suicideResolved" }
	| { type: "serverNotice"; message: string }
	| {
			type: "chatMessage";
			senderId: PlayerId;
			senderName: string;
			text: string;
			kind?: "chat" | "system";
	  };

export function parseClientMessage(value: unknown): ClientMessage | undefined {
	const result = clientMessageSchema.safeParse(value);
	return result.success ? result.data : undefined;
}
export function parseServerMessage(value: unknown): ServerMessage | undefined {
	const result = serverMessageSchema.safeParse(value);
	return result.success ? result.data : undefined;
}
export function isSkillId(value: string): value is SkillId {
	return [
		"bash",
		"sweep",
		"flurry",
		"shockwave",
		"cleave",
		"whirlwind",
		"rendingThrow",
		"vampiricBoomerang",
		"orbitingHammers",
		"arcaneBolt",
		"gravityPull",
		"attraction",
		"manaDrain",
		"penance",
		"thorns",
		"reflectiveSurge",
		"frostOrb",
		"blizzard",
		"fireBreath",
		"rapidRegen",
		"voodoo",
		"healing",
		"rent",
		"blocking",
		"slowAura",
		"hinderingAura",
		"deathBurst",
		"sunburnAura",
		"thunderAura",
		"timeHarvest",
	].includes(value);
}
