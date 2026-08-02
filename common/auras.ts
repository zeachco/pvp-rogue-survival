const cappedAuraLevel = (level: number) => Math.max(1, Math.min(99, level));
export function auraRadius(level: number, spirit = 0): number {
	const capped = cappedAuraLevel(level);
	return (
		180 +
		(capped - 1) * (120 / 98) +
		Math.min(300, 0.5 * capped * Math.max(0, spirit))
	);
}
export function auraSlowMultiplier(level: number): number {
	return 0.8 - (cappedAuraLevel(level) - 1) * (0.3 / 98);
}
export function sunburnInterval(spirit: number): number {
	return Math.max(2, 6 - Math.max(0, spirit) * 0.04);
}
export function sunburnFraction(magic: number): number {
	return Math.min(0.02, 0.005 + Math.max(0, magic) * 0.00025);
}
export function thunderInterval(level: number): number {
	return 10 - (cappedAuraLevel(level) - 1) * (7 / 98);
}
export function thunderDamage(magic: number): number {
	return 3 + Math.max(0, magic) * 0.35;
}
export function thunderCritChance(baseCritChance: number): number {
	return Math.min(1, 0.1 + Math.max(0, baseCritChance));
}
