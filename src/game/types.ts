export interface Vector2 { x: number; y: number }
export interface Camera { x: number; y: number; width: number; height: number }
export interface PlayerState {
  id: string;
  name: string;
  score: number;
  waveNumber: number;
  health: number;
  maxHealth: number;
  gold: number;
  progress: PlayerProgress;
  mana: number;
  maxMana: number;
  stamina: number;
  maxStamina: number;
  attackProgress: number;
}

export function normalize(vector: Vector2): Vector2 {
  const length = Math.hypot(vector.x, vector.y);
  return length > 0 ? { x: vector.x / length, y: vector.y / length } : { x: 0, y: 0 };
}

export function distance(a: Vector2, b: Vector2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
import type { PlayerProgress } from "../../common/protocol";
