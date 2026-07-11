import { GameObject } from "./GameObject";
import { clamp, type Vector2 } from "./types";
import { derivedStats, type Stats } from "../../common/progression";

export interface StatusEffect { kind: "bleed" | "poison" | "stun"; remaining: number; damagePerSecond: number }

export abstract class Unit extends GameObject {
  position: Vector2;
  velocity: Vector2 = { x: 0, y: 0 };
  hp: number;
  maxHp: number;
  mana = 0;
  maxMana = 0;
  stamina = 1;
  maxStamina = 1;
  stats: Stats = { agility: 0, strength: 0, magic: 0, spirit: 0, intelligence: 0 };
  statuses: StatusEffect[] = [];

  protected constructor(position: Vector2, readonly radius: number, hp: number) {
    super();
    this.position = { ...position };
    this.hp = hp;
    this.maxHp = hp;
  }

  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp === 0) this.active = false;
  }

  configureStats(stats: Stats): void {
    this.stats = { ...stats };
    const derived = derivedStats(stats);
    this.maxHp = derived.maxHp;
    this.hp = derived.maxHp;
    this.maxMana = derived.maxMana; this.mana = derived.maxMana;
    this.maxStamina = derived.maxStamina; this.stamina = derived.maxStamina;
  }

  updateResources(deltaSeconds: number): void {
    const derived = derivedStats(this.stats);
    let periodicDamage = 0;
    for (const status of this.statuses) { status.remaining -= deltaSeconds; periodicDamage += status.damagePerSecond * deltaSeconds; }
    this.statuses = this.statuses.filter((status) => status.remaining > 0);
    if (periodicDamage > 0) this.takeDamage(periodicDamage);
    this.hp = Math.min(this.maxHp, this.hp + derived.hpRegen * deltaSeconds);
    this.mana = Math.min(this.maxMana, this.mana + derived.manaRegen * deltaSeconds);
    this.stamina = Math.min(this.maxStamina, this.stamina + derived.staminaRegen * deltaSeconds);
  }

  addStatus(status: StatusEffect): void { this.statuses.push(status); }
  get stunned(): boolean { return this.statuses.some((status) => status.kind === "stun"); }

  steer(direction: Vector2, acceleration: number, maxSpeed: number, deltaSeconds: number): void {
    const targetX = direction.x * maxSpeed;
    const targetY = direction.y * maxSpeed;
    const maxChange = acceleration * deltaSeconds;
    this.velocity.x = approach(this.velocity.x, targetX, maxChange);
    this.velocity.y = approach(this.velocity.y, targetY, maxChange);
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    if (speed > maxSpeed) {
      this.velocity.x = (this.velocity.x / speed) * maxSpeed;
      this.velocity.y = (this.velocity.y / speed) * maxSpeed;
    }
    this.position.x += this.velocity.x * deltaSeconds;
    this.position.y += this.velocity.y * deltaSeconds;
  }

  clampToBounds(width: number, height: number): void {
    this.position.x = clamp(this.position.x, this.radius, width - this.radius);
    this.position.y = clamp(this.position.y, this.radius, height - this.radius);
  }
}

function approach(value: number, target: number, change: number): number {
  return value < target ? Math.min(target, value + change) : Math.max(target, value - change);
}
