import { describe, expect, test } from "bun:test";
import { SeededRandom } from "../common/random";
import { AttackArea } from "../src/game/AttackArea";
import { ArenaState } from "../src/game/ArenaState";
import { GameMap } from "../src/game/Map";
import { Projectile } from "../src/game/Projectile";
import { removeInactive } from "../src/game/systems/lifecycle";
import { correctArenaBoundary } from "../src/game/bounds";
import { Hero } from "../src/game/Hero";
import { generateAccessory, generateBuckler } from "../common/items";
import type { CombatText } from "../src/game/CombatText";
import { SpellEffect } from "../src/game/SpellEffect";
import { GroundSwamp } from "../src/game/GroundSwamp";
import { dropRarityColor, ItemDrop } from "../src/game/ItemDrop";
import { starterClub } from "../common/items";
import { weaponAttackSpeed } from "../common/combat";
import { DEFAULT_ALLOCATION, ZERO_STATS } from "../common/progression";
import { emptyScraps } from "../common/inventory";
import { Creep } from "../src/game/Creep";
import { BALANCE } from "../common/balance";
import { cancelHostileProjectiles, castForceField, castForceFieldTargets, forceField, HeroCombatSystem, skillAffordable } from "../src/game/systems/HeroCombatSystem";
import { resolveCombat } from "../src/game/systems/combat";
import { applyImpactForce, emittedImpactForce } from "../src/game/ImpactForce";

