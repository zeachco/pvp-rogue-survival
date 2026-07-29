import type { BalanceConfig } from "./balance";
import { SKILLS, WEAPONS } from "./content";
import {
	AURA_SKILLS,
	itemRequirementMultiplier,
	RARITY_POWER,
	weaponLevelScale,
	weaponSkillLevelScale,
	type ItemInstance,
	type SkillId,
} from "./items";
import { auraRadius, sunburnFraction, thunderDamage } from "./auras";
import { derivedStats, type Stats } from "./progression";
import type { RandomSource } from "./random";

export function rollWeaponDamage(
	item: ItemInstance,
	stats: Stats,
	owner: "hero" | "enemy",
	balance: BalanceConfig,
	random: RandomSource,
): number {
	return rollWeaponStrike(item, stats, owner, balance, random).damage;
}

export interface AttackProfile {
	kind: "weapon" | "unarmed";
	damage: number;
	attacksPerSecond: number;
	range: number;
	rageCost: number;
	projectile: boolean;
	magic: boolean;
	weapon?: ItemInstance;
}

export function skillUpkeepPerSecond(
	skill: SkillId,
	level: number,
	manaCostReduction = 0,
): number {
	const upkeep = SKILLS[skill].upkeep;
	if (!upkeep) return 0;
	const reduction =
		upkeep.resource === "mana"
			? Math.min(0.9, Math.max(0, manaCostReduction))
			: 0;
	return upkeep.perLevelPerSecond * Math.max(0, level) * (1 - reduction);
}

export function attackProfile(
	mainHand: ItemInstance | undefined,
	stats: Stats,
	balance: BalanceConfig,
): AttackProfile {
	if (!mainHand)
		return {
			kind: "unarmed",
			damage:
				balance.combat.unarmed.baseDamage +
				balance.combat.unarmed.strengthDamage * stats.strength,
			attacksPerSecond: balance.combat.unarmed.attacksPerSecond,
			range: balance.combat.unarmed.range,
			rageCost: balance.combat.unarmed.rageCost,
			projectile: false,
			magic: false,
		};
	return {
		kind: "weapon",
		damage: weaponDamage(mainHand, stats),
		attacksPerSecond: weaponAttackSpeed(mainHand, stats),
		range: weaponRange(mainHand),
		rageCost: mainHand.rageCost,
		projectile: weaponUsesProjectile(mainHand),
		magic: isMagicWeapon(mainHand),
		weapon: mainHand,
	};
}

export function rollAttackStrike(
	mainHand: ItemInstance | undefined,
	stats: Stats,
	owner: "hero" | "enemy",
	balance: BalanceConfig,
	random: RandomSource,
): { damage: number; critical: boolean } {
	if (mainHand)
		return rollWeaponStrike(mainHand, stats, owner, balance, random);
	const derived = derivedStats(stats);
	const critical = random.next() < derived.critChance;
	let damage = attackProfile(undefined, stats, balance).damage;
	if (critical) damage *= derived.critMultiplier;
	return {
		damage:
			damage *
			(owner === "hero"
				? balance.combat.heroDamageMultiplier
				: balance.combat.enemyDamageMultiplier),
		critical,
	};
}

export function isMagicWeapon(item: ItemInstance): boolean {
	return (
		item.itemKind === "weapon" &&
		(item.definitionId === "staff" || item.definitionId === "scepter")
	);
}

export function rollWeaponStrike(
	item: ItemInstance,
	stats: Stats,
	owner: "hero" | "enemy",
	balance: BalanceConfig,
	random: RandomSource,
): { damage: number; critical: boolean } {
	const derived = derivedStats(stats);
	let damage = weaponDamage(item, stats);
	const critical =
		random.next() <
		derived.critChance +
			item.modifiers.critChance * itemRequirementMultiplier(item, stats);
	if (critical) damage *= derived.critMultiplier;
	return {
		damage:
			damage *
			(owner === "hero"
				? balance.combat.heroDamageMultiplier
				: balance.combat.enemyDamageMultiplier),
		critical,
	};
}

