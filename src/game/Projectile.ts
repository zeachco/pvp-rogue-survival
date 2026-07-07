import { GameObject } from "./GameObject";
import type { Camera, Vector2 } from "./types";

export class Projectile extends GameObject {
  private readonly start: Vector2;
  private readonly end: Vector2;
  private age = 0;
  private readonly duration = 0.12;

  constructor(start: Vector2, end: Vector2) {
    super();
    this.start = { ...start };
    this.end = { ...end };
  }

  update(deltaSeconds: number): void {
    this.age += deltaSeconds;
    if (this.age >= this.duration) {
      this.active = false;
    }
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const alpha = Math.max(0, 1 - this.age / this.duration);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#f7ff7a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.start.x - camera.x, this.start.y - camera.y);
    ctx.lineTo(this.end.x - camera.x, this.end.y - camera.y);
    ctx.stroke();
    ctx.restore();
  }
}
