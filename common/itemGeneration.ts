import { AFFIXES, WEAPONS } from "./content";
import { capitalize } from "./format";
import type {
	AccessoryBonuses,
	AffixId,
	ItemGenerationFilters,
	ItemImmunity,
	ItemInstance,
	ItemModifiers,
	ItemPerkId,
	PhysicalBonusKind,
	Rarity,
	ReflectionComponent,
	SkillId,
	WeaponClass,
} from "./items";
import {
	auraSkillForSeed,
	bucklerBlockChanceValue,
	ensureUpgradableAttribute,
	GENERIC_TWO_HANDED_SKILL_POOL,
	ITEM_PERKS,
	MAX_ITEM_LEVEL,
	MAX_ITEM_REQUIREMENT,
	RARITY_POWER,
	relicVariantForRoll,
	rerollPendingSeed,
	STAFF_SKILL_POOL,
	TWO_HANDED_SKILL_COUNTS,
	weaponLevelScale,
} from "./items";
import { STAT_KEYS, type StatKey } from "./progression";
import { SeededRandom } from "./random";

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
			blockChance: bucklerBlockChanceValue(level, rarity),
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
	const variant = relicVariantForRoll(source.next());
	const modifiers = baseModifiers(1, 1);
	if (sustain < 0.25) modifiers.lifeStealBase = 0.02;
	else if (sustain < 0.5) modifiers.strengthRegenMultiplier = 0.002;
	const skills: SkillId[] = [
		...(attractionSpeed ? ["attraction" as const, "gravityPull" as const] : []),
		...variant.skills,
	];
	const name =
		variant.name === "Spirit Relic" && attractionSpeed
			? "Attracting Relic"
			: variant.name;
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

export function buildWeapon(
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
