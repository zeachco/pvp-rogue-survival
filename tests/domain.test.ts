import {describe, expect, test} from "bun:test";

import {
  auraRadius,
  auraSlowMultiplier,
  sunburnFraction,
  sunburnInterval,
  thunderCritChance,
  thunderDamage,
  thunderInterval
} from "../common/auras";
import {BALANCE} from "../common/balance";
import {
  attackProfile,
  bucklerBlockCost,
  healingCast,
  healingCooldown,
  healingFraction,
  manaConversionFraction,
  skillCooldown,
  skillRange,
  weaponAttackSpeed,
  weaponDamage,
  weaponRange,
  weaponUsesProjectile,
  whirlwindDamage,
  whirlwindDuration,
  whirlwindRadius
} from "../common/combat";
import {SKILLS, WEAPONS} from "../common/content";
import {
  collectIntoInventory,
  dropInventoryOverflow,
  emptyScraps,
  equipFromInventory,
  extractableSkills,
  extractFromInventory,
  inventoryCapacity,
  isEquippedTile,
  occupiedInventorySlots,
  purgeFromInventory,
  sellFromInventory,
  sendFromInventory,
  upgradeCosts,
  upgradeFromInventory
} from "../common/inventory";
import {
  AURA_SKILLS,
  equippedPerks,
  generateAccessory,
  generateBuckler,
  generateItem,
  generateRelic,
  itemCooldownReduction,
  itemRequirementMultiplier,
  itemStackKey,
  levelUpItem,
  MAX_ITEM_LEVEL,
  starterClub
} from "../common/items";
import {
  cumulativeXpForLevel,
  DEFAULT_ALLOCATION,
  derivedStats,
  lerpXpDisplay,
  levelForXp,
  xpForNextLevel,
  ZERO_STATS
} from "../common/progression";
import {parseClientMessage, type PlayerProgress} from "../common/protocol";
import {
  championCount,
  creepMaxHealth,
  creepsWithSpellsCount,
  realmCloneLevel,
  regularCount,
  regularLevel,
  rivalLevel,
  rivalXpReward
} from "../common/waves";
import {
  effectiveSkillLevel,
  forceField,
  forceFieldDamage,
  skillHealthRequirementMet
} from "../src/game/systems/HeroCombatSystem";
import {gameSocketUrl} from "../src/net/SocketClient";
import {itemRequirementRows, requirementMetStats} from "../src/ui/ItemDetails";
import {formatPreviewValue, formatProjectedValue, previewTone} from "../src/ui/preview";
import {extractButtonStatus} from "../src/ui/inventoryAvailability";

function progress(): PlayerProgress {
  return {
    level : 0,
    xp : 0,
    stats : {...ZERO_STATS},
    allocation : {...DEFAULT_ALLOCATION},
    gold : 1000,
    souls : 0,
    scraps : emptyScraps(),
    mainHand : starterClub(),
    inventoryTiles : [],
    learnedSkills : [ "healing" ],
    learnedSkillLevels : {healing : 1},
    universalSkills : [ "healing", ...AURA_SKILLS ]
  };
}
let id = 0;

