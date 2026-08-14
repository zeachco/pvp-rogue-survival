import type { BalanceConfig } from "../common/balance.ts";
import { publicBalance } from "../common/balance.ts";
import {
	attractionFindBonus,
	cappedSkillLevel,
	timeHarvestItemSkillBonus,
} from "../common/combat.ts";
import { ENEMY_BONUS_SKILLS, SKILLS, WEAPONS } from "../common/content.ts";
import {
	applyAutoAction,
	autoEquipCollectedItem,
	collectIntoInventory,
	dropInventoryOverflow,
	emptyScraps,
	equipFromInventory,
	extractFromInventory,
	type InventoryResult,
	promoteScraps,
	purgeFromInventory,
	purgeYield,
	removeEmptyInventoryTiles,
	rerollFromInventory,
	sellFromInventory,
	sendFromInventory,
	upgradeFromInventory,
} from "../common/inventory.ts";
import {
	changeItemRarity,
	equippedBonusXp,
	equippedSkillLevelContribution,
	generateAccessory,
	generateBuckler,
	generateItem,
	generateRelic,
	type ItemInstance,
	itemRequirementMultiplier,
	itemSkillLevelBonus,
	itemStackKey,
	nextRarity,
	rollRarity,
	type SkillId,
	statsWithItemBonuses,
	type WeaponClass,
} from "../common/items.ts";
import {
	cumulativeXpForLevel,
	DEFAULT_ALLOCATION,
	levelForXp,
	migrateLegacyStats,
	STAT_KEYS,
	type Stats,
	scaledStats,
	validAllocation,
} from "../common/progression.ts";
import {
	type ClientMessage,
	type CreepWave,
	type GroundDrop,
	type HeroSummary,
	isSkillId,
	type PlayerId,
	PROTOCOL_VERSION,
	type PublicHeroProfile,
	type PublicPlayer,
	type RealmMember,
	type RealmState,
	type ServerMessage,
	type UnitBuild,
	type XpSendBuff,
} from "../common/protocol.ts";
import { type RandomSource, randomSeed } from "../common/random.ts";
import {
	championCount,
	creepsWithSpellsCount,
	forceNextWaveCooldownSeconds,
	isIntroWave,
	realmCloneLevel,
	regularCount,
	regularLevel,
	rivalLevel,
	rivalXpReward,
	spawnAtMs,
} from "../common/waves.ts";
import type { Player, PlayerRepository, QueuedEquipment } from "./domain.ts";

export function magicFindExtraDropChance(
	level: number,
	role: NonNullable<UnitBuild["enemyRole"]>,
	playerMagicFind: number,
): number {
	const roleRate = {
		creep: 0,
		champion: 0.01,
		invader: 0.03,
		clone: 0.03,
		boss: 0.05,
	}[role];
	return (
		Math.max(0, level) * roleRate * Math.max(0, Math.min(5, playerMagicFind))
	);
}

export function magicFindExtraDropCount(chance: number, roll: number): number {
	const guaranteed = Math.floor(Math.max(0, chance));
	return guaranteed + (roll < chance - guaranteed ? 1 : 0);
}

export function magicFindRarityForRoll(roll: number): ItemInstance["rarity"] {
	const weighted = Math.max(0, Math.min(1, roll)) * 31;
	return weighted < 1
		? "unique"
		: weighted < 3
			? "epic"
			: weighted < 7
				? "rare"
				: weighted < 15
					? "uncommon"
					: "common";
}

export interface GameServiceOptions {
	repository: PlayerRepository;
	balance: BalanceConfig;
	random: RandomSource;
	createId?: () => string;
	now?: () => number;
	send: (playerId: PlayerId, message: ServerMessage) => void;
	logPlayerLifecycle?: (
		event: "connected" | "disconnected",
		player: Pick<Player, "id" | "name">,
	) => void;
	logRealmLifecycle?: (
		event: "entered" | "left",
		playerId: PlayerId,
		realmId: string,
		opponentIds: PlayerId[],
	) => void;
}
interface Realm {
	id: string;
	soloId: PlayerId;
	teamIds: PlayerId[];
	down: Set<PlayerId>;
	challengeFrom?: PlayerId;
	duelPending?: boolean;
	duelActive?: boolean;
}
const MAX_QUEUE = 1000;
const BONK_COOLDOWN_MS = 10_000;
const BONK_KILL_CREDIT_MS = 5_000;
const BONK_DAMAGE_FRACTION = 0.1;
const XP_SEND_MULTIPLIERS = {
	common: 1.2,
	uncommon: 1.5,
	rare: 2,
	epic: 3,
	unique: 5,
} as const;

export class GameService {
	private readonly createId: () => string;
	private readonly now: () => number;
	private readonly realms = new Map<string, Realm>();
	private readonly waveDispatches = new Map<PlayerId, number>();
	private readonly forceNextWaveReadyAt = new Map<PlayerId, number>();
	private readonly bonkReadyAt = new Map<PlayerId, number>();
	private readonly recentBonks = new Map<
		PlayerId,
		{ attackerId: PlayerId; expiresAt: number; cause: "bonk" | "duel" }
	>();
	private lastDispatchAt = Date.now();
	constructor(private readonly options: GameServiceOptions) {
		this.createId = options.createId ?? (() => crypto.randomUUID());
		this.now = options.now ?? Date.now;
	}

	join(
		name: string,
		heroId?: PlayerId,
		onIdentified?: (playerId: PlayerId, player: Player) => void,
	): Player {
		const player = this.joinPlayer(name, heroId);
		onIdentified?.(player.id, player);
		this.options.repository.markDirty(player.id);
		this.options.logPlayerLifecycle?.("connected", player);
		const created = this.matchWaitingPlayers();
		this.options.send(player.id, {
			type: "welcome",
			playerId: player.id,
			player: this.publicPlayer(player),
			progress: player.progress,
			xpSendBuffs: this.xpSendBuffs(player),
			panelTriggers: player.panelTriggers,
			realm: this.realmState(player),
			config: {
				waveIntervalMs: this.options.balance.wave.intervalMs,
				protocolVersion: PROTOCOL_VERSION,
				maxRealmAttackers: 3,
				maxQueuedItems: MAX_QUEUE,
				balance: publicBalance(this.options.balance),
			},
			accountName: player.accountName,
			accountCharacters: this.accountCharacters(player),
		});
		this.broadcastRealms();
		if (created.length) for (const realm of created) this.activateRealm(realm);
		else if (!player.realmId) this.dispatchCurrentWave(player, "training");
		return player;
	}

	disconnect(playerId: PlayerId): void {
		const player = this.options.repository.get(playerId);
		if (!player) return;
		player.connected = false;
		this.options.logPlayerLifecycle?.("disconnected", player);
		if (player.realmId) this.dissolveRealm(player.realmId);
		for (const realm of this.matchWaitingPlayers()) this.activateRealm(realm);
		this.broadcastRealms();
	}

	logout(playerId: PlayerId): void {
		const player = this.options.repository.get(playerId);
		if (!player) return;
		this.disconnect(playerId);
		player.realmOptedIn = false;
		player.realmId = undefined;
		player.issuedUnits.clear();
		player.groundDrops.clear();
		player.deferredItems.length = 0;
		player.incomingQueues.clear();
		player.backlashQueue.length = 0;
		for (const other of this.options.repository.values()) {
			other.incomingQueues.delete(playerId);
			other.backlashQueue = other.backlashQueue.filter(
				(entry) => entry.senderId !== playerId,
			);
		}
		this.options.repository.markDirty(player.id);
	}
	findPlayer(heroId?: string, username?: string): Player | undefined {
		return heroId
			? this.options.repository.get(heroId)
			: username
				? this.options.repository.getByUsername(username)
				: undefined;
	}
	accountCharacters(player: Player): HeroSummary[] {
		return this.options.repository
			.getAccountPlayers(player.accountId)
			.map((hero) => ({
				id: hero.id,
				username: hero.name,
				level: hero.progress.level,
				souls: hero.progress.souls,
				connected: hero.connected,
				receivesDeathEchoes: false,
			}));
	}
	createCharacter(current: Player, name: string): Player {
		const trimmed = name.trim().slice(0, 20);
		if (!/^[A-Za-z0-9_-]{1,20}$/.test(trimmed))
			throw new Error("Invalid character name.");
		if (this.options.repository.getByCharacterName(trimmed))
			throw new Error("Character name is already used.");
		const player = this.createPlayer(
			trimmed,
			current.accountId,
			current.accountName,
			current.passwordHash,
			current.isModerator,
			current.progress.inventoryTiles,
		);
		this.options.repository.save(player);
		return player;
	}
	leaderboard(): HeroSummary[] {
		return [...this.options.repository.values()]
			.map((player) => ({
				id: player.id,
				username: player.name,
				level: player.progress.level,
				souls: player.progress.souls,
				connected: player.connected,
				receivesDeathEchoes: false,
			}))
			.sort((a, b) => b.souls - a.souls || a.username.localeCompare(b.username))
			.slice(0, 100)
			.map((hero, index) => ({ ...hero, receivesDeathEchoes: index === 0 }));
	}
	onlinePlayerCount(): number {
		return [...this.options.repository.values()].filter(
			(player) => player.connected,
		).length;
	}
	publicHeroProfile(heroId: string): PublicHeroProfile | undefined {
		const player = this.options.repository.get(heroId);
		if (!player) return undefined;
		const p = player.progress;
		return {
			id: player.id,
			username: player.name,
			level: p.level,
			maxWaveReached: player.maxWaveReached,
			stats: p.stats,
			mainHand: p.mainHand,
			offHand: p.offHand,
			amulet: p.amulet,
			charm: p.charm,
			learnedSkills: p.learnedSkills,
			learnedSkillLevels: p.learnedSkillLevels,
			universalSkills: p.universalSkills,
			disabledSkills: p.disabledSkills,
			equippedSkills: p.equippedSkills,
			autoFireSkills: p.autoFireSkills,
		};
	}

