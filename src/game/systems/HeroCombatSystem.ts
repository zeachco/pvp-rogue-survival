import type { BalanceConfig } from "../../../common/balance";
import { cooldownScale, rollWeaponStrike, skillCooldown, skillDamageMultiplier, skillLabel, skillRange, spellPower } from "../../../common/combat";
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

export class HeroCombatSystem {
  private attackCooldown = 0;
  private attackCooldownMax = 0;
  private healingCooldown = 0;
  private healingCooldownMax = 0;
  private weaponSkillCooldown = 0;
  private weaponSkillCooldownMax = 0;

  update(deltaSeconds: number, movementInput: Vector2, hero: Hero, state: ArenaState, progress: PlayerProgress, balance: BalanceConfig, random: RandomSource): void {
    this.attackCooldown = Math.max(0, this.attackCooldown - deltaSeconds); this.healingCooldown = Math.max(0, this.healingCooldown - deltaSeconds); this.weaponSkillCooldown = Math.max(0, this.weaponSkillCooldown - deltaSeconds);
    const item = progress.mainHand; const effectiveStats = statsWithItemBonuses(progress.stats, item, progress.offHand); const derived = derivedStats(effectiveStats);
    if (progress.learnedSkills.includes("healing") && hero.hp < hero.maxHp * 0.5 && this.healingCooldown === 0 && hero.mana >= 2) {
      const level = this.skillLevel(progress, "healing"); hero.mana -= 2;
      hero.heal((0.5 + effectiveStats.spirit * 1.2) * derived.magicAmp * spellPower(level));
      this.healingCooldown = 8 * cooldownScale(level, derived.cooldownReduction); this.healingCooldownMax = this.healingCooldown;
    }
    const target = closestTarget(hero, state.creeps);
    if (!target) { if (movementInput.x || movementInput.y) hero.facing = Math.atan2(movementInput.y, movementInput.x); return; }
    hero.facing = Math.atan2(target.position.y - hero.position.y, target.position.x - hero.position.x);
    const targetDistance = distance(hero.position, target.position);
    const candidate = this.weaponSkillCooldown === 0 ? this.availableSkills(progress, item)[0] : undefined;
    const magicSkill = candidate?.id === "arcaneBolt" && hero.mana >= 1;
    const physicalSkill = Boolean(candidate && candidate.id !== "arcaneBolt" && hero.stamina >= item.staminaCost + 0.35);
    const activeSkill = magicSkill || physicalSkill ? candidate : undefined;
    const range = activeSkill ? skillRange(activeSkill.id, item) : item.definitionId === "staff" ? 330 : 105;
    const ranged = item.definitionId === "staff" || activeSkill?.id === "arcaneBolt";
    if (targetDistance > range + target.radius || this.attackCooldown > 0 || hero.stamina < item.staminaCost) return;
    hero.stamina -= item.staminaCost + (physicalSkill ? 0.35 : 0); if (magicSkill) hero.mana -= 1;
    const strike = rollWeaponStrike(item, effectiveStats, "hero", balance, random); const damage = strike.damage * (activeSkill ? skillDamageMultiplier(activeSkill.id) * spellPower(activeSkill.level) : 1); const presentation = { kind: ranged ? "magic" as const : "physical" as const, critical: strike.critical };
    if (ranged) state.projectiles.push(new Projectile(hero.position, target.position, damage, "hero", activeSkill?.id === "arcaneBolt" ? activeSkill.id : undefined, hero, presentation));
    else state.attacks.push(new AttackArea("hero", { ...hero.position }, hero.facing, activeSkill?.id === "sweep" ? 135 : range, activeSkill?.id === "sweep" || item.definitionId === "mace" || item.definitionId === "club" ? Math.PI : activeSkill?.id === "flurry" ? 1.1 : 0.72, 0.18, 0.13, damage, hero, meleeSkill(activeSkill?.id), item, presentation));
    if (activeSkill) { this.weaponSkillCooldown = skillCooldown(activeSkill.id) * cooldownScale(activeSkill.level, derived.cooldownReduction); this.weaponSkillCooldownMax = this.weaponSkillCooldown; }
    this.attackCooldown = (activeSkill?.id === "flurry" ? 0.2 : 0.7) / (derived.attackSpeed * item.modifiers.attackSpeedMultiplier);
    this.attackCooldownMax = this.attackCooldown;
  }

  spellSlots(progress: PlayerProgress): SpellSlot[] {
    const ids = new Set<SkillId>([...progress.learnedSkills, ...progress.mainHand.skills]);
    return [...ids].map((id) => ({ id, label: skillLabel(id), level: Math.max(1, this.skillLevel(progress, id) || 1), cooldown: id === "healing" ? this.healingCooldown : this.weaponSkillCooldown, cooldownMax: id === "healing" ? this.healingCooldownMax : this.weaponSkillCooldownMax }));
  }

  get attackProgress(): number { return this.attackCooldownMax > 0 ? 1 - this.attackCooldown / this.attackCooldownMax : 1; }
  reset(): void { this.attackCooldown = 0; this.attackCooldownMax = 0; this.healingCooldown = 0; this.healingCooldownMax = 0; this.weaponSkillCooldown = 0; this.weaponSkillCooldownMax = 0; }
  private skillLevel(progress: PlayerProgress, skill: SkillId): number { return progress.learnedSkillLevels[skill] ?? (progress.learnedSkills.includes(skill) ? 1 : 0); }
  private availableSkills(progress: PlayerProgress, item: ItemInstance): { id: SkillId; level: number }[] {
    const skills = new Map<SkillId, number>();
    for (const skill of item.skills) if (skill !== "healing") skills.set(skill, Math.max(skills.get(skill) ?? 0, this.skillLevel(progress, skill) || 1));
    for (const skill of progress.learnedSkills) if (skill !== "healing") skills.set(skill, Math.max(skills.get(skill) ?? 0, this.skillLevel(progress, skill)));
    return [...skills].map(([id, level]) => ({ id, level: Math.max(1, level) }));
  }
}

function closestTarget(hero: Hero, creeps: Creep[]): Creep | undefined { let target: Creep | undefined; let closest = Infinity; for (const creep of creeps) if (creep.active) { const current = distance(hero.position, creep.position); if (current < closest) { target = creep; closest = current; } } return target; }
function meleeSkill(skill: SkillId | undefined): "bash" | "sweep" | "flurry" | undefined { return skill === "bash" || skill === "sweep" || skill === "flurry" ? skill : undefined; }
