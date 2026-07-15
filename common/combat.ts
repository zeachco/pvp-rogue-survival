import type { BalanceConfig } from "./balance";
import { SKILLS, WEAPONS } from "./content";
import { AURA_SKILLS, itemRequirementMultiplier, RARITY_POWER, weaponLevelScale, weaponSkillLevelScale, type ItemInstance, type SkillId } from "./items";
import { auraRadius } from "./auras";
import { derivedStats, type Stats } from "./progression";
import type { RandomSource } from "./random";

export function rollWeaponDamage(item: ItemInstance, stats: Stats, owner: "hero" | "enemy", balance: BalanceConfig, random: RandomSource): number {
  return rollWeaponStrike(item, stats, owner, balance, random).damage;
}

export function isMagicWeapon(item: ItemInstance): boolean { return item.itemKind === "weapon" && (item.definitionId === "staff" || item.definitionId === "scepter"); }

export function rollWeaponStrike(item: ItemInstance, stats: Stats, owner: "hero" | "enemy", balance: BalanceConfig, random: RandomSource): { damage: number; critical: boolean } {
  const derived = derivedStats(stats);
  let damage = weaponDamage(item, stats);
  const critical = random.next() < derived.critChance + item.modifiers.critChance * itemRequirementMultiplier(item, stats);
  if (critical) damage *= derived.critMultiplier;
  return { damage: damage * (owner === "hero" ? balance.combat.heroDamageMultiplier : balance.combat.enemyDamageMultiplier), critical };
}

export function weaponAttackSpeed(item: ItemInstance, stats: Stats): number { if (item.itemKind !== "weapon" || item.weight <= 0) return 0; const handling = isMagicWeapon(item) ? (stats.strength + stats.spirit) / 2 : item.hands === 1 ? stats.agility : stats.strength; const effectiveness = itemRequirementMultiplier(item, stats); const baseSpeed = (10 + Math.max(0, handling) * 0.1) / item.weight; const modifier = 1 + (item.modifiers.attackSpeedMultiplier - 1) * effectiveness; return baseSpeed * Math.max(1, modifier); }
export function weaponDamage(item: ItemInstance, stats: Stats): number { if (item.itemKind !== "weapon") return 0; const derived = derivedStats(stats); const effectiveness = itemRequirementMultiplier(item, stats); const magic = isMagicWeapon(item) ? derived.magicAmp + item.modifiers.magicAmp * effectiveness : 1; const penalized = derived.baseDamage * item.modifiers.damageMultiplier * magic * effectiveness; const levelZeroMagic = isMagicWeapon(item) ? derived.magicAmp + item.modifiers.magicAmp : 1; const levelZero = derived.baseDamage * (item.modifiers.damageMultiplier / weaponLevelScale(item.level)) * levelZeroMagic; return Math.max(levelZero, penalized); }
export function weaponRange(item: ItemInstance): number { return item.itemKind === "weapon" ? WEAPONS[item.definitionId as keyof typeof WEAPONS].range ?? 105 : 0; }
export function weaponUsesProjectile(item: ItemInstance): boolean { return item.itemKind === "weapon" && Boolean(WEAPONS[item.definitionId as keyof typeof WEAPONS].projectile); }
export function bucklerBlockChance(item: ItemInstance | undefined, stats: Stats): number { return item?.itemKind === "buckler" ? Math.min(1, (item.blockChance + 0.005 * (stats.strength + stats.agility)) * itemRequirementMultiplier(item, stats)) : 0; }
export function bucklerBlockCost(item: ItemInstance, stats: Stats): number { if (item.itemKind !== "buckler") return 0; if (!item.reflectionComponents.includes("return")) return 1; const returnedFraction = (0.15 + 0.004 * Math.max(0, stats.agility)) * RARITY_POWER[item.rarity]; return 1 + returnedFraction / (1 + 0.1 * Math.max(0, item.level)); }

export function skillDamageMultiplier(skill: SkillId): number { return SKILLS[skill].damageMultiplier; }
export function skillCooldown(skill: SkillId, item?: ItemInstance, stats?: Stats): number { return SKILLS[skill].cooldown / Math.max(1, (stats?.intelligence ?? 0) + (stats?.agility ?? 0)) / weaponSkillLevelScale(item?.level ?? 0); }
export function skillRange(skill: SkillId, item: ItemInstance, level = 1, spirit = 0): number { if (AURA_SKILLS.includes(skill)) return auraRadius(level, spirit); if (skill === "whirlwind") return whirlwindRadius(level); const base = SKILLS[skill].range ?? weaponRange(item); return (base + Math.min(300, 0.5 * Math.max(1, level) * Math.max(0, spirit))) * weaponSkillLevelScale(item.level); }
export function skillLabel(skill: SkillId): string { return SKILLS[skill].label; }
export function spellPower(level: number): number { return 1 + Math.max(0, level - 1) * 0.15; }
export function cooldownScale(level: number, reduction: number): number { return Math.max(0.2, (1 - Math.min(.8, reduction)) * (1 - Math.min(0.5, Math.max(0, level - 1) * 0.04))); }
export const MAX_SKILL_LEVEL = 100;
export function cappedSkillLevel(level: number): number { return Math.max(1, Math.min(MAX_SKILL_LEVEL, level)); }
export function manaConversionFraction(level: number): number { return 0.01 + (cappedSkillLevel(level) - 1) * (0.59 / 99); }
export function vampiricBoomerangHealingFraction(level: number): number { return 0.01 + (cappedSkillLevel(level) - 1) * (0.79 / 99); }
export function whirlwindRadius(level: number): number { return 90 + 1.2 * cappedSkillLevel(level); }
export function whirlwindDuration(spirit: number): number { return 2 + Math.min(6, 0.06 * Math.max(0, spirit)); }
export function whirlwindDamage(strength: number): number { return 1 + 0.4 * Math.max(0, strength); }
export function healingFraction(level: number): number { return 0.2 + (cappedSkillLevel(level) - 1) * (0.7 / 99); }
export function healingCooldown(level: number): number { return 15 - (cappedSkillLevel(level) - 1) * (14 / 99); }
export function healingCast(currentHp: number, maxHp: number, level: number): { restoredHp: number; manaCost: number } { const restoredHp = Math.max(0, Math.min(maxHp - currentHp, currentHp * healingFraction(level))); return { restoredHp, manaCost: restoredHp * 2 }; }
