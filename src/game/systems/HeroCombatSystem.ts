import type { BalanceConfig } from "../../../common/balance";
import { attackProfile, cappedSkillLevel, cooldownScale, healingCast, healingCooldown, rollAttackStrike, skillCooldown, skillDamageMultiplier, skillLabel, skillRange, spellPower, vampiricBoomerangHealingFraction, whirlwindDamage, whirlwindDuration, whirlwindRadius } from "../../../common/combat";
import { itemCooldownReduction, itemRequirementMultiplier, itemResourceCostReduction, itemSkillLevelBonus, statsWithItemBonuses, type ItemInstance, type SkillId } from "../../../common/items";
import { derivedStats } from "../../../common/progression";
import type { PlayerProgress } from "../../../common/protocol";
import type { RandomSource } from "../../../common/random";
import type { SpellSlot } from "../../ui/types";
import { AttackArea } from "../AttackArea";
import type { ArenaState } from "../ArenaState";
import type { Creep } from "../Creep";
import type { Hero } from "../Hero";
import { Projectile } from "../Projectile";
import { distance, type Vector2 } from "../types";
import { SpellEffect } from "../SpellEffect";
import { SKILLS } from "../../../common/content";

export class HeroCombatSystem {
  private attackCooldown = 0;
  private attackCooldownMax = 0;
  private healingCooldown = 0;
  private healingCooldownMax = 0;
  private readonly skillCooldowns = new Map<SkillId, { remaining: number; maximum: number }>();
  private orbitCastSequence = 0;
  private skillPriorityCursor = 0;
  private whirlwindRemaining = 0; private whirlwindPulse = 0; private whirlwindRange = 0; private whirlwindHitDamage = 0;
  readonly disabledSkills = new Set<SkillId>();
  toggleSkill(skill: SkillId): void { if (this.disabledSkills.has(skill)) this.disabledSkills.delete(skill); else this.disabledSkills.add(skill); }

