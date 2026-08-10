import { STAT_KEYS, type StatKey, type Stats } from "./progression";
import { AFFIXES, WEAPONS } from "./content";
import { SeededRandom } from "./random";

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
const TWO_HANDED_SKILL_COUNTS: Record<Rarity, readonly [number, number]> = {
	common: [1, 2],
	uncommon: [2, 3],
	rare: [3, 4],
	epic: [5, 5],
	unique: [5, 5],
};
const STAFF_SKILL_POOL: readonly SkillId[] = [
	"arcaneBolt",
	"frostOrb",
	"blizzard",
	"fireBreath",
	"gravityPull",
	"healing",
	"swamp",
	"rapidRegen",
];
const GENERIC_TWO_HANDED_SKILL_POOL: readonly SkillId[] = [
	"bash",
	"sweep",
	"flurry",
	"shockwave",
	"cleave",
	"whirlwind",
	"rendingThrow",
	"orbitingHammers",
];
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
	delete legacy.staminaCost;
	return item;
}

export function starterClub(): ItemInstance {
	return {
		id: "starter-club",
		itemKind: "weapon",
		definitionId: "club",
		name: "Plain Club",
		level: 0,
		rarity: "common",
		seed: 1,
		hands: 1,
		weight: WEAPONS.club.weight,
		affixes: [],
		requirements: {},
		statBonuses: {},
		modifiers: baseModifiers(1, 1),
		skills: ["bash"],
		rageCost: 0.1,
		dropChance: 0,
		sellValue: 0,
		blockChance: 0,
		reflectionComponents: [],
		attractionSpeed: 0,
		pendingRerollSeed: rerollPendingSeed(1),
	};
}

export function generateItem(
	level: number,
	rarity: Rarity,
	seed: number,
	filters: ItemGenerationFilters = {},
): ItemInstance {
	level = Math.min(level, MAX_ITEM_LEVEL[rarity]);
	const source = new SeededRandom(seed);
	const random = () => source.next();
	const classes = filters.allowedClasses?.length
		? filters.allowedClasses
		: (Object.keys(WEAPONS) as WeaponClass[]).filter(
				(weaponClass) => weaponClass !== "scepter",
			);
	const weaponClass = classes[Math.floor(random() * classes.length)];
	const affixes: AffixId[] = [];
	const rolls = filters.fewerAffixes
		? 1
		: {
				common: 1,
				uncommon: 2,
				rare: 3,
				epic: 4,
				unique: 5,
			}[rarity];
	const pool = Object.values(AFFIXES)
		.filter((affix) => affix.compatibleWeapons.includes(weaponClass))
		.map((affix) => affix.id);
	for (let index = 0; index < rolls; index += 1) {
		const affix = pool[Math.floor(random() * pool.length)];
		if (!affixes.includes(affix)) affixes.push(affix);
	}
	return rollItemPerks(
		buildWeapon(
			weaponClass,
			level,
			rarity,
			seed,
			affixes,
			Math.floor(random() * 1e8),
		),
		seed,
	);
}

export function generateBuckler(
	level: number,
	rarity: Rarity,
	seed: number,
	allowAura = true,
): ItemInstance {
	level = Math.min(level, MAX_ITEM_LEVEL[rarity]);
	const source = new SeededRandom(seed);
	const spiked = rarity === "unique" || source.next() < 0.25;
	const componentCount =
		rarity === "unique" || rarity === "epic" ? 3 : rarity === "rare" ? 2 : 1;
	const pool: ReflectionComponent[] = ["flat", "strength", "return"];
	const reflectionComponents: ReflectionComponent[] = [];
	while (spiked && reflectionComponents.length < componentCount)
		reflectionComponents.push(
			pool.splice(Math.floor(source.next() * pool.length), 1)[0],
		);
	const power = RARITY_POWER[rarity];
	const holy =
		allowAura &&
		!spiked &&
		(rarity === "rare" || rarity === "epic") &&
		seed % 5 === 0;
	return rollItemPerks(
		{
			id: `buckler-${seed}-${Math.floor(source.next() * 1e8)}`,
			itemKind: "buckler",
			definitionId: "buckler",
			name:
				rarity === "unique"
					? "Manaforged Aegis"
					: `${spiked ? "Spiked " : holy ? "Holy " : ""}Buckler`,
			level,
			rarity,
			seed,
			hands: 0,
			weight: 0,
			affixes: [],
			requirements: level
				? {
						strength: Math.min(
							MAX_ITEM_REQUIREMENT,
							Math.max(1, Math.floor(level * 0.35 * power)),
						),
					}
				: {},
			statBonuses: {},
			modifiers: {
				...baseModifiers(1, 1),
				goldGain: 0.05 * power,
				magicFind: 0.02 * power,
			},
			skills: [
				"blocking",
				...(spiked &&
				(rarity === "rare" || rarity === "epic" || rarity === "unique")
					? ["thorns" as const, "reflectiveSurge" as const]
					: []),
				...(holy ? [auraSkillForSeed(seed, 5)] : []),
			],
			rageCost: 1,
			dropChance: Math.min(0.3, 0.04 + power * 0.06),
			sellValue: Math.max(
				1,
				Math.round((level + 1) * power * (spiked ? 5 : 4)),
			),
			blockChance: 0.1 * power,
			reflectionComponents,
			attractionSpeed: 0,
		},
		seed,
	);
}

