import * as THREE from "three";
import { HEALING_MIN_RADIUS } from "../../common/combat";
import type { SkillId } from "../../common/items";
import { GameObject } from "./GameObject";
import { CHARACTER_MODEL_MANIFESTS } from "./render/AnimatedCharacter";
import { Z_EFFECT } from "./render/ThreeRenderer";
import type { Vector2 } from "./types";

export type SpellEffectKind =
	| Exclude<SkillId, "healing">
	| "healing"
	| "arcaneBoltExplosion";

export const ELBO_HEIGHT = 0.8;
export const FORCE_FIELD_ANIMATION_DURATION = 0.9;
export const FORCE_FIELD_LIGHT_FADE_DURATION = 1;
export const FORCE_FIELD_LIGHT_INTENSITY = 45;
export const HEALING_GROUND_DURATION = 1;
export const HEALING_LIGHT_LINGER_DURATION = 1;
export const HEALING_UPLIGHT_INTENSITY = 320;
export const HEALING_AURA_FILL_MAX_OPACITY = 0.1;
export const HEALING_AURA_RING_MAX_OPACITY = 0.55;
export const HOSTILE_SPELL_COLOR = 0xff334f;
export const HERO_BLOOD_SPELL_COLOR = 0x9b5cff;
export const THUNDER_IMPACT_DURATION = 1.5;
export const THUNDER_IMPACT_LIGHT_INTENSITY = 180;
export const THUNDER_IMPACT_LIGHT_COLOR = 0xfafaff;
export const THUNDER_IMPACT_LIGHT_OFFSET = 18;
export const DEATH_BURST_LIGHT_INTENSITY = 240;
export const DEATH_BURST_EXPANSION_DURATION = 0.45;
export const DEATH_BURST_DURATION = 3;

export function deathBurstExpansion(progress: number): number {
	return Math.min(
		1,
		Math.max(0, progress) *
			(DEATH_BURST_DURATION / DEATH_BURST_EXPANSION_DURATION),
	);
}

export function elbowHeight(modelHeight: number): number {
	return Math.max(0, modelHeight) * ELBO_HEIGHT;
}

export function rentSlashAngle(progress: number): number {
	return Math.PI / 4 - Math.max(0, Math.min(1, progress)) * Math.PI * 2;
}

export function spellEffectLightColor(
	kind: SpellEffectKind,
): number | undefined {
	if (
		kind === "arcaneBolt" ||
		kind === "frostOrb" ||
		kind === "orbitingHammers" ||
		kind === "rendingThrow" ||
		kind === "vampiricBoomerang" ||
		kind === "swamp" ||
		kind === "blizzard"
	)
		return undefined;
	if (kind === "arcaneBoltExplosion") return 0x73d7ff;
	if (kind === "rent") return HERO_BLOOD_SPELL_COLOR;
	if (kind === "healing" || kind === "rapidRegen") return 0x68ff9c;
	if (kind === "fireBreath") return 0xff5a24;
	if (kind === "gravityPull") return 0xb98cff;
	if (kind === "reflectiveSurge") return 0xffe46b;
	if (kind === "thunderAura") return THUNDER_IMPACT_LIGHT_COLOR;
	if (kind === "deathBurst") return 0xff1838;
	if (kind === "whirlwind") return 0xd8f4ff;
	if (kind === "flurry") return 0xd9c2ff;
	if (kind === "sweep") return 0xbafcff;
	if (kind === "cleave") return 0xffcf76;
	if (kind === "bash" || kind === "shockwave") return 0xe7c889;
	return 0xddeeff;
}

export function spellEffectLightDistance(
	kind: SpellEffectKind,
	radius: number,
): number {
	const presentationRadius =
		radius > 0 ? radius : kind === "rapidRegen" ? 55 : HEALING_MIN_RADIUS;
	return presentationRadius * 2;
}

export class SpellEffect extends GameObject {
	private age = 0;
	private readonly lifetime: number;
	readonly position: Vector2;
	readonly kind: SpellEffectKind;
	readonly facing: number;
	private readonly range: number;
	private readonly source?: { position: Vector2 };

