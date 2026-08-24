import * as THREE from "three";
import type { SkillId } from "../../../common/items";
import type { Blizzard } from "../Blizzard";
import type { GroundSwamp } from "../GroundSwamp";
import {
	type SpellEffect,
	type SpellEffectKind,
	spellEffectLightColor,
	THUNDER_IMPACT_LIGHT_OFFSET,
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
	deathBurst: "deathBurst",
};

export const SWAMP_UPLIGHT_COLOR = 0x39ff14;
export const SWAMP_UPLIGHT_INTENSITY = 420;
export const SWAMP_UPLIGHT_HEIGHT = 8;
export const BLIZZARD_PROJECTILE_LIGHT_COLOR = 0x8de7ff;
export const BLIZZARD_PROJECTILE_LIGHT_INTENSITY = 95;
export const BLIZZARD_PROJECTILE_LIGHT_DISTANCE = 150;
export const BLIZZARD_PROJECTILE_LIGHT_MIN_HEIGHT = 10;
export const THUNDER_LIGHT_POLL_INTERVAL = 0.1;

export function thunderLightPosition(
	position: { x: number; y: number },
	random = Math.random,
): { x: number; y: number } {
	const angle = random() * Math.PI * 2;
	return {
		x: position.x + Math.cos(angle) * THUNDER_IMPACT_LIGHT_OFFSET,
		y: position.y + Math.sin(angle) * THUNDER_IMPACT_LIGHT_OFFSET,
	};
}

export class HeroSpellLightPool {
	private readonly cache = new Map<SpellEffectKind, PooledLight>();
	private readonly attached = new Set<SpellEffectKind>();
	private readonly thunderOffsets = new WeakMap<
		SpellEffect,
		{ x: number; y: number; nextPoll: number }
	>();
	constructor(
		private readonly scene: THREE.Scene,
		private readonly random: () => number = Math.random,
	) {}

	sync(
		availableSkills: Iterable<SkillId>,
		effects: readonly SpellEffect[],
		time: number,
		swamps: readonly GroundSwamp[] = [],
		blizzards: readonly Blizzard[] = [],
		lightsEnabled = true,
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
			if (light) {
				light.intensity = 0;
				light.visible = lightsEnabled;
			}
		}

		for (const effect of effects) {
			if (!effect.heroOwned || !effect.active) continue;
			const light = this.cache.get(effect.kind);
			if (!light) continue;
			let lightPosition = effect.position;
			if (effect.kind === "thunderAura") {
				let jitter = this.thunderOffsets.get(effect);
				if (!jitter || time >= jitter.nextPoll) {
					const sampled = thunderLightPosition({ x: 0, y: 0 }, this.random);
					jitter = {
						x: sampled.x,
						y: sampled.y,
						nextPoll: time + THUNDER_LIGHT_POLL_INTERVAL,
					};
					this.thunderOffsets.set(effect, jitter);
				}
				lightPosition = {
					x: effect.position.x + jitter.x,
					y: effect.position.y + jitter.y,
				};
			}
			light.position.set(
				lightPosition.x,
				lightPosition.y,
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
		let activeBlizzard: Blizzard | undefined;
		for (let index = blizzards.length - 1; index >= 0; index -= 1) {
			if (!blizzards[index].active) continue;
			activeBlizzard = blizzards[index];
			break;
		}
		if (blizzardLight && activeBlizzard) {
			blizzardLight.position.set(
				activeBlizzard.position.x,
				activeBlizzard.position.y,
				BLIZZARD_PROJECTILE_LIGHT_MIN_HEIGHT,
			);
			blizzardLight.distance = BLIZZARD_PROJECTILE_LIGHT_DISTANCE;
			blizzardLight.intensity = BLIZZARD_PROJECTILE_LIGHT_INTENSITY;
		}
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
