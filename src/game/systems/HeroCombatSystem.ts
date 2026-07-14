import type { BalanceConfig } from "../../../common/balance";
import { cooldownScale, rollWeaponStrike, skillCooldown, skillDamageMultiplier, skillLabel, skillRange, spellPower, weaponAttackSpeed, weaponRange, weaponUsesProjectile } from "../../../common/combat";
import { statsWithItemBonuses, type ItemInstance, type SkillId } from "../../../common/items";
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

  update(deltaSeconds: number, movementInput: Vector2, hero: Hero, state: ArenaState, progress: PlayerProgress, balance: BalanceConfig, random: RandomSource): void {
    this.attackCooldown = Math.max(0, this.attackCooldown - deltaSeconds); this.healingCooldown = Math.max(0, this.healingCooldown - deltaSeconds); for (const cooldown of this.skillCooldowns.values()) cooldown.remaining = Math.max(0, cooldown.remaining - deltaSeconds);
    const item = progress.mainHand; const effectiveStats = statsWithItemBonuses(progress.stats, item, progress.offHand); const derived = derivedStats(effectiveStats);
    hero.knownSkills.clear(); for (const skill of new Set([...progress.learnedSkills, ...item.skills, ...(progress.offHand?.skills ?? [])])) if (isSkillAvailable(progress, skill)) hero.knownSkills.add(skill);
    if (progress.learnedSkills.includes("healing") && hero.hp < hero.maxHp * 0.5 && this.healingCooldown === 0 && hero.mana >= 2) {
      const level = effectiveSkillLevel(progress, "healing"); hero.mana -= 2;
      hero.heal((0.5 + effectiveStats.spirit * 1.2) * derived.magicAmp * spellPower(level));
      state.spellEffects.push(new SpellEffect("healing", hero.position));
      this.healingCooldown = 8 * cooldownScale(level, derived.cooldownReduction); this.healingCooldownMax = this.healingCooldown;
    }
    const target = closestTarget(hero, state.creeps);
    if (!target) { if (movementInput.x || movementInput.y) hero.facing = Math.atan2(movementInput.y, movementInput.x); return; }
    hero.facing = Math.atan2(target.position.y - hero.position.y, target.position.x - hero.position.x);
    const targetDistance = distance(hero.position, target.position);
    const candidate = this.availableSkills(progress, item).find(({ id }) => (this.skillCooldowns.get(id)?.remaining ?? 0) === 0);
    const manaCost = candidate ? skillManaCost(candidate.id) : 0; const staminaSkillCost = candidate?.id === "reflectiveSurge" ? 3 : item.staminaCost + 0.35; const magicSkill = Boolean(candidate && SKILLS[candidate.id].resource === "mana" && hero.mana >= manaCost);
    const physicalSkill = Boolean(candidate && SKILLS[candidate.id].resource === "stamina" && hero.stamina >= staminaSkillCost);
    const lifeSkill = Boolean(candidate && SKILLS[candidate.id].resource === "life" && hero.hp > 1);
    const activeSkill = magicSkill || physicalSkill || lifeSkill ? candidate : undefined;
    const range = activeSkill ? skillRange(activeSkill.id, item, activeSkill.level, effectiveStats.spirit) : weaponRange(item);
    const ranged = activeSkill ? activeSkill.id === "arcaneBolt" || activeSkill.id === "rendingThrow" || activeSkill.id === "orbitingHammers" || activeSkill.id === "frostOrb" : weaponUsesProjectile(item);
    const staminaCost = magicSkill || lifeSkill ? 0 : physicalSkill ? staminaSkillCost : item.staminaCost;
    if (targetDistance > range + target.radius || this.attackCooldown > 0 || hero.stamina < staminaCost) return;
    hero.stamina -= staminaCost; if (magicSkill) hero.mana -= manaCost; if (lifeSkill) hero.takeDamage(1);
    const strike = rollWeaponStrike(item, effectiveStats, "hero", balance, random); const damage = strike.damage * (activeSkill ? skillDamageMultiplier(activeSkill.id) * spellPower(activeSkill.level) : 1); const presentation = { kind: activeSkill?.id === "arcaneBolt" || activeSkill?.id === "orbitingHammers" || activeSkill?.id === "frostOrb" || (!activeSkill && item.definitionId === "staff") ? "magic" as const : "physical" as const, critical: strike.critical };
    if (activeSkill?.id === "orbitingHammers") for (let index = 0; index < 3; index += 1) state.projectiles.push(Projectile.orbitingHammer(hero, hero.facing + index * Math.PI * 2 / 3, damage, { kind: "magic", critical: strike.critical }));
    else if (activeSkill?.id === "frostOrb") state.projectiles.push(new Projectile(hero.position, target.position, damage, "hero", "frostOrb", hero, presentation, item));
    else if (activeSkill?.id === "gravityPull") for (const creep of state.creeps) forceField(creep, hero.position, 180, weaponUsesProjectile(item) || item.definitionId === "staff" ? "push" : "pull");
    else if (activeSkill?.id === "reflectiveSurge") hero.reflectiveSurgeRemaining = 6;
    else if (ranged) state.projectiles.push(new Projectile(hero.position, target.position, damage, "hero", activeSkill?.id === "arcaneBolt" || activeSkill?.id === "rendingThrow" ? activeSkill.id : undefined, hero, presentation, item));
    else state.attacks.push(new AttackArea("hero", { ...hero.position }, hero.facing, range, activeSkill?.id === "bash" || activeSkill?.id === "sweep" || activeSkill?.id === "shockwave" || (!activeSkill && (item.definitionId === "mace" || item.definitionId === "club" || item.definitionId === "hammer")) ? Math.PI : activeSkill?.id === "cleave" ? 1.8 : activeSkill?.id === "flurry" ? 1.1 : 0.72, 0.18, 0.13, damage, hero, meleeSkill(activeSkill?.id), item, presentation));
    if (activeSkill) state.spellEffects.push(new SpellEffect(activeSkill.id, hero.position, hero.facing));
    if (activeSkill) { const duration = skillCooldown(activeSkill.id, item) * cooldownScale(activeSkill.level, derived.cooldownReduction); this.skillCooldowns.set(activeSkill.id, { remaining: duration, maximum: duration }); }
    this.attackCooldown = (activeSkill?.id === "flurry" ? 0.35 : 1) / weaponAttackSpeed(item, effectiveStats);
    this.attackCooldownMax = this.attackCooldown;
  }

  spellSlots(progress: PlayerProgress, hero: Hero): SpellSlot[] {
    const ids = new Set<SkillId>([...progress.learnedSkills.filter((skill) => isSkillAvailable(progress, skill)), ...progress.mainHand.skills, ...(progress.offHand?.skills ?? [])]);
    return [...ids].map((id) => { const cooldown = this.skillCooldowns.get(id); return { id, label: skillLabel(id), level: Math.max(1, effectiveSkillLevel(progress, id)), cooldown: id === "healing" ? this.healingCooldown : id === "blocking" ? hero.blockCooldown : cooldown?.remaining ?? 0, cooldownMax: id === "healing" ? this.healingCooldownMax : id === "blocking" ? hero.blockCooldownMax : cooldown?.maximum ?? 0, resource: SKILLS[id].resource }; });
  }

  get attackProgress(): number { return this.attackCooldownMax > 0 ? 1 - this.attackCooldown / this.attackCooldownMax : 1; }
  reset(): void { this.attackCooldown = 0; this.attackCooldownMax = 0; this.healingCooldown = 0; this.healingCooldownMax = 0; this.skillCooldowns.clear(); }
  private availableSkills(progress: PlayerProgress, item: ItemInstance): { id: SkillId; level: number }[] {
    const skills = new Map<SkillId, number>();
    for (const skill of [...item.skills, ...(progress.offHand?.skills ?? [])]) if (skill !== "healing" && skill !== "blocking" && skill !== "thorns") skills.set(skill, effectiveSkillLevel(progress, skill));
    for (const skill of progress.learnedSkills) if (isSkillAvailable(progress, skill) && skill !== "healing" && skill !== "blocking" && skill !== "thorns") skills.set(skill, Math.max(skills.get(skill) ?? 0, effectiveSkillLevel(progress, skill)));
    return [...skills].map(([id, level]) => ({ id, level: Math.max(1, level) }));
  }
}