	private readonly effectGroup: THREE.Group;
	readonly heroOwned: boolean;

	constructor(
		kind: SpellEffectKind,
		position: Vector2,
		facing = 0,
		range = 0,
		lifetime?: number,
		source?: { position: Vector2 },
		heroOwned = false,
	) {
		super();
		this.kind = kind;
		this.position = { ...position };
		this.facing = facing;
		this.range = range;
		this.source = source;
		this.heroOwned = heroOwned;
		this.lifetime =
			lifetime ??
			(kind === "healing"
				? HEALING_GROUND_DURATION + HEALING_LIGHT_LINGER_DURATION
				: kind === "arcaneBolt" || kind === "arcaneBoltExplosion"
					? 0.65
					: kind === "orbitingHammers"
						? 0.8
						: kind === "rent"
							? 0.7
							: kind === "gravityPull"
								? FORCE_FIELD_ANIMATION_DURATION +
									FORCE_FIELD_LIGHT_FADE_DURATION
								: 0.55);

		this.effectGroup = new THREE.Group();
		if (kind === "rent" || kind === "whirlwind")
			this.effectGroup.position.z = elbowHeight(
				CHARACTER_MODEL_MANIFESTS.hero.footprint,
			);
		this.effectGroup.renderOrder = Z_EFFECT;
		this.mesh.add(this.effectGroup);
		this.mesh.renderOrder = Z_EFFECT;
	}

	update(deltaSeconds: number): void {
		this.age += deltaSeconds;
		if (this.source) {
			this.position.x = this.source.position.x;
			this.position.y = this.source.position.y;
		}
		if (this.age >= this.lifetime) this.active = false;
	}

	lightIntensity(time: number): number {
		if (!this.heroOwned) return 0;
		if (this.kind === "thunderAura")
			return (
				THUNDER_IMPACT_LIGHT_INTENSITY *
				(1 - Math.min(1, this.age / THUNDER_IMPACT_DURATION))
			);
		if (this.kind === "deathBurst")
			return DEATH_BURST_LIGHT_INTENSITY * (1 - Math.min(1, this.age / 0.45));
		if (this.kind === "healing") return healingUplightIntensity(this.age);
		if (this.source) return 16 + 6 * (0.5 + 0.5 * Math.sin(time * 7));
		if (this.kind === "gravityPull")
			return this.age >=
				FORCE_FIELD_ANIMATION_DURATION + FORCE_FIELD_LIGHT_FADE_DURATION
				? 0
				: FORCE_FIELD_LIGHT_INTENSITY *
						Math.max(
							0,
							1 -
								Math.max(0, this.age - FORCE_FIELD_ANIMATION_DURATION) /
									FORCE_FIELD_LIGHT_FADE_DURATION,
						);
		return (
			(this.kind === "arcaneBoltExplosion" ? 90 : 20) *
			(1 - Math.min(1, this.age / this.lifetime))
		);
	}

	lightDistance(): number {
		return spellEffectLightDistance(this.kind, this.range);
	}

	override updateVisuals(_time: number): void {
		super.updateVisuals(_time);
		const animationDuration =
			this.kind === "gravityPull"
				? FORCE_FIELD_ANIMATION_DURATION
				: this.kind === "healing"
					? HEALING_GROUND_DURATION
					: this.lifetime;
		const progress = Math.min(1, this.age / animationDuration);
		while (this.effectGroup.children.length > 0) {
			const child = this.effectGroup.children[0];
			this.effectGroup.remove(child);
			if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
				child.geometry.dispose();
				if (child.material instanceof THREE.Material) child.material.dispose();
			} else if (child instanceof THREE.Sprite) {
				child.material.dispose();
			}
		}

		this.mesh.position.set(this.position.x, this.position.y, 0);
		this.mesh.rotation.z = this.facing;

