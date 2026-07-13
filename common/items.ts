import { STAT_KEYS, type StatKey, type Stats } from "./progression";
import { AFFIXES, WEAPONS } from "./content";
import { SeededRandom } from "./random";

export type WeaponClass = "club" | "sword" | "dagger" | "mace" | "staff";
export type EquipmentDefinitionId = WeaponClass | "buckler";
export type Rarity = "common" | "uncommon" | "rare" | "epic";
export type SkillId = "bash" | "sweep" | "flurry" | "arcaneBolt" | "healing";
export type AffixId = "rusty" | "venomous" | "bleeding" | "stunning" | "focused" | "swift";
export type ReflectionComponent = "flat" | "strength" | "return";
export const RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic"];
export const RARITY_POWER: Record<Rarity, number> = { common: 1, uncommon: 1.25, rare: 1.6, epic: 2.1 };

export interface ItemModifiers {
  damageMultiplier: number; attackSpeedMultiplier: number; critChance: number;
  manaRegenMultiplier: number; magicAmp: number; bleedChance: number;
  poisonChance: number; stunChance: number;
}
export interface ItemInstance {
  id: string; itemKind: "weapon" | "buckler"; definitionId: EquipmentDefinitionId; name: string; level: number; rarity: Rarity;
  seed: number; hands: 0 | 1 | 2; affixes: AffixId[]; requirements: Partial<Record<StatKey, number>>;
  statBonuses: Partial<Record<StatKey, number>>; modifiers: ItemModifiers; skills: SkillId[];
  staminaCost: number; dropChance: number; sellValue: number; blockChance: number;
  reflectionComponents: ReflectionComponent[];
}
export interface ItemGenerationFilters { allowedClasses?: WeaponClass[]; fewerAffixes?: boolean }

export function starterClub(): ItemInstance {
  return {
    id: "starter-club", itemKind: "weapon", definitionId: "club", name: "Plain Club", level: 0, rarity: "common", seed: 1,
    hands: 1, affixes: [], requirements: {}, statBonuses: {}, modifiers: baseModifiers(1, 1), skills: [], staminaCost: 0.1,
    dropChance: 0, sellValue: 0, blockChance: 0, reflectionComponents: []
  };
}

export function generateItem(level: number, rarity: Rarity, seed: number, filters: ItemGenerationFilters = {}): ItemInstance {
  const source = new SeededRandom(seed); const random = () => source.next();
  const classes = filters.allowedClasses?.length ? filters.allowedClasses : Object.keys(WEAPONS) as WeaponClass[];
  const weaponClass = classes[Math.floor(random() * classes.length)];
  const data = WEAPONS[weaponClass]; const power = RARITY_POWER[rarity];
  const affixes: AffixId[] = []; const rolls = filters.fewerAffixes ? 1 : ({ common: 1, uncommon: 2, rare: 3, epic: 4 }[rarity]);
  const pool = Object.values(AFFIXES).filter((affix) => affix.compatibleWeapons.includes(weaponClass)).map((affix) => affix.id);
  for (let index = 0; index < rolls; index += 1) { const affix = pool[Math.floor(random() * pool.length)]; if (!affixes.includes(affix)) affixes.push(affix); }
  return buildWeapon(weaponClass, level, rarity, seed, affixes, Math.floor(random() * 1e8));
}

export function generateBuckler(level: number, rarity: Rarity, seed: number): ItemInstance {
  const source = new SeededRandom(seed); const spiked = source.next() < 0.25; const componentCount = rarity === "epic" ? 3 : rarity === "rare" ? 2 : 1;
  const pool: ReflectionComponent[] = ["flat", "strength", "return"]; const reflectionComponents: ReflectionComponent[] = [];
  while (spiked && reflectionComponents.length < componentCount) reflectionComponents.push(pool.splice(Math.floor(source.next() * pool.length), 1)[0]);
  const power = RARITY_POWER[rarity];
  return {
    id: `buckler-${seed}-${Math.floor(source.next() * 1e8)}`, itemKind: "buckler", definitionId: "buckler",
    name: `${spiked ? "Spiked " : ""}Buckler`, level, rarity, seed, hands: 0, affixes: [],
    requirements: level ? { strength: Math.max(1, Math.floor(level * 0.35 * power)) } : {}, statBonuses: {},
    modifiers: baseModifiers(1, 1), skills: [], staminaCost: 0, dropChance: Math.min(0.3, 0.04 + power * 0.06),
    sellValue: Math.max(1, Math.round((level + 1) * power * (spiked ? 5 : 4))), blockChance: 0.1 * power, reflectionComponents
  };
}

