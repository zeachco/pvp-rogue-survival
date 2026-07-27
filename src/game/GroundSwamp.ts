import { distance, type Camera, type Vector2 } from "./types";
import { GameObject } from "./GameObject";
import type { Hero } from "./Hero";
import type { Creep } from "./Creep";

export class GroundSwamp extends GameObject {
  private remaining = 8;
  private readonly occupancy = new Map<Creep, number>();

  constructor(readonly position: Vector2, readonly radius: number, private readonly source: Hero) { super(); }

  update(deltaSeconds: number, creeps: readonly Creep[] = []): void {
    this.remaining -= deltaSeconds;
    if (this.remaining <= 0) { this.active = false; return; }
    for (const creep of creeps) {
      if (!creep.active || distance(this.position, creep.position) > this.radius + creep.radius) { this.occupancy.delete(creep); continue; }
      creep.setGroundMovementMultiplier(0.5);
      let elapsed = (this.occupancy.get(creep) ?? 0) + deltaSeconds;
      while (elapsed >= 1) { this.applyPoison(creep); elapsed -= 1; }
      this.occupancy.set(creep, elapsed);
    }
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const x = this.position.x - camera.x; const y = this.position.y - camera.y;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.16);
    ctx.fillStyle = "rgba(21, 42, 23, .55)"; ctx.strokeStyle = "rgba(62, 93, 50, .7)"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(0, 0, this.radius, this.radius * .62, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.globalAlpha = .32; ctx.fillStyle = "#192d1b";
    for (let index = 0; index < 11; index += 1) { const angle = index * 2.399; const offset = this.radius * (.2 + (index % 4) * .16); ctx.beginPath(); ctx.ellipse(Math.cos(angle) * offset, Math.sin(angle) * offset * .58, 11 + index % 3 * 6, 5 + index % 2 * 4, angle, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  private applyPoison(creep: Creep): void {
      const voodoo = this.source.isSkillOperational("voodoo") ? 1 + Math.min(1.5, this.source.stats.spirit * .03) : 1;
    creep.addStatus({ kind: "poison", remaining: 8, damagePerSecond: (.2 + this.source.stats.spirit * .02) * voodoo, source: this.source });
  }
}