	handle(
		playerId: PlayerId,
		message: Exclude<ClientMessage, { type: "join" }>,
	): void {
		const player = this.options.repository.get(playerId);
		if (!player) return;
		try {
			switch (message.type) {
				case "updateAllocation":
					if (!validAllocation(message.allocation))
						return this.notice(
							player,
							"Allocation must use non-negative integers totaling 5.",
						);
					player.progress.allocation = { ...message.allocation };
					return this.sendProgress(player, "Future level allocation updated.");
				case "respecStats":
					return this.respecStats(player, message.allocation);
				case "creepDefeated":
					return this.resolveDefeat(player, message.unitId);
				case "collectDrop":
					return this.collectDrop(player, message.dropId);
				case "reconcileDrops":
					return this.reconcileDrops(
						player,
						message.activeDropIds,
						message.pendingDropIds,
					);
				case "deferDrop":
					return this.deferDrop(player, message.dropId);
				case "promoteScrap": {
					const result = promoteScraps(
						player.progress.scraps,
						message.target,
						message.bulk,
					);
					return result.changed
						? this.sendProgress(player, result.reason)
						: this.notice(player, result.reason);
				}
				case "heroDefeated":
					return this.heroDefeated(
						player,
						message.sourceUnitId,
						false,
						message.sourcePlayerId,
					);
				case "suicide":
					this.heroDefeated(player, undefined, true);
					return this.options.send(player.id, { type: "suicideResolved" });
				case "requestWave":
					if (
						player.realmId &&
						(this.realms.get(player.realmId)?.duelPending ||
							this.realms.get(player.realmId)?.duelActive)
					)
						return this.notice(player, "Challenge Realm has paused waves.");
					return this.dispatchCurrentWave(player, this.waveMode(player));
				case "forceNextWave":
					return this.forceNextWave(player);
				case "challengeRealm":
					return this.challengeRealm(player);
				case "duelState":
					return this.relayDuelState(
						player,
						message.x,
						message.y,
						message.facing,
						message.hp,
					);
				case "duelDamage":
					return this.relayDuelDamage(player, message.amount);
				case "equipItem":
					return this.applyInventoryResult(
						player,
						equipFromInventory(player.progress, message.tileId),
					);
				case "sellItem":
					return this.applyInventoryAction(player, message.bulk, () =>
						sellFromInventory(player.progress, message.tileId),
					);
				case "purgeItem":
					return this.applyInventoryAction(player, message.bulk, () =>
						purgeFromInventory(player.progress, message.tileId),
					);
				case "upgradeItem":
					return this.applyInventoryAction(player, message.bulk, () =>
						upgradeFromInventory(
							player.progress,
							message.tileId,
							() => this.createId(),
							() => this.seed(),
						),
					);
				case "extractSkill":
					return this.applyInventoryAction(player, message.bulk, () =>
						extractFromInventory(player.progress, message.tileId),
					);
				case "rerollItem":
					return this.applyInventoryAction(player, message.bulk, () =>
						rerollFromInventory(
							player.progress,
							message.tileId,
							() => this.createId(),
							() => this.seed(),
						),
					);
				case "sendItem":
					return this.sendItem(player, message.tileId, message.bulk);
				case "setSkillEquipped":
					return this.setSkillEquipped(
						player,
						message.skillId,
						message.equipped,
						message.slot,
					);
				case "toggleSkillAutoFire":
					return this.toggleSkillAutoFire(player, message.skillId);
				case "setAutoEquipOption":
					if (message.option === "items")
						player.progress.autoEquipItems = message.enabled;
					else player.progress.autoEquipSpells = message.enabled;
					return this.sendProgress(
						player,
						`Auto-equip ${message.option} ${message.enabled ? "enabled" : "disabled"}.`,
					);
				case "setRarityAction": {
					if (!player.progress.rarityActions) {
						player.progress.rarityActions = {
							common: "keep",
							uncommon: "keep",
							rare: "keep",
							epic: "keep",
							unique: "keep",
						};
					}
					player.progress.rarityActions[message.rarity] = message.action;
					return this.sendProgress(
						player,
						`${message.rarity} items set to ${message.action}.`,
					);
				}
				case "leaveRealm":
					return this.leaveRealm(player);
				case "enterRealm":
					return this.enterRealm(
						player,
						message.waveNumber ?? player.waveNumber,
						message.waveNumber === undefined,
					);
				case "scoreSnapshot":
				case "logout":
				case "listHeroes":
				case "inspectHero":
					return;
				case "dismissPanelTrigger":
					player.panelTriggers[message.panel] = false;
					return;
				case "chat":
					return this.handleChat(player, message.text);
			}
		} finally {
			this.options.repository.markDirty(player.id);
		}
	}

	dispatchWaves(): void {
		this.lastDispatchAt = Date.now();
		for (const realm of this.realms.values()) {
			realm.down.clear();
			if (realm.duelPending) this.startDuel(realm);
		}
		for (const player of this.options.repository.values())
			if (player.connected) {
				const realm = player.realmId
					? this.realms.get(player.realmId)
					: undefined;
				if (realm?.duelActive) continue;
				if (player.realmId || player.realmOptedIn) player.waveNumber += 1;
				this.dispatchCurrentWave(player, this.waveMode(player));
				this.options.repository.markDirty(player.id);
			}
		this.broadcastRealms();
	}

	refreshRealmStates(): void {
		this.broadcastRealms();
	}

	private forceNextWave(player: Player): void {
		const now = this.now();
		const readyAt = this.forceNextWaveReadyAt.get(player.id) ?? 0;
		const realm = player.realmId ? this.realms.get(player.realmId) : undefined;
		if (realm?.duelPending || realm?.duelActive)
			return this.notice(player, "Challenge Realm has paused automatic waves.");
		if (!player.realmOptedIn || this.waveMode(player) === "training") {
			this.options.send(player.id, {
				type: "forceNextWaveResult",
				accepted: false,
				readyAt,
			});
			return this.notice(player, "Enter a realm before forcing the next wave.");
		}
		if (now < readyAt) {
			this.options.send(player.id, {
				type: "forceNextWaveResult",
				accepted: false,
				readyAt,
			});
			return this.notice(player, "Force next wave is still on cooldown.");
		}
		const nextReadyAt =
			now + forceNextWaveCooldownSeconds(player.waveNumber) * 1000;
		this.forceNextWaveReadyAt.set(player.id, nextReadyAt);
		this.options.send(player.id, {
			type: "forceNextWaveResult",
			accepted: true,
			readyAt: nextReadyAt,
		});
		player.waveNumber += 1;
		this.dispatchCurrentWave(player, this.waveMode(player));
		this.broadcastRealms();
	}

	private challengeRealm(player: Player): void {
		const realm = player.realmId ? this.realms.get(player.realmId) : undefined;
		if (!realm || realm.teamIds.length !== 1 || realm.duelActive)
			return this.notice(
				player,
				"Challenge Realm is available in active 1v1 realms.",
			);
		if (realm.duelPending) return;
		if (!realm.challengeFrom) realm.challengeFrom = player.id;
		else if (realm.challengeFrom === player.id) realm.challengeFrom = undefined;
		else {
			realm.duelPending = true;
			this.sendRealmSystem(
				realm,
				"Challenge accepted. Deathmatch starts after this wave.",
			);
		}
		this.broadcastRealms();
	}

	private startDuel(realm: Realm): void {
		realm.duelPending = false;
		realm.duelActive = true;
		const ids = [realm.soloId, realm.teamIds[0]];
		for (let side = 0; side < ids.length; side += 1) {
			const player = this.options.repository.get(ids[side]);
			const opponent = this.options.repository.get(ids[1 - side]);
			if (!player || !opponent) continue;
			player.issuedUnits.clear();
			this.options.send(player.id, {
				type: "duelStarted",
				opponent: this.duelBuild(opponent),
				side: side as 0 | 1,
			});
		}
		this.sendRealmSystem(realm, "Challenge Realm deathmatch started.");
	}

	private relayDuelState(
		player: Player,
		x: number,
		y: number,
		facing: number,
		hp: number,
	): void {
		const opponent = this.activeDuelOpponent(player);
		if (opponent)
			this.options.send(opponent.id, {
				type: "duelState",
				x: Math.max(-10_000, Math.min(10_000, x)),
				y: Math.max(-10_000, Math.min(10_000, y)),
				facing,
				hp: Math.max(0, Math.min(1_000_000, hp)),
			});
	}

	private relayDuelDamage(player: Player, amount: number): void {
		const opponent = this.activeDuelOpponent(player);
		if (!opponent) return;
		const bounded = Math.min(amount, 1_000_000);
		this.recentBonks.set(opponent.id, {
			attackerId: player.id,
			expiresAt: this.now() + BONK_KILL_CREDIT_MS,
			cause: "duel",
		});
		this.options.send(opponent.id, {
			type: "duelDamage",
			amount: bounded,
			attackerId: player.id,
		});
	}

	private activeDuelOpponent(player: Player): Player | undefined {
		const realm = player.realmId ? this.realms.get(player.realmId) : undefined;
		if (!realm?.duelActive || realm.teamIds.length !== 1) return;
		const id = realm.soloId === player.id ? realm.teamIds[0] : realm.soloId;
		return this.options.repository.get(id);
	}