		if (this.kind === "bash") {
			impact(this.effectGroup, progress, "#e7c889", 76, 8);
		} else if (this.kind === "sweep") {
			crescent(this.effectGroup, progress);
		} else if (this.kind === "flurry") {
			flurry(this.effectGroup, progress);
		} else if (this.kind === "shockwave") {
			shockwave(this.effectGroup, progress);
		} else if (this.kind === "cleave") {
			cleave(this.effectGroup, progress);
		} else if (this.kind === "orbitingHammers") {
			hammerCast(this.effectGroup, progress);
		} else if (this.kind === "arcaneBolt") {
			arcane(this.effectGroup, progress);
		} else if (this.kind === "arcaneBoltExplosion") {
			impact(this.effectGroup, progress, "#73d7ff", this.range, 18);
		} else if (this.kind === "gravityPull") {
			impact(this.effectGroup, progress, "#b98cff", 180, 12);
		} else if (this.kind === "frostOrb") {
			impact(this.effectGroup, progress, "#8de7ff", 70, 10);
		} else if (this.kind === "reflectiveSurge") {
			impact(this.effectGroup, progress, "#ffe46b", 55, 8);
		} else if (this.kind === "fireBreath") {
			fireBreath(this.effectGroup, progress);
		} else if (this.kind === "rent") {
			rentEdge(this.effectGroup, progress, this.range, this.heroOwned);
		} else if (this.kind === "whirlwind") {
			whirlwind(this.effectGroup, progress, this.range, _time);
		} else if (this.kind === "healing") {
			healing(this.effectGroup, progress, this.range || HEALING_MIN_RADIUS);
		} else if (this.kind === "rapidRegen") {
			impact(this.effectGroup, progress, "#68ff9c", 55, 6);
		} else if (this.kind === "thunderAura") {
			thunderImpact(this.effectGroup, progress, this.range);
		} else if (this.kind === "deathBurst") {
			deathBurst(this.effectGroup, progress, this.range);
		}
		if (!this.heroOwned) tintSpellObject(this.effectGroup, HOSTILE_SPELL_COLOR);
	}
}

function deathBurst(
	group: THREE.Group,
	progress: number,
	radius: number,
): void {
	const expansion = deathBurstExpansion(progress);
	const stain = new THREE.Mesh(
		new THREE.CircleGeometry(radius * expansion, 48),
		new THREE.MeshBasicMaterial({
			color: 0x8f071b,
			transparent: true,
			opacity: 0.42 * (1 - progress),
			side: THREE.DoubleSide,
			depthWrite: false,
		}),
	);
	stain.name = "death-burst-stain";
	stain.renderOrder = Z_EFFECT;
	group.add(stain);

	const particleMaterial = new THREE.MeshBasicMaterial({
		color: 0xff1838,
		transparent: true,
		opacity: 1 - progress,
		depthWrite: false,
	});
	for (let index = 0; index < 18; index += 1) {
		const angle = index * 2.399;
		const distance = radius * expansion * (0.35 + (index % 4) * 0.14);
		const particle = new THREE.Mesh(
			new THREE.CircleGeometry(2 + (index % 3), 8),
			particleMaterial,
		);
		particle.name = `death-burst-particle-${index}`;
		particle.position.set(
			Math.cos(angle) * distance,
			Math.sin(angle) * distance,
			2 + Math.sin(Math.PI * progress) * (10 + (index % 5) * 3),
		);
		particle.renderOrder = Z_EFFECT + 0.001;
		group.add(particle);
	}
}

