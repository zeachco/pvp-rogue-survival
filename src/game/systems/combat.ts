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
        creep.takeDamage(attack.damage); if (attack.weapon) applyWeaponEffects(creep, attack.weapon, random);
        if (attack.skill === "bash") creep.addStatus({ kind: "stun", remaining: 1.1, damagePerSecond: 0 });
        if (attack.skill === "sweep") creep.addStatus({ kind: "bleed", remaining: 3, damagePerSecond: 0.35 });
      }
    } else if (hero.active && attack.contains(hero.position, hero.radius)) {
      hero.takeDamage(attack.damage); if (attack.weapon) applyWeaponEffects(hero, attack.weapon, random);
    }
  }
  for (const projectile of state.projectiles) {
    if (!projectile.active) continue;
    if (projectile.owner === "hero") {
      const hit = state.creeps.find((creep) => creep.active && distance(projectile.position, creep.position) <= projectile.radius + creep.radius);
      if (hit) { hit.takeDamage(projectile.damage); applyWeaponEffects(hit, equipped, random); if (projectile.skill === "arcaneBolt") hit.addStatus({ kind: "stun", remaining: 0.35, damagePerSecond: 0 }); projectile.active = false; }
    } else if (distance(projectile.position, hero.position) <= projectile.radius + hero.radius) { hero.takeDamage(projectile.damage); projectile.active = false; }
    if (projectile.position.x < -40 || projectile.position.y < -40 || projectile.position.x > width + 40 || projectile.position.y > height + 40) projectile.active = false;
  }
}

export function applyWeaponEffects(target: Unit, item: ItemInstance, random: RandomSource): void {
  if (random.next() < item.modifiers.bleedChance) target.addStatus({ kind: "bleed", remaining: 3, damagePerSecond: 0.25 });
  if (random.next() < item.modifiers.poisonChance) target.addStatus({ kind: "poison", remaining: 4, damagePerSecond: 0.2 + target.stats.spirit * 0.02 });
  if (random.next() < item.modifiers.stunChance) target.addStatus({ kind: "stun", remaining: 0.7, damagePerSecond: 0 });
}
