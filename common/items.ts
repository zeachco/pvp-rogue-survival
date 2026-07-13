import { STAT_KEYS, type StatKey, type Stats } from "./progression";
import { AFFIXES, WEAPONS } from "./content";
import { SeededRandom } from "./random";

export type WeaponClass = "club" | "sword" | "dagger" | "mace" | "staff";
export type Rarity = "common" | "uncommon" | "rare" | "epic";
export type SkillId = "bash" | "sweep" | "flurry" | "arcaneBolt" | "healing";
export type AffixId = "rusty" | "venomous" | "bleeding" | "stunning" | "focused" | "swift";
export const RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic"];

export interface ItemModifiers {
  damageMultiplier: number; attackSpeedMultiplier: number; critChance: number;
  manaRegenMultiplier: number; magicAmp: number; bleedChance: number;
  poisonChance: number; stunChance: number;
}
export interface ItemInstance {
  id: string; definitionId: WeaponClass; name: string; level: number; rarity: Rarity;
  seed: number; requirements: Partial<Record<StatKey, number>>; statBonuses: Partial<Record<StatKey, number>>; modifiers: ItemModifiers;
  skills: SkillId[]; staminaCost: number; dropChance: number; sellValue: number;
}
export interface ItemGenerationFilters { allowedClasses?: WeaponClass[]; fewerAffixes?: boolean }

const RARITY_POWER: Record<Rarity, number> = { common: 1, uncommon: 1.25, rare: 1.6, epic: 2.1 };

export function starterClub(): ItemInstance {
  return {
    id: "starter-club", definitionId: "club", name: "Plain Club", level: 0, rarity: "common", seed: 1,
    requirements: {}, statBonuses: {}, modifiers: baseModifiers(1, 1), skills: [], staminaCost: 0.1, dropChance: 0, sellValue: 0
  };
}

export function generateItem(level: number, rarity: Rarity, seed: number, filters: ItemGenerationFilters = {}): ItemInstance {
  const source = new SeededRandom(seed); const random = () => source.next();
  const classes = filters.allowedClasses?.length ? filters.allowedClasses : Object.keys(WEAPONS) as WeaponClass[];
  const weaponClass = classes[Math.floor(random() * classes.length)];
  const data = WEAPONS[weaponClass];
  const power = RARITY_POWER[rarity];
  const modifiers = baseModifiers(data.damage * (1 + level * 0.025) * power, data.speed);
  const affixes: AffixId[] = [];
  const rolls = filters.fewerAffixes ? 1 : ({ common: 1, uncommon: 2, rare: 3, epic: 4 }[rarity]);
  const pool = Object.values(AFFIXES).filter((affix) => affix.compatibleWeapons.includes(weaponClass)).map((affix) => affix.id);
  for (let index = 0; index < rolls; index += 1) {
    const affix = pool[Math.floor(random() * pool.length)];
    if (!affixes.includes(affix)) affixes.push(affix);
  }
  for (const affix of affixes) applyAffix(modifiers, affix, power);
  if (weaponClass === "dagger") modifiers.critChance += 0.04 * power;
  if (weaponClass === "staff") { modifiers.manaRegenMultiplier += 1 * power; modifiers.magicAmp += 0.12 * power; }
  const requirements: Partial<Record<StatKey, number>> = {};
  if (data.requirement && level > 0) requirements[data.requirement] = Math.max(1, Math.floor(level * 0.6 * power));
  const skills = data.skill && rarity !== "common" ? [data.skill] : [];
  const prefix = affixes[0] ? `${capitalize(affixes[0])} ` : "";
  return {
    id: `item-${seed}-${Math.floor(random() * 1e8)}`, definitionId: weaponClass, name: `${prefix}${data.label}`,
    level, rarity, seed, requirements, statBonuses: {}, modifiers, skills, staminaCost: data.stamina,
    dropChance: Math.min(0.3, 0.04 + power * 0.06), sellValue: Math.max(1, Math.round((level + 1) * power * (4 + affixes.length * 2)))
  };
}

export function rollRarity(seed: number): Rarity {
  const roll = new SeededRandom(seed).next();
  return roll < 0.58 ? "common" : roll < 0.83 ? "uncommon" : roll < 0.96 ? "rare" : "epic";
}
export function meetsRequirements(item: ItemInstance, stats: Stats): boolean {
  return Object.entries(item.requirements).every(([key, value]) => stats[key as StatKey] >= (value ?? 0));
}
export function itemMergeKey(item: ItemInstance): string {
  return JSON.stringify({
    definitionId: item.definitionId, level: item.level, rarity: item.rarity,
    requirements: orderedStats(item.requirements), statBonuses: orderedStats(item.statBonuses ?? {}), modifiers: item.modifiers,
    skills: [...item.skills].sort(), staminaCost: item.staminaCost
  });
}
export function mergeItems(base: ItemInstance, seed: number): ItemInstance {
  const source = new SeededRandom(seed); const random = () => source.next();
  const stat = STAT_KEYS[Math.floor(random() * STAT_KEYS.length)];
  const statBonuses = { ...(base.statBonuses ?? {}) };
  const modifiers = { ...base.modifiers, damageMultiplier: base.modifiers.damageMultiplier * 1.08 };
  statBonuses[stat] = (statBonuses[stat] ?? 0) + 1;
  return {
    ...base,
    id: `merged-${seed}-${Math.floor(random() * 1e8)}`,
    seed,
    name: `Empowered ${base.name}`,
    modifiers,
    statBonuses,
    dropChance: 0,
    sellValue: base.sellValue + Math.max(1, base.level + 1)
  };
}
export function statsWithItemBonuses(stats: Stats, item?: ItemInstance): Stats {
  const bonuses = item?.statBonuses ?? {};
  return Object.fromEntries(STAT_KEYS.map((key) => [key, stats[key] + (bonuses[key] ?? 0)])) as Stats;
}
function baseModifiers(damageMultiplier: number, attackSpeedMultiplier: number): ItemModifiers {
  return { damageMultiplier, attackSpeedMultiplier, critChance: 0, manaRegenMultiplier: 1, magicAmp: 0, bleedChance: 0, poisonChance: 0, stunChance: 0 };
}
function applyAffix(modifiers: ItemModifiers, affix: AffixId, power: number): void {
  for (const [key, value] of Object.entries(AFFIXES[affix].modifierPerPower) as [keyof ItemModifiers, number][]) modifiers[key] += value * power;
}
function capitalize(value: string): string { return value[0].toUpperCase() + value.slice(1); }
function orderedStats(stats: Partial<Record<StatKey, number>>): Partial<Record<StatKey, number>> { return Object.fromEntries(STAT_KEYS.map((key) => [key, stats[key] ?? 0])) as Partial<Record<StatKey, number>>; }