export function weaponAttackSpeed(item: ItemInstance, stats: Stats): number {
	if (item.itemKind !== "weapon" || item.weight <= 0) return 0;
	const handling = isMagicWeapon(item)
		? (stats.strength + stats.spirit) / 2
		: item.hands === 1
			? stats.agility
			: stats.strength;
	const effectiveness = itemRequirementMultiplier(item, stats);
	const baseSpeed = (10 + Math.max(0, handling) * 0.1) / item.weight;
	const modifier =
		1 + (item.modifiers.attackSpeedMultiplier - 1) * effectiveness;
	return baseSpeed * Math.max(1, modifier);
}
export function weaponDamage(item: ItemInstance, stats: Stats): number {
	if (item.itemKind !== "weapon") return 0;
	const derived = derivedStats(stats);
	const effectiveness = itemRequirementMultiplier(item, stats);
	const magic = isMagicWeapon(item)
		? derived.magicAmp + item.modifiers.magicAmp * effectiveness
		: 1;
	const penalized =
		derived.baseDamage *
		item.modifiers.damageMultiplier *
		magic *
		effectiveness;
	const levelZeroMagic = isMagicWeapon(item)
		? derived.magicAmp + item.modifiers.magicAmp
		: 1;
	const levelZero =
		derived.baseDamage *
		(item.modifiers.damageMultiplier / weaponLevelScale(item.level)) *
		levelZeroMagic;
	return Math.max(levelZero, penalized);
}
export function weaponRange(item: ItemInstance): number {
	return item.itemKind === "weapon"
		? (WEAPONS[item.definitionId as keyof typeof WEAPONS].range ?? 105)
		: 0;
}
export function weaponUsesProjectile(item: ItemInstance): boolean {
	return (
		item.itemKind === "weapon" &&
		Boolean(WEAPONS[item.definitionId as keyof typeof WEAPONS].projectile)
	);
}
export function bucklerBlockChance(
	item: ItemInstance | undefined,
	stats: Stats,
	blockingLevel = 0,
): number {
	return item?.itemKind === "buckler"
		? Math.min(
				1,
				0.01 * Math.max(0, blockingLevel) +
					(item.blockChance + 0.005 * (stats.strength + stats.agility)) *
						itemRequirementMultiplier(item, stats),
			)
		: 0;
}
export function bucklerBlockCost(item: ItemInstance, stats: Stats): number {
	if (item.itemKind !== "buckler") return 0;
	if (!item.reflectionComponents.includes("return")) return 1;
	const returnedFraction =
		(0.15 + 0.004 * Math.max(0, stats.agility)) * RARITY_POWER[item.rarity];
	return 1 + returnedFraction / (1 + 0.1 * Math.max(0, item.level));
}

export function skillDamageMultiplier(skill: SkillId): number {
	return SKILLS[skill].damageMultiplier;
}
export type SkillDamagePreview =
	| { kind: "multiplier"; value: number }
	| { kind: "flat"; value: number; detail: string }
	| { kind: "percentage"; value: number; detail: string };