describe("balance and waves", () => {
  test("keeps capped waves and player-independent champion scaling", () => {
    const balance = BALANCE;
    expect(regularCount(0, balance)).toBe(10);
    expect(regularCount(1, balance)).toBe(12);
    expect(regularLevel(3, 0, 16, balance)).toBe(1);
    expect(rivalLevel(1, balance)).toBe(1);
    expect(rivalLevel(5, balance)).toBe(3);
    expect(rivalXpReward(3)).toBe(34);
    expect(regularCount(100, balance)).toBe(40);
    expect(championCount(1)).toBe(0);
    expect(championCount(8)).toBe(1);
    expect(championCount(23)).toBe(2);
    expect(creepsWithSpellsCount(0, 10)).toBe(0);
    expect(creepsWithSpellsCount(8, 26)).toBe(0);
    expect(creepsWithSpellsCount(9, 28)).toBe(2);
    expect(creepsWithSpellsCount(15, 40)).toBe(3);
  });
  test("divides defender level evenly across realm-attacker clones", () => {
    expect(realmCloneLevel(11, 1)).toBe(11);
    expect(realmCloneLevel(11, 2)).toBe(5);
    expect(realmCloneLevel(11, 3)).toBe(3);
    expect(realmCloneLevel(0, 2)).toBe(0);
  });
  test("gives enemy levels zero through seven exactly one through eight HP",
       () => {
         for (let level = 0; level < 8; level += 1)
           expect(creepMaxHealth(level, 99, BALANCE)).toBe(level + 1);
         expect(creepMaxHealth(8, 18, BALANCE)).toBe(18);
       });
});
describe("attack timing", () => {
  test("uses damped weight handling for physical and magic weapons", () => {
    const club = starterClub();
    expect(weaponAttackSpeed(club, ZERO_STATS)).toBeCloseTo(10 / 12);
    expect(weaponAttackSpeed(club, {...ZERO_STATS, agility : 100}))
        .toBeCloseTo(20 / 12);
    const generatedStaff =
        generateItem(0, "common", 5, {allowedClasses : [ "staff" ]});
    const staff = {
      ...generatedStaff,
      modifiers : {...generatedStaff.modifiers, attackSpeedMultiplier : 1}
    };
    expect(
        weaponAttackSpeed(staff, {...ZERO_STATS, strength : 100, spirit : 100}))
        .toBeCloseTo(20 / 16);
    expect(weaponAttackSpeed(staff, {...ZERO_STATS, agility : 1_000}))
        .toBeCloseTo(10 / 16);
  });
});
test("resolves the configured unarmed profile from effective Strength", () => {
  expect(attackProfile(undefined, {...ZERO_STATS, strength : 8}, BALANCE))
      .toMatchObject({
        kind : "unarmed",
        damage : 9,
        attacksPerSecond : 1,
        range : 70,
        staminaCost : 1,
        projectile : false
      });
});
describe("equipment requirements", () => {
  test(
      "permits under-requirement equipment and scales item output by missing stat plus one",
      () => {
        const state = progress();
        const sword = {
          ...generateItem(5, "rare", 71, {allowedClasses : [ "sword" ]}),
          requirements : {strength : 15},
          perks : {defense : 9}
        };
        state.stats.strength = 13;
        state.inventoryTiles.push({
          id : "penalized",
          key : itemStackKey(sword),
          item : sword,
          quantity : 1
        });
        expect(itemRequirementMultiplier(sword, state.stats))
            .toBeCloseTo(1 / 3);
        expect(equipFromInventory(state, "penalized").changed).toBeTrue();
        expect(equippedPerks(state.stats, sword).defense).toBeCloseTo(3);
      });
  test("never reduces weapon damage below that weapon's level-zero value",
       () => {
         const sword = {
           ...generateItem(5, "common", 72, {allowedClasses : [ "sword" ]}),
           requirements : {strength : 100}
         };
         expect(weaponDamage(sword, ZERO_STATS))
             .toBeCloseTo(sword.modifiers.damageMultiplier / 1.125);
       });
  test(
      "never reduces weapon speed below its ordinary weight-and-handling speed",
      () => {
        const sword =
            generateItem(5, "common", 72, {allowedClasses : [ "sword" ]});
        const swiftSword = {
          ...sword,
          requirements : {strength : 100},
          modifiers : {...sword.modifiers, attackSpeedMultiplier : 1.2}
        };
        const baseSpeed = 10 / swiftSword.weight;
        expect(weaponAttackSpeed(swiftSword, ZERO_STATS))
            .toBeCloseTo(baseSpeed * (1 + 0.2 / 101));
        expect(weaponAttackSpeed({
          ...swiftSword,
          modifiers : {...swiftSword.modifiers, attackSpeedMultiplier : 1}
        },
                                 ZERO_STATS))
            .toBeCloseTo(baseSpeed);
      });
  test(
      "marks only upgrade requirements above the hero's matching stat as unmet",
      () => {
        const item = {
          ...generateItem(4, "common", 72, {allowedClasses : [ "sword" ]}),
          requirements : {strength : 15, agility : 8}
        };
        const baseline = {...item, requirements : {strength : 12, agility : 7}};
        expect(itemRequirementRows(
                   item, {...ZERO_STATS, strength : 13, agility : 9}, baseline))
            .toEqual([
              {key : "agility", currentVal : 7, newVal : 8, unmet : false},
              {key : "strength", currentVal : 12, newVal : 15, unmet : true}
            ]);
      });
  test(
      "projects the minimum attributes that fully satisfy an item's requirements",
      () => {
        const item = {
          ...generateItem(4, "common", 73, {allowedClasses : [ "axe" ]}),
          requirements : {strength : 15, agility : 8}
        };
        expect(requirementMetStats(item,
                                   {...ZERO_STATS, strength : 13, agility : 9}))
            .toEqual({...ZERO_STATS, strength : 15, agility : 9});
      });
});
test("derives health from Strength and mana from Intelligence", () => {
  const base = derivedStats(ZERO_STATS);
  expect(base.maxHp).toBe(10);
  expect(base.maxMana).toBe(5);
  const advanced =
      derivedStats({...ZERO_STATS, strength : 3, magic : 99, intelligence : 2});
  expect(advanced.maxHp).toBe(13);
  expect(advanced.maxMana).toBe(9);
});
describe("XP curve", () => {
  test("uses a quadratic cumulative curve with a 15 XP first level", () => {
    expect([ 0, 1, 2, 3, 4, 5 ].map(xpForNextLevel)).toEqual([
      15, 45, 75, 105, 135, 165
    ]);
    expect(cumulativeXpForLevel(4)).toBe(240);
    expect(levelForXp(239)).toBe(3);
    expect(levelForXp(240)).toBe(4);
  });
});

