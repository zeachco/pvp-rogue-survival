import type { BalanceConfig } from "./balance";
import { SKILLS } from "./content";
import type { ItemInstance, SkillId } from "./items";
import { derivedStats, type Stats } from "./progression";
import type { RandomSource } from "./random";

export function rollWeaponDamage(item: ItemInstance, stats: Stats, owner: "hero" | "enemy", balance: BalanceConfig, random: RandomSource): number {
  const derived = derivedStats(stats);
  let damage = derived.baseDamage * item.modifiers.damageMultiplier;
  if (item.definitionId === "staff") damage *= derived.magicAmp + item.modifiers.magicAmp;
  if (random.next() < derived.critChance + item.modifiers.critChance) damage *= derived.critMultiplier;
  return damage * (owner === "hero" ? balance.combat.heroDamageMultiplier : balance.combat.enemyDamageMultiplier);
}

export function skillDamageMultiplier(skill: SkillId): number { return SKILLS[skill].damageMultiplier; }
export function skillCooldown(skill: SkillId): number { return SKILLS[skill].cooldown; }
export function skillRange(skill: SkillId, item: ItemInstance): number { return SKILLS[skill].range ?? (item.definitionId === "staff" ? 330 : 105); }
export function skillLabel(skill: SkillId): string { return SKILLS[skill].label; }
export function spellPower(level: number): number { return 1 + Math.max(0, level - 1) * 0.15; }
export function cooldownScale(level: number, reduction: number): number { return Math.max(0.25, (1 - reduction) * (1 - Math.min(0.5, Math.max(0, level - 1) * 0.04))); }