function thunderImpact(
	group: THREE.Group,
	progress: number,
	radius: number,
): void {
	for (let arc = 0; arc < 6; arc += 1) {
		const angle = (arc * Math.PI * 2) / 6 + arc * 0.19;
		const points: number[] = [];
		for (let step = 0; step <= 5; step += 1) {
			const inward = step / 5;
			const distance = radius * (1 - inward);
			const jitter =
				step === 0 || step === 5 ? 0 : ((arc + step) % 2 ? 1 : -1) * 7;
			points.push(
				Math.cos(angle) * distance + Math.cos(angle + Math.PI / 2) * jitter,
				Math.sin(angle) * distance + Math.sin(angle + Math.PI / 2) * jitter,
				0.75,
			);
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(points, 3),
		);
		const line = new THREE.Line(
			geometry,
			new THREE.LineBasicMaterial({
				color: 0xbef5ff,
				transparent: true,
				opacity: 1 - progress,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			}),
		);
		line.name = `thunder-impact-arc-${arc}`;
		line.renderOrder = Z_EFFECT;
		group.add(line);
	}
}

export function tintSpellObject(object: THREE.Object3D, color: number): void {
	object.traverse((child) => {
		if (!(child instanceof THREE.Mesh || child instanceof THREE.Line)) return;
		const materials = Array.isArray(child.material)
			? child.material
			: [child.material];
		for (const material of materials) {
			if ("color" in material && material.color instanceof THREE.Color)
				material.color.setHex(color);
			if ("emissive" in material && material.emissive instanceof THREE.Color)
				material.emissive.setHex(color);
		}
	});
}

function hexToThree(hex: string): number {
	return Number.parseInt(hex.replace("#", ""), 16);
}

function impact(
	group: THREE.Group,
	progress: number,
	color: string,
	radius: number,
	particles: number,
): void {
	const colorVal = hexToThree(color);
	const ringRadius = 18 + radius * progress;
	const ring = new THREE.Mesh(
		new THREE.RingGeometry(ringRadius - 2.5, ringRadius + 2.5, 32),
		new THREE.MeshBasicMaterial({
			color: colorVal,
			transparent: true,
			opacity: 1 - progress,
			side: THREE.DoubleSide,
			depthWrite: false,
		}),
	);
	ring.renderOrder = Z_EFFECT;
	group.add(ring);

	const dotMat = new THREE.MeshBasicMaterial({
		color: colorVal,
		transparent: true,
		opacity: 1 - progress,
		depthWrite: false,
	});
	for (let i = 0; i < particles; i += 1) {
		const angle = (i * Math.PI * 2) / particles;
		const dist = 20 + radius * progress * (0.55 + (i % 3) * 0.12);
		const dot = new THREE.Mesh(
			new THREE.CircleGeometry(3 * (1 - progress) + 1, 8),
			dotMat,
		);
		dot.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist, 0);
		dot.renderOrder = Z_EFFECT + 0.001;
		group.add(dot);
	}
}

function crescent(group: THREE.Group, progress: number): void {
	const radius = 46 + 48 * progress;
	const arc = new THREE.Mesh(
		new THREE.RingGeometry(
			radius - 6 * (1 - progress) - 1,
			radius + 6 * (1 - progress) + 1,
			32,
			1,
			-1.15 + progress * 0.35,
			2.3 + progress * 0.7,
		),
		new THREE.MeshBasicMaterial({
			color: 0xbafcff,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 1 - progress * 0.3,
			depthWrite: false,
		}),
	);
	arc.renderOrder = Z_EFFECT;
	group.add(arc);
}

function cleave(group: THREE.Group, progress: number): void {
	const radius = 42 + 70 * progress;
	const arc = new THREE.Mesh(
		new THREE.RingGeometry(
			radius - 7 * (1 - progress) - 1,
			radius + 7 * (1 - progress) + 1,
			32,
			1,
			-0.95,
			1.9,
		),
		new THREE.MeshBasicMaterial({
			color: 0xffcf76,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 1 - progress * 0.3,
			depthWrite: false,
		}),
	);
	arc.renderOrder = Z_EFFECT;
	group.add(arc);
}

function hammerCast(group: THREE.Group, progress: number): void {
	for (let index = 0; index < 3; index += 1) {
		const angle = (index * Math.PI * 2) / 3 + progress * 2.2;
		const radius = 22 + progress * 42;
		const dot = new THREE.Mesh(
			new THREE.RingGeometry(5.5, 8.5, 16),
			new THREE.MeshBasicMaterial({
				color: 0xffe49a,
				side: THREE.DoubleSide,
				transparent: true,
				opacity: 1 - progress,
				depthWrite: false,
			}),
		);
		dot.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
		dot.renderOrder = Z_EFFECT;
		group.add(dot);
	}
}