describe("permanent inventory", () => {
  test("changes extraction availability only when Gold crosses the required cost", () => {
    const state = progress();
    const item = generateItem(2, "rare", 83);
    item.skills = ["shockwave"];
    const tile = {id : "extractable", key : itemStackKey(item), item, quantity : 1};
    state.inventoryTiles.push(tile);
    state.gold = item.sellValue * 10 - 2;
    expect(extractButtonStatus(tile, state)).toBe("needs-gold");
    state.gold += 1;
    expect(extractButtonStatus(tile, state)).toBe("needs-gold");
    state.gold += 1;
    expect(extractButtonStatus(tile, state)).toBe("available");
    state.mainHand = item;
    expect(extractButtonStatus(tile, state)).toBe("equipped-only");
  });
  test(
      "toggles an equipped weapon to an empty main hand without creating a fallback club",
      () => {
        const state = progress();
        const clubTile = {
          id : "club",
          key : itemStackKey(state.mainHand),
          item : state.mainHand!,
          quantity : 1
        };
        state.inventoryTiles.push(clubTile);
        expect(equipFromInventory(state, clubTile.id).changed).toBeTrue();
        expect(state.mainHand).toBeUndefined();
        expect(clubTile.quantity).toBe(1);
        expect(state.inventoryTiles).toHaveLength(1);
      });
  test("toggles an equipped offhand back to unequipped", () => {
    const state = progress();
    const buckler = {...generateBuckler(0, "common", 12), requirements : {}};
    collectIntoInventory(state, buckler, () => `tile-${++id}`, () => ++id);
    const tile = state.inventoryTiles[0];
    expect(equipFromInventory(state, tile.id).changed).toBeTrue();
    expect(state.offHand).toBeDefined();
    expect(equipFromInventory(state, tile.id).changed).toBeTrue();
    expect(state.offHand).toBeUndefined();
    expect(tile.quantity).toBe(1);
  });
  test("prices percentage return above one stamina and upgrades it toward one",
       () => {
         const base = {
           ...generateBuckler(0, "rare", 18),
           reflectionComponents : [ "return" as const]
         };
         const stats = {...ZERO_STATS, agility : 50};
         const baseCost = bucklerBlockCost(base, stats);
         const upgraded = levelUpItem(base, 19);
         expect(baseCost).toBeGreaterThan(1);
         expect(bucklerBlockCost(upgraded, stats)).toBeGreaterThan(1);
         expect(bucklerBlockCost(upgraded, stats)).toBeLessThan(baseCost);
       });
  test("equips relics as offhands and preserves their attraction passive",
       () => {
         const state = progress();
         const relic = {...generateRelic(0, "rare", 12), attractionSpeed : 35};
         collectIntoInventory(state, relic, () => `tile-${++id}`, () => ++id);
         expect(equipFromInventory(state, state.inventoryTiles[0].id).changed)
             .toBeTrue();
         expect(state.offHand?.itemKind).toBe("relic");
         expect(state.offHand?.attractionSpeed).toBe(35);
       });
  test("removes empty stacks and releases their capacity immediately", () => {
    const state = progress();
    expect(inventoryCapacity(0)).toBe(8);
    for (let n = 0; n < 8; n += 1)
      expect(collectIntoInventory(state, generateItem(n, "common", 100 + n),
                                  () => `tile-${++id}`, () => ++id)
                 .changed)
          .toBeTrue();
    const tile = state.inventoryTiles[0];
    purgeFromInventory(state, tile.id);
    expect(state.inventoryTiles.some((candidate) => candidate.id === tile.id))
        .toBeFalse();
    expect(occupiedInventorySlots(state)).toBe(7);
    expect(collectIntoInventory(state, generateItem(9, "epic", 999),
                                () => `tile-${++id}`, () => ++id)
               .changed)
        .toBeTrue();
    expect(occupiedInventorySlots(state)).toBe(8);
  });
  test("upgrades one source copy without creating persistent automation",
       () => {
         const state = progress();
         const item = generateItem(1, "common", 41);
         collectIntoInventory(state, item, () => `tile-${++id}`, () => ++id);
         collectIntoInventory(state, {...item, id : "copy"},
                              () => `tile-${++id}`, () => ++id);
         state.scraps.common = 10;
         const gold = state.gold;
         const result = upgradeFromInventory(state, state.inventoryTiles[0].id,
                                             () => `tile-${++id}`, () => 55);
         expect(result.changed).toBeTrue();
         expect(result.created?.level).toBe(2);
         expect(state.inventoryTiles[0].quantity).toBe(1);
         expect(state.inventoryTiles[1].quantity).toBe(1);
         expect(state.scraps.common).toBe(6);
         expect(state.gold).toBeLessThan(gold);
       });
  test(
      "uses lower upgrade bases and increases them for direct attribute points",
      () => {
        const plain = generateItem(1, "common", 41);
        const attributed = {...plain, statBonuses : {spirit : 3}};
        expect(upgradeCosts(plain))
            .toEqual({gold : Math.ceil(plain.sellValue * 1.5), scraps : 4});
        expect(upgradeCosts(attributed)).toEqual({
          gold : Math.ceil(plain.sellValue * 1.5 * 1.3),
          scraps : 6
        });
      });
  test("upgrades a lone equipped copy in place when resources are sufficient",
       () => {
         const state = progress();
         const item = {...generateItem(1, "common", 141), requirements : {}};
         collectIntoInventory(state, item, () => `tile-${++id}`, () => ++id);
         const tile = state.inventoryTiles.find(
             (candidate) => candidate.key === itemStackKey(item))!;
         expect(equipFromInventory(state, tile.id).changed).toBeTrue();
         state.scraps.common = 20;
         const result = upgradeFromInventory(state, tile.id,
                                             () => `tile-${++id}`, () => 155);
         expect(result.changed).toBeTrue();
         expect(state.mainHand.level).toBe(2);
         const upgraded = state.inventoryTiles.find(
             (candidate) => candidate.key === itemStackKey(state.mainHand));
         expect(upgraded?.quantity).toBe(1);
         expect(isEquippedTile(state, upgraded!)).toBeTrue();
         expect(
             state.inventoryTiles.some((candidate) => candidate.id === tile.id))
             .toBeFalse();
       });
  test("retains equipped copies and rejects destructive actions", () => {
    const state = progress();
    const item = {...generateItem(1, "rare", 71), requirements : {}};
    collectIntoInventory(state, item, () => `tile-${++id}`, () => ++id);
    const tile = state.inventoryTiles[0];
    expect(equipFromInventory(state, tile.id).changed).toBeTrue();
    expect(tile.quantity).toBe(1);
    expect(isEquippedTile(state, tile)).toBeTrue();
    expect(state.inventoryTiles.some(
               (candidate) => candidate.key === itemStackKey(starterClub())))
        .toBeTrue();
    const gold = state.gold;
    const scraps = state.scraps.rare;
    expect(sellFromInventory(state, tile.id).changed).toBeFalse();
    expect(purgeFromInventory(state, tile.id).changed).toBeFalse();
    expect(tile.quantity).toBe(1);
    expect(state.gold).toBe(gold);
    expect(state.scraps.rare).toBe(scraps);
  });
  test("allows destructive actions on spare copies in an equipped stack",
       () => {
         const state = progress();
         const item = {...generateItem(1, "rare", 71), requirements : {}};
         for (let copy = 0; copy < 4; copy += 1)
           collectIntoInventory(state, {...item, id : `spare-${copy}`},
                                () => `tile-${++id}`, () => ++id);
         const tile = state.inventoryTiles[0];
         expect(equipFromInventory(state, tile.id).changed).toBeTrue();
         expect(tile.quantity).toBe(4);
         expect(state.inventoryTiles).toContain(tile);
         expect(sellFromInventory(state, tile.id).changed).toBeTrue();
         expect(purgeFromInventory(state, tile.id).changed).toBeTrue();
         expect(sendFromInventory(state, tile.id).changed).toBeTrue();
         expect(tile.quantity).toBe(1);
         expect(isEquippedTile(state, tile)).toBeTrue();
         expect(sellFromInventory(state, tile.id).changed).toBeFalse();
       });
});

