import type { Rarity } from "../../common/items";
import type { GroundDrop } from "../../common/protocol";
import { GameObject } from "./GameObject";
import type { Camera, Vector2 } from "./types";

export class ItemDrop extends GameObject {
	readonly radius = 14;
	enteredArena = false;
	readonly velocity: Vector2 = { x: 0, y: 0 };
	escaping = false;
	constructor(
		readonly drop: GroundDrop,
		readonly position: Vector2,
	) {
		super();
	}
	get dropId(): string {
		return this.drop.id;
	}
	update(): void {}
	pullToward(target: Vector2, speed: number, deltaSeconds: number): void {
		const dx = target.x - this.position.x;
		const dy = target.y - this.position.y;
		const distance = Math.hypot(dx, dy);
		if (distance <= 0) return;
		const travel = Math.min(distance, speed * deltaSeconds);
		this.position.x += (dx / distance) * travel;
		this.position.y += (dy / distance) * travel;
	}
	applyPush(source: Vector2, impulse: number): void {
		if (this.drop.kind !== "item") return;
		const dx = this.position.x - source.x;
		const dy = this.position.y - source.y;
		const length = Math.hypot(dx, dy);
		if (length <= 0) return;
		this.velocity.x += (dx / length) * impulse;
		this.velocity.y += (dy / length) * impulse;
		this.escaping = true;
	}
	move(deltaSeconds: number): void {
		this.position.x += this.velocity.x * deltaSeconds;
		this.position.y += this.velocity.y * deltaSeconds;
	}
	outside(width: number, height: number, margin = 40): boolean {
		return (
			this.position.x < -margin ||
			this.position.y < -margin ||
			this.position.x > width + margin ||
			this.position.y > height + margin
		);
	}
	render(ctx: CanvasRenderingContext2D, camera: Camera): void {
		ctx.save();
		ctx.translate(this.position.x - camera.x, this.position.y - camera.y);
		if (this.drop.kind === "gold") {
			const color = "#f4cf42";
			ctx.fillStyle = color;
			ctx.strokeStyle = "#fff0a0";
			ctx.shadowColor = color;
			ctx.shadowBlur = 14;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(0, 0, 10, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
			ctx.restore();
			return;
		}
		const rarity =
			this.drop.kind === "item" ? this.drop.item.rarity : this.drop.rarity;
		const color = dropRarityColor(rarity);
		ctx.rotate(Math.PI / 4);
		ctx.fillStyle = color;
		ctx.strokeStyle = color;
		ctx.shadowColor = color;
		ctx.shadowBlur = 14;
		ctx.lineWidth = 3;
		if (this.drop.kind === "scrap") ctx.strokeRect(-9, -9, 18, 18);
		else {
			ctx.fillRect(-9, -9, 18, 18);
			ctx.strokeRect(-9, -9, 18, 18);
		}
		ctx.restore();
	}
}

const DROP_RARITY_COLORS: Record<Rarity, string> = {
	common: "#d8e5e8",
	uncommon: "#62e88a",
	rare: "#6ca8ff",
	epic: "#ca75ff",
};
export function dropRarityColor(rarity: Rarity): string {
	return DROP_RARITY_COLORS[rarity] ?? DROP_RARITY_COLORS.common;
}
