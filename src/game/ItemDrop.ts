import type { ItemInstance } from "../../common/items";
import { GameObject } from "./GameObject";
import type { Camera, Vector2 } from "./types";

export class ItemDrop extends GameObject {
  readonly radius = 14;
  enteredArena = false;
  constructor(readonly dropId: string, readonly item: ItemInstance, readonly position: Vector2) { super(); }
  update(): void {}
  pullToward(target: Vector2, speed: number, deltaSeconds: number): void { const dx = target.x - this.position.x; const dy = target.y - this.position.y; const distance = Math.hypot(dx, dy); if (distance <= 0) return; const travel = Math.min(distance, speed * deltaSeconds); this.position.x += dx / distance * travel; this.position.y += dy / distance * travel; }
  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const color = { common: "#d8e5e8", uncommon: "#62e88a", rare: "#6ca8ff", epic: "#ca75ff" }[this.item.rarity];
    ctx.save(); ctx.translate(this.position.x - camera.x, this.position.y - camera.y); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.fillRect(-9, -9, 18, 18); ctx.restore();
  }
}