  update(deltaSeconds: number, movementInput: Vector2, hero: Hero, state: ArenaState, progress: PlayerProgress, balance: BalanceConfig, random: RandomSource): void {
    this.attackCooldown = Math.max(0, this.attackCooldown - deltaSeconds); this.healingCooldown = Math.max(0, this.healingCooldown - deltaSeconds); for (const cooldown of this.skillCooldowns.values()) cooldown.remaining = Math.max(0, cooldown.remaining - deltaSeconds); if (this.whirlwindRemaining > 0) { this.whirlwindRemaining = Math.max(0, this.whirlwindRemaining - deltaSeconds); this.whirlwindPulse -= deltaSeconds; while (this.whirlwindPulse <= 0 && this.whirlwindRemaining > 0) { for (const creep of state.creeps) if (creep.active && distance(hero.position, creep.position) <= this.whirlwindRange + creep.radius) creep.receiveDamage(this.whirlwindHitDamage, random, hero, false, false, { kind: "physical" }); this.whirlwindPulse += 0.25; } }
    const item = progress.mainHand; const effectiveStats = statsWithItemBonuses(progress.stats, item, progress.offHand, progress.amulet, progress.charm); const derived = derivedStats(effectiveStats);
    hero.knownSkills.clear(); hero.skillLevels.clear(); for (const skill of new Set([...progress.learnedSkills, ...(item?.skills ?? []), ...accessories(progress).flatMap((candidate) => candidate?.skills ?? [])])) if (isSkillAvailable(progress, skill) && !this.disabledSkills.has(skill)) { hero.knownSkills.add(skill); hero.skillLevels.set(skill, effectiveSkillLevel(progress, skill)); }
    const healing = healingCast(hero.hp, hero.maxHp, effectiveSkillLevel(progress, "healing")); const healingManaCost = healing.manaCost * (1 - resourceReduction(progress, "mana", effectiveStats));
    if (!this.disabledSkills.has("healing") && progress.learnedSkills.includes("healing") && hero.hp < hero.maxHp * 0.5 && this.healingCooldown === 0 && healing.restoredHp > 0 && hero.mana >= healingManaCost) {
      const level = effectiveSkillLevel(progress, "healing"); hero.mana -= healingManaCost;
      hero.heal(healing.restoredHp);
      state.spellEffects.push(new SpellEffect("healing", hero.position));
      this.healingCooldown = healingCooldown(level); this.healingCooldownMax = this.healingCooldown;
    }
    const target = closestTarget(hero, state.creeps);
    if (!target) { if (movementInput.x || movementInput.y) hero.facing = Math.atan2(movementInput.y, movementInput.x); return; }
    hero.facing = Math.atan2(target.position.y - hero.position.y, target.position.x - hero.position.x);
    const targetDistance = distance(hero.position, target.position);
    const profile = attackProfile(item, effectiveStats, balance); const orderedSkills = item ? this.availableSkills(progress, item) : []; const rotatedSkills = orderedSkills.length ? [...orderedSkills.slice(this.skillPriorityCursor % orderedSkills.length), ...orderedSkills.slice(0, this.skillPriorityCursor % orderedSkills.length)] : []; const manaReduction = resourceReduction(progress, "mana", effectiveStats); const lifeReduction = resourceReduction(progress, "life", effectiveStats); const candidate = rotatedSkills.find(({ id }) => { if ((this.skillCooldowns.get(id)?.remaining ?? 0) > 0) return false; const definition = SKILLS[id]; if (definition.resource === "mana") return hero.mana >= skillManaCost(id) * (1 - manaReduction); if (definition.resource === "life") return skillHealthRequirementMet(id, hero.hp, hero.maxHp); const cost = id === "reflectiveSurge" || id === "whirlwind" ? 3 : profile.staminaCost + .35; return hero.stamina >= cost; });
    const manaCost = candidate ? skillManaCost(candidate.id) * (1 - manaReduction) : 0; const staminaSkillCost = candidate?.id === "reflectiveSurge" || candidate?.id === "whirlwind" ? 3 : profile.staminaCost + 0.35; const magicSkill = Boolean(candidate && SKILLS[candidate.id].resource === "mana" && hero.mana >= manaCost);
    const physicalSkill = Boolean(candidate && SKILLS[candidate.id].resource === "stamina" && hero.stamina >= staminaSkillCost);
    const lifeSkill = Boolean(candidate && SKILLS[candidate.id].resource === "life" && skillHealthRequirementMet(candidate.id, hero.hp, hero.maxHp));
    const activeSkill = magicSkill || physicalSkill || lifeSkill ? candidate : undefined;
    const range = activeSkill && item ? skillRange(activeSkill.id, item, activeSkill.level, effectiveStats.spirit) : profile.range;
    const ranged = activeSkill ? activeSkill.id === "arcaneBolt" || activeSkill.id === "rendingThrow" || activeSkill.id === "orbitingHammers" || activeSkill.id === "frostOrb" : profile.projectile;
    const staminaCost = magicSkill || lifeSkill ? 0 : physicalSkill ? staminaSkillCost : profile.staminaCost;
    if (targetDistance > range + target.radius || this.attackCooldown > 0 || hero.stamina < staminaCost) return;
    const lifeFraction = candidate?.id === "vampiricBoomerang" ? .3 : .1; const lifeCost = lifeSkill ? Math.min(hero.maxHp * lifeFraction * (1 - lifeReduction), Math.max(0, hero.hp - 1)) : 0; hero.stamina -= staminaCost; if (magicSkill) hero.mana -= manaCost; if (lifeCost > 0) hero.takeDamage(lifeCost);
    const strike = rollAttackStrike(item, effectiveStats, "hero", balance, random); const damage = (strike.damage + lifeCost) * (activeSkill ? skillDamageMultiplier(activeSkill.id) * spellPower(activeSkill.level) : 1); const presentation = { kind: activeSkill?.id === "arcaneBolt" || activeSkill?.id === "orbitingHammers" || activeSkill?.id === "frostOrb" || (!activeSkill && profile.magic) ? "magic" as const : "physical" as const, critical: strike.critical };
    if (activeSkill?.id === "orbitingHammers") { const sequence = this.orbitCastSequence++; for (let index = 0; index < 3; index += 1) { const drift = (((sequence * 3 + index) % 7) - 3) * 0.035; state.projectiles.push(Projectile.orbitingHammer(hero, hero.facing + index * Math.PI * 2 / 3, damage, { kind: "magic", critical: strike.critical }, drift)); } }
    else if (activeSkill?.id === "vampiricBoomerang" && item) state.projectiles.push(Projectile.vampiricBoomerang(hero, target.position, damage, range, vampiricBoomerangHealingFraction(activeSkill.level), item));
    else if (activeSkill?.id === "frostOrb") state.projectiles.push(new Projectile(hero.position, target.position, damage, "hero", "frostOrb", hero, presentation, item));
    else if (activeSkill?.id === "gravityPull" && item) castForceField(state, hero, activeSkill.level, random);
    else if (activeSkill?.id === "reflectiveSurge") hero.reflectiveSurgeRemaining = 6;
    else if (activeSkill?.id === "whirlwind") { this.whirlwindRemaining = whirlwindDuration(effectiveStats.spirit); this.whirlwindPulse = 0; this.whirlwindRange = whirlwindRadius(activeSkill.level); this.whirlwindHitDamage = whirlwindDamage(effectiveStats.strength); state.spellEffects.push(new SpellEffect("whirlwind", hero.position, 0, this.whirlwindRange, this.whirlwindRemaining, hero)); }
    else if (activeSkill?.id === "fireBreath") state.attacks.push(new AttackArea("hero", { ...hero.position }, hero.facing, range, 0.62, 0.22, 0.18, damage, hero, "fireBreath", item, { kind: "fire", critical: strike.critical }));
    else if (ranged) state.projectiles.push(new Projectile(hero.position, target.position, damage, "hero", activeSkill?.id === "arcaneBolt" || activeSkill?.id === "rendingThrow" ? activeSkill.id : undefined, hero, presentation, item));
    else state.attacks.push(new AttackArea("hero", { ...hero.position }, hero.facing, range, activeSkill?.id === "bash" || activeSkill?.id === "sweep" || activeSkill?.id === "shockwave" || activeSkill?.id === "rent" || (!activeSkill && (item?.definitionId === "mace" || item?.definitionId === "club" || item?.definitionId === "hammer")) ? Math.PI : activeSkill?.id === "cleave" ? 1.8 : activeSkill?.id === "flurry" ? 1.1 : 0.72, 0.18, 0.13, damage, hero, activeSkill?.id, item, presentation));
    if (activeSkill && activeSkill.id !== "whirlwind") state.spellEffects.push(new SpellEffect(activeSkill.id, hero.position, hero.facing, range));
    if (activeSkill) { const equipmentCooldown = itemCooldownReduction(...accessories(progress)); const duration = skillCooldown(activeSkill.id, item, effectiveStats) * cooldownScale(activeSkill.level, Math.min(.8, derived.cooldownReduction + equipmentCooldown)); this.skillCooldowns.set(activeSkill.id, { remaining: duration, maximum: duration }); const castIndex = orderedSkills.findIndex(({ id }) => id === activeSkill.id); this.skillPriorityCursor = orderedSkills.length ? (castIndex + 1) % orderedSkills.length : 0; }
    this.attackCooldown = (activeSkill?.id === "flurry" ? 0.35 : 1) / profile.attacksPerSecond;
    this.attackCooldownMax = this.attackCooldown;
  }

