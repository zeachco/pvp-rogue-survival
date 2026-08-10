import type { AffixId, ItemModifiers, SkillId, WeaponClass } from "./items";
import type { CreepKind } from "./protocol";
import type { StatKey } from "./progression";

export interface WeaponDefinition {
	id: WeaponClass;
	label: string;
	damage: number;
	weight: number;
	rage: number;
	requirement?: StatKey;
	skill?: SkillId;
	range?: number;
	projectile?: boolean;
}

export interface SkillDefinition {
	id: SkillId;
	label: string;
	damageMultiplier: number;
	cooldown: number;
	range?: number;
	resource: "rage" | "mana" | "life";
	description: string;
	passive?: boolean;
	upkeep?: { resource: "mana" | "rage"; perLevelPerSecond: number };
	cost?: number;
	enemyEligible?: boolean;
}

export interface AffixDefinition {
	id: AffixId;
	compatibleWeapons: readonly WeaponClass[];
	modifierPerPower: Partial<ItemModifiers>;
}

export interface EnemyArchetypeDefinition {
	id: CreepKind;
	maxSpeed: number;
	acceleration: number;
	attackRange: number;
	retreatRange?: number;
	preferredRange?: number;
}

export const WEAPONS: Readonly<Record<WeaponClass, WeaponDefinition>> = {
	club: {
		id: "club",
		label: "Club",
		damage: 1,
		weight: 12,
		rage: 0.1,
		requirement: "strength",
		skill: "bash",
	},
	sword: {
		id: "sword",
		label: "Sword",
		damage: 1.15,
		weight: 14,
		rage: 0.2,
		requirement: "strength",
		skill: "sweep",
	},
	dagger: {
		id: "dagger",
		label: "Dagger",
		damage: 0.72,
		weight: 8,
		rage: 0.12,
		requirement: "agility",
		skill: "flurry",
	},
	mace: {
		id: "mace",
		label: "Mace",
		damage: 1.35,
		weight: 18,
		rage: 0.28,
		requirement: "strength",
		skill: "shockwave",
	},
	axe: {
		id: "axe",
		label: "Axe",
		damage: 1.22,
		weight: 13,
		rage: 0.22,
		requirement: "strength",
		skill: "cleave",
	},
	throwingAxe: {
		id: "throwingAxe",
		label: "Throwing Axe",
		damage: 1.05,
		weight: 10,
		rage: 0.18,
		requirement: "agility",
		skill: "rendingThrow",
		range: 210,
		projectile: true,
	},
	hammer: {
		id: "hammer",
		label: "Hammer",
		damage: 1.18,
		weight: 16,
		rage: 0.2,
		requirement: "strength",
		skill: "orbitingHammers",
	},
	staff: {
		id: "staff",
		label: "Staff",
		damage: 0.8,
		weight: 16,
		rage: 0.1,
		requirement: "intelligence",
		skill: "arcaneBolt",
		range: 100,
	},
	largeMace: {
		id: "largeMace",
		label: "Large Mace",
		damage: 2.2,
		weight: 22,
		rage: 0.4,
		requirement: "strength",
		skill: "shockwave",
	},
	longsword: {
		id: "longsword",
		label: "Longsword",
		damage: 1.65,
		weight: 16,
		rage: 0.3,
		requirement: "strength",
		skill: "sweep",
	},
	katars: {
		id: "katars",
		label: "Katars",
		damage: 1,
		weight: 6,
		rage: 0.16,
		requirement: "agility",
		skill: "flurry",
	},
	scepter: {
		id: "scepter",
		label: "Scepter",
		damage: 0,
		weight: 0,
		rage: 0,
		requirement: "spirit",
		skill: "thunderAura",
	},
};

