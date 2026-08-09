import * as THREE from "three";
import type { Rarity } from "../../common/items";
import type { GroundDrop } from "../../common/protocol";
import { GameObject } from "./GameObject";
import type { Vector2 } from "./types";
import { Z_DROP } from "./render/ThreeRenderer";

const GROUND_PRESENTATION_CLEARANCE = 2;
const DIAMOND_PRESENTATION_RADIUS = 18;
const COIN_RADIUS = 8;
const COIN_THICKNESS = 2.5;
export const DROP_MAX_SPEED = 90;
export const DROP_PUSH_IMPULSE = 45;
const DROP_DRAG_PER_SECOND = 5;
const ATTRACTION_ACCELERATION_MULTIPLIER = 5;
export const COIN_BOB_AMPLITUDE = 2;
export const COIN_BOB_SPEED = 2.5;
export const COIN_SPIN_SPEED = 2.8;
export const COIN_SCATTER_MULTIPLIER = 3;

export const GOLD_COIN_DENOMINATIONS = [
	{ value: 625, color: 0x42bff5 },
	{ value: 25, color: 0xf4cf42 },
	{ value: 5, color: 0xc4cbd2 },
	{ value: 1, color: 0x8b5a2b },
] as const;

export function goldCoinDenominations(amount: number): number[] {
	const coins: number[] = [];
	let remainder = Math.max(0, Math.floor(amount));
	for (const denomination of GOLD_COIN_DENOMINATIONS) {
		const count = Math.floor(remainder / denomination.value);
		for (let index = 0; index < count; index++) coins.push(denomination.value);
		remainder %= denomination.value;
	}
	return coins;
}

export function coinPresentationOffset(time: number): number {
	return Math.sin(time * COIN_BOB_SPEED) * COIN_BOB_AMPLITUDE;
}

export function groundDropPresentationCenter(drop: GroundDrop): number {
	if (drop.kind !== "gold")
		return DIAMOND_PRESENTATION_RADIUS + GROUND_PRESENTATION_CLEARANCE;
	return COIN_RADIUS + GROUND_PRESENTATION_CLEARANCE;
}

export class ItemDrop extends GameObject {
	readonly radius = 14;
	enteredArena = false;
	readonly velocity: Vector2 = { x: 0, y: 0 };
	readonly drop: GroundDrop;
	readonly position: Vector2;

	private readonly bodyMesh: THREE.Object3D;
	private readonly glowMesh?: THREE.Mesh;
	private readonly coins: THREE.Mesh[] = [];
	private readonly resourceMesh?: THREE.Group;
	private visualStartedAt?: number;