function flurry(group: THREE.Group, progress: number): void {
	const mat = new THREE.LineBasicMaterial({
		color: 0xd9c2ff,
		transparent: true,
		opacity: 1 - progress,
	});
	for (let i = -2; i <= 2; i += 1) {
		const angle = i * 0.26 + (i % 2) * 0.08;
		const start = 16 + progress * 12;
		const end = 70 + progress * 35;
		const geo = new THREE.BufferGeometry();
		geo.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(
				[
					Math.cos(angle) * start,
					Math.sin(angle) * start,
					0,
					Math.cos(angle) * end,
					Math.sin(angle) * end,
					0,
				],
				3,
			),
		);
		const line = new THREE.Line(geo, mat);
		line.renderOrder = Z_EFFECT;
		group.add(line);
	}
}

function shockwave(group: THREE.Group, progress: number): void {
	for (let ring = 0; ring < 2; ring += 1) {
		const phase = Math.max(0, Math.min(1, progress * 1.35 - ring * 0.22));
		const r = 20 + phase * 112;
		const m = new THREE.Mesh(
			new THREE.RingGeometry(r - 3, r + 3, 32),
			new THREE.MeshBasicMaterial({
				color: 0xffd36a,
				side: THREE.DoubleSide,
				transparent: true,
				opacity: 1 - phase,
				depthWrite: false,
			}),
		);
		m.renderOrder = Z_EFFECT + ring * 0.001;
		group.add(m);
	}

	const dotMat = new THREE.MeshBasicMaterial({
		color: 0xfff0ad,
		transparent: true,
		opacity: 1 - progress,
		depthWrite: false,
	});
	for (let i = 0; i < 12; i += 1) {
		const angle = (i * Math.PI) / 6;
		const dist = 28 + progress * 98;
		const dot = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), dotMat);
		dot.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist, 0);
		dot.renderOrder = Z_EFFECT + 0.002;
		group.add(dot);
	}
}

function arcane(group: THREE.Group, progress: number): void {
	const dotMat = new THREE.MeshBasicMaterial({
		color: 0x8fe9ff,
		transparent: true,
		opacity: 1 - progress * 0.5,
		depthWrite: false,
	});
	for (let i = 0; i < 10; i += 1) {
		const angle = i * 2.399 + progress * 2;
		const radius = (1 - progress) * (24 + (i % 4) * 8);
		const forward = progress * 42;
		const dot = new THREE.Mesh(
			new THREE.CircleGeometry(2.5 + (i % 2), 8),
			dotMat,
		);
		dot.position.set(
			forward + Math.cos(angle) * radius,
			Math.sin(angle) * radius,
			0,
		);
		dot.renderOrder = Z_EFFECT;
		group.add(dot);
	}

	const ring = new THREE.Mesh(
		new THREE.RingGeometry(
			12 + progress * 22 - 1.5 * (1 - progress),
			12 + progress * 22 + 1.5 * (1 - progress),
			20,
		),
		new THREE.MeshBasicMaterial({
			color: 0xd4f7ff,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 1 - progress,
			depthWrite: false,
		}),
	);
	ring.position.x = progress * 30;
	ring.renderOrder = Z_EFFECT + 0.001;
	group.add(ring);
}