describe("arena systems", () => {
  test("preserves emitted linear and radial impact directions", () => {
    const source = new Hero({ x: 0, y: 0 }); source.configureStats({ ...ZERO_STATS, strength: 10 });
    const target = new Hero({ x: 20, y: 20 });
    applyImpactForce(target, emittedImpactForce(source, "linear", source.position, { x: 1, y: 0 }));
    expect(target.velocity).toEqual({ x: 30, y: 0 });
    target.velocity = { x: 0, y: 0 };
    applyImpactForce(target, emittedImpactForce(source, "radial", source.position));
    expect(target.velocity.x).toBeCloseTo(Math.SQRT1_2 * 30);
    expect(target.velocity.y).toBeCloseTo(Math.SQRT1_2 * 30);
  });

  test("applies Whirlwind's level-scaled movement multiplier without changing ordinary attack slow", () => {
    const hero = new Hero({ x: 50, y: 50 });
    hero.movementSpeedMultiplier = 1.5;
    hero.move({ x: 1, y: 0 }, 1, 2_000, 2_000);
    expect(hero.velocity.x).toBe(352.5);
    hero.attackSlow = true;
    hero.move({ x: 1, y: 0 }, 1, 2_000, 2_000);
    expect(hero.velocity.x).toBe(169.2);
  });
  test("regenerates stamina four times slower and pauses it while the hero is active", () => {
    const hero = new Hero({ x: 50, y: 50 }); hero.configureStats({ ...ZERO_STATS, spirit: 10 }); hero.stamina = 0;
    hero.update(1, undefined, false, true); expect(hero.stamina).toBeCloseTo(.3);
    hero.update(1, undefined, false, false); expect(hero.stamina).toBeCloseTo(.3);
  });
  test("reports spell affordability from the hero's current resources", () => {
    const hero = new Hero({ x: 50, y: 50 }); const weapon = starterClub(); hero.configureStats({ ...ZERO_STATS, intelligence: 5 }, undefined, weapon);
    const progress = { level: 1, xp: 0, stats: { ...ZERO_STATS, intelligence: 5 }, allocation: { ...DEFAULT_ALLOCATION }, gold: 0, souls: 0, scraps: emptyScraps(), mainHand: weapon, inventoryTiles: [], learnedSkills: ["bash" as const, "gravityPull" as const, "rent" as const, "penance" as const], learnedSkillLevels: { bash: 1, gravityPull: 1, rent: 1, penance: 1 }, universalSkills: [] };
    hero.stamina = 0; expect(skillAffordable("bash", progress, hero)).toBeFalse();
    hero.mana = 7; expect(skillAffordable("gravityPull", progress, hero)).toBeFalse();
    hero.mana = 8; expect(skillAffordable("gravityPull", progress, hero)).toBeTrue();
    hero.hp = 1; expect(skillAffordable("rent", progress, hero)).toBeFalse();
    expect(skillAffordable("penance", progress, hero)).toBeTrue();
  });
  test("Time Harvest removes every tracked hero cooldown after a kill", () => {
    const hero = new Hero({ x: 50, y: 50 }); hero.configureStats(ZERO_STATS); hero.blockCooldown = 4;
    const combat = new HeroCombatSystem();
    const internal = combat as unknown as { attackCooldown: number; healingCooldown: number; skillCooldowns: Map<string, { remaining: number; maximum: number }> };
    internal.attackCooldown = 5; internal.healingCooldown = 3; internal.skillCooldowns.set("bash", { remaining: 2, maximum: 2 });
    const amulet = { ...generateAccessory(0, "epic", 1, "amulet"), requirements: {} };
    const progress = { level: 1, xp: 0, stats: { ...ZERO_STATS }, allocation: { ...DEFAULT_ALLOCATION }, gold: 0, souls: 0, scraps: emptyScraps(), mainHand: starterClub(), amulet, inventoryTiles: [], learnedSkills: [], learnedSkillLevels: {}, universalSkills: [] };
    expect(combat.onKill(progress, hero)).toBe(1);
    expect(internal.attackCooldown).toBe(4); expect(internal.healingCooldown).toBe(2); expect(internal.skillCooldowns.get("bash")?.remaining).toBe(1); expect(hero.blockCooldown).toBe(3);
  });
  test("chains rotating skill casts while basic attacks run on their own cooldown", () => {
    const hero = new Hero({ x: 50, y: 50 });
    const weapon = starterClub();
    hero.configureStats(ZERO_STATS, undefined, weapon);
    const target = new Creep({ id: "cast-target", name: "Target", kind: "melee", level: 0, stats: { ...ZERO_STATS }, mainHand: weapon, carried: [], isRival: false, xpReward: 0, goldReward: 0, seed: 1 }, "neutral", "neutral", { x: 80, y: 50 }, BALANCE, new SeededRandom(1));
    const state = new ArenaState(); state.creeps.push(target);
    const progress = { level: 1, xp: 0, stats: { ...ZERO_STATS }, allocation: { ...DEFAULT_ALLOCATION }, gold: 0, souls: 0, scraps: emptyScraps(), mainHand: weapon, inventoryTiles: [], learnedSkills: ["bash" as const, "rent" as const], learnedSkillLevels: { bash: 1, rent: 1 }, universalSkills: [] };
    const combat = new HeroCombatSystem();
    const stamina = hero.stamina;
    combat.update(1 / 60, { x: 0, y: 0 }, hero, state, progress, BALANCE, new SeededRandom(1));
    expect(combat.attacking).toBeTrue();
    expect(combat.spellSlots(progress, hero).find((slot) => slot.id === "bash")?.castProgress).toBe(0);
    expect(state.attacks).toHaveLength(1); expect(state.attacks[0].skill).toBeUndefined(); expect(hero.stamina).toBeLessThan(stamina);
    const staminaAfterBasic = hero.stamina;
    combat.update(.2, { x: 0, y: 0 }, hero, state, progress, BALANCE, new SeededRandom(1));
    expect(state.attacks).toHaveLength(1); expect(hero.stamina).toBe(staminaAfterBasic);
    combat.update(.2, { x: 0, y: 0 }, hero, state, progress, BALANCE, new SeededRandom(1));
    expect(state.attacks.filter((attack) => attack.skill === "bash")).toHaveLength(1); expect(hero.stamina).toBeLessThan(staminaAfterBasic);
    expect((combat as unknown as { attackCooldown: number }).attackCooldown).toBeLessThan(1);
    expect(combat.spellSlots(progress, hero).find((slot) => slot.id === "bash")?.castProgress).toBeUndefined();
    expect(combat.spellSlots(progress, hero).find((slot) => slot.id === "rent")?.castProgress).toBeGreaterThan(0);
    const hpBeforeRent = hero.hp;
    combat.update(.3, { x: 0, y: 0 }, hero, state, progress, BALANCE, new SeededRandom(1));
    expect(state.attacks.filter((attack) => attack.skill === "rent")).toHaveLength(1);
    expect(hero.hp).toBeLessThan(hpBeforeRent);
  });
  test("restores resources and clears transient combat state for a new realm", () => { const hero = new Hero({ x: 50, y: 50 }); hero.configureStats(ZERO_STATS); hero.hp = 1; hero.mana = 0; hero.stamina = 0; hero.velocity = { x: 9, y: 4 }; hero.blockCooldown = 1; hero.reflectiveSurgeRemaining = 2; hero.addStatus({ kind: "poison", remaining: 4, damagePerSecond: 1 }); hero.resetForRealm(); expect(hero.hp).toBe(hero.maxHp); expect(hero.mana).toBe(hero.maxMana); expect(hero.stamina).toBe(hero.maxStamina); expect(hero.statuses).toHaveLength(0); expect(hero.velocity).toEqual({ x: 0, y: 0 }); expect(hero.blockCooldown).toBe(0); expect(hero.reflectiveSurgeRemaining).toBe(0); });
  test("preserves mana and stamina across active-wave progression updates", () => { const hero = new Hero({ x: 50, y: 50 }); hero.configureStats({ ...ZERO_STATS, intelligence: 1, strength: 2 }); hero.mana = 2; hero.stamina = 3; hero.applyProgress({ level: 2, xp: 60, stats: { ...ZERO_STATS, intelligence: 3, strength: 4 }, allocation: { ...DEFAULT_ALLOCATION }, gold: 10, souls: 0, scraps: emptyScraps(), mainHand: starterClub(), inventoryTiles: [], learnedSkills: ["healing"], learnedSkillLevels: { healing: 1 }, universalSkills: ["healing"] }, true); expect(hero.maxMana).toBe(11); expect(hero.mana).toBe(2); expect(hero.stamina).toBe(3); });
  test("moves orbiting hammers around their moving source and expires them", () => { const hero = new Hero({ x: 50, y: 50 }); const hammer = Projectile.orbitingHammer(hero, 0, 4, { kind: "magic" }); hero.position.x = 70; hammer.update(0.1); expect(Math.hypot(hammer.position.x - hero.position.x, hammer.position.y - hero.position.y)).toBeCloseTo(34.75); hammer.update(2.4); expect(hammer.active).toBeFalse(); });
  test("keeps level-scaled orbiting hammers active for their full lifetime", () => { const hero = new Hero({ x: 50, y: 50 }); const hammer = Projectile.orbitingHammer(hero, 0, 4, { kind: "magic" }, 0, 30); hammer.update(29.9); expect(hammer.active).toBeTrue(); hammer.update(.11); expect(hammer.active).toBeFalse(); });
  test("keeps orbiting hammers active after hits and gives them diverging angular drift", () => { const hero = new Hero({ x: 50, y: 50 }); const slower = Projectile.orbitingHammer(hero, 0, 4, { kind: "magic" }, -0.1); const faster = Projectile.orbitingHammer(hero, 0, 4, { kind: "magic" }, 0.1); slower.markHit("creep-1"); expect(slower.canHit("creep-1")).toBeFalse(); expect(slower.active).toBeTrue(); slower.update(1); faster.update(1); expect(Math.abs(slower.position.x - faster.position.x) + Math.abs(slower.position.y - faster.position.y)).toBeGreaterThan(1); });
  test("returns the broad fast Vampiric Boomerang with half projectile knockback and heals from cumulative recorded damage", () => { const hero = new Hero({ x: 0, y: 0 }); hero.configureStats(ZERO_STATS); hero.hp = 1; const boomerang = Projectile.vampiricBoomerang(hero, { x: 100, y: 0 }, 4, 30, .5, starterClub()); expect(boomerang.radius).toBe(33); expect(boomerang.force?.impulse).toBe(5); boomerang.update(.1); expect(boomerang.position.x).toBeCloseTo(18); boomerang.markHit("outbound"); boomerang.recordDamage(10); boomerang.recordDamage(6); expect(boomerang.active).toBeTrue(); boomerang.update(.3); boomerang.update(.3); expect(boomerang.active).toBeFalse(); expect(hero.hp).toBe(9); });
  test("Vampiric Boomerang continuously damages every creep overlapping its broad area", () => { const state = new ArenaState(); const hero = new Hero({ x: 50, y: 50 }); hero.configureStats(ZERO_STATS); const weapon = starterClub(); const makeCreep = (id: string, x: number) => new Creep({ id, name: id, kind: "melee", level: 0, stats: { ...ZERO_STATS }, mainHand: weapon, carried: [], isRival: false, xpReward: 0, goldReward: 0, seed: 1 }, "neutral", "neutral", { x, y: 50 }, BALANCE, new SeededRandom(1)); const first = makeCreep("first", 65); const second = makeCreep("second", 80); state.creeps.push(first, second); const boomerang = Projectile.vampiricBoomerang(hero, { x: 150, y: 50 }, 2, 100, .5, weapon); state.projectiles.push(boomerang); const firstHp = first.hp; const secondHp = second.hp; boomerang.update(.1); resolveCombat(state, hero, weapon, 500, 500, new SeededRandom(1)); expect(first.hp).toBeCloseTo(firstHp - .2); expect(second.hp).toBeCloseTo(secondHp - .2); boomerang.update(.1); resolveCombat(state, hero, weapon, 500, 500, new SeededRandom(1)); expect(first.hp).toBeCloseTo(firstHp - .4); expect(second.hp).toBeCloseTo(secondHp - .4); });
  test("moves Frozen Orb slowly and emits eight damaging radial spikes", () => { const hero = new Hero({ x: 0, y: 0 }); const orb = new Projectile(hero.position, { x: 100, y: 0 }, 5, "hero", "frostOrb", hero, { kind: "magic" }, starterClub()); orb.update(1); expect(orb.position.x).toBe(75); const spikes = orb.emitFrostSpikes(1 / 60); expect(spikes).toHaveLength(8); expect(spikes.every((spike) => spike.skill === "frostSpike" && spike.damage === 5)).toBeTrue(); });
  test("Gooey Swamp adds one poison stack per continuous second inside", () => { const hero = new Hero({ x: 0, y: 0 }); hero.configureStats({ ...ZERO_STATS, spirit: 10 }); hero.knownSkills.add("voodoo"); const creep = new Creep({ id: "swamped", name: "Swamped", kind: "melee", level: 0, stats: { ...ZERO_STATS }, mainHand: starterClub(), carried: [], isRival: false, xpReward: 0, goldReward: 0, seed: 1 }, "neutral", "neutral", { x: 20, y: 0 }, BALANCE, new SeededRandom(1)); const swamp = new GroundSwamp({ x: 0, y: 0 }, 100, hero); swamp.update(1, [creep]); expect(creep.statuses).toMatchObject([{ kind: "poison", remaining: 8, damagePerSecond: .52, source: hero }]); creep.position.x = 200; swamp.update(.5, [creep]); creep.position.x = 20; swamp.update(.5, [creep]); expect(creep.statuses).toHaveLength(1); swamp.update(.5, [creep]); expect(creep.statuses).toHaveLength(2); });
  test("pulls ground drops toward an attracting hero at a bounded speed", () => { const drop = new ItemDrop({ id: "drop", kind: "item", item: starterClub() }, { x: 100, y: 0 }); drop.pullToward({ x: 0, y: 0 }, 35, 1); expect(drop.position).toEqual({ x: 65, y: 0 }); drop.pullToward({ x: 60, y: 0 }, 35, 1); expect(drop.position).toEqual({ x: 60, y: 0 }); });
  test("pushes equipment drops beyond the realm without moving Gold", () => { const item = new ItemDrop({ id: "item", kind: "item", item: starterClub() }, { x: 100, y: 0 }); item.applyPush({ x: 0, y: 0 }, 180); item.move(1); expect(item.position.x).toBe(280); expect(item.escaping).toBeTrue(); expect(item.outside(200, 200)).toBeTrue(); const gold = new ItemDrop({ id: "gold", kind: "gold", amount: 1 }, { x: 100, y: 0 }); gold.applyPush({ x: 0, y: 0 }, 180); expect(gold.velocity.x).toBe(0); expect(gold.escaping).toBeFalse(); });
  test("Force Field moves an inward-rushing creep away on the next simulation frame", () => {
    const weapon = starterClub(); const creep = new Creep({ id: "force-target", name: "Target", kind: "melee", level: 0, stats: { ...ZERO_STATS }, mainHand: weapon, carried: [], isRival: false, xpReward: 0, goldReward: 0, seed: 1 }, "neutral", "neutral", { x: 100, y: 0 }, BALANCE, new SeededRandom(1));
    creep.velocity = { x: -400, y: 0 }; forceField(creep, { x: 0, y: 0 }, 180); const before = creep.position.x; creep.pursue({ x: 0, y: 0 }, 1 / 60, 1000, 1000);
    expect(creep.position.x).toBeGreaterThan(before);
  });
  test("a creep carrying Force Field casts it against the hero", () => {
    const creep = new Creep({ id: "force-caster", name: "Caster", kind: "melee", level: 0, stats: { ...ZERO_STATS, intelligence: 2 }, mainHand: starterClub(), carried: [], isRival: false, xpReward: 0, goldReward: 0, seed: 1 }, "neutral", "neutral", { x: 100, y: 0 }, BALANCE, new SeededRandom(1));
    creep.knownSkills.add("gravityPull"); creep.mana = 8;
    expect(creep.pursue({ x: 0, y: 0 }, 2, 1_000, 1_000)).toMatchObject({ type: "forceField", source: creep });
  });
  test("Force Field does not move equipment drops", () => {
    const state = new ArenaState(); const hero = new Hero({ x: 0, y: 0 }); hero.configureStats(ZERO_STATS); const drop = new ItemDrop({ id: "force-drop", kind: "item", item: starterClub() }, { x: 100, y: 0 }); state.drops.push(drop);
    castForceField(state, hero, 1, new SeededRandom(1));
    expect(drop.position).toEqual({ x: 100, y: 0 }); expect(drop.velocity).toEqual({ x: 0, y: 0 }); expect(drop.escaping).toBeFalse();
  });
  test("Force Field cancels hostile projectiles in its radius without affecting friendly projectiles", () => {
    const hero = new Hero({ x: 0, y: 0 }); const hostile = new Projectile({ x: 100, y: 0 }, { x: 0, y: 0 }, 1, "creep"); const friendly = new Projectile({ x: 100, y: 0 }, { x: 0, y: 0 }, 1, "hero"); const distant = new Projectile({ x: 250, y: 0 }, { x: 0, y: 0 }, 1, "creep");
    cancelHostileProjectiles([hostile, friendly, distant], hero, "hero", 1);
    expect(hostile.active).toBeFalse(); expect(friendly.active).toBeTrue(); expect(distant.active).toBeTrue();
  });
  test("Burn and Freeze cancel one opposing stack before applying their own", () => {
    const hero = new Hero({ x: 0, y: 0 });
    hero.addStatus({ kind: "burn", remaining: 8, damagePerSecond: 1 }); hero.addStatus({ kind: "burn", remaining: 8, damagePerSecond: 1 });
    hero.addStatus({ kind: "freeze", remaining: 4, damagePerSecond: 0 });
    expect(hero.statuses.map((status) => status.kind)).toEqual([ "burn", "freeze" ]);
    hero.addStatus({ kind: "burn", remaining: 8, damagePerSecond: 1 });
    expect(hero.statuses.map((status) => status.kind)).toEqual([ "burn", "burn" ]);
  });
  test("Force Field transfers one randomly selected status stack to each damaged target", () => {
    const source = new Hero({ x: 0, y: 0 }); const first = new Hero({ x: 100, y: 0 }); const second = new Hero({ x: 150, y: 0 });
    source.addStatus({ kind: "freeze", remaining: 4, damagePerSecond: 0 }); source.addStatus({ kind: "freeze", remaining: 4, damagePerSecond: 0 }); source.addStatus({ kind: "poison", remaining: 8, damagePerSecond: 1 }); source.addStatus({ kind: "bleed", remaining: 3, damagePerSecond: .25 });
    castForceFieldTargets(source, [first, second], 1, { next: () => .5 });
    expect(source.statuses.map((status) => status.kind)).toEqual([ "freeze", "freeze", "bleed" ]);
    expect(first.statuses).toMatchObject([ { kind: "poison", remaining: 8, damagePerSecond: 1, source } ]);
    expect(second.statuses).toMatchObject([ { kind: "poison", remaining: 8, damagePerSecond: 1, source } ]);
  });
  test("Rapid Regeneration multiplies normal health regeneration and adds its flat bonus", () => {
    const hero = new Hero({ x: 0, y: 0 }); hero.configureStats({ ...ZERO_STATS, spirit: 20 }); hero.hp = 1;
    hero.healthRegenMultiplier = 1.2; hero.healthRegenFlat = .1; hero.updateResources(1);
    expect(hero.hp).toBeCloseTo(1.226);
    hero.healthRegenMultiplier = 5; hero.updateResources(1);
    expect(hero.hp).toBeCloseTo(1.851);
  });
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
  test("Arcane Bolt freezes a creep while preserving its impact push", () => {
    const state = new ArenaState(); const hero = new Hero({ x: 0, y: 0 }); hero.configureStats({ ...ZERO_STATS, strength: 10 }); const creep = new Creep({ id: "arcane-target", name: "Target", kind: "melee", level: 0, stats: { ...ZERO_STATS }, mainHand: starterClub(), carried: [], isRival: false, xpReward: 0, goldReward: 0, seed: 1 }, "neutral", "neutral", { x: 20, y: 0 }, BALANCE, new SeededRandom(1));
    state.creeps.push(creep); state.projectiles.push(new Projectile(hero.position, creep.position, 1, "hero", "arcaneBolt", hero, { kind: "magic" }, starterClub()));
    resolveCombat(state, hero, starterClub(), 500, 500, new SeededRandom(1));
    expect(creep.statuses).toMatchObject([{ kind: "freeze", remaining: 4, damagePerSecond: 0, source: hero }]); expect(creep.velocity.x).toBeGreaterThan(0);
    const before = creep.position.x; creep.pursue(hero.position, 1 / 60, 500, 500); expect(creep.position.x).toBeGreaterThan(before);
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
  test("restores Penance mana from damage prevented by a successful block", () => { const hero = new Hero({ x: 0, y: 0 }); const buckler = generateBuckler(0, "common", 12); hero.configureStats({ agility: 0, strength: 100, magic: 0, spirit: 10, intelligence: 100 }, buckler, starterClub()); hero.mana = 0; hero.knownSkills.add("penance"); hero.skillLevels.set("penance", 99); let rolls = [1, 0]; hero.receiveDamage(10, { next: () => rolls.shift() ?? 1 }); expect(hero.mana).toBeGreaterThan(59); expect(hero.mana).toBeLessThan(60); });

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