describe("protocol validation", () => {
  test(
      "accepts v20 inventory, suicide, and anonymous commands and rejects retired automation",
      () => {
        expect(parseClientMessage(
                   {type : "upgradeItem", tileId : "tile-1", bulk : true}))
            .toEqual({type : "upgradeItem", tileId : "tile-1", bulk : true});
        expect(parseClientMessage({type : "deferDrop", dropId : "drop-1"}))
            .toEqual({type : "deferDrop", dropId : "drop-1"});
        expect(parseClientMessage({type : "suicide"})?.type).toBe("suicide");
        expect(parseClientMessage({type : "join", name : "Hero_1"})?.type)
            .toBe("join");
        expect(parseClientMessage({type : "join", name : "bad name"}))
            .toBeUndefined();
        expect(parseClientMessage({type : "listHeroes"})?.type)
            .toBe("listHeroes");
        expect(parseClientMessage({
                 type : "respecStats",
                 allocation : {
                   agility : 1,
                   strength : 1,
                   magic : 1,
                   spirit : 1,
                   intelligence : 1
                 }
               })?.type)
            .toBe("respecStats");
        expect(parseClientMessage({
          type : "setStackAutomation",
          tileId : "tile-1",
          mode : "sell",
          maxRarity : "rare"
        })).toBeUndefined();
        expect(parseClientMessage({type : "mergeItem", tileId : "tile-1"}))
            .toBeUndefined();
        expect(parseClientMessage(
                   {type : "creepKilled", unitId : "unit-1", xpReward : 9999}))
            .toBeUndefined();
        expect(parseClientMessage({
          type : "updateAllocation",
          allocation : {agility : 5}
        })).toBeUndefined();
      });
});
describe("weapon skills", () => {
  test("gives every weapon class a distinct registered signature skill", () => {
    const skills = Object.values(WEAPONS).map((weapon) => weapon.skill);
    expect(new Set(skills).size).toBe(Object.keys(WEAPONS).length);
    for (const skill of skills)
      expect(skill && SKILLS[skill]).toBeDefined();
    expect(WEAPONS.mace.skill).toBe("shockwave");
    expect(WEAPONS.axe.skill).toBe("cleave");
    expect(WEAPONS.hammer.skill).toBe("orbitingHammers");
    expect(SKILLS.orbitingHammers.resource).toBe("mana");
  });
});
describe("equipped skill levels", () => {
  test(
      "temporarily adds one level and requires matching gear until universally unlocked",
      () => {
        const state = progress();
        expect(effectiveSkillLevel(state, "bash")).toBe(1);
        state.learnedSkills.push("bash");
        state.learnedSkillLevels.bash = 3;
        expect(effectiveSkillLevel(state, "bash")).toBe(4);
        state.mainHand = {...state.mainHand, skills : []};
        expect(effectiveSkillLevel(state, "bash")).toBe(0);
        state.universalSkills.push("bash");
        expect(effectiveSkillLevel(state, "bash")).toBe(3);
        const relic = generateRelic(1, "rare", 0);
        state.offHand = relic;
        expect(relic.skills).toContain("gravityPull");
        expect(effectiveSkillLevel(state, "gravityPull")).toBe(1);
      });
});
describe("amulets and charms", () => {
  test("rolls rarity-bounded accessories and equips amulets and charms independently", () => {
    const bounds = {
      common : [ 1, 2 ],
      uncommon : [ 1, 3 ],
      rare : [ 2, 4 ],
      epic : [ 4, 6 ]
    } as const;
    for (const rarity of ["common", "uncommon", "rare", "epic"] as const)
      for (let seed = 0; seed < 20; seed += 1) {
        const item = generateAccessory(20, rarity, seed);
        const bonus = item.accessoryBonuses ?? {};
        const count = Object.keys(item.statBonuses).length +
                      Number(bonus.manaSkillLevels !== undefined) +
                      Number(bonus.staminaSkillLevels !== undefined) +
                      Number(bonus.allSkillLevels !== undefined) +
                      Number(bonus.globalCooldownReduction !== undefined) +
                      Number(bonus.manaCostReduction !== undefined) +
                      Number(bonus.lifeCostReduction !== undefined) +
                      Number(item.attractionSpeed > 0) +
                      Object.keys(bonus.physicalDamage ?? {}).length;
        expect(count).toBeGreaterThanOrEqual(bounds[rarity][0]);
        expect(count).toBeLessThanOrEqual(bounds[rarity][1]);
      }
    const state = progress();
    const charm = generateAccessory(10, "rare", 3, "charm");
    const amulet = generateAccessory(10, "rare", 4, "amulet");
    collectIntoInventory(state, charm, () => `tile-${++id}`, () => ++id);
    collectIntoInventory(state, amulet, () => `tile-${++id}`, () => ++id);
    expect(equipFromInventory(state, state.inventoryTiles[0].id).changed).toBeTrue();
    expect(equipFromInventory(state, state.inventoryTiles[1].id).changed).toBeTrue();
    expect(state.offHand).toBeUndefined();
    expect(state.charm?.itemKind).toBe("charm");
    expect(state.amulet?.itemKind).toBe("amulet");
    const staff = generateItem(10, "rare", 99, { allowedClasses: ["staff"] });
    collectIntoInventory(state, staff, () => `tile-${++id}`, () => ++id);
    expect(equipFromInventory(state, state.inventoryTiles[2].id).changed).toBeTrue();
    expect(state.mainHand?.hands).toBe(2);
    expect(state.offHand).toBeUndefined();
    expect(state.amulet?.itemKind).toBe("amulet");
    expect(state.charm?.itemKind).toBe("charm");
  });
  test(
      "adds temporary resource skill levels and caps global cooldown reduction",
      () => {
        const state = progress();
        state.offHand = {
          ...generateAccessory(50, "epic", 8, "amulet"),
          requirements : {},
          accessoryBonuses : {
            manaSkillLevels : 5,
            staminaSkillLevels : 10,
            allSkillLevels : 3,
            globalCooldownReduction : .8
          }
        };
        expect(effectiveSkillLevel(state, "healing")).toBe(9);
        expect(effectiveSkillLevel(state, "bash")).toBe(14);
        expect(itemCooldownReduction(state.offHand)).toBe(.8);
      });
});
test(
    "drops newest unequipped overflow stacks after a death-level capacity reduction",
    () => {
      const state = progress();
      state.level = 100;
      for (let seed = 1; seed <= 11; seed += 1)
        collectIntoInventory(
            state,
            generateItem(seed, "common", seed, {allowedClasses : [ "sword" ]}),
            () => `overflow-${seed}`, () => seed);
      const protectedTile = state.inventoryTiles[10];
      expect(equipFromInventory(state, protectedTile.id).changed).toBeTrue();
      state.level = 0;
      const dropped = dropInventoryOverflow(state);
      expect(occupiedInventorySlots(state)).toBe(inventoryCapacity(0));
      expect(
          state.inventoryTiles.some((tile) => tile.key === protectedTile.key))
          .toBeTrue();
      expect(dropped).toHaveLength(4);
    });
