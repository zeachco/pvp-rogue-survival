import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { GameObject } from "./GameObject";
import { normalize, type Vector2 } from "./types";
import type { Unit } from "./Unit";
import type { DamagePresentation } from "./CombatText";
import type { ItemInstance, SkillId } from "../../common/items";
import { emittedImpactForce, type ImpactForce } from "./ImpactForce";
import { rendingThrowTargetLimit } from "../../common/combat";
import { Z_PROJECTILE } from "./render/ThreeRenderer";

export type ProjectileSkill = SkillId | "frostSpike";

export const ORBITING_HAMMER_MODEL = {
	path: "/assets/models/orbiting-hammer.glb",
	size: 34,
	height: 18,
} as const;

const modelLoader = new GLTFLoader();
let orbitingHammerModel: Promise<GLTF> | undefined;

function loadOrbitingHammerModel(): Promise<GLTF> {
	orbitingHammerModel ??= modelLoader.loadAsync(ORBITING_HAMMER_MODEL.path);
	return orbitingHammerModel;
}

export function orbitingHammerRotation(
	age: number,
	orbitAngle: number,
): { x: number; y: number; z: number } {
	return {
		x: age * 9,
		y: orbitAngle + age * 11,
		z: age * 7,
	};
}

const PROJECTILE_GROUND_CLEARANCE = 2;

export function projectilePresentationCenter(
	skill?: ProjectileSkill,
	weaponDefinitionId?: string,
): number {
	if (skill === "frostOrb") return 22 + PROJECTILE_GROUND_CLEARANCE;
	if (skill === "frostSpike") return 8 + PROJECTILE_GROUND_CLEARANCE;
	if (skill === "vampiricBoomerang") return 48 + PROJECTILE_GROUND_CLEARANCE;
	if (skill === "orbitingHammers") return 16 + PROJECTILE_GROUND_CLEARANCE;
	if (weaponDefinitionId === "throwingAxe")
		return 12 + PROJECTILE_GROUND_CLEARANCE;
	return 11 + PROJECTILE_GROUND_CLEARANCE;
}

function lowPolyStarGeometry(outerRadius: number): THREE.ExtrudeGeometry {
	const shape = new THREE.Shape();
	for (let index = 0; index < 10; index += 1) {
		const angle = -Math.PI / 2 + (index * Math.PI) / 5;
		const radius = index % 2 === 0 ? outerRadius : outerRadius * 0.42;
		const x = Math.cos(angle) * radius;
		const y = Math.sin(angle) * radius;
		if (index === 0) shape.moveTo(x, y);
		else shape.lineTo(x, y);
	}
	shape.closePath();
	const geometry = new THREE.ExtrudeGeometry(shape, {
		depth: 4,
		steps: 1,
		bevelEnabled: false,
	});
	geometry.translate(0, 0, -2);
	return geometry;
}

export class Projectile extends GameObject {
	readonly position: Vector2;
	readonly radius: number = 11;
	enteredArena = false;
	readonly velocity: Vector2;
	private lifetime = 4;
	private orbitAngle = 0;
	private orbitAge = 0;
	private orbiting = false;
	private orbitAngularDrift = 0;
	private orbitCenter?: Vector2;
	private followSource = false;
	private spikeTimer = 0;
	private readonly hitTargets = new Set<string>();
	private boomerang = false;
	private returning = false;
	private boomerangRange = 0;
	private travelled = 0;
	private damageDealt = 0;
	private healingFraction = 0;
	private boomerangDamageSeconds = 0;

	readonly force?: ImpactForce;
	readonly skill?: ProjectileSkill;
	readonly owner: "hero" | "creep";
	readonly source?: Unit;
	readonly presentation: DamagePresentation;
	readonly weapon?: ItemInstance;

	private readonly bodyMesh: THREE.Object3D;
	private readonly billboardGroup = new THREE.Group();
	private readonly hammerModelRoot = new THREE.Group();
	private hammerModelLoaded = false;