export const SKILLS: Readonly<Record<SkillId, SkillDefinition>> = {
	bash: {
		id: "bash",
		label: "Bash",
		damageMultiplier: 1.5,
		cooldown: 5,
		range: 105,
		resource: "rage",
		description:
			"A heavy full-circle strike that always stuns for 1.1 seconds, with cooldown scaling from 6s to 3s between levels 1 and 99.",
	},
	sweep: {
		id: "sweep",
		label: "Sweep",
		damageMultiplier: 1.25,
		cooldown: 5,
		range: 135,
		resource: "rage",
		description:
			"A broad sword sweep that always inflicts a strong 9-second bleed.",
	},
	flurry: {
		id: "flurry",
		label: "Flurry",
		damageMultiplier: 0.8,
		cooldown: 6,
		range: 105,
		resource: "rage",
		description:
			"A fast dagger attack with shortened recovery, a wide close-range arc, and a cooldown that scales from 6s to 3s between levels 1 and 99.",
	},
	shockwave: {
		id: "shockwave",
		label: "Shockwave",
		damageMultiplier: 1.35,
		cooldown: 4.5,
		range: 125,
		resource: "rage",
		description:
			"A full-circle physical impact that always stuns for 0.6 seconds.",
	},
	cleave: {
		id: "cleave",
		label: "Cleave",
		damageMultiplier: 0.3625,
		cooldown: 6,
		range: 100,
		resource: "rage",
		description:
			"A wide, forceful axe cleave with 2× knockback that inflicts a 6-second bleed. Range scales from 1m to 10m and its attack arc widens from 45° to 270° between levels 1 and 99.",
	},
	whirlwind: {
		id: "whirlwind",
		label: "Whirlwind",
		damageMultiplier: 0,
		cooldown: 18,
		range: 90,
		resource: "rage",
		cost: 3,
		description:
			"Spinning edges follow the hero for 3–12 seconds; movement scales from 0.5× to 1.5× speed and pulses deal Strength-scaled physical damage.",
	},
	rendingThrow: {
		id: "rendingThrow",
		label: "Rending Throw",
		damageMultiplier: 0.45,
		cooldown: 4,
		range: 240,
		resource: "rage",
		description:
			"A short-ranged piercing axe projectile with 0.45× damage that guarantees an 18-second Bleed. It hits 1 target at level 1, gains 1 pierce at level 2, then gains 1 more pierce every 3 levels.",
	},
	vampiricBoomerang: {
		id: "vampiricBoomerang",
		label: "Vampiric Boomerang",
		damageMultiplier: 1.1,
		cooldown: 8,
		range: 260,
		resource: "life",
		description:
			"Launches a huge fast crescent with half knockback. Every 0.5 seconds it damages all overlapping foes; consumed HP adds to damage at 1 + skill level / 10, and it heals from cumulative actual damage when it returns.",
	},
	orbitingHammers: {
		id: "orbitingHammers",
		label: "Orbiting Hammers",
		damageMultiplier: 0.85,
		cooldown: 12,
		range: 240,
		resource: "mana",
		cost: 25,
		description:
			"Launches three drifting magical hammers that spiral outward, persist through impacts, and hit each enemy at most once.",
	},
	arcaneBolt: {
		id: "arcaneBolt",
		label: "Arcane Bolt",
		damageMultiplier: 1.7,
		cooldown: 5,
		range: 330,
		resource: "mana",
		description:
			"A long-ranged magical projectile that explodes on impact, dealing area damage in a radius that scales from 1 to 4 meters.",
	},
	gravityPull: {
		id: "gravityPull",
		label: "Force Field",
		damageMultiplier: 0.6,
		cooldown: 18,
		range: 200,
		resource: "mana",
		description:
			"Pushes and damages enemies within a level-scaled force field, both diminishing with distance.",
	},
	attraction: {
		id: "attraction",
		label: "Attraction",
		damageMultiplier: 0,
		cooldown: 0,
		resource: "mana",
		passive: true,
		upkeep: { resource: "mana", perLevelPerSecond: 0.001 },
		description:
			"Passively grants Magic and Gold find while pulling item drops faster at higher levels.",
	},
	manaDrain: {
		id: "manaDrain",
		label: "Spirit Wounds",
		damageMultiplier: 0,
		cooldown: 0,
		resource: "mana",
		passive: true,
		description:
			"An aura that tears open every critical wound you inflict. Critical damage from attacks, spells, projectiles, auras, reflection, statuses, and continuous effects restores level-scaled Mana and echoes the same amount as bonus Cold damage. The Cold echo cannot critically strike or trigger Spirit Wounds again.",
	},
	penance: {
		id: "penance",
		label: "Penance",
		damageMultiplier: 0,
		cooldown: 0,
		resource: "rage",
		passive: true,
		upkeep: { resource: "rage", perLevelPerSecond: 0.002 },
		description:
			"Sustains its vigil with Rage. After a successful buckler block, restores Mana equal to blocked damage × Spirit × level conversion (1% at level 1, up to 30% at level 99). Cannot exceed maximum Mana.",
	},
	thorns: {
		id: "thorns",
		label: "Thorns",
		damageMultiplier: 0,
		cooldown: 0,
		resource: "rage",
		passive: true,
		upkeep: { resource: "mana", perLevelPerSecond: 0.005 },
		description:
			"Passive: returns 5% of incoming direct damage, even without a block.",
	},
	reflectiveSurge: {
		id: "reflectiveSurge",
		label: "Reflective Surge",
		damageMultiplier: 0,
		cooldown: 30,
		range: 600,
		resource: "rage",
		description:
			"Surges for 5–19 seconds, doubling Thorns and block reflection, adding 1% of incoming damage to every return, and granting 10–30% block chance up to a 95% final cap.",
	},
	frostOrb: {
		id: "frostOrb",
		label: "Frozen Orb",
		damageMultiplier: 0.7,
		cooldown: 20,
		range: 500,
		resource: "mana",
		cost: 45,
		description:
			"Launches a slow freezing orb that sprays damaging ice spikes in every direction.",
	},
	blizzard: {
		id: "blizzard",
		label: "Blizzard",
		damageMultiplier: 0,
		cooldown: 20,
		range: 500,
		resource: "mana",
		description:
			"Rains icicles for 5–15 seconds. Each impact deals level + 1.2× Intelligence Cold damage in a 2–4m area and applies one Frost stack. Rainfall scales from 1 to 3 icicles/s.",
	},
	fireBreath: {
		id: "fireBreath",
		label: "Fire Breath",
		damageMultiplier: 1.1,
		cooldown: 9,
		range: 150,
		resource: "mana",
		cost: 4,
		enemyEligible: true,
		description:
			"Breathes advancing fire arcs in a cone and burns targets for 24 seconds, scaling with Spirit.",
	},
	swamp: {
		id: "swamp",
		label: "Gooey Swamp",
		damageMultiplier: 0,
		cooldown: 45,
		range: 200,
		resource: "mana",
		description:
			"Creates a large stationary swamp at the closest enemy that slows creeps and adds a Poison stack each second.",
	},
	rapidRegen: {
		id: "rapidRegen",
		label: "Rapid Regeneration",
		damageMultiplier: 0,
		cooldown: 20,
		resource: "mana",
		cost: 4,
		description:
			"While missing health, grants a level-scaled regeneration surge for 10–30 seconds.",
	},
	voodoo: {
		id: "voodoo",
		label: "Voodoo",
		damageMultiplier: 0,
		cooldown: 0,
		resource: "mana",
		passive: true,
		upkeep: { resource: "mana", perLevelPerSecond: 0.005 },
		description:
			"Passive: Spirit amplifies poison damage applied by this unit.",
	},
	healing: {
		id: "healing",
		label: "Healing",
		damageMultiplier: 0,
		cooldown: 15,
		range: 150,
		resource: "mana",
		description:
			"At or below 50% HP, restores 40–100% of current health plus 5–10% maximum health in a 3–12 m radius.",
	},
	rent: {
		id: "rent",
		label: "Rent",
		damageMultiplier: 1.25,
		cooldown: 4,
		range: 180,
		resource: "life",
		description:
			"A full-circle blood-edge attack that adds the HP spent to damage.",
	},
	blocking: {
		id: "blocking",
		label: "Blocking",
		damageMultiplier: 0,
		cooldown: 1,
		resource: "rage",
		passive: true,
		upkeep: { resource: "rage", perLevelPerSecond: 0.001 },
		description:
			"An extractable passive that adds 1% base block chance per effective level while a buckler is equipped. Return bucklers divide recovery by main-hand attack speed.",
	},
	slowAura: {
		id: "slowAura",
		label: "Glacial Aura",
		damageMultiplier: 0,
		cooldown: 0,
		resource: "mana",
		passive: true,
		upkeep: { resource: "mana", perLevelPerSecond: 0.005 },
		description: "Passively slows nearby enemy movement.",
	},
	hinderingAura: {
		id: "hinderingAura",
		label: "Hindering Aura",
		damageMultiplier: 0,
		cooldown: 0,
		resource: "mana",
		passive: true,
		upkeep: { resource: "mana", perLevelPerSecond: 0.005 },
		description: "Passively slows nearby enemy attacks.",
	},
	deathBurst: {
		id: "deathBurst",
		label: "Death Burst",
		damageMultiplier: 0,
		cooldown: 0,
		resource: "mana",
		passive: true,
		upkeep: { resource: "mana", perLevelPerSecond: 0.01 },
		description: "Nearby enemies explode when defeated, damaging other foes.",
	},
	sunburnAura: {
		id: "sunburnAura",
		label: "Sunburn",
		damageMultiplier: 0,
		cooldown: 5,
		resource: "mana",
		passive: true,
		upkeep: { resource: "mana", perLevelPerSecond: 0.01 },
		description:
			"Burns every nearby foe; Spirit controls cadence and Intelligence raises damage.",
	},
	thunderAura: {
		id: "thunderAura",
		label: "Thunder Aura",
		damageMultiplier: 0,
		cooldown: 10,
		resource: "mana",
		passive: true,
		upkeep: { resource: "mana", perLevelPerSecond: 0.01 },
		description:
			"Strikes a random nearby foe; critical strikes chain lightning.",
	},
	timeHarvest: {
		id: "timeHarvest",
		label: "Time Harvest",
		damageMultiplier: 0,
		cooldown: 0,
		resource: "mana",
		passive: true,
		upkeep: { resource: "mana", perLevelPerSecond: 0.002 },
		description:
			"After each enemy kill, reduces every hero cooldown by 0.25 to 2 seconds based on skill level.",
	},
};

