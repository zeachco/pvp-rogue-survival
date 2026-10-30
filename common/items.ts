import {
	buildWeapon,
	generateAccessory,
	generateBuckler,
	generateItem,
	generateRelic,
} from "./itemGeneration";
import { STAT_KEYS, type StatKey, type Stats } from "./progression";
import { SeededRandom } from "./random";

export {
	generateAccessory,
	generateBuckler,
	generateItem,
	generateRelic,
	starterClub,
} from "./itemGeneration";

export type WeaponClass =
	| "club"
	| "sword"
	| "dagger"
	| "mace"
	| "axe"
	| "throwingAxe"
	| "hammer"
	| "staff"
	| "largeMace"
	| "longsword"
	| "katars"
	| "scepter";
export type EquipmentDefinitionId =
	| WeaponClass
	| "buckler"
	| "relic"
	| "amulet"
	| "charm";
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "unique";
export type SkillId =
	| "bash"
	| "sweep"
	| "flurry"
	| "shockwave"
	| "cleave"
	| "whirlwind"
	| "rendingThrow"
	| "vampiricBoomerang"
	| "orbitingHammers"
	| "arcaneBolt"
	| "gravityPull"
	| "attraction"
	| "manaDrain"
	| "manaShield"
	| "penance"
	| "thorns"
	| "reflectiveSurge"
	| "frostOrb"
	| "blizzard"
	| "fireBreath"
	| "swamp"
	| "rapidRegen"
	| "voodoo"
	| "healing"
	| "rent"
	| "blocking"
	| "slowAura"
	| "hinderingAura"
	| "deathBurst"
	| "sunburnAura"
	| "thunderAura"
	| "timeHarvest";
export type AffixId =
	| "rusty"
	| "venomous"
	| "bleeding"
	| "stunning"
	| "focused"
	| "swift";
export type ReflectionComponent = "flat" | "strength" | "return";
export type ItemPerkId =
	| "defense"
	| "bonusXp"
	| "physicalResist"
	| "magicResist"
	| "fireResist"
	| "frostResist"
	| "poisonResist"
	| "bleedResist"
	| "dodgeChance";
export type ItemImmunity =
	| "physical"
	| "magic"
	| "fire"
	| "frost"
	| "poison"
	| "bleed";
export const ITEM_PERKS: ItemPerkId[] = [
	"defense",
	"bonusXp",
	"physicalResist",
	"magicResist",
	"fireResist",
	"frostResist",
	"poisonResist",
	"bleedResist",
	"dodgeChance",
];
export const RARITIES: Rarity[] = [
	"common",
	"uncommon",
	"rare",
	"epic",
	"unique",
];
export const PROMOTION_ORDER: Rarity[] = ["common", "uncommon", "rare", "epic"];
export const AURA_SKILLS: SkillId[] = [
	"slowAura",
	"hinderingAura",
	"deathBurst",
	"sunburnAura",
	"thunderAura",
];
export const TWO_HANDED_SKILL_COUNTS: Record<
	Rarity,
	readonly [number, number]
> = {
	common: [1, 2],
	uncommon: [2, 3],
	rare: [3, 4],
	epic: [5, 5],
	unique: [5, 5],
};
export const STAFF_SKILL_POOL: readonly SkillId[] = [
	"arcaneBolt",
	"frostOrb",
	"blizzard",
	"fireBreath",
	"gravityPull",
	"healing",
	"swamp",
	"rapidRegen",
];
export const GENERIC_TWO_HANDED_SKILL_POOL: readonly SkillId[] = [
	"bash",
	"sweep",
	"flurry",
	"shockwave",
	"cleave",
	"whirlwind",
	"rendingThrow",
	"orbitingHammers",
];
interface RelicVariant {
	name: string;
	maxRoll: number;
	skills: readonly SkillId[];
}
const RELIC_VARIANTS = [
	{ name: "Voodoo Doll", maxRoll: 0.2, skills: ["voodoo", "swamp"] },
	{ name: "Ember Idol", maxRoll: 0.4, skills: ["fireBreath"] },
	{ name: "Spirit Wounds Idol", maxRoll: 0.55, skills: ["manaDrain"] },
	{ name: "Penance Idol", maxRoll: 0.7, skills: ["penance"] },
	{ name: "Renewal Idol", maxRoll: 0.85, skills: ["rapidRegen"] },
	{ name: "Spirit Relic", maxRoll: 1, skills: ["manaShield"] },
] as const satisfies readonly RelicVariant[];