function healing(group: THREE.Group, progress: number, radius: number): void {
	const auraOpacity = healingAuraOpacity(progress);
	const light = new THREE.Mesh(
		new THREE.CircleGeometry(radius, 48),
		new THREE.MeshBasicMaterial({
			color: 0x42e883,
			transparent: true,
			opacity: auraOpacity * HEALING_AURA_FILL_MAX_OPACITY,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		}),
	);
	light.name = "healing-aura-light";
	light.renderOrder = Z_EFFECT;
	group.add(light);

	const aura = new THREE.Mesh(
		new THREE.RingGeometry(radius * 0.63, radius, 48),
		new THREE.MeshBasicMaterial({
			color: 0x72f2a7,
			transparent: true,
			opacity: auraOpacity * HEALING_AURA_RING_MAX_OPACITY,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		}),
	);
	aura.name = "healing-aura";
	aura.renderOrder = Z_EFFECT + 0.001;
	group.add(aura);

	if (progress < 0.25) return;

	const plusProgress = (progress - 0.25) / 0.75;
	const plusMat = new THREE.SpriteMaterial({
		map: healingPlusTexture(),
		color: 0x72f2a7,
		transparent: true,
		opacity: healingPlusOpacity(progress),
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});
	for (let i = 0; i < 6; i += 1) {
		const angle = i * 2.399;
		const plusRadius = radius * (0.28 + (i % 3) * 0.2);
		const plus = new THREE.Sprite(plusMat.clone());
		const size = 14 + (i % 2) * 3;
		plus.name = "healing-plus";
		plus.position.set(
			Math.cos(angle) * plusRadius,
			Math.sin(angle) * plusRadius,
			8 + plusProgress * (radius * 0.22 + i * radius * 0.012),
		);
		plus.scale.set(size, size, 1);
		plus.renderOrder = Z_EFFECT + 0.002;
		group.add(plus);
	}
	plusMat.dispose();
}

export function healingAuraOpacity(progress: number): number {
	const bounded = Math.max(0, Math.min(1, progress));
	return bounded <= 0.25 ? bounded / 0.25 : (1 - bounded) / 0.75;
}

export function healingPlusOpacity(progress: number): number {
	const bounded = Math.max(0, Math.min(1, progress));
	if (bounded < 0.25) return 0;
	return (1 - bounded) / 0.75;
}

export function healingUplightIntensity(age: number): number {
	const boundedAge = Math.max(
		0,
		Math.min(HEALING_GROUND_DURATION + HEALING_LIGHT_LINGER_DURATION, age),
	);
	if (boundedAge <= 0.25)
		return HEALING_UPLIGHT_INTENSITY * (boundedAge / 0.25);
	return (
		HEALING_UPLIGHT_INTENSITY *
		(1 -
			(boundedAge - 0.25) /
				(HEALING_GROUND_DURATION + HEALING_LIGHT_LINGER_DURATION - 0.25))
	);
}

let cachedHealingPlusTexture: THREE.DataTexture | undefined;

function healingPlusTexture(): THREE.DataTexture {
	if (cachedHealingPlusTexture) return cachedHealingPlusTexture;

	const size = 16;
	const pixels = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const isPlus = (x >= 6 && x <= 9) || (y >= 6 && y <= 9);
			if (!isPlus) continue;
			const offset = (y * size + x) * 4;
			pixels[offset] = 255;
			pixels[offset + 1] = 255;
			pixels[offset + 2] = 255;
			pixels[offset + 3] = 255;
		}
	}

	cachedHealingPlusTexture = new THREE.DataTexture(
		pixels,
		size,
		size,
		THREE.RGBAFormat,
	);
	cachedHealingPlusTexture.magFilter = THREE.NearestFilter;
	cachedHealingPlusTexture.minFilter = THREE.NearestFilter;
	cachedHealingPlusTexture.needsUpdate = true;
	return cachedHealingPlusTexture;
}

function fireBreath(group: THREE.Group, progress: number): void {
	for (let index = 0; index < 5; index += 1) {
		const phase = Math.max(0, Math.min(1, progress * 1.7 - index * 0.12));
		const x = 18 + phase * (65 + index * 13);
		const radius = 10 + phase * (12 + index * 2);
		const arc = new THREE.Mesh(
			new THREE.RingGeometry(radius - 3.5, radius + 3.5, 16, 1, -0.9, 1.8),
			new THREE.MeshBasicMaterial({
				color: 0xff6534,
				side: THREE.DoubleSide,
				transparent: true,
				opacity: (1 - phase) * (1 - index * 0.08),
				depthWrite: false,
			}),
		);
		arc.position.x = x;
		arc.renderOrder = Z_EFFECT + index * 0.001;
		group.add(arc);
	}
}