export function skillDamagePreview(
	skill: SkillId,
	level: number,
	stats: Stats,
): SkillDamagePreview | undefined {
	if (SKILLS[skill].damageMultiplier > 0)
		return {
			kind: "multiplier",
			value: SKILLS[skill].damageMultiplier * spellPower(level),
		};
	switch (skill) {
		case "whirlwind":
			return {
				kind: "flat",
				value: whirlwindDamage(stats.strength),
				detail: "per pulse",
			};
		case "thorns":
			return { kind: "percentage", value: 0.05, detail: "incoming" };
		case "reflectiveSurge":
			return {
				kind: "percentage",
				value: 0.01,
				detail: "incoming + 2× return",
			};
		case "deathBurst":
			return { kind: "percentage", value: 0.2, detail: "target HP" };
		case "sunburnAura":
			return {
				kind: "percentage",
				value: sunburnFraction(stats.intelligence),
				detail: "target HP / pulse",
			};
		case "thunderAura":
			return {
				kind: "flat",
				value: thunderDamage(stats.intelligence),
				detail: "lightning",
			};
	}
	return undefined;
}
export function skillCooldown(
	skill: SkillId,
	item?: ItemInstance,
	stats?: Stats,
	level = 1,
): number {
	if (skill === "swamp") return swampCooldown(level);
	const base =
		skill === "flurry" ? flurryCooldown(level) : SKILLS[skill].cooldown;
	return (
		base /
		Math.max(1, (stats?.intelligence ?? 0) + (stats?.agility ?? 0)) /
		weaponSkillLevelScale(item?.level ?? 0)
	);
}
export function skillRange(
	skill: SkillId,
	item?: ItemInstance,
	level = 1,
	spirit = 0,
): number {
	if (skill === "healing") return healingRadius(level);
	if (skill === "swamp") return swampRadius(level);
	if (skill === "gravityPull") return forceFieldRange(level);
	if (AURA_SKILLS.includes(skill)) return auraRadius(level, spirit);
	if (skill === "whirlwind") return whirlwindRadius(level);
	const base = SKILLS[skill].range ?? (item ? weaponRange(item) : 0);
	return (
		(base + Math.min(300, 0.5 * Math.max(1, level) * Math.max(0, spirit))) *
		weaponSkillLevelScale(item?.level ?? 0)
	);
}
export function skillLabel(skill: SkillId): string {
	return SKILLS[skill].label;
}
export function spellPower(level: number): number {
	return 1 + Math.max(0, level - 1) * 0.15;
}
export function cooldownScale(level: number, reduction: number): number {
	return Math.max(
		0.2,
		(1 - Math.min(0.8, reduction)) *
			(1 - Math.min(0.5, Math.max(0, level - 1) * 0.04)),
	);
}
export const MAX_SKILL_LEVEL = 99;
export const HEALING_MIN_RADIUS = 150;
export const HEALING_MAX_RADIUS = 600;
export function cappedSkillLevel(level: number): number {
	return Math.max(1, Math.min(MAX_SKILL_LEVEL, level));
}
export function healingRadius(level: number): number {
	return (
		HEALING_MIN_RADIUS +
		(cappedSkillLevel(level) - 1) *
			((HEALING_MAX_RADIUS - HEALING_MIN_RADIUS) / 98)
	);
}
export function flurryCooldown(level: number): number {
	return 10 - (cappedSkillLevel(level) - 1) * (9 / 98);
}
export function forceFieldRange(level: number): number {
	return 200 + (cappedSkillLevel(level) - 1) * (600 / 98);
}
export function manaConversionFraction(level: number): number {
	return 0.01 + (cappedSkillLevel(level) - 1) * (0.59 / 98);
}
export function vampiricBoomerangHealingFraction(level: number): number {
	return 0.01 + (cappedSkillLevel(level) - 1) * (0.79 / 98);
}
export function whirlwindRadius(level: number): number {
	return 90 + 1.2 * cappedSkillLevel(level);
}
export function whirlwindDuration(level: number): number {
	return 3 + ((cappedSkillLevel(level) - 1) / 98) * 27;
}
export function orbitingHammerDuration(level: number): number {
	return 2.4 + ((cappedSkillLevel(level) - 1) / 98) * 27.6;
}
export function whirlwindMovementSpeed(level: number): number {
	return 0.5 + (cappedSkillLevel(level) - 1) / 98;
}
export function rapidRegenDuration(level: number): number {
	return 10 + ((cappedSkillLevel(level) - 1) / 98) * 20;
}
export function rapidRegenMultiplier(level: number): number {
	return 1.2 + ((cappedSkillLevel(level) - 1) / 98) * 3.8;
}
export function swampRadius(level: number): number {
	return 200 + (cappedSkillLevel(level) - 1) * (300 / 98);
}
export function swampCooldown(level: number): number {
	return 45 - (cappedSkillLevel(level) - 1) * (30 / 98);
}
export function whirlwindDamage(strength: number): number {
	return 1 + 0.4 * Math.max(0, strength);
}
export function healingFraction(level: number): number {
	return 0.2 + (cappedSkillLevel(level) - 1) * (0.7 / 98);
}
export function healingCooldown(level: number): number {
	return 15 - (cappedSkillLevel(level) - 1) * (14 / 98);
}
export function attractionSpeedMultiplier(level: number): number {
	return 1 + (cappedSkillLevel(level) - 1) * (3 / 98);
}
export function attractionFindBonus(level: number): number {
	return level > 0 ? cappedSkillLevel(level) * 0.01 : 0;
}
export function timeHarvestItemSkillBonus(itemLevel: number): number {
	return Math.floor((Math.max(0, Math.min(50, itemLevel)) * 99) / 50);
}
export function timeHarvestCooldownReduction(level: number): number {
	return 1 + (cappedSkillLevel(level) - 1) * (9 / 98);
}
export const SKILL_BASE_CAST_TIME: Readonly<Partial<Record<SkillId, number>>> =
	{
		bash: 0.35,
		sweep: 0.3,
		flurry: 0.16,
		shockwave: 0.4,
		cleave: 0.38,
		whirlwind: 0.45,
		rendingThrow: 0.25,
		vampiricBoomerang: 0.42,
		orbitingHammers: 0.4,
		arcaneBolt: 0.32,
		gravityPull: 0.5,
		reflectiveSurge: 0.2,
		frostOrb: 0.48,
		fireBreath: 0.35,
		swamp: 0.45,
		rent: 0.3,
	};
