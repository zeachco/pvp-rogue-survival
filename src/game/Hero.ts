import * as THREE from "three";
import { Unit } from "./Unit";
import { normalize, type Vector2 } from "./types";
import type { PlayerProgress } from "../../common/protocol";
import type { RandomSource } from "../../common/random";
import { Z_HERO, Z_AURA, Z_ATTACK } from "./render/ThreeRenderer";
import { updateStatusEffects } from "./render/statusEffects";
import { auraRadius } from "../../common/auras";
import { AnimatedCharacter } from "./render/AnimatedCharacter";
import {
	BASE_HERO_TURN_SPEED_DEGREES,
	heroTurnSpeedDegrees,
} from "../../common/progression";
import {
	RAGE_DECAY_PER_SECOND,
	RAGE_GAIN_ON_BLOCK,
	RAGE_GAIN_ON_DAMAGE,
	RAGE_GAIN_ON_DODGE,
	STARTING_RAGE,
} from "../../common/combat";

export const HERO_TURN_SPEED = THREE.MathUtils.degToRad(
	BASE_HERO_TURN_SPEED_DEGREES,
);

export const AIM_RANGE_OPACITY = 0.25;
const AIM_LINE_WIDTH = 3;

export function aimGuideDimensions(range: number): {
	lineLength: number;
	lineCenter: number;
	ringRadius: number;
} {
	const safeRange = Math.max(0, range);
	return {
		lineLength: safeRange,
		lineCenter: safeRange / 2,
		ringRadius: safeRange,
	};
}

export function turnAngleTowards(
	current: number,
	target: number,
	maxDelta: number,
): number {
	const delta = Math.atan2(
		Math.sin(target - current),
		Math.cos(target - current),
	);
	if (Math.abs(delta) <= maxDelta) return target;
	return current + Math.sign(delta) * maxDelta;
}

let heroTexture: THREE.Texture | undefined;

function loadHeroTexture(): THREE.Texture | undefined {
	if (typeof document === "undefined") return undefined;
	if (heroTexture) return heroTexture;
	heroTexture = new THREE.TextureLoader().load("/assets/hero.png");
	heroTexture.colorSpace = THREE.SRGBColorSpace;
	return heroTexture;
}

export class Hero extends Unit {
	readonly maxSpeed = 235;
	readonly acceleration = 920;
	facing = 0;
	movementSpeedMultiplier = 1;
	readonly auraGroup = new THREE.Group();
	private damageFlash = false;

	private readonly bodyMesh: THREE.Mesh;
	private readonly facingMesh: THREE.Mesh;
	private readonly aimDirectionMesh: THREE.Mesh;
	private readonly aimRangeMesh: THREE.Mesh;
	private readonly statusTint: THREE.Mesh;
	private readonly animatedCharacter: AnimatedCharacter;
	private readonly bleedDots: THREE.Mesh[] = [];
	private readonly stunRays: THREE.Line[] = [];

