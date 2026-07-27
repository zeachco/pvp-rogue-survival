export interface BalanceConfig {
  id: "normal";
  wave: {
    intervalMs: number;
    prepareMs: number;
    batchIntervalMs: number;
    maxRegulars: number;
    tierEveryWaves: number;
  };
  combat: {
    heroDamageMultiplier: number;
    enemyDamageMultiplier: number;
    enemyHealthMultiplier: number;
    unarmed: { baseDamage: number; strengthDamage: number; range: number; attacksPerSecond: number; rageCost: number };
  };
  rewards: {
    xpMultiplier: number;
    goldChanceMultiplier: number;
    dropChanceMultiplier: number;
    maxDropChance: number;
  };
}

export const BALANCE: BalanceConfig = Object.freeze({
  id: "normal",
  wave: { intervalMs: 60_000, prepareMs: 3_000, batchIntervalMs: 5_000, maxRegulars: 40, tierEveryWaves: 2 },
  combat: { heroDamageMultiplier: 1, enemyDamageMultiplier: 1, enemyHealthMultiplier: 1, unarmed: { baseDamage: 1, strengthDamage: 1, range: 70, attacksPerSecond: 1, rageCost: 0 } },
  rewards: { xpMultiplier: 1, goldChanceMultiplier: 1, dropChanceMultiplier: 1, maxDropChance: 0.3 }
});

export function publicBalance(config: BalanceConfig): BalanceConfig {
  return structuredClone(config);
}