export function relicVariantForRoll(roll: number): RelicVariant {
	return (
		RELIC_VARIANTS.find((variant) => roll < variant.maxRoll) ??
		RELIC_VARIANTS[RELIC_VARIANTS.length - 1]
	);
}

export function auraSkillForSeed(seed: number, divisor = 1): SkillId {
	return AURA_SKILLS[Math.abs(Math.floor(seed / divisor)) % AURA_SKILLS.length];
}
export const RARITY_POWER: Record<Rarity, number> = {
	common: 1,
	uncommon: 1.25,
	rare: 1.6,
	epic: 2.1,
	unique: 4,
};
export const RARITY_COLORS: Record<Rarity, string> = {
	common: "#d8e5e8",
	uncommon: "#62e88a",
	rare: "#6ca8ff",
	epic: "#ca75ff",
	unique: "#e3b52c",
};
export const MAX_ITEM_LEVEL: Record<Rarity, number> = {
	common: 10,
	uncommon: 15,
	rare: 30,
	epic: 50,
	unique: 100,
};
export const MAX_ITEM_REQUIREMENT = 100;
export const nextRarity = (rarity: Rarity): Rarity | undefined => {
	const index = PROMOTION_ORDER.indexOf(rarity);
	return index < 0 || index >= PROMOTION_ORDER.length - 1
		? undefined
		: PROMOTION_ORDER[index + 1];
};
export function equippedSkillLevelContribution(
	equipment: Array<ItemInstance | undefined>,
	skill: SkillId,
): number {
	const contributors = equipment.filter((item) => item?.skills.includes(skill));
	if (!contributors.length) return 0;
	return contributors.some((item) => item?.rarity === "unique") ? 3 : 1;
}
export const weaponLevelScale = (level: number): number =>
	1 + Math.max(0, level) * 0.025;
export const weaponSkillLevelScale = (level: number): number =>
	1 + Math.max(0, level) * 0.005;
export const bucklerLevelBlockChance = (level: number): number =>
	Math.ceil(Math.max(0, level) * 0.75) / 100;
export const bucklerBlockChanceValue = (
	level: number,
	rarity: Rarity,
): number => 0.1 * RARITY_POWER[rarity] + bucklerLevelBlockChance(level);

export interface ItemModifiers {
	damageMultiplier: number;
	attackSpeedMultiplier: number;
	critChance: number;
	manaRegenMultiplier: number;
	magicAmp: number;
	bleedChance: number;
	poisonChance: number;
	stunChance: number;
	lifeStealBase: number;
	strengthRegenMultiplier: number;
	goldGain: number;
	magicFind: number;
}
export type PhysicalBonusKind =
	| "frost"
	| "poison"
	| "bleed"
	| "fire"
	| "lightning";
export interface AccessoryBonuses {
	manaSkillLevels?: number;
	rageSkillLevels?: number;
	allSkillLevels?: number;
	globalCooldownReduction?: number;
	manaCostReduction?: number;
	lifeCostReduction?: number;
	healthOnKill?: number;
	manaOnKill?: number;
	physicalDamage?: Partial<Record<PhysicalBonusKind, number>>;
}
export interface ItemInstance {
	id: string;
	itemKind: "weapon" | "buckler" | "relic" | "amulet" | "charm";
	definitionId: EquipmentDefinitionId;
	name: string;
	level: number;
	rarity: Rarity;
	seed: number;
	hands: 0 | 1 | 2;
	affixes: AffixId[];
	requirements: Partial<Record<StatKey, number>>;
	weight: number;
	statBonuses: Partial<Record<StatKey, number>>;
	modifiers: ItemModifiers;
	skills: SkillId[];
	rageCost: number;
	dropChance: number;
	sellValue: number;
	blockChance: number;
	reflectionComponents: ReflectionComponent[];
	attractionSpeed: number;
	perks?: Partial<Record<ItemPerkId, number>>;
	immunities?: ItemImmunity[];
	accessoryBonuses?: AccessoryBonuses;
	pendingRerollSeed?: number;
}
export interface ItemGenerationFilters {
	allowedClasses?: WeaponClass[];
	fewerAffixes?: boolean;
}

