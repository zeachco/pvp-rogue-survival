import { Unit } from "./Unit";
import { normalize, type Camera, type Vector2 } from "./types";
import type { PlayerProgress } from "../../common/protocol";
import { statsWithItemBonuses } from "../../common/items";
import type { RandomSource } from "../../common/random";
import { renderStatusEffects } from "./render/statusEffects";

export class Hero extends Unit {
  readonly maxSpeed = 235;
  readonly acceleration = 920;
  facing = 0;
  attackSlow = false;
  movementSpeedMultiplier = 1;

  constructor(position: Vector2) { super(position, 18, 100); this.enteredArena = true; }

  applyProgress(progress: PlayerProgress, preserveRatio = false): void {
    const ratio = preserveRatio ? this.hp / this.maxHp : 1;
    const mana = this.mana; const stamina = this.stamina;
    this.configureStats(statsWithItemBonuses(progress.stats, progress.mainHand, progress.offHand, progress.amulet, progress.charm), progress.offHand, progress.mainHand, progress.amulet, progress.charm);
    this.hp = Math.max(0, this.maxHp * ratio);
    if (preserveRatio) { this.mana = Math.min(this.maxMana, mana); this.stamina = Math.min(this.maxStamina, stamina); }
  }

  resetForRealm(): void {
    this.hp = this.maxHp; this.mana = this.maxMana; this.stamina = this.maxStamina; this.statuses = []; this.velocity = { x: 0, y: 0 };
    this.active = true; this.attackSlow = false; this.movementSpeedMultiplier = 1; this.healthRegenMultiplier = 1; this.healthRegenFlat = 0; this.lastDamageSourceId = undefined; this.blockCooldown = 0; this.blockCooldownMax = 0; this.reflectiveSurgeRemaining = 0; this.lastHitDodged = false;
  }

  move(input: Vector2, deltaSeconds: number, width: number, height: number): void {
    const direction = normalize(input);
    this.steer(direction, this.acceleration, this.maxSpeed * (this.attackSlow ? 0.48 : 1) * this.movementSpeedMultiplier, deltaSeconds);
    this.clampToBounds(width, height);
  }

  update(deltaSeconds: number, random?: RandomSource, training = false, regenerateStamina = true): void { this.damageFloorOne = training; this.updateResources(deltaSeconds, random, training, regenerateStamina); }

  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const x = this.position.x - camera.x;
    const y = this.position.y - camera.y;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = "#dffeff"; ctx.strokeStyle = "#3affd4"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    renderStatusEffects(ctx, this.statuses, this.radius, performance.now() / 1000);
    ctx.rotate(this.facing); ctx.fillStyle = "#3affd4";
    ctx.beginPath(); ctx.moveTo(12, -6); ctx.lineTo(29, 0); ctx.lineTo(12, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