	constructor(
		start: Vector2,
		target: Vector2,
		readonly damage = 1,
		owner: "hero" | "creep" = "creep",
		skill?: ProjectileSkill,
		source?: Unit,
		presentation: DamagePresentation = { kind: "physical" },
		weapon?: ItemInstance,
		force = true,
		readonly skillLevel = 1,
	) {
		super();
		this.owner = owner;
		this.skill = skill;
		this.source = source;
		this.presentation = presentation;
		this.weapon = weapon;
		this.position = { ...start };
		const direction = normalize({
			x: target.x - start.x,
			y: target.y - start.y,
		});
		const speed =
			skill === "vampiricBoomerang"
				? 180
				: skill === "frostOrb"
					? 75
					: skill === "frostSpike"
						? 235
						: 245;
		this.velocity = { x: direction.x * speed, y: direction.y * speed };
		this.force = force
			? emittedImpactForce(
					source,
					"linear",
					start,
					this.velocity,
					skill === "vampiricBoomerang" ? 0.5 : 1,
				)
			: undefined;
		if (skill === "vampiricBoomerang") this.radius = 33;
		if (skill === "frostOrb") this.lifetime = 4;
		if (skill === "frostSpike") {
			this.lifetime = 1.2;
			this.radius = 6;
		}

		this.bodyMesh = this.createMesh();
		this.bodyMesh.renderOrder = Z_PROJECTILE;
		this.billboardGroup.add(this.bodyMesh);
		this.billboardGroup.position.z = projectilePresentationCenter(
			skill,
			weapon?.definitionId,
		);
		this.mesh.add(this.billboardGroup);
		if (skill === "orbitingHammers" && typeof document !== "undefined")
			void this.loadHammerModel();
		this.mesh.renderOrder = Z_PROJECTILE;
	}

	private createMesh(): THREE.Object3D {
		if (this.skill === "frostOrb") {
			const outerStar = new THREE.Mesh(
				lowPolyStarGeometry(18),
				new THREE.MeshStandardMaterial({
					color: 0x67c9ed,
					roughness: 0.4,
				}),
			);
			outerStar.renderOrder = Z_PROJECTILE;
			const innerStar = new THREE.Mesh(
				lowPolyStarGeometry(13),
				new THREE.MeshStandardMaterial({
					color: 0xb7efff,
					roughness: 0.3,
				}),
			);
			innerStar.position.z = 2.5;
			innerStar.renderOrder = Z_PROJECTILE + 0.001;
			const group = new THREE.Group();
			group.add(outerStar, innerStar);
			return group as unknown as THREE.Mesh;
		}

		if (this.skill === "frostSpike") {
			const mesh = new THREE.Mesh(
				new THREE.ConeGeometry(4.5, 20, 5),
				new THREE.MeshStandardMaterial({
					color: 0xbdefff,
					roughness: 0.28,
				}),
			);
			const group = new THREE.Group();
			group.add(mesh);
			return group as unknown as THREE.Mesh;
		}

		if (this.skill === "vampiricBoomerang") {
			const arc = new THREE.Mesh(
				new THREE.RingGeometry(30, 48, 20, 1, -0.9, 1.8),
				new THREE.MeshBasicMaterial({
					color: 0xff3152,
					side: THREE.DoubleSide,
				}),
			);
			arc.renderOrder = Z_PROJECTILE;
			const inner = new THREE.Mesh(
				new THREE.RingGeometry(33, 42, 20, 1, -0.9, 1.8),
				new THREE.MeshBasicMaterial({
					color: 0x850d26,
					side: THREE.DoubleSide,
				}),
			);
			inner.renderOrder = Z_PROJECTILE + 0.001;
			const group = new THREE.Group();
			group.add(arc, inner);
			return group as unknown as THREE.Mesh;
		}

		if (
			this.skill === "rendingThrow" ||
			this.weapon?.definitionId === "throwingAxe"
		) {
			const rending = this.skill === "rendingThrow";
			const handle = new THREE.Mesh(
				new THREE.PlaneGeometry(rending ? 24 : 18, rending ? 5 : 4),
				new THREE.MeshBasicMaterial({ color: rending ? 0x4f1818 : 0x8a552f }),
			);
			const bladeShape = new THREE.Shape();
			bladeShape.moveTo(2, -3);
			bladeShape.quadraticCurveTo(11, -12, 12, 0);
			bladeShape.quadraticCurveTo(11, 12, 2, 3);
			bladeShape.closePath();
			const blade = new THREE.Mesh(
				new THREE.ShapeGeometry(bladeShape),
				new THREE.MeshBasicMaterial({ color: rending ? 0xff4c55 : 0xb9c4ca }),
			);
			blade.position.x = 5;
			const group = new THREE.Group();
			if (rending) {
				const oppositeBlade = blade.clone();
				oppositeBlade.rotation.z = Math.PI;
				oppositeBlade.position.x = -5;
				const aura = new THREE.Mesh(
					new THREE.RingGeometry(14, 18, 20),
					new THREE.MeshBasicMaterial({
						color: 0xc4142f,
						transparent: true,
						opacity: 0.38,
						side: THREE.DoubleSide,
					}),
				);
				aura.name = "rending-aura";
				group.add(aura, handle, blade, oppositeBlade);
			} else group.add(handle, blade);
			return group as unknown as THREE.Mesh;
		}

		if (this.skill === "orbitingHammers") {
			const handle = new THREE.Mesh(
				new THREE.PlaneGeometry(5, 28),
				new THREE.MeshBasicMaterial({ color: 0x8a552f }),
			);
			const head = new THREE.Mesh(
				new THREE.PlaneGeometry(22, 10),
				new THREE.MeshBasicMaterial({ color: 0xd8c078 }),
			);
			head.position.y = 11;
			const group = new THREE.Group();
			group.add(handle, head);
			return group;
		}

		const defaultMesh = new THREE.Mesh(
			new THREE.CircleGeometry(this.radius, 16),
			new THREE.MeshBasicMaterial({
				color: 0x8fd5ff,
				transparent: true,
				opacity: 0.72,
			}),
		);
		const highlight = new THREE.Mesh(
			new THREE.CircleGeometry(3, 8),
			new THREE.MeshBasicMaterial({
				color: 0xffffff,
				transparent: true,
				opacity: 0.75,
			}),
		);
		highlight.position.set(-3, -4, 0.01);
		const group = new THREE.Group();
		group.add(defaultMesh, highlight);
		return group as unknown as THREE.Mesh;
	}

