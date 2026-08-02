import { describe, expect, test } from "bun:test";
import { BALANCE } from "../common/balance";
import { emptyScraps, upgradeCosts } from "../common/inventory";
import { generateBuckler, generateItem, itemStackKey } from "../common/items";
import { cumulativeXpForLevel } from "../common/progression";
import type { PlayerId, ServerMessage } from "../common/protocol";
import type { RandomSource } from "../common/random";
import { InMemoryPlayerRepository } from "../server/domain";
import { GameService } from "../server/GameService";

class FixedRandom implements RandomSource {
	constructor(private readonly value = 0) {}
	next(): number {
		return this.value;
	}
}
class SequenceRandom implements RandomSource {
	private values: number[] = [];
	set(...values: number[]): void {
		this.values = values;
	}
	next(): number {
		return this.values.shift() ?? 0.5;
	}
}
function harness(
	random: RandomSource = new FixedRandom(0),
	now?: () => number,
) {
	const messages = new Map<PlayerId, ServerMessage[]>();
	const repository = new InMemoryPlayerRepository();
	let nextId = 0;
	const game = new GameService({
		repository,
		balance: BALANCE,
		random,
		now,
		createId: () => `id-${++nextId}`,
		send: (id, message) =>
			messages.set(id, [...(messages.get(id) ?? []), structuredClone(message)]),
	});
	return { game, repository, messages };
}
function enterPair(
	game: GameService,
	one: ReturnType<GameService["join"]>,
	two: ReturnType<GameService["join"]>,
): void {
	game.handle(one.id, { type: "enterRealm" });
	game.handle(two.id, { type: "enterRealm" });
}

