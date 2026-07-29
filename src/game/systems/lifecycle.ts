import type { CreepWave, UnitBuild } from "../../../common/protocol";
import type { ArenaState } from "../ArenaState";

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
	const index = state.waveQueue.findIndex((entry) => entry.spawnAt <= now);
	if (index === -1) return [];

	const build = state.waveQueue[index].build;
	state.waveQueue.splice(index, 1);
	return [build];
}
export function removeInactive<T extends { active: boolean }>(
	items: T[],
): void {
	for (let index = items.length - 1; index >= 0; index -= 1)
		if (!items[index].active) items.splice(index, 1);
}
