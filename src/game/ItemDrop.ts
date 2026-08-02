import * as THREE from "three";
import type { Rarity } from "../../common/items";
import type { GroundDrop } from "../../common/protocol";
import { GameObject } from "./GameObject";
import type { Vector2 } from "./types";
import { Z_DROP } from "./render/ThreeRenderer";

export const GROUND_RESOURCE_PRESENTATION_HEIGHT = 50;

export class ItemDrop extends GameObject {
	readonly radius = 14;
	enteredArena = false;
	readonly velocity: Vector2 = { x: 0, y: 0 };
	escaping = false;
	readonly drop: GroundDrop;
	readonly position: Vector2;

	private readonly bodyMesh: THREE.Mesh;
	private readonly glowMesh?: THREE.Mesh;

	constructor(drop: GroundDrop, position: Vector2) {
		super();
		this.drop = drop;
		this.position = { ...position };

		if (drop.kind === "gold") {
			const color = 0xf4cf42;
			this.bodyMesh = new THREE.Mesh(
				new THREE.CircleGeometry(10, 16),
				new THREE.MeshBasicMaterial({ color }),
			);
			const stroke = new THREE.Mesh(
				new THREE.RingGeometry(9, 11, 16),
				new THREE.MeshBasicMaterial({
					color: 0xfff0a0,
					side: THREE.DoubleSide,
				}),
			);
			stroke.renderOrder = 0.001;
			this.glowMesh = new THREE.Mesh(
				new THREE.CircleGeometry(16, 16),
				new THREE.MeshBasicMaterial({
					color,
					transparent: true,
					opacity: 0.35,
					depthWrite: false,
				}),
			);
			this.glowMesh.renderOrder = -0.001;
			this.mesh.add(this.glowMesh, this.bodyMesh, stroke);
		} else {
			const rarity: Rarity =
				drop.kind === "item" ? drop.item.rarity : drop.rarity;
			const colorHex = dropRarityColor(rarity);
			const color = Number.parseInt(colorHex.replace("#", ""), 16);

			const square = new THREE.Mesh(
				new THREE.PlaneGeometry(18, 18),
				new THREE.MeshBasicMaterial({
					color,
					transparent: drop.kind === "scrap",
					opacity: drop.kind === "scrap" ? 0 : 1,
				}),
			);
			square.rotation.z = Math.PI / 4;
			square.renderOrder = 0;

			const strokeSquare = new THREE.LineSegments(
				new THREE.EdgesGeometry(new THREE.PlaneGeometry(18, 18)),
				new THREE.LineBasicMaterial({ color }),
			);
			strokeSquare.rotation.z = Math.PI / 4;
			strokeSquare.renderOrder = 0.001;

			this.glowMesh = new THREE.Mesh(
				new THREE.CircleGeometry(18, 16),
				new THREE.MeshBasicMaterial({
					color,
					transparent: true,
					opacity: 0.35,
					depthWrite: false,
				}),
			);
			this.glowMesh.renderOrder = -0.001;

			this.bodyMesh = square;
			this.mesh.add(this.glowMesh, this.bodyMesh, strokeSquare);
		}

		this.bodyMesh.renderOrder = Z_DROP;
		this.mesh.renderOrder = Z_DROP;
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

	override updateVisuals(time: number): void {
		super.updateVisuals(time);
		this.mesh.position.set(
			this.position.x,
			this.position.y,
			this.drop.kind === "item" ? 0 : GROUND_RESOURCE_PRESENTATION_HEIGHT,
		);
		if (this.glowMesh) {
			const pulse = 0.3 + Math.sin(time * 3) * 0.1;
			(this.glowMesh.material as THREE.MeshBasicMaterial).opacity = pulse;
		}
	}

	faceCamera(cameraQuaternion: THREE.Quaternion): void {
		this.mesh.quaternion.copy(cameraQuaternion);
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
