import type { BalanceConfig } from "../../../common/balance";
import {
	attackProfile,
	bucklerBlockCost,
	cappedSkillLevel,
	cooldownScale,
	forceFieldRange,
	healingBaseManaCost,
	healingCast,
	healingCooldown,
	healingRadius,
	orbitingHammerDuration,
	rapidRegenDuration,
	rapidRegenMultiplier,
	rollAttackStrike,
	skillCastTime,
	skillCooldown,
	skillDamageMultiplier,
	skillLabel,
	skillRange,
	skillUpkeepPerSecond,
	spellPower,
	swampRadius,
	timeHarvestCooldownReduction,
	timeHarvestItemSkillBonus,
	vampiricBoomerangHealingFraction,
	whirlwindDamage,
	whirlwindDuration,
	whirlwindMovementSpeed,
	whirlwindRadius,
} from "../../../common/combat";
import {
	itemCooldownReduction,
	itemKillRestoration,
	itemRequirementMultiplier,
	itemResourceCostReduction,
	itemSkillLevelBonus,
	statsWithItemBonuses,
	type ItemInstance,
	type SkillId,
} from "../../../common/items";
import { derivedStats } from "../../../common/progression";
import type { PlayerProgress } from "../../../common/protocol";
import type { RandomSource } from "../../../common/random";
import type { SpellSlot } from "../../ui/types";
import { AttackArea } from "../AttackArea";
import type { ArenaState } from "../ArenaState";
import type { Creep } from "../Creep";
import type { Hero } from "../Hero";
import type { Unit } from "../Unit";
import { Projectile } from "../Projectile";
import { distance, type Vector2 } from "../types";
import { SpellEffect } from "../SpellEffect";
import { GroundSwamp } from "../GroundSwamp";
import { SKILLS } from "../../../common/content";
import { applyImpactForce, emittedImpactForce } from "../ImpactForce";

