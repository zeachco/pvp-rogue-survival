import { type CreepKind, type PlayerId, type UnitBuild } from "../../common/protocol";
import { statsWithItemBonuses } from "../../common/items";
import type { BalanceConfig } from "../../common/balance";
import type { RandomSource } from "../../common/random";
import { ENEMY_ARCHETYPES } from "../../common/content";
import { attackProfile } from "../../common/combat";
import { Unit } from "./Unit";
import { dropRarityColor } from "./ItemDrop";
import { distance, normalize, type Camera, type Vector2 } from "./types";
import { creepMaxHealth } from "../../common/waves";
import { renderStatusEffects } from "./render/statusEffects";

export type CreepAttack =
  | { type: "melee"; origin: Vector2; angle: number; windup: number; source: Creep }
  | { type: "projectile"; origin: Vector2; target: Vector2; source: Creep }
  | { type: "fireBreath"; origin: Vector2; angle: number; source: Creep }
  | { type: "forceField"; source: Creep };

export class Creep extends Unit {
  attackVersion = 0;
  readonly bounty: number;
  readonly scoreValue: number;
  private cooldown: number;
  private windup = 0;
  private pendingAttack = false;
  private damageFlash = false;
  private bonusSkillCooldown = 1.5;
  private auraMovementMultiplier = 1; private auraAttackMultiplier = 1; private groundMovementMultiplier = 1;
  readonly build: UnitBuild;

  constructor(
    build: UnitBuild,
    readonly emitterId: PlayerId | "neutral",
    readonly emitterName: string,
    position: Vector2,
    private readonly balance: BalanceConfig,
    private readonly random: RandomSource,
    readonly movementMultiplier = 1
  ) {
    super(position, build.isRival ? 22 : 16, 1);
    this.build = build;
    this.cooldown = 0.5 + random.next() * 0.4;
    this.kind = build.kind;
    this.configureStats(statsWithItemBonuses(build.stats, build.mainHand, build.offHand, build.amulet, build.charm), build.offHand, build.mainHand, build.amulet, build.charm);
    for (const skill of [...(build.mainHand?.skills ?? []), ...(build.offHand?.skills ?? []), ...(build.amulet?.skills ?? []), ...(build.charm?.skills ?? []), ...(build.bonusSkills ?? [])]) this.knownSkills.add(skill);
    this.maxHp = creepMaxHealth(build.level, this.maxHp, balance); this.hp = this.maxHp;
    this.bounty = Math.max(1, build.mainHand?.sellValue ?? 1);
    this.scoreValue = build.isRival ? 10 : 2;
  }

  readonly kind: CreepKind;

  override takeDamage(amount: number): void {
    super.takeDamage(amount);
    this.damageFlash = true;
  }

