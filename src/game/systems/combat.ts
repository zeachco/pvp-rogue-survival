import { itemPhysicalBonusFraction, itemRequirementMultiplier, type ItemInstance } from "../../../common/items";
import { manaConversionFraction } from "../../../common/combat";
import { SKILLS } from "../../../common/content";
import type { RandomSource } from "../../../common/random";
import type { ArenaState } from "../ArenaState";
import type { Hero } from "../Hero";
import type { Unit } from "../Unit";
import { distance } from "../types";

export function resolveCombat(state: ArenaState, hero: Hero, equipped: ItemInstance | undefined, width: number, height: number, random: RandomSource): void {
  for (const attack of state.attacks) {
    if (!attack.shouldResolve()) continue;
    attack.markResolved();
    if (attack.owner === "hero") {
      for (const creep of state.creeps) if (creep.active && attack.contains(creep.position, creep.radius)) {
        const source = attack.source as Unit | undefined; const dealt = creep.receiveDamage(attack.damage, random, source, true, false, attack.presentation); if (!creep.lastHitDodged && (attack.presentation.kind === "physical" || Boolean(attack.skill && SKILLS[attack.skill].resource === "stamina"))) applyImpactPush(creep, source); if (attack.weapon && !creep.lastHitDodged) { applyWeaponEffects(creep, attack.weapon, random, source); applyLifeSteal(source, attack.weapon, dealt); applyPhysicalAccessoryDamage(creep, source, dealt, attack.presentation.kind === "physical", random); if (!attack.skill) applyManaDrain(source, dealt); }
        if (attack.skill === "bash") creep.addStatus({ kind: "stun", remaining: 1.1, damagePerSecond: 0 });
        if (attack.skill === "shockwave") creep.addStatus({ kind: "stun", remaining: 0.6, damagePerSecond: 0 });
        if (attack.skill === "sweep") creep.addStatus({ kind: "bleed", remaining: 3, damagePerSecond: 0.35 });
        if (attack.skill === "rent") (attack.source as Unit | undefined)?.heal((attack.source as Unit).maxHp * 0.01);
        if (attack.skill === "cleave") creep.addStatus({ kind: "bleed", remaining: 2, damagePerSecond: 0.45, source: attack.source as Unit | undefined });
        if (attack.skill === "fireBreath" && !creep.lastHitDodged) creep.addStatus({ kind: "burn", remaining: 4, damagePerSecond: 0.25 + 0.03 * ((attack.source as Unit | undefined)?.stats.spirit ?? 0), source: attack.source as Unit | undefined });
      }
    } else if (hero.active && attack.contains(hero.position, hero.radius)) {
      const dealt = hero.receiveDamage(attack.damage, random, attack.source as Unit | undefined, true, false, attack.presentation); if (attack.weapon && !hero.lastHitDodged) { applyWeaponEffects(hero, attack.weapon, random, attack.source as Unit | undefined); applyLifeSteal(attack.source as Unit | undefined, attack.weapon, dealt); } if (attack.skill === "fireBreath" && !hero.lastHitDodged) hero.addStatus({ kind: "burn", remaining: 4, damagePerSecond: 0.25 + 0.03 * ((attack.source as Unit | undefined)?.stats.spirit ?? 0), source: attack.source as Unit | undefined });
    }
  }
  for (const projectile of state.projectiles) {
    if (!projectile.active) continue;
    if (projectile.owner === "hero") {
      const hit = state.creeps.find((creep) => creep.active && projectile.canHit(creep.build.id) && distance(projectile.position, creep.position) <= projectile.radius + creep.radius);
      if (hit) {
        projectile.markHit(hit.build.id);
        if (projectile.skill === "frostOrb") hit.addStatus({ kind: "freeze", remaining: 2, damagePerSecond: 0, source: projectile.source });
        else { const weapon = projectile.weapon ?? equipped; const dealt = hit.receiveDamage(projectile.damage, random, projectile.source, true, false, projectile.presentation); projectile.recordDamage(dealt); if (!hit.lastHitDodged && (projectile.presentation.kind === "physical" || isStaminaSkill(projectile.skill))) applyImpactPush(hit, projectile.source); if (weapon && !hit.lastHitDodged) { applyWeaponEffects(hit, weapon, random, projectile.source); applyLifeSteal(projectile.source, weapon, dealt); applyPhysicalAccessoryDamage(hit, projectile.source, dealt, projectile.presentation.kind === "physical", random); if (!projectile.skill) applyManaDrain(projectile.source, dealt); if (projectile.skill === "arcaneBolt") hit.addStatus({ kind: "stun", remaining: 0.35, damagePerSecond: 0, source: projectile.source }); if (projectile.skill === "rendingThrow") hit.addStatus({ kind: "bleed", remaining: 3, damagePerSecond: 0.25, source: projectile.source }); if (projectile.skill === "frostSpike") hit.addStatus({ kind: "freeze", remaining: 2, damagePerSecond: 0, source: projectile.source }); } if (projectile.skill !== "orbitingHammers" && projectile.skill !== "vampiricBoomerang") projectile.active = false; }
      }
    } else if (distance(projectile.position, hero.position) <= projectile.radius + hero.radius) { const weapon = projectile.weapon ?? projectile.source?.mainHand; const dealt = hero.receiveDamage(projectile.damage, random, projectile.source, true, false, projectile.presentation); if (weapon && !hero.lastHitDodged) { applyWeaponEffects(hero, weapon, random, projectile.source); applyLifeSteal(projectile.source, weapon, dealt); } projectile.active = false; }
    if (projectile.position.x < -40 || projectile.position.y < -40 || projectile.position.x > width + 40 || projectile.position.y > height + 40) projectile.active = false;
  }
}