type LegacyItemInstance = ItemInstance & {
	staminaCost?: number;
	modifiers: ItemModifiers & { rarityBoost?: number };
	accessoryBonuses?: AccessoryBonuses & { staminaSkillLevels?: number };
};

export function migrateLegacyItem(item: ItemInstance): ItemInstance {
	const legacy = item as LegacyItemInstance;
	const legacyRequirements = item.requirements as typeof item.requirements & {
		magic?: number;
	};
	const legacyBonuses = item.statBonuses as typeof item.statBonuses & {
		magic?: number;
	};
	if (Number.isFinite(legacyRequirements.magic))
		item.requirements.intelligence = Math.max(
			item.requirements.intelligence ?? 0,
			legacyRequirements.magic!,
		);
	if (Number.isFinite(legacyBonuses.magic))
		item.statBonuses.intelligence =
			(item.statBonuses.intelligence ?? 0) + legacyBonuses.magic!;
	delete legacyRequirements.magic;
	delete legacyBonuses.magic;
	if (!Number.isFinite(item.modifiers.magicFind))
		item.modifiers.magicFind = Number.isFinite(legacy.modifiers.rarityBoost)
			? legacy.modifiers.rarityBoost!
			: 0;
	delete legacy.modifiers.rarityBoost;
	if (!Number.isFinite(item.rageCost)) {
		const legacyCost = legacy.staminaCost;
		item.rageCost =
			typeof legacyCost === "number" && Number.isFinite(legacyCost)
				? legacyCost
				: 0;
	}
	if (item.accessoryBonuses) {
		const bonuses = item.accessoryBonuses as NonNullable<
			LegacyItemInstance["accessoryBonuses"]
		>;
		if (
			!Number.isFinite(bonuses.rageSkillLevels) &&
			Number.isFinite(bonuses.staminaSkillLevels)
		)
			bonuses.rageSkillLevels = bonuses.staminaSkillLevels;
		delete bonuses.staminaSkillLevels;
	}
	if (item.itemKind === "buckler")
		item.blockChance = bucklerBlockChanceValue(item.level, item.rarity);
	delete legacy.staminaCost;
	return item;
}

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

export function rollRarity(seed: number): Rarity {
	const roll = new SeededRandom(seed).next();
	return roll < 0.58
		? "common"
		: roll < 0.83
			? "uncommon"
			: roll < 0.96
				? "rare"
				: "epic";
}
export function meetsRequirements(item: ItemInstance, stats: Stats): boolean {
	return Object.entries(item.requirements).every(
		([key, value]) => stats[key as StatKey] >= (value ?? 0),
	);
}
export function itemRequirementMultiplier(
	item: ItemInstance | undefined,
	stats: Stats,
): number {
	if (!item) return 1;
	return Math.max(
		0.1,
		Object.entries(item.requirements).reduce((multiplier, [key, required]) => {
			const delta = Math.max(0, (required ?? 0) - stats[key as StatKey]);
			return multiplier / (1 + 0.1 * delta);
		}, 1),
	);
}
export function itemStackKey(item: ItemInstance | undefined): string {
	if (!item) return "unarmed";
	return JSON.stringify({
		itemKind: item.itemKind,
		definitionId: item.definitionId,
		level: item.level,
		rarity: item.rarity,
		hands: item.hands,
		weight: item.weight,
		affixes: [...item.affixes].sort(),
		requirements: orderedStats(item.requirements),
		statBonuses: orderedStats(item.statBonuses),
		modifiers: item.modifiers,
		skills: [...item.skills].sort(),
		rageCost: item.rageCost,
		blockChance: item.blockChance,
		reflectionComponents: [...item.reflectionComponents].sort(),
		attractionSpeed: item.attractionSpeed,
		perks: item.perks ?? {},
		immunities: [...(item.immunities ?? [])].sort(),
		accessoryBonuses: item.accessoryBonuses ?? {},
	});
}
export function equippedPerks(
	stats: Stats,
	...items: Array<ItemInstance | undefined>
): Record<ItemPerkId, number> {
	return Object.fromEntries(
		ITEM_PERKS.map((key) => [
			key,
			items.reduce(
				(sum, item) =>
					sum +
					(item?.perks?.[key] ?? 0) *
						(item ? itemRequirementMultiplier(item, stats) : 1),
				0,
			),
		]),
	) as Record<ItemPerkId, number>;
}