  pursue(hero: Vector2, deltaSeconds: number, width: number, height: number): CreepAttack | undefined {
    this.updateResources(deltaSeconds, this.random);
    const movement = ENEMY_ARCHETYPES[this.build.isRival ? "rival" : this.kind];
    const rangedMovement = ENEMY_ARCHETYPES.bubbleShooter;
    const maxSpeed = movement.maxSpeed * (1 + this.stats.agility * 0.01) * this.movementMultiplier * this.auraMovementMultiplier * this.groundMovementMultiplier;
    const acceleration = movement.acceleration;
    const profile = attackProfile(this.build.mainHand, this.stats, this.balance); const ranged = profile.projectile;
    const heroDistance = distance(this.position, hero);
    const attackSpeed = profile.attacksPerSecond * this.auraAttackMultiplier;
    this.cooldown = Math.max(0, this.cooldown - deltaSeconds);
    this.bonusSkillCooldown = Math.max(0, this.bonusSkillCooldown - deltaSeconds);

    if (this.pendingAttack) {
      this.windup -= deltaSeconds;
      this.moveFromVelocity({ x: 0, y: 0 }, acceleration, maxSpeed * 0.25, deltaSeconds);
      if (this.windup <= 0) {
        this.pendingAttack = false;
        return ranged ? { type: "projectile", origin: { ...this.position }, target: { ...hero }, source: this } : undefined;
      }
      return undefined;
    }

    const attackRange = ranged ? profile.range : this.build.mainHand ? movement.attackRange : profile.range;
    if (this.build.bonusSkills?.includes("fireBreath") && this.bonusSkillCooldown === 0 && this.mana >= 4 && heroDistance <= 150) { this.mana -= 4; this.bonusSkillCooldown = 9; return { type: "fireBreath", origin: { ...this.position }, angle: Math.atan2(hero.y - this.position.y, hero.x - this.position.x), source: this }; }
    if (this.knownSkills.has("gravityPull") && this.bonusSkillCooldown === 0 && this.mana >= 8 && heroDistance <= 600) { this.mana -= 8; this.bonusSkillCooldown = 18; return { type: "forceField", source: this }; }
    if (this.cooldown === 0 && heroDistance <= attackRange) {
      const windup = (ranged ? 0.65 : 0.7) / attackSpeed;
      this.pendingAttack = true;
      this.windup = windup;
      this.cooldown = windup + (ranged ? 1.15 : 0.75) / attackSpeed;
      return ranged ? undefined : { type: "melee", origin: { ...this.position }, angle: Math.atan2(hero.y - this.position.y, hero.x - this.position.x), windup, source: this };
    }

    let direction = normalize({ x: hero.x - this.position.x, y: hero.y - this.position.y });
    const magicRanged = this.build.mainHand?.definitionId === "staff" || this.build.mainHand?.definitionId === "scepter";
    const retreatRange = magicRanged ? rangedMovement.retreatRange ?? 0 : Math.max(0, attackRange - 75);
    const preferredRange = magicRanged ? rangedMovement.preferredRange ?? attackRange : Math.max(retreatRange, attackRange - 30);
    if (ranged && heroDistance < retreatRange) direction = { x: -direction.x, y: -direction.y };
    else if (ranged && heroDistance <= preferredRange) direction = { x: 0, y: 0 };
    this.moveFromVelocity(this.stunned ? { x: 0, y: 0 } : direction, acceleration, maxSpeed, deltaSeconds);
    this.position.x = Math.max(-this.radius, Math.min(width + this.radius, this.position.x));
    this.position.y = Math.max(-this.radius, Math.min(height + this.radius, this.position.y));
    return undefined;
  }

  update(): void {}

  interruptAttack(): void { this.attackVersion += 1; this.pendingAttack = false; this.windup = 0; }
  setAuraMultipliers(movement?: number, attack?: number): void { if (movement !== undefined) this.auraMovementMultiplier = movement; if (attack !== undefined) this.auraAttackMultiplier = attack; }
  setGroundMovementMultiplier(multiplier: number): void { this.groundMovementMultiplier = multiplier; }

  private moveFromVelocity(direction: Vector2, acceleration: number, maxSpeed: number, deltaSeconds: number): void { if (this.frozen) this.slide(deltaSeconds); else this.steerWithFriction(direction, acceleration, maxSpeed, deltaSeconds, acceleration * 0.75); }

  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    ctx.save(); ctx.translate(this.position.x - camera.x, this.position.y - camera.y);
    const damageFlash = this.damageFlash; this.damageFlash = false;
    ctx.fillStyle = damageFlash ? "#ffffff" : this.build.isRival ? "#ffd166" : this.kind === "bubbleShooter" ? "#8c7cff" : "#ff6f7d";
    const sentItem = this.build.emitterId ? [this.build.mainHand, this.build.offHand, this.build.amulet, this.build.charm].find((item) => item?.id.includes("sent")) : undefined; ctx.strokeStyle = sentItem ? dropRarityColor(sentItem.rarity) : this.build.isRival ? "#704d00" : "#501721"; ctx.lineWidth = sentItem ? 5 : 3; if (sentItem) { ctx.shadowColor = dropRarityColor(sentItem.rarity); ctx.shadowBlur = 10; }
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
    renderStatusEffects(ctx, this.statuses, this.radius, performance.now() / 1000);
    if (this.kind === "bubbleShooter") {
      ctx.fillStyle = "#dff8ff"; ctx.beginPath(); ctx.arc(5, -5, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(-16, -28, 32, 4);
    ctx.fillStyle = "#f1fffa"; ctx.fillRect(-16, -28, 32 * this.hp / this.maxHp, 4);
    if (sentItem) {
      ctx.font = "600 12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillStyle = "#eafffb"; ctx.shadowColor = "rgba(0,0,0,.95)"; ctx.shadowBlur = 4;
      ctx.fillText(this.emitterName, 0, -34);
    }
    if (this.pendingAttack) {
      ctx.strokeStyle = "#ffea77"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, this.radius + 7, 0, Math.PI * 2); ctx.stroke();
    }
    if (this.build.bonusSkills?.length) { ctx.strokeStyle = "#ff6534"; ctx.lineWidth = 2; ctx.shadowColor = "#ff3d20"; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(0, 0, this.radius + 10, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
}