describe("Epic skill extraction", () => {
  test(
      "requires Epic equipment for the first global binding, then permits lower-rarity upgrades",
      () => {
        const rareState = progress();
        const rare =
            generateItem(1, "rare", 17, {allowedClasses : [ "staff" ]});
        rareState.inventoryTiles.push(
            {id : "rare", key : itemStackKey(rare), item : rare, quantity : 1});
        rareState.gold = 10_000;
        expect(extractFromInventory(rareState, "rare").changed).toBeFalse();
        expect(rareState.learnedSkills).not.toContain("arcaneBolt");
        const epicState = progress();
        const epic =
            generateItem(1, "epic", 27, {allowedClasses : [ "staff" ]});
        epicState.inventoryTiles.push(
            {id : "epic", key : itemStackKey(epic), item : epic, quantity : 1});
        epicState.gold = 10_000;
        expect(extractFromInventory(epicState, "epic").changed).toBeTrue();
        expect(epicState.universalSkills)
            .toEqual(expect.arrayContaining([ "arcaneBolt", "frostOrb" ]));
        const upgrade =
            generateItem(1, "rare", 17, {allowedClasses : [ "staff" ]});
        epicState.inventoryTiles.push({
          id : "upgrade",
          key : itemStackKey(upgrade),
          item : upgrade,
          quantity : 1
        });
        const level = epicState.learnedSkillLevels.arcaneBolt!;
        expect(extractFromInventory(epicState, "upgrade").changed).toBeTrue();
        expect(epicState.learnedSkillLevels.arcaneBolt).toBe(level + 1);
      });
});
test("adds Healing to high-rarity maces and permits permanent Healing upgrades",
     () => {
       const rareMace =
           generateItem(5, "rare", 31, {allowedClasses : [ "mace" ]});
       expect(rareMace.skills)
           .toEqual(expect.arrayContaining([ "shockwave", "healing" ]));
       const state = progress();
       state.inventoryTiles.push({
         id : "healing-mace",
         key : itemStackKey(rareMace),
         item : rareMace,
         quantity : 1
       });
       state.gold = 100_000;
       expect(extractableSkills(rareMace)).toContain("healing");
       expect(extractFromInventory(state, "healing-mace").changed).toBeTrue();
       expect(state.learnedSkillLevels.healing).toBe(2);
       expect(state.universalSkills).toContain("healing");
     });