export function skillCastTime(
	skill: SkillId,
	level: number,
	agility: number,
	attacksPerSecond: number,
): number {
	const base = SKILL_BASE_CAST_TIME[skill] ?? 0;
	if (base <= 0) return 0;
	const cappedLevel = cappedSkillLevel(level);
	const accelerated =
		base /
		(1 +
			0.01 * (cappedLevel - 1) +
			0.0005 * Math.max(0, agility) * cappedLevel);
	return Math.min(accelerated, 2 / Math.max(0.01, attacksPerSecond));
}
export function healingCast(
	currentHp: number,
	maxHp: number,
	currentRage: number,
	maxRage: number,
	level: number,
): { restoredHp: number; manaCost: number } {
	const rageFraction =
		maxRage > 0 ? Math.max(0, Math.min(1, currentRage / maxRage)) : 0;
	const requestedHp =
		currentHp * healingFraction(level) + maxHp * (0.05 + 0.05 * rageFraction);
	const restoredHp = Math.max(0, Math.min(maxHp - currentHp, requestedHp));
	const manaCost = healingBaseManaCost(level) + restoredHp * 0.25;
	return { restoredHp, manaCost };
}
export function healingBaseManaCost(level: number): number {
	return 5 + cappedSkillLevel(level) * 2;
}
export function skillStatBonusDescription(skill: SkillId): string | undefined {
	const bonuses: string[] = [];
	if ((SKILL_BASE_CAST_TIME[skill] ?? 0) > 0)
		bonuses.push("Agility and skill level reduce cast time");
	if (SKILLS[skill].range && skill !== "healing")
		bonuses.push("Spirit increases range");
	if (SKILLS[skill].cooldown > 0 && skill !== "healing")
		bonuses.push("Intelligence and Agility reduce cooldown");
	switch (skill) {
		case "healing":
			bonuses.push("Rage adds up to 5% maximum HP");
			break;
		case "whirlwind":
			bonuses.push(
				"Strength increases pulse damage; skill level increases duration and movement speed",
			);
			break;
		case "orbitingHammers":
			bonuses.push("Skill level increases hammer duration");
			break;
		case "rapidRegen":
			bonuses.push(
				"Skill level increases regeneration multiplier and duration",
			);
			break;
		case "fireBreath":
			bonuses.push("Spirit increases Burn damage");
			break;
		case "swamp":
			bonuses.push(
				"Skill level increases swamp radius and reduces its cooldown",
			);
			break;
		case "voodoo":
			bonuses.push("Spirit increases poison amplification");
			break;
		case "manaDrain":
			bonuses.push(
				"Skill level increases Mana restoration and bonus Cold damage",
			);
			break;
		case "penance":
			bonuses.push("Spirit and skill level increase mana restoration");
			break;
		case "timeHarvest":
			bonuses.push("Skill level increases cooldown removal per kill");
			break;
		case "sunburnAura":
			bonuses.push(
				"Intelligence increases damage; Spirit shortens pulse interval",
			);
			break;
		case "thunderAura":
			bonuses.push(
				"Intelligence increases lightning damage; Agility increases critical chance",
			);
			break;
		case "slowAura":
		case "hinderingAura":
		case "deathBurst":
			bonuses.push("Spirit increases aura radius");
			break;
	}
	return bonuses.length ? `Stat bonuses: ${bonuses.join("; ")}.` : undefined;
}
