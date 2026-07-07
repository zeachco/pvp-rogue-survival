import { CREEP_DEFINITIONS, type CreepKind, type PlayerId } from "../../common/protocol";
import { Unit } from "./Unit";
import type { Camera, Vector2 } from "./types";

export class Creep extends Unit {
  readonly kind: CreepKind;
  readonly emitterId: PlayerId | "neutral";
  readonly emitterName: string;
  readonly bounty: number;
  readonly scoreValue: number;
  private readonly waypoints: Vector2[];
  private waypointIndex = 1;
  private readonly speed: number;

  constructor(kind: CreepKind, emitterId: PlayerId | "neutral", emitterName: string, waypoints: Vector2[]) {
    const definition = CREEP_DEFINITIONS[kind];
    super(waypoints[0], 15, definition.hp);
    this.kind = kind;
    this.emitterId = emitterId;
    this.emitterName = emitterName;
    this.waypoints = waypoints;
    this.speed = definition.speed;
    this.bounty = definition.bounty;
    this.scoreValue = definition.scoreValue;
  }

  update(deltaSeconds: number): void {
    if (!this.active) return;
    const target = this.waypoints[this.waypointIndex];
    if (!target) {
      this.active = false;
      return;
    }

    const dx = target.x - this.position.x;
    const dy = target.y - this.position.y;
    const distance = Math.hypot(dx, dy);
    const movement = this.speed * deltaSeconds;

    if (distance <= movement) {
      this.position = { ...target };
      this.waypointIndex += 1;
      return;
    }

    this.position.x += (dx / distance) * movement;
    this.position.y += (dy / distance) * movement;
  }

  hasLeaked(): boolean {
    return this.active === false && this.waypointIndex >= this.waypoints.length;
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const definition = CREEP_DEFINITIONS[this.kind];
    ctx.save();
    ctx.translate(this.position.x - camera.x, this.position.y - camera.y);
    ctx.fillStyle = definition.fill;
    ctx.strokeStyle = definition.outline;
    ctx.lineWidth = 3;
    drawPolygon(ctx, definition.sides, this.radius);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(-12, -24, 24 * Math.max(0, this.hp / this.maxHp), 3);
    ctx.restore();
  }
}

function drawPolygon(ctx: CanvasRenderingContext2D, sides: number, radius: number): void {
  ctx.beginPath();
  for (let index = 0; index < sides; index += 1) {
    const angle = -Math.PI / 2 + (index / sides) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
