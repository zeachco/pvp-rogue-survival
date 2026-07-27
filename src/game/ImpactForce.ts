import type { Unit } from "./Unit";
import type { Vector2 } from "./types";

export type ImpactForceKind = "linear" | "radial";

export interface ImpactForce {
  kind: ImpactForceKind;
  origin: Vector2;
  direction?: Vector2;
  impulse: number;
}

export function emittedImpactForce(source: Unit | undefined, kind: ImpactForceKind, origin: Vector2, direction?: Vector2, scale = 1): ImpactForce | undefined {
  if (!source) return undefined;
  const movementSpeed = Math.hypot(source.velocity.x, source.velocity.y);
  return { kind, origin: { ...origin }, direction: direction && { ...direction }, impulse: (10 + source.stats.strength * 2 + movementSpeed * 0.15) * scale };
}

export function applyImpactForce(target: Unit, force: ImpactForce | undefined): void {
  if (!force) return;
  const direction = force.kind === "linear" ? force.direction : { x: target.position.x - force.origin.x, y: target.position.y - force.origin.y };
  if (!direction) return;
  const length = Math.hypot(direction.x, direction.y);
  if (length <= 0) return;
  target.velocity.x += direction.x / length * force.impulse;
  target.velocity.y += direction.y / length * force.impulse;
  (target as Unit & { interruptAttack?: () => void }).interruptAttack?.();
}