  spellSlots(progress: PlayerProgress, hero: Hero): SpellSlot[] {
    const ids = new Set<SkillId>([...progress.learnedSkills.filter((skill) => isSkillAvailable(progress, skill)), ...(progress.mainHand?.skills ?? []), ...accessories(progress).flatMap((candidate) => candidate?.skills ?? [])]);
    return [...ids].map((id) => { const cooldown = this.skillCooldowns.get(id); return { id, label: skillLabel(id), level: Math.max(1, effectiveSkillLevel(progress, id)), cooldown: id === "healing" ? this.healingCooldown : id === "blocking" ? hero.blockCooldown : cooldown?.remaining ?? 0, cooldownMax: id === "healing" ? this.healingCooldownMax : id === "blocking" ? hero.blockCooldownMax : cooldown?.maximum ?? 0, resource: SKILLS[id].resource, costLabel: skillCostLabel(id, progress), disabled: this.disabledSkills.has(id) }; });
  }

  get attackProgress(): number { return this.attackCooldownMax > 0 ? 1 - this.attackCooldown / this.attackCooldownMax : 1; }
  get whirlwindActive(): boolean { return this.whirlwindRemaining > 0; }
  reset(): void { this.attackCooldown = 0; this.attackCooldownMax = 0; this.healingCooldown = 0; this.healingCooldownMax = 0; this.orbitCastSequence = 0; this.skillPriorityCursor = 0; this.whirlwindRemaining = 0; this.whirlwindPulse = 0; this.skillCooldowns.clear(); }
  private availableSkills(progress: PlayerProgress, item: ItemInstance): { id: SkillId; level: number }[] {
    const skills = new Map<SkillId, number>();
    for (const skill of [...item.skills, ...accessories(progress).flatMap((candidate) => candidate?.skills ?? [])]) if (!this.disabledSkills.has(skill) && !SKILLS[skill].passive && skill !== "healing" && skill !== "blocking") skills.set(skill, effectiveSkillLevel(progress, skill));
    for (const skill of progress.learnedSkills) if (!this.disabledSkills.has(skill) && isSkillAvailable(progress, skill) && !SKILLS[skill].passive && skill !== "healing" && skill !== "blocking") skills.set(skill, Math.max(skills.get(skill) ?? 0, effectiveSkillLevel(progress, skill)));
    return [...skills].map(([id, level]) => ({ id, level: Math.max(1, level) }));
  }
}

