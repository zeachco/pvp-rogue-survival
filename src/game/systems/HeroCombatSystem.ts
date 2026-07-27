import type { BalanceConfig } from "../../../common/balance";
import { attackProfile, cappedSkillLevel, cooldownScale, forceFieldRange, healingCast, healingCooldown, orbitingHammerDuration, rapidRegenDuration, rapidRegenMultiplier, rollAttackStrike, skillCooldown, skillDamageMultiplier, skillLabel, skillRange, spellPower, swampRadius, timeHarvestCooldownReduction, timeHarvestItemSkillBonus, vampiricBoomerangHealingFraction, whirlwindDamage, whirlwindDuration, whirlwindMovementSpeed, whirlwindRadius } from "../../../common/combat";
import { itemCooldownReduction, itemRequirementMultiplier, itemResourceCostReduction, itemSkillLevelBonus, statsWithItemBonuses, type ItemInstance, type SkillId } from "../../../common/items";
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
  private readonly skillCooldowns = new Map<SkillId, { remaining: number; maximum: number }>();
  private orbitCastSequence = 0;
  private skillPriorityCursor = 0;
  private whirlwindRemaining = 0; private whirlwindPulse = 0; private whirlwindRange = 0; private whirlwindHitDamage = 0; private whirlwindSpeed = 1;
  private rapidRegenRemaining = 0; private rapidRegenMultiplierValue = 1;
  update(deltaSeconds: number, movementInput: Vector2, hero: Hero, state: ArenaState, progress: PlayerProgress, balance: BalanceConfig, random: RandomSource): void {
    this.attackCooldown = Math.max(0, this.attackCooldown - deltaSeconds); this.healingCooldown = Math.max(0, this.healingCooldown - deltaSeconds); this.rapidRegenRemaining = Math.max(0, this.rapidRegenRemaining - deltaSeconds); for (const cooldown of this.skillCooldowns.values()) cooldown.remaining = Math.max(0, cooldown.remaining - deltaSeconds); if (this.whirlwindRemaining > 0) { this.whirlwindRemaining = Math.max(0, this.whirlwindRemaining - deltaSeconds); this.whirlwindPulse -= deltaSeconds; while (this.whirlwindPulse <= 0 && this.whirlwindRemaining > 0) { const force = emittedImpactForce(hero, "radial", hero.position); for (const creep of state.creeps) if (creep.active && distance(hero.position, creep.position) <= this.whirlwindRange + creep.radius) { const dealt = creep.receiveDamage(this.whirlwindHitDamage, random, hero, false, false, { kind: "physical" }); if (dealt > 0) applyImpactForce(creep, force); } this.whirlwindPulse += 0.25; } }
    const item = progress.mainHand; const effectiveStats = statsWithItemBonuses(progress.stats, item, progress.offHand, progress.amulet, progress.charm); const derived = derivedStats(effectiveStats);
    hero.knownSkills.clear(); hero.skillLevels.clear(); for (const skill of availableSkillIds(progress)) { hero.knownSkills.add(skill); hero.skillLevels.set(skill, effectiveSkillLevel(progress, skill)); }
    const healing = healingCast(hero.hp, hero.maxHp, hero.stamina, hero.maxStamina, effectiveSkillLevel(progress, "healing")); const healingManaCost = healing.manaCost * (1 - resourceReduction(progress, "mana", effectiveStats));
    if (isSkillActive(progress, "healing") && hero.hp < hero.maxHp * 0.75 && this.healingCooldown === 0 && healing.restoredHp > 0 && hero.mana >= healingManaCost) {
      const level = effectiveSkillLevel(progress, "healing"); hero.mana -= healingManaCost;
      hero.heal(healing.restoredHp);
      state.spellEffects.push(new SpellEffect("healing", hero.position));
      this.healingCooldown = healingCooldown(level); this.healingCooldownMax = this.healingCooldown;
    }
    const rapidRegenLevel = effectiveSkillLevel(progress, "rapidRegen"); const rapidRegenCost = skillManaCost("rapidRegen") * (1 - resourceReduction(progress, "mana", effectiveStats));
    if (isSkillActive(progress, "rapidRegen") && rapidRegenLevel > 0 && hero.hp < hero.maxHp && this.rapidRegenRemaining === 0 && (this.skillCooldowns.get("rapidRegen")?.remaining ?? 0) === 0 && hero.mana >= rapidRegenCost) {
      hero.mana -= rapidRegenCost; this.rapidRegenRemaining = rapidRegenDuration(rapidRegenLevel); this.rapidRegenMultiplierValue = rapidRegenMultiplier(rapidRegenLevel); state.spellEffects.push(new SpellEffect("rapidRegen", hero.position, 0, 0, this.rapidRegenRemaining, hero));
      const equipmentCooldown = itemCooldownReduction(...accessories(progress)); const duration = skillCooldown("rapidRegen", item, effectiveStats) * cooldownScale(rapidRegenLevel, Math.min(.8, derived.cooldownReduction + equipmentCooldown)); this.skillCooldowns.set("rapidRegen", { remaining: duration, maximum: duration });
    }
    const target = closestTarget(hero, state.creeps);
    if (!target) { if (movementInput.x || movementInput.y) hero.facing = Math.atan2(movementInput.y, movementInput.x); return; }
    hero.facing = Math.atan2(target.position.y - hero.position.y, target.position.x - hero.position.x);
    const targetDistance = distance(hero.position, target.position);
    const profile = attackProfile(item, effectiveStats, balance); const orderedSkills = this.availableSkills(progress); const rotatedSkills = orderedSkills.length ? [...orderedSkills.slice(this.skillPriorityCursor % orderedSkills.length), ...orderedSkills.slice(0, this.skillPriorityCursor % orderedSkills.length)] : []; const manaReduction = resourceReduction(progress, "mana", effectiveStats); const lifeReduction = resourceReduction(progress, "life", effectiveStats); const candidate = rotatedSkills.find(({ id }) => { if ((this.skillCooldowns.get(id)?.remaining ?? 0) > 0) return false; const definition = SKILLS[id]; if (definition.resource === "mana") return hero.mana >= skillManaCost(id) * (1 - manaReduction); if (definition.resource === "life") return skillHealthRequirementMet(id, hero.hp, hero.maxHp); const cost = id === "reflectiveSurge" || id === "whirlwind" ? 3 : profile.staminaCost + .35; return hero.stamina >= cost; });
    const manaCost = candidate ? skillManaCost(candidate.id) * (1 - manaReduction) : 0; const staminaSkillCost = candidate?.id === "reflectiveSurge" || candidate?.id === "whirlwind" ? 3 : profile.staminaCost + 0.35; const magicSkill = Boolean(candidate && SKILLS[candidate.id].resource === "mana" && hero.mana >= manaCost);
    const physicalSkill = Boolean(candidate && SKILLS[candidate.id].resource === "stamina" && hero.stamina >= staminaSkillCost);
    const lifeSkill = Boolean(candidate && SKILLS[candidate.id].resource === "life" && skillHealthRequirementMet(candidate.id, hero.hp, hero.maxHp));
    const activeSkill = magicSkill || physicalSkill || lifeSkill ? candidate : undefined;
    const range = activeSkill ? activeSkill.id === "swamp" ? 600 : skillRange(activeSkill.id, item, activeSkill.level, effectiveStats.spirit) : profile.range;
    const ranged = activeSkill ? activeSkill.id === "arcaneBolt" || activeSkill.id === "rendingThrow" || activeSkill.id === "orbitingHammers" || activeSkill.id === "frostOrb" : profile.projectile;
    const staminaCost = magicSkill || lifeSkill ? 0 : physicalSkill ? staminaSkillCost : profile.staminaCost;
    if (targetDistance > range + target.radius || this.attackCooldown > 0 || hero.stamina < staminaCost) return;
    const lifeCost = lifeSkill && candidate ? bloodSkillLifeCost(candidate.id, hero.hp, lifeReduction) : 0; hero.stamina -= staminaCost; if (magicSkill) hero.mana -= manaCost; if (lifeCost > 0) hero.takeDamage(lifeCost);
    const strike = activeSkill?.id === "swamp" ? { damage: 0, critical: false } : rollAttackStrike(item, effectiveStats, "hero", balance, random); const damage = activeSkill && SKILLS[activeSkill.id].resource === "life" ? bloodSkillDamage(activeSkill.id, activeSkill.level, strike.damage, lifeCost) : strike.damage * (activeSkill ? skillDamageMultiplier(activeSkill.id) * spellPower(activeSkill.level) : 1); const presentation = { kind: activeSkill?.id === "arcaneBolt" || activeSkill?.id === "orbitingHammers" || activeSkill?.id === "frostOrb" || activeSkill?.id === "swamp" || (!activeSkill && profile.magic) ? "magic" as const : "physical" as const, critical: strike.critical };
    if (activeSkill?.id === "orbitingHammers") { const sequence = this.orbitCastSequence++; const lifetime = orbitingHammerDuration(activeSkill.level); for (let index = 0; index < 3; index += 1) { const drift = (((sequence * 3 + index) % 7) - 3) * 0.035; state.projectiles.push(Projectile.orbitingHammer(hero, hero.facing + index * Math.PI * 2 / 3, damage, { kind: "magic", critical: strike.critical }, drift, lifetime)); } }
    else if (activeSkill?.id === "vampiricBoomerang" && item) state.projectiles.push(Projectile.vampiricBoomerang(hero, target.position, damage, range, vampiricBoomerangHealingFraction(activeSkill.level), item));
    else if (activeSkill?.id === "frostOrb") state.projectiles.push(new Projectile(hero.position, target.position, damage, "hero", "frostOrb", hero, presentation, item));
    else if (activeSkill?.id === "swamp") state.swamps.push(new GroundSwamp({ ...target.position }, swampRadius(activeSkill.level), hero));
    else if (activeSkill?.id === "gravityPull" && item) castForceField(state, hero, activeSkill.level, random);
    else if (activeSkill?.id === "reflectiveSurge") hero.reflectiveSurgeRemaining = 6;
    else if (activeSkill?.id === "whirlwind") { this.whirlwindRemaining = whirlwindDuration(activeSkill.level); this.whirlwindPulse = 0; this.whirlwindRange = whirlwindRadius(activeSkill.level); this.whirlwindHitDamage = whirlwindDamage(effectiveStats.strength); this.whirlwindSpeed = whirlwindMovementSpeed(activeSkill.level); state.spellEffects.push(new SpellEffect("whirlwind", hero.position, 0, this.whirlwindRange, this.whirlwindRemaining, hero)); }
    else if (activeSkill?.id === "fireBreath") state.attacks.push(new AttackArea("hero", { ...hero.position }, hero.facing, range, 0.62, 0.22, 0.18, damage, hero, "fireBreath", item, { kind: "fire", critical: strike.critical }));
    else if (ranged) state.projectiles.push(new Projectile(hero.position, target.position, damage, "hero", activeSkill?.id === "arcaneBolt" || activeSkill?.id === "rendingThrow" ? activeSkill.id : undefined, hero, presentation, item));
    else { const origin = { ...hero.position }; state.attacks.push(new AttackArea("hero", origin, hero.facing, range, activeSkill?.id === "bash" || activeSkill?.id === "sweep" || activeSkill?.id === "shockwave" || activeSkill?.id === "rent" || (!activeSkill && (item?.definitionId === "mace" || item?.definitionId === "club" || item?.definitionId === "hammer")) ? Math.PI : activeSkill?.id === "cleave" ? 1.8 : activeSkill?.id === "flurry" ? 1.1 : 0.72, 0.18, 0.13, damage, hero, activeSkill?.id, item, presentation, emittedImpactForce(hero, "radial", origin))); }
    if (activeSkill && activeSkill.id !== "whirlwind" && activeSkill.id !== "swamp") state.spellEffects.push(new SpellEffect(activeSkill.id, hero.position, hero.facing, range));
    if (activeSkill) { const equipmentCooldown = itemCooldownReduction(...accessories(progress)); const duration = activeSkill.id === "swamp" || activeSkill.id === "flurry" ? skillCooldown(activeSkill.id, item, effectiveStats, activeSkill.level) : skillCooldown(activeSkill.id, item, effectiveStats) * cooldownScale(activeSkill.level, Math.min(.8, derived.cooldownReduction + equipmentCooldown)); this.skillCooldowns.set(activeSkill.id, { remaining: duration, maximum: duration }); const castIndex = orderedSkills.findIndex(({ id }) => id === activeSkill.id); this.skillPriorityCursor = orderedSkills.length ? (castIndex + 1) % orderedSkills.length : 0; }
    this.attackCooldown = (activeSkill?.id === "flurry" ? 0.35 : 1) / profile.attacksPerSecond;
    this.attackCooldownMax = this.attackCooldown;
  }

  spellSlots(progress: PlayerProgress, hero: Hero): SpellSlot[] {
    return orderedSkillIds(progress).map((id) => { const cooldown = this.skillCooldowns.get(id); return { id, label: skillLabel(id), level: effectiveSkillLevel(progress, id), actualLevel: actualSkillLevel(progress, id), cooldown: id === "healing" ? this.healingCooldown : id === "blocking" ? hero.blockCooldown : cooldown?.remaining ?? 0, cooldownMax: id === "healing" ? this.healingCooldownMax : id === "blocking" ? hero.blockCooldownMax : cooldown?.maximum ?? 0, resource: SKILLS[id].resource, costLabel: skillCostLabel(id, progress), active: true, bar: learnedSkillIds(progress).includes(id) ? "learned" as const : "geared" as const }; });
  }

  get attackProgress(): number { return this.attackCooldownMax > 0 ? 1 - this.attackCooldown / this.attackCooldownMax : 1; }
  get whirlwindActive(): boolean { return this.whirlwindRemaining > 0; }
  get whirlwindMovementSpeed(): number { return this.whirlwindActive ? this.whirlwindSpeed : 1; }
  get rapidRegenMultiplier(): number { return this.rapidRegenRemaining > 0 ? this.rapidRegenMultiplierValue : 1; }
  get rapidRegenFlat(): number { return this.rapidRegenRemaining > 0 ? .1 : 0; }
  onKill(progress: PlayerProgress, hero: Hero): number {
    if (!isSkillActive(progress, "timeHarvest")) return 0;
    const reduction = timeHarvestCooldownReduction(effectiveSkillLevel(progress, "timeHarvest"));
    this.attackCooldown = Math.max(0, this.attackCooldown - reduction);
    this.healingCooldown = Math.max(0, this.healingCooldown - reduction);
    hero.blockCooldown = Math.max(0, hero.blockCooldown - reduction);
    for (const cooldown of this.skillCooldowns.values()) cooldown.remaining = Math.max(0, cooldown.remaining - reduction);
    return reduction;
  }
  reset(): void { this.attackCooldown = 0; this.attackCooldownMax = 0; this.healingCooldown = 0; this.healingCooldownMax = 0; this.orbitCastSequence = 0; this.skillPriorityCursor = 0; this.whirlwindRemaining = 0; this.whirlwindPulse = 0; this.whirlwindSpeed = 1; this.rapidRegenRemaining = 0; this.rapidRegenMultiplierValue = 1; this.skillCooldowns.clear(); }
  private availableSkills(progress: PlayerProgress): { id: SkillId; level: number }[] {
    const skills = new Map<SkillId, number>();
    for (const skill of orderedSkillIds(progress)) if (!SKILLS[skill].passive && skill !== "healing" && skill !== "blocking") skills.set(skill, effectiveSkillLevel(progress, skill));
    return orderedSkillIds(progress).filter((id) => skills.has(id)).map((id) => ({ id, level: Math.max(1, skills.get(id) ?? 0) }));
  }
}

