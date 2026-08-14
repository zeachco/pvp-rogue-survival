import * as THREE from "three";
import type { RandomSource } from "../../common/random";
import type { Creep } from "./Creep";
import { GameObject } from "./GameObject";
import type { Hero } from "./Hero";
import { distance, type Vector2 } from "./types";

const ICICLE_FALL_TIME = 0.35;
const ICICLE_START_HEIGHT = 110;
export const BLIZZARD_ICICLES_PER_VOLLEY = 12;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export class Blizzard extends GameObject {
	private remaining: number;
	private untilNextImpact = 0;
	private readonly icicles: {
		mesh: THREE.Mesh;
		remaining: number;
		delay: number;
		damaging: boolean;
	}[] = [];
	private volleyIndex = 0;

	constructor(
		readonly position: Vector2,
		readonly radius: number,
		duration: number,
		private readonly projectilesPerSecond: number,
		private readonly damage: number,
		private readonly source: Hero,
		private readonly critical: boolean,
	) {
		super();
		this.remaining = duration;
		const area = new THREE.Mesh(
			new THREE.RingGeometry(Math.max(1, radius - 2), radius, 48),
			new THREE.MeshBasicMaterial({
				color: 0x8de7ff,
				transparent: true,
				opacity: 0.42,
				depthWrite: false,
				side: THREE.DoubleSide,
			}),
		);
		area.position.z = 0.5;
		this.mesh.add(area);
	}

	update(
		deltaSeconds: number,
		creeps: readonly Creep[] = [],
		random?: RandomSource,
	): void {
		this.remaining -= deltaSeconds;
		this.untilNextImpact -= deltaSeconds;
		while (this.remaining > 0 && this.untilNextImpact <= 0) {
			this.spawnIcicle();
			this.untilNextImpact += 1 / this.projectilesPerSecond;
		}
		for (let index = this.icicles.length - 1; index >= 0; index -= 1) {
			const icicle = this.icicles[index];
			let fallDelta = deltaSeconds;
			if (icicle.delay > 0) {
				icicle.delay -= deltaSeconds;
				if (icicle.delay > 0) continue;
				fallDelta = -icicle.delay;
				icicle.delay = 0;
				icicle.mesh.visible = true;
			}
			icicle.remaining -= fallDelta;
			icicle.mesh.position.z =
				ICICLE_START_HEIGHT * Math.max(0, icicle.remaining / ICICLE_FALL_TIME);
			if (icicle.remaining > 0) continue;
			this.mesh.remove(icicle.mesh);
			this.icicles.splice(index, 1);
			if (random && icicle.damaging) this.impact(creeps, random);
		}
		if (this.remaining <= 0 && this.icicles.length === 0) this.active = false;
	}

	override updateVisuals(time: number): void {
		super.updateVisuals(time);
		this.mesh.position.set(this.position.x, this.position.y, 0);
	}

	private spawnIcicle(): void {
		const releaseInterval = 1 / this.projectilesPerSecond;
		for (let index = 0; index < BLIZZARD_ICICLES_PER_VOLLEY; index += 1) {
			const mesh = new THREE.Mesh(
				new THREE.ConeGeometry(7, 30, 5),
				new THREE.MeshBasicMaterial({ color: 0xb7efff }),
			);
			const sequence = this.volleyIndex * BLIZZARD_ICICLES_PER_VOLLEY + index;
			const angle = sequence * GOLDEN_ANGLE;
			const spread =
				this.radius * Math.sqrt((index + 0.5) / BLIZZARD_ICICLES_PER_VOLLEY);
			mesh.name = "blizzard-icicle";
			mesh.rotation.x = -Math.PI / 2;
			mesh.position.set(
				Math.cos(angle) * spread,
				Math.sin(angle) * spread,
				ICICLE_START_HEIGHT,
			);
			const delay = (releaseInterval * index) / BLIZZARD_ICICLES_PER_VOLLEY;
			mesh.visible = delay === 0;
			this.mesh.add(mesh);
			this.icicles.push({
				mesh,
				remaining: ICICLE_FALL_TIME,
				delay,
				damaging: index === 0,
			});
		}
		this.volleyIndex += 1;
	}

	private impact(creeps: readonly Creep[], random: RandomSource): void {
		for (const creep of creeps) {
			if (
				!creep.active ||
				distance(this.position, creep.position) > this.radius + creep.radius
			)
				continue;
			creep.receiveDamage(this.damage, random, this.source, false, false, {
				kind: "cold",
				critical: this.critical,
			});
			creep.addStatus({
				kind: "freeze",
				remaining: 4,
				damagePerSecond: 0,
				source: this.source,
			});
		}
	}
}
