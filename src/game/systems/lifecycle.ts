import type { CreepWave, UnitBuild } from "../../../common/protocol";
import type { ArenaState } from "../ArenaState";

export const MAX_ACTIVE_CREEPS = 100;

export function activeEnemyCountAllowsAutoForce(
	activeEnemyCount: number,
): boolean {
	return activeEnemyCount < MAX_ACTIVE_CREEPS;
}

export function swarmModeShouldRequest(
	activeEnemyCount: number,
	pendingSpawnCount: number,
	cooldownReady: boolean,
): boolean {
	return (
		(activeEnemyCount === 0 && pendingSpawnCount === 0) ||
		(cooldownReady && activeEnemyCountAllowsAutoForce(activeEnemyCount))
	);
}

export function enqueueWave(
	state: ArenaState,
	wave: CreepWave,
	now: number,
): void {
	state.waveQueue.push(
		...wave.spawns.map((spawn) => ({
			build: spawn.build,
			spawnAt: now + spawn.spawnAtMs,
		})),
	);
}
export function releaseReadySpawns(
	state: ArenaState,
	now: number,
): UnitBuild[] {
	if (state.creeps.filter((creep) => creep.active).length >= MAX_ACTIVE_CREEPS)
		return [];
	const index = state.waveQueue.findIndex((entry) => entry.spawnAt <= now);
	if (index === -1) return [];

	const build = state.waveQueue[index].build;
	state.waveQueue.splice(index, 1);
	return [build];
}
export function expediteQueuedSpawns(state: ArenaState, now: number): void {
	for (const spawn of state.waveQueue)
		spawn.spawnAt = Math.min(spawn.spawnAt, now);
}
export function removeInactive<T extends { active: boolean }>(
	items: T[],
): void {
	for (let index = items.length - 1; index >= 0; index -= 1)
		if (!items[index].active) items.splice(index, 1);
}
