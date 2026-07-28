import type { Camera, Vector2 } from "./types";
import { systemRandom, type RandomSource } from "../../common/random";

export class GameMap {
	readonly width = 1600;
	readonly height = 1000;
	readonly gridSize = 50;

	get center(): Vector2 {
		return { x: this.width / 2, y: this.height / 2 };
	}

	randomEdgeSpawn(random: RandomSource = systemRandom): Vector2 {
		const margin = 24;
		const edge = Math.floor(random.next() * 4);
		if (edge === 0) return { x: random.next() * this.width, y: -margin };
		if (edge === 1)
			return { x: this.width + margin, y: random.next() * this.height };
		if (edge === 2)
			return { x: random.next() * this.width, y: this.height + margin };
		return { x: -margin, y: random.next() * this.height };
	}

	render(ctx: CanvasRenderingContext2D, camera: Camera): void {
		ctx.save();
		ctx.translate(-camera.x, -camera.y);
		ctx.fillStyle = "#0b1116";
		ctx.fillRect(0, 0, this.width, this.height);
		ctx.strokeStyle = "#18262d";
		ctx.lineWidth = 1;
		for (let x = 0; x <= this.width; x += this.gridSize) {
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, this.height);
			ctx.stroke();
		}
		for (let y = 0; y <= this.height; y += this.gridSize) {
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(this.width, y);
			ctx.stroke();
		}
		const glow = ctx.createRadialGradient(
			this.width / 2,
			this.height / 2,
			20,
			this.width / 2,
			this.height / 2,
			430,
		);
		glow.addColorStop(0, "rgba(40, 255, 205, .07)");
		glow.addColorStop(1, "rgba(40, 255, 205, 0)");
		ctx.fillStyle = glow;
		ctx.fillRect(0, 0, this.width, this.height);
		ctx.strokeStyle = "#3affd4";
		ctx.lineWidth = 5;
		ctx.strokeRect(0, 0, this.width, this.height);
		ctx.restore();
	}
}
