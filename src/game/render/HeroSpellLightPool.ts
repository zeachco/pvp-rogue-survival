import * as THREE from "three";
import type { SkillId } from "../../../common/items";
import type { Blizzard } from "../Blizzard";
import type { GroundSwamp } from "../GroundSwamp";
import {
	type SpellEffect,
	type SpellEffectKind,
	spellEffectLightColor,
} from "../SpellEffect";

type PooledLight = THREE.PointLight | THREE.SpotLight;

const EFFECT_KIND_BY_SKILL: Partial<Record<SkillId, SpellEffectKind>> = {
	bash: "bash",
	sweep: "sweep",
	flurry: "flurry",
	shockwave: "shockwave",
	cleave: "cleave",
	whirlwind: "whirlwind",
	arcaneBolt: "arcaneBoltExplosion",
	gravityPull: "gravityPull",
	reflectiveSurge: "reflectiveSurge",
	fireBreath: "fireBreath",
	rapidRegen: "rapidRegen",
	healing: "healing",
	rent: "rent",
	swamp: "swamp",
	blizzard: "blizzard",
	thunderAura: "thunderAura",
};

export const SWAMP_UPLIGHT_COLOR = 0x39ff14;
export const SWAMP_UPLIGHT_INTENSITY = 420;
export const SWAMP_UPLIGHT_HEIGHT = 8;
export const BLIZZARD_PROJECTILE_LIGHT_COLOR = 0x8de7ff;
export const BLIZZARD_PROJECTILE_LIGHT_INTENSITY = 95;
export const BLIZZARD_PROJECTILE_LIGHT_DISTANCE = 150;
export const BLIZZARD_PROJECTILE_LIGHT_MIN_HEIGHT = 10;
export const BLIZZARD_LIGHT_GROUND_LERP_SPEED = 8;
export const BLIZZARD_LIGHT_VERTICAL_LERP_SPEED = 40;

export class HeroSpellLightPool {
	private readonly cache = new Map<SpellEffectKind, PooledLight>();
	private readonly attached = new Set<SpellEffectKind>();
	private blizzardLightInitialized = false;
	private lastBlizzardSyncTime?: number;

	constructor(private readonly scene: THREE.Scene) {}

