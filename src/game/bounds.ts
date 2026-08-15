import type { Vector2 } from "./types";

export interface BoundedObject {
	position: Vector2;
	radius: number;
	enteredArena: boolean;
	velocity?: Vector2;
}

export function arenaCenterAndRadius(
	width: number,
	height: number,
): {
	center: Vector2;
	radius: number;
} {
	return {
		center: { x: width / 2, y: height / 2 },
		radius: Math.min(width, height) / 2,
	};
}

export function clampToArenaBoundary(
	position: Vector2,
	objectRadius: number,
	width: number,
	height: number,
	velocity?: Vector2,
): boolean {
	const arena = arenaCenterAndRadius(width, height);
	const legalRadius = Math.max(0, arena.radius - objectRadius);
	const dx = position.x - arena.center.x;
	const dy = position.y - arena.center.y;
	const distance = Math.hypot(dx, dy);
	if (distance <= legalRadius) return false;
	const normalX = distance > 0 ? dx / distance : 1;
	const normalY = distance > 0 ? dy / distance : 0;
	position.x = arena.center.x + normalX * legalRadius;
	position.y = arena.center.y + normalY * legalRadius;
	if (velocity) {
		const outwardSpeed = velocity.x * normalX + velocity.y * normalY;
		if (outwardSpeed > 0) {
			velocity.x -= normalX * outwardSpeed;
			velocity.y -= normalY * outwardSpeed;
		}
	}
	return true;
}

export function correctArenaBoundary(
	object: BoundedObject,
	width: number,
	height: number,
	deltaSeconds: number,
): void {
	const arena = arenaCenterAndRadius(width, height);
	const legalRadius = Math.max(0, arena.radius - object.radius);
	const dx = object.position.x - arena.center.x;
	const dy = object.position.y - arena.center.y;
	const distance = Math.hypot(dx, dy);
	const inside = distance <= legalRadius;
	if (inside) {
		object.enteredArena = true;
		return;
	}
	if (!object.enteredArena) {
		const normalX = distance > 0 ? dx / distance : 1;
		const normalY = distance > 0 ? dy / distance : 0;
		const target = {
			x: arena.center.x + normalX * legalRadius,
			y: arena.center.y + normalY * legalRadius,
		};
		const correctionX = target.x - object.position.x;
		const correctionY = target.y - object.position.y;
		const correctionDistance = Math.hypot(correctionX, correctionY);
		const step = Math.min(correctionDistance, 30 * deltaSeconds);
		if (correctionDistance > 0) {
			object.position.x += (correctionX / correctionDistance) * step;
			object.position.y += (correctionY / correctionDistance) * step;
		}
		if (step === correctionDistance) object.enteredArena = true;
		return;
	}
	clampToArenaBoundary(
		object.position,
		object.radius,
		width,
		height,
		object.velocity,
	);
}
