import * as THREE from "three";
import { damageStatusDuration, distance, type Vector2 } from "./types";
import { GameObject } from "./GameObject";
import type { Hero } from "./Hero";
import type { Creep } from "./Creep";
import { Z_SWAMP } from "./render/ThreeRenderer";
import { MovementMultiplierEffect } from "../../common/unitState";

export class GroundSwamp extends GameObject {
	private remaining = 8;
	private readonly occupancy = new Map<Creep, number>();

	readonly position: Vector2;
	readonly radius: number;
	private readonly source: Hero;
	private readonly followSource: boolean;

	constructor(
		position: Vector2,
		radius: number,
		source: Hero,
		followSource = false,
	) {
		super();
		this.position = { ...position };
		this.radius = radius;
		this.source = source;
		this.followSource = followSource;

		const mainShape = new THREE.Mesh(
			new THREE.CircleGeometry(radius, 32),
			new THREE.MeshBasicMaterial({
				color: 0x152a17,
				transparent: true,
				opacity: 0.55,
				depthWrite: false,
			}),
		);
		mainShape.scale.y = 0.62;
		mainShape.rotation.z = -0.16;
		mainShape.renderOrder = Z_SWAMP;
		this.mesh.add(mainShape);

		const stroke = new THREE.Mesh(
			new THREE.RingGeometry(radius - 2, radius + 2, 32),
			new THREE.MeshBasicMaterial({
				color: 0x3e5d32,
				transparent: true,
				opacity: 0.7,
				side: THREE.DoubleSide,
				depthWrite: false,
			}),
		);
		stroke.scale.y = 0.62;
		stroke.rotation.z = -0.16;
		stroke.renderOrder = Z_SWAMP + 0.001;
		this.mesh.add(stroke);

		const decorMat = new THREE.MeshBasicMaterial({
			color: 0x192d1b,
			transparent: true,
			opacity: 0.32,
			depthWrite: false,
		});
		for (let index = 0; index < 11; index += 1) {
			const angle = index * 2.399;
			const offset = radius * (0.2 + (index % 4) * 0.16);
			const w = 11 + (index % 3) * 6;
			const h = 5 + (index % 2) * 4;
			const dot = new THREE.Mesh(
				new THREE.CircleGeometry(Math.max(w, h) / 2, 12),
				decorMat,
			);
			dot.position.set(
				Math.cos(angle) * offset,
				Math.sin(angle) * offset * 0.58,
				0.001,
			);
			dot.scale.set(w / Math.max(w, h), h / Math.max(w, h), 1);
			dot.rotation.z = angle;
			dot.renderOrder = Z_SWAMP + 0.002;
			this.mesh.add(dot);
		}

		this.mesh.renderOrder = Z_SWAMP;
	}

	update(deltaSeconds: number, creeps: readonly Creep[] = []): void {
		this.remaining -= deltaSeconds;
		if (this.remaining <= 0) {
			this.active = false;
			return;
		}
		if (this.followSource && this.source.active) {
			this.position.x = this.source.position.x;
			this.position.y = this.source.position.y;
		}
		for (const creep of creeps) {
			if (
				!creep.active ||
				distance(this.position, creep.position) > this.radius + creep.radius
			) {
				this.occupancy.delete(creep);
				continue;
			}
			let elapsed = (this.occupancy.get(creep) ?? 0) + deltaSeconds;
			while (elapsed >= 1) {
				this.applyPoison(creep);
				elapsed -= 1;
			}
			this.occupancy.set(creep, elapsed);
		}
	}

	collectEffects(creeps: readonly Creep[]): void {
		if (this.followSource && this.source.active) {
			this.position.x = this.source.position.x;
			this.position.y = this.source.position.y;
		}
		for (const creep of creeps)
			if (
				creep.active &&
				distance(this.position, creep.position) <= this.radius + creep.radius
			)
				creep.addFrameEffect(new MovementMultiplierEffect("groundSwamp", 0.5));
	}

	override updateVisuals(time: number): void {
		super.updateVisuals(time);
		this.mesh.position.set(this.position.x, this.position.y, 0);
	}

	private applyPoison(creep: Creep): void {
		const voodoo = this.source.isSkillOperational("voodoo")
			? 1 + Math.min(1.5, this.source.stats.spirit * 0.03)
			: 1;
		creep.addStatus({
			kind: "poison",
			remaining: damageStatusDuration(8),
			damagePerSecond: (0.2 + this.source.stats.spirit * 0.02) * voodoo,
			source: this.source,
		});
	}
}
