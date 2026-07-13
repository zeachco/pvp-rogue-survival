export type BalanceProfileId = "normal" | "dev";

export interface BalanceConfig {
  id: BalanceProfileId;
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
  };
  rewards: {
    xpMultiplier: number;
    goldChanceMultiplier: number;
    dropChanceMultiplier: number;
    maxDropChance: number;
  };
}

const NORMAL: BalanceConfig = {
  id: "normal",
  wave: { intervalMs: 60_000, prepareMs: 3_000, batchIntervalMs: 5_000, maxRegulars: 40, tierEveryWaves: 2 },
  combat: { heroDamageMultiplier: 1, enemyDamageMultiplier: 1, enemyHealthMultiplier: 1 },
  rewards: { xpMultiplier: 1, goldChanceMultiplier: 1, dropChanceMultiplier: 1, maxDropChance: 0.3 }
};

export const BALANCE_PROFILES: Readonly<Record<BalanceProfileId, BalanceConfig>> = Object.freeze({
  normal: NORMAL,
  dev: {
    ...NORMAL,
    id: "dev",
    combat: { heroDamageMultiplier: 1.5, enemyDamageMultiplier: 0.6, enemyHealthMultiplier: 0.7 },
    rewards: { xpMultiplier: 3, goldChanceMultiplier: 2, dropChanceMultiplier: 3, maxDropChance: 0.75 }
  }
});

export function balanceProfile(id: string | undefined): BalanceConfig {
  return id === "normal" ? BALANCE_PROFILES.normal : BALANCE_PROFILES.dev;
}

export function publicBalance(config: BalanceConfig): BalanceConfig {
  return structuredClone(config);
}
