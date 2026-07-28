import * as THREE from "three";
import type { StatusEffectSnapshot } from "../types";

export function createStatusTint(
	statuses: StatusEffectSnapshot[],
	radius: number,
): THREE.Mesh | null {
	const tint = statusTint(statuses);
	if (!tint) return null;
	const geo = new THREE.CircleGeometry(radius, 24);
	const mat = new THREE.MeshBasicMaterial({
		color: tint,
		transparent: true,
		opacity: 0.42,
		depthWrite: false,
	});
	const mesh = new THREE.Mesh(geo, mat);
	mesh.renderOrder = 1;
	return mesh;
}

export function updateStatusEffects(
	_statusGroup: THREE.Group,
	statuses: StatusEffectSnapshot[],
	radius: number,
	time: number,
	bleedDots: THREE.Mesh[],
	stunRays: THREE.Line[],
): void {
	const hasBleed = statuses.some((s) => s.kind === "bleed");
	const hasStun =
		statuses.some((s) => s.kind === "stun") ||
		statuses.some((s) => s.kind === "shock");

	for (const dot of bleedDots) {
		dot.visible = hasBleed;
		if (hasBleed) {
			const idx = bleedDots.indexOf(dot);
			const angle = time * 3.7 + idx * 2.41;
			const dist = radius + 3 + ((time * 18 + idx * 5) % 7);
			dot.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist, 2);
			(dot.material as THREE.MeshBasicMaterial).opacity = 0.4 + idx * 0.12;
		}
	}

	for (const ray of stunRays) {
		ray.visible = hasStun;
		if (hasStun) {
			const idx = stunRays.indexOf(ray);
			ray.rotation.z = time * 4 + (idx * Math.PI) / 2;
		}
	}
}

function statusTint(statuses: StatusEffectSnapshot[]): string | undefined {
	if (statuses.some((s) => s.kind === "freeze")) return "#8de7ff";
	if (statuses.some((s) => s.kind === "burn")) return "#ff783d";
	if (statuses.some((s) => s.kind === "poison")) return "#92f58b";
	if (statuses.some((s) => s.kind === "curse")) return "#4b225e";
	return undefined;
}