	private async loadHammerModel(): Promise<void> {
		try {
			const gltf = await loadOrbitingHammerModel();
			const model = gltf.scene.clone(true);
			model.rotation.x = Math.PI / 2;
			model.updateMatrixWorld(true);
			let box = new THREE.Box3().setFromObject(model);
			const size = box.getSize(new THREE.Vector3());
			model.scale.setScalar(
				ORBITING_HAMMER_MODEL.size / Math.max(size.x, size.y, size.z, 0.001),
			);
			model.updateMatrixWorld(true);
			box = new THREE.Box3().setFromObject(model);
			const center = box.getCenter(new THREE.Vector3());
			model.position.set(-center.x, -center.y, -center.z);
			model.traverse((object) => {
				if (!(object instanceof THREE.Mesh)) return;
				object.renderOrder = Z_PROJECTILE;
				object.frustumCulled = false;
			});
			this.hammerModelRoot.position.z = ORBITING_HAMMER_MODEL.height;
			this.hammerModelRoot.add(model);
			this.mesh.add(this.hammerModelRoot);
			this.hammerModelLoaded = true;
			this.billboardGroup.visible = false;
		} catch {
			this.billboardGroup.visible = true;
		}
	}

	static orbitingHammer(
		source: Unit,
		angle: number,
		damage: number,
		presentation: DamagePresentation,
		angularDrift = 0,
		lifetime = 2.4,
		followSource = false,
	): Projectile {
		const projectile = new Projectile(
			source.position,
			source.position,
			damage,
			"hero",
			"orbitingHammers",
			source,
			presentation,
			undefined,
			false,
		);
		projectile.orbiting = true;
		projectile.orbitCenter = { ...source.position };
		projectile.orbitAngle = angle;
		projectile.orbitAngularDrift = angularDrift;
		projectile.orbitAge = 0;
		projectile.lifetime = lifetime;
		projectile.followSource = followSource;
		projectile.position.x = source.position.x + Math.cos(angle) * 28;
		projectile.position.y = source.position.y + Math.sin(angle) * 28;
		return projectile;
	}
	static vampiricBoomerang(
		source: Unit,
		target: Vector2,
		damage: number,
		range: number,
		healingFraction: number,
		weapon: ItemInstance,
	): Projectile {
		const projectile = new Projectile(
			source.position,
			target,
			damage,
			"hero",
			"vampiricBoomerang",
			source,
			{ kind: "physical" },
			weapon,
		);
		projectile.boomerang = true;
		projectile.boomerangRange = range;
		projectile.healingFraction = healingFraction;
		projectile.lifetime = 30;
		return projectile;
	}
	emitFrostSpikes(deltaSeconds: number): Projectile[] {
		if (this.skill !== "frostOrb" || !this.active) return [];
		this.spikeTimer -= deltaSeconds;
		if (this.spikeTimer > 0) return [];
		this.spikeTimer = 0.45;
		return Array.from({ length: 8 }, (_, index) => {
			const angle = (index * Math.PI) / 4;
			return new Projectile(
				this.position,
				{
					x: this.position.x + Math.cos(angle),
					y: this.position.y + Math.sin(angle),
				},
				this.damage,
				"hero",
				"frostSpike",
				this.source,
				this.presentation,
				this.weapon,
			);
		});
	}
	canHit(targetId: string): boolean {
		return this.boomerang || !this.hitTargets.has(targetId);
	}
	markHit(targetId: string): void {
		if (!this.boomerang) this.hitTargets.add(targetId);
	}
	get remainingTargetHits(): number {
		if (this.skill !== "rendingThrow") return 1;
		return Math.max(
			0,
			rendingThrowTargetLimit(this.skillLevel) - this.hitTargets.size,
		);
	}
	recordDamage(amount: number): void {
		if (this.boomerang) this.damageDealt += Math.max(0, amount);
	}
	get overlapDamageSeconds(): number {
		return this.boomerangDamageSeconds;
	}
	finishOverlapDamage(): void {
		this.boomerangDamageSeconds = 0;
	}