export class HeroCombatSystem {
	private attackCooldown = 0;
	private attackCooldownMax = 0;
	private healingCooldown = 0;
	private healingCooldownMax = 0;
	private readonly skillCooldowns = new Map<
		SkillId,
		{ remaining: number; maximum: number }
	>();
	private orbitCastSequence = 0;
	private skillPriorityCursor = 0;
	private casting?: { id: SkillId; elapsed: number; total: number };
	private whirlwindRemaining = 0;
	private whirlwindPulse = 0;
	private whirlwindRange = 0;
	private whirlwindHitDamage = 0;
	private whirlwindSpeed = 1;
	private rapidRegenRemaining = 0;
	private rapidRegenMultiplierValue = 1;
	syncSkills(progress: PlayerProgress, hero: Hero): void {
		hero.knownSkills.clear();
		hero.skillLevels.clear();
		for (const skill of activeSkillIds(progress)) {
			hero.knownSkills.add(skill);
			hero.skillLevels.set(skill, effectiveSkillLevel(progress, skill));
		}
	}
	update(
		deltaSeconds: number,
		_movementInput: Vector2,
		hero: Hero,
		state: ArenaState,
		progress: PlayerProgress,
		balance: BalanceConfig,
		random: RandomSource,
	): void {
		this.attackCooldown = Math.max(0, this.attackCooldown - deltaSeconds);
		this.healingCooldown = Math.max(0, this.healingCooldown - deltaSeconds);
		this.rapidRegenRemaining = Math.max(
			0,
			this.rapidRegenRemaining - deltaSeconds,
		);
		if (this.casting) this.casting.elapsed += deltaSeconds;
		for (const cooldown of this.skillCooldowns.values())
			cooldown.remaining = Math.max(0, cooldown.remaining - deltaSeconds);
		if (this.whirlwindRemaining > 0) {
			this.whirlwindRemaining = Math.max(
				0,
				this.whirlwindRemaining - deltaSeconds,
			);
			this.whirlwindPulse -= deltaSeconds;
			while (this.whirlwindPulse <= 0 && this.whirlwindRemaining > 0) {
				const force = emittedImpactForce(hero, "radial", hero.position);
				for (const creep of state.creeps)
					if (
						creep.active &&
						distance(hero.position, creep.position) <=
							this.whirlwindRange + creep.radius
					) {
						const dealt = creep.receiveDamage(
							this.whirlwindHitDamage,
							random,
							hero,
							false,
							false,
							{ kind: "physical" },
						);
						if (dealt > 0) applyImpactForce(creep, force);
					}
				this.whirlwindPulse += 0.25;
			}
		}
		const item = progress.mainHand;
		const effectiveStats = statsWithItemBonuses(
			progress.stats,
			item,
			progress.offHand,
			progress.amulet,
			progress.charm,
		);
		const derived = derivedStats(effectiveStats);
		this.syncSkills(progress, hero);
		const healing = healingCast(
			hero.hp,
			hero.maxHp,
			hero.rage,
			hero.maxRage,
			effectiveSkillLevel(progress, "healing"),
		);
		const healingManaCost =
			healing.manaCost *
			(1 - resourceReduction(progress, "mana", effectiveStats));
		if (
			isSkillActive(progress, "healing") &&
			hero.hp < hero.maxHp * 0.75 &&
			this.healingCooldown === 0 &&
			healing.restoredHp > 0 &&
			hero.mana >= healingManaCost
		) {
			const level = effectiveSkillLevel(progress, "healing");
			hero.spendMana(healingManaCost);
			hero.heal(healing.restoredHp);
			state.spellEffects.push(
				new SpellEffect("healing", hero.position, 0, healingRadius(level)),
			);
			this.healingCooldown = healingCooldown(level);
			this.healingCooldownMax = this.healingCooldown;
		}
		const rapidRegenLevel = effectiveSkillLevel(progress, "rapidRegen");
		const rapidRegenCost =
			skillManaCost("rapidRegen") *
			(1 - resourceReduction(progress, "mana", effectiveStats));
		if (
			isSkillActive(progress, "rapidRegen") &&
			rapidRegenLevel > 0 &&
			hero.hp < hero.maxHp &&
			this.rapidRegenRemaining === 0 &&
			(this.skillCooldowns.get("rapidRegen")?.remaining ?? 0) === 0 &&
			hero.mana >= rapidRegenCost
		) {
			hero.spendMana(rapidRegenCost);
			this.rapidRegenRemaining = rapidRegenDuration(rapidRegenLevel);
			this.rapidRegenMultiplierValue = rapidRegenMultiplier(rapidRegenLevel);
			state.spellEffects.push(
				new SpellEffect(
					"rapidRegen",
					hero.position,
					0,
					0,
					this.rapidRegenRemaining,
					hero,
				),
			);
			const equipmentCooldown = itemCooldownReduction(...accessories(progress));
			const duration =
				skillCooldown("rapidRegen", item, effectiveStats) *
				cooldownScale(
					rapidRegenLevel,
					Math.min(0.8, derived.cooldownReduction + equipmentCooldown),
				);
			this.skillCooldowns.set("rapidRegen", {
				remaining: duration,
				maximum: duration,
			});
		}
		const target = closestTarget(hero, state.creeps);
		const movementSpeed = Math.hypot(hero.velocity.x, hero.velocity.y);
		if (movementSpeed > 0.01)
			hero.turnTowards(
				Math.atan2(hero.velocity.y, hero.velocity.x),
				deltaSeconds,
			);
		if (!target) {
			this.casting = undefined;
			return;
		}
		const targetDistance = distance(hero.position, target.position);
		const profile = attackProfile(item, effectiveStats, balance);
		const orderedSkills = this.availableSkills(progress);
		const rotatedSkills = orderedSkills.length
			? [
					...orderedSkills.slice(
						this.skillPriorityCursor % orderedSkills.length,
					),
					...orderedSkills.slice(
						0,
						this.skillPriorityCursor % orderedSkills.length,
					),
				]
			: [];
		const manaReduction = resourceReduction(progress, "mana", effectiveStats);
		const lifeReduction = resourceReduction(progress, "life", effectiveStats);
		const skillRangeFor = ({
			id,
			level,
		}: {
			id: SkillId;
			level: number;
		}): number =>
			id === "swamp" ? 600 : skillRange(id, item, level, effectiveStats.spirit);
		const usable = (skill: { id: SkillId; level: number }): boolean => {
			if (
				(this.skillCooldowns.get(skill.id)?.remaining ?? 0) > 0 ||
				targetDistance > skillRangeFor(skill) + target.radius
			)
				return false;
			const definition = SKILLS[skill.id];
			if (definition.resource === "mana")
				return hero.mana >= skillManaCost(skill.id) * (1 - manaReduction);
			if (definition.resource === "life")
				return skillHealthRequirementMet(skill.id, hero.hp, hero.maxHp);
			const cost =
				skill.id === "reflectiveSurge" || skill.id === "whirlwind"
					? 3
					: profile.rageCost + 0.35;
			return hero.rage >= cost;
		};
		const castingCandidate = this.casting
			? orderedSkills.find(
					(skill) => skill.id === this.casting?.id && usable(skill),
				)
			: undefined;
		if (this.casting && !castingCandidate) this.casting = undefined;
		const candidate = castingCandidate ?? rotatedSkills.find(usable);
		if (movementSpeed <= 0.01 && candidate)
			hero.turnTowards(
				Math.atan2(
					target.position.y - hero.position.y,
					target.position.x - hero.position.x,
				),
				deltaSeconds,
			);
		const manaCost = candidate
			? skillManaCost(candidate.id) * (1 - manaReduction)
			: 0;
		const rageSkillCost =
			candidate?.id === "reflectiveSurge" || candidate?.id === "whirlwind"
				? 3
				: profile.rageCost + 0.35;
		const magicSkill = Boolean(
			candidate &&
				SKILLS[candidate.id].resource === "mana" &&
				hero.mana >= manaCost,
		);
		const physicalSkill = Boolean(
			candidate &&
				SKILLS[candidate.id].resource === "rage" &&
				hero.rage >= rageSkillCost,
		);
		const lifeSkill = Boolean(
			candidate &&
				SKILLS[candidate.id].resource === "life" &&
				skillHealthRequirementMet(candidate.id, hero.hp, hero.maxHp),
		);
		const activeSkill =
			magicSkill || physicalSkill || lifeSkill ? candidate : undefined;
		const range = activeSkill ? skillRangeFor(activeSkill) : profile.range;
		const ranged = activeSkill
			? activeSkill.id === "arcaneBolt" ||
				activeSkill.id === "rendingThrow" ||
				activeSkill.id === "orbitingHammers" ||
				activeSkill.id === "frostOrb"
			: profile.projectile;
		const rageCost =
			magicSkill || lifeSkill
				? 0
				: physicalSkill
					? rageSkillCost
					: profile.rageCost;
		if (!activeSkill) {
			this.tryBasicAttack(
				hero,
				target,
				targetDistance,
				item,
				effectiveStats,
				profile,
				state,
				balance,
				random,
			);
			return;
		}
		let castOverflow = 0;
		if (activeSkill) {
			if (!this.casting) {
				const total = skillCastTime(
					activeSkill.id,
					activeSkill.level,
					effectiveStats.agility,
					profile.attacksPerSecond,
				);
				if (total > 0) {
					this.casting = { id: activeSkill.id, elapsed: 0, total };
					this.tryBasicAttack(
						hero,
						target,
						targetDistance,
						item,
						effectiveStats,
						profile,
						state,
						balance,
						random,
					);
					return;
				}
			} else if (
				this.casting.id !== activeSkill.id ||
				this.casting.elapsed < this.casting.total
			) {
				this.tryBasicAttack(
					hero,
					target,
					targetDistance,
					item,
					effectiveStats,
					profile,
					state,
					balance,
					random,
				);
				return;
			}
			castOverflow = this.casting
				? Math.max(0, this.casting.elapsed - this.casting.total)
				: 0;
			this.casting = undefined;
		}
		const lifeCost =
			lifeSkill && candidate
				? bloodSkillLifeCost(candidate.id, hero.hp, lifeReduction)
				: 0;
		hero.spendRage(rageCost);
		if (magicSkill) hero.spendMana(manaCost);
		if (lifeCost > 0) hero.takeDamage(lifeCost);
		const strike =
			activeSkill?.id === "swamp"
				? { damage: 0, critical: false }
				: rollAttackStrike(item, effectiveStats, "hero", balance, random);
		const damage =
			activeSkill && SKILLS[activeSkill.id].resource === "life"
				? bloodSkillDamage(
						activeSkill.id,
						activeSkill.level,
						strike.damage,
						lifeCost,
					)
				: strike.damage *
					(activeSkill
						? skillDamageMultiplier(activeSkill.id) *
							spellPower(activeSkill.level)
						: 1);
		const presentation = {
			kind:
				activeSkill?.id === "arcaneBolt" ||
				activeSkill?.id === "orbitingHammers" ||
				activeSkill?.id === "frostOrb" ||
				activeSkill?.id === "swamp" ||
				(!activeSkill && profile.magic)
					? ("magic" as const)
					: ("physical" as const),
			critical: strike.critical,
		};
		const facingTarget = pointAlongFacing(
			hero.position,
			hero.facing,
			Math.max(1, targetDistance),
		);
		hero.presentAttack(0.5);
		if (activeSkill?.id === "orbitingHammers") {
			const sequence = this.orbitCastSequence++;
			const lifetime = orbitingHammerDuration(activeSkill.level);
			for (let index = 0; index < 3; index += 1) {
				const drift = (((sequence * 3 + index) % 7) - 3) * 0.035;
				state.projectiles.push(
					Projectile.orbitingHammer(
						hero,
						hero.facing + (index * Math.PI * 2) / 3,
						damage,
						{ kind: "magic", critical: strike.critical },
						drift,
						lifetime,
					),
				);
			}
		} else if (activeSkill?.id === "vampiricBoomerang" && item)
			state.projectiles.push(
				Projectile.vampiricBoomerang(
					hero,
					facingTarget,
					damage,
					range,
					vampiricBoomerangHealingFraction(activeSkill.level),
					item,
				),
			);
		else if (activeSkill?.id === "frostOrb")
			state.projectiles.push(
				new Projectile(
					hero.position,
					facingTarget,
					damage,
					"hero",
					"frostOrb",
					hero,
					presentation,
					item,
				),
			);
		else if (activeSkill?.id === "swamp")
			state.swamps.push(
				new GroundSwamp(facingTarget, swampRadius(activeSkill.level), hero),
			);
		else if (activeSkill?.id === "gravityPull" && item)
			castForceField(state, hero, activeSkill.level, random);
		else if (activeSkill?.id === "reflectiveSurge")
			hero.reflectiveSurgeRemaining = 6;
		else if (activeSkill?.id === "whirlwind") {
			this.whirlwindRemaining = whirlwindDuration(activeSkill.level);
			this.whirlwindPulse = 0;
			this.whirlwindRange = whirlwindRadius(activeSkill.level);
			this.whirlwindHitDamage = whirlwindDamage(effectiveStats.strength);
			this.whirlwindSpeed = whirlwindMovementSpeed(activeSkill.level);
			state.spellEffects.push(
				new SpellEffect(
					"whirlwind",
					hero.position,
					0,
					this.whirlwindRange,
					this.whirlwindRemaining,
					hero,
				),
			);
		} else if (activeSkill?.id === "fireBreath")
			state.attacks.push(
				new AttackArea(
					"hero",
					{ ...hero.position },
					hero.facing,
					range,
					0.62,
					0.22,
					0.18,
					damage,
					hero,
					"fireBreath",
					item,
					{ kind: "fire", critical: strike.critical },
				),
			);
		else if (ranged)
			state.projectiles.push(
				new Projectile(
					hero.position,
					facingTarget,
					damage,
					"hero",
					activeSkill?.id === "arcaneBolt" || activeSkill?.id === "rendingThrow"
						? activeSkill.id
						: undefined,
					hero,
					presentation,
					item,
				),
			);
		else {
			const origin = { ...hero.position };
			state.attacks.push(
				new AttackArea(
					"hero",
					origin,
					hero.facing,
					range,
					activeSkill?.id === "bash" ||
						activeSkill?.id === "sweep" ||
						activeSkill?.id === "shockwave" ||
						activeSkill?.id === "rent" ||
						(!activeSkill &&
							(item?.definitionId === "mace" ||
								item?.definitionId === "club" ||
								item?.definitionId === "hammer"))
						? Math.PI
						: activeSkill?.id === "cleave"
							? 1.8
							: activeSkill?.id === "flurry"
								? 1.1
								: 0.72,
					0.18,
					0.13,
					damage,
					hero,
					activeSkill?.id,
					item,
					presentation,
					emittedImpactForce(hero, "radial", origin),
				),
			);
		}
		if (
			activeSkill &&
			activeSkill.id !== "whirlwind" &&
			activeSkill.id !== "swamp"
		)
			state.spellEffects.push(
				new SpellEffect(activeSkill.id, hero.position, hero.facing, range),
			);
		if (activeSkill) {
			const equipmentCooldown = itemCooldownReduction(...accessories(progress));
			const duration =
				activeSkill.id === "swamp" || activeSkill.id === "flurry"
					? skillCooldown(
							activeSkill.id,
							item,
							effectiveStats,
							activeSkill.level,
						)
					: skillCooldown(activeSkill.id, item, effectiveStats) *
						cooldownScale(
							activeSkill.level,
							Math.min(0.8, derived.cooldownReduction + equipmentCooldown),
						);
			this.skillCooldowns.set(activeSkill.id, {
				remaining: duration,
				maximum: duration,
			});
			const castIndex = orderedSkills.findIndex(
				({ id }) => id === activeSkill.id,
			);
			this.skillPriorityCursor = orderedSkills.length
				? (castIndex + 1) % orderedSkills.length
				: 0;
		}
		const nextRotated = orderedSkills.length
			? [
					...orderedSkills.slice(
						this.skillPriorityCursor % orderedSkills.length,
					),
					...orderedSkills.slice(
						0,
						this.skillPriorityCursor % orderedSkills.length,
					),
				]
			: [];
		const nextSkill = nextRotated.find(usable);
		if (nextSkill) {
			const total = skillCastTime(
				nextSkill.id,
				nextSkill.level,
				effectiveStats.agility,
				profile.attacksPerSecond,
			);
			if (total > 0)
				this.casting = {
					id: nextSkill.id,
					elapsed: Math.min(castOverflow, total),
					total,
				};
		}
		this.tryBasicAttack(
			hero,
			target,
			targetDistance,
			item,
			effectiveStats,
			profile,
			state,
			balance,
			random,
		);
	}