export function levelUpItem(base: ItemInstance, seed: number): ItemInstance {
  if (base.itemKind === "buckler") {
    const next = generateBuckler(base.level + 1, base.rarity, seed);
    return { ...next, name: base.name, reflectionComponents: [...base.reflectionComponents], blockChance: 0.1 * RARITY_POWER[base.rarity], sellValue: Math.max(1, Math.round((base.level + 2) * RARITY_POWER[base.rarity] * (base.reflectionComponents.length ? 5 : 4))) };
  }
  return buildWeapon(base.definitionId as WeaponClass, base.level + 1, base.rarity, seed, [...base.affixes], seed % 1e8);
}

function buildWeapon(weaponClass: WeaponClass, level: number, rarity: Rarity, seed: number, affixes: AffixId[], suffix: number): ItemInstance {
  const data = WEAPONS[weaponClass]; const power = RARITY_POWER[rarity]; const modifiers = baseModifiers(data.damage * (1 + level * 0.025) * power, data.speed);
  for (const affix of affixes) applyAffix(modifiers, affix, power);
  if (weaponClass === "dagger") modifiers.critChance += 0.04 * power;
  if (weaponClass === "staff") { modifiers.manaRegenMultiplier += power; modifiers.magicAmp += 0.12 * power; }
  const requirements: Partial<Record<StatKey, number>> = {};
  if (data.requirement && level > 0) requirements[data.requirement] = Math.max(1, Math.floor(level * 0.6 * power));
  return {
    id: `item-${seed}-${suffix}`, itemKind: "weapon", definitionId: weaponClass, name: `${affixes[0] ? `${capitalize(affixes[0])} ` : ""}${data.label}`,
    level, rarity, seed, hands: weaponClass === "staff" ? 2 : 1, affixes, requirements, statBonuses: {}, modifiers,
    skills: data.skill && rarity !== "common" ? [data.skill] : [], staminaCost: data.stamina,
    dropChance: Math.min(0.3, 0.04 + power * 0.06), sellValue: Math.max(1, Math.round((level + 1) * power * (4 + affixes.length * 2))),
    blockChance: 0, reflectionComponents: []
  };
}

export function rollRarity(seed: number): Rarity { const roll = new SeededRandom(seed).next(); return roll < 0.58 ? "common" : roll < 0.83 ? "uncommon" : roll < 0.96 ? "rare" : "epic"; }
export function meetsRequirements(item: ItemInstance, stats: Stats): boolean { return Object.entries(item.requirements).every(([key, value]) => stats[key as StatKey] >= (value ?? 0)); }
export function itemStackKey(item: ItemInstance): string {
  return JSON.stringify({ itemKind: item.itemKind, definitionId: item.definitionId, level: item.level, rarity: item.rarity, hands: item.hands,
    affixes: [...item.affixes].sort(), requirements: orderedStats(item.requirements), statBonuses: orderedStats(item.statBonuses), modifiers: item.modifiers,
    skills: [...item.skills].sort(), staminaCost: item.staminaCost, blockChance: item.blockChance, reflectionComponents: [...item.reflectionComponents].sort() });
}
export function itemAutomationKey(item: ItemInstance): string {
  return JSON.stringify({ itemKind: item.itemKind, definitionId: item.definitionId, rarity: item.rarity, hands: item.hands,
    affixes: [...item.affixes].sort(), statBonuses: orderedStats(item.statBonuses), skills: [...item.skills].sort(),
    reflectionComponents: [...item.reflectionComponents].sort() });
}
export function statsWithItemBonuses(stats: Stats, ...items: Array<ItemInstance | undefined>): Stats {
  return Object.fromEntries(STAT_KEYS.map((key) => [key, stats[key] + items.reduce((sum, item) => sum + (item?.statBonuses[key] ?? 0), 0)])) as Stats;
}
function baseModifiers(damageMultiplier: number, attackSpeedMultiplier: number): ItemModifiers { return { damageMultiplier, attackSpeedMultiplier, critChance: 0, manaRegenMultiplier: 1, magicAmp: 0, bleedChance: 0, poisonChance: 0, stunChance: 0 }; }
function applyAffix(modifiers: ItemModifiers, affix: AffixId, power: number): void { for (const [key, value] of Object.entries(AFFIXES[affix].modifierPerPower) as [keyof ItemModifiers, number][]) modifiers[key] += value * power; }
function capitalize(value: string): string { return value[0].toUpperCase() + value.slice(1); }
function orderedStats(stats: Partial<Record<StatKey, number>>): Partial<Record<StatKey, number>> { return Object.fromEntries(STAT_KEYS.map((key) => [key, stats[key] ?? 0])) as Partial<Record<StatKey, number>>; }
