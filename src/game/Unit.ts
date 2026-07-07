import { GameObject } from "./GameObject";
import type { Vector2 } from "./types";

export abstract class Unit extends GameObject {
  position: Vector2;
  radius: number;
  hp: number;
  maxHp: number;

  protected constructor(position: Vector2, radius: number, hp: number) {
    super();
    this.position = { ...position };
    this.radius = radius;
    this.hp = hp;
    this.maxHp = hp;
  }

  takeDamage(amount: number): void {
    this.hp -= amount;
    if (this.hp <= 0) {
      this.active = false;
    }
  }

  distanceTo(target: Vector2): number {
    const dx = this.position.x - target.x;
    const dy = this.position.y - target.y;
    return Math.hypot(dx, dy);
  }
}
