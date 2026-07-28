import {
	itemPhysicalBonusFraction,
	itemRequirementMultiplier,
	type ItemInstance,
} from "../../../common/items";
import type { RandomSource } from "../../../common/random";
import type { ArenaState } from "../ArenaState";
import type { Hero } from "../Hero";
import type { Unit } from "../Unit";
import { distance } from "../types";
import { applyImpactForce } from "../ImpactForce";

export function resolveCombat(
	state: ArenaState,
	hero: Hero,
	equipped: ItemInstance | undefined,
	width: number,
	height: number,
	random: RandomSource,
): void {
	for (const attack of state.attacks) {
		if (!attack.shouldResolve()) continue;
		attack.markResolved();
		if (attack.owner === "hero") {
			for (const creep of state.creeps)
				if (creep.active && attack.contains(creep.position, creep.radius)) {
					const source = attack.source as Unit | undefined;
					const dealt = creep.receiveDamage(
						attack.damage,
						random,
						source,
						true,
						false,
						attack.presentation,
					);
					if (dealt > 0) {
						applyImpactForce(creep, attack.force);
						if (!attack.skill)
							source?.restoreRage(attack.weapon?.rageCost ?? 1);
					}
					if (attack.weapon && !creep.lastHitDodged) {
						applyWeaponEffects(creep, attack.weapon, random, source);
						applyLifeSteal(source, attack.weapon, dealt);
						applyPhysicalAccessoryDamage(
							creep,
							source,
							dealt,
							attack.presentation.kind === "physical",
							random,
						);
					}
					if (attack.skill === "bash")
						creep.addStatus({
							kind: "stun",
							remaining: 1.1,
							damagePerSecond: 0,
						});
					if (attack.skill === "shockwave")
						creep.addStatus({
							kind: "stun",
							remaining: 0.6,
							damagePerSecond: 0,
						});
					if (attack.skill === "sweep")
						creep.addStatus({
							kind: "bleed",
							remaining: 3,
							damagePerSecond: 0.35,
						});
					if (attack.skill === "rent")
						(attack.source as Unit | undefined)?.heal(
							(attack.source as Unit).maxHp * 0.01,
						);
					if (attack.skill === "cleave")
						creep.addStatus({
							kind: "bleed",
							remaining: 2,
							damagePerSecond: 0.45,
							source: attack.source as Unit | undefined,
						});
					if (attack.skill === "fireBreath" && !creep.lastHitDodged)
						creep.addStatus({
							kind: "burn",
							remaining: 8,
							damagePerSecond:
								0.25 +
								0.03 * ((attack.source as Unit | undefined)?.stats.spirit ?? 0),
							source: attack.source as Unit | undefined,
						});
				}
		} else if (hero.active && attack.contains(hero.position, hero.radius)) {
			const dealt = hero.receiveDamage(
				attack.damage,
				random,
				attack.source as Unit | undefined,
				true,
				false,
				attack.presentation,
			);
			if (dealt > 0) applyImpactForce(hero, attack.force);
			if (attack.weapon && !hero.lastHitDodged) {
				applyWeaponEffects(
					hero,
					attack.weapon,
					random,
					attack.source as Unit | undefined,
				);
				applyLifeSteal(attack.source as Unit | undefined, attack.weapon, dealt);
			}
			if (attack.skill === "fireBreath" && !hero.lastHitDodged)
				hero.addStatus({
					kind: "burn",
					remaining: 8,
					damagePerSecond:
						0.25 +
						0.03 * ((attack.source as Unit | undefined)?.stats.spirit ?? 0),
					source: attack.source as Unit | undefined,
				});
		}
	}
	for (const projectile of state.projectiles) {
		if (!projectile.active) continue;
		if (projectile.owner === "hero") {
			const hits = state.creeps.filter(
				(creep) =>
					creep.active &&
					projectile.canHit(creep.build.id) &&
					distance(projectile.position, creep.position) <=
						projectile.radius + creep.radius,
			);
			for (const hit of projectile.skill === "vampiricBoomerang"
				? hits
				: hits.slice(0, 1)) {
				projectile.markHit(hit.build.id);
				if (projectile.skill === "frostOrb")
					hit.addStatus({
						kind: "freeze",
						remaining: 4,
						damagePerSecond: 0,
						source: projectile.source,
					});
				else {
					const weapon = projectile.weapon ?? equipped;
					const damage =
						projectile.skill === "vampiricBoomerang"
							? projectile.damage * projectile.overlapDamageSeconds
							: projectile.damage;
					const dealt = hit.receiveDamage(
						damage,
						random,
						projectile.source,
						true,
						false,
						projectile.presentation,
					);
					projectile.recordDamage(dealt);
					if (
						weapon &&
						!hit.lastHitDodged &&
						projectile.skill !== "vampiricBoomerang"
					) {
						applyWeaponEffects(hit, weapon, random, projectile.source);
						applyLifeSteal(projectile.source, weapon, dealt);
						applyPhysicalAccessoryDamage(
							hit,
							projectile.source,
							dealt,
							projectile.presentation.kind === "physical",
							random,
						);
						if (
							projectile.skill === "arcaneBolt" ||
							projectile.skill === "frostSpike"
						)
							hit.addStatus({
								kind: "freeze",
								remaining: 4,
								damagePerSecond: 0,
								source: projectile.source,
							});
						if (projectile.skill === "rendingThrow")
							hit.addStatus({
								kind: "bleed",
								remaining: 3,
								damagePerSecond: 0.25,
								source: projectile.source,
							});
					}
					if (dealt > 0) {
						applyImpactForce(hit, projectile.force);
						if (!projectile.skill)
							projectile.source?.restoreRage(weapon?.rageCost ?? 1);
					}
					if (
						projectile.skill !== "orbitingHammers" &&
						projectile.skill !== "vampiricBoomerang"
					)
						projectile.active = false;
				}
			}
			if (projectile.skill === "vampiricBoomerang")
				projectile.finishOverlapDamage();
		} else if (
			distance(projectile.position, hero.position) <=
			projectile.radius + hero.radius
		) {
			const weapon = projectile.weapon ?? projectile.source?.mainHand;
			const dealt = hero.receiveDamage(
				projectile.damage,
				random,
				projectile.source,
				true,
				false,
				projectile.presentation,
			);
			if (dealt > 0) applyImpactForce(hero, projectile.force);
			if (weapon && !hero.lastHitDodged) {
				applyWeaponEffects(hero, weapon, random, projectile.source);
				applyLifeSteal(projectile.source, weapon, dealt);
			}
			projectile.active = false;
		}
		if (
			projectile.position.x < -40 ||
			projectile.position.y < -40 ||
			projectile.position.x > width + 40 ||
			projectile.position.y > height + 40
		)
			projectile.active = false;
	}
}

