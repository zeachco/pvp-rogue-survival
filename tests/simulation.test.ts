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
import { dropRarityColor, ItemDrop } from "../src/game/ItemDrop";
import { starterClub } from "../common/items";
import { weaponAttackSpeed } from "../common/combat";
import { DEFAULT_ALLOCATION, ZERO_STATS } from "../common/progression";
import { emptyScraps } from "../common/inventory";

describe("arena systems", () => {
  test("restores resources and clears transient combat state for a new realm", () => { const hero = new Hero({ x: 50, y: 50 }); hero.configureStats(ZERO_STATS); hero.hp = 1; hero.mana = 0; hero.stamina = 0; hero.velocity = { x: 9, y: 4 }; hero.blockCooldown = 1; hero.reflectiveSurgeRemaining = 2; hero.addStatus({ kind: "poison", remaining: 4, damagePerSecond: 1 }); hero.resetForRealm(); expect(hero.hp).toBe(hero.maxHp); expect(hero.mana).toBe(hero.maxMana); expect(hero.stamina).toBe(hero.maxStamina); expect(hero.statuses).toHaveLength(0); expect(hero.velocity).toEqual({ x: 0, y: 0 }); expect(hero.blockCooldown).toBe(0); expect(hero.reflectiveSurgeRemaining).toBe(0); });
  test("preserves mana and stamina across active-wave progression updates", () => { const hero = new Hero({ x: 50, y: 50 }); hero.configureStats({ ...ZERO_STATS, intelligence: 1, strength: 2 }); hero.mana = 2; hero.stamina = 3; hero.applyProgress({ level: 2, xp: 60, stats: { ...ZERO_STATS, intelligence: 3, strength: 4 }, allocation: { ...DEFAULT_ALLOCATION }, gold: 10, souls: 0, scraps: emptyScraps(), mainHand: starterClub(), inventoryTiles: [], learnedSkills: ["healing"], learnedSkillLevels: { healing: 1 }, universalSkills: ["healing"] }, true); expect(hero.maxMana).toBe(11); expect(hero.mana).toBe(2); expect(hero.stamina).toBe(3); });
  test("moves orbiting hammers around their moving source and expires them", () => { const hero = new Hero({ x: 50, y: 50 }); const hammer = Projectile.orbitingHammer(hero, 0, 4, { kind: "magic" }); hero.position.x = 70; hammer.update(0.1); expect(Math.hypot(hammer.position.x - hero.position.x, hammer.position.y - hero.position.y)).toBeCloseTo(34.75); hammer.update(2.4); expect(hammer.active).toBeFalse(); });
  test("keeps orbiting hammers active after hits and gives them diverging angular drift", () => { const hero = new Hero({ x: 50, y: 50 }); const slower = Projectile.orbitingHammer(hero, 0, 4, { kind: "magic" }, -0.1); const faster = Projectile.orbitingHammer(hero, 0, 4, { kind: "magic" }, 0.1); slower.markHit("creep-1"); expect(slower.canHit("creep-1")).toBeFalse(); expect(slower.active).toBeTrue(); slower.update(1); faster.update(1); expect(Math.abs(slower.position.x - faster.position.x) + Math.abs(slower.position.y - faster.position.y)).toBeGreaterThan(1); });
  test("moves Frozen Orb slowly and emits eight damaging radial spikes", () => { const hero = new Hero({ x: 0, y: 0 }); const orb = new Projectile(hero.position, { x: 100, y: 0 }, 5, "hero", "frostOrb", hero, { kind: "magic" }, starterClub()); orb.update(1); expect(orb.position.x).toBe(75); const spikes = orb.emitFrostSpikes(1 / 60); expect(spikes).toHaveLength(8); expect(spikes.every((spike) => spike.skill === "frostSpike" && spike.damage === 5)).toBeTrue(); });
  test("pulls ground drops toward an attracting hero at a bounded speed", () => { const drop = new ItemDrop({ id: "drop", kind: "item", item: starterClub() }, { x: 100, y: 0 }); drop.pullToward({ x: 0, y: 0 }, 35, 1); expect(drop.position).toEqual({ x: 65, y: 0 }); drop.pullToward({ x: 60, y: 0 }, 35, 1); expect(drop.position).toEqual({ x: 60, y: 0 }); });
  test("pushes equipment drops beyond the realm without moving Gold", () => { const item = new ItemDrop({ id: "item", kind: "item", item: starterClub() }, { x: 100, y: 0 }); item.applyPush({ x: 0, y: 0 }, 180); item.move(1); expect(item.position.x).toBe(280); expect(item.escaping).toBeTrue(); expect(item.outside(200, 200)).toBeTrue(); const gold = new ItemDrop({ id: "gold", kind: "gold", amount: 1 }, { x: 100, y: 0 }); gold.applyPush({ x: 0, y: 0 }, 180); expect(gold.velocity.x).toBe(0); expect(gold.escaping).toBeFalse(); });
  test("uses visible rarity colors for equipment and scrap drops", () => { expect(dropRarityColor("common")).toBe("#d8e5e8"); expect(dropRarityColor("uncommon")).toBe("#62e88a"); expect(dropRarityColor("rare")).toBe("#6ca8ff"); expect(dropRarityColor("epic")).toBe("#ca75ff"); });
  test("cancels an unresolved enemy telegraph when its source dies", () => {
    const source = { active: false };
    const attack = new AttackArea("creep", { x: 10, y: 10 }, 0, 70, Math.PI, 0.5, 0.1, 2, source);
    attack.update(0.6);
    expect(attack.shouldResolve()).toBeFalse(); expect(attack.active).toBeFalse();
  });
  test("cancels an unresolved enemy telegraph when its source attack is interrupted", () => {
    const source = { active: true, attackVersion: 0 };
    const attack = new AttackArea("creep", { x: 10, y: 10 }, 0, 70, Math.PI, 0.5, 0.1, 2, source);
    attack.update(0.4); source.attackVersion += 1;
    expect(attack.shouldResolve()).toBeFalse(); expect(attack.active).toBeFalse();
  });
  test("stops locomotion on Freeze then slides applied velocity without friction", () => {
    const hero = new Hero({ x: 50, y: 50 }); hero.velocity = { x: 30, y: 0 };
    hero.addStatus({ kind: "freeze", remaining: 2, damagePerSecond: 0 }); expect(hero.velocity).toEqual({ x: 0, y: 0 });
    hero.velocity.x = 40; hero.slide(0.5); expect(hero.position.x).toBe(70); expect(hero.velocity.x).toBe(40);
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
    const hero = new Hero({ x: 50, y: 50 }); const buckler = { ...generateBuckler(0, "common", 12), perks: {} };
    hero.configureStats({ agility: 5, strength: 5, magic: 0, spirit: 0, intelligence: 0 }, buckler);
    let rolls = [1, 0]; hero.receiveDamage(10, { next: () => rolls.shift() ?? 1 }); expect(hero.hp).toBe(10); expect(hero.stamina).toBe(5);
    hero.damageFloorOne = true; hero.receiveDamage(100, { next: () => 1 }); expect(hero.hp).toBe(1); expect(hero.active).toBeTrue();
  });

  test("allows 100% block chance and spends stamina only on successful blocks", () => {
    const hero = new Hero({ x: 50, y: 50 }); const buckler = { ...generateBuckler(0, "common", 12), perks: {} };
    hero.configureStats({ agility: 90, strength: 90, magic: 0, spirit: 0, intelligence: 0 }, buckler);
    const hp = hero.hp; let rolls = [1, 0.999]; hero.receiveDamage(10, { next: () => rolls.shift() ?? 1 }); expect(hero.hp).toBe(hp); expect(hero.stamina).toBe(hero.maxStamina - 1);
    hero.stamina = 0; hero.receiveDamage(10, { next: () => 1 }); expect(hero.hp).toBe(hp - 10); expect(hero.stamina).toBe(0);
    hero.stamina = 1; hero.receiveDamage(10, { next: () => 1 }); expect(hero.stamina).toBe(1);
  });
  test("restores Penance mana from damage prevented by a successful block", () => { const hero = new Hero({ x: 0, y: 0 }); const buckler = generateBuckler(0, "common", 12); hero.configureStats({ agility: 0, strength: 100, magic: 0, spirit: 10, intelligence: 100 }, buckler, starterClub()); hero.mana = 0; hero.knownSkills.add("penance"); hero.skillLevels.set("penance", 100); let rolls = [1, 0]; hero.receiveDamage(10, { next: () => rolls.shift() ?? 1 }); expect(hero.mana).toBeGreaterThan(59); expect(hero.mana).toBeLessThan(60); });

  test("returns passive Thorns damage and doubles it during Reflective Surge", () => { const defender = new Hero({ x: 0, y: 0 }); const attacker = new Hero({ x: 10, y: 0 }); defender.knownSkills.add("thorns"); const random = { next: () => 1 }; const before = attacker.hp; defender.receiveDamage(20, random, attacker); expect(attacker.hp).toBe(before - 1); attacker.hp = before; defender.reflectiveSurgeRemaining = 6; defender.receiveDamage(20, random, attacker); expect(attacker.hp).toBe(before - 2.2); });

  test("puts successful blocking on cooldown and scales Return blocking by attack speed", () => {
    const hero = new Hero({ x: 50, y: 50 }); const club = starterClub(); const buckler = { ...generateBuckler(0, "common", 12), perks: {}, reflectionComponents: ["return" as const] };
    const stats = { agility: 100, strength: 100, magic: 0, spirit: 0, intelligence: 0 }; hero.configureStats(stats, buckler, club);
    const hp = hero.hp; let rolls = [1, 0]; hero.receiveDamage(10, { next: () => rolls.shift() ?? 1 }); expect(hero.hp).toBe(hp); expect(hero.blockCooldown).toBeCloseTo(1 / weaponAttackSpeed(club, stats));
    hero.receiveDamage(10, { next: () => 1 }); expect(hero.hp).toBe(hp - 10); hero.updateResources(hero.blockCooldown, { next: () => 1 }); expect(hero.blockCooldown).toBe(0);
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

  test("emits dodge and block outcomes for heroes and enemies", () => { const hero = new Hero({ x: 0, y: 0 }); const texts: CombatText[] = []; hero.onCombatText = (text) => texts.push(text); hero.configureStats({ agility: 100, strength: 0, magic: 0, spirit: 0, intelligence: 0 }); hero.receiveDamage(5, { next: () => 0 }); expect(texts.at(-1)?.label).toBe("DODGE"); const buckler = generateBuckler(0, "common", 12); hero.configureStats({ agility: 0, strength: 100, magic: 0, spirit: 0, intelligence: 0 }, buckler); let rolls = [1, 0]; hero.receiveDamage(5, { next: () => rolls.shift() ?? 1 }); expect(texts.at(-1)?.label).toBe("BLOCK"); });
  test("shows post-mitigation overkill damage rather than remaining target health", () => { const hero = new Hero({ x: 10, y: 10 }); const texts: CombatText[] = []; hero.onCombatText = (text) => texts.push(text); hero.receiveDamage(250, { next: () => 1 }); expect(hero.hp).toBe(0); expect(texts[0].amount).toBe(250); });
  test("expires bounded spell effects and clears them with the arena", () => { const state = new ArenaState(); const effect = new SpellEffect("shockwave", { x: 5, y: 5 }); state.spellEffects.push(effect); effect.update(1); removeInactive(state.spellEffects); expect(state.spellEffects).toHaveLength(0); state.spellEffects.push(new SpellEffect("healing", { x: 5, y: 5 })); state.clear(); expect(state.spellEffects).toHaveLength(0); });
});
