import type { Vector2 } from "./types";

export type DamageKind = "physical" | "magic" | "electric" | "poison" | "fire" | "bleed";
export interface DamagePresentation { kind: DamageKind; critical?: boolean }
export interface CombatText { position: Vector2; amount: number; kind: DamageKind | "healing"; critical: boolean; age: number; lifetime: number; drift: number }

export const COMBAT_TEXT_COLORS: Readonly<Record<DamageKind | "healing", string>> = {
  physical: "#d8dde2", magic: "#f4d35e", electric: "#7df9ff", poison: "#df6bff", fire: "#ff6534", bleed: "#ff6575", healing: "#65e58b"
};
export const CRITICAL_TEXT_COLOR = "#fff3bd";
