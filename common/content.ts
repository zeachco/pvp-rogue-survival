import type { AffixId, ItemModifiers, SkillId, WeaponClass } from "./items";
import type { CreepKind } from "./protocol";
import type { StatKey } from "./progression";

export interface WeaponDefinition {
  id: WeaponClass;
  label: string;
  damage: number;
  weight: number;
  stamina: number;
  requirement?: StatKey;
  skill?: SkillId;
  range?: number;
  projectile?: boolean;
}

export interface SkillDefinition {
  id: SkillId;
  label: string;
  damageMultiplier: number;
  cooldown: number;
  range?: number;
  resource: "stamina" | "mana" | "life";
  description: string;
  passive?: boolean;
  cost?: number;
  enemyEligible?: boolean;
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
  club: { id: "club", label: "Club", damage: 1, weight: 12, stamina: 0.1, requirement: "strength", skill: "bash" },
  sword: { id: "sword", label: "Sword", damage: 1.15, weight: 14, stamina: 0.2, requirement: "strength", skill: "sweep" },
  dagger: { id: "dagger", label: "Dagger", damage: 0.72, weight: 8, stamina: 0.12, requirement: "agility", skill: "flurry" },
  mace: { id: "mace", label: "Mace", damage: 1.35, weight: 18, stamina: 0.28, requirement: "strength", skill: "shockwave" },
  axe: { id: "axe", label: "Axe", damage: 1.22, weight: 13, stamina: 0.22, requirement: "strength", skill: "cleave" },
  throwingAxe: { id: "throwingAxe", label: "Throwing Axe", damage: 1.05, weight: 10, stamina: 0.18, requirement: "agility", skill: "rendingThrow", range: 210, projectile: true },
  hammer: { id: "hammer", label: "Hammer", damage: 1.18, weight: 16, stamina: 0.2, requirement: "strength", skill: "orbitingHammers" },
  staff: { id: "staff", label: "Staff", damage: 0.8, weight: 16, stamina: 0.1, requirement: "magic", skill: "arcaneBolt", range: 330, projectile: true },
  scepter: { id: "scepter", label: "Scepter", damage: 0, weight: 0, stamina: 0, requirement: "spirit", skill: "thunderAura" }
};