	private duelBuild(player: Player): UnitBuild {
		return {
			id: player.id,
			name: player.name,
			kind: "rival",
			level: player.progress.level,
			stats: structuredClone(player.progress.stats),
			mainHand: player.progress.mainHand
				? structuredClone(player.progress.mainHand)
				: undefined,
			offHand: player.progress.offHand
				? structuredClone(player.progress.offHand)
				: undefined,
			amulet: player.progress.amulet
				? structuredClone(player.progress.amulet)
				: undefined,
			charm: player.progress.charm
				? structuredClone(player.progress.charm)
				: undefined,
			carried: [],
			bonusSkills: [],
			skillLevels: bossSkillLevels(player.progress),
			isRival: true,
			enemyRole: "clone",
			xpReward: 0,
			goldReward: 0,
			seed: this.seed(),
		};
	}

	private bonkPlayer(player: Player, target: Player): boolean {
		const now = this.now();
		const readyAt = this.bonkReadyAt.get(player.id) ?? 0;
		const realm = player.realmId ? this.realms.get(player.realmId) : undefined;
		const competitiveTarget = Boolean(
			realm &&
				target.connected &&
				target.realmId === realm.id &&
				this.realmOpponentIds(realm, player.id).includes(target.id) &&
				!realm.down.has(target.id),
		);
		const soloTarget =
			!realm &&
			player.realmOptedIn &&
			target.id === player.id &&
			target.connected;
		if ((!competitiveTarget && !soloTarget) || now < readyAt) return false;
		const nextReadyAt = now + BONK_COOLDOWN_MS;
		this.bonkReadyAt.set(player.id, nextReadyAt);
		if (competitiveTarget)
			this.recentBonks.set(target.id, {
				attackerId: player.id,
				expiresAt: now + BONK_KILL_CREDIT_MS,
				cause: "bonk",
			});
		this.options.send(target.id, {
			type: "playerBonked",
			attackerId: player.id,
			attackerName: player.name,
			damageFraction: BONK_DAMAGE_FRACTION,
		});
		return true;
	}

	private joinPlayer(name: string, heroId?: PlayerId): Player {
		const trimmed = name.trim().slice(0, 20);
		const existing = heroId
			? this.options.repository.get(heroId)
			: this.options.repository.getByUsername(trimmed);
		if (existing) {
			existing.progress.stats = migrateLegacyStats(existing.progress.stats);
			existing.progress.allocation = migrateLegacyStats(
				existing.progress.allocation,
			);
			existing.connected = true;
			existing.realmOptedIn = false;
			existing.waitingSince = Date.now();
			removeEmptyInventoryTiles(existing.progress);
			return existing;
		}
		if (!/^[A-Za-z0-9_-]{1,20}$/.test(trimmed))
			throw new Error("Invalid username.");
		const player = this.createPlayer(trimmed, undefined, trimmed);
		this.options.repository.save(player);
		return player;
	}

	private createPlayer(
		name: string,
		accountId: string | undefined,
		accountName = name,
		passwordHash?: string,
		isModerator = false,
		sharedInventory?: Player["progress"]["inventoryTiles"],
	): Player {
		const id = this.createId();
		const starterSword = generateItem(1, "common", 101, {
			allowedClasses: ["sword"],
		});
		const starterBuckler = generateBuckler(1, "common", 102);
		const starterStaff = generateItem(1, "common", 103, {
			allowedClasses: ["staff"],
		});
		starterStaff.skills = ["arcaneBolt", "frostOrb"];
		const starterItems = [starterSword, starterBuckler, starterStaff];
		const inventoryTiles = sharedInventory ?? [];
		if (!sharedInventory)
			for (const item of starterItems) {
				const key = itemStackKey(item);
				const existing = inventoryTiles.find((tile) => tile.key === key);
				if (existing) existing.quantity += 1;
				else
					inventoryTiles.push({
						id: `starter-random-tile-${inventoryTiles.length}`,
						key,
						item,
						quantity: 1,
					});
			}
		const player: Player = {
			id,
			name,
			accountId: accountId ?? id,
			accountName,
			passwordHash,
			isModerator,
			score: 0,
			waveNumber: 1,
			maxWaveReached: 0,
			connected: true,
			realmOptedIn: false,
			waitingSince: Date.now(),
			outgoingRotation: 0,
			queueCursor: 0,
			issuedUnits: new Map(),
			groundDrops: new Map(),
			deferredItems: [],
			incomingQueues: new Map(),
			backlashQueue: [],
			deathEchoes: [],
			xpSendBuffs: [],
			panelTriggers: { character: true, inventory: true, multiplayer: true },
			progress: {
				level: 1,
				xp: cumulativeXpForLevel(1),
				stats: { ...DEFAULT_ALLOCATION },
				allocation: { ...DEFAULT_ALLOCATION },
				gold: 0,
				souls: 0,
				scraps: emptyScraps(),
				mainHand: starterSword,
				offHand: starterBuckler,
				inventoryTiles,
				learnedSkills: ["attraction"],
				learnedSkillLevels: { attraction: 1 },
				universalSkills: ["attraction"],
				disabledSkills: [],
				equippedSkills: [],
				autoFireSkills: [],
				autoEquipItems: true,
				autoEquipSpells: true,
			},
		};
		return player;
	}

	private setSkillEquipped(
		player: Player,
		skillId: string,
		shouldEquip: boolean,
		slot?: number,
	): void {
		if (!isSkillId(skillId)) return;
		const providedByEquipment = [
			player.progress.mainHand,
			player.progress.offHand,
			player.progress.amulet,
			player.progress.charm,
		].some((item) => item?.skills.includes(skillId));
		if (
			!player.progress.learnedSkills.includes(skillId) &&
			!providedByEquipment
		)
			return;
		if (SKILLS[skillId].passive) return;
		const availableActive = new Set([
			...player.progress.learnedSkills,
			...[
				player.progress.mainHand,
				player.progress.offHand,
				player.progress.amulet,
				player.progress.charm,
			].flatMap((item) => item?.skills ?? []),
		]);
		const loadout = (player.progress.equippedSkills ?? []).filter(
			(id) => availableActive.has(id) && !SKILLS[id].passive,
		);
		player.progress.equippedSkills = loadout;
		player.progress.autoFireSkills = (
			player.progress.autoFireSkills ?? []
		).filter((id) => loadout.includes(id));
		const hasSkill = loadout.includes(skillId);
		if (shouldEquip && slot !== undefined) {
			if (!Number.isInteger(slot) || slot < 1 || slot > 6) return;
			const next = loadout.filter((id) => id !== skillId);
			const displaced = next[slot - 1];
			if (displaced) next.splice(slot - 1, 1, skillId);
			else next.splice(Math.min(slot - 1, next.length), 0, skillId);
			player.progress.equippedSkills = next.slice(0, 6);
			player.progress.autoFireSkills = [
				...(player.progress.autoFireSkills ?? []).filter(
					(id) => id !== displaced && id !== skillId && next.includes(id),
				),
				skillId,
			];
			this.options.repository.markDirty(player.id);
			this.sendProgress(
				player,
				`${SKILLS[skillId].label} assigned to spell slot ${slot}.`,
			);
			return;
		}
		if (shouldEquip && !hasSkill) {
			if (loadout.length >= 6) return;
			player.progress.equippedSkills = [...loadout, skillId];
			player.progress.autoFireSkills = [
				...(player.progress.autoFireSkills ?? []).filter(
					(id) => id !== skillId,
				),
				skillId,
			];
		} else if (!shouldEquip && hasSkill) {
			player.progress.equippedSkills = loadout.filter((id) => id !== skillId);
			player.progress.autoFireSkills = (
				player.progress.autoFireSkills ?? []
			).filter((id) => id !== skillId);
		} else return;
		this.options.repository.markDirty(player.id);
		this.sendProgress(
			player,
			`${SKILLS[skillId].label} ${shouldEquip ? "equipped" : "unequipped"}.`,
		);
	}

	private toggleSkillAutoFire(player: Player, skillId: string): void {
		if (
			!isSkillId(skillId) ||
			!(player.progress.equippedSkills ?? []).includes(skillId)
		)
			return;
		const auto = new Set(player.progress.autoFireSkills ?? []);
		if (auto.has(skillId)) auto.delete(skillId);
		else auto.add(skillId);
		player.progress.autoFireSkills = [...auto];
		this.options.repository.markDirty(player.id);
		this.sendProgress(
			player,
			`${SKILLS[skillId].label} auto-fire ${auto.has(skillId) ? "enabled" : "disabled"}.`,
		);
	}

	private dispatchCurrentWave(
		player: Player,
		mode: "competitive" | "solo" | "training",
		resetHero = false,
	): void {
		const dispatch = (this.waveDispatches.get(player.id) ?? 0) + 1;
		this.waveDispatches.set(player.id, dispatch);
		const bossRoll =
			player.waveNumber > 0 &&
			player.waveNumber % 10 === 0 &&
			this.options.random.next() < 0.5;
		if (!bossRoll) return this.dispatchWave(player, mode, resetHero);
		const candidate = this.options.repository.findBossCandidate(
			Math.max(0, player.waveNumber - 9),
			player.waveNumber,
		);
		if (isPromiseLike(candidate)) {
			void candidate
				.then((boss) => {
					if (this.waveDispatches.get(player.id) === dispatch)
						this.dispatchWave(player, mode, resetHero, boss);
				})
				.catch(() => {
					if (this.waveDispatches.get(player.id) === dispatch)
						this.dispatchWave(player, mode, resetHero);
				});
			return;
		}
		this.dispatchWave(player, mode, resetHero, candidate);
	}

