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

export function creepMaxHealth(level: number, derivedHealth: number, balance: BalanceConfig): number {
  const normalizedLevel = Math.max(0, Math.floor(level));
  return normalizedLevel < 8 ? normalizedLevel + 1 : derivedHealth * balance.combat.enemyHealthMultiplier;
}

export function rivalLevel(waveNumber: number, balance: BalanceConfig): number {
  return Math.max(1, survivalTier(waveNumber, balance) + 1);
}

export function championCount(waveNumber: number): number {
  return Math.max(0, Math.round(waveNumber / 15));
}

export function isIntroWave(waveNumber: number): boolean {
  return waveNumber >= 0 && waveNumber < 9;
}

export function creepsWithSpellsCount(waveNumber: number, regulars: number): number {
  if (isIntroWave(waveNumber)) return 0;
  return Math.min(Math.max(0, regulars), 1 + Math.max(0, Math.round(waveNumber / 10)));
}

export function rivalXpReward(level: number): number {
  return 25 + 3 * Math.max(0, Math.floor(level));
}

export function spawnAtMs(index: number, count: number, balance: BalanceConfig): number {
  const batch = Math.min(9, Math.floor(index * 10 / Math.max(1, count)));
  return balance.wave.prepareMs + batch * balance.wave.batchIntervalMs;
}
