import { describe, expect, test } from "bun:test";
import { SeededRandom } from "../common/random";
import { AttackArea } from "../src/game/AttackArea";
import { ArenaState } from "../src/game/ArenaState";
import { GameMap } from "../src/game/Map";
import { Projectile } from "../src/game/Projectile";
import { removeInactive } from "../src/game/systems/lifecycle";

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
});