	private dispatchWave(
		player: Player,
		mode: "competitive" | "solo" | "training",
		resetHero: boolean,
		boss?: Player,
	): void {
		if (mode !== "training")
			player.maxWaveReached = Math.max(
				player.maxWaveReached,
				player.waveNumber,
			);
		const count = regularCount(player.waveNumber, this.options.balance);
		const level = regularLevel(
			player.waveNumber,
			player.progress.level,
			count,
			this.options.balance,
		);
		const seed = this.seed();
		const intro = isIntroWave(player.waveNumber);
		const meleeClasses: WeaponClass[] = [
			"club",
			"sword",
			"dagger",
			"mace",
			"axe",
			"hammer",
			"largeMace",
			"longsword",
			"katars",
		];
		const template = this.generateBuild(
			"Perimeter creep",
			level,
			false,
			seed,
			undefined,
			true,
			intro ? meleeClasses : undefined,
		);
		const spawns: CreepWave["spawns"] = [];
		const queued = this.takeQueued(player, count, mode !== "training");
		const fromSender = new Map<string, { id: string; count: number }>();
		for (const entry of queued)
			if (!entry.backlash && entry.senderId !== player.id)
				fromSender.set(entry.senderName, {
					id: entry.senderId,
					count: (fromSender.get(entry.senderName)?.count ?? 0) + 1,
				});
		for (const [senderName, sent] of fromSender)
			this.options.send(player.id, {
				type: "chatMessage",
				senderId: sent.id,
				senderName,
				text: `sent you ${sent.count} challenger${sent.count > 1 ? "s" : ""} this round`,
			});
		const skilledCount = ENEMY_BONUS_SKILLS.length
			? creepsWithSpellsCount(player.waveNumber, count)
			: 0;
		for (let index = 0; index < count; index += 1) {
			const entry = queued[index];
			const bonusSkills =
				index < skilledCount
					? [
							ENEMY_BONUS_SKILLS[
								Math.floor(
									this.options.random.next() * ENEMY_BONUS_SKILLS.length,
								)
							],
						]
					: [];
			let build: UnitBuild = {
				...template,
				id: this.createId(),
				stats: entry
					? { ...template.stats }
					: regularCreepStats(template.stats),
				carried: [...template.carried],
				bonusSkills,
			};
			if (entry) build = this.applyQueuedEquipment(build, entry, intro);
			player.issuedUnits.set(build.id, { build, mode });
			spawns.push({
				build,
				spawnAtMs: spawnAtMs(index, count, this.options.balance),
			});
		}
		if (!intro)
			for (const echo of player.deathEchoes.splice(0)) {
				player.issuedUnits.set(echo.id, { build: echo, mode });
				spawns.push({
					build: echo,
					spawnAtMs: this.options.balance.wave.prepareMs,
				});
			}
		const opponents = this.realmOpponents(player);
		const opponent = opponents[0];
		const championLevel = rivalLevel(player.waveNumber, this.options.balance);
		const cloneAttackers =
			mode === "competitive" &&
			player.waveNumber > 0 &&
			player.waveNumber % 10 === 0 &&
			opponents.length > 0 &&
			this.options.random.next() < 0.5;
		const champions = cloneAttackers
			? opponents.map((attacker) =>
					this.realmClone(player, attacker, opponents.length),
				)
			: Array.from({ length: championCount(player.waveNumber) }, () =>
					this.generateBuild(
						opponent ? `${opponent.name}'s champion` : "Wandering champion",
						championLevel,
						true,
						this.seed(),
						opponent
							? scaledStats(opponent.progress.allocation, championLevel)
							: undefined,
						false,
						intro ? meleeClasses : undefined,
					),
				);
		for (const champion of champions) {
			player.issuedUnits.set(champion.id, { build: champion, mode });
			spawns.push({
				build: champion,
				spawnAtMs:
					this.options.balance.wave.prepareMs +
					Math.floor(7.5 * this.options.balance.wave.batchIntervalMs),
			});
		}
		if (boss) {
			const build = this.playerBoss(boss);
			player.issuedUnits.set(build.id, { build, mode });
			spawns.push({ build, spawnAtMs: this.options.balance.wave.prepareMs });
		}
		spawns.sort((a, b) => a.spawnAtMs - b.spawnAtMs);
		this.options.send(player.id, {
			type: "incomingWave",
			wave: {
				id: this.createId(),
				targetId: player.id,
				waveNumber: player.waveNumber,
				durationMs: this.options.balance.wave.intervalMs,
				mode,
				resetHero,
				spawns,
			},
		});
		this.options.send(player.id, {
			type: "chatMessage",
			senderId: "",
			senderName: "",
			text: `Wave ${player.waveNumber} · ${waveModeLabel(mode)}`,
			kind: "system",
		});
		this.returnDeferredItems(player);
	}

	private generateBuild(
		name: string,
		level: number,
		isRival: boolean,
		seed: number,
		suppliedStats?: Stats,
		fewerItems = false,
		allowedClasses?: WeaponClass[],
	): UnitBuild {
		const stats = suppliedStats ?? scaledStats(randomAllocation(seed), level);
		const mainHand = generateItem(level, rollRarity(seed + 11), seed + 17, {
			fewerAffixes: fewerItems,
			allowedClasses,
		});
		const offHandRoll = this.options.random.next();
		const offHand =
			!allowedClasses && mainHand.hands === 1 && offHandRoll < 0.3
				? offHandRoll < 0.1
					? generateBuckler(level, rollRarity(seed + 19), seed + 21, isRival)
					: offHandRoll < 0.2
						? generateRelic(level, rollRarity(seed + 19), seed + 21)
						: isRival
							? generateItem(level, rollRarity(seed + 19), seed + 21, {
									allowedClasses: ["scepter"],
								})
							: generateAccessory(level, rollRarity(seed + 19), seed + 21)
				: undefined;
		const carried =
			isRival && level > 0
				? [
						generateItem(level, rollRarity(seed + 23), seed + 29, {
							fewerAffixes: true,
						}),
					]
				: [];
		return {
			id: this.createId(),
			name,
			kind: isRival
				? "rival"
				: mainHand.definitionId === "staff" ||
						mainHand.definitionId === "scepter"
					? "bubbleShooter"
					: "melee",
			level,
			stats,
			mainHand,
			offHand,
			carried,
			bonusSkills: [],
			isRival,
			enemyRole: isRival ? "champion" : "creep",
			xpReward: isRival ? rivalXpReward(level) : 10 + level,
			goldReward: isRival
				? 3 + Math.floor(level / 2)
				: 1 + Math.floor(level / 5),
			seed,
		};
	}

	private realmClone(
		defender: Player,
		attacker: Player,
		attackerCount: number,
	): UnitBuild {
		const level = realmCloneLevel(defender.progress.level, attackerCount);
		const seed = this.seed();
		return {
			id: this.createId(),
			name: `${attacker.name}'s clone`,
			kind: "rival",
			level,
			stats: scaledStats(attacker.progress.allocation, level),
			mainHand: structuredClone(attacker.progress.mainHand),
			offHand: attacker.progress.offHand
				? structuredClone(attacker.progress.offHand)
				: undefined,
			amulet: attacker.progress.amulet
				? structuredClone(attacker.progress.amulet)
				: undefined,
			charm: attacker.progress.charm
				? structuredClone(attacker.progress.charm)
				: undefined,
			carried: [],
			bonusSkills: [],
			isRival: true,
			enemyRole: "clone",
			xpReward: rivalXpReward(level),
			goldReward: 3 + Math.floor(level / 2),
			seed,
		};
	}

	private playerBoss(source: Player): UnitBuild {
		const progress = source.progress;
		const level = progress.level;
		const seed = this.seed();
		return {
			id: this.createId(),
			name: `${source.name}'s boss`,
			kind: "rival",
			level,
			stats: structuredClone(progress.stats),
			mainHand: progress.mainHand
				? structuredClone(progress.mainHand)
				: undefined,
			offHand: progress.offHand ? structuredClone(progress.offHand) : undefined,
			amulet: progress.amulet ? structuredClone(progress.amulet) : undefined,
			charm: progress.charm ? structuredClone(progress.charm) : undefined,
			carried: [],
			bonusSkills: [],
			skillLevels: bossSkillLevels(progress),
			isRival: true,
			enemyRole: "boss",
			xpReward: rivalXpReward(level),
			goldReward: 3 + Math.floor(level / 2),
			seed,
		};
	}

