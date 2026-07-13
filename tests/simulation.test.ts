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

describe("arena systems", () => {
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
    state.pendingPickups.add("drop"); state.defeatedPositions.set("unit", { x: 1, y: 2 }); state.clear();
    expect(state.pendingPickups.size).toBe(0); expect(state.defeatedPositions.size).toBe(0);
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
    hero.receiveDamage(10, { next: () => 0 }); expect(hero.hp).toBe(6);
    hero.damageFloorOne = true; hero.receiveDamage(100, { next: () => 1 }); expect(hero.hp).toBe(1); expect(hero.active).toBeTrue();
  });
});
