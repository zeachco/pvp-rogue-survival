import type { ItemInstance } from "../../../common/items";
import type { RandomSource } from "../../../common/random";
import type { ArenaState } from "../ArenaState";
import type { Hero } from "../Hero";
import type { Unit } from "../Unit";
import { distance } from "../types";

export function resolveCombat(state: ArenaState, hero: Hero, equipped: ItemInstance, width: number, height: number, random: RandomSource): void {
  for (const attack of state.attacks) {
    if (!attack.shouldResolve()) continue;
    attack.markResolved();
    if (attack.owner === "hero") {
      for (const creep of state.creeps) if (creep.active && attack.contains(creep.position, creep.radius)) {
        const dealt = creep.receiveDamage(attack.damage, random, attack.source as Unit | undefined, true, false, attack.presentation); if (attack.weapon) { applyWeaponEffects(creep, attack.weapon, random, attack.source as Unit | undefined); applyLifeSteal(attack.source as Unit | undefined, attack.weapon, dealt); }
        if (attack.skill === "bash") creep.addStatus({ kind: "stun", remaining: 1.1, damagePerSecond: 0 });
        if (attack.skill === "shockwave") creep.addStatus({ kind: "stun", remaining: 0.6, damagePerSecond: 0 });
        if (attack.skill === "sweep") creep.addStatus({ kind: "bleed", remaining: 3, damagePerSecond: 0.35 });
        if (attack.skill === "cleave") creep.addStatus({ kind: "bleed", remaining: 2, damagePerSecond: 0.45, source: attack.source as Unit | undefined });
      }
    } else if (hero.active && attack.contains(hero.position, hero.radius)) {
      const dealt = hero.receiveDamage(attack.damage, random, attack.source as Unit | undefined, true, false, attack.presentation); if (attack.weapon) { applyWeaponEffects(hero, attack.weapon, random, attack.source as Unit | undefined); applyLifeSteal(attack.source as Unit | undefined, attack.weapon, dealt); }
    }
  }
  for (const projectile of state.projectiles) {
    if (!projectile.active) continue;
    if (projectile.owner === "hero") {
      const hit = state.creeps.find((creep) => creep.active && distance(projectile.position, creep.position) <= projectile.radius + creep.radius);
      if (hit) { const dealt = hit.receiveDamage(projectile.damage, random, projectile.source, true, false, projectile.presentation); applyWeaponEffects(hit, equipped, random, projectile.source); applyLifeSteal(projectile.source, equipped, dealt); if (projectile.skill === "arcaneBolt") hit.addStatus({ kind: "stun", remaining: 0.35, damagePerSecond: 0, source: projectile.source }); projectile.active = false; }
    } else if (distance(projectile.position, hero.position) <= projectile.radius + hero.radius) { const weapon = projectile.source?.mainHand; const dealt = hero.receiveDamage(projectile.damage, random, projectile.source, true, false, projectile.presentation); if (weapon) applyLifeSteal(projectile.source, weapon, dealt); projectile.active = false; }
    if (projectile.position.x < -40 || projectile.position.y < -40 || projectile.position.x > width + 40 || projectile.position.y > height + 40) projectile.active = false;
  }
}

export function applyWeaponEffects(target: Unit, item: ItemInstance, random: RandomSource, source?: Unit): void {
  if (random.next() < item.modifiers.bleedChance) target.addStatus({ kind: "bleed", remaining: 3, damagePerSecond: 0.25, source });
  if (random.next() < item.modifiers.poisonChance) target.addStatus({ kind: "poison", remaining: 4, damagePerSecond: 0.2 + target.stats.spirit * 0.02, source });
  if (random.next() < item.modifiers.stunChance) target.addStatus({ kind: "stun", remaining: 0.7, damagePerSecond: 0, source });
}
function applyLifeSteal(source: Unit | undefined, weapon: ItemInstance, damageDealt: number): void { if (!source || damageDealt <= 0) return; const items = [weapon, source.offHand].filter(Boolean) as ItemInstance[]; const fraction = items.reduce((sum, item) => sum + item.modifiers.lifeStealBase + (item.modifiers.lifeStealBase > 0 ? 0.001 * source.stats.spirit : 0), 0); if (fraction > 0) source.heal(damageDealt * fraction); }
