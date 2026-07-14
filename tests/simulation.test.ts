import { describe, expect, test } from "bun:test";
import { SeededRandom } from "../common/random";
import { AttackArea } from "../src/game/AttackArea";
import { ArenaState } from "../src/game/ArenaState";
import { GameMap } from "../src/game/Map";
import { Projectile } from "../src/game/Projectile";
import { removeInactive } from "../src/game/systems/lifecycle";
import { correctArenaBoundary } from "../src/game/bounds";
import { Hero } from "../src/game/Hero";
import { generateBuckler } from "../common/items";
import type { CombatText } from "../src/game/CombatText";
import { SpellEffect } from "../src/game/SpellEffect";
import { ItemDrop } from "../src/game/ItemDrop";
import { starterClub } from "../common/items";
import { weaponAttackSpeed } from "../common/combat";

describe("arena systems", () => {
  test("moves orbiting hammers around their moving source and expires them", () => { const hero = new Hero({ x: 50, y: 50 }); const hammer = Projectile.orbitingHammer(hero, 0, 4, { kind: "magic" }); hero.position.x = 70; hammer.update(0.1); expect(Math.hypot(hammer.position.x - hero.position.x, hammer.position.y - hero.position.y)).toBeCloseTo(34.75); hammer.update(2.4); expect(hammer.active).toBeFalse(); });
  test("pulls item drops toward an attracting hero at a bounded speed", () => { const drop = new ItemDrop("drop", starterClub(), { x: 100, y: 0 }); drop.pullToward({ x: 0, y: 0 }, 35, 1); expect(drop.position).toEqual({ x: 65, y: 0 }); drop.pullToward({ x: 60, y: 0 }, 35, 1); expect(drop.position).toEqual({ x: 60, y: 0 }); });
  test("cancels an unresolved enemy telegraph when its source dies", () => {
    const source = { active: false };
    const attack = new AttackArea("creep", { x: 10, y: 10 }, 0, 70, Math.PI, 0.5, 0.1, 2, source);
    attack.update(0.6);
    expect(attack.shouldResolve()).toBeFalse(); expect(attack.active).toBeFalse();
  });

  test("launched projectiles advance independently", () => {
    const projectile = new Projectile({ x: 0, y: 0 }, { x: 100, y: 0 }, 1);
    projectile.update(0.1);
    expect(projectile.active).toBeTrue(); expect(projectile.position.x).toBeGreaterThan(0);
  });

  test("cleanup and arena reset remove transient state", () => {
    const state = new ArenaState(); const projectile = new Projectile({ x: 0, y: 0 }, { x: 1, y: 0 });
    projectile.active = false; state.projectiles.push(projectile); removeInactive(state.projectiles); expect(state.projectiles).toHaveLength(0);
    state.pendingPickups.add("drop"); state.defeatedPositions.set("unit", { x: 1, y: 2 }); state.addCombatText({ position: { x: 1, y: 1 }, amount: 2, kind: "physical", critical: false, age: 0, lifetime: 1, drift: 0 }); state.clear();
    expect(state.pendingPickups.size).toBe(0); expect(state.defeatedPositions.size).toBe(0); expect(state.combatTexts).toHaveLength(0);
  });

  test("edge spawning is reproducible with a seeded random source", () => {
    const map = new GameMap();
    expect(map.randomEdgeSpawn(new SeededRandom(123))).toEqual(map.randomEdgeSpawn(new SeededRandom(123)));
  });

  test("pushes outside objects inward and locks entered objects to the arena", () => {
    const object = { position: { x: -20, y: 50 }, radius: 10, enteredArena: false, velocity: { x: -100, y: 4 } };
    correctArenaBoundary(object, 100, 100, 0.5); expect(object.position.x).toBe(-5);
    correctArenaBoundary(object, 100, 100, 1); expect(object.enteredArena).toBeTrue();
    object.position.x = 0; correctArenaBoundary(object, 100, 100, 0.1); expect(object.position.x).toBe(10); expect(object.velocity.x).toBe(0); expect(object.velocity.y).toBe(4);
  });

  test("bucklers partially block with Strength and training damage stops at one", () => {
    const hero = new Hero({ x: 50, y: 50 }); const buckler = generateBuckler(0, "common", 12);
    hero.configureStats({ agility: 5, strength: 5, magic: 0, spirit: 0, intelligence: 0 }, buckler);
    hero.receiveDamage(10, { next: () => 0 }); expect(hero.hp).toBe(6); expect(hero.stamina).toBe(5);
    hero.damageFloorOne = true; hero.receiveDamage(100, { next: () => 1 }); expect(hero.hp).toBe(1); expect(hero.active).toBeTrue();
  });

  test("allows 100% block chance and spends stamina only on successful blocks", () => {
    const hero = new Hero({ x: 50, y: 50 }); const buckler = generateBuckler(0, "common", 12);
    hero.configureStats({ agility: 90, strength: 90, magic: 0, spirit: 0, intelligence: 0 }, buckler);
    const hp = hero.hp; hero.receiveDamage(10, { next: () => 0.999 }); expect(hero.hp).toBe(hp); expect(hero.stamina).toBe(hero.maxStamina - 1);
    hero.stamina = 0; hero.receiveDamage(10, { next: () => 0 }); expect(hero.hp).toBe(hp - 10); expect(hero.stamina).toBe(0);
    hero.stamina = 1; hero.receiveDamage(10, { next: () => 1 }); expect(hero.stamina).toBe(1);
  });

  test("puts successful blocking on cooldown and scales Return blocking by attack speed", () => {
    const hero = new Hero({ x: 50, y: 50 }); const club = starterClub(); const buckler = { ...generateBuckler(0, "common", 12), reflectionComponents: ["return" as const] };
    const stats = { agility: 100, strength: 100, magic: 0, spirit: 0, intelligence: 0 }; hero.configureStats(stats, buckler, club);
    const hp = hero.hp; hero.receiveDamage(10, { next: () => 0 }); expect(hero.hp).toBe(hp); expect(hero.blockCooldown).toBeCloseTo(1 / weaponAttackSpeed(club, stats));
    hero.receiveDamage(10, { next: () => 0 }); expect(hero.hp).toBe(hp - 10); hero.updateResources(hero.blockCooldown, { next: () => 1 }); expect(hero.blockCooldown).toBe(0);
  });

  test("emits typed damage, healing, and inherited shield-return numbers", () => {
    const defender = new Hero({ x: 50, y: 50 }); const attacker = new Hero({ x: 60, y: 50 }); const texts: CombatText[] = [];
    defender.onCombatText = (text) => texts.push(text); attacker.onCombatText = (text) => texts.push(text);
    defender.receiveDamage(2, { next: () => 1 }, attacker, true, false, { kind: "magic", critical: true });
    defender.heal(1); expect(texts.map(({ kind, critical }) => ({ kind, critical }))).toEqual([{ kind: "magic", critical: true }, { kind: "healing", critical: false }]);
    const buckler = { ...generateBuckler(0, "common", 12), reflectionComponents: ["flat" as const] }; defender.configureStats({ agility: 0, strength: 1, magic: 0, spirit: 0, intelligence: 0 }, buckler); texts.length = 0;
    defender.receiveDamage(2, { next: () => 0 }, attacker, true, false, { kind: "fire", critical: true });
    expect(texts.some((text) => text.kind === "fire" && !text.critical && text.position.x === attacker.position.x)).toBeTrue();
  });
  test("shows post-mitigation overkill damage rather than remaining target health", () => { const hero = new Hero({ x: 10, y: 10 }); const texts: CombatText[] = []; hero.onCombatText = (text) => texts.push(text); hero.receiveDamage(250, { next: () => 1 }); expect(hero.hp).toBe(0); expect(texts[0].amount).toBe(250); });
  test("expires bounded spell effects and clears them with the arena", () => { const state = new ArenaState(); const effect = new SpellEffect("shockwave", { x: 5, y: 5 }); state.spellEffects.push(effect); effect.update(1); removeInactive(state.spellEffects); expect(state.spellEffects).toHaveLength(0); state.spellEffects.push(new SpellEffect("healing", { x: 5, y: 5 })); state.clear(); expect(state.spellEffects).toHaveLength(0); });
});