function closestTarget(hero: Hero, creeps: Creep[]): Creep | undefined { let target: Creep | undefined; let closest = Infinity; for (const creep of creeps) if (creep.active) { const current = distance(hero.position, creep.position); if (current < closest) { target = creep; closest = current; } } return target; }
function skillManaCost(skill: SkillId): number { return SKILLS[skill].cost ?? (skill === "frostOrb" ? 10 : skill === "gravityPull" ? 8 : skill === "orbitingHammers" ? 3 : 1); }
function skillCostLabel(skill: SkillId, progress: PlayerProgress): string { const definition = SKILLS[skill]; if (definition.passive) return `0 ${capitalizeResource(definition.resource)}`; const stats = statsWithItemBonuses(progress.stats, progress.mainHand, ...accessories(progress)); if (skill === "healing") return `${formatCost(2 * (1 - resourceReduction(progress, "mana", stats)))} Mana / HP`; if (skill === "blocking") return `${formatCost(progress.offHand?.staminaCost ?? 0)} Stamina`; if (definition.resource === "mana") return `${formatCost(skillManaCost(skill) * (1 - resourceReduction(progress, "mana", stats)))} Mana`; if (definition.resource === "life") return `${formatCost((skill === "vampiricBoomerang" ? 30 : 10) * (1 - resourceReduction(progress, "life", stats)))}% Remaining HP`; return `${formatCost(skill === "reflectiveSurge" || skill === "whirlwind" ? 3 : (progress.mainHand?.staminaCost ?? 1) + 0.35)} Stamina`; }
function formatCost(value: number): string { return Number(value.toFixed(3)).toString(); }
function capitalizeResource(resource: "mana" | "stamina" | "life"): string { return resource[0].toUpperCase() + resource.slice(1); }
export function forceField(target: { position: Vector2; velocity: Vector2; interruptAttack?: () => void }, source: Vector2, impulse: number): void { const dx = target.position.x - source.x; const dy = target.position.y - source.y; const length = Math.hypot(dx, dy); if (length <= 0) return; target.velocity.x = dx / length * impulse; target.velocity.y = dy / length * impulse; target.interruptAttack?.(); }
export function forceFieldFalloff(level: number, targetDistance: number): number { return Math.max(0, 1 - targetDistance / forceFieldRange(level)); }
export function forceFieldDamage(level: number, targetDistance = 0): number { return 0.6 * spellPower(level) * forceFieldFalloff(level, targetDistance); }
export function cancelHostileProjectiles(projectiles: Projectile[], source: Unit, owner: Projectile["owner"], level: number): void { const radius = forceFieldRange(level); for (const projectile of projectiles) if (projectile.active && projectile.owner !== owner && distance(source.position, projectile.position) < radius) projectile.active = false; }
export function castForceField(state: ArenaState, hero: Hero, level: number, random: RandomSource): void { castForceFieldTargets(hero, state.creeps, level, random); cancelHostileProjectiles(state.projectiles, hero, "hero", level); }
export function castForceFieldTargets(source: Unit, targets: Unit[], level: number, random: RandomSource): void {
  const transferred = source.statuses.length ? source.statuses.splice(Math.floor(random.next() * source.statuses.length), 1)[0] : undefined;
  for (const target of targets) {
    if (!target.active) continue;
    const targetDistance = distance(source.position, target.position); const falloff = forceFieldFalloff(level, targetDistance);
    if (falloff <= 0) continue;
    const dealt = target.receiveDamage(forceFieldDamage(level, targetDistance), random, source, false, false, { kind: "magic" });
    if (dealt > 0 && transferred) target.addStatus({ kind: transferred.kind, remaining: transferred.remaining, damagePerSecond: transferred.damagePerSecond, source });
    if (dealt > 0) forceField(target, source.position, 180 * falloff);
  }
}
export function learnedSkillIds(progress: PlayerProgress): SkillId[] { return [...new Set(progress.learnedSkills)]; }
export function gearedSkillIds(progress: PlayerProgress): SkillId[] { const learned = new Set(learnedSkillIds(progress)); return [...new Set<SkillId>([...(progress.mainHand?.skills ?? []), ...accessories(progress).flatMap((item) => item?.skills ?? [])])].filter((skill) => !learned.has(skill)); }
export function isSkillAvailable(progress: PlayerProgress, skill: SkillId): boolean { return learnedSkillIds(progress).includes(skill) || gearedSkillIds(progress).includes(skill); }
export function availableSkillIds(progress: PlayerProgress): SkillId[] { return [...learnedSkillIds(progress), ...gearedSkillIds(progress)]; }
export function orderedSkillIds(progress: PlayerProgress): SkillId[] { const available = availableSkillIds(progress); const ordered = (progress.skillOrder ?? []).filter((skill) => available.includes(skill)); return [...ordered, ...available.filter((skill) => !ordered.includes(skill))]; }
export function activeSkillIds(progress: PlayerProgress): SkillId[] { return availableSkillIds(progress); }
export function isSkillActive(progress: PlayerProgress, skill: SkillId): boolean { return activeSkillIds(progress).includes(skill); }
export function actualSkillLevel(progress: PlayerProgress, skill: SkillId): number { if (!isSkillAvailable(progress, skill)) return 0; const learned = progress.learnedSkillLevels[skill] ?? (progress.learnedSkills.includes(skill) ? 1 : 0); const equipped = progress.mainHand?.skills.includes(skill) || accessories(progress).some((item) => item?.skills.includes(skill)) ? 1 : 0; const stats = statsWithItemBonuses(progress.stats, progress.mainHand, ...accessories(progress)); const accessory = accessories(progress).reduce((sum, candidate) => sum + itemSkillLevelBonus(candidate, SKILLS[skill].resource) * (candidate ? itemRequirementMultiplier(candidate, stats) : 1), 0); const timeHarvestBonus = skill === "timeHarvest" && progress.amulet?.skills.includes(skill) ? timeHarvestItemSkillBonus(progress.amulet.level) : 0; return cappedSkillLevel(learned + equipped + Math.floor(accessory) + timeHarvestBonus); }
export function effectiveSkillLevel(progress: PlayerProgress, skill: SkillId): number { return Math.min(actualSkillLevel(progress, skill), progress.level); }
function accessories(progress: PlayerProgress): Array<ItemInstance | undefined> { return [progress.offHand, progress.amulet, progress.charm]; }
function resourceReduction(progress: PlayerProgress, resource: "mana" | "life", stats: ReturnType<typeof statsWithItemBonuses>): number { return Math.min(.9, accessories(progress).reduce((sum, item) => sum + itemResourceCostReduction(item, resource, stats), 0)); }
export function skillHealthRequirementMet(skill: SkillId, currentHp: number, _maxHp: number): boolean { return SKILLS[skill].resource !== "life" || currentHp > 1; }
export function bloodSkillLifeCost(skill: SkillId, currentHp: number, lifeCostReduction = 0): number {
  if (SKILLS[skill].resource !== "life" || currentHp <= 1) return 0;
  const fraction = skill === "vampiricBoomerang" ? 0.3 : 0.1;
  return Math.min(currentHp * fraction * (1 - Math.min(0.9, Math.max(0, lifeCostReduction))), currentHp - 1);
}
export function bloodSkillDamage(skill: SkillId, level: number, baseDamage: number, hpSpent: number): number {
  return (baseDamage + hpSpent) * skillDamageMultiplier(skill) * spellPower(level);
}