	update(deltaSeconds: number): void {
		if (this.orbiting && this.orbitCenter) {
			if (this.followSource && this.source) {
				this.orbitCenter.x = this.source.position.x;
				this.orbitCenter.y = this.source.position.y;
			}
			this.orbitAge += deltaSeconds;
			this.orbitAngle += deltaSeconds * (5.2 + this.orbitAngularDrift);
			const radius = 28 + Math.min(1, this.orbitAge / 2.4) * 162;
			this.position.x = this.orbitCenter.x + Math.cos(this.orbitAngle) * radius;
			this.position.y = this.orbitCenter.y + Math.sin(this.orbitAngle) * radius;
		} else if (this.boomerang) {
			const speed = 180;
			if (!this.returning) {
				const step = speed * deltaSeconds;
				this.position.x += this.velocity.x * deltaSeconds;
				this.position.y += this.velocity.y * deltaSeconds;
				this.travelled += step;
				if (this.travelled >= this.boomerangRange) {
					this.returning = true;
					this.hitTargets.clear();
				}
			} else if (this.source?.active) {
				const dx = this.source.position.x - this.position.x;
				const dy = this.source.position.y - this.position.y;
				const distance = Math.hypot(dx, dy);
				const step = speed * deltaSeconds;
				if (distance <= step + this.source.radius) {
					this.source.heal(this.damageDealt * this.healingFraction);
					this.active = false;
				} else {
					this.position.x += (dx / distance) * step;
					this.position.y += (dy / distance) * step;
				}
			} else this.active = false;
		} else {
			this.position.x += this.velocity.x * deltaSeconds;
			this.position.y += this.velocity.y * deltaSeconds;
		}
		if (this.boomerang && this.active)
			this.boomerangDamageSeconds = deltaSeconds;
		this.lifetime -= deltaSeconds;
		if (this.lifetime <= 0) this.active = false;
	}

	override updateVisuals(time: number): void {
		super.updateVisuals(time);
		this.mesh.position.set(this.position.x, this.position.y, 0);

		if (this.skill === "frostOrb") {
			this.bodyMesh.children[0].rotation.z = time * 1.4;
			this.bodyMesh.children[1].rotation.z = -time * 2.1;
		} else if (this.skill === "frostSpike") {
			this.bodyMesh.rotation.z =
				Math.atan2(this.velocity.y, this.velocity.x) - Math.PI / 2;
		} else if (this.skill === "orbitingHammers") {
			this.bodyMesh.rotation.z = this.orbitAngle + this.orbitAge * 7;
			const rotation = orbitingHammerRotation(this.orbitAge, this.orbitAngle);
			this.hammerModelRoot.rotation.set(rotation.x, rotation.y, rotation.z);
		} else if (this.skill === "vampiricBoomerang") {
			this.bodyMesh.rotation.z =
				Math.atan2(this.velocity.y, this.velocity.x) + this.lifetime * 10;
		} else if (this.skill === "rendingThrow") {
			this.bodyMesh.rotation.z =
				Math.atan2(this.velocity.y, this.velocity.x) + time * 14;
			const aura = this.bodyMesh.getObjectByName("rending-aura");
			if (aura) {
				const pulse = 0.9 + 0.14 * (0.5 + 0.5 * Math.sin(time * 12));
				aura.scale.setScalar(pulse);
			}
		} else if (this.weapon?.definitionId === "throwingAxe") {
			this.bodyMesh.rotation.z =
				Math.atan2(this.velocity.y, this.velocity.x) + this.lifetime * 11;
		}
	}

	faceCamera(cameraQuaternion: THREE.Quaternion): void {
		if (
			this.skill !== "frostOrb" &&
			this.skill !== "frostSpike" &&
			!this.hammerModelLoaded
		)
			this.billboardGroup.quaternion.copy(cameraQuaternion);
	}
}