	constructor(position: Vector2) {
		super(position, 18, 100);
		this.enteredArena = true;

		const texture = loadHeroTexture();
		const bodyGeo = texture
			? new THREE.PlaneGeometry(50, 50)
			: new THREE.CircleGeometry(18, 32);
		const bodyMat = new THREE.MeshStandardMaterial(
			texture
				? {
						map: texture,
						transparent: true,
						alphaTest: 0.02,
						depthWrite: false,
					}
				: { color: 0xdffeff },
		);
		this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
		this.bodyMesh.position.z = texture ? 25 : 18;
		this.bodyMesh.renderOrder = Z_HERO;
		this.mesh.add(this.bodyMesh);
		this.animatedCharacter = new AnimatedCharacter("hero", this.bodyMesh);
		this.mesh.add(this.animatedCharacter.root);

		const strokeGeo = new THREE.RingGeometry(16, 20, 32);
		const strokeMat = new THREE.MeshBasicMaterial({
			color: 0x3affd4,
			side: THREE.DoubleSide,
		});
		const stroke = new THREE.Mesh(strokeGeo, strokeMat);
		stroke.renderOrder = Z_HERO + 0.01;
		this.mesh.add(stroke);

		const facingGeo = new THREE.BufferGeometry();
		const facingVerts = new Float32Array([12, -6, 0, 29, 0, 0, 12, 6, 0]);
		facingGeo.setAttribute(
			"position",
			new THREE.BufferAttribute(facingVerts, 3),
		);
		const facingMat = new THREE.MeshBasicMaterial({
			color: 0x3affd4,
			side: THREE.DoubleSide,
		});
		this.facingMesh = new THREE.Mesh(facingGeo, facingMat);
		this.facingMesh.renderOrder = Z_HERO + 0.02;
		this.mesh.add(this.facingMesh);

		const aimMaterial = new THREE.MeshBasicMaterial({
			color: 0x3affd4,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		this.aimDirectionMesh = new THREE.Mesh(
			new THREE.PlaneGeometry(1, AIM_LINE_WIDTH),
			aimMaterial,
		);
		this.aimDirectionMesh.position.z = 0.08;
		this.aimDirectionMesh.renderOrder = Z_ATTACK + 0.02;
		this.aimDirectionMesh.visible = false;
		this.mesh.add(this.aimDirectionMesh);

		this.aimRangeMesh = new THREE.Mesh(
			new THREE.RingGeometry(0.995, 1, 96),
			aimMaterial.clone(),
		);
		(this.aimRangeMesh.material as THREE.MeshBasicMaterial).opacity =
			AIM_RANGE_OPACITY;
		this.aimRangeMesh.position.z = 0.07;
		this.aimRangeMesh.renderOrder = Z_ATTACK + 0.01;
		this.aimRangeMesh.visible = false;
		this.mesh.add(this.aimRangeMesh);

		const tintGeo = new THREE.CircleGeometry(18, 24);
		const tintMat = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: 0,
			depthWrite: false,
		});
		this.statusTint = new THREE.Mesh(tintGeo, tintMat);
		this.statusTint.renderOrder = Z_HERO + 0.03;
		this.mesh.add(this.statusTint);

		const bleedMat = new THREE.MeshBasicMaterial({
			color: 0xff4858,
			transparent: true,
			depthWrite: false,
		});
		for (let i = 0; i < 4; i++) {
			const dot = new THREE.Mesh(
				new THREE.CircleGeometry(1.25, 8),
				bleedMat.clone(),
			);
			dot.renderOrder = Z_HERO + 0.04;
			dot.visible = false;
			this.mesh.add(dot);
			this.bleedDots.push(dot);
		}

		const stunMat = new THREE.LineBasicMaterial({
			color: 0xffffff,
			transparent: true,
		});
		for (let i = 0; i < 4; i++) {
			const geo = new THREE.BufferGeometry();
			const verts = new Float32Array([0, -25, 0, 0, -32, 0]);
			geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
			const ray = new THREE.Line(geo, stunMat);
			ray.renderOrder = Z_HERO + 0.05;
			ray.visible = false;
			this.mesh.add(ray);
			this.stunRays.push(ray);
		}

		this.auraGroup.renderOrder = Z_AURA;

		this.mesh.renderOrder = Z_HERO;
	}

	applyProgress(progress: PlayerProgress, preserveRatio = false): void {
		const ratio = preserveRatio ? this.hp / this.maxHp : 1;
		const mana = this.mana;
		const rage = this.rage;
		this.configureStats(
			progress.stats,
			progress.offHand,
			progress.mainHand,
			progress.amulet,
			progress.charm,
		);
		this.hp = Math.max(0, this.maxHp * ratio);
		if (preserveRatio) {
			this.mana = Math.max(0, Math.min(this.maxMana, mana));
			this.rage = Math.max(0, Math.min(this.maxRage, rage));
		} else this.rage = Math.min(STARTING_RAGE, this.maxRage);
	}

	resetForRealm(): void {
		this.hp = this.maxHp;
		this.mana = this.maxMana;
		this.rage = STARTING_RAGE;
		this.statuses = [];
		this.velocity = { x: 0, y: 0 };
		this.active = true;
		this.damageSlowRemaining = 0;
		this.movementSpeedMultiplier = 1;
		this.healthRegenMultiplier = 1;
		this.healthRegenFlat = 0;
		this.lastDamageSourceId = undefined;
		this.blockCooldown = 0;
		this.blockCooldownMax = 0;
		this.reflectiveSurgeRemaining = 0;
		this.reflectiveSurgeCooldown = 0;
		this.reflectiveSurgeCooldownMax = 0;
		this.effects.length = 0;
		this.lastHitDodged = false;
		this.immunityRemaining = 0;
	}

	protected override updateRageResource(
		deltaSeconds: number,
		_regenPerSecond: number,
	): void {
		this.rage = Math.max(
			0,
			Math.min(this.maxRage, this.rage - RAGE_DECAY_PER_SECOND * deltaSeconds),
		);
	}

	protected override grantDefensiveRage(
		kind: "dodge" | "block" | "damage",
	): void {
		const amount =
			kind === "damage"
				? RAGE_GAIN_ON_DAMAGE
				: kind === "block"
					? RAGE_GAIN_ON_BLOCK
					: RAGE_GAIN_ON_DODGE;
		this.grantRage(amount);
	}