	private applyQueuedEquipment(
		build: UnitBuild,
		queued: QueuedEquipment,
		intro = false,
	): UnitBuild {
		const item = queued.item;
		let mainHand = build.mainHand;
		let offHand = build.offHand;
		let amulet = build.amulet;
		let charm = build.charm;
		if (
			intro &&
			(item.itemKind !== "weapon" ||
				item.definitionId === "staff" ||
				item.definitionId === "scepter" ||
				item.definitionId === "throwingAxe")
		)
			return {
				...build,
				carried: [...build.carried, item],
				emitterId: queued.senderId,
				emitterName: queued.senderName,
				backlash: queued.backlash,
				enemyRole: "invader",
			};
		const level = Math.max(build.level, item.level);
		const stats =
			level > build.level
				? scaledStats(randomAllocation(build.seed), level)
				: { ...build.stats };
		for (const key of STAT_KEYS)
			stats[key] = Math.max(stats[key], item.requirements[key] ?? 0);
		if (item.itemKind === "charm") charm = item;
		else if (item.itemKind === "amulet") amulet = item;
		else if (item.itemKind !== "weapon") {
			if (!mainHand || mainHand.hands === 2)
				mainHand = generateItem(level, item.rarity, this.seed(), {
					allowedClasses: [
						"club",
						"sword",
						"dagger",
						"mace",
						"axe",
						"throwingAxe",
						"hammer",
					] as WeaponClass[],
				});
			offHand = item;
		} else {
			mainHand = item;
			if (item.hands === 2) offHand = undefined;
		}
		return {
			...build,
			name: `${queued.senderName}'s carrier`,
			kind:
				mainHand?.definitionId === "staff" ||
				mainHand?.definitionId === "scepter"
					? "bubbleShooter"
					: "melee",
			level,
			stats,
			mainHand,
			offHand,
			amulet,
			charm,
			xpReward: build.isRival ? rivalXpReward(level) : 10 + level,
			goldReward: build.isRival
				? 3 + Math.floor(level / 2)
				: 1 + Math.floor(level / 5),
			emitterId: queued.senderId,
			emitterName: queued.senderName,
			backlash: queued.backlash,
			enemyRole: "invader",
		};
	}

	private takeQueued(
		player: Player,
		limit: number,
		includeBacklash = true,
	): QueuedEquipment[] {
		const sources = [...player.incomingQueues.entries()]
			.filter(([, queue]) => queue.length)
			.map(([id, queue]) => ({ id, queue }));
		if (includeBacklash && player.backlashQueue.length)
			sources.push({ id: "backlash", queue: player.backlashQueue });
		const result: QueuedEquipment[] = [];
		while (
			result.length < limit &&
			sources.some((source) => source.queue.length)
		) {
			const source = sources[player.queueCursor++ % sources.length];
			const item = source.queue.shift();
			if (item) result.push(item);
		}
		for (const [id, queue] of player.incomingQueues)
			if (!queue.length) player.incomingQueues.delete(id);
		return result;
	}

	private resolveDefeat(player: Player, unitId: string): void {
		const issued = player.issuedUnits.get(unitId);
		if (!issued)
			return this.notice(
				player,
				"Ignored an unknown or already resolved enemy.",
			);
		player.issuedUnits.delete(unitId);
		if (issued.mode === "training")
			return this.options.send(player.id, {
				type: "creepDefeatResolved",
				unitId,
				score: player.score,
				progress: player.progress,
				xpSendBuffs: this.xpSendBuffs(player),
				drops: [],
				reason: "Training kill: no rewards.",
			});
		const build = issued.build;
		player.score += build.isRival ? 10 : 2;
		const baseXp =
			build.xpReward *
			this.options.balance.rewards.xpMultiplier *
			(issued.mode === "solo" ? 0.5 : 1);
		const bonusXp = equippedBonusXp(
			player.progress.stats,
			player.progress.mainHand,
			player.progress.offHand,
			player.progress.amulet,
			player.progress.charm,
		);
		const xp = Math.floor(
			baseXp * this.activeXpSendMultiplier(player) * (1 + bonusXp),
		);
		this.grantXp(player, xp);
		const drops = this.rollDrops(player, build);
		const reason = drops.length
			? `Gained ${xp} XP. ${drops.length} reward${drops.length === 1 ? "" : "s"} dropped.`
			: `Gained ${xp} XP.`;
		this.options.send(player.id, {
			type: "creepDefeatResolved",
			unitId,
			score: player.score,
			progress: player.progress,
			xpSendBuffs: this.xpSendBuffs(player),
			drops,
			reason,
		});
		this.broadcastRealms();
	}

	private rollDrops(player: Player, build: UnitBuild): GroundDrop[] {
		const magicFind = this.playerMagicFind(player);
		const gold = this.rollGoldDrop(player, build);
		const extraChance = magicFindExtraDropChance(
			build.level,
			build.enemyRole ?? (build.isRival ? "champion" : "creep"),
			magicFind,
		);
		const extraCount =
			extraChance > 0
				? magicFindExtraDropCount(extraChance, this.options.random.next())
				: 0;
		const equipment =
			extraCount > 0
				? Array.from({ length: extraCount }, () =>
						this.createEquipmentDrop(
							player,
							build,
							this.generateMagicFindItem(build.level),
							0,
						),
					)
				: [];
		if (!equipment.length) {
			const fallback = this.rollEquippedItemDrop(player, build, magicFind);
			if (fallback) equipment.push(fallback);
		}
		return [...(gold ? [gold] : []), ...equipment];
	}

	private playerMagicFind(player: Player): number {
		const buckler =
			player.progress.offHand?.itemKind === "buckler"
				? player.progress.offHand
				: undefined;
		return Math.min(
			5,
			(buckler?.modifiers.magicFind ?? 0) +
				attractionFindBonus(effectiveProgressSkillLevel(player, "attraction")),
		);
	}

	private generateMagicFindItem(level: number): ItemInstance {
		const seed = this.seed();
		const rarity = magicFindRarityForRoll(this.options.random.next());
		const category = Math.floor(this.options.random.next() * 5);
		if (category === 1) return generateBuckler(level, rarity, seed, true);
		if (category === 2) return generateRelic(level, rarity, seed);
		if (category === 3) return generateAccessory(level, rarity, seed, "amulet");
		if (category === 4) return generateAccessory(level, rarity, seed, "charm");
		const classes = Object.keys(WEAPONS) as WeaponClass[];
		return generateItem(level, rarity, seed, {
			allowedClasses: [
				classes[Math.floor(this.options.random.next() * classes.length)],
			],
		});
	}

	private createEquipmentDrop(
		player: Player,
		build: UnitBuild,
		item: ItemInstance,
		magicFind: number,
	): GroundDrop {
		const id = this.createId();
		const promoted =
			magicFind > 0 &&
			nextRarity(item.rarity) &&
			this.options.random.next() < Math.min(1, magicFind)
				? changeItemRarity(item, nextRarity(item.rarity)!, this.seed())
				: item;
		if (promoted.rarity !== "unique" && this.options.random.next() < 0.25) {
			const drop: GroundDrop = {
				id,
				kind: "scrap",
				rarity: promoted.rarity,
				amount: purgeYield(promoted),
			};
			player.groundDrops.set(id, drop);
			return drop;
		}
		const droppedItem =
			build.enemyRole === "boss" &&
			promoted.rarity === "epic" &&
			this.options.random.next() < 0.01
				? changeItemRarity(promoted, "unique", this.seed())
				: promoted;
		const drop: GroundDrop = {
			id,
			kind: "item",
			item: { ...droppedItem, id: `${promoted.id}-drop-${id}` },
		};
		player.groundDrops.set(id, drop);
		return drop;
	}

	private rollGoldDrop(
		player: Player,
		build: UnitBuild,
	): GroundDrop | undefined {
		const buckler =
			player.progress.offHand?.itemKind === "buckler"
				? player.progress.offHand
				: undefined;
		const effectiveness = buckler
			? itemRequirementMultiplier(buckler, player.progress.stats)
			: 1;
		const goldGain = (buckler?.modifiers.goldGain ?? 0) * effectiveness;
		const attractionBonus = attractionFindBonus(
			effectiveProgressSkillLevel(player, "attraction"),
		);
		const goldChance = Math.min(
			1,
			(build.isRival ? 0.5 : 0.2) *
				this.options.balance.rewards.goldChanceMultiplier,
		);
		if (this.options.random.next() < goldChance) {
			const drop: GroundDrop = {
				id: this.createId(),
				kind: "gold",
				amount: Math.ceil(build.goldReward * (1 + goldGain + attractionBonus)),
			};
			player.groundDrops.set(drop.id, drop);
			return drop;
		}
	}

	private rollEquippedItemDrop(
		player: Player,
		build: UnitBuild,
		magicFind: number,
	): GroundDrop | undefined {
		const sent = build.emitterId
			? build.mainHand?.id.includes("sent")
				? build.mainHand
				: build.offHand?.id.includes("sent")
					? build.offHand
					: build.amulet?.id.includes("sent")
						? build.amulet
						: build.charm?.id.includes("sent")
							? build.charm
							: undefined
			: undefined;
		for (const item of [
			sent,
			sent?.id === build.mainHand?.id ? undefined : build.mainHand,
			sent?.id === build.offHand?.id ? undefined : build.offHand,
			sent?.id === build.amulet?.id ? undefined : build.amulet,
			sent?.id === build.charm?.id ? undefined : build.charm,
			...build.carried,
		].filter(Boolean) as ItemInstance[]) {
			const chance = Math.min(
				this.options.balance.rewards.maxDropChance,
				item.dropChance * this.options.balance.rewards.dropChanceMultiplier,
			);
			if (this.options.random.next() >= chance) continue;
			return this.createEquipmentDrop(player, build, item, magicFind);
		}
	}

