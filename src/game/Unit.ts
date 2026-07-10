import { GameObject } from "./GameObject";
import { clamp, type Vector2 } from "./types";

export abstract class Unit extends GameObject {
  position: Vector2;
  velocity: Vector2 = { x: 0, y: 0 };
  hp: number;
  readonly maxHp: number;

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
