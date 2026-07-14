import type { BalanceConfig } from "./balance";
import { SKILLS } from "./content";
import { RARITY_POWER, type ItemInstance, type SkillId } from "./items";
import { derivedStats, type Stats } from "./progression";
import type { RandomSource } from "./random";

export function rollWeaponDamage(item: ItemInstance, stats: Stats, owner: "hero" | "enemy", balance: BalanceConfig, random: RandomSource): number {
  return rollWeaponStrike(item, stats, owner, balance, random).damage;
}

export function rollWeaponStrike(item: ItemInstance, stats: Stats, owner: "hero" | "enemy", balance: BalanceConfig, random: RandomSource): { damage: number; critical: boolean } {
  const derived = derivedStats(stats);
  let damage = weaponDamage(item, stats);
  const critical = random.next() < derived.critChance + item.modifiers.critChance;
  if (critical) damage *= derived.critMultiplier;
  return { damage: damage * (owner === "hero" ? balance.combat.heroDamageMultiplier : balance.combat.enemyDamageMultiplier), critical };
}

export function weaponAttackSpeed(item: ItemInstance, stats: Stats): number { if (item.itemKind !== "weapon" || item.weight <= 0) return 0; const handling = item.definitionId === "staff" ? (stats.strength + stats.spirit) / 2 : item.hands === 1 ? stats.agility : stats.strength; return (10 + Math.max(0, handling) * 0.1) / item.weight * item.modifiers.attackSpeedMultiplier; }
export function weaponDamage(item: ItemInstance, stats: Stats): number { if (item.itemKind !== "weapon") return 0; const derived = derivedStats(stats); const magic = item.definitionId === "staff" ? derived.magicAmp + item.modifiers.magicAmp : 1; return derived.baseDamage * item.modifiers.damageMultiplier * magic; }
export function bucklerBlockChance(item: ItemInstance | undefined, stats: Stats): number { return item?.itemKind === "buckler" ? Math.min(1, item.blockChance + 0.005 * (stats.strength + stats.agility)) : 0; }
export function bucklerBlockCost(item: ItemInstance, stats: Stats): number { if (item.itemKind !== "buckler") return 0; if (!item.reflectionComponents.includes("return")) return 1; const returnedFraction = (0.15 + 0.004 * Math.max(0, stats.agility)) * RARITY_POWER[item.rarity]; return 1 + returnedFraction / (1 + 0.1 * Math.max(0, item.level)); }

export function skillDamageMultiplier(skill: SkillId): number { return SKILLS[skill].damageMultiplier; }
export function skillCooldown(skill: SkillId): number { return SKILLS[skill].cooldown; }
export function skillRange(skill: SkillId, item: ItemInstance, level = 1, spirit = 0): number { const base = SKILLS[skill].range ?? (item.definitionId === "staff" ? 330 : 105); return base + Math.min(300, 0.5 * Math.max(1, level) * Math.max(0, spirit)); }
export function skillLabel(skill: SkillId): string { return SKILLS[skill].label; }
export function spellPower(level: number): number { return 1 + Math.max(0, level - 1) * 0.15; }
export function cooldownScale(level: number, reduction: number): number { return Math.max(0.25, (1 - reduction) * (1 - Math.min(0.5, Math.max(0, level - 1) * 0.04))); }
