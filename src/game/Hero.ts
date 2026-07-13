import { Unit } from "./Unit";
import { normalize, type Camera, type Vector2 } from "./types";
import type { PlayerProgress } from "../../common/protocol";
import { statsWithItemBonuses } from "../../common/items";
import type { RandomSource } from "../../common/random";

export class Hero extends Unit {
  readonly maxSpeed = 235;
  readonly acceleration = 920;
  facing = 0;
  attackSlow = false;

  constructor(position: Vector2) { super(position, 18, 100); this.enteredArena = true; }

  applyProgress(progress: PlayerProgress, preserveRatio = false): void {
    const ratio = preserveRatio ? this.hp / this.maxHp : 1;
    this.configureStats(statsWithItemBonuses(progress.stats, progress.mainHand, progress.offHand), progress.offHand);
    this.hp = Math.max(0, this.maxHp * ratio);
  }

  move(input: Vector2, deltaSeconds: number, width: number, height: number): void {
    const direction = normalize(input);
    this.steer(direction, this.acceleration, this.maxSpeed * (this.attackSlow ? 0.48 : 1), deltaSeconds);
    this.clampToBounds(width, height);
  }

  update(deltaSeconds: number, random?: RandomSource, training = false): void { this.damageFloorOne = training; this.updateResources(deltaSeconds, random, training); }

  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const x = this.position.x - camera.x;
    const y = this.position.y - camera.y;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = "#dffeff"; ctx.strokeStyle = "#3affd4"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.rotate(this.facing); ctx.fillStyle = "#3affd4";
    ctx.beginPath(); ctx.moveTo(12, -6); ctx.lineTo(29, 0); ctx.lineTo(12, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