	spellSlots(progress: PlayerProgress, hero: Hero): SpellSlot[] {
		return orderedSkillIds(progress).map((id) => {
			const cooldown = this.skillCooldowns.get(id);
			return {
				id,
				label: skillLabel(id),
				level: effectiveSkillLevel(progress, id),
				actualLevel: actualSkillLevel(progress, id),
				cooldown:
					id === "healing"
						? this.healingCooldown
						: id === "blocking"
							? hero.blockCooldown
							: id === "reflectiveSurge"
								? hero.reflectiveSurgeCooldown
								: (cooldown?.remaining ?? 0),
				cooldownMax:
					id === "healing"
						? this.healingCooldownMax
						: id === "blocking"
							? hero.blockCooldownMax
							: id === "reflectiveSurge"
								? hero.reflectiveSurgeCooldownMax
								: (cooldown?.maximum ?? 0),
				castProgress:
					this.casting?.id === id
						? Math.min(1, this.casting.elapsed / this.casting.total)
						: undefined,
				affordable: SKILLS[id].upkeep
					? hero.isSkillOperational(id)
					: skillAffordable(id, progress, hero),
				resource: SKILLS[id].resource,
				costLabel: skillCostLabel(id, progress),
				active: isSkillActive(progress, id),
				bar: learnedSkillIds(progress).includes(id)
					? ("learned" as const)
					: ("geared" as const),
			};
		});
	}