function closestTarget(hero: Hero, creeps: Creep[]): Creep | undefined { let target: Creep | undefined; let closest = Infinity; for (const creep of creeps) if (creep.active) { const current = distance(hero.position, creep.position); if (current < closest) { target = creep; closest = current; } } return target; }
function skillManaCost(skill: SkillId): number { return SKILLS[skill].cost ?? (skill === "frostOrb" ? 10 : skill === "gravityPull" ? 8 : skill === "orbitingHammers" ? 3 : 1); }
function skillCostLabel(skill: SkillId, progress: PlayerProgress): string { const definition = SKILLS[skill]; if (definition.passive) return `0 ${capitalizeResource(definition.resource)}`; const stats = statsWithItemBonuses(progress.stats, progress.mainHand, ...accessories(progress)); if (skill === "healing") return `${formatCost(2 * (1 - resourceReduction(progress, "mana", stats)))} Mana / HP`; if (skill === "blocking") return `${formatCost(progress.offHand?.staminaCost ?? 0)} Stamina`; if (definition.resource === "mana") return `${formatCost(skillManaCost(skill) * (1 - resourceReduction(progress, "mana", stats)))} Mana`; if (definition.resource === "life") return `${formatCost((skill === "vampiricBoomerang" ? 30 : 10) * (1 - resourceReduction(progress, "life", stats)))}% Max HP`; return `${formatCost(skill === "reflectiveSurge" || skill === "whirlwind" ? 3 : (progress.mainHand?.staminaCost ?? 1) + 0.35)} Stamina`; }
function formatCost(value: number): string { return Number(value.toFixed(3)).toString(); }
function capitalizeResource(resource: "mana" | "stamina" | "life"): string { return resource[0].toUpperCase() + resource.slice(1); }
export function forceField(target: { position: Vector2; velocity: Vector2; interruptAttack?: () => void }, source: Vector2, impulse: number): void { const dx = target.position.x - source.x; const dy = target.position.y - source.y; const length = Math.hypot(dx, dy); if (length <= 0) return; target.velocity.x = dx / length * impulse; target.velocity.y = dy / length * impulse; target.interruptAttack?.(); }
export function forceFieldDamage(level: number): number { return 0.2 * spellPower(level); }
export function castForceField(state: ArenaState, hero: Hero, level: number, random: RandomSource): void { for (const creep of state.creeps) { creep.receiveDamage(forceFieldDamage(level), random, hero, false, false, { kind: "magic" }); forceField(creep, hero.position, 180); } }
export function isSkillAvailable(progress: PlayerProgress, skill: SkillId): boolean { return progress.universalSkills.includes(skill) || Boolean(progress.mainHand?.skills.includes(skill)) || accessories(progress).some((item) => Boolean(item?.skills.includes(skill))); }
export function effectiveSkillLevel(progress: PlayerProgress, skill: SkillId): number { if (!isSkillAvailable(progress, skill)) return 0; const learned = progress.learnedSkillLevels[skill] ?? (progress.learnedSkills.includes(skill) ? 1 : 0); const equipped = progress.mainHand?.skills.includes(skill) || accessories(progress).some((item) => item?.skills.includes(skill)) ? 1 : 0; const stats = statsWithItemBonuses(progress.stats, progress.mainHand, ...accessories(progress)); const accessory = accessories(progress).reduce((sum, candidate) => sum + itemSkillLevelBonus(candidate, SKILLS[skill].resource) * (candidate ? itemRequirementMultiplier(candidate, stats) : 1), 0); return cappedSkillLevel(learned + equipped + Math.floor(accessory)); }
function accessories(progress: PlayerProgress): Array<ItemInstance | undefined> { return [progress.offHand, progress.amulet, progress.charm]; }
function resourceReduction(progress: PlayerProgress, resource: "mana" | "life", stats: ReturnType<typeof statsWithItemBonuses>): number { return Math.min(.9, accessories(progress).reduce((sum, item) => sum + itemResourceCostReduction(item, resource, stats), 0)); }
export function skillHealthRequirementMet(skill: SkillId, currentHp: number, maxHp: number): boolean { const minimum = SKILLS[skill].minimumHealthFraction ?? 0; return maxHp > 0 && currentHp / maxHp >= minimum; }
