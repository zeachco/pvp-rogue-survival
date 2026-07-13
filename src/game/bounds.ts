import type { Vector2 } from "./types";

export interface BoundedObject { position: Vector2; radius: number; enteredArena: boolean; velocity?: Vector2 }

export function correctArenaBoundary(object: BoundedObject, width: number, height: number, deltaSeconds: number): void {
  const minX = object.radius; const maxX = width - object.radius; const minY = object.radius; const maxY = height - object.radius;
  const target = { x: Math.max(minX, Math.min(maxX, object.position.x)), y: Math.max(minY, Math.min(maxY, object.position.y)) };
  const inside = object.position.x >= minX && object.position.x <= maxX && object.position.y >= minY && object.position.y <= maxY;
  if (inside) { object.enteredArena = true; return; }
  if (!object.enteredArena) {
    const dx = target.x - object.position.x; const dy = target.y - object.position.y; const distance = Math.hypot(dx, dy); const step = Math.min(distance, 30 * deltaSeconds);
    if (distance > 0) { object.position.x += dx / distance * step; object.position.y += dy / distance * step; }
    if (step === distance) object.enteredArena = true;
    return;
  }
  if (object.velocity) {
    if ((object.position.x < minX && object.velocity.x < 0) || (object.position.x > maxX && object.velocity.x > 0)) object.velocity.x = 0;
    if ((object.position.y < minY && object.velocity.y < 0) || (object.position.y > maxY && object.velocity.y > 0)) object.velocity.y = 0;
  }
  object.position.x = target.x; object.position.y = target.y;
}