function rentEdge(
	group: THREE.Group,
	progress: number,
	range: number,
	heroOwned: boolean,
): void {
	const radius = Math.max(36, range * 0.82);
	const headAngle = rentSlashAngle(progress);
	for (let cone = 0; cone < 4; cone += 1)
		rentCone(
			group,
			progress,
			radius,
			headAngle + (cone * Math.PI) / 2,
			heroOwned,
			cone,
		);
}

function rentCone(
	group: THREE.Group,
	progress: number,
	radius: number,
	headAngle: number,
	heroOwned: boolean,
	cone: number,
): void {
	const trailLength = Math.PI * (0.35 + 1.05 * Math.sin(progress * Math.PI));
	const segments = 36;
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];

	for (let index = 0; index <= segments; index += 1) {
		const tailProgress = index / segments;
		const angle = headAngle + tailProgress * trailLength;
		const radialWave = Math.sin(tailProgress * Math.PI * 3) * 2.5;
		const sectionRadius = radius + radialWave;
		const halfHeight = 11 * (1 - tailProgress) + 1.5;
		for (const edge of [-1, 1]) {
			positions.push(
				Math.cos(angle) * sectionRadius,
				Math.sin(angle) * sectionRadius,
				edge * halfHeight,
			);
			uvs.push(tailProgress, edge < 0 ? 0 : 1);
		}
		if (index < segments) {
			const offset = index * 2;
			indices.push(
				offset,
				offset + 1,
				offset + 2,
				offset + 1,
				offset + 3,
				offset + 2,
			);
		}
	}

	const trailGeometry = new THREE.BufferGeometry();
	trailGeometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(positions, 3),
	);
	trailGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
	trailGeometry.setIndex(indices);
	const trail = new THREE.Mesh(
		trailGeometry,
		new THREE.ShaderMaterial({
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			blending: THREE.AdditiveBlending,
			uniforms: {
				uOpacity: { value: Math.sin(progress * Math.PI) },
				uPhase: { value: progress * Math.PI * 8 },
			},
			vertexShader: `
				varying vec2 vUv;
				uniform float uPhase;
				void main() {
					vUv = uv;
					vec3 displaced = position;
					float taper = 1.0 - uv.x;
					displaced.z += sin(uv.x * 18.0 + uPhase) * 3.0 * taper;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
				}
			`,
			fragmentShader: `
				varying vec2 vUv;
				uniform float uOpacity;
				void main() {
					float edge = 1.0 - abs(vUv.y * 2.0 - 1.0);
					float alpha = pow(1.0 - vUv.x, 1.35) * (0.35 + edge * 0.65) * uOpacity;
					vec3 color = mix(${heroOwned ? "vec3(0.18, 0.03, 0.30), vec3(0.61, 0.36, 1.0)" : "vec3(0.48, 0.005, 0.025), vec3(1.0, 0.16, 0.28)"}, edge);
					gl_FragColor = vec4(color, alpha);
				}
			`,
		}),
	);
	trail.name = `rent-slash-trail-${cone}`;
	trail.renderOrder = Z_EFFECT;
	group.add(trail);

	const swordDistance = radius - 17;
	const sword = new THREE.Mesh(
		new THREE.ConeGeometry(6, 42, 4),
		new THREE.MeshStandardMaterial({
			color: heroOwned ? HERO_BLOOD_SPELL_COLOR : HOSTILE_SPELL_COLOR,
			emissive: heroOwned ? 0x54218f : 0xff0828,
			emissiveIntensity: 5,
			metalness: 0.72,
			roughness: 0.18,
		}),
	);
	sword.name = `rent-magic-sword-${cone}`;
	sword.position.set(
		Math.cos(headAngle) * swordDistance,
		Math.sin(headAngle) * swordDistance,
		0,
	);
	sword.rotation.z = headAngle - Math.PI / 2;
	sword.scale.setScalar(0.75 + Math.sin(progress * Math.PI) * 0.25);
	sword.renderOrder = Z_EFFECT + 0.002;
	group.add(sword);
}

