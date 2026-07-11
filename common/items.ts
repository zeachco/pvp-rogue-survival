import type { StatKey, Stats } from "./progression";

export type WeaponClass = "club" | "sword" | "dagger" | "mace" | "staff";
export type Rarity = "common" | "uncommon" | "rare" | "epic";
export type SkillId = "bash" | "sweep" | "flurry" | "arcaneBolt" | "healing";
export type AffixId = "rusty" | "venomous" | "bleeding" | "stunning" | "focused" | "swift";

export interface ItemModifiers {
  damageMultiplier: number; attackSpeedMultiplier: number; critChance: number;
  manaRegenMultiplier: number; magicAmp: number; bleedChance: number;
  poisonChance: number; stunChance: number;
}
export interface ItemInstance {
  id: string; definitionId: WeaponClass; name: string; level: number; rarity: Rarity;
  seed: number; requirements: Partial<Record<StatKey, number>>; modifiers: ItemModifiers;
  skills: SkillId[]; staminaCost: number; dropChance: number; sellValue: number;
}
export interface ItemGenerationFilters { allowedClasses?: WeaponClass[]; fewerAffixes?: boolean }

const RARITY_POWER: Record<Rarity, number> = { common: 1, uncommon: 1.25, rare: 1.6, epic: 2.1 };
const CLASS_DATA: Record<WeaponClass, { label: string; damage: number; speed: number; stamina: number; requirement?: StatKey; skill?: SkillId }> = {
  club: { label: "Club", damage: 1, speed: 1, stamina: 0.1, requirement: "strength", skill: "bash" },
  sword: { label: "Sword", damage: 1.15, speed: 0.95, stamina: 0.2, requirement: "strength", skill: "sweep" },
  dagger: { label: "Dagger", damage: 0.72, speed: 1.55, stamina: 0.12, requirement: "agility", skill: "flurry" },
  mace: { label: "Mace", damage: 1.35, speed: 0.72, stamina: 0.28, requirement: "strength", skill: "bash" },
  staff: { label: "Staff", damage: 0.8, speed: 0.8, stamina: 0.1, requirement: "magic", skill: "arcaneBolt" }
};

export function starterClub(): ItemInstance {
  return {
    id: "starter-club", definitionId: "club", name: "Plain Club", level: 0, rarity: "common", seed: 1,
    requirements: {}, modifiers: baseModifiers(1, 1), skills: [], staminaCost: 0.1, dropChance: 0, sellValue: 0
  };
}

export function generateItem(level: number, rarity: Rarity, seed: number, filters: ItemGenerationFilters = {}): ItemInstance {
  const random = mulberry32(seed);
  const classes = filters.allowedClasses?.length ? filters.allowedClasses : Object.keys(CLASS_DATA) as WeaponClass[];
  const weaponClass = classes[Math.floor(random() * classes.length)];
  const data = CLASS_DATA[weaponClass];
  const power = RARITY_POWER[rarity];
  const modifiers = baseModifiers(data.damage * (1 + level * 0.025) * power, data.speed);
  const affixes: AffixId[] = [];
  const rolls = filters.fewerAffixes ? 1 : ({ common: 1, uncommon: 2, rare: 3, epic: 4 }[rarity]);
  const pool: AffixId[] = weaponClass === "staff" ? ["focused", "swift", "venomous"] : weaponClass === "mace" || weaponClass === "club" ? ["stunning", "rusty", "swift"] : ["bleeding", "venomous", "rusty", "swift"];
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
    level, rarity, seed, requirements, modifiers, skills, staminaCost: data.stamina,
    dropChance: Math.min(0.6, 0.12 + power * 0.08), sellValue: Math.max(1, Math.round((level + 1) * power * (4 + affixes.length * 2)))
  };
}

export function rollRarity(seed: number): Rarity {
  const roll = mulberry32(seed)();
  return roll < 0.58 ? "common" : roll < 0.83 ? "uncommon" : roll < 0.96 ? "rare" : "epic";
}
export function meetsRequirements(item: ItemInstance, stats: Stats): boolean {
  return Object.entries(item.requirements).every(([key, value]) => stats[key as StatKey] >= (value ?? 0));
}
function baseModifiers(damageMultiplier: number, attackSpeedMultiplier: number): ItemModifiers {
  return { damageMultiplier, attackSpeedMultiplier, critChance: 0, manaRegenMultiplier: 1, magicAmp: 0, bleedChance: 0, poisonChance: 0, stunChance: 0 };
}
function applyAffix(modifiers: ItemModifiers, affix: AffixId, power: number): void {
  if (affix === "bleeding") modifiers.bleedChance += 0.08 * power;
  if (affix === "venomous" || affix === "rusty") modifiers.poisonChance += (affix === "venomous" ? 0.1 : 0.05) * power;
  if (affix === "stunning") modifiers.stunChance += 0.07 * power;
  if (affix === "focused") modifiers.magicAmp += 0.1 * power;
  if (affix === "swift") modifiers.attackSpeedMultiplier += 0.12 * power;
}
function mulberry32(seed: number): () => number { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function capitalize(value: string): string { return value[0].toUpperCase() + value.slice(1); }
