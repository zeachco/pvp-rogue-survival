import {
	auraRadius,
	auraSlowMultiplier,
	sunburnFraction,
	sunburnInterval,
	thunderCritChance,
	thunderDamage,
	thunderInterval,
} from "../../../common/auras";
import type { SkillId } from "../../../common/items";
import type { PlayerProgress } from "../../../common/protocol";
import type { RandomSource } from "../../../common/random";
import {
	AttackSpeedMultiplierEffect,
	MovementMultiplierEffect,
} from "../../../common/unitState";
import type { Creep } from "../Creep";
import type { Hero } from "../Hero";
import {
	DEATH_BURST_DURATION,
	SpellEffect,
	THUNDER_IMPACT_DURATION,
} from "../SpellEffect";
import { distanceSquared } from "../types";
import { effectiveSkillLevel } from "./HeroCombatSystem";

export class AuraSystem {
	private sunburnRemaining = 0;
	private thunderRemaining = 0;
	private readonly burst = new WeakSet<Creep>();
	private readonly nearbyTargets: Creep[] = [];
	private pendingBursts: Array<{
		position: { x: number; y: number };
		radius: number;
		damage: number;
	}> = [];
	collectEffects(
		hero: Hero,
		progress: PlayerProgress,
		creeps: readonly Creep[],
	): void {
		const levelOf = (skill: SkillId) =>
			hero.isSkillOperational(skill) ? effectiveSkillLevel(progress, skill) : 0;
		const slowLevel = levelOf("slowAura");
		const hinderLevel = levelOf("hinderingAura");
		if (slowLevel <= 0 && hinderLevel <= 0) return;
		const slowRadius = slowLevel ? auraRadius(slowLevel, hero.stats.spirit) : 0;
		const hinderRadius = hinderLevel
			? auraRadius(hinderLevel, hero.stats.spirit)
			: 0;
		const slowRadiusSquared = slowRadius * slowRadius;
		const hinderRadiusSquared = hinderRadius * hinderRadius;
		for (const creep of creeps) {
			if (!creep.active) continue;
			const separationSquared = distanceSquared(hero.position, creep.position);
			if (slowLevel > 0 && separationSquared <= slowRadiusSquared)
				creep.addFrameEffect(
					new MovementMultiplierEffect(
						"slowAura",
						auraSlowMultiplier(slowLevel),
					),
				);
			if (hinderLevel > 0 && separationSquared <= hinderRadiusSquared)
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
			this.nearbyTargets.length = 0;
			if (!level) return this.nearbyTargets;
			const radius = auraRadius(level, hero.stats.spirit);
			const radiusSquared = radius * radius;
			for (const creep of creeps)
				if (
					creep.active &&
					distanceSquared(hero.position, creep.position) <= radiusSquared
				)
					this.nearbyTargets.push(creep);
			return this.nearbyTargets;
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
					const chainedIndex = Math.floor(random.next() * (targets.length - 1));
					const chained =
						targets.length > 1
							? targets[
									chainedIndex >= targets.indexOf(first)
										? chainedIndex + 1
										: chainedIndex
								]
							: undefined;
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
		spellEffects: SpellEffect[],
	): void {
		for (const pending of this.pendingBursts) {
			const radiusSquared = pending.radius * pending.radius;
			for (const target of creeps)
				if (
					target.active &&
					distanceSquared(pending.position, target.position) <= radiusSquared
				)
					target.receiveDamage(pending.damage, random, hero, false, false, {
						kind: "magic",
					});
		}
		this.pendingBursts = [];

		const level = hero.isSkillOperational("deathBurst")
			? effectiveSkillLevel(progress, "deathBurst")
			: 0;
		if (!level) return;
		const radius = auraRadius(level, hero.stats.spirit);
		const radiusSquared = radius * radius;
		for (const dead of creeps)
			if (
				!dead.active &&
				!this.burst.has(dead) &&
				distanceSquared(hero.position, dead.position) <= radiusSquared
			) {
				this.burst.add(dead);
				spellEffects.push(
					new SpellEffect(
						"deathBurst",
						dead.position,
						0,
						radius * 0.45,
						DEATH_BURST_DURATION,
						undefined,
						true,
					),
				);
				this.pendingBursts.push({
					position: { ...dead.position },
					radius: radius * 0.45,
					damage: dead.maxHp * 0.2,
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
		this.pendingBursts = [];
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
