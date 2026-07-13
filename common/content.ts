import type { AffixId, ItemModifiers, SkillId, WeaponClass } from "./items";
import type { CreepKind } from "./protocol";
import type { StatKey } from "./progression";

export interface WeaponDefinition {
  id: WeaponClass;
  label: string;
  damage: number;
  speed: number;
  stamina: number;
  requirement?: StatKey;
  skill?: SkillId;
}

export interface SkillDefinition {
  id: SkillId;
  label: string;
  damageMultiplier: number;
  cooldown: number;
  range?: number;
  resource: "stamina" | "mana";
}

export interface AffixDefinition {
  id: AffixId;
  compatibleWeapons: readonly WeaponClass[];
  modifierPerPower: Partial<ItemModifiers>;
}

export interface EnemyArchetypeDefinition {
  id: CreepKind;
  maxSpeed: number;
  acceleration: number;
  attackRange: number;
  retreatRange?: number;
  preferredRange?: number;
}

export const WEAPONS: Readonly<Record<WeaponClass, WeaponDefinition>> = {
  club: { id: "club", label: "Club", damage: 1, speed: 1, stamina: 0.1, requirement: "strength", skill: "bash" },
  sword: { id: "sword", label: "Sword", damage: 1.15, speed: 0.95, stamina: 0.2, requirement: "strength", skill: "sweep" },
  dagger: { id: "dagger", label: "Dagger", damage: 0.72, speed: 1.55, stamina: 0.12, requirement: "agility", skill: "flurry" },
  mace: { id: "mace", label: "Mace", damage: 1.35, speed: 0.72, stamina: 0.28, requirement: "strength", skill: "bash" },
  staff: { id: "staff", label: "Staff", damage: 0.8, speed: 0.8, stamina: 0.1, requirement: "magic", skill: "arcaneBolt" }
};

export const SKILLS: Readonly<Record<SkillId, SkillDefinition>> = {
  bash: { id: "bash", label: "Bash", damageMultiplier: 1.5, cooldown: 5, resource: "stamina" },
  sweep: { id: "sweep", label: "Sweep", damageMultiplier: 1.25, cooldown: 5, range: 135, resource: "stamina" },
  flurry: { id: "flurry", label: "Flurry", damageMultiplier: 0.8, cooldown: 2.5, resource: "stamina" },
  arcaneBolt: { id: "arcaneBolt", label: "Arcane Bolt", damageMultiplier: 1.7, cooldown: 5, range: 330, resource: "mana" },
  healing: { id: "healing", label: "Healing", damageMultiplier: 0, cooldown: 8, resource: "mana" }
};

export const AFFIXES: Readonly<Record<AffixId, AffixDefinition>> = {
  rusty: { id: "rusty", compatibleWeapons: ["club", "sword", "dagger", "mace"], modifierPerPower: { poisonChance: 0.05 } },
  venomous: { id: "venomous", compatibleWeapons: ["sword", "dagger", "staff"], modifierPerPower: { poisonChance: 0.1 } },
  bleeding: { id: "bleeding", compatibleWeapons: ["sword", "dagger"], modifierPerPower: { bleedChance: 0.08 } },
  stunning: { id: "stunning", compatibleWeapons: ["club", "mace"], modifierPerPower: { stunChance: 0.07 } },
  focused: { id: "focused", compatibleWeapons: ["staff"], modifierPerPower: { magicAmp: 0.1 } },
  swift: { id: "swift", compatibleWeapons: ["club", "sword", "dagger", "mace", "staff"], modifierPerPower: { attackSpeedMultiplier: 0.12 } }
};

export const ENEMY_ARCHETYPES: Readonly<Record<CreepKind, EnemyArchetypeDefinition>> = {
  melee: { id: "melee", maxSpeed: 72, acceleration: 190, attackRange: 62 },
  bubbleShooter: { id: "bubbleShooter", maxSpeed: 72, acceleration: 190, attackRange: 330, retreatRange: 210, preferredRange: 285 },
  rival: { id: "rival", maxSpeed: 100, acceleration: 250, attackRange: 62 }
};