test("does not charge or consume equipment with only reactive Blocking", () => {
  const state = progress();
  const buckler = generateBuckler(1, "common", 12);
  state.inventoryTiles.push({
    id : "buckler",
    key : itemStackKey(buckler),
    item : buckler,
    quantity : 1
  });
  const gold = state.gold;
  expect(extractableSkills(buckler)).toEqual([]);
  expect(extractFromInventory(state, "buckler")).toMatchObject({
    changed : false,
    reason : "That item has no extractable skill."
  });
  expect(state.gold).toBe(gold);
  expect(state.inventoryTiles[0].quantity).toBe(1);
});
describe("spell resources", () => {
  test("registers Rent as life and buckler blocking as stamina", () => {
    expect(SKILLS.rent.resource).toBe("life");
    expect(SKILLS.blocking.resource).toBe("stamina");
    expect(generateBuckler(0, "common", 12).skills).toEqual([ "blocking" ]);
  });
});
test("requires at least thirty percent HP for every blood skill", () => {
  for (const skill of Object.values(SKILLS).filter(({resource}) =>
                                                       resource === "life")) {
    expect(skill.minimumHealthFraction).toBe(0.3);
    expect(skillHealthRequirementMet(skill.id, 29.999, 100)).toBeFalse();
    expect(skillHealthRequirementMet(skill.id, 30, 100)).toBeTrue();
  }
  expect(skillHealthRequirementMet("bash", 1, 100)).toBeTrue();
});
test("grants Gold gain and rarity boost on bucklers by rarity", () => {
  const common = generateBuckler(1, "common", 12);
  const epic = generateBuckler(1, "epic", 12);
  expect(common.modifiers.goldGain).toBeCloseTo(0.05);
  expect(common.modifiers.rarityBoost).toBeCloseTo(0.02);
  expect(epic.modifiers.goldGain).toBeGreaterThan(common.modifiers.goldGain);
  expect(epic.modifiers.rarityBoost)
      .toBeGreaterThan(common.modifiers.rarityBoost);
});
describe("Force Field", () => {
  test("always applies outward velocity and interrupts attacks", () => {
    let interrupted = 0;
    const pushed = {
      position : {x : 100, y : 0},
      velocity : {x : -400, y : 0},
      interruptAttack : () => interrupted += 1
    };
    forceField(pushed, {x : 0, y : 0}, 40);
    expect(pushed.position).toEqual({x : 100, y : 0});
    expect(pushed.velocity).toEqual({x : 40, y : 0});
    expect(interrupted).toBe(1);
    expect(SKILLS.gravityPull.label).toBe("Force Field");
    expect(forceFieldDamage(1)).toBeCloseTo(0.2);
    expect(forceFieldDamage(100)).toBeCloseTo(3.17);
  });
});
describe("extractable offhand and staff skills", () => {
  test(
      "adds extractable Attraction and Force Field to attracting relics plus high-rarity offhand skills",
      () => {
        const relic = Array
                          .from({length : 50},
                                (_, seed) => generateRelic(1, "rare", seed))
                          .find((item) => item.attractionSpeed > 0)!;
        const buckler =
            Array
                .from({length : 100},
                      (_, seed) => generateBuckler(1, "rare", seed))
                .find((item) => item.reflectionComponents.length > 0)!;
        const staff =
            generateItem(1, "rare", 17, {allowedClasses : [ "staff" ]});
        expect(relic.skills)
            .toEqual(expect.arrayContaining([ "attraction", "gravityPull" ]));
        expect(extractableSkills(relic))
            .toEqual(expect.arrayContaining([ "attraction", "gravityPull" ]));
        expect(buckler.skills).toEqual(expect.arrayContaining([
          "blocking", "thorns", "reflectiveSurge"
        ]));
        expect(staff.skills)
            .toEqual(expect.arrayContaining([ "arcaneBolt", "frostOrb" ]));
        const epic = Array
                         .from({length : 50},
                               (_, seed) => generateRelic(1, "epic", seed))
                         .find((item) => item.attractionSpeed > 0)!;
        const state = progress();
        state.gold = 100_000;
        state.inventoryTiles.push(
            {id : "idol", key : itemStackKey(epic), item : epic, quantity : 1});
        expect(extractFromInventory(state, "idol").changed).toBeTrue();
        expect(state.universalSkills)
            .toEqual(expect.arrayContaining([ "attraction", "gravityPull" ]));
        expect(SKILLS.attraction.passive).toBeTrue();
        expect(SKILLS.gravityPull.cooldown).toBe(18);
        expect(SKILLS.frostOrb.cooldown).toBe(20);
      });
});
describe("aura equipment", () => {
  test(
      "generates one deterministic extractable aura per scepter or Holy Buckler",
      () => {
        const scepters =
            Array.from({length : 5},
                       (_, seed) => generateItem(
                           8, "rare", seed, {allowedClasses : [ "scepter" ]}));
        expect(scepters.every((item) => item.itemKind === "relic" &&
                                        item.hands === 0 && item.weight === 0 &&
                                        item.staminaCost === 0 &&
                                        item.modifiers.damageMultiplier === 1 &&
                                        item.statBonuses.spirit! > 0 &&
                                        item.statBonuses.intelligence! > 0 &&
                                        item.skills.length === 1 &&
                                        AURA_SKILLS.includes(item.skills[0])))
            .toBeTrue();
        expect(new Set(scepters.flatMap((item) => item.skills)))
            .toEqual(new Set(AURA_SKILLS));
        const holy =
            Array
                .from({length : 50},
                      (_, index) => generateBuckler(8, "rare", index * 5))
                .filter((item) => item.name === "Holy Buckler");
        expect(holy.length).toBeGreaterThan(0);
        expect(holy.every((item) => item.skills.length === 2 &&
                                    item.skills[0] === "blocking" &&
                                    AURA_SKILLS.includes(item.skills[1])))
            .toBeTrue();
        const equipState = progress();
        equipState.inventoryTiles.push({id : "equipped-scepter",
                                        key : itemStackKey(scepters[0]),
                                        item : scepters[0], quantity : 1});
        expect(equipFromInventory(equipState, "equipped-scepter").changed)
            .toBeTrue();
        expect(equipState.mainHand?.definitionId).toBe("club");
        expect(equipState.offHand?.definitionId).toBe("scepter");
        expect(levelUpItem(scepters[0], 99).definitionId).toBe("scepter");
        const state = progress();
        const auraItem = scepters[0];
        state.gold = 100_000;
        state.inventoryTiles.push({
          id : "aura",
          key : itemStackKey(auraItem),
          item : auraItem,
          quantity : 2
        });
        expect(extractFromInventory(state, "aura").changed).toBeTrue();
        expect(extractFromInventory(state, "aura").changed).toBeTrue();
        expect(state.learnedSkillLevels[auraItem.skills[0]]).toBe(2);
      });
  test(
      "scales aura radius with level and Spirit plus other aura effects with level",
      () => {
        expect(auraRadius(1)).toBe(180);
        expect(auraRadius(100)).toBe(300);
        expect(auraRadius(1, 20)).toBe(190);
        expect(auraRadius(100, 20)).toBe(600);
        expect(auraSlowMultiplier(1)).toBeCloseTo(.8);
        expect(auraSlowMultiplier(100)).toBeCloseTo(.5);
        expect(sunburnInterval(100)).toBe(.5);
        expect(sunburnFraction(100)).toBeCloseTo(.1);
        expect(thunderInterval(1)).toBe(10);
        expect(thunderInterval(100)).toBe(1);
        expect(thunderDamage(10)).toBe(9);
        expect(thunderCritChance(.2)).toBeCloseTo(.3);
      });
});
describe("throwing axes", () => {
  test(
      "generates a one-handed short-ranged projectile weapon with inherent bleed",
      () => {
        const axe =
            generateItem(0, "common", 17, {allowedClasses : [ "throwingAxe" ]});
        expect(axe.hands).toBe(1);
        expect(axe.skills).toEqual([ "rendingThrow" ]);
        expect(axe.modifiers.bleedChance).toBeGreaterThanOrEqual(0.15);
        expect(weaponRange(axe)).toBe(210);
        expect(weaponUsesProjectile(axe)).toBeTrue();
      });
});
test("adds extractable Whirlwind to high-rarity axes and scales its field",
     () => {
       const axe = generateItem(8, "rare", 17, {allowedClasses : [ "axe" ]});
       expect(axe.skills)
           .toEqual(expect.arrayContaining([ "cleave", "whirlwind" ]));
       expect(extractableSkills(axe)).toContain("whirlwind");
       expect(whirlwindRadius(1)).toBeCloseTo(91.2);
       expect(whirlwindRadius(100)).toBe(210);
       expect(whirlwindDuration(0)).toBe(2);
       expect(whirlwindDuration(100)).toBe(8);
       expect(whirlwindDamage(20)).toBe(9);
     });
