import type { Vector2 } from "../types";

export const UNIT_COLLISION_PASSES = 16;

export interface SolidUnitCollider {
	position: Vector2;
	radius: number;
	velocity: Vector2;
}

export function resolveUnitCollisions(
	units: readonly SolidUnitCollider[],
	constrain: (unit: SolidUnitCollider) => void = () => {},
): boolean {
	let collided = false;
	for (let pass = 0; pass < UNIT_COLLISION_PASSES; pass += 1) {
		for (const unit of units) constrain(unit);
		for (let firstIndex = 0; firstIndex < units.length; firstIndex += 1) {
			const first = units[firstIndex];
			for (
				let secondIndex = firstIndex + 1;
				secondIndex < units.length;
				secondIndex += 1
			) {
				const second = units[secondIndex];
				const minimumDistance = first.radius + second.radius;
				const dx = second.position.x - first.position.x;
				const dy = second.position.y - first.position.y;
				const distanceSquared = dx * dx + dy * dy;
				if (distanceSquared >= minimumDistance * minimumDistance) continue;

				collided = true;
				const distance = Math.sqrt(distanceSquared);
				const normal =
					distance > 0
						? { x: dx / distance, y: dy / distance }
						: coincidentNormal(firstIndex, secondIndex);
				const correction = (minimumDistance - distance) / 2;
				first.position.x -= normal.x * correction;
				first.position.y -= normal.y * correction;
				second.position.x += normal.x * correction;
				second.position.y += normal.y * correction;

				const firstNormalSpeed =
					first.velocity.x * normal.x + first.velocity.y * normal.y;
				const secondNormalSpeed =
					second.velocity.x * normal.x + second.velocity.y * normal.y;
				const closingSpeed = firstNormalSpeed - secondNormalSpeed;
				if (closingSpeed > 0) {
					const sharedChange = closingSpeed / 2;
					first.velocity.x -= normal.x * sharedChange;
					first.velocity.y -= normal.y * sharedChange;
					second.velocity.x += normal.x * sharedChange;
					second.velocity.y += normal.y * sharedChange;
				}
			}
		}
	}
	for (const unit of units) constrain(unit);
	return collided;
}

function coincidentNormal(firstIndex: number, secondIndex: number): Vector2 {
	const angle =
		((firstIndex + 1) * 0.754877666 + (secondIndex + 1) * 0.569840291) *
		Math.PI *
		2;
	return { x: Math.cos(angle), y: Math.sin(angle) };
}
