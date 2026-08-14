import type { BalanceConfig } from "./balance";

export function forceNextWaveCooldownSeconds(waveNumber: number): number {
	return Math.max(10, Math.min(60, waveNumber));
}

export function regularCount(
	waveNumber: number,
	balance: BalanceConfig,
): number {
	return Math.min(
		balance.wave.maxRegulars,
		10 + 2 * Math.max(0, waveNumber - 1),
	);
}

export function survivalTier(
	waveNumber: number,
	balance: BalanceConfig,
): number {
	return Math.floor(Math.max(0, waveNumber - 1) / balance.wave.tierEveryWaves);
}

export function regularLevel(
	waveNumber: number,
	heroLevel: number,
	count: number,
	balance: BalanceConfig,
): number {
	return Math.max(
		Math.floor(heroLevel / Math.max(1, count)),
		survivalTier(waveNumber, balance),
	);
}

export function creepMaxHealth(
	level: number,
	derivedHealth: number,
	balance: BalanceConfig,
	hasEquippedSentItem = false,
): number {
	const normalizedLevel = Math.max(0, Math.floor(level));
	const baseHealth =
		normalizedLevel < 8
			? 10 + normalizedLevel
			: 5 *
				derivedHealth *
				balance.combat.enemyHealthMultiplier *
				1.12 ** (normalizedLevel - 8);
	return baseHealth * (hasEquippedSentItem ? 2 : 1);
}

export function enemyMovementSpeedMultiplier(agility: number): number {
	return 1 + Math.max(0, agility) * 0.02;
}

export function rivalLevel(waveNumber: number, balance: BalanceConfig): number {
	return Math.max(1, survivalTier(waveNumber, balance) + 1);
}

export function championCount(waveNumber: number): number {
	return Math.max(0, Math.round(waveNumber / 15));
}

export function realmCloneLevel(
	defenderLevel: number,
	attackerCount: number,
): number {
	return Math.max(
		0,
		Math.floor(Math.max(0, defenderLevel) / Math.max(1, attackerCount)),
	);
}

export function isIntroWave(waveNumber: number): boolean {
	return waveNumber >= 0 && waveNumber < 9;
}

export function creepsWithSpellsCount(
	waveNumber: number,
	regulars: number,
): number {
	if (isIntroWave(waveNumber)) return 0;
	return Math.min(
		Math.max(0, regulars),
		1 + Math.max(0, Math.round(waveNumber / 10)),
	);
}

export function rivalXpReward(level: number): number {
	return 25 + 3 * Math.max(0, Math.floor(level));
}

export function spawnAtMs(
	index: number,
	count: number,
	balance: BalanceConfig,
): number {
	const batch = Math.min(9, Math.floor((index * 10) / Math.max(1, count)));
	return balance.wave.prepareMs + batch * balance.wave.batchIntervalMs;
}