	constructor(drop: GroundDrop, position: Vector2) {
		super();
		this.drop = drop;
		this.position = { ...position };
		if (drop.kind !== "item") {
			this.mesh.userData.castShadow = false;
			this.mesh.userData.receiveShadow = false;
		}

		if (drop.kind === "gold") {
			const cluster = new THREE.Group();
			const denominations = goldCoinDenominations(drop.amount);
			for (const [index, value] of denominations.entries()) {
				const denomination = GOLD_COIN_DENOMINATIONS.find(
					(candidate) => candidate.value === value,
				);
				const geometry = new THREE.CylinderGeometry(
					COIN_RADIUS,
					COIN_RADIUS,
					COIN_THICKNESS,
					20,
				);
				geometry.rotateZ(Math.PI / 2);
				const coin = new THREE.Mesh(
					geometry,
					new THREE.MeshBasicMaterial({
						color: denomination?.color ?? 0x8b5a2b,
						side: THREE.DoubleSide,
					}),
				);
				coin.userData.goldValue = value;
				coin.userData.displacementAngle =
					deterministicFraction(drop.id, index) * Math.PI * 2;
				coin.userData.displacementSpeed =
					(8 + deterministicFraction(drop.id, index + 101) * 8) *
					COIN_SCATTER_MULTIPLIER;
				coin.userData.phase =
					deterministicFraction(drop.id, index + 211) * Math.PI * 2;
				coin.renderOrder = Z_DROP;
				this.coins.push(coin);
				cluster.add(coin);
			}
			this.bodyMesh = cluster;
			this.mesh.add(cluster);
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

			if (drop.kind === "scrap") {
				this.resourceMesh = new THREE.Group();
				this.resourceMesh.add(square, strokeSquare);
				this.bodyMesh = this.resourceMesh;
				this.mesh.add(this.glowMesh, this.resourceMesh);
			} else {
				this.bodyMesh = square;
				this.mesh.add(this.glowMesh, this.bodyMesh, strokeSquare);
			}
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
		const previousSpeed = Math.hypot(this.velocity.x, this.velocity.y);
		const acceleration = speed * ATTRACTION_ACCELERATION_MULTIPLIER;
		this.velocity.x += (dx / distance) * acceleration * deltaSeconds;
		this.velocity.y += (dy / distance) * acceleration * deltaSeconds;
		this.clampVelocity(
			previousSpeed > speed ? Math.min(previousSpeed, DROP_MAX_SPEED) : speed,
		);
	}
	applyPush(source: Vector2, impulse: number): void {
		const dx = this.position.x - source.x;
		const dy = this.position.y - source.y;
		const length = Math.hypot(dx, dy);
		if (length <= 0) return;
		this.velocity.x += (dx / length) * impulse;
		this.velocity.y += (dy / length) * impulse;
		this.clampVelocity(DROP_MAX_SPEED);
	}
	move(deltaSeconds: number): void {
		this.position.x += this.velocity.x * deltaSeconds;
		this.position.y += this.velocity.y * deltaSeconds;
		const drag = Math.exp(-DROP_DRAG_PER_SECOND * deltaSeconds);
		this.velocity.x *= drag;
		this.velocity.y *= drag;
	}
	override updateVisuals(time: number): void {
		super.updateVisuals(time);
		this.mesh.position.set(
			this.position.x,
			this.position.y,
			groundDropPresentationCenter(this.drop) +
				(this.resourceMesh ? coinPresentationOffset(time) : 0),
		);
		if (this.resourceMesh)
			this.resourceMesh.rotation.y = time * COIN_SPIN_SPEED;
		if (this.coins.length > 0) {
			this.visualStartedAt ??= time;
			const age = Math.max(0, time - this.visualStartedAt);
			for (const coin of this.coins) {
				const angle = coin.userData.displacementAngle as number;
				const speed = coin.userData.displacementSpeed as number;
				const phase = coin.userData.phase as number;
				const displacement = (speed / 4) * (1 - Math.exp(-4 * age));
				coin.position.set(
					Math.cos(angle) * displacement,
					Math.sin(angle) * displacement,
					coinPresentationOffset(time + phase / COIN_BOB_SPEED),
				);
				coin.rotation.y = time * COIN_SPIN_SPEED + phase;
			}
		}
		if (this.glowMesh) {
			const pulse = 0.3 + Math.sin(time * 3) * 0.1;
			(this.glowMesh.material as THREE.MeshBasicMaterial).opacity = pulse;
		}
	}

	faceCamera(cameraQuaternion: THREE.Quaternion): void {
		this.mesh.quaternion.copy(cameraQuaternion);
	}

	private clampVelocity(maxSpeed: number): void {
		const speed = Math.hypot(this.velocity.x, this.velocity.y);
		if (speed <= maxSpeed || speed === 0) return;
		this.velocity.x = (this.velocity.x / speed) * maxSpeed;
		this.velocity.y = (this.velocity.y / speed) * maxSpeed;
	}
}

export function pushDrops(
	drops: ItemDrop[],
	source: Vector2,
	radius: number,
	maxImpulse = DROP_PUSH_IMPULSE,
): void {
	for (const drop of drops) {
		if (!drop.active) continue;
		const distance = Math.hypot(
			drop.position.x - source.x,
			drop.position.y - source.y,
		);
		const falloff = Math.max(0, 1 - distance / radius);
		if (falloff > 0) drop.applyPush(source, maxImpulse * falloff);
	}
}

function deterministicFraction(id: string, salt: number): number {
	let hash = 2166136261 ^ salt;
	for (let index = 0; index < id.length; index++) {
		hash ^= id.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) / 0x1_0000_0000;
}

const DROP_RARITY_COLORS: Record<Rarity, string> = {
	common: "#d8e5e8",
	uncommon: "#62e88a",
	rare: "#6ca8ff",
	epic: "#ca75ff",
	unique: "#e3b52c",
};
export function dropRarityColor(rarity: Rarity): string {
	return DROP_RARITY_COLORS[rarity] ?? DROP_RARITY_COLORS.common;
}
