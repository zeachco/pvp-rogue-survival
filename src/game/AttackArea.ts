import { GameObject } from "./GameObject";
import { distance, type Camera, type Vector2 } from "./types";

export type AttackOwner = "hero" | "creep";

export class AttackArea extends GameObject {
  private age = 0;
  resolved = false;

  constructor(
    readonly owner: AttackOwner,
    readonly origin: Vector2,
    readonly angle: number,
    readonly range: number,
    readonly halfArc: number,
    readonly windup: number,
    readonly linger: number,
    readonly damage: number,
    readonly source?: object,
    readonly skill?: "bash" | "sweep" | "flurry"
  ) { super(); }

  update(deltaSeconds: number): void {
    this.age += deltaSeconds;
    if (this.age >= this.windup + this.linger) this.active = false;
  }

  shouldResolve(): boolean { return !this.resolved && this.age >= this.windup; }
  markResolved(): void { this.resolved = true; }

  contains(position: Vector2, radius = 0): boolean {
    const dx = position.x - this.origin.x;
    const dy = position.y - this.origin.y;
    if (distance(position, this.origin) > this.range + radius) return false;
    if (this.halfArc >= Math.PI) return true;
    const delta = Math.atan2(Math.sin(Math.atan2(dy, dx) - this.angle), Math.cos(Math.atan2(dy, dx) - this.angle));
    return Math.abs(delta) <= this.halfArc;
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    ctx.save(); ctx.translate(this.origin.x - camera.x, this.origin.y - camera.y);
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.arc(0, 0, this.range, this.angle - this.halfArc, this.angle + this.halfArc); ctx.closePath();
    const hero = this.owner === "hero";
    ctx.fillStyle = this.resolved ? (hero ? "rgba(58,255,212,.32)" : "rgba(255,75,98,.38)") : (hero ? "rgba(58,255,212,.12)" : "rgba(255,75,98,.13)");
    ctx.strokeStyle = hero ? "#3affd4" : "#ff4b62"; ctx.lineWidth = this.resolved ? 4 : 2;
    ctx.fill(); ctx.stroke(); ctx.restore();
  }
}
