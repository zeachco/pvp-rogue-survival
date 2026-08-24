import * as THREE from "three";
import { voodooPoisonMultiplier } from "../../common/combat";
import { MovementMultiplierEffect } from "../../common/unitState";
import type { Creep } from "./Creep";
import { GameObject } from "./GameObject";
import type { Hero } from "./Hero";
import { Z_SWAMP } from "./render/ThreeRenderer";
import { damageStatusDuration, distanceSquared, type Vector2 } from "./types";

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
		mainShape.renderOrder = Z_SWAMP;
		this.mesh.add(mainShape);

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
				distanceSquared(this.position, creep.position) >
					(this.radius + creep.radius) ** 2
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
				distanceSquared(this.position, creep.position) <=
					(this.radius + creep.radius) ** 2
			)
				creep.addFrameEffect(new MovementMultiplierEffect("groundSwamp", 0.5));
	}

	override updateVisuals(time: number): void {
		super.updateVisuals(time);
		this.mesh.position.set(this.position.x, this.position.y, 0);
	}

	private applyPoison(creep: Creep): void {
		const voodoo = this.source.isSkillOperational("voodoo")
			? voodooPoisonMultiplier(
					this.source.skillLevels.get("voodoo") ?? 1,
					this.source.stats.spirit,
				)
			: 1;
		creep.addStatus({
			kind: "poison",
			remaining: damageStatusDuration(8),
			damagePerSecond: (0.2 + this.source.stats.spirit * 0.02) * voodoo,
			source: this.source,
		});
	}
}
