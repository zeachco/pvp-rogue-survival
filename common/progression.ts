export type StatKey =
	| "agility"
	| "strength"
	| "magic"
	| "spirit"
	| "intelligence";
export type Stats = Record<StatKey, number>;

export const STAT_KEYS: StatKey[] = [
	"agility",
	"strength",
	"magic",
	"spirit",
	"intelligence",
];
export const DEFAULT_ALLOCATION: Stats = {
	agility: 1,
	strength: 1,
	magic: 1,
	spirit: 1,
	intelligence: 1,
};
export const ZERO_STATS: Stats = {
	agility: 0,
	strength: 0,
	magic: 0,
	spirit: 0,
	intelligence: 0,
};

export const BASE_HERO_TURN_SPEED_DEGREES = 300;
export const MAX_HERO_TURN_SPEED_DEGREES = 6000;
export const HERO_TURN_SPEED_AGILITY_CAP = 100;

export function heroTurnSpeedDegrees(agility: number): number {
	const cappedAgility = Math.min(
		HERO_TURN_SPEED_AGILITY_CAP,
		Math.max(0, agility),
	);
	return (
		BASE_HERO_TURN_SPEED_DEGREES +
		((MAX_HERO_TURN_SPEED_DEGREES - BASE_HERO_TURN_SPEED_DEGREES) *
			cappedAgility) /
			HERO_TURN_SPEED_AGILITY_CAP
	);
}

export interface DerivedStats {
	baseDamage: number;
	maxHp: number;
	maxRage: number;
	maxMana: number;
	critChance: number;
	critMultiplier: number;
	cooldownReduction: number;
	magicAmp: number;
	hpRegen: number;
	manaRegen: number;
	rageRegen: number;
}

export function derivedStats(stats: Stats): DerivedStats {
	return {
		baseDamage: 1 + stats.strength * 0.2,
		maxHp: 10 + stats.strength,
		maxRage: 5 + stats.strength,
		maxMana: 5 + stats.intelligence * 2,
		critChance: Math.min(0.5, stats.agility * 0.01),
		critMultiplier: 1.5 + stats.intelligence * 0.02,
		cooldownReduction: Math.min(0.4, stats.intelligence * 0.005),
		magicAmp: 1 + stats.magic * 0.025,
		hpRegen: 0.005 + stats.spirit * 0.005,
		manaRegen: 0.2 + stats.spirit * 0.1,
		rageRegen: 0.05 + stats.spirit * 0.025,
	};
}

export function xpForNextLevel(level: number): number {
	const target = Math.max(0, Math.floor(level));
	return 15 * (2 * target + 1);
}
export function cumulativeXpForLevel(level: number): number {
	const target = Math.max(0, Math.floor(level));
	return 15 * target * target;
}
export function levelForXp(xp: number): number {
	return Math.max(0, Math.floor(Math.sqrt(Math.max(0, xp) / 15)));
}
export function lerpXpDisplay(current: number, target: number): number {
	const next = current + (target - current) * 0.1;
	return Math.abs(target - next) < 0.01 ? target : next;
}
export function validAllocation(stats: Stats): boolean {
	return (
		STAT_KEYS.every((key) => Number.isInteger(stats[key]) && stats[key] >= 0) &&
		STAT_KEYS.reduce((sum, key) => sum + stats[key], 0) === 5
	);
}
export function integerAllocation(stats: Stats): Stats {
	if (!STAT_KEYS.every((key) => Number.isFinite(stats[key]) && stats[key] >= 0))
		return { ...DEFAULT_ALLOCATION };
	const result = Object.fromEntries(
		STAT_KEYS.map((key) => [key, Math.floor(stats[key])]),
	) as Stats;
	let remaining = 5 - STAT_KEYS.reduce((sum, key) => sum + result[key], 0);
	if (remaining < 0) return { ...DEFAULT_ALLOCATION };
	const priority = [...STAT_KEYS].sort(
		(left, right) =>
			stats[right] -
			Math.floor(stats[right]) -
			(stats[left] - Math.floor(stats[left])),
	);
	for (let index = 0; remaining > 0; index += 1, remaining -= 1)
		result[priority[index % priority.length]] += 1;
	return result;
}
