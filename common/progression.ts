export type StatKey = "agility" | "strength" | "magic" | "spirit" | "intelligence";
export type Stats = Record<StatKey, number>;

export const STAT_KEYS: StatKey[] = ["agility", "strength", "magic", "spirit", "intelligence"];
export const DEFAULT_ALLOCATION: Stats = { agility: 1, strength: 1, magic: 1, spirit: 1, intelligence: 1 };
export const ZERO_STATS: Stats = { agility: 0, strength: 0, magic: 0, spirit: 0, intelligence: 0 };

export interface DerivedStats {
  baseDamage: number; maxHp: number; maxStamina: number; maxMana: number;
  attackSpeed: number; critChance: number; critMultiplier: number;
  cooldownReduction: number; magicAmp: number; hpRegen: number; manaRegen: number; staminaRegen: number;
}

export function derivedStats(stats: Stats): DerivedStats {
  return {
    baseDamage: 1 + stats.strength * 0.2,
    maxHp: 6 + stats.strength,
    maxStamina: 1 + stats.strength,
    maxMana: stats.magic * 2,
    attackSpeed: 1 + stats.agility * 0.05,
    critChance: Math.min(0.75, stats.agility * 0.01),
    critMultiplier: 1.5 + stats.intelligence * 0.05,
    cooldownReduction: Math.min(0.6, stats.intelligence * 0.01),
    magicAmp: 1 + stats.intelligence * 0.02,
    hpRegen: 0.02 + stats.spirit * 0.1,
    manaRegen: 0.02 + stats.spirit * 0.1,
    staminaRegen: 0.2 + stats.spirit * 0.1
  };
}

export function xpForNextLevel(level: number): number { return 100 * Math.max(1, level); }
export function cumulativeXpForLevel(level: number): number {
  let total = 0;
  for (let current = 0; current < level; current += 1) total += xpForNextLevel(current);
  return total;
}
export function levelForXp(xp: number): number {
  let level = 0;
  while (xp >= cumulativeXpForLevel(level + 1)) level += 1;
  return level;
}
export function validAllocation(stats: Stats): boolean {
  return STAT_KEYS.every((key) => Number.isFinite(stats[key]) && stats[key] >= 0) && Math.abs(STAT_KEYS.reduce((sum, key) => sum + stats[key], 0) - 5) < 0.001;
}
