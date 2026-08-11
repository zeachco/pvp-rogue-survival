import {
	auraRadius,
	auraSlowMultiplier,
	sunburnFraction,
	sunburnInterval,
	thunderCritChance,
	thunderDamage,
	thunderInterval,
	thunderAuraRadius,
} from "../../../common/auras";
import type { PlayerProgress } from "../../../common/protocol";
import type { RandomSource } from "../../../common/random";
import type { SkillId } from "../../../common/items";
import { effectiveSkillLevel } from "./HeroCombatSystem";
import type { Creep } from "../Creep";
import type { Hero } from "../Hero";
import { SpellEffect, THUNDER_IMPACT_DURATION } from "../SpellEffect";
import { distance } from "../types";
import {
	AttackSpeedMultiplierEffect,
	MovementMultiplierEffect,
} from "../../../common/unitState";

export class AuraSystem {
	private sunburnRemaining = 0;
	private thunderRemaining = 0;
	private readonly burst = new WeakSet<Creep>();
	collectEffects(
		hero: Hero,
		progress: PlayerProgress,
		creeps: readonly Creep[],
	): void {
		const levelOf = (skill: SkillId) =>
			hero.isSkillOperational(skill) ? effectiveSkillLevel(progress, skill) : 0;
		const slowLevel = levelOf("slowAura");
		const hinderLevel = levelOf("hinderingAura");
		for (const creep of creeps) {
			if (!creep.active) continue;
			if (
				slowLevel > 0 &&
				distance(hero.position, creep.position) <=
					auraRadius(slowLevel, hero.stats.spirit)
			)
				creep.addFrameEffect(
					new MovementMultiplierEffect(
						"slowAura",
						auraSlowMultiplier(slowLevel),
					),
				);
			if (
				hinderLevel > 0 &&
				distance(hero.position, creep.position) <=
					auraRadius(hinderLevel, hero.stats.spirit)
			)
				creep.addFrameEffect(
					new AttackSpeedMultiplierEffect(
						"hinderingAura",
						auraSlowMultiplier(hinderLevel),
					),
				);
		}
	}

	update(
		delta: number,
		hero: Hero,
		progress: PlayerProgress,
		creeps: Creep[],
		random: RandomSource,
		spellEffects: SpellEffect[],
	): void {
		const levelOf = (skill: SkillId) =>
			hero.isSkillOperational(skill) ? effectiveSkillLevel(progress, skill) : 0;
		const nearby = (
			skill:
				| "slowAura"
				| "hinderingAura"
				| "deathBurst"
				| "sunburnAura"
				| "thunderAura",
		) => {
			const level = levelOf(skill);
			return level
				? creeps.filter(
						(creep) =>
							creep.active &&
							distance(hero.position, creep.position) <=
								(skill === "thunderAura" ? thunderAuraRadius : auraRadius)(
									level,
									hero.stats.spirit,
								),
					)
				: [];
		};
		const stats = hero.stats;
		const sunLevel = levelOf("sunburnAura");
		this.sunburnRemaining -= delta;
		if (sunLevel && this.sunburnRemaining <= 0) {
			for (const creep of nearby("sunburnAura"))
				creep.receiveDamage(
					creep.maxHp * sunburnFraction(stats.intelligence),
					random,
					hero,
					false,
					false,
					{ kind: "fire" },
				);
			this.sunburnRemaining = sunburnInterval(stats.spirit);
		}
		const thunderLevel = levelOf("thunderAura");
		this.thunderRemaining -= delta;
		if (thunderLevel && this.thunderRemaining <= 0) {
			const targets = nearby("thunderAura");
			const first = targets[Math.floor(random.next() * targets.length)];
			if (first) {
				const critical =
					random.next() < thunderCritChance(hero.state.critChance);
				const damage = thunderDamage(stats.intelligence);
				first.receiveDamage(
					damage * (critical ? hero.state.critMultiplier : 1),
					random,
					hero,
					false,
					false,
					{ kind: "electric", critical },
				);
				spellEffects.push(thunderImpact(first));
				if (critical) {
					const others = targets.filter((target) => target !== first);
					const chained = others[Math.floor(random.next() * others.length)];
					if (chained) {
						chained.receiveDamage(damage * 0.6, random, hero, false, false, {
							kind: "electric",
						});
						spellEffects.push(thunderImpact(chained));
					}
				}
			}
			this.thunderRemaining = thunderInterval(thunderLevel);
		}
	}
	resolveDeaths(
		hero: Hero,
		progress: PlayerProgress,
		creeps: Creep[],
		random: RandomSource,
	): void {
		const level = hero.isSkillOperational("deathBurst")
			? effectiveSkillLevel(progress, "deathBurst")
			: 0;
		if (!level) return;
		const radius = auraRadius(level, hero.stats.spirit);
		for (const dead of creeps)
			if (
				!dead.active &&
				!this.burst.has(dead) &&
				distance(hero.position, dead.position) <= radius
			) {
				this.burst.add(dead);
				for (const target of creeps)
					if (
						target.active &&
						target !== dead &&
						distance(dead.position, target.position) <= radius * 0.45
					)
						target.receiveDamage(dead.maxHp * 0.2, random, hero, false, false, {
							kind: "magic",
						});
			}
	}
	reduceCooldowns(seconds: number): void {
		this.sunburnRemaining = Math.max(0, this.sunburnRemaining - seconds);
		this.thunderRemaining = Math.max(0, this.thunderRemaining - seconds);
	}
	reset(): void {
		this.sunburnRemaining = 0;
		this.thunderRemaining = 0;
	}
}

function thunderImpact(target: Creep): SpellEffect {
	return new SpellEffect(
		"thunderAura",
		target.position,
		0,
		70,
		THUNDER_IMPACT_DURATION,
		undefined,
		true,
	);
}
