import type { BalanceConfig } from "./balance";

export function regularCount(waveNumber: number, balance: BalanceConfig): number {
  return Math.min(balance.wave.maxRegulars, 10 + 2 * Math.max(0, waveNumber));
}

export function survivalTier(waveNumber: number, balance: BalanceConfig): number {
  return Math.floor(Math.max(0, waveNumber - 1) / balance.wave.tierEveryWaves);
}

export function regularLevel(waveNumber: number, heroLevel: number, count: number, balance: BalanceConfig): number {
  return Math.max(Math.floor(heroLevel / Math.max(1, count)), survivalTier(waveNumber, balance));
}

export function rivalLevel(waveNumber: number, balance: BalanceConfig): number {
  return Math.max(1, survivalTier(waveNumber, balance) + 1);
}

export function rivalXpReward(level: number): number {
  return 25 + 3 * Math.max(0, Math.floor(level));
}

export function spawnAtMs(index: number, count: number, balance: BalanceConfig): number {
  const batch = Math.min(9, Math.floor(index * 10 / Math.max(1, count)));
  return balance.wave.prepareMs + batch * balance.wave.batchIntervalMs;
}
