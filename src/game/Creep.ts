import { type CreepKind, type PlayerId, type UnitBuild } from "../../common/protocol";
import { derivedStats } from "../../common/progression";
import { statsWithItemBonuses } from "../../common/items";
import type { BalanceConfig } from "../../common/balance";
import type { RandomSource } from "../../common/random";
import { ENEMY_ARCHETYPES } from "../../common/content";
import { Unit } from "./Unit";
import { distance, normalize, type Camera, type Vector2 } from "./types";

export type CreepAttack =
  | { type: "melee"; origin: Vector2; angle: number; windup: number; source: Creep }
  | { type: "bubble"; origin: Vector2; target: Vector2; source: Creep };

export class Creep extends Unit {
  readonly bounty: number;
  readonly scoreValue: number;
  private cooldown: number;
  private windup = 0;
  private pendingAttack = false;
  private damageFlash = 0;
  readonly build: UnitBuild;

  constructor(
    build: UnitBuild,
    readonly emitterId: PlayerId | "neutral",
    readonly emitterName: string,
    position: Vector2,
    balance: BalanceConfig,
    random: RandomSource
  ) {
    super(position, build.isRival ? 22 : 16, 1);
    this.build = build;
    this.cooldown = 0.5 + random.next() * 0.4;
    this.kind = build.kind;
    this.configureStats(statsWithItemBonuses(build.stats, build.equipped));
    this.maxHp *= balance.combat.enemyHealthMultiplier; this.hp = this.maxHp;
    this.bounty = Math.max(1, build.equipped.sellValue);
    this.scoreValue = build.isRival ? 10 : 2;
  }

  readonly kind: CreepKind;

  override takeDamage(amount: number): void {
    super.takeDamage(amount);
    this.damageFlash = 0.16;
  }

  pursue(hero: Vector2, deltaSeconds: number, width: number, height: number): CreepAttack | undefined {
    this.updateResources(deltaSeconds);
    this.damageFlash = Math.max(0, this.damageFlash - deltaSeconds);
    const derived = derivedStats(this.stats);
    const movement = ENEMY_ARCHETYPES[this.build.isRival ? "rival" : this.kind];
    const rangedMovement = ENEMY_ARCHETYPES.bubbleShooter;
    const maxSpeed = movement.maxSpeed * (1 + this.stats.agility * 0.01);
    const acceleration = movement.acceleration;
    const ranged = this.kind === "bubbleShooter" || this.build.equipped.definitionId === "staff";
    const heroDistance = distance(this.position, hero);
    const attackSpeed = derived.attackSpeed * this.build.equipped.modifiers.attackSpeedMultiplier;
    this.cooldown = Math.max(0, this.cooldown - deltaSeconds);

    if (this.pendingAttack) {
      this.windup -= deltaSeconds;
      this.steer({ x: 0, y: 0 }, acceleration, maxSpeed * 0.25, deltaSeconds);
      if (this.windup <= 0) {
        this.pendingAttack = false;
        return ranged ? { type: "bubble", origin: { ...this.position }, target: { ...hero }, source: this } : undefined;
      }
      return undefined;
    }

    const attackRange = ranged ? rangedMovement.attackRange : movement.attackRange;
    if (this.cooldown === 0 && heroDistance <= attackRange) {
      const windup = (ranged ? 0.65 : 0.7) / attackSpeed;
      this.pendingAttack = true;
      this.windup = windup;
      this.cooldown = windup + (ranged ? 1.15 : 0.75) / attackSpeed;
      return ranged ? undefined : { type: "melee", origin: { ...this.position }, angle: Math.atan2(hero.y - this.position.y, hero.x - this.position.x), windup, source: this };
    }

    let direction = normalize({ x: hero.x - this.position.x, y: hero.y - this.position.y });
    if (ranged && heroDistance < (rangedMovement.retreatRange ?? 0)) direction = { x: -direction.x, y: -direction.y };
    else if (ranged && heroDistance <= (rangedMovement.preferredRange ?? rangedMovement.attackRange)) direction = { x: 0, y: 0 };
    if (!this.stunned) this.steer(direction, acceleration, maxSpeed, deltaSeconds);
    this.position.x = Math.max(-this.radius, Math.min(width + this.radius, this.position.x));
    this.position.y = Math.max(-this.radius, Math.min(height + this.radius, this.position.y));
    return undefined;
  }

  update(): void {}

  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    ctx.save(); ctx.translate(this.position.x - camera.x, this.position.y - camera.y);
    ctx.fillStyle = this.damageFlash > 0 ? "#ffffff" : this.build.isRival ? "#ffd166" : this.kind === "bubbleShooter" ? "#8c7cff" : "#ff6f7d";
    ctx.strokeStyle = this.build.isRival ? "#704d00" : "#501721"; ctx.lineWidth = 3;
    ctx.beginPath();
    if (this.kind === "melee") {
      for (let i = 0; i < 6; i += 1) {
        const a = -Math.PI / 2 + i * Math.PI / 3;
        if (i === 0) ctx.moveTo(Math.cos(a) * this.radius, Math.sin(a) * this.radius);
        else ctx.lineTo(Math.cos(a) * this.radius, Math.sin(a) * this.radius);
      }
      ctx.closePath();
    } else ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    if (this.kind === "bubbleShooter") {
      ctx.fillStyle = "#dff8ff"; ctx.beginPath(); ctx.arc(5, -5, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(-16, -28, 32, 4);
    ctx.fillStyle = "#f1fffa"; ctx.fillRect(-16, -28, 32 * this.hp / this.maxHp, 4);
    if (this.pendingAttack) {
      ctx.strokeStyle = "#ffea77"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, this.radius + 7, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
}