	sync(
		availableSkills: Iterable<SkillId>,
		effects: readonly SpellEffect[],
		time: number,
		swamps: readonly GroundSwamp[] = [],
		blizzards: readonly Blizzard[] = [],
	): void {
		const required = new Set<SpellEffectKind>();
		for (const skill of availableSkills) {
			const kind = EFFECT_KIND_BY_SKILL[skill];
			if (kind) required.add(kind);
		}
		for (const effect of effects)
			if (effect.heroOwned && effect.active) required.add(effect.kind);
		if (swamps.some((swamp) => swamp.active)) required.add("swamp");
		if (blizzards.some((blizzard) => blizzard.active)) required.add("blizzard");

		for (const kind of this.attached)
			if (!required.has(kind)) this.detach(kind);
		for (const kind of required) this.attach(kind);

		for (const kind of this.attached) {
			const light = this.cache.get(kind);
			if (light) light.intensity = 0;
		}

		for (const effect of effects) {
			if (!effect.heroOwned || !effect.active) continue;
			const light = this.cache.get(effect.kind);
			if (!light) continue;
			light.position.set(
				effect.position.x,
				effect.position.y,
				effect.kind === "thunderAura" ? 4 : effect.kind === "healing" ? 6 : 18,
			);
			light.distance = effect.lightDistance();
			light.intensity = effect.lightIntensity(time);
			if (light instanceof THREE.SpotLight)
				light.target.position.set(
					effect.position.x,
					effect.position.y,
					Math.max(50, effect.lightDistance() / 2),
				);
		}

		const swampLight = this.cache.get("swamp");
		let activeSwamp: GroundSwamp | undefined;
		for (let index = swamps.length - 1; index >= 0; index -= 1) {
			if (!swamps[index].active) continue;
			activeSwamp = swamps[index];
			break;
		}
		if (swampLight && activeSwamp) {
			swampLight.position.set(
				activeSwamp.position.x,
				activeSwamp.position.y,
				SWAMP_UPLIGHT_HEIGHT,
			);
			swampLight.distance = activeSwamp.radius * 2;
			swampLight.intensity = SWAMP_UPLIGHT_INTENSITY;
		}

		const blizzardLight = this.cache.get("blizzard");
		let closestIcicle: THREE.Vector3 | undefined;
		for (const blizzard of blizzards) {
			if (!blizzard.active) continue;
			const candidate = blizzard.closestFallingIciclePosition();
			if (candidate && (!closestIcicle || candidate.z < closestIcicle.z))
				closestIcicle = candidate;
		}
		if (blizzardLight && closestIcicle) {
			const targetZ = Math.max(
				BLIZZARD_PROJECTILE_LIGHT_MIN_HEIGHT,
				closestIcicle.z,
			);
			if (!this.blizzardLightInitialized) {
				blizzardLight.position.set(closestIcicle.x, closestIcicle.y, targetZ);
				this.blizzardLightInitialized = true;
			} else {
				const deltaSeconds = Math.max(
					0,
					Math.min(0.1, time - (this.lastBlizzardSyncTime ?? time)),
				);
				const groundAlpha =
					1 - Math.exp(-BLIZZARD_LIGHT_GROUND_LERP_SPEED * deltaSeconds);
				const verticalAlpha =
					1 - Math.exp(-BLIZZARD_LIGHT_VERTICAL_LERP_SPEED * deltaSeconds);
				blizzardLight.position.x = THREE.MathUtils.lerp(
					blizzardLight.position.x,
					closestIcicle.x,
					groundAlpha,
				);
				blizzardLight.position.y = THREE.MathUtils.lerp(
					blizzardLight.position.y,
					closestIcicle.y,
					groundAlpha,
				);
				blizzardLight.position.z = THREE.MathUtils.lerp(
					blizzardLight.position.z,
					targetZ,
					verticalAlpha,
				);
			}
			blizzardLight.distance = BLIZZARD_PROJECTILE_LIGHT_DISTANCE;
			blizzardLight.intensity = BLIZZARD_PROJECTILE_LIGHT_INTENSITY;
		}
		if (!closestIcicle && !blizzards.some((blizzard) => blizzard.active))
			this.blizzardLightInitialized = false;
		this.lastBlizzardSyncTime = time;
	}

	light(kind: SpellEffectKind): PooledLight | undefined {
		return this.cache.get(kind);
	}

	private attach(kind: SpellEffectKind): void {
		const light = this.cachedLight(kind);
		if (!light || this.attached.has(kind)) return;
		this.scene.add(light);
		if (light instanceof THREE.SpotLight) this.scene.add(light.target);
		this.attached.add(kind);
	}

	private detach(kind: SpellEffectKind): void {
		const light = this.cache.get(kind);
		if (!light) return;
		light.intensity = 0;
		this.scene.remove(light);
		if (light instanceof THREE.SpotLight) this.scene.remove(light.target);
		this.attached.delete(kind);
	}

	private cachedLight(kind: SpellEffectKind): PooledLight | undefined {
		const existing = this.cache.get(kind);
		if (existing) return existing;
		const color =
			kind === "swamp"
				? SWAMP_UPLIGHT_COLOR
				: kind === "blizzard"
					? BLIZZARD_PROJECTILE_LIGHT_COLOR
					: spellEffectLightColor(kind);
		if (color === undefined) return undefined;
		const light = new THREE.PointLight(
			kind === "healing" ? 0x72f2a7 : color,
			0,
			0,
			1,
		);
		light.name = `hero-spell-light-${kind}`;
		if (light instanceof THREE.SpotLight)
			light.target.name = "hero-spell-light-healing-target";
		this.cache.set(kind, light);
		return light;
	}
}