export function equippedBonusXp(
	stats: Stats,
	...items: Array<ItemInstance | undefined>
): number {
	return items.reduce(
		(sum, item) =>
			sum +
			(item?.perks?.bonusXp ?? 0) *
				(item ? itemRequirementMultiplier(item, stats) : 1),
		0,
	);
}
export function equippedImmunities(
	stats: Stats,
	...items: Array<ItemInstance | undefined>
): Set<ItemImmunity> {
	return new Set(
		items.flatMap((item) =>
			item && itemRequirementMultiplier(item, stats) === 1
				? (item.immunities ?? [])
				: [],
		),
	);
}
export function itemSkillLevelBonus(
	item: ItemInstance | undefined,
	resource: "mana" | "rage" | "life",
): number {
	if (!item) return 0;
	const bonus = item.accessoryBonuses;
	return (
		(bonus?.allSkillLevels ?? 0) +
		(resource === "mana"
			? (bonus?.manaSkillLevels ?? 0)
			: resource === "rage"
				? (bonus?.rageSkillLevels ?? 0)
				: 0)
	);
}
export function itemCooldownReduction(
	...items: Array<ItemInstance | undefined>
): number {
	return Math.min(
		0.8,
		items.reduce(
			(sum, item) =>
				sum + (item?.accessoryBonuses?.globalCooldownReduction ?? 0),
			0,
		),
	);
}
export function itemPhysicalBonusFraction(
	item: ItemInstance | undefined,
): number {
	return Object.values(item?.accessoryBonuses?.physicalDamage ?? {}).reduce(
		(sum, value) => sum + (value ?? 0),
		0,
	);
}
export function itemResourceCostReduction(
	item: ItemInstance | undefined,
	resource: "mana" | "life",
	stats?: Stats,
): number {
	if (!item) return 0;
	const value =
		resource === "mana"
			? item.accessoryBonuses?.manaCostReduction
			: item.accessoryBonuses?.lifeCostReduction;
	return Math.min(
		0.9,
		(value ?? 0) * (stats ? itemRequirementMultiplier(item, stats) : 1),
	);
}
export function itemKillRestoration(
	stats: Stats,
	...items: Array<ItemInstance | undefined>
): { health: number; mana: number } {
	return items.reduce(
		(total, item) => {
			const effectiveness = item ? itemRequirementMultiplier(item, stats) : 1;
			total.health +=
				(item?.accessoryBonuses?.healthOnKill ?? 0) * effectiveness;
			total.mana += (item?.accessoryBonuses?.manaOnKill ?? 0) * effectiveness;
			return total;
		},
		{ health: 0, mana: 0 },
	);
}
export function statsWithItemBonuses(
	stats: Stats,
	...items: Array<ItemInstance | undefined>
): Stats {
	return Object.fromEntries(
		STAT_KEYS.map((key) => [
			key,
			(stats[key] ?? 0) +
				items.reduce(
					(sum, item) =>
						sum +
						(item?.statBonuses[key] ?? 0) *
							(item?.hands === 2 ? 2 : 1) *
							(item ? itemRequirementMultiplier(item, stats) : 1),
					0,
				),
		]),
	) as Stats;
}
function orderedStats(
	stats: Partial<Record<StatKey, number>>,
): Partial<Record<StatKey, number>> {
	return Object.fromEntries(
		STAT_KEYS.map((key) => [key, stats[key] ?? 0]),
	) as Partial<Record<StatKey, number>>;
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
export function ensureUpgradableAttribute(
	item: ItemInstance,
	seed: number,
): ItemInstance {
	if (STAT_KEYS.some((key) => (item.statBonuses[key] ?? 0) > 0)) return item;
	const thematic = STAT_KEYS.filter((key) => (item.requirements[key] ?? 0) > 0);
	const pool = thematic.length ? thematic : STAT_KEYS;
	const key = pool[Math.abs(Math.floor(seed)) % pool.length];
	return { ...item, statBonuses: { ...item.statBonuses, [key]: 1 } };
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