function isStaminaSkill(skill?: string): boolean { return Boolean(skill && skill in SKILLS && SKILLS[skill as keyof typeof SKILLS].resource === "stamina"); }
function applyImpactPush(target: Unit, source?: Unit): void { if (!source) return; const dx = target.position.x - source.position.x; const dy = target.position.y - source.position.y; const distance = Math.hypot(dx, dy); if (distance <= 0) return; const movementSpeed = Math.hypot(source.velocity.x, source.velocity.y); const impulse = 10 + source.stats.strength * 2 + movementSpeed * 0.15; target.velocity.x += dx / distance * impulse; target.velocity.y += dy / distance * impulse; (target as Unit & { interruptAttack?: () => void }).interruptAttack?.(); }

export function applyWeaponEffects(target: Unit, item: ItemInstance, random: RandomSource, source?: Unit): void {
  const effectiveness = source ? itemRequirementMultiplier(item, source.stats) : 1;
  if (random.next() < item.modifiers.bleedChance * effectiveness) target.addStatus({ kind: "bleed", remaining: 3, damagePerSecond: 0.25, source });
  if (random.next() < item.modifiers.poisonChance * effectiveness) { const voodoo = source?.knownSkills.has("voodoo") ? 1 + Math.min(1.5, source.stats.spirit * 0.03) : 1; target.addStatus({ kind: "poison", remaining: 4, damagePerSecond: (0.2 + (source?.stats.spirit ?? 0) * 0.02) * voodoo, source }); }
  if (random.next() < item.modifiers.stunChance * effectiveness) target.addStatus({ kind: "stun", remaining: 0.7, damagePerSecond: 0, source });
}
function applyLifeSteal(source: Unit | undefined, weapon: ItemInstance, damageDealt: number): void { if (!source || damageDealt <= 0) return; const items = [weapon, source.offHand].filter(Boolean) as ItemInstance[]; const fraction = items.reduce((sum, item) => { const effectiveness = itemRequirementMultiplier(item, source.stats); const base = (item.modifiers.lifeStealBase ?? 0) * effectiveness; return sum + (base + (base > 0 ? 0.001 * source.stats.spirit : 0)) * effectiveness; }, 0); if (fraction > 0) source.heal(damageDealt * fraction); }
function applyManaDrain(source: Unit | undefined, damageDealt: number): void { if (!source?.knownSkills.has("manaDrain") || damageDealt <= 0) return; source.restoreMana(damageDealt * manaConversionFraction(source.skillLevels.get("manaDrain") ?? 1)); }
function applyPhysicalAccessoryDamage(target: Unit, source: Unit | undefined, physicalDamage: number, physical: boolean, random: RandomSource): void { if (!source || !physical || physicalDamage <= 0) return; const fraction = [source.offHand, source.amulet, source.charm].reduce((sum, accessory) => sum + itemPhysicalBonusFraction(accessory) * (accessory ? itemRequirementMultiplier(accessory, source.stats) : 1), 0); if (fraction > 0) target.receiveDamage(physicalDamage * fraction, random, source, false, false, { kind: "magic" }); }
