const cappedAuraLevel = (level: number) => Math.max(1, Math.min(99, level));
export function auraRadius(level: number, spirit = 0): number { const capped = cappedAuraLevel(level); return 180 + (capped - 1) * (120 / 98) + Math.min(300, 0.5 * capped * Math.max(0, spirit)); }
export function auraSlowMultiplier(level: number): number { return 0.8 - (cappedAuraLevel(level) - 1) * (0.3 / 98); }
export function sunburnInterval(spirit: number): number { return Math.max(0.5, 5 - Math.max(0, spirit) * 0.045); }
export function sunburnFraction(intelligence: number): number { return Math.min(0.1, 0.01 + Math.max(0, intelligence) * 0.0009); }
export function thunderInterval(level: number): number { return 10 - (cappedAuraLevel(level) - 1) * (9 / 98); }
export function thunderDamage(intelligence: number): number { return 3 + Math.max(0, intelligence) * 0.6; }
export function thunderCritChance(baseCritChance: number): number { return Math.min(1, 0.1 + Math.max(0, baseCritChance)); }
