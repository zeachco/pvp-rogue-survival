import { GameObject } from "./GameObject";
import { normalize, type Camera, type Vector2 } from "./types";
import type { Unit } from "./Unit";
import type { DamagePresentation } from "./CombatText";

export class Projectile extends GameObject {
  readonly position: Vector2;
  readonly radius = 11;
  enteredArena = false;
  readonly velocity: Vector2;
  private lifetime = 4;

  constructor(start: Vector2, target: Vector2, readonly damage = 1, readonly owner: "hero" | "creep" = "creep", readonly skill?: "arcaneBolt", readonly source?: Unit, readonly presentation: DamagePresentation = { kind: "physical" }) {
    super(); this.position = { ...start };
    const direction = normalize({ x: target.x - start.x, y: target.y - start.y });
    this.velocity = { x: direction.x * 245, y: direction.y * 245 };
  }

  update(deltaSeconds: number): void {
    this.position.x += this.velocity.x * deltaSeconds;
    this.position.y += this.velocity.y * deltaSeconds;
    this.lifetime -= deltaSeconds;
    if (this.lifetime <= 0) this.active = false;
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    ctx.save(); ctx.translate(this.position.x - camera.x, this.position.y - camera.y);
    ctx.fillStyle = "rgba(143,213,255,.72)"; ctx.strokeStyle = "#d9f5ff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.beginPath(); ctx.arc(-3, -4, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}