export function generateRelic(
	level: number,
	rarity: Rarity,
	seed: number,
): ItemInstance {
	level = Math.min(level, MAX_ITEM_LEVEL[rarity]);
	const source = new SeededRandom(seed);
	const power = RARITY_POWER[rarity];
	const attractionSpeed = source.next() < 0.5 ? 35 : 0;
	const sustain = source.next();
	const perkRoll = source.next();
	const modifiers = baseModifiers(1, 1);
	if (sustain < 0.25) modifiers.lifeStealBase = 0.02;
	else if (sustain < 0.5) modifiers.strengthRegenMultiplier = 0.002;
	const perk: SkillId | undefined =
		perkRoll < 0.2
			? "voodoo"
			: perkRoll < 0.4
				? "fireBreath"
				: perkRoll < 0.55
					? "manaDrain"
					: perkRoll < 0.7
						? "penance"
						: perkRoll < 0.85
							? "rapidRegen"
							: undefined;
	const skills: SkillId[] = [
		...(attractionSpeed ? ["attraction" as const, "gravityPull" as const] : []),
		...(perk ? [perk] : []),
		...(perk === "voodoo" ? ["swamp" as const] : []),
	];
	const name =
		perk === "voodoo"
			? "Voodoo Doll"
			: perk === "fireBreath"
				? "Ember Idol"
				: perk === "manaDrain"
					? "Spirit Wounds Idol"
					: perk === "penance"
						? "Penance Idol"
						: perk === "rapidRegen"
							? "Renewal Idol"
							: attractionSpeed
								? "Attracting Relic"
								: "Spirit Relic";
	return rollItemPerks(
		{
			id: `relic-${seed}-${Math.floor(source.next() * 1e8)}`,
			itemKind: "relic",
			definitionId: "relic",
			name,
			level,
			rarity,
			seed,
			hands: 0,
			weight: 0,
			affixes: [],
			requirements: level
				? {
						spirit: Math.min(
							MAX_ITEM_REQUIREMENT,
							Math.max(1, Math.floor(level * 0.35 * power)),
						),
					}
				: {},
			statBonuses: { spirit: Math.max(1, Math.round(power)) },
			modifiers,
			skills,
			rageCost: 0,
			dropChance: Math.min(0.3, 0.04 + power * 0.06),
			sellValue: Math.max(1, Math.round((level + 1) * power * 4)),
			blockChance: 0,
			reflectionComponents: [],
			attractionSpeed,
		},
		seed,
	);
}