describe("realm game service", () => {
	test("starts new players empty-handed with three random backpack items and only Healing bound", () => {
		const { game } = harness();
		const player = game.join("Starter");
		expect(player.progress.mainHand).toBeUndefined();
		expect(player.waveNumber).toBe(1);
		expect(player.progress.offHand).toBeUndefined();
		expect(
			player.progress.inventoryTiles.reduce(
				(sum, tile) => sum + tile.quantity,
				0,
			),
		).toBe(3);
		expect(
			player.progress.inventoryTiles.every(
				(tile) => tile.item.level === 0 && tile.item.rarity === "common",
			),
		).toBeTrue();
		expect(player.progress.universalSkills).toEqual(["healing"]);
		expect(player.panelTriggers).toEqual({
			character: true,
			inventory: true,
			multiplayer: true,
		});
		game.handle(player.id, { type: "dismissPanelTrigger", panel: "character" });
		expect(player.panelTriggers.character).toBeFalse();
	});
	test("edits an available skill's persisted loadout and auto-fire state", () => {
		const { game } = harness();
		const player = game.join("Toggle");
		game.handle(player.id, {
			type: "toggleSkillAutoFire",
			skillId: "healing",
		});
		expect(player.progress.autoFireSkills).toEqual([]);
		game.handle(player.id, {
			type: "setSkillEquipped",
			skillId: "healing",
			equipped: false,
		});
		expect(player.progress.equippedSkills).toEqual([]);
	});
	test("reconciles server and client drop orphans without granting them", () => {
		const { game, messages } = harness();
		const player = game.join("Drops");
		player.groundDrops.set("server-only", {
			id: "server-only",
			kind: "gold",
			amount: 2,
		});
		const gold = player.progress.gold;
		game.handle(player.id, {
			type: "reconcileDrops",
			activeDropIds: ["client-only"],
			pendingDropIds: ["resolved"],
		});
		const result = messages.get(player.id)?.at(-1);
		expect(result?.type).toBe("dropsReconciled");
		if (result?.type === "dropsReconciled") {
			expect(result.drops.map((drop) => drop.id)).toEqual(["server-only"]);
			expect(result.removeDropIds).toEqual(["client-only"]);
			expect(result.resolvedDropIds).toEqual(["resolved"]);
		}
		expect(player.progress.gold).toBe(gold);
	});
	test("publishes empty-handed build profiles and the lifetime best wave without currencies or inventory", () => {
		const { game } = harness();
		const player = game.join("Public");
		player.progress.level = 4;
		player.waveNumber = 7;
		game.handle(player.id, { type: "enterRealm" });
		const profile = game.publicHeroProfile(player.id)!;
		expect(profile.level).toBe(4);
		expect(profile.maxWaveReached).toBe(7);
		expect(profile.mainHand).toBeUndefined();
		expect("gold" in profile).toBeFalse();
		expect("inventoryTiles" in profile).toBeFalse();
	});
	test("logs player connection lifecycle with stable identity", () => {
		const repository = new InMemoryPlayerRepository();
		const events: Array<{
			event: "connected" | "disconnected";
			id: string;
			name: string;
		}> = [];
		let nextId = 0;
		const game = new GameService({
			repository,
			balance: BALANCE,
			random: new FixedRandom(),
			createId: () => `id-${++nextId}`,
			send: () => {},
			logPlayerLifecycle: (event, player) =>
				events.push({ event, id: player.id, name: player.name }),
		});
		const player = game.join(" Logger ");
		game.disconnect(player.id);
		expect(events).toEqual([
			{ event: "connected", id: player.id, name: "Logger" },
			{ event: "disconnected", id: player.id, name: "Logger" },
		]);
	});
	test("logs realm entry and exit for each matched player", () => {
		const repository = new InMemoryPlayerRepository();
		const events: Array<{
			event: "entered" | "left";
			playerId: string;
			realmId: string;
			opponentIds: string[];
		}> = [];
		let nextId = 0;
		const game = new GameService({
			repository,
			balance: BALANCE,
			random: new FixedRandom(),
			createId: () => `id-${++nextId}`,
			send: () => {},
			logRealmLifecycle: (event, playerId, realmId, opponentIds) =>
				events.push({ event, playerId, realmId, opponentIds }),
		});
		const one = game.join("One");
		const two = game.join("Two");
		enterPair(game, one, two);
		const realmId = one.realmId!;
		game.disconnect(one.id);
		expect(events).toEqual([
			{ event: "entered", playerId: one.id, realmId, opponentIds: [two.id] },
			{ event: "entered", playerId: two.id, realmId, opponentIds: [one.id] },
			{ event: "left", playerId: one.id, realmId, opponentIds: [two.id] },
			{ event: "left", playerId: two.id, realmId, opponentIds: [one.id] },
		]);
	});
	test("starts in the lobby and activates a stable 1v1 after opting in", () => {
		const { game, messages } = harness();
		const one = game.join("One");
		expect(one.realmOptedIn).toBeFalse();
		const training = messages
			.get(one.id)
			?.find((m) => m.type === "incomingWave");
		expect(
			training?.type === "incomingWave" ? training.wave.mode : undefined,
		).toBe("training");
		expect(
			training?.type === "incomingWave" ? training.wave.resetHero : undefined,
		).toBeFalse();
		const two = game.join("Two");
		expect(one.realmId).toBeUndefined();
		enterPair(game, one, two);
		expect(one.realmId).toBe(two.realmId);
		expect(one.issuedUnits.size).toBe(10);
		expect([...one.issuedUnits.values()][0].mode).toBe("competitive");
		const competitive = messages
			.get(one.id)
			?.filter((message) => message.type === "incomingWave")
			.at(-1);
		expect(
			competitive?.type === "incomingWave"
				? competitive.wave.resetHero
				: undefined,
		).toBeTrue();
	});
	test("starts a half-XP solo game when no opponent is available", () => {
		const { game, messages } = harness();
		const player = game.join("Solo");
		game.handle(player.id, { type: "enterRealm" });
		const wave = messages
			.get(player.id)
			?.filter((message) => message.type === "incomingWave")
			.at(-1);
		expect(wave?.type === "incomingWave" ? wave.wave.mode : undefined).toBe(
			"solo",
		);
		expect(
			wave?.type === "incomingWave" ? wave.wave.resetHero : undefined,
		).toBeTrue();
		const unitId = [...player.issuedUnits.entries()].find(
			([, issued]) => !issued.build.isRival,
		)?.[0];
		expect(unitId).toBeDefined();
		game.handle(player.id, { type: "creepDefeated", unitId: unitId! });
		expect(player.progress.xp).toBe(5);
		expect(player.score).toBe(2);
	});
	test("restarts realm entry at wave one after death and keeps the best wave", () => {
		const { game, messages } = harness();
		const player = game.join("Restarted");
		player.waveNumber = 12;
		game.handle(player.id, { type: "suicide" });
		expect(player.waveNumber).toBe(1);
		expect(player.maxWaveReached).toBe(12);
		const adjusted = messages
			.get(player.id)
			?.filter((message) => message.type === "waveAdjusted")
			.at(-1);
		expect(
			adjusted?.type === "waveAdjusted" ? adjusted.waveNumber : undefined,
		).toBe(1);
		game.handle(player.id, { type: "enterRealm" });
		const wave = messages
			.get(player.id)
			?.filter((message) => message.type === "incomingWave")
			.at(-1);
		expect(
			wave?.type === "incomingWave" ? wave.wave.waveNumber : undefined,
		).toBe(1);
		expect(player.maxWaveReached).toBe(12);
	});
	test("omits early champions and authors later champion difficulty from the wave", () => {
		const { game } = harness();
		const player = game.join("EliteHunter");
		expect(
			[...player.issuedUnits.values()].some((entry) => entry.build.isRival),
		).toBeFalse();
		player.waveNumber = 8;
		player.progress.level = 10;
		game.handle(player.id, { type: "enterRealm" });
		const [unitId, issued] = [...player.issuedUnits.entries()].find(
			([, entry]) => entry.build.isRival,
		)!;
		expect(issued.build.level).toBe(4);
		expect(issued.build.xpReward).toBe(37);
		game.handle(player.id, { type: "creepDefeated", unitId });
		expect(player.progress.xp).toBe(18);
	});
	test("reserves generated Scepter auras for post-intro champions", () => {
		const { game } = harness(new FixedRandom(0.25));
		const player = game.join("AuraHunter");
		player.waveNumber = 9;
		player.progress.level = 10;
		game.handle(player.id, { type: "enterRealm" });
		const issued = [...player.issuedUnits.values()];
		const champion = issued.find(({ build }) => build.enemyRole === "champion");
		expect(champion?.build.offHand?.definitionId).toBe("scepter");
		expect(champion?.build.offHand?.skills).toHaveLength(1);
		expect(
			issued
				.filter(({ build }) => build.enemyRole === "creep")
				.every(({ build }) => build.offHand?.definitionId !== "scepter"),
		).toBeTrue();
	});
	test("replaces modulo-ten champions with an equipped attacker clone on a successful roll", () => {
		const { game } = harness(new FixedRandom(0));
		const defender = game.join("Defender");
		const attacker = game.join("Attacker");
		defender.progress.level = 11;
		attacker.progress.allocation = {
			agility: 2,
			strength: 1,
			magic: 1,
			spirit: 1,
			intelligence: 0,
		};
		attacker.progress.mainHand = generateItem(7, "rare", 404, {
			allowedClasses: ["axe"],
		});
		enterPair(game, defender, attacker);
		defender.waveNumber = 10;
		game.handle(defender.id, { type: "requestWave" });
		const clone = [...defender.issuedUnits.values()]
			.map(({ build }) => build)
			.find(({ name }) => name === "Attacker's clone")!;
		expect(clone.level).toBe(11);
		expect(clone.stats).toEqual({
			agility: 22,
			strength: 11,
			magic: 11,
			spirit: 11,
			intelligence: 0,
		});
		expect(clone.mainHand).toEqual(attacker.progress.mainHand);
		expect(clone.carried).toEqual([]);
		expect(clone.enemyRole).toBe("clone");
		expect(clone.xpReward).toBe(58);
	});
	test("adds one eligible persisted hero as a level-capped equipped boss on divisible-by-ten waves", () => {
		const { game } = harness(new FixedRandom(0));
		const source = game.join("BossSource");
		const target = game.join("BossTarget");
		source.progress.level = 4;
		source.progress.stats = {
			agility: 7,
			strength: 6,
			magic: 5,
			spirit: 4,
			intelligence: 3,
		};
		source.progress.mainHand = generateItem(4, "rare", 811, {
			allowedClasses: ["staff"],
		});
		source.progress.learnedSkillLevels.healing = 99;
		target.waveNumber = 10;
		game.handle(target.id, { type: "requestWave" });
		const boss = [...target.issuedUnits.values()]
			.map(({ build }) => build)
			.find(({ name }) => name === "BossSource's boss");
		expect(boss).toMatchObject({
			kind: "rival",
			enemyRole: "boss",
			level: 4,
			stats: source.progress.stats,
			mainHand: source.progress.mainHand,
			xpReward: 37,
		});
		expect(boss?.skillLevels?.healing).toBe(4);
		expect(boss?.skillLevels?.arcaneBolt).toBe(1);
	});
	test("shows the lobby player as their own neighbor and sends to a future training carrier", () => {
		const { game, messages } = harness();
		const player = game.join("Mirror");
		const welcome = messages
			.get(player.id)
			?.find((message) => message.type === "welcome");
		expect(
			welcome?.type === "welcome" ? welcome.realm.guards[0]?.id : undefined,
		).toBe(player.id);
		expect(
			welcome?.type === "welcome" ? welcome.realm.attackers[0]?.id : undefined,
		).toBe(player.id);
		const item = generateItem(2, "rare", 75);
		player.progress.inventoryTiles.push({
			id: "mirror-tile",
			key: itemStackKey(item),
			item,
			quantity: 1,
		});
		game.handle(player.id, { type: "sendItem", tileId: "mirror-tile" });
		expect(player.incomingQueues.get(player.id)).toHaveLength(1);
		game.dispatchWaves();
		expect(player.incomingQueues.get(player.id)).toBeUndefined();
		const carrier = [...player.issuedUnits.values()].find(
			(issued) => issued.build.emitterId === player.id,
		);
		expect(carrier?.mode).toBe("training");
		expect(carrier?.build.mainHand.definitionId).toBe(item.definitionId);
		expect(carrier?.build.enemyRole).toBe("invader");
	});
	test("resolves competitive units once and keeps Gold drops server-owned until collection", () => {
		const { game, messages } = harness();
		const one = game.join("One");
		const two = game.join("Two");
		enterPair(game, one, two);
		const unitId = one.issuedUnits.keys().next().value as string;
		game.handle(one.id, { type: "creepDefeated", unitId });
		expect(one.score).toBe(2);
		expect(one.progress.xp).toBe(10);
		expect(one.groundDrops.size).toBe(1);
		const drop = [...one.groundDrops.values()][0];
		expect(drop.kind).toBe("gold");
		const gold = one.progress.gold;
		game.handle(one.id, { type: "creepDefeated", unitId });
		expect(one.score).toBe(2);
		expect(
			messages.get(one.id)?.some((m) => m.type === "serverNotice"),
		).toBeTrue();
		game.handle(one.id, { type: "collectDrop", dropId: drop.id });
		expect(one.progress.gold).toBe(
			gold + (drop.kind === "gold" ? drop.amount : 0),
		);
		expect(one.groundDrops.size).toBe(0);
	});
	test("collects typed Scrap drops exactly once", () => {
		const { game } = harness();
		const player = game.join("Scrapper");
		player.groundDrops.set("scrap-drop", {
			id: "scrap-drop",
			kind: "scrap",
			rarity: "rare",
			amount: 3,
		});
		game.handle(player.id, { type: "collectDrop", dropId: "scrap-drop" });
		expect(player.progress.scraps.rare).toBe(3);
		game.handle(player.id, { type: "collectDrop", dropId: "scrap-drop" });
		expect(player.progress.scraps.rare).toBe(3);
	});
	test("promotes one or all complete lower-tier Scrap batches", () => {
		const { game } = harness();
		const player = game.join("Promoter");
		player.progress.scraps.common = 100;
		player.progress.scraps.uncommon = 2;
		game.handle(player.id, { type: "promoteScrap", target: "uncommon" });
		expect(player.progress.scraps).toEqual({
			common: 0,
			uncommon: 3,
			rare: 0,
			epic: 0,
		});
		player.progress.scraps.rare = 1002;
		player.progress.scraps.epic = 5;
		game.handle(player.id, {
			type: "promoteScrap",
			target: "epic",
			bulk: true,
		});
		expect(player.progress.scraps.rare).toBe(2);
		expect(player.progress.scraps.epic).toBe(15);
	});
	test("rejects Scrap promotion without a lower tier or a complete batch", () => {
		const { game, messages } = harness();
		const player = game.join("NoPromotion");
		const before = structuredClone(player.progress.scraps);
		game.handle(player.id, { type: "promoteScrap", target: "common" });
		expect(player.progress.scraps).toEqual(before);
		expect(messages.get(player.id)?.at(-1)?.type).toBe("serverNotice");
	});
	test("defers pushed equipment and returns it to the same player next wave", () => {
		const { game } = harness();
		const player = game.join("Boomerang");
		const item = generateItem(2, "rare", 92);
		player.groundDrops.set("outbound", { id: "outbound", kind: "item", item });
		game.handle(player.id, { type: "deferDrop", dropId: "outbound" });
		expect(player.groundDrops.has("outbound")).toBeFalse();
		expect(player.deferredItems).toHaveLength(1);
		game.dispatchWaves();
		expect(player.deferredItems).toHaveLength(0);
		expect(
			player.progress.inventoryTiles.some(
				(tile) => tile.key === itemStackKey(item),
			),
		).toBeTrue();
	});
	test("converts a successful equipment roll into a typed Scrap drop", () => {
		const random = new SequenceRandom();
		const { game } = harness(random);
		const one = game.join("One");
		const two = game.join("Two");
		enterPair(game, one, two);
		const [unitId, issued] = [...one.issuedUnits.entries()].find(
			([, value]) => !value.build.isRival,
		)!;
		random.set(0.3, 0, 0);
		game.handle(one.id, { type: "creepDefeated", unitId });
		const drop = [...one.groundDrops.values()][0];
		expect(drop.kind).toBe("scrap");
		if (drop.kind === "scrap") {
			expect(drop.rarity).toBe(issued.build.mainHand.rarity);
			expect(drop.amount).toBe(
				Math.max(1, Math.ceil(issued.build.mainHand.level / 3)),
			);
		}
	});
	test("sends equipment into a future carrier and retains attribution", () => {
		const { game } = harness();
		const sender = game.join("Sender");
		const target = game.join("Target");
		enterPair(game, sender, target);
		const item = generateItem(2, "rare", 77);
		sender.progress.inventoryTiles.push({
			id: "tile",
			key: itemStackKey(item),
			item,
			quantity: 2,
		});
		game.handle(sender.id, { type: "sendItem", tileId: "tile" });
		expect(target.incomingQueues.get(sender.id)).toHaveLength(1);
		game.dispatchWaves();
		const carrier = [...target.issuedUnits.values()].find(
			(issued) => issued.build.emitterId === sender.id,
		);
		expect(carrier?.build.mainHand.definitionId).toBe(item.definitionId);
		expect(
			sender.progress.inventoryTiles.find((tile) => tile.id === "tile")
				?.quantity,
		).toBe(1);
	});
	test("preserves a sent item's level and raises its carrier stats and rewards", () => {
		const { game } = harness();
		const player = game.join("Armorer");
		const item = {
			...generateItem(12, "rare", 701, { allowedClasses: ["axe"] }),
			requirements: { strength: 17, intelligence: 19 },
		};
		player.progress.inventoryTiles.push({
			id: "high-level-send",
			key: itemStackKey(item),
			item,
			quantity: 1,
		});
		game.handle(player.id, { type: "sendItem", tileId: "high-level-send" });
		game.dispatchWaves();
		const carrier = [...player.issuedUnits.values()].find(
			({ build }) => build.emitterId === player.id,
		)?.build;
		expect(carrier?.mainHand).toEqual({ ...item, id: `${item.id}-sent` });
		expect(carrier).toMatchObject({
			level: 12,
			stats: {
				agility: 12,
				strength: 17,
				magic: 12,
				spirit: 12,
				intelligence: 19,
			},
			xpReward: 22,
			goldReward: 3,
		});
	});
	test("rerolls a sent offhand carrier's two-handed weapon at the raised level", () => {
		const random = new SequenceRandom();
		const { game } = harness(random);
		const player = game.join("ShieldBearer");
		const item = {
			...generateBuckler(7, "rare", 702),
			requirements: { strength: 15 },
		};
		player.progress.inventoryTiles.push({
			id: "high-level-offhand",
			key: itemStackKey(item),
			item,
			quantity: 1,
		});
		game.handle(player.id, { type: "sendItem", tileId: "high-level-offhand" });
		player.waveNumber = 9;
		random.set(19.5 / 0x7fffffff, 0.5, 0, 0);
		game.handle(player.id, { type: "requestWave" });
		const carrier = [...player.issuedUnits.values()].find(
			({ build }) => build.emitterId === player.id,
		)?.build;
		expect(carrier?.offHand).toEqual({ ...item, id: `${item.id}-sent` });
		expect(carrier?.mainHand?.hands).toBe(1);
		expect(carrier?.mainHand?.level).toBe(7);
		expect(carrier?.level).toBe(7);
		expect(carrier?.stats.strength).toBeGreaterThanOrEqual(15);
		expect(carrier?.xpReward).toBe(17);
		expect(carrier?.goldReward).toBe(2);
	});
	test("does not raise intro carriers for sent items that remain carried", () => {
		const { game } = harness();
		const player = game.join("IntroCarrier");
		const item = generateItem(20, "epic", 703, { allowedClasses: ["staff"] });
		player.progress.inventoryTiles.push({
			id: "intro-carried",
			key: itemStackKey(item),
			item,
			quantity: 1,
		});
		game.handle(player.id, { type: "sendItem", tileId: "intro-carried" });
		game.dispatchWaves();
		const carrier = [...player.issuedUnits.values()].find(
			({ build }) => build.emitterId === player.id,
		)?.build;
		expect(carrier?.carried).toContainEqual({ ...item, id: `${item.id}-sent` });
		expect(carrier).toMatchObject({ level: 0, xpReward: 10, goldReward: 1 });
		expect(carrier?.mainHand?.id).not.toContain("-sent");
	});
	test("shift bulk sends every available copy", () => {
		const { game } = harness();
		const sender = game.join("Sender");
		const target = game.join("Target");
		enterPair(game, sender, target);
		const item = generateItem(2, "rare", 79);
		sender.progress.inventoryTiles.push({
			id: "bulk-tile",
			key: itemStackKey(item),
			item,
			quantity: 3,
		});
		game.handle(sender.id, {
			type: "sendItem",
			tileId: "bulk-tile",
			bulk: true,
		});
		expect(target.incomingQueues.get(sender.id)).toHaveLength(3);
		expect(
			sender.progress.inventoryTiles.some((tile) => tile.id === "bulk-tile"),
		).toBeFalse();
	});
	test("maps each sent item rarity to its configured XP multiplier", () => {
		const { game } = harness();
		const player = game.join("Multiplier");
		const expected = { common: 1.2, uncommon: 1.5, rare: 2, epic: 3 } as const;
		for (const [rarity, multiplier] of Object.entries(expected) as [
			keyof typeof expected,
			number,
		][]) {
			const item = generateItem(1, rarity, 90 + Math.round(multiplier * 10));
			const tileId = `multiplier-${rarity}`;
			player.progress.inventoryTiles.push({
				id: tileId,
				key: itemStackKey(item),
				item,
				quantity: 1,
			});
			game.handle(player.id, { type: "sendItem", tileId });
			expect(player.xpSendBuffs.at(-1)?.multiplier).toBe(multiplier);
		}
	});
	test("queues sent XP buffs and advances to the next rarity multiplier after expiry", () => {
		let now = 1_000;
		const { game } = harness(new FixedRandom(0), () => now);
		const sender = game.join("Sender");
		const target = game.join("Target");
		enterPair(game, sender, target);
		const rare = generateItem(2, "rare", 80);
		const epic = generateItem(1, "epic", 81);
		sender.progress.inventoryTiles.push(
			{ id: "rare-xp-buff", key: itemStackKey(rare), item: rare, quantity: 1 },
			{ id: "epic-xp-buff", key: itemStackKey(epic), item: epic, quantity: 1 },
		);
		game.handle(sender.id, { type: "sendItem", tileId: "rare-xp-buff" });
		game.handle(sender.id, { type: "sendItem", tileId: "epic-xp-buff" });
		expect(sender.xpSendBuffs).toEqual([
			{ multiplier: 2, expiresAt: 21_000 },
			{ multiplier: 3, expiresAt: 31_000 },
		]);
		const firstUnit = sender.issuedUnits.keys().next().value as string;
		game.handle(sender.id, { type: "creepDefeated", unitId: firstUnit });
		expect(sender.progress.xp).toBe(20);
		now = 21_000;
		const secondUnit = [...sender.issuedUnits.keys()][0]!;
		game.handle(sender.id, { type: "creepDefeated", unitId: secondUnit });
		expect(sender.progress.xp).toBe(50);
		expect(sender.xpSendBuffs).toEqual([{ multiplier: 3, expiresAt: 31_000 }]);
		now = 31_000;
		const thirdUnit = [...sender.issuedUnits.keys()][0]!;
		game.handle(sender.id, { type: "creepDefeated", unitId: thirdUnit });
		expect(sender.progress.xp).toBe(60);
		expect(sender.xpSendBuffs).toEqual([]);
	});
	test("shift bulk sell returns ten times base value and purge multiplies rewards across the stack", () => {
		const { game } = harness();
		const player = game.join("Merchant");
		const sold = generateItem(2, "rare", 83);
		player.progress.inventoryTiles.push({
			id: "sell-stack",
			key: itemStackKey(sold),
			item: sold,
			quantity: 3,
		});
		const gold = player.progress.gold;
		game.handle(player.id, {
			type: "sellItem",
			tileId: "sell-stack",
			bulk: true,
		});
		expect(player.progress.gold).toBe(gold + 3 * sold.sellValue * 10);
		expect(
			player.progress.inventoryTiles.some((tile) => tile.id === "sell-stack"),
		).toBeFalse();
		const purged = generateItem(4, "uncommon", 85);
		player.progress.inventoryTiles.push({
			id: "purge-stack",
			key: itemStackKey(purged),
			item: purged,
			quantity: 3,
		});
		const scraps = player.progress.scraps.uncommon;
		game.handle(player.id, {
			type: "purgeItem",
			tileId: "purge-stack",
			bulk: true,
		});
		expect(player.progress.scraps.uncommon).toBe(
			scraps + 3 * Math.max(1, Math.ceil(purged.level / 3)),
		);
		expect(
			player.progress.inventoryTiles.some((tile) => tile.id === "purge-stack"),
		).toBeFalse();
	});
	test("single sales return ten times base value in the lobby and a competitive realm", () => {
		const { game } = harness();
		const seller = game.join("LobbySeller");
		const opponent = game.join("RealmOpponent");
		const lobbyItem = generateItem(2, "rare", 84);
		seller.progress.inventoryTiles.push({
			id: "lobby-sale",
			key: itemStackKey(lobbyItem),
			item: lobbyItem,
			quantity: 1,
		});
		game.handle(seller.id, { type: "sellItem", tileId: "lobby-sale" });
		expect(seller.realmId).toBeUndefined();
		expect(seller.progress.gold).toBe(lobbyItem.sellValue * 10);
		enterPair(game, seller, opponent);
		const realmItem = generateItem(2, "rare", 86);
		seller.progress.inventoryTiles.push({
			id: "realm-sale",
			key: itemStackKey(realmItem),
			item: realmItem,
			quantity: 1,
		});
		game.handle(seller.id, { type: "sellItem", tileId: "realm-sale" });
		expect(seller.realmId).toBeDefined();
		expect(seller.progress.gold).toBe(
			(lobbyItem.sellValue + realmItem.sellValue) * 10,
		);
	});
	test("shift bulk upgrades the clicked stack while resources permit", () => {
		const { game } = harness();
		const player = game.join("Smith");
		const item = generateItem(1, "common", 81);
		player.progress.inventoryTiles.push({
			id: "upgrade-tile",
			key: itemStackKey(item),
			item,
			quantity: 3,
		});
		player.progress.gold = 10_000;
		player.progress.scraps.common = 100;
		game.handle(player.id, {
			type: "upgradeItem",
			tileId: "upgrade-tile",
			bulk: true,
		});
		const upgraded = player.progress.inventoryTiles.find(
			(tile) => tile.item.level === 2,
		);
		expect(upgraded?.quantity).toBe(3);
		expect(
			player.progress.inventoryTiles.some((tile) => tile.id === "upgrade-tile"),
		).toBeFalse();
		expect(player.progress.scraps.common).toBe(
			100 - 3 * upgradeCosts(item).scraps,
		);
	});
	test("charges level times 100 to reapply a stat ratio retroactively", () => {
		const { game, messages } = harness();
		const player = game.join("Planner");
		player.progress.level = 4;
		player.progress.gold = 500;
		player.progress.stats = {
			agility: 9,
			strength: 8,
			magic: 7,
			spirit: 6,
			intelligence: 5,
		};
		const allocation = {
			agility: 2,
			strength: 1,
			magic: 1,
			spirit: 1,
			intelligence: 0,
		};
		game.handle(player.id, { type: "respecStats", allocation });
		expect(player.progress.gold).toBe(100);
		expect(player.progress.allocation).toEqual(allocation);
		expect(player.progress.stats).toEqual({
			agility: 8,
			strength: 4,
			magic: 4,
			spirit: 4,
			intelligence: 0,
		});
		const before = structuredClone(player.progress);
		game.handle(player.id, { type: "respecStats", allocation });
		expect(player.progress).toEqual(before);
		expect(messages.get(player.id)?.at(-1)?.type).toBe("serverNotice");
	});
	test("credits a sent-carrier realm defeat without player-level XP", () => {
		const { game } = harness();
		const killer = game.join("Killer");
		const victim = game.join("Victim");
		enterPair(game, killer, victim);
		const oldRealm = victim.realmId;
		killer.progress.level = 5;
		killer.progress.xp = cumulativeXpForLevel(5);
		victim.progress.level = 5;
		const item = generateItem(2, "rare", 88);
		killer.progress.inventoryTiles.push({
			id: "tile",
			key: itemStackKey(item),
			item,
			quantity: 1,
		});
		game.handle(killer.id, { type: "sendItem", tileId: "tile" });
		game.dispatchWaves();
		const source = [...victim.issuedUnits.values()].find(
			(issued) => issued.build.emitterId === killer.id,
		)!.build.id;
		game.handle(victim.id, { type: "heroDefeated", sourceUnitId: source });
		expect(killer.progress.xp).toBe(cumulativeXpForLevel(5));
		expect(killer.progress.level).toBe(5);
		expect(killer.progress.souls).toBe(1);
		expect(victim.realmId).not.toBe(oldRealm);
	});
	test("suicide resets the hero, preserves equipment, and queues its exact death echo until wave nine", () => {
		const { game, messages } = harness();
		const sovereign = game.join("Sovereign");
		const victim = game.join("Victim");
		sovereign.progress.level = 8;
		victim.progress.level = 5;
		victim.progress.xp = cumulativeXpForLevel(5);
		victim.progress.stats = {
			agility: 7,
			strength: 6,
			magic: 5,
			spirit: 4,
			intelligence: 3,
		};
		victim.progress.gold = 11;
		const weapon = generateItem(4, "rare", 123);
		victim.progress.mainHand = weapon;
		game.handle(victim.id, { type: "suicide" });
		expect(victim.progress.level).toBe(0);
		expect(victim.progress.gold).toBe(6);
		expect(victim.progress.mainHand).toEqual(weapon);
		expect(sovereign.deathEchoes).toHaveLength(1);
		expect(sovereign.deathEchoes[0]).toMatchObject({
			name: "Victim's death echo",
			enemyRole: "clone",
			level: 5,
			stats: { agility: 7, strength: 6, magic: 5, spirit: 4, intelligence: 3 },
		});
		expect(sovereign.deathEchoes[0].mainHand).toEqual(weapon);
		expect(messages.get(victim.id)?.at(-1)?.type).toBe("suicideResolved");
		game.dispatchWaves();
		expect(sovereign.deathEchoes).toHaveLength(1);
		sovereign.waveNumber = 9;
		game.handle(sovereign.id, { type: "requestWave" });
		expect(sovereign.deathEchoes).toHaveLength(0);
		expect(
			[...sovereign.issuedUnits.values()].some(
				({ build }) => build.name === "Victim's death echo",
			),
		).toBeTrue();
	});
	test("marks leaderboard presence and only the first hero as the death-echo recipient", () => {
		const { game } = harness();
		const beta = game.join("beta");
		const alpha = game.join("alpha");
		beta.progress.level = 3;
		alpha.progress.level = 3;
		game.disconnect(beta.id);
		expect(
			game
				.leaderboard()
				.map(({ username, connected, receivesDeathEchoes }) => [
					username,
					connected,
					receivesDeathEchoes,
				]),
		).toEqual([
			["alpha", true, true],
			["beta", false, false],
		]);
	});
	test("training kills grant nothing", () => {
		const { game } = harness();
		const player = game.join("Trainee");
		const unitId = player.issuedUnits.keys().next().value as string;
		game.handle(player.id, { type: "creepDefeated", unitId });
		expect(player.score).toBe(0);
		expect(player.progress.xp).toBe(0);
		expect(player.progress.scraps).toEqual(emptyScraps());
	});
	test("keeps waves one through eight melee-only and begins bonus spells at wave nine", () => {
		const { game } = harness(new FixedRandom(0));
		const player = game.join("Skilled");
		player.waveNumber = 8;
		game.handle(player.id, { type: "requestWave" });
		expect(
			[...player.issuedUnits.values()].every(
				({ build }) =>
					build.kind !== "bubbleShooter" &&
					build.mainHand.definitionId !== "throwingAxe" &&
					!build.offHand &&
					!build.bonusSkills?.length,
			),
		).toBeTrue();
		player.waveNumber = 9;
		game.handle(player.id, { type: "requestWave" });
		const regulars = [...player.issuedUnits.values()].filter(
			({ build }) => !build.isRival,
		);
		expect(
			regulars.filter(({ build }) => build.bonusSkills?.includes("fireBreath")),
		).toHaveLength(2);
	});
});
