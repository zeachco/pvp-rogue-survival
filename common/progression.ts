export type StatKey = "agility" | "strength" | "magic" | "spirit" | "intelligence";
export type Stats = Record<StatKey, number>;

export const STAT_KEYS: StatKey[] = ["agility", "strength", "magic", "spirit", "intelligence"];
export const DEFAULT_ALLOCATION: Stats = { agility: 1, strength: 1, magic: 1, spirit: 1, intelligence: 1 };
export const ZERO_STATS: Stats = { agility: 0, strength: 0, magic: 0, spirit: 0, intelligence: 0 };

export interface DerivedStats {
  baseDamage: number; maxHp: number; maxStamina: number; maxMana: number;
  critChance: number; critMultiplier: number;
  cooldownReduction: number; magicAmp: number; hpRegen: number; manaRegen: number; staminaRegen: number;
}

export function derivedStats(stats: Stats): DerivedStats {
  return {
    baseDamage: 1 + stats.strength * 0.2,
    maxHp: 6 + stats.strength,
    maxStamina: 1 + stats.strength,
    maxMana: stats.magic * 2,
    critChance: Math.min(0.75, stats.agility * 0.01),
    critMultiplier: 1.5 + stats.intelligence * 0.05,
    cooldownReduction: Math.min(0.6, stats.intelligence * 0.01),
    magicAmp: 1 + stats.intelligence * 0.02,
    hpRegen: 0.02 + stats.spirit * 0.1,
    manaRegen: 0.02 + stats.spirit * 0.1,
    staminaRegen: 0.2 + stats.spirit * 0.1
  };
}

const XP_COSTS = [100, 150];
const XP_THRESHOLDS = [0, 100, 250];
export function xpForNextLevel(level: number): number { const target = Math.max(0, Math.floor(level)); ensureXpLevel(target + 1); return XP_COSTS[target]; }
export function cumulativeXpForLevel(level: number): number { const target = Math.max(0, Math.floor(level)); ensureXpLevel(target); return XP_THRESHOLDS[target]; }
export function levelForXp(xp: number): number { const target = Math.max(0, xp); while (XP_THRESHOLDS[XP_THRESHOLDS.length - 1] <= target) ensureXpLevel(XP_THRESHOLDS.length); let low = 0; let high = XP_THRESHOLDS.length - 1; while (low + 1 < high) { const middle = Math.floor((low + high) / 2); if (XP_THRESHOLDS[middle] <= target) low = middle; else high = middle; } return low; }
function ensureXpLevel(level: number): void { while (XP_THRESHOLDS.length <= level) { const nextCost = XP_COSTS[XP_COSTS.length - 1] + XP_COSTS[XP_COSTS.length - 2]; XP_COSTS.push(nextCost); XP_THRESHOLDS.push(XP_THRESHOLDS[XP_THRESHOLDS.length - 1] + nextCost); } }
export function lerpXpDisplay(current: number, target: number): number { const next = current + (target - current) * 0.1; return Math.abs(target - next) < 0.01 ? target : next; }
export function validAllocation(stats: Stats): boolean {
  return STAT_KEYS.every((key) => Number.isFinite(stats[key]) && stats[key] >= 0) && Math.abs(STAT_KEYS.reduce((sum, key) => sum + stats[key], 0) - 5) < 0.001;
}