export function generateAccessory(
	level: number,
	rarity: Rarity,
	seed: number,
	kind?: "amulet" | "charm",
): ItemInstance {
	level = Math.min(level, MAX_ITEM_LEVEL[rarity]);
	const source = new SeededRandom(seed);
	const itemKind = kind ?? (source.next() < 0.5 ? "amulet" : "charm");
	const [minimum, maximum] = (
		{
			common: [1, 2],
			uncommon: [1, 3],
			rare: [2, 4],
			epic: [4, 6],
			unique: [5, 8],
		} as const
	)[rarity];
	const rollCount =
		minimum + Math.floor(source.next() * (maximum - minimum + 1));
	const statKey = STAT_KEYS[Math.floor(source.next() * STAT_KEYS.length)];
	const statBonuses: Partial<Record<StatKey, number>> = {
		[statKey]: Math.max(
			1,
			Math.ceil((1 + level * 0.12) * RARITY_POWER[rarity]),
		),
	};
	const accessoryBonuses: AccessoryBonuses = {};
	const skills: SkillId[] = itemKind === "charm" ? ["vampiricBoomerang"] : [];
	let attractionSpeed = 0;
	if (itemKind === "amulet") {
		const pool: Array<
			| "mana"
			| "all"
			| "rage"
			| "pull"
			| "cooldown"
			| "manaCost"
			| "lifeCost"
			| "timeHarvest"
			| "healthOnKill"
			| "manaOnKill"
		> = [
			"mana",
			"all",
			"rage",
			"pull",
			"cooldown",
			"manaCost",
			"lifeCost",
			"timeHarvest",
			"healthOnKill",
			"manaOnKill",
		];
		for (let index = 1; index < rollCount; index += 1) {
			const roll = pool.splice(Math.floor(source.next() * pool.length), 1)[0];
			const scale = (level + 1) / 51;
			if (roll === "mana")
				accessoryBonuses.manaSkillLevels = 1 + Math.floor(source.next() * 5);
			else if (roll === "all")
				accessoryBonuses.allSkillLevels = 1 + Math.floor(source.next() * 3);
			else if (roll === "rage")
				accessoryBonuses.rageSkillLevels = 1 + Math.floor(source.next() * 10);
			else if (roll === "pull") attractionSpeed = 35 + Math.round(level * 1.5);
			else if (roll === "cooldown")
				accessoryBonuses.globalCooldownReduction =
					0.05 + 0.75 * Math.min(1, scale * (0.75 + source.next() * 0.25));
			else if (roll === "manaCost")
				accessoryBonuses.manaCostReduction =
					0.05 + 0.85 * Math.min(1, scale * (0.75 + source.next() * 0.25));
			else if (roll === "lifeCost")
				accessoryBonuses.lifeCostReduction =
					0.05 + 0.85 * Math.min(1, scale * (0.75 + source.next() * 0.25));
			else if (roll === "healthOnKill")
				accessoryBonuses.healthOnKill = 1 + Math.floor(source.next() * 25);
			else if (roll === "manaOnKill")
				accessoryBonuses.manaOnKill = 1 + Math.floor(source.next() * 50);
			else skills.push("timeHarvest");
		}
	} else {
		const pool: Array<
			| PhysicalBonusKind
			| "manaCost"
			| "lifeCost"
			| "healthOnKill"
			| "manaOnKill"
		> = [
			"frost",
			"poison",
			"bleed",
			"fire",
			"lightning",
			"manaCost",
			"lifeCost",
			"healthOnKill",
			"manaOnKill",
		];
		const physicalDamage: Partial<Record<PhysicalBonusKind, number>> = {};
		for (let index = 1; index < rollCount; index += 1) {
			const roll = pool.splice(Math.floor(source.next() * pool.length), 1)[0];
			if (roll === "manaCost")
				accessoryBonuses.manaCostReduction = 0.05 + 0.85 * ((level + 1) / 51);
			else if (roll === "lifeCost")
				accessoryBonuses.lifeCostReduction = 0.05 + 0.85 * ((level + 1) / 51);
			else if (roll === "healthOnKill")
				accessoryBonuses.healthOnKill = 1 + Math.floor(source.next() * 25);
			else if (roll === "manaOnKill")
				accessoryBonuses.manaOnKill = 1 + Math.floor(source.next() * 50);
			else
				physicalDamage[roll] =
					0.02 + 0.18 * ((level + 1) / 51) * (0.6 + source.next() * 0.4);
		}
		accessoryBonuses.physicalDamage = physicalDamage;
	}
	return rollItemPerks(
		{
			id: `${itemKind}-${seed}-${Math.floor(source.next() * 1e8)}`,
			itemKind,
			definitionId: itemKind,
			name: itemKind === "amulet" ? "Runed Amulet" : "Vampiric Charm",
			level,
			rarity,
			seed,
			hands: 0,
			weight: 0,
			affixes: [],
			requirements: level
				? {
						spirit: Math.min(
							MAX_ITEM_REQUIREMENT,
							Math.max(1, Math.floor(level * 0.25 * RARITY_POWER[rarity])),
						),
					}
				: {},
			statBonuses,
			modifiers: baseModifiers(1, 1),
			skills,
			rageCost: 0,
			dropChance: Math.min(0.3, 0.04 + RARITY_POWER[rarity] * 0.06),
			sellValue: Math.max(
				1,
				Math.round((level + 1) * RARITY_POWER[rarity] * (3 + rollCount)),
			),
			blockChance: 0,
			reflectionComponents: [],
			attractionSpeed,
			accessoryBonuses,
		},
		seed,
	);
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
			blockChance: 0.1 * RARITY_POWER[rarity],
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

function buildWeapon(
	weaponClass: WeaponClass,
	level: number,
	rarity: Rarity,
	seed: number,
	affixes: AffixId[],
	suffix: number,
): ItemInstance {
	const data = WEAPONS[weaponClass];
	const power = RARITY_POWER[rarity];
	const modifiers = baseModifiers(data.damage * (1 + level * 0.025) * power, 1);
	if (weaponClass === "scepter")
		return rollItemPerks(
			{
				id: `scepter-${seed}-${suffix}`,
				itemKind: "relic",
				definitionId: "scepter",
				name: "Scepter",
				level,
				rarity,
				seed,
				hands: 0,
				weight: 0,
				affixes: [],
				requirements: level
					? {
							spirit: Math.min(
								MAX_ITEM_REQUIREMENT,
								Math.max(1, Math.floor(level * 0.35 * power)),
							),
						}
					: {},
				statBonuses: {
					spirit: Math.max(1, Math.round(power * (1 + level * 0.04))),
					intelligence: Math.max(1, Math.round(power * (1 + level * 0.03))),
				},
				modifiers: {
					...baseModifiers(1, 1),
					manaRegenMultiplier: 1 + power,
					magicAmp: 0.12 * power,
				},
				skills: [auraSkillForSeed(seed)],
				rageCost: 0,
				dropChance: Math.min(0.3, 0.04 + power * 0.06),
				sellValue: Math.max(1, Math.round((level + 1) * power * 5)),
				blockChance: 0,
				reflectionComponents: [],
				attractionSpeed: 0,
			},
			seed,
		);
	for (const affix of affixes) applyAffix(modifiers, affix, power);
	if (seed % 7 === 1) modifiers.lifeStealBase = 0.02;
	else if (seed % 7 === 2) modifiers.strengthRegenMultiplier = 0.002;
	if (weaponClass === "dagger") modifiers.critChance += 0.04 * power;
	if (weaponClass === "throwingAxe") modifiers.bleedChance += 0.15;
	if (weaponClass === "staff") {
		modifiers.manaRegenMultiplier += power;
		modifiers.magicAmp += 0.12 * power;
	}
	const levelScale = weaponLevelScale(level);
	for (const key of [
		"critChance",
		"bleedChance",
		"poisonChance",
		"stunChance",
		"lifeStealBase",
		"strengthRegenMultiplier",
	] as const)
		modifiers[key] *= levelScale;
	const requirements: Partial<Record<StatKey, number>> = {};
	if (data.requirement && level > 0)
		requirements[data.requirement] = Math.min(
			MAX_ITEM_REQUIREMENT,
			Math.max(1, Math.floor(level * 0.6 * power)),
		);
	const hands = (
		["staff", "largeMace", "longsword", "katars"] as WeaponClass[]
	).includes(weaponClass)
		? 2
		: 1;
	const skills = data.skill
		? weaponSkills(weaponClass, data.skill, rarity, seed, hands)
		: [];
	return {
		id: `item-${seed}-${suffix}`,
		itemKind: "weapon",
		definitionId: weaponClass,
		name: `${affixes[0] ? `${capitalize(affixes[0])} ` : ""}${data.label}`,
		level,
		rarity,
		seed,
		hands,
		weight: data.weight,
		affixes,
		requirements,
		statBonuses: {},
		modifiers,
		skills,
		rageCost: data.rage * levelScale,
		dropChance: Math.min(0.3, 0.04 + power * 0.06),
		sellValue: Math.max(
			1,
			Math.round((level + 1) * power * (4 + affixes.length * 2)),
		),
		blockChance: 0,
		reflectionComponents: [],
		attractionSpeed: weaponClass === "staff" && seed % 4 === 0 ? 35 : 0,
		pendingRerollSeed: rerollPendingSeed(seed),
	};
}

function weaponSkills(
	weaponClass: WeaponClass,
	signature: SkillId,
	rarity: Rarity,
	seed: number,
	hands: 1 | 2,
): SkillId[] {
	if (hands !== 2) {
		return [
			signature,
			...(weaponClass === "mace" &&
			(rarity === "rare" || rarity === "epic" || rarity === "unique")
				? (["healing"] as const)
				: []),
			...(weaponClass === "axe" &&
			(rarity === "rare" || rarity === "epic" || rarity === "unique")
				? (["whirlwind"] as const)
				: []),
		];
	}
	const random = new SeededRandom(seed ^ 0x5f3759df);
	const [minimum, maximum] = TWO_HANDED_SKILL_COUNTS[rarity];
	const count = minimum + Math.floor(random.next() * (maximum - minimum + 1));
	const pool = [
		...(weaponClass === "staff"
			? STAFF_SKILL_POOL
			: GENERIC_TWO_HANDED_SKILL_POOL),
	].filter((skill) => skill !== signature);
	for (let index = pool.length - 1; index > 0; index -= 1) {
		const target = Math.floor(random.next() * (index + 1));
		[pool[index], pool[target]] = [pool[target], pool[index]];
	}
	return [signature, ...pool.slice(0, count - 1)];
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
export function itemAutomationKey(item: ItemInstance): string {
	return JSON.stringify({
		itemKind: item.itemKind,
		definitionId: item.definitionId,
		hands: item.hands,
		affixes: [...item.affixes].sort(),
		statBonuses: orderedStats(item.statBonuses),
		skills: [...item.skills].sort(),
		reflectionComponents: [...item.reflectionComponents].sort(),
		attractionSpeed: item.attractionSpeed,
		accessoryBonuses: item.accessoryBonuses ?? {},
		lifeStealBase: item.modifiers.lifeStealBase ?? 0,
		strengthRegenMultiplier: item.modifiers.strengthRegenMultiplier ?? 0,
	});
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
function baseModifiers(
	damageMultiplier: number,
	attackSpeedMultiplier: number,
): ItemModifiers {
	return {
		damageMultiplier,
		attackSpeedMultiplier,
		critChance: 0,
		manaRegenMultiplier: 1,
		magicAmp: 0,
		bleedChance: 0,
		poisonChance: 0,
		stunChance: 0,
		lifeStealBase: 0,
		strengthRegenMultiplier: 0,
		goldGain: 0,
		magicFind: 0,
	};
}
function applyAffix(
	modifiers: ItemModifiers,
	affix: AffixId,
	power: number,
): void {
	for (const [key, value] of Object.entries(
		AFFIXES[affix].modifierPerPower,
	) as [keyof ItemModifiers, number][])
		modifiers[key] += value * power;
}
function capitalize(value: string): string {
	return value[0].toUpperCase() + value.slice(1);
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
function rollItemPerks(item: ItemInstance, seed: number): ItemInstance {
	const source = new SeededRandom(seed + 7919);
	const count = (
		{ common: 1, uncommon: 2, rare: 3, epic: 4, unique: 5 } as const
	)[item.rarity];
	const pool = [...ITEM_PERKS];
	const perks: Partial<Record<ItemPerkId, number>> = {};
	const immunities: ItemImmunity[] = [];
	const requirements = { ...item.requirements };
	const max: Record<ItemPerkId, number> = {
		defense: 10,
		bonusXp: 2,
		physicalResist: 0.5,
		magicResist: 0.5,
		fireResist: 0.5,
		frostResist: 0.5,
		poisonResist: 0.5,
		bleedResist: 0.5,
		dodgeChance: 0.5,
	};
	const immunityFor: Partial<Record<ItemPerkId, ItemImmunity>> = {
		physicalResist: "physical",
		magicResist: "magic",
		fireResist: "fire",
		frostResist: "frost",
		poisonResist: "poison",
		bleedResist: "bleed",
	};
	const attrs: Record<ItemPerkId, StatKey[]> = {
		defense: ["strength"],
		bonusXp: [],
		physicalResist: ["strength", "agility"],
		magicResist: ["intelligence"],
		fireResist: ["intelligence"],
		frostResist: ["intelligence"],
		poisonResist: ["spirit", "agility"],
		bleedResist: ["strength", "agility"],
		dodgeChance: ["agility"],
	};
	for (let i = 0; i < count; i += 1) {
		const key = pool.splice(Math.floor(source.next() * pool.length), 1)[0];
		const factor = ((item.level + 1) / 51) * (0.5 + 0.5 * source.next());
		const immunity = immunityFor[key];
		if (item.level >= 25 && immunity && source.next() < 0.1)
			immunities.push(immunity);
		else
			perks[key] =
				key === "bonusXp"
					? Math.min(
							2,
							Math.max(
								0.05,
								(item.level * (0.25 + 2.75 * source.next())) / 100,
							),
						)
					: max[key] * factor;
		const need = attrs[key].length
			? Math.ceil((5 * item.level * factor) / attrs[key].length)
			: 0;
		for (const attr of attrs[key])
			requirements[attr] = Math.min(
				MAX_ITEM_REQUIREMENT,
				Math.max(requirements[attr] ?? 0, need),
			);
	}
	return ensureUpgradableAttribute(
		{
			...item,
			perks,
			immunities,
			requirements,
			pendingRerollSeed: rerollPendingSeed(seed),
		},
		seed,
	);
}
function ensureUpgradableAttribute(
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