	get attackProgress(): number {
		return this.attackCooldownMax > 0
			? 1 - this.attackCooldown / this.attackCooldownMax
			: 1;
	}
	get attacking(): boolean {
		return this.attackCooldown > 0 || this.casting !== undefined;
	}
	get whirlwindActive(): boolean {
		return this.whirlwindRemaining > 0;
	}
	get whirlwindMovementSpeed(): number {
		return this.whirlwindActive ? this.whirlwindSpeed : 1;
	}
	get rapidRegenMultiplier(): number {
		return this.rapidRegenRemaining > 0 ? this.rapidRegenMultiplierValue : 1;
	}
	get rapidRegenFlat(): number {
		return this.rapidRegenRemaining > 0 ? 0.1 : 0;
	}
	onKill(progress: PlayerProgress, hero: Hero): number {
		this.syncSkills(progress, hero);
		const stats = statsWithItemBonuses(
			progress.stats,
			progress.mainHand,
			progress.offHand,
			progress.amulet,
			progress.charm,
		);
		const restoration = itemKillRestoration(
			stats,
			progress.mainHand,
			progress.offHand,
			progress.amulet,
			progress.charm,
		);
		hero.heal(restoration.health);
		hero.restoreMana(restoration.mana);
		if (!hero.isSkillOperational("timeHarvest")) return 0;
		const reduction = timeHarvestCooldownReduction(
			effectiveSkillLevel(progress, "timeHarvest"),
		);
		this.attackCooldown = Math.max(0, this.attackCooldown - reduction);
		this.healingCooldown = Math.max(0, this.healingCooldown - reduction);
		hero.blockCooldown = Math.max(0, hero.blockCooldown - reduction);
		for (const cooldown of this.skillCooldowns.values())
			cooldown.remaining = Math.max(0, cooldown.remaining - reduction);
		return reduction;
	}
	reset(): void {
		this.attackCooldown = 0;
		this.attackCooldownMax = 0;
		this.healingCooldown = 0;
		this.healingCooldownMax = 0;
		this.orbitCastSequence = 0;
		this.skillPriorityCursor = 0;
		this.casting = undefined;
		this.whirlwindRemaining = 0;
		this.whirlwindPulse = 0;
		this.whirlwindSpeed = 1;
		this.rapidRegenRemaining = 0;
		this.rapidRegenMultiplierValue = 1;
		this.skillCooldowns.clear();
	}
	private availableSkills(
		progress: PlayerProgress,
	): { id: SkillId; level: number }[] {
		const skills = new Map<SkillId, number>();
		for (const skill of activeSkillIds(progress))
			if (
				!SKILLS[skill].passive &&
				skill !== "healing" &&
				skill !== "blocking" &&
				skill !== "rapidRegen" &&
				skill !== "reflectiveSurge"
			)
				skills.set(skill, effectiveSkillLevel(progress, skill));
		return activeSkillIds(progress)
			.filter((id) => skills.has(id))
			.map((id) => ({ id, level: Math.max(1, skills.get(id) ?? 0) }));
	}
	private tryBasicAttack(
		hero: Hero,
		target: Creep,
		targetDistance: number,
		item: ItemInstance | undefined,
		effectiveStats: ReturnType<typeof statsWithItemBonuses>,
		profile: ReturnType<typeof attackProfile>,
		state: ArenaState,
		balance: BalanceConfig,
		random: RandomSource,
	): void {
		if (
			this.attackCooldown > 0 ||
			targetDistance > profile.range + target.radius
		)
			return;
		const strike = rollAttackStrike(
			item,
			effectiveStats,
			"hero",
			balance,
			random,
		);
		const presentation = {
			kind: profile.magic ? ("magic" as const) : ("physical" as const),
			critical: strike.critical,
		};
		hero.presentAttack(Math.min(0.8, 1 / profile.attacksPerSecond));
		const facingTarget = pointAlongFacing(
			hero.position,
			hero.facing,
			Math.max(1, targetDistance),
		);
		if (profile.projectile)
			state.projectiles.push(
				new Projectile(
					hero.position,
					facingTarget,
					strike.damage,
					"hero",
					undefined,
					hero,
					presentation,
					item,
				),
			);
		else {
			const origin = { ...hero.position };
			state.attacks.push(
				new AttackArea(
					"hero",
					origin,
					hero.facing,
					profile.range,
					item?.definitionId === "mace" ||
						item?.definitionId === "club" ||
						item?.definitionId === "hammer"
						? Math.PI
						: 0.72,
					0.18,
					0.13,
					strike.damage,
					hero,
					undefined,
					item,
					presentation,
					emittedImpactForce(hero, "radial", origin),
				),
			);
		}
		this.attackCooldown = 1 / profile.attacksPerSecond;
		this.attackCooldownMax = this.attackCooldown;
	}
}

