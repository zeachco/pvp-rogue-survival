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

export function rivalLevel(waveNumber: number, heroLevel: number, balance: BalanceConfig): number {
  return Math.max(Math.floor(heroLevel * 0.8), survivalTier(waveNumber, balance));
}

export function spawnAtMs(index: number, count: number, balance: BalanceConfig): number {
  const batch = Math.min(9, Math.floor(index * 10 / Math.max(1, count)));
  return balance.wave.prepareMs + batch * balance.wave.batchIntervalMs;
}