describe("item sustain", () => {
  test("scales rolled sustain passives through upgrades", () => {
    const vampiric = generateItem(2, "rare", 8);
    expect(vampiric.modifiers.lifeStealBase).toBeCloseTo(0.021);
    const upgraded = levelUpItem(vampiric, 2);
    expect(upgraded.modifiers.lifeStealBase)
        .toBeGreaterThan(vampiric.modifiers.lifeStealBase);
    expect(upgraded.modifiers.strengthRegenMultiplier).toBe(0);
  });
});
describe("equipment upgrade trait preservation", () => {
  test("keeps rolled perks, attributes, skills, and requirement identities", () => {
    const base = generateItem(1, "rare", 17, {allowedClasses : [ "hammer" ]});
    const upgraded = levelUpItem(base, 999);
    expect(upgraded.perks).toEqual(base.perks);
    expect(upgraded.statBonuses).toEqual(base.statBonuses);
    expect(upgraded.skills).toEqual(base.skills);
    expect(Object.keys(upgraded.requirements).sort())
        .toEqual(Object.keys(base.requirements).sort());
    for (const [key, value] of Object.entries(base.requirements))
      expect(upgraded.requirements[key as keyof Stats]).toBeGreaterThanOrEqual(value!);
  });
  test("does not reroll accessory bonuses during an upgrade", () => {
    const base = generateAccessory(4, "rare", 27, "amulet");
    const upgraded = levelUpItem(base, 333);
    expect(upgraded.accessoryBonuses).toEqual(base.accessoryBonuses);
    expect(upgraded.statBonuses).toEqual(base.statBonuses);
    expect(upgraded.attractionSpeed).toBe(base.attractionSpeed);
  });
});
describe("equipment rarity promotion", () => {
  test(
      "caps generated levels and promotes capped equipment to level one",
      () => {
        expect(generateItem(99, "common", 3).level).toBe(MAX_ITEM_LEVEL.common);
        expect(generateBuckler(99, "uncommon", 3).level)
            .toBe(MAX_ITEM_LEVEL.uncommon);
        expect(generateRelic(99, "rare", 3).level).toBe(MAX_ITEM_LEVEL.rare);
        const common =
            generateItem(10, "common", 17, {allowedClasses : [ "staff" ]});
        const promoted = levelUpItem(common, 18);
        expect(promoted.rarity).toBe("uncommon");
        expect(promoted.level).toBe(1);
        expect(promoted.definitionId).toBe(common.definitionId);
        expect(promoted.affixes).toEqual(common.affixes);
        expect(promoted.skills).toEqual(common.skills);
      });
  test(
      "rejects upgrading final-level Epic equipment without spending resources",
      () => {
        const state = progress();
        const epic = generateItem(50, "epic", 19);
        state.inventoryTiles.push({
          id : "max-epic",
          key : itemStackKey(epic),
          item : epic,
          quantity : 1
        });
        state.gold = 1_000_000;
        state.scraps.epic = 1_000;
        const result =
            upgradeFromInventory(state, "max-epic", () => "unused", () => 20);
        expect(result.changed).toBeFalse();
        expect(state.gold).toBe(1_000_000);
        expect(state.scraps.epic).toBe(1_000);
        expect(state.inventoryTiles[0].quantity).toBe(1);
      });
});
describe("XP presentation", () => {
  test("retargets easing from the current displayed value", () => {
    const towardTwenty = lerpXpDisplay(0, 20);
    expect(towardTwenty).toBe(2);
    expect(lerpXpDisplay(towardTwenty, 50)).toBeCloseTo(6.8);
  });
});
describe("HUD preview values", () => {
  test("formats changed and removed values from currentVal and nullable newVal",
       () => {
         expect(formatPreviewValue({currentVal : 10, newVal : 14}))
             .toBe("10 → 14");
         expect(formatPreviewValue({currentVal : 10, newVal : 10})).toBe("10");
         expect(formatPreviewValue({currentVal : 10, newVal : null}))
             .toBe("10 → —");
         expect(formatProjectedValue({currentVal : 10, newVal : 14})).toBe("14");
         expect(previewTone({currentVal : 10, newVal : 14})).toBe("gain");
         expect(previewTone({currentVal : 10, newVal : 8})).toBe("cost");
       });
});
describe("spell range and recovery", () => {
  test(
      "scales skill range and cooldown slightly with weapon level while natural healing stays weak",
      () => {
        expect(skillRange("bash", starterClub(), 4, 20)).toBe(145);
        expect(skillRange("bash", starterClub(), 100, 100)).toBe(405);
        const leveled =
            generateItem(10, "rare", 17, {allowedClasses : [ "staff" ]});
        expect(skillRange("arcaneBolt", leveled, 1, 0)).toBeCloseTo(346.5);
        expect(skillCooldown("arcaneBolt", leveled)).toBeCloseTo(5 / 1.05);
        expect(derivedStats({...ZERO_STATS, spirit : 20}).hpRegen)
            .toBeCloseTo(0.105);
      });
});
describe("Healing scaling", () => {
  test("scales from level 1 to 100 and charges twice the restored HP", () => {
    expect(healingFraction(1)).toBeCloseTo(0.2);
    expect(healingFraction(100)).toBeCloseTo(0.9);
    expect(healingFraction(101)).toBeCloseTo(0.9);
    expect(healingCooldown(1)).toBeCloseTo(15);
    expect(healingCooldown(100)).toBeCloseTo(1);
    expect(healingCast(40, 100, 1)).toEqual({restoredHp : 8, manaCost : 16});
    expect(healingCast(49, 50, 100)).toEqual({restoredHp : 1, manaCost : 2});
  });
});
test("divides spell cooldown by Intelligence plus Agility with a safe floor",
     () => {
       expect(skillCooldown("fireBreath", starterClub(),
                            {...ZERO_STATS, intelligence : 2, agility : 3}))
           .toBeCloseTo(9 / 5);
       expect(skillCooldown("fireBreath", starterClub(), ZERO_STATS)).toBe(9);
     });