	move(
		input: Vector2,
		deltaSeconds: number,
		width: number,
		height: number,
	): void {
		const direction = normalize(input);
		this.steer(
			direction,
			this.acceleration,
			this.maxSpeed *
				this.damageMovementMultiplier *
				this.movementSpeedMultiplier,
			deltaSeconds,
		);
		this.clampToBounds(width, height);
	}

	override takeDamage(amount: number): void {
		const hpBefore = this.hp;
		super.takeDamage(amount);
		if (this.hp < hpBefore) this.damageFlash = true;
	}

	turnTowards(target: number, deltaSeconds: number): void {
		this.facing = turnAngleTowards(
			this.facing,
			target,
			THREE.MathUtils.degToRad(heroTurnSpeedDegrees(this.stats.agility)) *
				deltaSeconds,
		);
	}

	setAimGuide(aiming: boolean, weaponRange?: number): void {
		const visible = aiming && weaponRange !== undefined && weaponRange > 0;
		this.aimDirectionMesh.visible = visible;
		this.aimRangeMesh.visible = visible;
		if (!visible) return;
		const dimensions = aimGuideDimensions(weaponRange);
		this.aimDirectionMesh.position.x = dimensions.lineCenter;
		this.aimDirectionMesh.scale.x = dimensions.lineLength;
		this.aimDirectionMesh.rotation.z = this.facing;
		this.aimRangeMesh.scale.setScalar(dimensions.ringRadius);
	}

	update(deltaSeconds: number, random?: RandomSource, training = false): void {
		this.damageFloorOne = training;
		this.updateResources(deltaSeconds, random, training);
	}

	override updateVisuals(time: number): void {
		super.updateVisuals(time);
		if (!this.active && this.hp <= 0) this.mesh.visible = true;
		this.mesh.position.set(this.position.x, this.position.y, 0);
		this.facingMesh.rotation.z = this.facing;

		const flash = this.damageFlash;
		this.damageFlash = false;
		const tint = statusTint(this.statuses);
		this.animatedCharacter.update({
			time,
			facing: this.facing,
			moving: Math.hypot(this.velocity.x, this.velocity.y) > 0.01,
			attackVersion: this.presentationAttackVersion,
			attackDuration: this.presentationAttackDuration,
			hitVersion: this.presentationHitVersion,
			dead: !this.active && this.hp <= 0,
			statusTint: tint,
			flash,
			reflectiveSurge: this.reflectiveSurgeRemaining > 0,
		});
		const reflective = this.reflectiveSurgeRemaining > 0;
		const bodyMaterial = this.bodyMesh.material as THREE.MeshStandardMaterial;
		bodyMaterial.color.set(flash ? 0xffffff : reflective ? 0x3f4448 : 0xdffeff);
		const bodyMap = reflective ? null : (loadHeroTexture() ?? null);
		if (bodyMaterial.map !== bodyMap) {
			bodyMaterial.map = bodyMap;
			bodyMaterial.needsUpdate = true;
		}
		bodyMaterial.metalness = reflective ? 0.9 : 0;
		bodyMaterial.roughness = reflective ? 0.35 : 1;
		if (tint) {
			(this.statusTint.material as THREE.MeshBasicMaterial).color.set(tint);
			(this.statusTint.material as THREE.MeshBasicMaterial).opacity = 0.42;
			this.statusTint.visible = true;
		} else {
			this.statusTint.visible = false;
		}

		updateStatusEffects(
			this.mesh,
			this.statuses,
			this.radius,
			time,
			this.bleedDots,
			this.stunRays,
		);
	}

	faceCamera(cameraQuaternion: THREE.Quaternion): void {
		if (!this.animatedCharacter.modelLoaded)
			this.bodyMesh.quaternion.copy(cameraQuaternion);
	}