export function pointAlongFacing(
	position: Vector2,
	facing: number,
	distanceFromSource: number,
): Vector2 {
	return {
		x: position.x + Math.cos(facing) * distanceFromSource,
		y: position.y + Math.sin(facing) * distanceFromSource,
	};
}

function closestTarget(hero: Hero, creeps: Creep[]): Creep | undefined {
	let target: Creep | undefined;
	let closest = Infinity;
	for (const creep of creeps)
		if (creep.active) {
			const current = distance(hero.position, creep.position);
			if (current < closest) {
				target = creep;
				closest = current;
			}
		}
	return target;
}
function skillManaCost(skill: SkillId): number {
	return (
		SKILLS[skill].cost ??
		(skill === "frostOrb"
			? 10
			: skill === "gravityPull"
				? 8
				: skill === "orbitingHammers"
					? 3
					: 1)
	);
}
export function skillAffordable(
	skill: SkillId,
	progress: PlayerProgress,
	hero: Hero,
): boolean {
	const definition = SKILLS[skill];
	if (definition.upkeep) return hero.isSkillOperational(skill);
	const stats = statsWithItemBonuses(
		progress.stats,
		progress.mainHand,
		...accessories(progress),
	);
	if (skill === "healing")
		return (
			hero.mana >=
			healingCast(
				hero.hp,
				hero.maxHp,
				hero.rage,
				hero.maxRage,
				effectiveSkillLevel(progress, skill),
			).manaCost *
				(1 - resourceReduction(progress, "mana", stats))
		);
	if (skill === "blocking")
		return (
			progress.offHand?.itemKind === "buckler" &&
			hero.rage >= bucklerBlockCost(progress.offHand, stats)
		);
	if (definition.resource === "mana")
		return (
			hero.mana >=
			skillManaCost(skill) * (1 - resourceReduction(progress, "mana", stats))
		);
	if (definition.resource === "life")
		return skillHealthRequirementMet(skill, hero.hp, hero.maxHp);
	const cost =
		skill === "reflectiveSurge" || skill === "whirlwind"
			? 3
			: (progress.mainHand?.rageCost ?? 1) + 0.35;
	return hero.rage >= cost;
}
function skillCostLabel(skill: SkillId, progress: PlayerProgress): string {
	const definition = SKILLS[skill];
	const stats = statsWithItemBonuses(
		progress.stats,
		progress.mainHand,
		...accessories(progress),
	);
	if (definition.passive && definition.upkeep)
		return `${formatCost(skillUpkeepPerSecond(skill, effectiveSkillLevel(progress, skill), resourceReduction(progress, "mana", stats)))} ${capitalizeResource(definition.upkeep.resource)}/s`;
	if (skill === "healing") {
		const multiplier = 1 - resourceReduction(progress, "mana", stats);
		const baseCost =
			healingBaseManaCost(effectiveSkillLevel(progress, skill)) * multiplier;
		return `${formatCost(baseCost)} Mana + ${formatCost(0.25 * multiplier)} Mana / HP`;
	}
	if (skill === "blocking")
		return `${formatCost(progress.offHand ? bucklerBlockCost(progress.offHand, stats) : 0)} Rage / block`;
	if (definition.resource === "mana")
		return `${formatCost(skillManaCost(skill) * (1 - resourceReduction(progress, "mana", stats)))} Mana`;
	if (definition.resource === "life")
		return skill === "vampiricBoomerang"
			? "max(3% Remaining HP, 1 HP)"
			: `${formatCost(10 * (1 - resourceReduction(progress, "life", stats)))}% Remaining HP`;
	return `${formatCost(skill === "reflectiveSurge" || skill === "whirlwind" ? 3 : (progress.mainHand?.rageCost ?? 1) + 0.35)} Rage`;
}
function formatCost(value: number): string {
	return Number(value.toFixed(3)).toString();
}
function capitalizeResource(resource: "mana" | "rage" | "life"): string {
	return resource[0].toUpperCase() + resource.slice(1);
}
export function forceField(
	target: {
		position: Vector2;
		velocity: Vector2;
		interruptAttack?: () => void;
	},
	source: Vector2,
	impulse: number,
): void {
	const dx = target.position.x - source.x;
	const dy = target.position.y - source.y;
	const length = Math.hypot(dx, dy);
	if (length <= 0) return;
	target.velocity.x = (dx / length) * impulse;
	target.velocity.y = (dy / length) * impulse;
	target.interruptAttack?.();
}
export function forceFieldFalloff(
	level: number,
	targetDistance: number,
): number {
	return Math.max(0, 1 - targetDistance / forceFieldRange(level));
}
export function forceFieldDamage(level: number, targetDistance = 0): number {
	return 0.6 * spellPower(level) * forceFieldFalloff(level, targetDistance);
}
export function cancelHostileProjectiles(
	projectiles: Projectile[],
	source: Unit,
	owner: Projectile["owner"],
	level: number,
): void {
	const radius = forceFieldRange(level);
	for (const projectile of projectiles)
		if (
			projectile.active &&
			projectile.owner !== owner &&
			distance(source.position, projectile.position) < radius
		)
			projectile.active = false;
}
export function castForceField(
	state: ArenaState,
	hero: Hero,
	level: number,
	random: RandomSource,
): void {
	castForceFieldTargets(hero, state.creeps, level, random);
	cancelHostileProjectiles(state.projectiles, hero, "hero", level);
}
export function castForceFieldTargets(
	source: Unit,
	targets: Unit[],
	level: number,
	random: RandomSource,
): void {
	const transferred = source.statuses.length
		? source.statuses.splice(
				Math.floor(random.next() * source.statuses.length),
				1,
			)[0]
		: undefined;
	for (const target of targets) {
		if (!target.active) continue;
		const targetDistance = distance(source.position, target.position);
		const falloff = forceFieldFalloff(level, targetDistance);
		if (falloff <= 0) continue;
		const dealt = target.receiveDamage(
			forceFieldDamage(level, targetDistance),
			random,
			source,
			false,
			false,
			{ kind: "magic" },
		);
		if (dealt > 0 && transferred)
			target.addStatus({
				kind: transferred.kind,
				remaining: transferred.remaining,
				damagePerSecond: transferred.damagePerSecond,
				source,
			});
		if (dealt > 0) forceField(target, source.position, 180 * falloff);
	}
}
export function learnedSkillIds(progress: PlayerProgress): SkillId[] {
	return [...new Set(progress.learnedSkills)];
}
export function gearedSkillIds(progress: PlayerProgress): SkillId[] {
	const learned = new Set(learnedSkillIds(progress));
	return [
		...new Set<SkillId>([
			...(progress.mainHand?.skills ?? []),
			...accessories(progress).flatMap((item) => item?.skills ?? []),
		]),
	].filter((skill) => !learned.has(skill));
}
export function isSkillAvailable(
	progress: PlayerProgress,
	skill: SkillId,
): boolean {
	return (
		learnedSkillIds(progress).includes(skill) ||
		gearedSkillIds(progress).includes(skill)
	);
}
export function availableSkillIds(progress: PlayerProgress): SkillId[] {
	return [...learnedSkillIds(progress), ...gearedSkillIds(progress)];
}
export function orderedSkillIds(progress: PlayerProgress): SkillId[] {
	return availableSkillIds(progress);
}
export function activeSkillIds(progress: PlayerProgress): SkillId[] {
	const disabled = new Set(progress.disabledSkills ?? []);
	return availableSkillIds(progress).filter((skill) => !disabled.has(skill));
}
export function isSkillActive(
	progress: PlayerProgress,
	skill: SkillId,
): boolean {
	return activeSkillIds(progress).includes(skill);
}
export function actualSkillLevel(
	progress: PlayerProgress,
	skill: SkillId,
): number {
	if (!isSkillAvailable(progress, skill)) return 0;
	const learned =
		progress.learnedSkillLevels[skill] ??
		(progress.learnedSkills.includes(skill) ? 1 : 0);
	const equipped =
		progress.mainHand?.skills.includes(skill) ||
		accessories(progress).some((item) => item?.skills.includes(skill))
			? 1
			: 0;
	const stats = statsWithItemBonuses(
		progress.stats,
		progress.mainHand,
		...accessories(progress),
	);
	const accessory = accessories(progress).reduce(
		(sum, candidate) =>
			sum +
			itemSkillLevelBonus(candidate, SKILLS[skill].resource) *
				(candidate ? itemRequirementMultiplier(candidate, stats) : 1),
		0,
	);
	const timeHarvestBonus =
		skill === "timeHarvest" && progress.amulet?.skills.includes(skill)
			? timeHarvestItemSkillBonus(progress.amulet.level)
			: 0;
	return cappedSkillLevel(
		learned + equipped + Math.floor(accessory) + timeHarvestBonus,
	);
}
export function effectiveSkillLevel(
	progress: PlayerProgress,
	skill: SkillId,
): number {
	return Math.min(actualSkillLevel(progress, skill), progress.level);
}
function accessories(
	progress: PlayerProgress,
): Array<ItemInstance | undefined> {
	return [progress.offHand, progress.amulet, progress.charm];
}
export function resourceReduction(
	progress: PlayerProgress,
	resource: "mana" | "life",
	stats: ReturnType<typeof statsWithItemBonuses>,
): number {
	return Math.min(
		0.9,
		accessories(progress).reduce(
			(sum, item) => sum + itemResourceCostReduction(item, resource, stats),
			0,
		),
	);
}
export function skillHealthRequirementMet(
	skill: SkillId,
	currentHp: number,
	_maxHp: number,
): boolean {
	return SKILLS[skill].resource !== "life" || currentHp > 1;
}
export function bloodSkillLifeCost(
	skill: SkillId,
	currentHp: number,
	lifeCostReduction = 0,
): number {
	if (SKILLS[skill].resource !== "life" || currentHp <= 1) return 0;
	const reduction = 1 - Math.min(0.9, Math.max(0, lifeCostReduction));
	const rawCost =
		skill === "vampiricBoomerang"
			? Math.max(currentHp * 0.03 * reduction, 1)
			: currentHp * 0.1 * reduction;
	return Math.min(rawCost, currentHp - 1);
}
export function bloodSkillDamage(
	skill: SkillId,
	level: number,
	baseDamage: number,
	hpSpent: number,
): number {
	if (skill === "vampiricBoomerang")
		return baseDamage + hpSpent * (1 + level / 10);
	return (
		(baseDamage + hpSpent) * skillDamageMultiplier(skill) * spellPower(level)
	);
}