export const ENEMY_BONUS_SKILLS = Object.values(SKILLS)
	.filter((skill) => skill.enemyEligible)
	.map((skill) => skill.id);

export const AFFIXES: Readonly<Record<AffixId, AffixDefinition>> = {
	rusty: {
		id: "rusty",
		compatibleWeapons: [
			"club",
			"sword",
			"dagger",
			"mace",
			"axe",
			"throwingAxe",
			"hammer",
			"largeMace",
			"longsword",
			"katars",
		],
		modifierPerPower: { poisonChance: 0.05 },
	},
	venomous: {
		id: "venomous",
		compatibleWeapons: [
			"sword",
			"dagger",
			"axe",
			"throwingAxe",
			"staff",
			"longsword",
			"katars",
		],
		modifierPerPower: { poisonChance: 0.1 },
	},
	bleeding: {
		id: "bleeding",
		compatibleWeapons: [
			"sword",
			"dagger",
			"axe",
			"throwingAxe",
			"longsword",
			"katars",
		],
		modifierPerPower: { bleedChance: 0.08 },
	},
	stunning: {
		id: "stunning",
		compatibleWeapons: ["club", "mace", "hammer", "largeMace"],
		modifierPerPower: { stunChance: 0.07 },
	},
	focused: {
		id: "focused",
		compatibleWeapons: ["staff", "scepter"],
		modifierPerPower: { magicAmp: 0.1 },
	},
	swift: {
		id: "swift",
		compatibleWeapons: [
			"club",
			"sword",
			"dagger",
			"mace",
			"axe",
			"throwingAxe",
			"hammer",
			"staff",
			"largeMace",
			"longsword",
			"katars",
			"scepter",
		],
		modifierPerPower: { attackSpeedMultiplier: 0.12 },
	},
};

export const ENEMY_ARCHETYPES: Readonly<
	Record<CreepKind, EnemyArchetypeDefinition>
> = {
	melee: { id: "melee", maxSpeed: 72, acceleration: 190, attackRange: 62 },
	bubbleShooter: {
		id: "bubbleShooter",
		maxSpeed: 72,
		acceleration: 190,
		attackRange: 330,
		retreatRange: 210,
		preferredRange: 285,
	},
	rival: { id: "rival", maxSpeed: 100, acceleration: 250, attackRange: 62 },
};
