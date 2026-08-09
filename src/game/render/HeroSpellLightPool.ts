import * as THREE from "three";
import type { SkillId } from "../../../common/items";
import {
	spellEffectLightColor,
	type SpellEffect,
	type SpellEffectKind,
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
};

export class HeroSpellLightPool {
	private readonly cache = new Map<SpellEffectKind, PooledLight>();
	private readonly attached = new Set<SpellEffectKind>();

	constructor(private readonly scene: THREE.Scene) {}

	sync(
		availableSkills: Iterable<SkillId>,
		effects: readonly SpellEffect[],
		time: number,
	): void {
		const required = new Set<SpellEffectKind>();
		for (const skill of availableSkills) {
			const kind = EFFECT_KIND_BY_SKILL[skill];
			if (kind) required.add(kind);
		}
		for (const effect of effects)
			if (effect.heroOwned && effect.active) required.add(effect.kind);

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
				effect.kind === "healing" ? 6 : 18,
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
		const color = spellEffectLightColor(kind);
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