	private collectDrop(player: Player, dropId: string): void {
		const drop = player.groundDrops.get(dropId);
		if (!drop)
			return this.options.send(player.id, {
				type: "collectItemResult",
				dropId,
				collected: false,
				reason: "That drop is no longer available.",
			});
		let changed = true;
		let reason: string;
		if (drop.kind === "gold") {
			player.progress.gold += drop.amount;
			reason = `Collected ${drop.amount} gold.`;
		} else if (drop.kind === "scrap") {
			player.progress.scraps[drop.rarity] += drop.amount;
			reason = `Collected ${drop.amount} ${drop.rarity} scrap.`;
		} else {
			const autoAction = applyAutoAction(player.progress, drop.item);
			if (autoAction === "send") {
				const target = this.nextTarget(player);
				if (target && this.queuedBy(player.id) < MAX_QUEUE) {
					const sent = {
						...drop.item,
						id: `${drop.item.id}-sent`,
					};
					const queue = target.incomingQueues.get(player.id) ?? [];
					queue.push({
						item: sent,
						senderId: player.id,
						senderName: player.name,
						backlash: false,
					});
					target.incomingQueues.set(player.id, queue);
					this.enqueueXpSendBuff(player, sent);
					changed = true;
					reason = `Auto-sent ${drop.item.name} for the enemy realm.`;
					this.broadcastRealms();
				} else {
					const result = collectIntoInventory(
						player.progress,
						drop.item,
						() => this.createId(),
						() => this.seed(),
					);
					changed = result.changed;
					reason = result.reason;
					if (changed) {
						const equipped = autoEquipCollectedItem(player.progress, drop.item);
						if (equipped.changed) reason = `${reason} ${equipped.reason}`;
					}
				}
			} else if (autoAction.changed) {
				changed = true;
				reason = autoAction.reason;
			} else {
				const result = collectIntoInventory(
					player.progress,
					drop.item,
					() => this.createId(),
					() => this.seed(),
				);
				changed = result.changed;
				reason = result.reason;
				if (changed) {
					const equipped = autoEquipCollectedItem(player.progress, drop.item);
					if (equipped.changed) reason = `${reason} ${equipped.reason}`;
				}
			}
		}
		if (changed) player.groundDrops.delete(dropId);
		this.options.send(player.id, {
			type: "collectItemResult",
			dropId,
			collected: changed,
			reason,
		});
		if (changed) this.sendProgress(player, reason);
	}
	private reconcileDrops(
		player: Player,
		activeDropIds: string[],
		pendingDropIds: string[],
	): void {
		const reported = new Set([...activeDropIds, ...pendingDropIds]);
		const ledger = new Set(player.groundDrops.keys());
		const drops = [...player.groundDrops.values()].filter(
			(drop) => !reported.has(drop.id),
		);
		const removeDropIds = activeDropIds.filter((id) => !ledger.has(id));
		const resolvedDropIds = pendingDropIds.filter((id) => !ledger.has(id));
		this.options.send(player.id, {
			type: "dropsReconciled",
			drops,
			removeDropIds,
			resolvedDropIds,
		});
	}
	private deferDrop(player: Player, dropId: string): void {
		const drop = player.groundDrops.get(dropId);
		if (!drop || drop.kind !== "item")
			return this.notice(
				player,
				"Only an owned equipment drop can leave the realm.",
			);
		player.groundDrops.delete(dropId);
		player.deferredItems.push(drop.item);
		this.notice(player, `${drop.item.name} will return next wave.`);
	}
	private returnDeferredItems(player: Player): void {
		if (!player.deferredItems.length) return;
		const deferred = player.deferredItems.splice(0);
		let stored = 0;
		for (const item of deferred) {
			const autoAction = applyAutoAction(player.progress, item);
			if (autoAction === "send") {
				const target = this.nextTarget(player);
				if (target && this.queuedBy(player.id) < MAX_QUEUE) {
					const sent = { ...item, id: `${item.id}-sent` };
					const queue = target.incomingQueues.get(player.id) ?? [];
					queue.push({
						item: sent,
						senderId: player.id,
						senderName: player.name,
						backlash: false,
					});
					target.incomingQueues.set(player.id, queue);
					this.enqueueXpSendBuff(player, sent);
					stored += 1;
					this.broadcastRealms();
					continue;
				}
			} else if (autoAction.changed) {
				stored += 1;
				continue;
			}
			const result = collectIntoInventory(
				player.progress,
				item,
				() => this.createId(),
				() => this.seed(),
			);
			if (result.changed) stored += 1;
			else {
				const id = this.createId();
				const drop: GroundDrop = {
					id,
					kind: "item",
					item: { ...item, id: `${item.id}-return-${id}` },
				};
				player.groundDrops.set(id, drop);
				this.options.send(player.id, { type: "groundDropCreated", drop });
			}
		}
		if (stored)
			this.sendProgress(
				player,
				`Returned ${stored} deferred item${stored === 1 ? "" : "s"} from the previous wave.`,
			);
	}

	private heroDefeated(
		player: Player,
		sourceUnitId?: string,
		voluntary = false,
		sourcePlayerId?: PlayerId,
	): void {
		if (!voluntary && !player.realmId && !player.realmOptedIn)
			return this.notice(player, "Training Grounds prevent defeat.");
		player.maxWaveReached = Math.max(player.maxWaveReached, player.waveNumber);
		this.queueDeathEcho(player);
		const source = sourceUnitId
			? player.issuedUnits.get(sourceUnitId)?.build
			: undefined;
		const recentBonk = this.recentBonks.get(player.id);
		this.recentBonks.delete(player.id);
		const bonkKiller =
			sourcePlayerId &&
			recentBonk?.attackerId === sourcePlayerId &&
			this.now() <= recentBonk.expiresAt
				? this.options.repository.get(sourcePlayerId)
				: undefined;
		const killer =
			source?.emitterId && !source.backlash && source.emitterId !== player.id
				? this.options.repository.get(source.emitterId)
				: bonkKiller;
		const activeRealm = player.realmId
			? this.realms.get(player.realmId)
			: undefined;
		const lostGold = Math.floor(player.progress.gold / 2);
		const lostSouls = Math.min(1, player.progress.souls);
		if (activeRealm)
			this.sendRealmSystem(
				activeRealm,
				killer
					? `${player.name} was defeated by ${bonkKiller ? `${recentBonk?.cause === "duel" ? "a realm challenge from" : "a bonk from"} ${killer.name}` : `a creep sent by ${killer.name}`}; ${killer.name} gained 1 Soul.`
					: `${player.name} was defeated and lost ${lostSouls} ${lostSouls === 1 ? "Soul" : "Souls"}.`,
			);
		player.progress.gold -= lostGold;
		player.progress.souls -= lostSouls;
		if (killer) {
			if (recentBonk?.cause !== "duel") killer.progress.gold += lostGold;
			killer.progress.souls += 1;
			this.options.repository.markDirty(killer.id);
			this.sendProgress(
				killer,
				recentBonk?.cause === "duel"
					? "Challenge victory: gained 1 Soul; loot dropped in your arena."
					: `Defeat spoils: gained ${lostGold} Gold and 1 Soul.`,
			);
			if (recentBonk?.cause === "duel")
				this.dropDuelLoot(player, killer, lostGold);
		}
		player.progress.xp = cumulativeXpForLevel(1);
		player.progress.level = 1;
		player.progress.stats = { ...DEFAULT_ALLOCATION };
		player.waveNumber = 1;
		player.issuedUnits.clear();
		player.groundDrops.clear();
		const overflow = dropInventoryOverflow(player.progress);
		for (const item of overflow) {
			const id = this.createId();
			const drop: GroundDrop = {
				id,
				kind: "item",
				item: { ...item, id: `${item.id}-${id}` },
			};
			player.groundDrops.set(id, drop);
			this.options.send(player.id, { type: "groundDropCreated", drop });
		}
		this.options.repository.markDirty(player.id);
		this.sendProgress(
			player,
			`Defeated: XP, attributes, and wave reset; lost ${lostGold} Gold and ${lostSouls} Souls${overflow.length ? `; dropped ${overflow.length} backpack item${overflow.length === 1 ? "" : "s"}` : ""}.`,
		);
		this.options.send(player.id, {
			type: "waveAdjusted",
			waveNumber: 1,
			reason: "Wave reset to 1 after defeat.",
		});
		const defeatedRealmId = player.realmId;
		player.realmOptedIn = false;
		if (defeatedRealmId) {
			this.dissolveRealm(defeatedRealmId);
			for (const created of this.matchWaitingPlayers())
				this.activateRealm(created);
			if (
				recentBonk?.cause === "duel" &&
				killer?.connected &&
				killer.realmOptedIn &&
				!killer.realmId
			)
				this.dispatchCurrentWave(killer, "solo", true);
			if (recentBonk?.cause === "duel" && killer?.connected)
				for (const drop of killer.groundDrops.values())
					this.options.send(killer.id, { type: "groundDropCreated", drop });
		}
		this.dispatchCurrentWave(player, "training", true);
		this.broadcastRealms();
	}

	private dropDuelLoot(loser: Player, winner: Player, gold: number): void {
		if (gold > 0) {
			const id = this.createId();
			const drop: GroundDrop = { id, kind: "gold", amount: gold };
			winner.groundDrops.set(id, drop);
			this.options.send(winner.id, { type: "groundDropCreated", drop });
		}
		for (const rarity of ["common", "uncommon", "rare", "epic"] as const) {
			const amount = loser.progress.scraps[rarity];
			if (!amount) continue;
			loser.progress.scraps[rarity] = 0;
			const id = this.createId();
			const drop: GroundDrop = { id, kind: "scrap", rarity, amount };
			winner.groundDrops.set(id, drop);
			this.options.send(winner.id, { type: "groundDropCreated", drop });
		}
		const copies = loser.progress.inventoryTiles.reduce(
			(total, tile) => total + tile.quantity,
			0,
		);
		if (!copies) return;
		let selected = Math.floor(this.options.random.next() * copies);
		const tile = loser.progress.inventoryTiles.find((candidate) => {
			if (selected < candidate.quantity) return true;
			selected -= candidate.quantity;
			return false;
		});
		if (!tile) return;
		const equippedSlots = ["mainHand", "offHand", "amulet", "charm"] as const;
		const matchingSlots = equippedSlots.filter((slot) => {
			const item = loser.progress[slot];
			return item && itemStackKey(item) === tile.key;
		});
		if (tile.quantity <= matchingSlots.length) {
			const slot = matchingSlots[0];
			if (slot) loser.progress[slot] = undefined;
		}
		tile.quantity -= 1;
		removeEmptyInventoryTiles(loser.progress);
		const id = this.createId();
		const drop: GroundDrop = {
			id,
			kind: "item",
			item: { ...structuredClone(tile.item), id: `${tile.item.id}-duel-${id}` },
		};
		winner.groundDrops.set(id, drop);
		this.options.send(winner.id, { type: "groundDropCreated", drop });
	}