	updateAuraVisuals(time: number): void {
		while (this.auraGroup.children.length > 0) {
			const child = this.auraGroup.children[0];
			this.auraGroup.remove(child);
			if (child instanceof THREE.Mesh) child.geometry.dispose();
		}

		const r = (
			skill:
				| "slowAura"
				| "hinderingAura"
				| "deathBurst"
				| "sunburnAura"
				| "thunderAura",
		) => auraRadius(this.skillLevels.get(skill) ?? 1, this.stats.spirit);

		if (this.isSkillOperational("slowAura")) {
			const radius = r("slowAura");
			const fill = new THREE.Mesh(
				new THREE.CircleGeometry(radius, 32),
				new THREE.MeshBasicMaterial({
					color: 0x3282ff,
					transparent: true,
					opacity: 0.1,
					depthWrite: false,
				}),
			);
			fill.renderOrder = Z_AURA;
			this.auraGroup.add(fill);
			const ring = new THREE.Mesh(
				new THREE.RingGeometry(radius - 1.5, radius + 1.5, 32),
				new THREE.MeshBasicMaterial({
					color: 0x5ab4ff,
					transparent: true,
					opacity: 0.42,
					side: THREE.DoubleSide,
					depthWrite: false,
				}),
			);
			ring.renderOrder = Z_AURA + 0.01;
			this.auraGroup.add(ring);
		}

		if (this.isSkillOperational("hinderingAura")) {
			const scale = r("hinderingAura") / 180;
			for (let ring = 0; ring < 4; ring += 1) {
				const ringRadius =
					(45 + ring * 38 + Math.sin(time * 2 + ring) * 7) * scale;
				const m = new THREE.Mesh(
					new THREE.RingGeometry(ringRadius - 1, ringRadius + 1, 32),
					new THREE.MeshBasicMaterial({
						color: 0x64d2ff,
						transparent: true,
						opacity: 0.3,
						side: THREE.DoubleSide,
						depthWrite: false,
					}),
				);
				m.renderOrder = Z_AURA + 0.01 + ring * 0.001;
				this.auraGroup.add(m);
			}
		}

		if (this.isSkillOperational("deathBurst")) {
			const scale = r("deathBurst") / 180;
			const pts: number[] = [];
			for (let i = 0; i < 24; i += 1) {
				const a = (i * Math.PI) / 12;
				const rad = (i % 2 ? 145 : 175) * scale;
				pts.push(Math.cos(a) * rad, Math.sin(a) * rad, 0);
			}
			const geo = new THREE.BufferGeometry();
			geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
			const shape = new THREE.Mesh(
				geo,
				new THREE.MeshBasicMaterial({
					color: 0x46ff7d,
					transparent: true,
					opacity: 0.13,
					side: THREE.DoubleSide,
					depthWrite: false,
				}),
			);
			shape.renderOrder = Z_AURA;
			this.auraGroup.add(shape);
		}

		if (this.isSkillOperational("sunburnAura")) {
			const scale = r("sunburnAura") / 180;
			for (let i = 0; i < 12; i += 1) {
				const beam = new THREE.Mesh(
					new THREE.PlaneGeometry(115 * scale, 18),
					new THREE.MeshBasicMaterial({
						color: 0xff8723,
						transparent: true,
						opacity: 0.11,
						depthWrite: false,
					}),
				);
				beam.position.set(
					55 * scale * Math.cos((i * Math.PI) / 6),
					55 * scale * Math.sin((i * Math.PI) / 6),
					0,
				);
				beam.rotation.z = (i * Math.PI) / 6 + time * 0.08;
				beam.renderOrder = Z_AURA;
				this.auraGroup.add(beam);
			}
		}

		if (this.isSkillOperational("thunderAura")) {
			const radius = r("thunderAura");
			const bg = new THREE.Mesh(
				new THREE.PlaneGeometry(radius * 2, radius * 2),
				new THREE.MeshBasicMaterial({
					color: 0xffffff,
					transparent: true,
					opacity: 0.07,
					depthWrite: false,
				}),
			);
			bg.renderOrder = Z_AURA;
			this.auraGroup.add(bg);

			const pts: number[] = [];
			for (let i = 0; i < 28; i += 1) {
				const a = (i * Math.PI * 2) / 28;
				const edge = radius - 6 + Math.sin(time * 7 + i * 2.3) * 8;
				pts.push(Math.cos(a) * edge, Math.sin(a) * edge, 0);
			}
			pts.push(pts[0], pts[1], pts[2]);
			const geo = new THREE.BufferGeometry();
			geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
			const edge = new THREE.Line(
				geo,
				new THREE.LineBasicMaterial({
					color: 0xbeebff,
					transparent: true,
					opacity: 0.65,
				}),
			);
			edge.renderOrder = Z_AURA + 0.01;
			this.auraGroup.add(edge);
		}
	}
}

function statusTint(statuses: { kind: string }[]): string | undefined {
	if (statuses.some((s) => s.kind === "freeze")) return "#8de7ff";
	if (statuses.some((s) => s.kind === "burn")) return "#ff783d";
	if (statuses.some((s) => s.kind === "poison")) return "#92f58b";
	if (statuses.some((s) => s.kind === "curse")) return "#4b225e";
	return undefined;
}