export const SKILLS: Readonly<Record<SkillId, SkillDefinition>> = {
  bash: { id: "bash", label: "Bash", damageMultiplier: 1.5, cooldown: 5, range: 105, resource: "stamina", description: "A heavy full-circle strike that always stuns for 1.1 seconds." },
  sweep: { id: "sweep", label: "Sweep", damageMultiplier: 1.25, cooldown: 5, range: 135, resource: "stamina", description: "A broad sword sweep that always inflicts a strong 3-second bleed." },
  flurry: { id: "flurry", label: "Flurry", damageMultiplier: 0.8, cooldown: 2.5, range: 105, resource: "stamina", description: "A fast dagger attack with shortened recovery and a wide close-range arc." },
  shockwave: { id: "shockwave", label: "Shockwave", damageMultiplier: 1.35, cooldown: 4.5, range: 125, resource: "stamina", description: "A full-circle physical impact that always stuns for 0.6 seconds." },
  cleave: { id: "cleave", label: "Cleave", damageMultiplier: 1.45, cooldown: 4, range: 125, resource: "stamina", description: "A powerful axe cleave that always inflicts a 2-second bleed." },
  whirlwind: { id: "whirlwind", label: "Whirlwind", damageMultiplier: 0, cooldown: 12, range: 90, resource: "stamina", cost: 3, description: "Spinning edges follow the hero for 3–30 seconds; movement scales from 0.5× to 1.5× speed and pulses deal Strength-scaled physical damage." },
  rendingThrow: { id: "rendingThrow", label: "Rending Throw", damageMultiplier: 1.35, cooldown: 4, range: 240, resource: "stamina", description: "A short-ranged physical axe projectile that guarantees a standard bleed." },
  vampiricBoomerang: { id: "vampiricBoomerang", label: "Vampiric Boomerang", damageMultiplier: 1.1, cooldown: 8, range: 260, resource: "life", description: "Spends 30% of remaining HP, then launches a huge slow crescent that hits each foe on both legs and heals from their cumulative actual damage when it returns." },
  orbitingHammers: { id: "orbitingHammers", label: "Orbiting Hammers", damageMultiplier: 0.85, cooldown: 4.5, range: 240, resource: "mana", description: "Launches three drifting magical hammers that spiral outward, persist through impacts, and hit each enemy at most once." },
  arcaneBolt: { id: "arcaneBolt", label: "Arcane Bolt", damageMultiplier: 1.7, cooldown: 5, range: 330, resource: "mana", description: "A long-ranged magical projectile that stuns its target for 0.35 seconds." },
  gravityPull: { id: "gravityPull", label: "Force Field", damageMultiplier: 0.2, cooldown: 18, range: 600, resource: "mana", description: "Spends 8 mana to lightly damage enemies and launch them away from the hero without moving drops." },
  attraction: { id: "attraction", label: "Attraction", damageMultiplier: 0, cooldown: 0, resource: "mana", passive: true, description: "Passively pulls uncollected item drops toward the hero." },
  manaDrain: { id: "manaDrain", label: "Mana Drain", damageMultiplier: 0, cooldown: 0, resource: "mana", passive: true, description: "Restores mana from actual basic main-hand attack damage." },
  penance: { id: "penance", label: "Penance", damageMultiplier: 0, cooldown: 0, resource: "mana", passive: true, description: "Restores mana from damage prevented by successful buckler blocks, scaling with Spirit." },
  thorns: { id: "thorns", label: "Thorns", damageMultiplier: 0, cooldown: 0, resource: "stamina", description: "Passive: returns 5% of incoming direct damage, even without a block." },
  reflectiveSurge: { id: "reflectiveSurge", label: "Reflective Surge", damageMultiplier: 0, cooldown: 16, range: 600, resource: "stamina", description: "Spends 3 stamina to double returned damage and add 1% incoming damage for 6 seconds." },
  frostOrb: { id: "frostOrb", label: "Frozen Orb", damageMultiplier: 0.7, cooldown: 20, range: 500, resource: "mana", description: "Spends 10 mana to launch a slow freezing orb that sprays damaging ice spikes in every direction." },
  fireBreath: { id: "fireBreath", label: "Fire Breath", damageMultiplier: 1.1, cooldown: 9, range: 150, resource: "mana", cost: 4, enemyEligible: true, description: "Breathes advancing fire arcs in a cone and burns targets for eight seconds, scaling with Spirit." },
  swamp: { id: "swamp", label: "Gooey Swamp", damageMultiplier: 0, cooldown: 100, range: 200, resource: "mana", description: "Creates a large stationary swamp at the closest enemy that slows creeps and adds a Poison stack each second." },
  rapidRegen: { id: "rapidRegen", label: "Rapid Regeneration", damageMultiplier: 0, cooldown: 20, resource: "mana", cost: 4, description: "While missing health, grants a level-scaled regeneration surge for 10–30 seconds." },
  voodoo: { id: "voodoo", label: "Voodoo", damageMultiplier: 0, cooldown: 0, resource: "mana", passive: true, description: "Passive: Spirit amplifies poison damage applied by this unit." },
  healing: { id: "healing", label: "Healing", damageMultiplier: 0, cooldown: 15, resource: "mana", description: "Below 75% HP, restores level-scaled current health plus 5–10% maximum health and spends 2 mana per HP restored." },
  rent: { id: "rent", label: "Rent", damageMultiplier: 1.25, cooldown: 4, range: 180, resource: "life", description: "A full-circle blood-edge attack that spends 10% of remaining HP, leaves at least 1 HP, and adds the HP spent to damage." },
  blocking: { id: "blocking", label: "Blocking", damageMultiplier: 0, cooldown: 1, resource: "stamina", description: "A reactive buckler block. Return bucklers divide recovery by main-hand attack speed." },
  slowAura: { id: "slowAura", label: "Glacial Aura", damageMultiplier: 0, cooldown: 0, resource: "mana", passive: true, description: "Passively slows nearby enemy movement." },
  hinderingAura: { id: "hinderingAura", label: "Hindering Aura", damageMultiplier: 0, cooldown: 0, resource: "mana", passive: true, description: "Passively slows nearby enemy attacks." },
  deathBurst: { id: "deathBurst", label: "Death Burst", damageMultiplier: 0, cooldown: 0, resource: "mana", passive: true, description: "Nearby enemies explode when defeated, damaging other foes." },
  sunburnAura: { id: "sunburnAura", label: "Sunburn", damageMultiplier: 0, cooldown: 5, resource: "mana", passive: true, description: "Burns every nearby foe; Spirit accelerates pulses and Intelligence raises damage." },
  thunderAura: { id: "thunderAura", label: "Thunder Aura", damageMultiplier: 0, cooldown: 10, resource: "mana", passive: true, description: "Strikes a random nearby foe; critical strikes chain lightning." },
  timeHarvest: { id: "timeHarvest", label: "Time Harvest", damageMultiplier: 0, cooldown: 0, resource: "mana", passive: true, description: "After each enemy kill, reduces every hero cooldown by 1 to 10 seconds based on skill level." }
};

export const ENEMY_BONUS_SKILLS = Object.values(SKILLS).filter((skill) => skill.enemyEligible).map((skill) => skill.id);

export const AFFIXES: Readonly<Record<AffixId, AffixDefinition>> = {
  rusty: { id: "rusty", compatibleWeapons: ["club", "sword", "dagger", "mace", "axe", "throwingAxe", "hammer"], modifierPerPower: { poisonChance: 0.05 } },
  venomous: { id: "venomous", compatibleWeapons: ["sword", "dagger", "axe", "throwingAxe", "staff"], modifierPerPower: { poisonChance: 0.1 } },
  bleeding: { id: "bleeding", compatibleWeapons: ["sword", "dagger", "axe", "throwingAxe"], modifierPerPower: { bleedChance: 0.08 } },
  stunning: { id: "stunning", compatibleWeapons: ["club", "mace", "hammer"], modifierPerPower: { stunChance: 0.07 } },
  focused: { id: "focused", compatibleWeapons: ["staff", "scepter"], modifierPerPower: { magicAmp: 0.1 } },
  swift: { id: "swift", compatibleWeapons: ["club", "sword", "dagger", "mace", "axe", "throwingAxe", "hammer", "staff", "scepter"], modifierPerPower: { attackSpeedMultiplier: 0.12 } }
};

export const ENEMY_ARCHETYPES: Readonly<Record<CreepKind, EnemyArchetypeDefinition>> = {
  melee: { id: "melee", maxSpeed: 72, acceleration: 190, attackRange: 62 },
  bubbleShooter: { id: "bubbleShooter", maxSpeed: 72, acceleration: 190, attackRange: 330, retreatRange: 210, preferredRange: 285 },
  rival: { id: "rival", maxSpeed: 100, acceleration: 250, attackRange: 62 }
};