export const WHIRLWIND_RADIANS_PER_SECOND = Math.PI * 9;

function whirlwind(
	group: THREE.Group,
	progress: number,
	range: number,
	time: number,
): void {
	const radius = Math.max(42, range * 0.86);
	const headAngle = time * WHIRLWIND_RADIANS_PER_SECOND;
	const effectFade = Math.min(1, progress * 8, (1 - progress) * 8);
	for (let layer = 0; layer < 4; layer += 1) {
		whirlwindTrail(
			group,
			headAngle - layer * 0.22,
			radius - layer * 2.2,
			layer,
			effectFade,
		);
	}

	const sword = new THREE.Mesh(
		new THREE.ConeGeometry(5.5, 40, 4),
		new THREE.MeshStandardMaterial({
			color: 0xfff0df,
			emissive: 0xff2746,
			emissiveIntensity: 3.5,
			metalness: 0.85,
			roughness: 0.12,
		}),
	);
	sword.name = "whirlwind-magic-sword";
	sword.position.set(
		Math.cos(headAngle) * (radius - 16),
		Math.sin(headAngle) * (radius - 16),
		0,
	);
	sword.rotation.z = headAngle - Math.PI / 2;
	sword.renderOrder = Z_EFFECT + 0.01;
	group.add(sword);
}

function whirlwindTrail(
	group: THREE.Group,
	headAngle: number,
	radius: number,
	layer: number,
	opacity: number,
): void {
	const segments = 64;
	const trailLength = Math.PI * (1.65 + layer * 0.06);
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	for (let index = 0; index <= segments; index += 1) {
		const tailProgress = index / segments;
		const angle = headAngle - tailProgress * trailLength;
		const displacedRadius =
			radius + Math.sin(tailProgress * Math.PI * 5 + layer) * 2;
		const halfHeight = 7.5 * (1 - tailProgress * 0.7);
		for (const edge of [-1, 1]) {
			positions.push(
				Math.cos(angle) * displacedRadius,
				Math.sin(angle) * displacedRadius,
				edge * halfHeight,
			);
			uvs.push(tailProgress, edge < 0 ? 0 : 1);
		}
		if (index < segments) {
			const offset = index * 2;
			indices.push(
				offset,
				offset + 1,
				offset + 2,
				offset + 1,
				offset + 3,
				offset + 2,
			);
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(positions, 3),
	);
	geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setIndex(indices);
	const trail = new THREE.Mesh(
		geometry,
		new THREE.ShaderMaterial({
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			blending: THREE.AdditiveBlending,
			uniforms: {
				uLayer: { value: layer },
				uOpacity: { value: opacity * (0.34 - layer * 0.045) },
			},
			vertexShader: `
				varying vec2 vUv;
				uniform float uLayer;
				void main() {
					vUv = uv;
					vec3 displaced = position;
					displaced.z += sin(uv.x * 24.0 + uLayer * 1.7) * 2.5 * (1.0 - uv.x);
					gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
				}
			`,
			fragmentShader: `
				varying vec2 vUv;
				uniform float uOpacity;
				void main() {
					float core = 1.0 - abs(vUv.y * 2.0 - 1.0);
					float tail = pow(1.0 - vUv.x, 0.55);
					vec3 color = mix(vec3(0.72, 0.035, 0.07), vec3(1.0, 0.91, 0.78), core);
					gl_FragColor = vec4(color, (0.25 + core * 0.75) * tail * uOpacity);
				}
			`,
		}),
	);
	trail.name = `whirlwind-blur-trail-${layer}`;
	trail.renderOrder = Z_EFFECT + layer * 0.001;
	group.add(trail);
}
