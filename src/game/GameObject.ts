import type { Camera } from "./types";

export abstract class GameObject {
	active = true;

	abstract update(deltaSeconds: number): void;

	abstract render(ctx: CanvasRenderingContext2D, camera: Camera): void;
}