function closestTarget(hero: Hero, creeps: Creep[]): Creep | undefined { let target: Creep | undefined; let closest = Infinity; for (const creep of creeps) if (creep.active) { const current = distance(hero.position, creep.position); if (current < closest) { target = creep; closest = current; } } return target; }
function meleeSkill(skill: SkillId | undefined): "bash" | "sweep" | "flurry" | "shockwave" | "cleave" | undefined { return skill === "bash" || skill === "sweep" || skill === "flurry" || skill === "shockwave" || skill === "cleave" ? skill : undefined; }
function skillManaCost(skill: SkillId): number { return skill === "frostOrb" ? 10 : skill === "gravityPull" ? 8 : skill === "orbitingHammers" ? 3 : 1; }
export function forceField(target: { position: Vector2; velocity: Vector2; interruptAttack?: () => void }, source: Vector2, impulse: number, direction: "pull" | "push"): void { const dx = source.x - target.position.x; const dy = source.y - target.position.y; const length = Math.hypot(dx, dy); if (length <= 0) return; const sign = direction === "pull" ? 1 : -1; target.velocity.x += dx / length * impulse * sign; target.velocity.y += dy / length * impulse * sign; target.interruptAttack?.(); }
export function isSkillAvailable(progress: PlayerProgress, skill: SkillId): boolean { return progress.universalSkills.includes(skill) || progress.mainHand.skills.includes(skill) || Boolean(progress.offHand?.skills.includes(skill)); }
export function effectiveSkillLevel(progress: PlayerProgress, skill: SkillId): number { if (!isSkillAvailable(progress, skill)) return 0; const learned = progress.learnedSkillLevels[skill] ?? (progress.learnedSkills.includes(skill) ? 1 : 0); const equipped = progress.mainHand.skills.includes(skill) || progress.offHand?.skills.includes(skill) ? 1 : 0; return learned + equipped; }