export function applyWeaponEffects(
	target: Unit,
	item: ItemInstance,
	random: RandomSource,
	source?: Unit,
): void {
	const effectiveness = source
		? itemRequirementMultiplier(item, source.stats)
		: 1;
	if (random.next() < item.modifiers.bleedChance * effectiveness)
		target.addStatus({
			kind: "bleed",
			remaining: 3,
			damagePerSecond: 0.25,
			source,
		});
	if (random.next() < item.modifiers.poisonChance * effectiveness) {
		const voodoo = source?.isSkillOperational("voodoo")
			? 1 + Math.min(1.5, source.stats.spirit * 0.03)
			: 1;
		target.addStatus({
			kind: "poison",
			remaining: 8,
			damagePerSecond: (0.2 + (source?.stats.spirit ?? 0) * 0.02) * voodoo,
			source,
		});
	}
	if (random.next() < item.modifiers.stunChance * effectiveness)
		target.addStatus({
			kind: "stun",
			remaining: 0.7,
			damagePerSecond: 0,
			source,
		});
}
function applyLifeSteal(
	source: Unit | undefined,
	weapon: ItemInstance,
	damageDealt: number,
): void {
	if (!source || damageDealt <= 0) return;
	const items = [weapon, source.offHand].filter(Boolean) as ItemInstance[];
	const fraction = items.reduce((sum, item) => {
		const effectiveness = itemRequirementMultiplier(item, source.stats);
		const base = (item.modifiers.lifeStealBase ?? 0) * effectiveness;
		return (
			sum +
			(base + (base > 0 ? 0.001 * source.stats.spirit : 0)) * effectiveness
		);
	}, 0);
	if (fraction > 0) source.heal(damageDealt * fraction);
}
function applyPhysicalAccessoryDamage(
	target: Unit,
	source: Unit | undefined,
	physicalDamage: number,
	physical: boolean,
	random: RandomSource,
): void {
	if (!source || !physical || physicalDamage <= 0) return;
	const fraction = [source.offHand, source.amulet, source.charm].reduce(
		(sum, accessory) =>
			sum +
			itemPhysicalBonusFraction(accessory) *
				(accessory ? itemRequirementMultiplier(accessory, source.stats) : 1),
		0,
	);
	if (fraction > 0)
		target.receiveDamage(
			physicalDamage * fraction,
			random,
			source,
			false,
			false,
			{ kind: "magic" },
		);
}
