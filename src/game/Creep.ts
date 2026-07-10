import { CREEP_DEFINITIONS, type CreepKind, type PlayerId } from "../../common/protocol";
import { Unit } from "./Unit";
import { distance, normalize, type Camera, type Vector2 } from "./types";

export type CreepAttack =
  | { type: "melee"; origin: Vector2; angle: number; source: Creep }
  | { type: "bubble"; origin: Vector2; target: Vector2; source: Creep };

export class Creep extends Unit {
  readonly bounty: number;
  readonly scoreValue: number;
  private cooldown = 0.5 + Math.random() * 0.4;
  private windup = 0;
  private pendingAttack = false;

  constructor(
    readonly kind: CreepKind,
    readonly emitterId: PlayerId | "neutral",
    readonly emitterName: string,
    position: Vector2
  ) {
    const definition = CREEP_DEFINITIONS[kind];
    super(position, definition.radius, definition.hp);
    this.bounty = definition.bounty;
    this.scoreValue = definition.scoreValue;
  }

  pursue(hero: Vector2, deltaSeconds: number, width: number, height: number): CreepAttack | undefined {
    const definition = CREEP_DEFINITIONS[this.kind];
    const heroDistance = distance(this.position, hero);
    this.cooldown = Math.max(0, this.cooldown - deltaSeconds);

    if (this.pendingAttack) {
      this.windup -= deltaSeconds;
      this.steer({ x: 0, y: 0 }, definition.acceleration, definition.maxSpeed * 0.25, deltaSeconds);
      if (this.windup <= 0) {
        this.pendingAttack = false;
        this.cooldown = this.kind === "melee" ? 1.1 : 1.8;
        return this.kind === "melee"
          ? { type: "melee", origin: { ...this.position }, angle: Math.atan2(hero.y - this.position.y, hero.x - this.position.x), source: this }
          : { type: "bubble", origin: { ...this.position }, target: { ...hero }, source: this };
      }
      return undefined;
    }

    const attackRange = this.kind === "melee" ? 62 : 330;
    if (this.cooldown === 0 && heroDistance <= attackRange) {
      this.pendingAttack = true;
      this.windup = this.kind === "melee" ? 0.48 : 0.65;
      return undefined;
    }

    let direction = normalize({ x: hero.x - this.position.x, y: hero.y - this.position.y });
    if (this.kind === "bubbleShooter" && heroDistance < 210) direction = { x: -direction.x, y: -direction.y };
    else if (this.kind === "bubbleShooter" && heroDistance <= 285) direction = { x: 0, y: 0 };
    this.steer(direction, definition.acceleration, definition.maxSpeed, deltaSeconds);
    this.position.x = Math.max(-this.radius, Math.min(width + this.radius, this.position.x));
    this.position.y = Math.max(-this.radius, Math.min(height + this.radius, this.position.y));
    return undefined;
  }

  update(): void {}

  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const definition = CREEP_DEFINITIONS[this.kind];
    ctx.save(); ctx.translate(this.position.x - camera.x, this.position.y - camera.y);
    ctx.fillStyle = definition.fill; ctx.strokeStyle = definition.outline; ctx.lineWidth = 3;
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
