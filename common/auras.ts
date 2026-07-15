import { cappedSkillLevel } from "./combat";

export function auraRadius(level: number): number { return 180 + (cappedSkillLevel(level) - 1) * (120 / 99); }
export function auraSlowMultiplier(level: number): number { return 0.8 - (cappedSkillLevel(level) - 1) * (0.3 / 99); }
export function sunburnInterval(spirit: number): number { return Math.max(0.5, 5 - Math.max(0, spirit) * 0.045); }
export function sunburnFraction(intelligence: number): number { return Math.min(0.1, 0.01 + Math.max(0, intelligence) * 0.0009); }
export function thunderInterval(level: number): number { return 10 - (cappedSkillLevel(level) - 1) * (9 / 99); }
export function thunderDamage(intelligence: number): number { return 3 + Math.max(0, intelligence) * 0.6; }
export function thunderCritChance(baseCritChance: number): number { return Math.min(1, 0.1 + Math.max(0, baseCritChance)); }
