import {
	buildWeapon,
	generateAccessory,
	generateBuckler,
	generateItem,
	generateRelic,
} from "./itemGeneration";
import type { ItemInstance, Rarity, WeaponClass } from "./items";
import {
	bucklerBlockChanceValue,
	ensureUpgradableAttribute,
	MAX_ITEM_LEVEL,
	MAX_ITEM_REQUIREMENT,
	nextRarity,
	RARITY_POWER,
	weaponLevelScale,
} from "./items";
import { STAT_KEYS, type StatKey } from "./progression";

export function levelUpItem(base: ItemInstance, seed: number): ItemInstance {
	const promotedRarity =
		base.level >= MAX_ITEM_LEVEL[base.rarity]
			? nextRarity(base.rarity)
			: undefined;
	const rarity = promotedRarity ?? base.rarity;
	const nextLevel = promotedRarity
		? 1
		: Math.min(base.level + 1, MAX_ITEM_LEVEL[rarity]);
	if (base.itemKind === "buckler") {
		const next = generateBuckler(nextLevel, rarity, seed);
		return preserveRolledTraits(base, {
			...next,
			name: base.name,
			blockChance: bucklerBlockChanceValue(nextLevel, rarity),
			sellValue: Math.max(
				1,
				Math.round(
					(nextLevel + 1) *
						RARITY_POWER[rarity] *
						(base.reflectionComponents.length ? 5 : 4),
				),
			),
		});
	}
	if (base.definitionId === "scepter")
		return preserveRolledTraits(
			base,
			buildWeapon("scepter", nextLevel, rarity, seed, [], seed % 1e8),
		);
	if (base.itemKind === "relic") {
		const next = generateRelic(nextLevel, rarity, seed);
		const scaleRatio =
			weaponLevelScale(nextLevel) / weaponLevelScale(base.level);
		next.modifiers.lifeStealBase =
			(base.modifiers.lifeStealBase ?? 0) * scaleRatio;
		next.modifiers.strengthRegenMultiplier =
			(base.modifiers.strengthRegenMultiplier ?? 0) * scaleRatio;
		return preserveRolledTraits(base, { ...next, name: base.name });
	}
	if (base.itemKind === "amulet" || base.itemKind === "charm")
		return preserveRolledTraits(base, {
			...generateAccessory(nextLevel, rarity, seed, base.itemKind),
			name: base.name,
		});
	const next = buildWeapon(
		base.definitionId as WeaponClass,
		nextLevel,
		rarity,
		seed,
		[...base.affixes],
		seed % 1e8,
	);
	const scaleRatio =
		weaponLevelScale(next.level) / weaponLevelScale(base.level);
	next.modifiers.lifeStealBase =
		(base.modifiers.lifeStealBase ?? 0) * scaleRatio;
	next.modifiers.strengthRegenMultiplier =
		(base.modifiers.strengthRegenMultiplier ?? 0) * scaleRatio;
	return preserveRolledTraits(base, next);
}

export function rerollPendingSeed(seed: number): number {
	let derived = ((Math.imul(seed | 0, 0x27d4eb2d) >>> 0) % 0x7fffffff) + 1;
	if (derived === (seed | 0)) derived += 1;
	return derived;
}

export function itemPendingRerollSeed(item: ItemInstance): number {
	return item.pendingRerollSeed ?? rerollPendingSeed(item.seed);
}

export function rerollItem(item: ItemInstance, seed: number): ItemInstance {
	if (item.definitionId === "scepter")
		return buildWeapon(
			"scepter",
			item.level,
			item.rarity,
			seed,
			[],
			seed % 1e8,
		);
	if (item.itemKind === "buckler")
		return generateBuckler(item.level, item.rarity, seed);
	if (item.itemKind === "relic")
		return generateRelic(item.level, item.rarity, seed);
	if (item.itemKind === "amulet" || item.itemKind === "charm")
		return generateAccessory(item.level, item.rarity, seed, item.itemKind);
	return generateItem(item.level, item.rarity, seed, {
		allowedClasses: [item.definitionId as WeaponClass],
	});
}

export function changeItemRarity(
	base: ItemInstance,
	rarity: Rarity,
	seed: number,
): ItemInstance {
	const level = Math.min(base.level, MAX_ITEM_LEVEL[rarity]);
	if (base.definitionId === "scepter")
		return buildWeapon("scepter", level, rarity, seed, [], seed % 1e8);
	if (base.itemKind === "buckler") {
		const next = generateBuckler(level, rarity, seed);
		return {
			...next,
			name: base.name,
			skills: [...base.skills],
			reflectionComponents: [...base.reflectionComponents],
		};
	}
	if (base.itemKind === "relic") {
		const next = generateRelic(level, rarity, seed);
		next.modifiers.lifeStealBase = base.modifiers.lifeStealBase;
		next.modifiers.strengthRegenMultiplier =
			base.modifiers.strengthRegenMultiplier;
		return {
			...next,
			name: base.name,
			skills: [...base.skills],
			attractionSpeed: base.attractionSpeed,
		};
	}
	if (base.itemKind === "amulet" || base.itemKind === "charm")
		return {
			...generateAccessory(level, rarity, seed, base.itemKind),
			name: base.name,
		};
	const next = buildWeapon(
		base.definitionId as WeaponClass,
		level,
		rarity,
		seed,
		[...base.affixes],
		seed % 1e8,
	);
	next.modifiers.lifeStealBase = base.modifiers.lifeStealBase;
	next.modifiers.strengthRegenMultiplier =
		base.modifiers.strengthRegenMultiplier;
	return next;
}

function preserveRolledTraits(
	base: ItemInstance,
	next: ItemInstance,
): ItemInstance {
	const levelRatio = (next.level + 1) / Math.max(1, base.level + 1);
	const requirements = Object.fromEntries(
		Object.entries(base.requirements).map(([key, value]) => [
			key,
			Math.min(
				MAX_ITEM_REQUIREMENT,
				Math.max(value ?? 0, Math.ceil((value ?? 0) * levelRatio)),
			),
		]),
	) as Partial<Record<StatKey, number>>;
	return {
		...next,
		name: base.name,
		affixes: [...base.affixes],
		requirements,
		statBonuses: upgradedStatBonuses(base, next.seed),
		skills: [...base.skills],
		reflectionComponents: [...base.reflectionComponents],
		attractionSpeed: base.attractionSpeed,
		perks: { ...base.perks },
		immunities: [...(base.immunities ?? [])],
		accessoryBonuses: base.accessoryBonuses
			? structuredClone(base.accessoryBonuses)
			: undefined,
	};
}

function upgradedStatBonuses(
	item: ItemInstance,
	seed: number,
): Partial<Record<StatKey, number>> {
	if (!STAT_KEYS.some((key) => (item.statBonuses[key] ?? 0) > 0))
		return ensureUpgradableAttribute(item, seed).statBonuses;
	const ensured = ensureUpgradableAttribute(item, seed).statBonuses;
	const keys = STAT_KEYS.filter((key) => (ensured[key] ?? 0) > 0);
	const key = keys[Math.abs(Math.floor(seed)) % keys.length];
	return { ...ensured, [key]: (ensured[key] ?? 0) + 1 };
}
