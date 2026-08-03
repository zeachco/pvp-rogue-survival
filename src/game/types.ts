export interface Vector2 {
	x: number;
	y: number;
}
export interface Camera {
	x: number;
	y: number;
	width: number;
	height: number;
}
export type StatusEffectKind =
	| "bleed"
	| "poison"
	| "burn"
	| "stun"
	| "freeze"
	| "shock"
	| "curse";
export const DAMAGE_STATUS_DURATION_MULTIPLIER = 3;

export function damageStatusDuration(baseDuration: number): number {
	return baseDuration * DAMAGE_STATUS_DURATION_MULTIPLIER;
}
export interface StatusEffectSnapshot {
	kind: StatusEffectKind;
	remaining: number;
	damagePerSecond: number;
}
export interface PlayerState {
	id: string;
	name: string;
	receivesDeathEchoes: boolean;
	score: number;
	waveNumber: number;
	maxWaveReached: number;
	health: number;
	maxHealth: number;
	healthRegen: number;
	gold: number;
	progress: PlayerProgress;
	mana: number;
	maxMana: number;
	rage: number;
	maxRage: number;
	attackProgress: number;
	statuses: StatusEffectSnapshot[];
	xpSendBuffs: XpSendBuff[];
}

export function normalize(vector: Vector2): Vector2 {
	const length = Math.hypot(vector.x, vector.y);
	return length > 0
		? { x: vector.x / length, y: vector.y / length }
		: { x: 0, y: 0 };
}

export function distance(a: Vector2, b: Vector2): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
import type { PlayerProgress, XpSendBuff } from "../../common/protocol";