test("registers configurable Spirit relic perks", () => {
  expect(SKILLS.fireBreath).toMatchObject({enemyEligible : true, cost : 4});
  expect(SKILLS.voodoo.passive).toBeTrue();
  expect(SKILLS.manaDrain.passive).toBeTrue();
  expect(SKILLS.penance.passive).toBeTrue();
  expect(manaConversionFraction(1)).toBeCloseTo(.01);
  expect(manaConversionFraction(100)).toBeCloseTo(.6);
  const perks = Array.from({length : 100},
                           (_, seed) => generateRelic(3, "rare", seed).skills);
  expect(perks.some((skills) => skills.includes("fireBreath"))).toBeTrue();
  expect(perks.some((skills) => skills.includes("voodoo"))).toBeTrue();
  expect(perks.some((skills) => skills.includes("manaDrain"))).toBeTrue();
  expect(perks.some((skills) => skills.includes("penance"))).toBeTrue();
});
test("connects WebSockets to the page origin unless server overrides it",
     () => {
       expect(gameSocketUrl(
                  {host : "localhost:3000", protocol : "http:", search : ""} as
                  Location))
           .toBe("ws://localhost:3000/ws");
       expect(gameSocketUrl(
                  {host : "game.test", protocol : "https:", search : ""} as
                  Location))
           .toBe("wss://game.test/ws");
       expect(gameSocketUrl({
         host : "localhost:3000",
         protocol : "http:",
         search : "?server=pvp.railway%3A443"
       } as Location))
           .toBe("wss://pvp.railway/ws");
       expect(gameSocketUrl({
         host : "localhost:3000",
         protocol : "http:",
         search : "?ip=pvp.up.railway.app"
       } as Location))
           .toBe("wss://pvp.up.railway.app/ws");
       expect(gameSocketUrl({
         host : "localhost:3000",
         protocol : "http:",
         search : "?server=preferred.test&ip=legacy.test"
       } as Location))
           .toBe("wss://preferred.test/ws");
       expect(gameSocketUrl({
         host : "localhost:3000",
         protocol : "http:",
         search : "?server=ws%3A%2F%2F192.168.0.13%3A3000"
       } as Location))
           .toBe("ws://192.168.0.13:3000/ws");
       expect(gameSocketUrl({
         host : "localhost:3000",
         protocol : "http:",
         search : "?server=https%3A%2F%2Fpvp.railway%2Fgame"
       } as Location))
           .toBe("wss://pvp.railway/game/ws");
       expect(gameSocketUrl({
         host : "localhost:3000",
         protocol : "http:",
         search : "?server=ftp%3A%2F%2Fbad.test"
       } as Location))
           .toBe("ws://localhost:3000/ws");
     });
test(
    "uses the production WebSocket shortcut unless an explicit endpoint is provided",
    () => {
      expect(
          gameSocketUrl(
              {host : "localhost:3000", protocol : "http:", search : "?prod"} as
              Location))
          .toBe("wss://pvp.up.railway.app/ws");
      expect(gameSocketUrl({
        host : "localhost:3000",
        protocol : "http:",
        search : "?prod&server=override.test"
      } as Location))
          .toBe("wss://override.test/ws");
      expect(gameSocketUrl({
        host : "localhost:3000",
        protocol : "http:",
        search : "?prod&ip=legacy.test"
      } as Location))
          .toBe("wss://legacy.test/ws");
    });