	private queueDeathEcho(player: Player): void {
		const recipient = [...this.options.repository.values()].sort(
			(a, b) =>
				b.progress.souls - a.progress.souls || a.name.localeCompare(b.name),
		)[0];
		if (!recipient || recipient.id === player.id) return;
		const p = player.progress;
		const seed = this.seed();
		const echo: UnitBuild = {
			id: this.createId(),
			name: `${player.name}'s death echo`,
			kind: "rival",
			level: p.level,
			stats: { ...p.stats },
			mainHand: structuredClone(p.mainHand),
			offHand: p.offHand ? structuredClone(p.offHand) : undefined,
			amulet: p.amulet ? structuredClone(p.amulet) : undefined,
			charm: p.charm ? structuredClone(p.charm) : undefined,
			carried: [],
			bonusSkills: [],
			isRival: true,
			enemyRole: "clone",
			xpReward: rivalXpReward(p.level),
			goldReward: 3 + Math.floor(p.level / 2),
			seed,
		};
		recipient.deathEchoes.push(echo);
		this.options.repository.markDirty(recipient.id);
		if (recipient.connected)
			this.notice(
				recipient,
				`${player.name}'s death echo will enter your next wave.`,
			);
	}

	private sendItem(player: Player, tileId: string, bulk = false): void {
		let sent = 0;
		let bonked: Player | undefined;
		let reason = "That equipment is no longer available.";
		do {
			if (this.queuedBy(player.id) >= MAX_QUEUE) {
				reason = "Your realm queue has reached 1000 items.";
				break;
			}
			const target = this.nextTarget(player);
			if (!target) {
				reason = "No Realm Guard is available.";
				break;
			}
			const result = sendFromInventory(player.progress, tileId);
			reason = result.reason;
			if (!result.changed || !result.sent) break;
			const queue = target.incomingQueues.get(player.id) ?? [];
			queue.push({
				item: result.sent,
				senderId: player.id,
				senderName: player.name,
				backlash: false,
			});
			target.incomingQueues.set(player.id, queue);
			this.enqueueXpSendBuff(player, result.sent);
			if (this.bonkPlayer(player, target)) bonked = target;
			sent += 1;
		} while (bulk && sent < MAX_QUEUE);
		removeEmptyInventoryTiles(player.progress);
		if (!sent) return this.notice(player, reason);
		const buffs = this.xpSendBuffs(player);
		const buff = buffs[0];
		const seconds = buff
			? Math.max(0, Math.ceil((buff.expiresAt - this.now()) / 1000))
			: 0;
		const queued = Math.max(0, buffs.length - 1);
		const bonkReadyIn = Math.max(
			0,
			Math.ceil(((this.bonkReadyAt.get(player.id) ?? 0) - this.now()) / 1000),
		);
		this.sendProgress(
			player,
			`${bulk ? `Queued ${sent} items for future carriers.` : reason} ${bonked ? `Bonked ${bonked.id === player.id ? "yourself" : bonked.name}; Bonk ready in ${bonkReadyIn}s.` : bonkReadyIn ? `Bonk ready in ${bonkReadyIn}s.` : ""} ${buff ? `XP buff: ${Math.round(buff.multiplier * 100)}% for ${seconds} seconds${queued ? `; ${queued} queued.` : "."}` : "The sent item's level grants no XP-buff duration."}`,
		);
		this.broadcastRealms();
	}

	private leaveRealm(player: Player): void {
		if (!player.realmId) {
			player.realmOptedIn = false;
			return this.broadcastRealms();
		}
		if (!this.canLeave())
			return this.notice(
				player,
				"Leave to Lobby opens after the final planned spawn.",
			);
		const id = player.realmId;
		player.realmOptedIn = false;
		this.dissolveRealm(id);
		for (const created of this.matchWaitingPlayers())
			this.activateRealm(created);
		this.dispatchCurrentWave(player, "training");
		this.broadcastRealms();
	}
	private enterRealm(
		player: Player,
		waveNumber: number,
		legacyRequest = false,
	): void {
		const bestWave = Math.max(1, player.maxWaveReached);
		if (!legacyRequest && waveNumber !== 1 && waveNumber !== bestWave)
			return this.notice(player, "Choose wave 1 or your current best wave.");
		player.waveNumber = waveNumber;
		player.realmOptedIn = true;
		player.waitingSince = Date.now();
		const created = this.matchWaitingPlayers();
		for (const realm of created) this.activateRealm(realm);
		if (!player.realmId) {
			player.issuedUnits.clear();
			player.groundDrops.clear();
			this.dispatchCurrentWave(player, "solo", true);
		}
		this.broadcastRealms();
	}

	private matchWaitingPlayers(): Realm[] {
		const created: Realm[] = [];
		const waiting = [...this.options.repository.values()]
			.filter((p) => p.connected && p.realmOptedIn && !p.realmId)
			.sort(
				(a, b) =>
					b.progress.level - a.progress.level ||
					a.waitingSince - b.waitingSince ||
					a.id.localeCompare(b.id),
			);
		while (waiting.length >= 2) {
			const solo = waiting.shift()!;
			const subset = bestSubset(solo, waiting);
			if (!subset.length) break;
			for (const member of subset) waiting.splice(waiting.indexOf(member), 1);
			const realm: Realm = {
				id: this.createId(),
				soloId: solo.id,
				teamIds: subset.map((p) => p.id),
				down: new Set(),
			};
			this.realms.set(realm.id, realm);
			solo.realmId = realm.id;
			for (const member of subset) member.realmId = realm.id;
			created.push(realm);
		}
		return created;
	}

	private activateRealm(realm: Realm): void {
		const participantNames = [realm.soloId, ...realm.teamIds]
			.map((id) => this.options.repository.get(id)?.name)
			.filter((name): name is string => Boolean(name));
		for (const name of participantNames)
			this.sendRealmSystem(realm, `${name} joined the realm.`);
		for (const id of [realm.soloId, ...realm.teamIds]) {
			const player = this.options.repository.get(id);
			if (!player?.connected) continue;
			this.options.logRealmLifecycle?.(
				"entered",
				id,
				realm.id,
				this.realmOpponentIds(realm, id),
			);
			player.issuedUnits.clear();
			player.groundDrops.clear();
			this.dispatchCurrentWave(player, "competitive", true);
		}
	}

	private dissolveRealm(id: string): void {
		const realm = this.realms.get(id);
		if (!realm) return;
		const members = [realm.soloId, ...realm.teamIds]
			.map((pid) => this.options.repository.get(pid))
			.filter(isPlayer);
		const memberIds = new Set(members.map((p) => p.id));
		for (const recipient of members)
			for (const [senderId, queue] of [...recipient.incomingQueues])
				if (senderId !== recipient.id && memberIds.has(senderId)) {
					const sender = this.options.repository.get(senderId);
					if (sender)
						for (const entry of queue)
							sender.backlashQueue.push({
								...entry,
								backlash: true,
								senderId: sender.id,
								senderName: "Realm backlash",
							});
					recipient.incomingQueues.delete(senderId);
				}
		for (const member of members) {
			this.options.logRealmLifecycle?.(
				"left",
				member.id,
				realm.id,
				this.realmOpponentIds(realm, member.id),
			);
			member.realmId = undefined;
			member.waitingSince = Date.now();
		}
		this.realms.delete(id);
	}

	private nextTarget(player: Player): Player | undefined {
		const opponents = this.realmOpponents(player);
		if (!opponents.length) return player;
		return opponents[player.outgoingRotation++ % opponents.length];
	}
	private realmOpponentIds(realm: Realm, playerId: PlayerId): PlayerId[] {
		return realm.soloId === playerId ? [...realm.teamIds] : [realm.soloId];
	}
	private realmOpponents(player: Player): Player[] {
		if (!player.realmId) return [];
		const realm = this.realms.get(player.realmId);
		if (!realm) return [];
		const ids = realm.soloId === player.id ? realm.teamIds : [realm.soloId];
		return ids.map((id) => this.options.repository.get(id)).filter(isPlayer);
	}
	private queuedBy(senderId: string): number {
		let count = 0;
		for (const player of this.options.repository.values()) {
			count += player.incomingQueues.get(senderId)?.length ?? 0;
			if (player.id === senderId) count += player.backlashQueue.length;
		}
		return count;
	}
	private canLeave(): boolean {
		return (
			Date.now() - this.lastDispatchAt >=
			this.options.balance.wave.prepareMs +
				9 * this.options.balance.wave.batchIntervalMs
		);
	}

