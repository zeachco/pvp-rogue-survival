import { GameObject } from "./GameObject";
import { Projectile } from "./Projectile";
import type { Creep } from "./Creep";
import type { Camera, Vector2 } from "./types";

export class Tower extends GameObject {
  readonly position: Vector2;
  readonly range = 150;
  private readonly damage = 22;
  private readonly cooldownSeconds = 0.45;
  private cooldown = 0;
  private targetAngle = -Math.PI / 2;
  private readonly projectiles: Projectile[];

  constructor(position: Vector2, projectiles: Projectile[]) {
    super();
    this.position = { ...position };
    this.projectiles = projectiles;
  }

  update(deltaSeconds: number): void {
    this.cooldown = Math.max(0, this.cooldown - deltaSeconds);
  }

  attack(creeps: Creep[]): void {
    if (this.cooldown > 0) return;
    const target = creeps.find((creep) => creep.active && creep.distanceTo(this.position) <= this.range);
    if (!target) return;

    this.targetAngle = Math.atan2(target.position.y - this.position.y, target.position.x - this.position.x);
    target.takeDamage(this.damage);
    this.projectiles.push(new Projectile(this.position, target.position));
    this.cooldown = this.cooldownSeconds;
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const x = this.position.x - camera.x;
    const y = this.position.y - camera.y;
    ctx.save();
    ctx.strokeStyle = "rgba(58, 255, 212, 0.14)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, this.range, 0, Math.PI * 2);
    ctx.stroke();

    ctx.translate(x, y);
    ctx.fillStyle = "#d7faff";
    ctx.strokeStyle = "#0b343a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.rect(-17, -17, 34, 34);
    ctx.fill();
    ctx.stroke();

    ctx.rotate(this.targetAngle);
    ctx.fillStyle = "#3affd4";
    ctx.fillRect(0, -5, 28, 10);
    ctx.restore();
  }
}