	private realmState(player: Player): RealmState {
		if (!player.realmId) {
			const self = { ...this.publicPlayer(player), down: false };
			return {
				mode: player.realmOptedIn ? "waiting" : "training",
				guards: [self],
				attackers: [self],
				outgoingQueued: this.queuedBy(player.id),
				incomingQueued: [...player.incomingQueues.values()].reduce(
					(n, q) => n + q.length,
					player.backlashQueue.length + player.deathEchoes.length,
				),
				canLeave: true,
				challenge: "unavailable",
			};
		}
		const realm = this.realms.get(player.realmId)!;
		const opponents = this.realmOpponents(player);
		const member = (entry: Player): RealmMember => ({
			...this.publicPlayer(entry),
			down: realm.down.has(entry.id),
		});
		const challenge =
			realm.teamIds.length !== 1
				? "unavailable"
				: realm.duelActive
					? "active"
					: realm.duelPending
						? "agreed"
						: !realm.challengeFrom
							? "none"
							: realm.challengeFrom === player.id
								? "outgoing"
								: "incoming";
		return {
			mode: "competitive",
			guards: opponents.map(member),
			attackers: opponents.map(member),
			outgoingQueued: this.queuedBy(player.id),
			incomingQueued: [...player.incomingQueues.values()].reduce(
				(n, q) => n + q.length,
				player.deathEchoes.length,
			),
			canLeave: this.canLeave(),
			challenge,
		};
	}
	private waveMode(player: Player): "competitive" | "solo" | "training" {
		return player.realmId
			? "competitive"
			: player.realmOptedIn
				? "solo"
				: "training";
	}
	private broadcastRealms(): void {
		for (const player of this.options.repository.values())
			if (player.connected)
				this.options.send(player.id, {
					type: "realmUpdated",
					realm: this.realmState(player),
				});
	}
	private publicPlayer(player: Player): PublicPlayer {
		return {
			id: player.id,
			name: player.name,
			score: player.score,
			waveNumber: player.waveNumber,
			maxWaveReached: player.maxWaveReached,
			level: player.progress.level,
			receivesDeathEchoes: this.leaderboard()[0]?.id === player.id,
		};
	}
	private enqueueXpSendBuff(player: Player, item: ItemInstance): void {
		const buffs = this.xpSendBuffs(player);
		const multiplier = XP_SEND_MULTIPLIERS[item.rarity];
		const duration = (10 + item.level * 2) * 1_000;
		if (buffs[0]?.multiplier === multiplier) {
			for (const buff of buffs) buff.expiresAt += duration;
			return;
		}
		const startsAt = Math.max(this.now(), buffs.at(-1)?.expiresAt ?? 0);
		buffs.push({
			multiplier,
			expiresAt: startsAt + duration,
		});
	}
	private xpSendBuffs(player: Player): XpSendBuff[] {
		player.xpSendBuffs = (player.xpSendBuffs ?? []).filter(
			(buff) => buff.expiresAt > this.now(),
		);
		return player.xpSendBuffs;
	}
	private activeXpSendMultiplier(player: Player): number {
		return this.xpSendBuffs(player)[0]?.multiplier ?? 1;
	}
	private grantXp(player: Player, amount: number): void {
		const old = player.progress.level;
		player.progress.xp += amount;
		const next = levelForXp(player.progress.xp);
		for (let level = old; level < next; level += 1)
			for (const key of STAT_KEYS)
				player.progress.stats[key] += player.progress.allocation[key];
		player.progress.level = next;
	}
	private respecStats(player: Player, allocation: Stats): void {
		if (!validAllocation(allocation))
			return this.notice(
				player,
				"Respec ratio must use non-negative integers totaling 5.",
			);
		const cost = player.progress.level * 100;
		if (player.progress.gold < cost)
			return this.notice(player, `Respec requires ${cost} gold.`);
		player.progress.gold -= cost;
		player.progress.allocation = { ...allocation };
		player.progress.stats = scaledStats(allocation, player.progress.level);
		this.sendProgress(
			player,
			`Reapplied the allocation ratio across ${player.progress.level} levels for ${cost} gold.`,
		);
	}
	private applyInventoryAction(
		player: Player,
		bulk: boolean | undefined,
		action: () => InventoryResult,
	): void {
		let changed = 0;
		let result = action();
		while (result.changed) {
			changed += 1;
			if (!bulk) break;
			result = action();
		}
		removeEmptyInventoryTiles(player.progress);
		if (!changed) return this.notice(player, result.reason);
		this.sendProgress(
			player,
			bulk ? `Completed ${changed} item actions.` : result.reason,
		);
	}
	private applyInventoryResult(player: Player, result: InventoryResult): void {
		if (!result.changed) return this.notice(player, result.reason);
		for (const item of result.dropped ?? []) {
			const id = this.createId();
			const drop: GroundDrop = { id, kind: "item", item };
			player.groundDrops.set(id, drop);
			this.options.send(player.id, { type: "groundDropCreated", drop });
		}
		removeEmptyInventoryTiles(player.progress);
		this.sendProgress(player, result.reason);
	}
	private sendProgress(player: Player, reason: string): void {
		this.options.send(player.id, {
			type: "progressionUpdated",
			progress: player.progress,
			xpSendBuffs: this.xpSendBuffs(player),
			reason,
		});
	}
	private handleChat(player: Player, text: string): void {
		const message: ServerMessage = {
			type: "chatMessage",
			senderId: player.id,
			senderName: player.name,
			text,
		};
		this.options.send(player.id, message);
		const realmId = player.realmId;
		if (!realmId) return;
		const realm = this.realms.get(realmId);
		if (!realm) return;
		for (const memberId of [realm.soloId, ...realm.teamIds])
			if (memberId !== player.id) this.options.send(memberId, message);
	}
	private sendRealmSystem(realm: Realm, text: string): void {
		for (const memberId of [realm.soloId, ...realm.teamIds])
			this.options.send(memberId, {
				type: "chatMessage",
				senderId: "",
				senderName: "",
				text,
				kind: "system",
			});
	}
	private notice(player: Player, message: string): void {
		this.options.send(player.id, {
			type: "serverNotice",
			message,
			tone: "error",
		});
	}
	private seed(): number {
		return randomSeed(this.options.random);
	}
}

function bestSubset(solo: Player, candidates: Player[]): Player[] {
	let best: Player[] = [];
	let bestDiff = Infinity;
	for (let size = 1; size <= Math.min(3, candidates.length); size += 1)
		for (const group of combinations(candidates, size)) {
			const diff = Math.abs(
				solo.progress.level -
					group.reduce((sum, p) => sum + p.progress.level, 0),
			);
			if (
				diff < bestDiff ||
				(diff === bestDiff && (!best.length || group.length < best.length))
			) {
				best = group;
				bestDiff = diff;
			}
		}
	return best;
}
function combinations<T>(
	values: T[],
	size: number,
	start = 0,
	prefix: T[] = [],
): T[][] {
	if (prefix.length === size) return [prefix];
	const result: T[][] = [];
	for (let i = start; i < values.length; i += 1)
		result.push(...combinations(values, size, i + 1, [...prefix, values[i]]));
	return result;
}
function randomAllocation(seed: number): Stats {
	const values = STAT_KEYS.map((_, index) => ((seed >>> (index * 5)) & 15) + 1);
	const total = values.reduce((sum, value) => sum + value, 0);
	return Object.fromEntries(
		STAT_KEYS.map((key, index) => [key, (5 * values[index]) / total]),
	) as Stats;
}
function regularCreepStats(stats: Stats): Stats {
	if (stats.spirit <= 1) return { ...stats };
	return {
		...stats,
		strength: stats.strength + stats.spirit - 1,
		spirit: 1,
	};
}
function waveModeLabel(mode: "competitive" | "solo" | "training"): string {
	return mode === "competitive"
		? "Competitive Realm"
		: mode === "solo"
			? "Solo Realm"
			: "Training Grounds";
}
function effectiveProgressSkillLevel(player: Player, skill: SkillId): number {
	const progress = player.progress;
	return bossSkillLevels(progress)[skill] ?? 0;
}
function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
	return typeof (value as Promise<T> | undefined)?.then === "function";
}
function bossSkillLevels(
	progress: Player["progress"],
): Partial<Record<SkillId, number>> {
	const equipment = [
		progress.mainHand,
		progress.offHand,
		progress.amulet,
		progress.charm,
	];
	const equippedSkills = new Set(
		equipment.flatMap((item) => item?.skills ?? []),
	);
	const skills = new Set<SkillId>([
		...equippedSkills,
		...progress.learnedSkills.filter(
			(skill) =>
				progress.universalSkills.includes(skill) || equippedSkills.has(skill),
		),
	]);
	const stats = statsWithItemBonuses(
		progress.stats,
		progress.mainHand,
		progress.offHand,
		progress.amulet,
		progress.charm,
	);
	return Object.fromEntries(
		[...skills].map((skill) => {
			const learned =
				progress.learnedSkillLevels[skill] ??
				(progress.learnedSkills.includes(skill) ? 1 : 0);
			const equipped = equippedSkills.has(skill)
				? equippedSkillLevelContribution(equipment, skill)
				: 0;
			const accessoryBonus = [
				progress.offHand,
				progress.amulet,
				progress.charm,
			].reduce(
				(sum, item) =>
					sum +
					itemSkillLevelBonus(item, SKILLS[skill].resource) *
						(item ? itemRequirementMultiplier(item, stats) : 1),
				0,
			);
			const timeHarvestBonus =
				skill === "timeHarvest" && progress.amulet?.skills.includes(skill)
					? timeHarvestItemSkillBonus(progress.amulet.level)
					: 0;
			return [
				skill,
				Math.min(
					cappedSkillLevel(
						learned + equipped + Math.floor(accessoryBonus) + timeHarvestBonus,
					),
					progress.level,
				),
			];
		}),
	) as Partial<Record<SkillId, number>>;
}
function isPlayer(player: Player | undefined): player is Player {
	return Boolean(player);
}
